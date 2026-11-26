/* Single-part deep scanline OpenEXR v2, written directly from Ink's native fragments.
   https://openexr.com/en/latest/OpenEXRFileLayout.html */
const fs = require('node:fs');
const path = require('node:path');
const { cstring, int, float, attribute, zips, unzip, readHeader } = require('./exr-bytes.js');
const C = require('./texture-common.js');
const { write, json } = require('./asset-files.js');
const { stride, idStride, kinds, maxLayers, maxSlots } = require('./deep-composite.js').layout;
const { render } = require('./render.js');
const toLinear = require('../src/color-space.js').prepare('srgb', 'srgb-linear');

const maxDimension = 16_384;
const maxDeepBytes = 192 * 1024 ** 2;
const FLOAT = 2, UINT = 0, magic = 20000630, deepVersion = 0x802;
const colors = ['R', 'G', 'B'];
const labelChannels = ['ink.kind', 'ink.splatId', 'ink.objectId', 'ink.materialId'];
const sampleChannels = ['surface', 'scatter', 'transmission'].map(layer => colors.map(c => 'ink.' + layer + '.' + c));
const channels = ['A', ...colors, 'Z', 'ZBack', 'ink.visibleCoverage', ...sampleChannels.flat(), ...labelChannels].sort();
const positions = Object.fromEntries(channels.map((name, index) => [name,index]));
const plateLayout = Object.freeze({ channels: Object.freeze(channels), labels: Object.freeze(labelChannels), kinds,
  maxDimension, maxPixels: maxSlots, maxSamples: maxSlots, maxBytes: maxDeepBytes });
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

function header(source, statistics, { reflection, time, view: authoredView }, tidy) {
  const { w,h } = source;
  const list = channels.map(name=>Buffer.concat([cstring(name),int(labelChannels.includes(name)?UINT:FLOAT),
    Buffer.from([1,0,0,0]),int(1,1)]));
  const box = int(0,0,w-1,h-1), view = authoredView ?? (reflection ? 'reflection:' + reflection : 'camera');
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
    ...(source.camera ? matrices(source.camera,w,h) : registrationAttributes(source.registration)),
    ...(time!==undefined ? [attribute('inkTimeSeconds','double',double(time))] : []),
    end
  ]);
}

function registrationAttributes(registration) {
  if (!registration) return [];
  const { worldToCamera, worldToNDC, setback } = registration;
  return [attribute('worldToCamera','m44f',float(...worldToCamera)),
    attribute('worldToNDC','m44f',float(...worldToNDC)), attribute('inkCameraSetback','float',float(setback))];
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
  return { bytes:packRow(y, offsets, data), tidy };
}

function packRow(y, offsets, data) {
  const packedOffsets = zips(offsets), packedSamples = zips(data), info = Buffer.allocUnsafe(28);
  info.writeInt32LE(y,0);
  info.writeBigUInt64LE(BigInt(packedOffsets.length),4);
  info.writeBigUInt64LE(BigInt(packedSamples.length),12);
  info.writeBigUInt64LE(BigInt(data.length),20);
  return Buffer.concat([info,packedOffsets,packedSamples]);
}

function assemble(fileHeader, rows) {
  const offsets = Buffer.allocUnsafe(rows.length * 8);
  let cursor = fileHeader.length + offsets.length;
  for (const [y, bytes] of rows.entries()) {
    offsets.writeBigUInt64LE(BigInt(cursor), y * 8);
    cursor += bytes.length;
  }
  if (cursor > maxDeepBytes) throw new RangeError('Deep plate exceeds its file budget');
  return Buffer.concat([fileHeader, offsets, ...rows], cursor);
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
  return { bytes:assemble(fileHeader,rows.map(row=>row.bytes)),statistics };
}

function encodeDeepEXR(frame, options) {
  return encode(frame,options).bytes;
}

function allocatePlanes(samples) {
  return Object.fromEntries(channels.map(name => [name, labelChannels.includes(name) ?
    new Uint32Array(samples) : new Float32Array(samples)]));
}

function readDeepEXR(input, { sampleBudget = maxSlots } = {}) {
  const { bytes, at, attrs, word, get } = readHeader(input, [deepVersion],
    'Expected a native single-part deep scanline plate', maxDeepBytes);
  const text = name => get(name, 'string').toString('utf8');
  const box = get('dataWindow', 'box2i', 16), w = box.readInt32LE(8) + 1, h = box.readInt32LE(12) + 1;
  const compression = get('compression', 'compression', 1)[0];
  if (text('type') !== 'deepscanline' || ![0, 2].includes(compression) || get('lineOrder', 'lineOrder', 1)[0] !== 0 ||
      box.readInt32LE(0) !== 0 || box.readInt32LE(4) !== 0 || !box.equals(get('displayWindow', 'box2i', 16)) ||
      !C.uint(w, 1, maxDimension) || !C.uint(h, 1, maxDimension) || w * h > maxSlots ||
      get('chunkCount', 'int', 4).readInt32LE() !== h || !C.uint(sampleBudget, 0, maxSlots) ||
      text('inkColorEncoding') !== 'premultiplied linear sRGB' ||
      text('inkDepthSpace') !== 'positive camera-axis depth in Ink world units')
    throw new TypeError('Deep plate needs the native art grid, depth, and color contracts');
  const list = get('channels', 'chlist');
  let cursor = 0;
  for (const expected of channels) {
    const [name, next] = word(list, cursor), row = C.slice(list, next, 16);
    if (name !== expected || row.readInt32LE(0) !== (labelChannels.includes(name) ? UINT : FLOAT) ||
        row.readInt32LE(8) !== 1 || row.readInt32LE(12) !== 1) throw new TypeError('Invalid native deep channel layout');
    cursor = next + 16;
  }
  if (cursor !== list.length - 1 || list[cursor] !== 0) throw new TypeError('Invalid native deep channel list');
  function unpack(packed, length) {
    if (packed.length === length) return packed;
    if (compression !== 2 || packed.length >= length || !packed.length)
      throw new RangeError('Invalid deep scanline length');
    return unzip(packed, length);
  }
  const table = C.slice(bytes, at, h * 8), offsets = new Uint32Array(w * h + 1), rows = [];
  let end = at + h * 8, kept = 0, largestRay = 0;
  for (let y = 0; y < h; y++) {
    const offset = Number(table.readBigUInt64LE(8 * y)), info = C.slice(bytes, offset, 28);
    if (offset < end || info.readInt32LE(0) !== y) throw new RangeError('Invalid or overlapping deep scanline blocks');
    const [countSize, sampleSize, rawSize] = [4, 12, 20].map(i => Number(info.readBigUInt64LE(i)));
    const packedCounts = C.slice(bytes, offset + 28, countSize);
    const packed = C.slice(bytes, offset + 28 + countSize, sampleSize), counts = unpack(packedCounts, w * 4);
    end = offset + 28 + countSize + sampleSize;
    let prior = 0;
    for (let x = 0; x < w; x++) {
      const stop = counts.readInt32LE(x * 4), count = stop - prior;
      if (count < 0 || count > maxLayers) throw new RangeError('Invalid deep sample count at ' + x + ',' + y);
      largestRay = Math.max(largestRay, count);
      offsets[y * w + x + 1] = kept + stop;
      prior = stop;
    }
    if (rawSize !== prior * channels.length * 4 || sampleSize > rawSize || kept + prior > sampleBudget)
      throw new RangeError('Invalid deep sample block or sample budget exceeded');
    rows.push({ packed, rawSize, count: prior, first: kept });
    kept += prior;
  }
  const storedMax = get('maxSamplesPerPixel', 'int', 4).readInt32LE();
  if (storedMax !== largestRay) throw new RangeError('Deep sample count disagrees with header');
  const planes = allocatePlanes(kept);
  for (const { packed, rawSize, count, first } of rows) {
    const raw = unpack(packed, rawSize);
    for (const [lane, name] of channels.entries()) {
      const plane = planes[name], label = plane instanceof Uint32Array;
      for (let i = 0, pos = lane * count * 4; i < count; i++, pos += 4) {
        const n = label ? raw.readUInt32LE(pos) : raw.readFloatLE(pos);
        if (!Number.isFinite(n)) throw new RangeError('Nonfinite deep channel ' + name);
        plane[first + i] = n;
      }
    }
  }
  const { A, R, G, B, Z, ZBack } = planes;
  for (let p = 0; p < w * h; p++) for (let i = offsets[p]; i < offsets[p + 1]; i++) {
    if (A[i] < 0 || A[i] > 1 || Z[i] < 0 || Z[i] !== ZBack[i] || i > offsets[p] && Z[i] < Z[i - 1] ||
        !A[i] && (R[i] || G[i] || B[i]))
      throw new RangeError('Deep plate needs sorted point depths and valid premultiplied coverage');
  }
  const { objects, materials } = JSON.parse(text('inkIds'));
  const validLabels = list => Array.isArray(list) && list.length <= 65536 && list.every(value =>
    value === null || typeof value === 'string' && value.length <= 1024);
  if (!validLabels(objects) || !validLabels(materials)) throw new RangeError('Invalid native deep ID labels');
  const view = text('name'), facts = JSON.parse(text('inkStats'));
  if (!facts || !C.uint(facts.droppedSamples, 0, Number.MAX_SAFE_INTEGER) || !C.uint(facts.truncatedPixels, 0, w * h) ||
      facts.retainedSamples !== kept || facts.width !== w || facts.height !== h || facts.maxSamples !== largestRay)
    throw new RangeError('Invalid native deep capture statistics');
  const time = attrs.has('inkTimeSeconds') ? get('inkTimeSeconds', 'double', 8).readDoubleLE() : undefined;
  if (time !== undefined && !Number.isFinite(time)) throw new RangeError('Invalid deep frame time');
  let registration;
  if (['worldToCamera', 'worldToNDC', 'inkCameraSetback'].some(name => attrs.has(name))) {
    const matrix = name => {
      const data = get(name, 'm44f', 64);
      return Array.from({ length: 16 }, (_, i) => data.readFloatLE(i * 4));
    };
    registration = { worldToCamera: matrix('worldToCamera'), worldToNDC: matrix('worldToNDC'),
      setback: get('inkCameraSetback', 'float', 4).readFloatLE() };
    if (![...registration.worldToCamera, ...registration.worldToNDC, registration.setback].every(Number.isFinite))
      throw new RangeError('Invalid deep camera registration');
  }
  return { w, h, offsets, planes, objects, materials, view, registration, time,
    statistics: { width: w, height: h, maxSamples: largestRay, retainedSamples: kept,
      truncatedPixels: facts.truncatedPixels, droppedSamples: facts.droppedSamples } };
}

function encodeDeepPlate(plate) {
  const { w, h, offsets, planes, time, view } = plate;
  let tidy = true, maxSamples = 0;
  const rows = Array.from({ length: h }, (_, y) => {
    const p = y * w, first = offsets[p], count = offsets[p + w] - first, counts = Buffer.allocUnsafe(w * 4);
    for (let x = 0; x < w; x++) {
      const start = offsets[p + x], stop = offsets[p + x + 1];
      counts.writeInt32LE(stop - first, x * 4);
      maxSamples = Math.max(maxSamples, stop - start);
      for (let i = start + 1; i < stop; i++) if (planes.Z[i] === planes.Z[i - 1]) tidy = false;
    }
    const raw = Buffer.allocUnsafe(count * channels.length * 4);
    for (const [lane, name] of channels.entries()) {
      const plane = planes[name], label = plane instanceof Uint32Array;
      for (let i = 0, at = lane * count * 4; i < count; i++, at += 4) {
        if (label) raw.writeUInt32LE(plane[first + i], at);
        else raw.writeFloatLE(plane[first + i], at);
      }
    }
    return packRow(y, counts, raw);
  });
  const { truncatedPixels = 0, droppedSamples = 0 } = plate.statistics ?? {};
  const statistics = { width: w, height: h, layers: Math.max(1, maxSamples), maxSamples,
    retainedSamples: offsets.at(-1), truncatedPixels, droppedSamples };
  return { bytes: assemble(header(plate, statistics, { time, view }, tidy), rows), statistics };
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

module.exports = { encodeDeepEXR, exportDeepEXR, readDeepEXR, encodeDeepPlate, allocatePlanes, plateLayout };
