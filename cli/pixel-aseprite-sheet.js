'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const Colors = require('../src/pixel-raster-colors.js');

const directions = new Map([
  ['forward','forward'],['reverse','reverse'],['pingpong','ping-pong'],['pingpong_reverse','ping-pong-reverse']
]);
const record = value=>value && Object.getPrototypeOf(value) === Object.prototype;
const filename = value=>typeof value === 'string' && value.trim().length > 0;
const size = ({ w,h } = {})=>[w,h];
const rect = ({ x,y,w,h } = {})=>[x,y,w,h];
const pair = ({ x,y } = {})=>[x,y];
const positive = n=>Number.isSafeInteger(n) && n > 0;
const nonnegative = n=>Number.isSafeInteger(n) && n >= 0;
const inside = ([x,y,w,h],[width,height])=>[x,y].every(nonnegative) && [w,h].every(positive) &&
  x <= width-w && y <= height-h;
const hex = color=>'#'+color.toString(16).padStart(6,'0');

function namedIds(prefix,rows) {
  const used = new Set();
  return rows.map((row,i)=>{
    if (typeof row?.name !== 'string') throw new TypeError('Aseprite '+prefix+' needs a name');
    const slug = row.name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55);
    const stem = /^[a-z]/.test(slug) ? slug : prefix+'-'+(i+1), id = Colors.uniqueId(used,stem);
    used.add(id);
    return { id,...(row.name.trim() && { label:row.name }) };
  });
}

function frameRows(frames,dimensions) {
  const rows = Array.isArray(frames) ? frames.map(row=>[row?.filename,row]) : record(frames) ? Object.entries(frames) : [];
  if (!rows.length || rows.length > 2048) throw new RangeError('Aseprite sheets need 1–2048 JSON frames');
  return rows.map(([label,row],i)=>{
    if (!filename(label) || !record(row) || !positive(row.duration) || row.duration > 65535 ||
        typeof row.rotated !== 'boolean' || typeof row.trimmed !== 'boolean')
      throw new TypeError('Invalid Aseprite frame '+(i+1)+' name, duration or packing flags');
    if (row.rotated) throw new RangeError('Aseprite frame '+label+' is rotated. Export an unrotated Aseprite sheet.');
    const frame = rect(row.frame ?? {}), spriteSourceSize = rect(row.spriteSourceSize ?? {}), sourceSize = size(row.sourceSize ?? {});
    const [u,v,w,h] = spriteSourceSize, [width,height] = sourceSize;
    if (!inside(frame,dimensions) || !sourceSize.every(positive) || ![u,v].every(Number.isSafeInteger) ||
        ![w,h].every(positive) || u >= width || v >= height || u+w <= 0 || v+h <= 0)
      throw new RangeError('Aseprite frame '+label+' has invalid sheet or source bounds');
    const padding = [(frame[2]-spriteSourceSize[2])/2,(frame[3]-spriteSourceSize[3])/2];
    if (!padding.every(nonnegative)) throw new RangeError('Aseprite frame '+label+' has inconsistent trim or inner padding');
    return { id:'frame-'+(i+1),label,durationMs:row.duration,frame,spriteSourceSize,sourceSize,
      trimmed:row.trimmed,rotated:row.rotated,padding };
  });
}

function taggedRanges(input,frames) {
  if (!Array.isArray(input) || input.length > 128) throw new RangeError('Aseprite sheets can import up to 128 named ranges');
  const ids = namedIds('tag',input);
  return input.map(({ from,to,direction,repeat },i)=>{
    const count = typeof repeat === 'string' && /^\d+$/.test(repeat) ? Number(repeat) : repeat ?? 0;
    if (!nonnegative(from) || !nonnegative(to) || to < from || to >= frames.length)
      throw new RangeError('Aseprite tag '+input[i].name+' refers to missing frames. Export the complete timeline.');
    if (!directions.has(direction) || !nonnegative(count) || count > 65535)
      throw new RangeError('Invalid Aseprite tag direction or repeat count for '+input[i].name);
    return { ...ids[i],start:frames[from].id,end:frames[to].id,direction:directions.get(direction),loop:count === 0,
      ...(count && { repeat:count }) };
  });
}

function sliceRows(input,frames) {
  if (!Array.isArray(input) || input.length > 256) throw new RangeError('Aseprite sheets can import up to 256 slices');
  const ids = namedIds('slice',input);
  return input.map(({ keys = [] },i)=>{
    if (!Array.isArray(keys) || keys.length > frames.length) throw new TypeError('Aseprite slice keys need known frames');
    return { ...ids[i],keys:keys.map(row=>{
      const frame = nonnegative(row?.frame) && frames[row.frame]?.id;
      if (!frame) throw new RangeError('Aseprite slice '+input[i].name+' refers to a missing frame. Export the complete timeline.');
      const bounds = rect(row.bounds ?? {}), [x,y,w,h] = bounds;
      if (![x,y].every(Number.isSafeInteger) || ![w,h].every(nonnegative))
        throw new RangeError('Invalid Aseprite slice bounds for '+input[i].name);
      if (!w || !h) return { frame,bounds:null };
      const center = row.center === undefined ? undefined : rect(row.center ?? {});
      if (center && !inside(center,[w,h])) throw new RangeError('Invalid Aseprite slice center for '+input[i].name);
      const pivot = row.pivot === undefined ? undefined : pair(row.pivot ?? {});
      if (pivot && !pivot.every(Number.isSafeInteger)) throw new RangeError('Invalid Aseprite slice pivot for '+input[i].name);
      return { frame,bounds,...(pivot && { pivot }),...(center && { nineSlice:[center[0],center[1],
        w-center[0]-center[2],h-center[1]-center[3]] }) };
    }) };
  });
}

function canvas(frames,slices) {
  let x0 = 0,y0 = 0,x1 = 0,y1 = 0;
  for (const {sourceSize:[w,h]} of frames) {
    x1 = Math.max(x1,w);
    y1 = Math.max(y1,h);
  }
  for (const { keys } of slices) for (const { bounds } of keys) {
    if (!bounds) continue;
    const [x,y,w,h] = bounds;
    x0 = Math.min(x0,x);
    y0 = Math.min(y0,y);
    x1 = Math.max(x1,x+w);
    y1 = Math.max(y1,y+h);
  }
  const width = x1-x0, height = y1-y0;
  if (width > 512 || height > 512 || width*height*frames.length > 2**20)
    throw new RangeError('Aseprite import needs a native canvas up to 512 × 512 and at most 1,048,576 timeline pixels');
  return { width,height,origin:[x0,y0] };
}

function restore(sheet,frames,{width,height,origin:[x0,y0]},authoredCel) {
  const indexed = sheet.value !== undefined, pitch = indexed ? sheet.value.width : sheet.w;
  const used = new Set(), rgba = Colors.paletteEditor([]);
  const channel = i=>Math.round(sheet.data[i]*255/sheet.max);
  // Keep original indices until the palette is known. Color matches alone cannot distinguish indexed swatches.
  const raster = frames.map(row=>{
    const slots = Array(width*height).fill(null), alpha = new Uint8Array(slots.length).fill(255);
    const [x,y] = row.frame, [left,top] = row.padding, [u,v,w,h] = row.spriteSourceSize;
    // Trim-to-grid may extend past the sprite. Restore only pixels on the source canvas.
    const [sourceWidth,sourceHeight] = row.sourceSize;
    const endX = Math.min(w,sourceWidth-u), endY = Math.min(h,sourceHeight-v);
    for (let j=Math.max(0,-v);j<endY;j++) for (let i=Math.max(0,-u);i<endX;i++) {
      const texel = (y+top+j)*pitch+x+left+i, dst = (v-y0+j)*width+u-x0+i;
      const value = indexed ? sheet.alpha.data[texel] : channel(texel*4+3);
      if (value === 0) continue;
      const slot = indexed ? sheet.value.data[texel] : rgba.resolve(
        Colors.fromBytes(channel(texel*4),channel(texel*4+1),channel(texel*4+2)));
      slots[dst] = slot;
      alpha[dst] = value;
      if (indexed) used.add(slot);
    }
    return { slots,alpha };
  });
  if (indexed && used.size > Colors.limit) throw new RangeError('Aseprite import needs at most 255 visible palette slots');
  const swatches = indexed ? [...used].sort((a,b)=>a-b).map(slot=>({ id:'slot-'+slot,color:hex(sheet.palette[slot]) })) : rgba.palette;
  if (!swatches.length) swatches.push({ id:'slot-0',color:'#000000' });
  const swatchIds = swatches.map(row=>row.id);
  const slotIndex = indexed && new Map(swatchIds.map((id,slot)=>[Number(id.slice(5)),slot]));
  const cels = raster.map(image=>{
    if (indexed) image.slots = image.slots.map(slot=>slot === null ? null : slotIndex.get(slot));
    return authoredCel(width,image,swatchIds);
  });
  return { swatches,cels };
}

function readSheet(file,{ sheet, out } = {},authoredCel) {
  const data = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if (!record(data?.meta)) throw new TypeError('Expected Aseprite sprite sheet JSON with a meta object');
  const { meta } = data;
  if (sheet !== undefined && !filename(sheet)) throw new TypeError('Use --sheet with a PNG path');
  if (sheet === undefined && !filename(meta.image)) throw new TypeError('Aseprite JSON needs meta.image or an explicit sheet PNG');
  const imageFile = sheet === undefined ? path.resolve(path.dirname(file),meta.image) : path.resolve(sheet);
  if (out && path.resolve(out) === imageFile) throw new TypeError('Write the document to a separate file from the sheet PNG');
  const image = PNG.sheetRaster(imageFile), dimensions = image.value ? [image.value.width,image.value.height] : [image.w,image.h];
  if (meta.size !== undefined && !size(meta.size ?? {}).every((n,i)=>n === dimensions[i]))
    throw new RangeError('Aseprite metadata size does not match the sheet PNG');
  if (meta.scale !== undefined && Number(meta.scale) !== 1)
    throw new RangeError('Aseprite sheet import needs an unscaled sheet (meta.scale 1)');
  const frames = frameRows(data.frames,dimensions), tags = taggedRanges(meta.frameTags ?? [],frames),
    slices = sliceRows(meta.slices ?? [],frames);
  const grid = canvas(frames,slices), { width,height,origin } = grid;
  const { swatches,cels } = restore(image,frames,grid,authoredCel);
  for (const { keys } of slices) for (const { bounds } of keys) if (bounds) {
    bounds[0] -= origin[0];
    bounds[1] -= origin[1];
  }
  return { width,height,swatches,tags,slices,frames:frames.map(({ id,label,durationMs },i)=>
    ({ id,label,durationMs,cels:{ image:cels[i] } })),
    aseprite:{ version:1,image:path.basename(imageFile),size:dimensions,canvasOrigin:origin,
      frames:frames.map(({ durationMs,padding,...row })=>row) } };
}

module.exports = { readSheet };
