'use strict';

const { conflict } = require('./pixel-edit-preview.js');
const Timeline = require('./pixel-cel-timeline.js');
const RasterTools = require('../src/pixel-paint-tools.js');
const PixelSelections = require('../src/pixel-selections.js');
const PixelTransforms = require('../src/pixel-selection-transforms.js');
const Cleanup = require('../src/pixel-cleanup.js');

const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const record = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key));
const unique = (rows,test)=>Array.isArray(rows) && rows.length > 0 && Array.from(rows).every(test) && new Set(rows).size === rows.length;

function select(design,scope,lookup,stack) {
  if (!fields(scope,['cels','frames','tag','layers','selection','selections']) ||
      scope.selection !== undefined && (scope.selections !== undefined || !id(scope.selection)) ||
      scope.selections !== undefined && (!record(scope.selections) || !Object.values(scope.selections).every(id)))
    throw new TypeError('Use a cel scope and an optional shared selection or per-frame selections');
  if (scope.cels !== undefined) {
    if (scope.frames !== undefined || scope.tag !== undefined || scope.layers !== undefined || !unique(scope.cels,Timeline.celName))
      throw new TypeError('Use unique cel IDs or a frame range and layers');
    const byFrame = new Map();
    for (const cel of scope.cels) {
      const at = lookup.locations.get(cel);
      if (!at) throw conflict('missing-cel','Unknown pixel cel '+cel,{ cel });
      if (!byFrame.has(at.frame)) byFrame.set(at.frame,new Set());
      byFrame.get(at.frame).add(at.layer);
    }
    return new Map(design.frames.filter(frame=>byFrame.has(frame.id))
      .map(frame=>[frame.id,[...stack.rows.keys()].filter(layer=>byFrame.get(frame.id).has(layer))]));
  }
  if ((scope.frames === undefined) === (scope.tag === undefined) || !unique(scope.layers,id))
    throw new TypeError('Use an inclusive frame range or playback tag and a list of unique layers');
  for (const layer of scope.layers) {
    const row = stack.rows.get(layer);
    if (!row || row.kind === 'group')
      throw conflict('missing-layer','Choose a layer that can contain cels',{ layer });
  }
  let endpoints = scope.frames;
  if (scope.tag !== undefined) {
    const tag = design.tags?.find(row=>row.id === scope.tag);
    if (!tag) throw conflict('missing-tag','Unknown playback tag '+scope.tag,{ tag:scope.tag });
    endpoints = [tag.start,tag.end];
  }
  if (!Array.isArray(endpoints) || endpoints.length !== 2 || !Array.from(endpoints).every(id))
    throw new TypeError('A frame range needs two frame IDs');
  const [first,last] = endpoints.map(id=>design.frames.findIndex(frame=>frame.id === id));
  if (first < 0 || last < first) throw new RangeError('Frame range endpoints must exist in timeline order');
  const layers = [...stack.rows.keys()].filter(layer=>scope.layers.includes(layer));
  return new Map(design.frames.slice(first,last+1).map(frame=>[frame.id,layers]));
}

const editFields = {
  'palette-swap':['map'],
  nudge:['offset'],
  mask:['mode'],
  cleanup:['kind','mode','at','swatch','maxChanges']
};

function prepare(operation,swatches) {
  if (!fields(operation,['type','scope','edit']) || !record(operation.edit) ||
      !Object.hasOwn(editFields,operation.edit.type) || !fields(operation.edit,['type',...editFields[operation.edit.type]]))
    throw new TypeError('Choose a palette-swap, nudge, mask, or cleanup for the selected cels');
  const { type,map,offset,mode,...settings } = operation.edit;
  if (type === 'palette-swap') {
    if (!record(map) || !Object.keys(map).length) throw new TypeError('Palette swap needs a map of existing swatch IDs');
    const swaps = new Map();
    for (const [from,to] of Object.entries(map)) {
      if (!swatches.has(from) || !swatches.has(to) || from === to)
        throw new RangeError('Palette swap entries need two distinct existing swatches');
      swaps.set(swatches.get(from),swatches.get(to));
    }
    return { type,swaps };
  }
  if (type === 'nudge') {
    if (!Array.isArray(offset) || offset.length !== 2 || !Array.from(offset).every(value=>Number.isSafeInteger(value) && Math.abs(value) <= 4096))
      throw new TypeError('Nudge needs a whole-pixel [x,y] offset within ±4096');
    return { type,offset };
  }
  if (type === 'mask' && mode !== undefined && !['keep','erase'].includes(mode))
    throw new TypeError('Choose mask mode keep or erase');
  return type === 'mask' ? { type,mode:mode ?? 'keep' } : { type,mode,...settings };
}

function prepareWrites(operation,swatches,width,height) {
  if (!fields(operation,['type','cels']) || !Array.isArray(operation.cels) || !operation.cels.length)
    throw new TypeError('Cel writing needs a list of edited cels');
  const cels = new Map();
  for (const row of operation.cels) {
    if (!fields(row,['cel','pixels']) || !Timeline.celName(row.cel) || cels.has(row.cel) ||
        !Array.isArray(row.pixels) || !row.pixels.length || row.pixels.length > width*height)
      throw new TypeError('Cel writing needs a distinct cel ID and a native pixel list for each cel');
    const pixels = new Map();
    for (const pixel of row.pixels) {
      if (!fields(pixel,['at','swatch']) || !Array.isArray(pixel.at) || pixel.at.length !== 2 ||
          !Array.from(pixel.at).every((n,i)=>Number.isSafeInteger(n) && n >= 0 && n < [width,height][i]) ||
          pixel.swatch !== null && !swatches.has(pixel.swatch))
        throw new TypeError('Cel pixels need a native coordinate and a known swatch or null');
      const p = pixel.at[1]*width+pixel.at[0];
      if (pixels.has(p)) throw new RangeError('Cel writing repeats a pixel at '+pixel.at.join(','));
      pixels.set(p,{ slot:pixel.swatch === null ? -1 : swatches.get(pixel.swatch),alpha:255 });
    }
    cels.set(row.cel,pixels);
  }
  return cels;
}

function masks(design,scope,selected,settings) {
  const { selection,selections } = scope, masks = new Map(), bySelection = new Map();
  if (selection === undefined && selections === undefined) {
    if (settings.type === 'mask' || settings.type === 'cleanup') throw new TypeError('Mask and cleanup need a saved selection for each target frame');
    return masks;
  }
  const ids = new Map((design.selections ?? []).map(row=>[row.id,row]));
  if (selections && Object.keys(selections).some(frame=>!selected.has(frame)))
    throw new RangeError('Per-frame selections must belong to frames in the cel scope');
  for (const frame of selected.keys()) {
    const key = selection ?? (Object.hasOwn(selections,frame) ? selections[frame] : undefined);
    const saved = ids.get(key);
    if (!saved || saved.frame !== undefined && saved.frame !== frame)
      throw conflict('missing-selection','Choose a saved selection for frame '+frame,{ frame,selection:key ?? null });
    if (!bySelection.has(key)) bySelection.set(key,PixelSelections.fromPixels(design.width,design.height,saved.pixels));
    masks.set(frame,bySelection.get(key));
  }
  return masks;
}

function nudge(frame,source,mask,offset) {
  const [dx,dy] = offset, { width,height } = frame;
  if (!dx && !dy) return new Map();
  const moving = Uint8Array.from(source.slots,(slot,p)=>Number(slot !== -1 && (!mask || mask[p])));
  if (!moving.includes(1)) return new Map();
  for (let p = 0; p < moving.length; p++) {
    if (!moving[p]) continue;
    const x = p%width, y = Math.floor(p/width);
    if (x+dx < 0 || x+dx >= width || y+dy < 0 || y+dy >= height)
      throw conflict('outside-canvas','Nudge would move artwork outside the native canvas',{ at:[x,y],to:[x+dx,y+dy] });
  }
  const current = { ...source,palette:frame.paletteEntries };
  const clip = PixelTransforms.capture(width,height,current,moving);
  return PixelTransforms.stage(width,height,current,clip,{ offset },{ move:true,named:true }).writes;
}

function coverage(source,p) {
  return source.slots[p] < 0 ? 255 : source.alpha?.[p] ?? 255;
}

function writesFor(frame,source,mask,settings) {
  const { type } = settings;
  if (type === 'pixels') return new Map([...settings.pixels].filter(([p,{ slot }])=>
    source.slots[p] !== slot || coverage(source,p) !== 255));
  if (type === 'nudge') return nudge(frame,source,mask,settings.offset);
  if (type === 'cleanup') {
    const { type, ...options } = settings;
    return Cleanup.plan({ width:frame.width,height:frame.height,...source,locks:frame.locks,
      swatches:frame.swatches,colors:frame.colors },mask,options).writes;
  }
  const writes = new Map();
  for (let p = 0; p < source.slots.length; p++) {
    const slot = source.slots[p];
    if (type === 'palette-swap') {
      if ((!mask || mask[p]) && settings.swaps.has(slot))
        writes.set(p,{ slot:settings.swaps.get(slot),alpha:coverage(source,p) });
    } else if (slot !== -1 && !!mask[p] === (settings.mode === 'erase')) writes.set(p,{ slot:-1,alpha:255 });
  }
  return writes;
}

function plan(frame,source,mask,settings) {
  const writes = writesFor(frame,source,mask,settings), width = frame.width, groups = new Map();
  const changed = [...writes.keys()].sort((a,b)=>a-b);
  const pixel = (slot,alpha)=>({ state:slot === -2 ? 'knockout' : slot < 0 ? 'clear' : 'paint',
    swatch:frame.swatches[slot] ?? null,alpha:slot < 0 ? null : alpha });
  for (const p of changed) {
    const at = [p%width,Math.floor(p/width)];
    if (frame.locks[p] || source.clipping && !source.clipping[p])
      throw conflict(frame.locks[p] ? 'protected-pixel' : 'clipped-pixel','Cel edit cannot change this pixel',{ at });
    const old = source.slots[p], oldAlpha = coverage(source,p), { slot,alpha } = writes.get(p);
    const key = [old,oldAlpha,slot,alpha].join('/');
    if (!groups.has(key)) groups.set(key,{ before:pixel(old,oldAlpha),after:pixel(slot,alpha),pixels:[] });
    groups.get(key).pixels.push(p);
  }
  const changes = [...groups.values()].map(({ before,after,pixels })=>({ before,after,runs:RasterTools.runs(width,pixels) }));
  return { writes,changed,changes };
}

module.exports = { select,prepare,prepareWrites,masks,plan };
