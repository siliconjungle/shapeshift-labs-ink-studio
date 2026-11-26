const Grid=require('./uv-bake-grid.js');
const PNG=require('./texture-png.js');
const TIFF=require('./texture-tiff.js');
const EXR=require('./texture-exr.js');
const {srgb}=require('./texture-common.js');
const {readTexture}=require('./texture-files.js');

const fields=['width','height','format','precision','antialiasing','dilation','diffusion','gutters','mipmaps'];
const formats={png:['unorm8','unorm16'],tiff:['unorm8','unorm16','float32'],exr:['float16','float32']};
const extensions={png:'png',tiff:'tiff',exr:'exr'};
const transferMaps=['pigment','emission','opacity','roughness','metalness'];
const categories=new Set(['vertex-id','material-id','part-id','thickness-valid','cage-hit','cage-miss','cage-backface','uv-outline']);
const clamp=n=>Math.max(0,Math.min(1,n));
const integer=(n,lo,hi)=>Number.isInteger(n)&&n>=lo&&n<=hi;
const boundedPosition=map=>['position-object','position-world'].includes(map);
const legacyPrecision=encoding=>encoding==='exr'?'float32':encoding==='png16'?'unorm16':'unorm8';

function controls(map,base,opts) {
  if(!fields.some(key=>opts[key]!==undefined))return;
  const {width=base.size,height=base.size,format=base.encoding==='exr'?'exr':'png',
    precision=Object.hasOwn(formats,format)&&(formats[format].includes(legacyPrecision(base.encoding))?
      legacyPrecision(base.encoding):formats[format].at(-1)),
    antialiasing=1,gutters='copy',dilation=gutters==='empty'?0:base.padding,diffusion=0,mipmaps=0}=opts;
  if(!integer(width,8,1024)||!integer(height,8,1024)||!Object.hasOwn(formats,format)||!formats[format].includes(precision)||
    ![1,2,4].includes(antialiasing)||!integer(dilation,0,base.padding)||!integer(diffusion,0,16)||
    !['copy','transparent','empty'].includes(gutters)||gutters==='empty'&&(dilation||diffusion)||
    diffusion&&(!dilation||categories.has(map))||!(integer(mipmaps,0,10)||mipmaps==='full')||
    base.padding*2>=Math.min(width,height))
    throw new RangeError('Invalid bake dimensions, format, precision, supersampling, padding, gutter, diffusion or mip settings');
  if(map.endsWith('-id')&&precision!=='float32'||boundedPosition(map)&&!precision.startsWith('float'))
    throw new RangeError('Stable IDs need float32 and signed positions need a floating-point output');
  if(map==='uv-outline'&&(format!=='png'||precision!=='unorm8'||antialiasing!==1||mipmaps||diffusion))
    throw new RangeError('UV outlines use native PNG8 strokes and editable SVG paths');
  return {width,height,format,precision,antialiasing,padding:base.padding,dilation,diffusion,gutters,mipmaps,
    nativeNormalization:opts.normalization};
}

function sampling(task) {
  const {settings,map}=task,{delivery}=settings;
  if(!delivery)return task;
  const {width,height,antialiasing:n,precision,nativeNormalization}=delivery;
  const raw={...settings,grid:{width:width*n,height:height*n},padding:0};
  if(settings.encoding||settings.transfer||transferMaps.includes(map))raw.encoding='exr';
  if(transferMaps.includes(map)&&!raw.transfer)raw.transfer={alphaPolicy:'preserve'};
  if(precision.startsWith('float')&&nativeNormalization===undefined) {
    if(map==='height')raw.normalization='none';
    if(settings.curvature)raw.curvature={...settings.curvature,normalization:'none',range:undefined};
  }
  if(settings.curvature?.source==='normal'&&n>1)raw.curvature={...raw.curvature,scale:raw.curvature.scale*n};
  return {...task,settings:raw};
}

const linear=n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
const display=n=>n<=.0031308?n*12.92:1.055*n**(1/2.4)-.055;

function decode(bytes,output,map) {
  const image=readTexture(bytes), {data:source,width,height,channels,encoding}=image;
  const color=output?.intent==='color'||map==='uv-outline', normal=['normal','direction'].includes(output?.kind);
  const max=source instanceof Uint16Array?65535:source instanceof Uint8Array?255:1;
  const data=Float32Array.from(source,(n,i)=>{
    const value=n/max;
    if(normal&&max>1)return value*2-1;
    if(color&&i%channels<3&&encoding!=='exr')return linear(value);
    return value;
  });
  return {width,height,channels,data,color,normal,direction:output?.kind==='direction',
    categorical:categories.has(map),any:map==='thickness-valid',
    opacity:map==='opacity',coverageMap:map==='coverage',roughness:map==='roughness',sourceBitDepth:image.bitDepth};
}

function frame(width,height,channels,withValidity) {
  const count=width*height;
  return {width,height,owners:new Uint32Array(count), area:new Float32Array(count), footprint:new Float32Array(count),
    overlaps:new Uint8Array(count),data:new Float32Array(count*channels),valid:withValidity?new Uint8Array(count):undefined};
}

function reduce(source,width,height,semantic) {
  const {channels,color,normal,categorical,roughness}=semantic, result=frame(width,height,channels,source.valid);
  const {width:w,height:h}=source, value=new Float64Array(channels), chartWeights=new Map(), categories=new Map();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const x0=Math.floor(x*w/width),x1=Math.floor((x+1)*w/width),y0=Math.floor(y*h/height),y1=Math.floor((y+1)*h/height);
    const i=x+y*width, slots=(x1-x0)*(y1-y0);
    let union=0,owner=0,best=0;
    chartWeights.clear();
    for(let v=y0;v<y1;v++)for(let u=x0;u<x1;u++) {
      const q=u+v*w,id=source.owners[q], area=source.area[q];
      union+=source.footprint[q];
      result.overlaps[i]|=source.overlaps[q];
      if(id&&area)chartWeights.set(id,(chartWeights.get(id)??0)+area);
    }
    for(const [id,weight] of chartWeights)if(weight>best||weight===best&&id<owner) {
      best=weight;owner=id;
    }
    result.owners[i]=owner;
    result.area[i]=best/slots;
    result.footprint[i]=union/slots;
    if(!owner)continue;
    let total=0, visible=0;
    categories.clear();value.fill(0);
    for(let v=y0;v<y1;v++)for(let u=x0;u<x1;u++) {
      const q=u+v*w, from=q*channels, weight=source.area[q];
      if(!weight||source.owners[q]!==owner||source.valid&&!source.valid[q])continue;
      total+=weight;
      const opacity=color&&channels===4?source.data[from+3]:1;
      visible+=opacity*weight;
      if(categorical) {
        const key=source.data[from];
        const entry=categories.get(key);
        if(entry)entry.weight+=weight;else categories.set(key,{weight,from});
      }
      for(let c=0;c<channels;c++) {
        const input=source.data[from+c], w=color&&c<3?opacity*weight:weight;
        value[c]+=(roughness?input**2:input)*w;
      }
    }
    if(!total)continue;
    if(result.valid)result.valid[i]=1;
    const at=i*channels;
    if(categorical) {
      let bestWeight=-1,bestKey=Infinity;
      for(const [key,entry] of categories)if(semantic.any?key>result.data[at]:
        entry.weight>bestWeight||entry.weight===bestWeight&&key<bestKey) {
        bestWeight=entry.weight;bestKey=key;
        for(let c=0;c<channels;c++)result.data[at+c]=source.data[entry.from+c];
      }
    } else if(normal) {
      const length=Math.hypot(...value);
      for(let c=0;c<channels;c++)result.data[at+c]=length?value[c]/length:Number(!semantic.direction&&c===2);
    } else for(let c=0;c<channels;c++) {
      const denominator=color&&c<3?visible:total;
      const mean=denominator?value[c]/denominator:0;
      result.data[at+c]=roughness?Math.sqrt(mean):mean;
    }
  }
  return result;
}

function pad(source,delivery,semantic,level) {
  const {channels,opacity,color,normal}=semantic, {width}=source;
  const {padding,gutters}=delivery, {dilation=0,diffusion=0}=semantic.coverageMap?{}:delivery, frequency=2**level;
  const border=Math.ceil(padding/frequency), distance=Math.ceil(dilation/frequency);
  const result={...source,owners:source.owners.slice(),data:source.data.slice(),valid:source.valid?.slice()};
  const filled=Uint8Array.from(source.owners,owner=>Number(owner!==0)), covered=filled.slice();
  const clearLane=opacity?0:color&&channels===4?3:-1;
  Grid.gutters(covered,source,border,()=>true,(from,to,next,step)=>{
    if(covered[to])return;
    result.owners[to]=result.owners[from];
    covered[to]=1;next.push(to);
    if(step>distance||gutters==='empty')return;
    filled[to]=1;
    if(result.valid)result.valid[to]=result.valid[from];
    for(let c=0;c<channels;c++)result.data[to*channels+c]=gutters==='transparent'&&c===clearLane?0:result.data[from*channels+c];
  });
  const ring=[];
  if(diffusion)for(let i=0;i<filled.length;i++)if(filled[i]&&!source.area[i])ring.push(i);
  let buffer=ring.length?result.data.slice():null;
  for(let pass=0;pass<diffusion&&ring.length;pass++) {
    for(const i of ring) {
      const at=i*channels;
      if(result.valid&&!result.valid[i])continue;
      let weight=2;
      for(let c=0;c<channels;c++)buffer[at+c]=result.data[at+c]*weight;
      Grid.neighbors(i,width,filled.length,n=>{
        if(!filled[n]||result.owners[i]!==result.owners[n]||result.valid&&!result.valid[n])return;
        weight++;
        for(let c=0;c<channels;c++)buffer[at+c]+=result.data[n*channels+c];
      });
      const length=normal?Math.hypot(...buffer.subarray(at,at+channels)):weight;
      for(let c=0;c<channels;c++)buffer[at+c]=gutters==='transparent'&&c===clearLane?0:
        length?buffer[at+c]/length:Number(!semantic.direction&&c===2);
    }
    [buffer,result.data]=[result.data,buffer];
  }
  return {...result,filled};
}

function encode(raster,semantic,delivery,range,weightedAlpha) {
  const {width,height,filled,area,footprint,data}=raster, {channels,color,normal,opacity,coverageMap}=semantic;
  const {format,precision}=delivery, bitDepth=Number(precision.match(/\d+$/)[0]), floating=precision.startsWith('float');
  const alpha=channels===4&&color?'straight':'none';
  const scalar=(i,c)=>{
    if(coverageMap)return footprint[i];
    if(!filled[i])return normal&&!semantic.direction&&c===2?1:0;
    const value=data[i*channels+c];
    if((opacity||alpha==='straight'&&c===3)&&weightedAlpha&&area[i])return value*area[i];
    if(!floating&&range)return (value-range[0])/(range[1]-range[0]);
    return value;
  };
  function pack(displaying=false) {
    const imageType=displaying||bitDepth===8?Uint8Array:floating?Float32Array:Uint16Array;
    const max=imageType===Uint8Array?255:imageType===Uint16Array?65535:1;
    return imageType.from(data,(_n,k)=>{
      const i=Math.floor(k/channels),c=k%channels;
      let value=scalar(i,c);
      if(max!==1) {
        if(!filled[i]&&!coverageMap&&!normal)return 0;
        if(displaying&&floating&&range&&filled[i])value=(value-range[0])/(range[1]-range[0]);
        if(normal)value=.5+.5*value;
        if(color&&c<3)value=display(value);
        return Math.round(clamp(value)*max);
      }
      return value;
    });
  }
  const metadata={width,height,channels,alpha};
  function png(preview) {
    if(preview&&semantic.id) {
      const rgba=new Uint8Array(area.length*4);
      for(let i=0;i<area.length;i++)if(filled[i]) {
        const code=Math.imul(data[i],0x9e3759)&0xffffff;
        rgba.set([code>>>16,(code>>>8)&255,code&255,255],i*4);
      }
      return PNG.write({width,height,channels:4,alpha:'straight',data:rgba},{srgb:0});
    }
    return PNG.write({...metadata,data:pack(preview)},color?{srgb:0}:undefined);
  }
  if(format==='png')return {bytes:png(false),bitDepth};
  if(format==='tiff')return {bytes:TIFF.write({...metadata,data:pack()},color?{chromaticities:srgb}:undefined),
    preview:png(true),bitDepth};
  const names=channels===1?['Y']:normal||semantic.vector?['X','Y','Z']:['R','G','B','A'].slice(0,channels);
  const planes=Object.fromEntries(names.map((name,c)=>[name,Float32Array.from(area,(_n,i)=>scalar(i,c))]));
  return {bytes:EXR.write({width,height,planes,alpha},{bitDepth}),preview:png(true),bitDepth};
}

function finalize(task,native,ownership) {
  const {map,settings:{delivery}}=task, semantic=decode(native.bytes,native.output,map);
  if(native.output?.kind==='position')semantic.vector=true;
  if(native.output?.kind==='id')semantic.id=true;
  const invalid=native.validity?Uint8Array.from(readTexture(native.validity).data,Boolean):undefined;
  const area=Float32Array.from(ownership.owners,id=>Number(id!==0));
  const high={...semantic,...ownership,area,footprint:area,valid:invalid};
  const {width,height,antialiasing,mipmaps,format,precision}=delivery;
  let current=antialiasing===1?high:reduce(high,width,height,semantic);
  const requested=mipmaps==='full'?10:mipmaps, float=precision.startsWith('float');
  const output=native.output??{kind:'bake-map',intent:semantic.color?'color':'mask'};
  const previewRange=output.displayRange??output.previewRange??null;
  const numericRange=!output.range&&['height','curvature','thickness'].includes(output.kind)?previewRange:null;
  const range=semantic.normal?null:numericRange;
  const levels=[];
  let debug;
  for(let level=0;;level++) {
    const image=pad(current,delivery,semantic,level);
    if(!level)debug=image;
    const result=map==='uv-outline'?{bytes:native.bytes,bitDepth:8}:
      encode(image,semantic,delivery,range,antialiasing>1||level>0);
    const validity=image.valid&&PNG.write({width:image.width,height:image.height,channels:1,alpha:'none',
      data:Uint8Array.from(image.valid,v=>v*255)});
    levels.push({level,width:image.width,height:image.height,...result,...(validity&&{validity})});
    if(level>=requested||current.width===1&&current.height===1)break;
    current=reduce(current,Math.max(1,Math.floor(current.width/2)),Math.max(1,Math.floor(current.height/2)),semantic);
  }
  const [base,...mips]=levels, texels=debug.footprint.reduce((n,v)=>n+Number(v>0),0);
  return {...native,...base,validity:base.validity,mips,debug,
    output:{...output,encoding:format==='png'?'png'+base.bitDepth:format,bitDepth:base.bitDepth,
      ...(semantic.normal&&{domain:float?'signed-unit':'unit'}),
      ...(semantic.color&&{colorSpace:float?'srgb-linear':'srgb'}),
      ...(!float&&range&&{range})},
    sampling:{sourceBitDepth:semantic.sourceBitDepth,width:semantic.width,height:semantic.height},
    texels,coverage:debug.footprint.reduce((n,v)=>n+v,0)/(width*height)};
}

module.exports={fields,formats,extensions,controls,sampling,finalize};
