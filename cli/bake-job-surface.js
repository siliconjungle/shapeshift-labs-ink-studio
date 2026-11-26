const PNG = require('./png.js');
const TexturePNG = require('./texture-png.js');
const EXR = require('./texture-exr.js');

const normalMaps = ['normal','world-normal'];
const encodings = ['png8','png16','exr'];
const normalizations = ['symmetric','minmax','manual','none'];
const clamp = n => Math.min(1, Math.max(0, n));
const maxCode = encoding => encoding === 'png16' ? 65535 : 255;
const ext = encoding => encoding === 'exr' ? 'exr' : 'png';
const depth = encoding => encoding === 'exr' ? 32 : encoding === 'png16' ? 16 : 8;
const finiteFloat = n => Number.isFinite(n) && Number.isFinite(Math.fround(n));
const validRange = range => Array.isArray(range) && range.length === 2 && Array.from(range).every(finiteFloat) &&
  range[0] <= 0 && range[1] >= 0 && range[1] > range[0];

function settings(id, options) {
  if (normalMaps.includes(id)) {
    const { space = id === 'world-normal' ? 'world' : 'tangent', orientation, encoding = id === 'world-normal' ? 'png16' : 'png8' } = options;
    if (!['world','tangent'].includes(space) || (space === 'world' && orientation !== undefined) ||
        !encodings.includes(encoding)) throw new RangeError('Select a normal space and encoding. Y orientation applies to tangent normals.');
    return {space,encoding,...(space === 'tangent' && {orientation:orientation??'opengl'})};
  }
  if (id === 'height') {
    const {encoding='png16', normalization=encoding === 'exr' ? 'none' : 'symmetric', range} = options;
    if (!encodings.includes(encoding) || !normalizations.includes(normalization) ||
        (normalization === 'manual' ? !validRange(range) : range !== undefined) ||
        (normalization === 'none' && encoding !== 'exr'))
      throw new RangeError('Height needs a signed manual range, an automatic range, or unnormalized OpenEXR.');
    return {encoding,normalization,...(range && {range:range.slice()})};
  }
  return {};
}

function writePng(data, size, channels, encoding) {
  if (encoding === 'png8') return channels === 1 ? PNG.encodeGray(size,size,data) : PNG.encode(size,size,data);
  return TexturePNG.write({width:size,height:size,channels,data,alpha:'none'});
}
const writeExr = (size,planes) => EXR.write({ width:size, height:size, planes });

function vector(size,encoding,values) {
  const count=size*size;
  function unsigned(encoding) {
    const Data=encoding==='png16'?Uint16Array:Uint8Array, max=maxCode(encoding);
    return Data.from({length:count*3},(_,i)=>Math.round(clamp(.5+.5*values(Math.floor(i/3),i%3))*max));
  }
  if (encoding !== 'exr') return {bytes:writePng(unsigned(encoding),size,3,encoding)};
  const planes=Object.fromEntries(['X','Y','Z'].map((name,c)=>[name,Float32Array.from({length:count},(_,p)=>values(p,c))]));
  return {bytes:writeExr(size,planes),preview:writePng(unsigned('png8'),size,3,'png8')};
}

function scalar(size,encoding,data,display=data) {
  function unsigned(encoding,values) {
    const Data=encoding==='png16'?Uint16Array:Uint8Array,max=maxCode(encoding);
    return writePng(Data.from(values,n=>Math.round(clamp(n)*max)),size,1,encoding);
  }
  return encoding==='exr'?{bytes:writeExr(size,{Y:data}),preview:unsigned('png8',display)}:{bytes:unsigned(encoding,data)};
}

function normal(result, {size,space,orientation,encoding}) {
  const {raster,textures}=result;
  const layout={kind:'normal',space,encoding,domain:encoding === 'exr'?'signed-unit':'unit',
    bitDepth:depth(encoding),...(orientation&&{orientation})};
  if (space === 'tangent' && encoding === 'png8') {
    if (orientation !== 'directx') return {bytes:textures.normal,output:layout};
    const data=raster.pixels.normal.slice();
    for (let i=0;i<data.length;i+=3) if(data[i]||data[i+1]||data[i+2]) data[i+1]=255-data[i+1];
    return {bytes:PNG.encode(size,size,data),output:layout};
  }
  const vectors=raster.samples[space];
  const flip=orientation === 'directx' ? -1 : 1;
  const values=(p,c)=>raster.owners[p] ? vectors[p*3+c] * (c === 1 ? flip : 1) : Number(c === 2);
  return {...vector(size,encoding,values),output:layout};
}

function measureHeight(result) {
  const { height:data, heightValid:valid } = result.raster.samples;
  let min=Infinity,max=-Infinity,samples=0;
  for (let i=0;i<data.length;i++) if(valid[i]) {
    min=Math.min(min,data[i]);max=Math.max(max,data[i]);samples++;
  }
  return {data,valid,measured:samples?{min,max,samples}:null};
}

function heightScale(rows, { normalization, range }) {
  let min=Infinity,max=-Infinity,samples=0;
  for (const {measured} of rows) if(measured) {
    min=Math.min(min,measured.min);max=Math.max(max,measured.max);samples+=measured.samples;
  }
  const magnitude=samples ? Math.max(Math.abs(min),Math.abs(max)) : 0;
  const fit=magnitude ? (normalization==='minmax'?[Math.min(0,min),Math.max(0,max)]:[-magnitude,magnitude]) : [-1,1];
  return {range:normalization==='none'?null:range??fit, displayRange:range??fit,
    measured:samples?{min,max,samples}:null};
}

function height(row, scale, { size, encoding, normalization }) {
  const {data,valid,measured}=row, {range,displayRange}=scale;
  const [low,high]=displayRange, factor=1/(high-low), unit=n=>clamp((n-low)*factor);
  function unsigned(encoding) {
    const Data=encoding==='png16'?Uint16Array:Uint8Array, max=maxCode(encoding);
    return Data.from(data,n=>Math.round(unit(n)*max));
  }
  let clippedLow=0,clippedHigh=0;
  const minimum=Math.fround(low), maximum=Math.fround(high);
  if (range) for (let i=0;i<data.length;i++) if(valid[i]) {
    clippedLow+=Number(data[i]<minimum);
    clippedHigh+=Number(data[i]>maximum);
  }
  const output={kind:'height',encoding,normalization,range,displayRange,
    bitDepth:encoding==='exr'?32:encoding==='png16'?16:8, units:'shape-units',
    measured, targetMeasured:scale.measured, clippedLow,clippedHigh};
  if (encoding!=='exr') return {bytes:writePng(unsigned(encoding),size,1,encoding),output};
  const plane=range?Float32Array.from(data,unit):data;
  return {bytes:writeExr(size,{Y:plane}),preview:writePng(unsigned('png8'),size,1,'png8'),output};
}

module.exports={normalMaps,encodings,settings,normal,measureHeight,heightScale,height,ext,depth,vector,scalar};
