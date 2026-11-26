/* Single-part deep scanline OpenEXR v2, written directly from Ink's native fragments.
   https://openexr.com/en/latest/OpenEXRFileLayout.html */
const fs = require('node:fs');
const path = require('node:path');
const { cstring, int, float, attribute, zips } = require('./exr-bytes.js');
const { write, json } = require('./asset-files.js');
const { stride, idStride, kinds, maxLayers, maxSlots } = require('./deep-composite.js').layout;
const { render } = require('./render.js');
const toLinear = require('../src/color-space.js').prepare('srgb', 'srgb-linear');

const maxDimension = 16_384;
const FLOAT = 2, UINT = 0, magic = 20000630, deepVersion = 0x802;
const colors = ['R', 'G', 'B'];
const labelChannels = ['ink.kind', 'ink.splatId', 'ink.objectId', 'ink.materialId'];
const sampleChannels = ['surface', 'scatter', 'transmission'].map(layer => colors.map(c => 'ink.' + layer + '.' + c));
const channels = ['A', ...colors, 'Z', 'ZBack', 'ink.visibleCoverage', ...sampleChannels.flat(), ...labelChannels].sort();
const positions = Object.fromEntries(channels.map((name, index) => [name,index]));
const end = Buffer.from([0]);
const text = value => Buffer.from(value);
const byte = value => Buffer.from([value]);

function dimensions(source) {
  const { w, h, layers, count, colors:surface, ids } = source ?? {};
  if (![w,h,layers].every(n=>Number.isSafeInteger(n)&&n>0) || w>maxDimension || h>maxDimension ||
      layers>maxLayers || w*h*layers>maxSlots ||
      !(count instanceof Uint32Array) || count.length!==w*h || !(surface instanceof Float32Array) ||
      surface.length!==w*h*layers*stride || !(ids instanceof Uint32Array) || ids.length!==w*h*layers*idStride)
    throw new TypeError('Deep OpenEXR needs an Ink deep frame at its native art size');
}

function inventory(source) {
  let maxSamples = 0, retainedSamples = 0, droppedSamples = 0, truncatedPixels = 0;
  for (const count of source.count) {
    const kept = Math.min(count,source.layers);
    maxSamples = Math.max(kept,maxSamples);
    retainedSamples += kept;
    if (count<=kept) continue;
    truncatedPixels++;
    droppedSamples += count-kept;
  }
  return { width:source.w,height:source.h,layers:source.layers,maxSamples,retainedSamples,truncatedPixels,droppedSamples };
}

function matrices(camera,width,height) {
  const { view, ortho, focal } = camera, worldToCamera = [], worldToNDC = [];
  // Ink uses a negative view Z. OpenEXR uses positive Z along the camera ray.
  // Imath applies its matrices to row vectors, so each Ink column is one row.
  for (let i=0;i<16;i+=4) {
    const x=view[i], y=view[i+1], z=-view[i+2], w=view[i+3], divide=ortho ? w : z;
    worldToCamera.push(x,y,z,w);
    worldToNDC.push(focal*x/width+.5*divide,-focal*y/height+.5*divide,z,divide);
  }
  return [attribute('worldToCamera','m44f',float(...worldToCamera)),attribute('worldToNDC','m44f',float(...worldToNDC)),
    attribute('inkCameraSetback','float',float(camera.setback))];
}

function header(source, statistics, { reflection, time }, tidy) {
  const { w,h } = source;
  const list = channels.map(name=>Buffer.concat([cstring(name),int(labelChannels.includes(name)?UINT:FLOAT),
    Buffer.from([1,0,0,0]),int(1,1)]));
  const box = int(0,0,w-1,h-1), view = reflection ? 'reflection:' + reflection : 'camera';
  return Buffer.concat([
    int(magic,deepVersion),
    attribute('channels','chlist',Buffer.concat([...list,end])),
    attribute('compression','compression',byte(2)),
    attribute('dataWindow','box2i',box),
    attribute('displayWindow','box2i',box),
    attribute('lineOrder','lineOrder',byte(0)),
    attribute('pixelAspectRatio','float',float(1)),
    attribute('screenWindowCenter','v2f',float(0,0)),
    attribute('screenWindowWidth','float',float(1)),
    attribute('type','string',text('deepscanline')),
    attribute('name','string',text(view)),
    attribute('version','int',int(1)),
    attribute('chunkCount','int',int(h)),
    attribute('maxSamplesPerPixel','int',int(statistics.maxSamples)),
    attribute('inkSampleOrder','string',text(tidy?'sorted, non-overlapping':'sorted')),
    attribute('chromaticities','chromaticities',float(.64,.33,.30,.60,.15,.06,.3127,.3290)),
    attribute('inkColorEncoding','string',text('premultiplied linear sRGB')),
    attribute('inkDepthSpace','string',text('positive camera-axis depth in Ink world units')),
    attribute('inkStats','string',text(JSON.stringify(statistics))),
    attribute('inkIds','string',text(JSON.stringify({objects:source.objects,materials:source.materials,kinds}))),
    ...(source.camera ? matrices(source.camera,w,h) : []),
    ...(time!==undefined ? [attribute('inkTimeSeconds','double',double(time))] : []),
    end
  ]);
}

function double(value) {
  const out = Buffer.allocUnsafe(8);
  out.writeDoubleLE(value);
  return out;
}

function scanline(source, y) {
  const { w, layers, count, colors:surface, ids } = source;
  const first = y*w, offsets = Buffer.allocUnsafe(w*4);
  let samples = 0, tidy = true;
  for (let x=0;x<w;x++) {
    samples += Math.min(count[first+x],layers);
    offsets.writeInt32LE(samples,x*4);
  }
  const data = Buffer.allocUnsafe(samples*channels.length*4);
  const order = [], encoded = [0,0,0], linear = [0,0,0];
  let slot = 0;
  const position = name => (positions[name]*samples+slot)*4;
  for (let x=0;x<w;x++) {
    const pixel = first+x, n = Math.min(count[pixel],layers);
    order.length = n;
    for (let k=0;k<n;k++) order[k] = stride*(pixel*layers+k);
    // Preserve the capture's front-to-back tie order at identical axial depths.
    order.sort((a,b)=>surface[a]-surface[b]);
    let visibility = 1, previous = -Infinity;
    for (const at of order) {
      const z = surface[at], coverage = surface[at+1];
      if (!Number.isFinite(z) || z<0 || !Number.isFinite(coverage))
        throw new RangeError('Invalid deep sample at ('+x+', '+y+')');
      const a = Math.max(0,Math.min(1,coverage));
      tidy &&= z!==previous;
      previous = z;
      data.writeFloatLE(a,position('A'));
      data.writeFloatLE(z,position('Z'));
      data.writeFloatLE(z,position('ZBack'));
      data.writeFloatLE(a*visibility,position('ink.visibleCoverage'));
      visibility *= 1-a;
      for (let c=0;c<3;c++) {
        const base = surface[at+2+c], scatter = surface[at+5+c], transmission = surface[at+8+c];
        encoded[c] = scatter + transmission*base;
        data.writeFloatLE(base,position(sampleChannels[0][c]));
        data.writeFloatLE(scatter,position(sampleChannels[1][c]));
        data.writeFloatLE(transmission,position(sampleChannels[2][c]));
      }
      toLinear(encoded,linear);
      for (let c=0;c<3;c++) data.writeFloatLE(linear[c]*a,position(colors[c]));
      const tag = at/stride*idStride;
      for (let f=0;f<idStride;f++) data.writeUInt32LE(ids[tag+f],position(labelChannels[f]));
      slot++;
    }
  }
  const packedOffsets = zips(offsets), packedSamples = zips(data), info = Buffer.allocUnsafe(28);
  info.writeInt32LE(y,0);
  info.writeBigUInt64LE(BigInt(packedOffsets.length),4);
  info.writeBigUInt64LE(BigInt(packedSamples.length),12);
  info.writeBigUInt64LE(BigInt(data.length),20);
  return { bytes:Buffer.concat([info,packedOffsets,packedSamples]),tidy };
}

function encode(frame, { reflection, allowTruncated = false, time } = {}) {
  if ((reflection!==undefined && (typeof reflection!=='string'||!reflection.trim())) ||
      typeof allowTruncated!=='boolean' || (time!==undefined && !Number.isFinite(time)))
    throw new TypeError('Invalid deep OpenEXR options');
  const source = reflection===undefined ? frame?.deep : frame?.deep?.reflections?.[reflection]?.frame;
  if (reflection!==undefined && !source) throw new RangeError('Deep capture has no reflection named '+reflection);
  dimensions(source);
  const statistics = inventory(source);
  if (statistics.truncatedPixels && !allowTruncated)
    throw new RangeError('Deep OpenEXR capture dropped '+statistics.droppedSamples+' samples across '+
      statistics.truncatedPixels+' pixels. Increase layers or explicitly allow truncation.');
  const rows = Array.from({length:source.h},(_,y)=>scanline(source,y));
  const fileHeader = header(source,statistics,{reflection,time},rows.every(row=>row.tidy));
  const offsets = Buffer.allocUnsafe(source.h*8);
  let cursor = fileHeader.length+offsets.length;
  for (const [y,{bytes}] of rows.entries()) {
    offsets.writeBigUInt64LE(BigInt(cursor),y*8);
    cursor += bytes.length;
  }
  return { bytes:Buffer.concat([fileHeader,offsets,...rows.map(row=>row.bytes)],cursor),statistics };
}

function encodeDeepEXR(frame, options) {
  return encode(frame,options).bytes;
}

function exportDeepEXR(world, { out, view = {}, times = [view.time ?? view.t ?? world?.lookSnapshot?.time ?? 0],
  layers, reflection, allowTruncated = false, coalesce = true, pose } = {}) {
  if (typeof out!=='string'||!out.trim()) throw new TypeError('Deep OpenEXR export needs an output file or directory');
  if (!Array.isArray(times)||!times.length||times.length>512||
      !Array.from(times).every((t,i)=>Number.isFinite(t)&&t>=0&&(!i||t>=times[i-1])))
    throw new RangeError('Deep OpenEXR needs 1–512 finite nonnegative times in playback order');
  const width = view.w ?? view.width ?? 256, height = view.h ?? view.height ?? 144;
  const px = view.px ?? 1;
  const native = [width,height,px].every(n=>Number.isSafeInteger(n)&&n>0);
  if (!native) throw new RangeError('Deep OpenEXR requires positive integer image dimensions and art pixel size');
  const nativeWidth=Math.ceil(width/px), nativeHeight=Math.ceil(height/px);
  const area = nativeWidth*nativeHeight;
  // A reflected export retains both the main and mirrored capture.
  const captureArea = area*(reflection===undefined ? 1 : 2);
  const limit = layers ?? Math.min(maxLayers,Math.max(1,Math.floor(maxSlots/captureArea)));
  if (nativeWidth>maxDimension || nativeHeight>maxDimension || area*limit>maxSlots)
    throw new RangeError('Deep OpenEXR exceeds the native art-grid capture budget. Reduce dimensions or layers.');
  const file = path.resolve(out), single = /\.exr$/i.test(file);
  if (single && times.length!==1) throw new RangeError('A deep OpenEXR sequence needs an output directory');
  function draw(time) {
    pose?.(world,time);
    const frame = render(world,{...view,w:width,h:height,px,time,t:time,raw:true,transparent:true,
      shutter:false,composite:false,renderGrid:false,inspection:false,renderGraph:false,
      fragmentBudget:view.fragmentBudget??maxSlots,deepComposite:{layers:limit,coalesce,
        reflections:reflection===undefined?[]:[reflection]}});
    return encode(frame,{reflection,allowTruncated,time});
  }
  if (single) {
    const {bytes,statistics} = draw(times[0]);
    write(file,bytes);
    return { file, frames:[{file,time:times[0],...statistics}] };
  }
  fs.mkdirSync(file,{recursive:true});
  const take = fs.mkdtempSync(path.join(file,'take-')), frames = [];
  try {
    for (const [i,time] of times.entries()) {
      const {bytes,statistics} = draw(time);
      const name = 'frame-'+String(i).padStart(6,'0')+'.exr';
      write(path.join(take,name),bytes);
      frames.push({file:path.basename(take)+'/'+name,time,...statistics});
    }
    const manifest = path.join(file,'deep.json');
    json(manifest,{format:'ink-studio/deep-openexr',version:1,view:reflection ? 'reflection:'+reflection : 'camera',frames});
    return { file:manifest,frames };
  } catch (error) {
    fs.rmSync(take,{force:true,recursive:true});
    throw error;
  }
}

module.exports = { encodeDeepEXR, exportDeepEXR };
