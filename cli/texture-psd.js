const { deflateSync } = require('node:zlib');
const C = require('./texture-common.js');
const blendKeys={normal:'norm',multiply:'mul ',screen:'scrn'};
const keyBlends=new Map(Object.entries(blendKeys).map(([name,key])=>[key,name]));
const cat=parts=>Buffer.concat(parts);
const text=s=>Buffer.from(s,'ascii');
const zero=Buffer.alloc(4);
const sampleMax=depth=>2**depth-1;
const pale=(rgb,alpha,max)=>Math.round(rgb*alpha/max+max-alpha);
const nameIsValid=name=>typeof name==='string' && name.trim().length>0 && name.length<=240 && !/[\x00-\x1f]/.test(name);
const u16=n=>{const b=Buffer.allocUnsafe(2);b.writeUInt16BE(n);return b;};
const i16=n=>{const b=Buffer.allocUnsafe(2);b.writeInt16BE(n);return b;};
const u32=n=>{const b=Buffer.allocUnsafe(4);b.writeUInt32BE(n);return b;};
const rectangle=(...values)=>{const b=Buffer.allocUnsafe(16);values.forEach((n,i)=>b.writeInt32BE(n,4*i));return b;};
const even=bytes=>bytes.length%2?cat([bytes,Buffer.alloc(1)]):bytes;
const section=bytes=>cat([u32(bytes.length),bytes]);
const unicode=value=>cat([u32(value.length),Buffer.from(value,'utf16le').swap16()]);
function pascal(value,align=1) {
  const encoded=Buffer.from(value.replace(/[^ -~]/g,'?'),'ascii'), size=encoded.length+1;
  const bytes=Buffer.alloc(Math.ceil(size/align)*align);
  bytes[0]=encoded.length;
  encoded.copy(bytes,1);
  return bytes;
}
const resource=(id,data)=>cat([text('8BIM'),u16(id),Buffer.alloc(2),u32(data.length),even(data)]);
function tag(name,data,alignment=1) {
  const length=data.length, padding=(alignment-length%alignment)%alignment;
  return cat([text('8BIM'+name),section(data),Buffer.alloc(padding)]);
}

function rawPlane(count, depth, sample) {
  const bytes=Buffer.allocUnsafe(count*(depth/8));
  if (depth===16) for(let i=0;i<count;i++) bytes.writeUInt16BE(sample(i),2*i);
  else for(let i=0;i<count;i++) bytes[i]=sample(i);
  return bytes;
}
function layerImage(row,depth,channels,label) {
  const image=C.checkedRaster(row);
  if (!channels.includes(image.channels)||image.depth!==depth||row.alpha==='premultiplied')
    throw new TypeError('PSD '+label+' must use the document precision and straight alpha');
  return image;
}
function mix(mode,b,s) {
  if(mode==='multiply')return b*s;
  if(mode==='screen')return b+s-b*s;
  return s;
}
function flattened(layers,width,height,depth) {
  const Type=C.sampleType(depth), max=sampleMax(depth), out=new Type(width*height*4);
  for(const {image,mask,x,y,opacity,visible,blend} of layers.slice().reverse()){
    if (!visible || !opacity) continue;
    const {data,channels}=image;
    for(let row=0,p=0;row<image.height;row++) for(let col=0;col<image.width;col++,p++) {
      const source=p*channels, target=((y+row)*width+x+col)*4;
      const a=(channels===4 ? data[source+3]/max : 1)*opacity/255*(mask?mask.data[p]/max:1);
      const b=out[target+3]/max, alpha=a+b*(1-a);
      if(!a)continue;
      for(let c=0;c<3;c++){
        const s=data[source+c]/max, d=out[target+c]/max;
        const blended=(1-b)*s+b*mix(blend,d,s);
        out[target+c]=Math.round(max*(a*blended+b*(1-a)*d)/alpha);
      }
      out[target+3]=Math.round(alpha*max);
    }
  }
  return {width,height,channels:4,data:out};
}

function write({width,height,layers,masks={},composite,profile}, {bitDepth=8,compression='zip'}={}) {
  if (![8,16].includes(bitDepth)||!['none','zip'].includes(compression)||!Array.isArray(layers)||
      !C.uint(layers.length,1,128)||!C.record(masks)||Object.keys(masks).length>52)
    throw new TypeError('PSD needs 1 to 128 raster layers, up to 52 masks, and 8- or 16-bit samples');
  const {bytes:icc,chromaticities,gamma,srgb}=C.profile(profile);
  C.profileMode(icc,3);
  if(chromaticities!==undefined||gamma!==undefined||srgb!==undefined)
    throw new TypeError('PSD texture profiles use embedded ICC bytes');
  const named=Object.entries(masks), channels=4+named.length, max=sampleMax(bitDepth);
  C.extent(width,height,channels*bitDepth/8);
  let bytes=width*height*channels*bitDepth/8;
  const stack=Array.from(layers,row=>{
    if(!C.fields(row,['name','image','mask','x','y','opacity','visible','blend']))
      throw new TypeError('Invalid PSD raster layer');
    const {name,x=0,y=0,opacity=1,visible=true,blend='normal'}=row;
    const image=layerImage(row.image,bitDepth,[3,4],'layer'), mask=row.mask===undefined?undefined:layerImage(row.mask,bitDepth,[1],'layer mask');
    if(!nameIsValid(name)||!C.uint(x,0,width-image.width)||!C.uint(y,0,height-image.height)||
        !Number.isFinite(opacity)||opacity<0||opacity>1||typeof visible!=='boolean'||!Object.hasOwn(blendKeys,blend)||
        mask&&(mask.width!==image.width||mask.height!==image.height))
      throw new TypeError('PSD layer needs a name, valid controls and an aligned mask within the canvas');
    bytes+=image.width*image.height*(mask?5:4)*bitDepth/8;
    if(bytes>C.maxBytes)throw new RangeError('PSD layers exceed their sample budget');
    return {name,image,mask,x,y,opacity:Math.round(opacity*255),visible,blend};
  });
  const masksOut=named.map(([name,row])=>{
    const image=layerImage(row,bitDepth,[1],'named mask');
    if(!nameIsValid(name)||image.width!==width||image.height!==height)
      throw new TypeError('PSD named masks need a name and the canvas extent');
    return {name,image};
  });
  const flattenedImage=composite===undefined?flattened(stack,width,height,bitDepth):layerImage(composite,bitDepth,[3,4],'composite');
  if(flattenedImage.width!==width||flattenedImage.height!==height)throw new TypeError('PSD composite must match its canvas');
  const {data:flat,channels:flatLanes}=flattenedImage;
  const alpha=p=>flatLanes===4?flat[p*flatLanes+3]:max;
  const full=width*height, planes=[];
  for(let c=0;c<3;c++) planes.push(rawPlane(full,bitDepth,p=>pale(flat[p*flatLanes+c],alpha(p),max)));
  planes.push(rawPlane(full,bitDepth,alpha));
  for(const {image} of masksOut) planes.push(rawPlane(full,bitDepth,p=>image.data[p]));

  const encode=data=>compression==='zip'?cat([u16(2),deflateSync(data)]):cat([u16(0),data]);
  const records=[], pixels=[];
  for(const {image,mask,name,x,y,opacity,visible,blend} of stack){
    const {width:w,height:h,channels:lanes,data}=image, count=w*h, bounds=rectangle(y,x,y+h,x+w);
    const ids=[-1,0,1,2,...(mask?[-2]:[])];
    const layersData=ids.map(id=>encode(rawPlane(count,bitDepth,p=>
      id===-2?mask.data[p]:id===-1?(lanes===4?data[p*lanes+3]:max):data[p*lanes+id])));
    const extra=cat([mask?section(cat([bounds,Buffer.from([0,0,0,0])])):zero,zero,pascal(name,4),tag('luni',unicode(name))]);
    records.push(cat([bounds,u16(ids.length),...ids.map((id,i)=>cat([i16(id),u32(layersData[i].length)])),
      text('8BIM'+blendKeys[blend]),Buffer.from([opacity,0,visible?0:2,0]),section(extra)]));
    pixels.push(...layersData);
  }
  const layerInfo=even(cat([i16(-stack.length),...records,...pixels]));
  const layerSection=bitDepth===16?cat([zero,zero,tag('Lr16',layerInfo,4),tag('Mt16',Buffer.alloc(0))]):
    cat([section(layerInfo),zero,tag('Mtrn',Buffer.alloc(0))]);
  const head=cat([text('8BPS'),u16(1),Buffer.alloc(6),u16(channels),u32(height),u32(width),u16(bitDepth),u16(3)]);
  const maskNames=['Transparency',...masksOut.map(row=>row.name)];
  const resources=cat([...(icc?[resource(1039,icc)]:[]),
    ...(masksOut.length?[resource(1006,cat(maskNames.map(name=>pascal(name)))),
      resource(1045,cat(maskNames.map(unicode)))]:[])]);
  const file=cat([head,zero,section(resources),section(layerSection),encode(cat(planes))]);
  if(file.length>C.maxBytes)throw new RangeError('PSD exceeds its file budget');
  return file;
}

class Reader {
  constructor(bytes) { this.bytes=bytes; this.at=0; }
  get end() { return this.at===this.bytes.length; }
  take(size) {
    const out=C.slice(this.bytes,this.at,size);
    this.at+=size;
    return out;
  }
  u8() { return this.take(1)[0]; }
  u16() { return this.take(2).readUInt16BE(); }
  i16() { return this.take(2).readInt16BE(); }
  u32() { return this.take(4).readUInt32BE(); }
  text(size) { return this.take(size).toString('ascii'); }
  block() { return new Reader(this.take(this.u32())); }
  bounds() { const b=this.take(16); return [0,4,8,12].map(o=>b.readInt32BE(o)); }
  pascal(align=1) {
    const n=this.u8(), name=this.take(n).toString('latin1');
    this.take(Math.ceil((n+1)/align)*align-(n+1));
    return name;
  }
  unicode() {
    const count=this.u32();
    if(count>1024)throw new RangeError('PSD name exceeds its budget');
    return Buffer.from(this.take(count*2)).swap16().toString('utf16le').replace(/\0$/,'');
  }
}

function raw(source,bytes) {
  const reader=new Reader(source), compression=reader.u16(), payload=reader.take(reader.bytes.length-reader.at);
  if(compression===2)return C.inflate(payload,bytes);
  if(compression!==0||payload.length!==bytes)throw new TypeError('Expected raw or ZIP PSD pixel data of the declared size');
  return payload;
}
function samples(bytes,depth,count) {
  const Type=C.sampleType(depth);
  return depth===8?new Uint8Array(bytes):Type.from({length:count},(_,i)=>bytes.readUInt16BE(2*i));
}
function interleave(planes,depth,count,width,height) {
  const Type=C.sampleType(depth), data=new Type(count*planes.length);
  for(let p=0;p<count;p++) for(let c=0;c<planes.length;c++) data[p*planes.length+c]=planes[c][p];
  return {width,height,channels:planes.length,data};
}
function extraTags(reader, callback, alignment=1) {
  while(reader.bytes.length-reader.at>=12){
    if(reader.text(4)!=='8BIM')throw new TypeError('Invalid PSD layer tag');
    const key=reader.text(4), size=reader.u32(), data=reader.take(size);
    reader.take((alignment-size%alignment)%alignment);
    callback(key,new Reader(data));
  }
  if(reader.take(reader.bytes.length-reader.at).some(Boolean))throw new TypeError('Incomplete PSD layer tag');
}
function read(file) {
  const source=new Reader(C.input(file));
  if(source.text(4)!=='8BPS'||source.u16()!==1||source.take(6).some(Boolean))
    throw new TypeError('Expected a version 1 Photoshop texture document');
  const channels=source.u16(), height=source.u32(),width=source.u32(),bitDepth=source.u16(),mode=source.u16();
  if(mode!==3||![8,16].includes(bitDepth)||!C.uint(channels,3,56))throw new TypeError('Expected an RGB 8- or 16-bit PSD');
  const bps=bitDepth/8, count=width*height;
  C.extent(width,height,channels*bps);
  if(!source.block().end)throw new TypeError('RGB PSD color mode data must be empty');
  const resources=source.block(),profile={};
  let alphaNames, legacyNames;
  while(!resources.end) {
    if(resources.text(4)!=='8BIM')throw new TypeError('Invalid PSD image resource');
    const id=resources.u16();
    resources.pascal(2);
    const block=resources.block();
    if(block.bytes.length%2)resources.take(1);
    if(id===1039) profile.icc=C.profileMode(C.icc(block.bytes),3).toString('base64');
    if(id===1045) {alphaNames=[];while(!block.end&&alphaNames.length<=56)alphaNames.push(block.unicode());}
    if(id===1006) {legacyNames=[];while(!block.end&&legacyNames.length<=56)legacyNames.push(block.pascal());}
  }
  const layersAndMask=source.block();
  let layersBlock=layersAndMask.block(), taggedTransparency=false;
  layersAndMask.block();
  extraTags(layersAndMask,(key,tagged)=>{
    if(key==='Lr16'&&bitDepth===16)layersBlock=tagged;
    if(key==='Mtrn'||key==='Mt16')taggedTransparency=true;
  },4);
  const signed=layersBlock.i16(), layerCount=Math.abs(signed);
  if(!C.uint(layerCount,1,128))throw new RangeError('PSD needs a bounded raster layer stack');
  const hasTransparency=signed<0||taggedTransparency;
  const compositeLanes=hasTransparency?4:3;
  if(channels<compositeLanes)throw new TypeError('PSD merged alpha has no samples');
  let budget=count*channels*bps;
  const records=[];
  for(let i=0;i<layerCount;i++){
    const [y,x,bottom,right]=layersBlock.bounds(), w=right-x,h=bottom-y,n=layersBlock.u16();
    if(!C.uint(x,0,width-w)||!C.uint(y,0,height-h)||!C.uint(n,3,5))
      throw new RangeError('PSD layer extent exceeds its canvas');
    C.extent(w,h,n*bps);
    if((budget+=w*h*n*bps)>C.maxBytes)throw new RangeError('PSD layer data exceeds its sample budget');
    const channelLayout=Array.from({length:n},()=>({id:layersBlock.i16(),bytes:layersBlock.u32()}));
    if(new Set(channelLayout.map(row=>row.id)).size!==n||channelLayout.some(row=>![-2,-1,0,1,2].includes(row.id)))
      throw new TypeError('Unsupported PSD layer channels');
    if(layersBlock.text(4)!=='8BIM')throw new TypeError('Invalid PSD blend signature');
    const blend=keyBlends.get(layersBlock.text(4)), opacity=layersBlock.u8()/255, clip=layersBlock.u8();
    const visible=!(layersBlock.u8()&2);
    layersBlock.u8();
    if(!blend||clip)throw new TypeError('Unsupported PSD layer blending');
    const extra=layersBlock.block(), mask=extra.block();
    if(!mask.end&&(mask.bytes.length!==20||mask.bounds().some((n,i)=>n!==[y,x,bottom,right][i])))
      throw new TypeError('PSD layer mask must match the layer extent');
    extra.block();
    let name=extra.pascal(4);
    extraTags(extra,(key,tagged)=>{if(key==='luni')name=tagged.unicode();});
    records.push({name,x,y,width:w,height:h,opacity,visible,blend,channelLayout});
  }
  const layers=records.map(({channelLayout,width,height,...entry})=>{
    const n=width*height;
    const planes=new Map(channelLayout.map(({id,bytes})=>[id,samples(raw(layersBlock.take(bytes),n*bps),bitDepth,n)]));
    if([0,1,2].some(id=>!planes.has(id)))throw new TypeError('PSD layer lacks RGB planes');
    const alpha=planes.has(-1)?[planes.get(-1)]:[];
    const image=interleave([planes.get(0),planes.get(1),planes.get(2),...alpha],bitDepth,n,width,height);
    return {...entry,image,...(planes.has(-2)&&{mask:{width,height,channels:1,data:planes.get(-2)}})};
  });
  if(layersBlock.take(layersBlock.bytes.length-layersBlock.at).some(Boolean))throw new TypeError('Trailing PSD layer pixels');
  const merged=raw(source.take(source.bytes.length-source.at),count*channels*bps), planes=[];
  for(let c=0;c<channels;c++) planes.push(samples(C.slice(merged,c*count*bps,count*bps),bitDepth,count));
  const max=sampleMax(bitDepth);
  if(hasTransparency) for(let p=0;p<count;p++){
    const a=planes[3][p];
    for(let c=0;c<3;c++)planes[c][p]=a?Math.max(0,Math.min(max,Math.round((planes[c][p]+a-max)*max/a))):0;
  }
  const names=alphaNames??legacyNames??[], skip=hasTransparency&&names.length===channels-3?1:0;
  const namedMasks=Object.fromEntries(planes.slice(compositeLanes).map((data,i)=>[
    names[i+skip]||'Alpha '+(i+1), {width,height,channels:1,data}]));
  const composite=interleave(planes.slice(0,compositeLanes),bitDepth,count,width,height);
  return {width,height,bitDepth,alpha:hasTransparency?'straight':'none',profile,layers,masks:namedMasks,composite};
}

module.exports={read,write};
