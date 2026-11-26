const C = require('./texture-common.js');
const { cstring, int, float, attribute, zips, unzip } = require('./exr-bytes.js');

const magic=20000630, HALF=1, FLOAT=2;
const compressors={none:0,zips:2,zip:3}, linesPerBlock={0:1,2:1,3:16};
const validName=(name,limit=255)=>typeof name==='string' && name.length<=limit && /^[!-~]+$/.test(name);
const roundEven=n=>{
  const rounded=Math.floor(n), rest=n-rounded;
  return rounded+Number(rest>.5 || rest===.5 && rounded%2===1);
};
function half(value) {
  const magnitude=Math.abs(value), sign=value<0||Object.is(value,-0)?0x8000:0;
  if (magnitude>65504) throw new RangeError('Sample exceeds the OpenEXR half-float range');
  if(magnitude<2**-14) return sign+roundEven(magnitude*2**24);
  const e=Math.floor(Math.log2(magnitude));
  return sign+((e+14)<<10)+roundEven(magnitude*2**(10-e));
}
function fromHalf(bits) {
  const exp=(bits>>10)&31, fraction=bits&1023, sign=bits&0x8000?-1:1;
  return sign*(exp===0 ? fraction*2**-24 : exp===31 ? (fraction?NaN:Infinity) : (1+fraction/1024)*2**(exp-15));
}

function header(file) {
  const bytes=C.input(file), version=bytes.readUInt32LE(4);
  if (bytes.readInt32LE(0)!==magic || ![2,0x402].includes(version))
    throw new TypeError('Expected single-part flat scanline OpenEXR');
  const limit=version&0x400?255:31;
  let at=8;
  function word(source,offset) {
    const end=source.indexOf(0,offset);
    if(end<offset || end-offset>limit) throw new TypeError('Invalid OpenEXR name');
    const value=source.toString('latin1',offset,end);
    if(value && !validName(value,limit)) throw new TypeError('Invalid OpenEXR name');
    return [value,end+1];
  }
  const attrs=new Map();
  while(true) {
    const [name,next]=word(bytes,at); at=next;
    if(!name) break;
    const [type,body]=word(bytes,at), size=C.slice(bytes,body,4).readInt32LE();
    if(attrs.has(name)||attrs.size>=128||body+4+size>4*1024**2) throw new RangeError('OpenEXR metadata exceeds its budget');
    attrs.set(name,{type,data:C.slice(bytes,body+4,size)});
    at=body+4+size;
  }
  function get(name,type,length) {
    const row=attrs.get(name);
    if(!row || row.type!==type || length!==undefined && row.data.length!==length)
      throw new TypeError('Invalid OpenEXR attribute '+name);
    return row.data;
  }
  const box=get('dataWindow','box2i',16), window=Array.from({length:4},(_,i)=>box.readInt32LE(4*i));
  const [x,y,xmax,ymax]=window, width=xmax-x+1, height=ymax-y+1;
  const compression=get('compression','compression',1)[0], lines=linesPerBlock[compression];
  if(!lines) throw new TypeError('Texture OpenEXR supports uncompressed, ZIPS or ZIP scanlines');
  const order=get('lineOrder','lineOrder',1)[0];
  if(order>2) throw new TypeError('Invalid OpenEXR line order');
  const list=get('channels','chlist'), rows=[], names=new Set();
  let stride=0, p=0;
  for(;p<list.length;) {
    const [name,next]=word(list,p);p=next;
    if(!name) break;
    if(names.has(name)||names.size>=128) throw new RangeError('Invalid OpenEXR channel list');
    const row=C.slice(list,p,16), kind=row.readInt32LE(0), depth=kind===HALF?2:4;
    if(![0,HALF,FLOAT].includes(kind)||row.readInt32LE(8)!==1||row.readInt32LE(12)!==1)
      throw new TypeError('OpenEXR texture channels need supported sample types and full resolution');
    rows.push({name,kind,depth,offset:stride});
    names.add(name);
    stride+=depth;
    p+=16;
  }
  if(!rows.length||p!==list.length||list.at(-1)!==0) throw new TypeError('Missing complete OpenEXR channel list');
  C.extent(width,height,stride);
  const profile={};
  if(attrs.has('chromaticities')){
    const chroma=get('chromaticities','chromaticities',32);
    profile.chromaticities=Array.from({length:8},(_,i)=>chroma.readFloatLE(4*i));
    if (!profile.chromaticities.every(Number.isFinite)) throw new RangeError('OpenEXR chromaticities must be finite');
  }
  const association=attrs.has('inkAlphaAssociation')?get('inkAlphaAssociation','string').toString('ascii'):undefined;
  if(association!==undefined && !['none','straight','premultiplied'].includes(association))
    throw new TypeError('Invalid OpenEXR alpha association');
  const compare=(a,b)=>a.every((n,i)=>Math.abs(n-b[i])<1e-5);
  const colorSpace=profile.chromaticities && compare(profile.chromaticities,C.p3)?'display-p3-linear':'srgb-linear';
  const count=Math.ceil(height/lines), table=C.slice(bytes,at,count*8), minimum=at+count*8;
  const spans=[], blocks=[];
  for(let i=0;i<count;i++){
    const offset=Number(table.readBigUInt64LE(8*i));
    if(!C.uint(offset,minimum,bytes.length-8)) throw new RangeError('Invalid OpenEXR scanline offset');
    const index=bytes.readInt32LE(offset)-y, length=bytes.readInt32LE(offset+4);
    if(index!==i*lines) throw new TypeError('OpenEXR scanline table disagrees with its block');
    const packed=C.slice(bytes,offset+8,length), n=Math.min(lines,height-index), size=n*width*stride;
    if(!length||length>size||compression===0&&length!==size) throw new RangeError('Invalid OpenEXR scanline length');
    spans.push([offset,offset+8+length]);blocks.push({packed,n,index,size});
  }
  spans.sort((a,b)=>a[0]-b[0]);
  if(spans.some((row,i)=>i && row[0]<spans[i-1][1])) throw new RangeError('Overlapping OpenEXR scanline blocks');
  return { width,height,window,profile,association,colorSpace,rows,stride,blocks };
}

function selection(rows,names) {
  const list=new Map(rows.map(row=>[row.name,row]));
  const ordered=[['R','G','B'],['X','Y','Z'],['Y'],['U','V']];
  const standard=ordered.find(set=>set.every(name=>list.has(name)));
  const tail=standard?.[0]==='X'?'W':'A';
  const channels=names??(standard?[...standard,...(list.has(tail)?[tail]:[])]:rows.length===1?[rows[0].name]:null);
  if(!Array.isArray(channels)||![1,2,3,4].includes(channels.length)||!Array.from(channels).every(name=>list.has(name))||
      new Set(channels).size!==channels.length)
    throw new TypeError('Choose one to four existing EXR channels');
  const used=channels.map(name=>list.get(name));
  if(used.some(row=>row.kind===0)) throw new TypeError('Choose half or float OpenEXR texture channels');
  return used;
}
function read(file,{ layoutOnly=false,channels:names }={}) {
  const {width,height,window,profile,association,colorSpace,rows,stride,blocks}=header(file);
  const chosen=selection(rows,names), channels=chosen.length;
  const alpha=channels%2===0 && /(?:^|\.)A$/.test(chosen.at(-1).name)?
    (association==='straight'?'straight':'premultiplied'):'none';
  const bitDepth=chosen.some(row=>row.kind===FLOAT)?32:16;
  const info={width,height,channels,bitDepth,alpha,profile,colorSpace,window,
    names:chosen.map(row=>row.name),
    available:rows.map(row=>({name:row.name,storage:row.kind===HALF?'half':row.kind===FLOAT?'float':'uint'}))};
  if(layoutOnly) return info;
  C.extent(width,height,channels*4);
  const data=new Float32Array(width*height*channels);
  for(const {packed,n,index,size} of blocks){
    const raw=packed.length===size?packed:unzip(packed,size);
    for(let y=0;y<n;y++) for(const [lane,row] of chosen.entries()) {
      let at=(y*stride+row.offset)*width;
      let dest=((index+y)*width)*channels+lane;
      for(let x=0;x<width;x++,at+=row.depth,dest+=channels){
        const value=row.kind===HALF?fromHalf(raw.readUInt16LE(at)):raw.readFloatLE(at);
        if(!Number.isFinite(value)) throw new RangeError('OpenEXR texture contains nonfinite samples');
        data[dest]=value;
      }
    }
  }
  return { ...info,data };
}

function write({width,height,planes,alpha='none'}, {bitDepth=32,compression='zip',profile}={}) {
  if(![16,32].includes(bitDepth)||!Object.hasOwn(compressors,compression)||!C.record(planes))
    throw new TypeError('OpenEXR texture needs half or float named planes and none, zips or zip');
  const names=Object.keys(planes).sort(), samples=width*height, bps=bitDepth/8;
  if(!C.uint(names.length,1,128)||!names.every(name=>validName(name))||
      !names.every(name=>planes[name] instanceof Float32Array && planes[name].length===samples && planes[name].every(Number.isFinite)) ||
      !['none','straight','premultiplied'].includes(alpha) || Object.hasOwn(planes,'A')===(alpha==='none'))
    throw new TypeError('OpenEXR texture planes need aligned finite samples and a matching alpha convention');
  C.extent(width,height,names.length*bps);
  const {bytes:icc,name,gamma,srgb,chromaticities}=C.profile(profile);
  if(icc||name!==undefined||gamma!==undefined||srgb!==undefined)
    throw new TypeError('OpenEXR texture profiles use linear data and chromaticities');
  const compressionId=compressors[compression], lines=linesPerBlock[compressionId];
  const box=int(0,0,width-1,height-1), end=Buffer.from([0]), kind=bitDepth===16?HALF:FLOAT;
  const attrs=[
    attribute('channels','chlist',Buffer.concat([...names.map(name=>Buffer.concat([cstring(name),int(kind,0,1,1)])),end])),
    attribute('compression','compression',Buffer.from([compressionId])),
    attribute('dataWindow','box2i',box),attribute('displayWindow','box2i',box),
    attribute('lineOrder','lineOrder',end),attribute('pixelAspectRatio','float',float(1)),
    attribute('screenWindowCenter','v2f',float(0,0)),attribute('screenWindowWidth','float',float(1)),
    attribute('inkAlphaAssociation','string',Buffer.from(alpha))
  ];
  if(chromaticities) attrs.push(attribute('chromaticities','chromaticities',float(...chromaticities)));
  const head=Buffer.concat([int(magic,names.some(name=>name.length>31)?0x402:2),...attrs,end]);
  const table=Buffer.alloc(Math.ceil(height/lines)*8), blocks=[];
  let offset=head.length+table.length;
  for(let y=0;y<height;y+=lines) {
    const raw=Buffer.allocUnsafe(Math.min(lines,height-y)*width*names.length*bps);
    let at=0;
    for(let row=y;row<Math.min(y+lines,height);row++) for(const name of names) for(let x=0;x<width;x++){
      const sample=planes[name][row*width+x];
      if(bitDepth===16) raw.writeUInt16LE(half(sample),at);
      else raw.writeFloatLE(sample,at);
      at+=bps;
    }
    const packed=compressionId?zips(raw):raw;
    table.writeBigUInt64LE(BigInt(offset),blocks.length*4);
    blocks.push(int(y,packed.length),packed);
    offset+=8+packed.length;
  }
  if(offset>C.maxBytes) throw new RangeError('OpenEXR texture exceeds its file budget');
  return Buffer.concat([head,table,...blocks],offset);
}

module.exports = { read, write };
