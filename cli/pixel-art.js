'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { paint } = require('../src/pixel-stamps.js');
const PNG = require('./png.js');
const Critic = require('./critic.js');
const files = require('./asset-files.js');

const format = 'ink-studio/pixel-art';
const name = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const record = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const at = (width, height, xy) => Array.isArray(xy) && xy.length === 2 &&
  integer(xy[0], 0, width-1) && integer(xy[1], 0, height-1);
const rect = (x,y,w=1,h=1) => ({ type:'rect', rect:[x,y,w,h] });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fingerprint = design => createHash('sha256').update(JSON.stringify(design)).digest('hex');
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const reference = value => typeof value === 'string' && value.trim().length > 0;

function namedRegions(regions, kind, width, height, frames) {
  if (regions === undefined) return;
  if (!Array.isArray(regions)) throw new TypeError(kind + ' must be an array');
  const ids = new Set();
  for (const region of regions) {
    if (!fields(region,['id','frame','pixels']) || !name(region.id) || ids.has(region.id) ||
        (region.frame !== undefined && !frames.has(region.frame)) || !Array.isArray(region.pixels))
      throw new TypeError(kind + ' needs unique IDs, pixel lists and optional known frames');
    ids.add(region.id);
    const pixels = new Set();
    for (const xy of region.pixels) {
      if (!at(width,height,xy)) throw new RangeError(kind + ' ' + region.id + ' has a pixel outside the native grid');
      const pixel = xy[1]*width+xy[0];
      if (pixels.has(pixel)) throw new RangeError(kind + ' ' + region.id + ' repeats pixel ' + xy.join(','));
      pixels.add(pixel);
    }
  }
}

function documentShape(design) {
  if (!record(design) || design.format !== format || ![1,2].includes(design.version))
    throw new TypeError('Expected an Ink pixel-art document, version 1 or 2');
  const { width,height,palette,layers } = design;
  if (!integer(width,1,512) || !integer(height,1,512) || !Array.isArray(layers) ||
      !integer(layers.length,1,64) || width*height*layers.length > 4_000_000 || !record(palette))
    throw new RangeError('Pixel art needs a native grid, a palette and up to 64 bounded layers');
  if (design.version === 1) return;

  const { pixelAspect,frames,selections,protectedDetails,sceneBindings } = design;
  if (!fields(design,['format','version','width','height','pixelAspect','palette','layers','frames',
    'selections','protectedDetails','sceneBindings'])) throw new TypeError('Unknown pixel document field');
  if (!Array.isArray(pixelAspect) || pixelAspect.length !== 2 ||
      !integer(pixelAspect[0],1,Number.MAX_SAFE_INTEGER) || !integer(pixelAspect[1],1,Number.MAX_SAFE_INTEGER))
    throw new RangeError('Pixel aspect needs two positive integers [width,height]');
  const layerIds = new Set();
  for (const layer of layers) {
    if (!fields(layer,['id','clip','protect']) || !name(layer.id) || layerIds.has(layer.id) ||
        (layer.clip !== undefined && !layerIds.has(layer.clip)) ||
        (layer.protect !== undefined && typeof layer.protect !== 'boolean'))
      throw new TypeError('Pixel layer definitions need unique IDs and may clip to an earlier layer');
    layerIds.add(layer.id);
  }
  if (!Array.isArray(frames) || !frames.length) throw new TypeError('Pixel documents need at least one frame');
  const frameIds = new Set();
  for (const frame of frames) {
    if (!fields(frame,['id','durationMs','cels']) || !name(frame.id) || frameIds.has(frame.id) ||
        !integer(frame.durationMs,1,Number.MAX_SAFE_INTEGER) || !record(frame.cels))
      throw new TypeError('Pixel frames need unique IDs, positive integer durations in milliseconds and cels');
    frameIds.add(frame.id);
    for (const [layer,cel] of Object.entries(frame.cels)) {
      if (!layerIds.has(layer) || !fields(cel,['marks','slots']) || !Array.isArray(cel.marks))
        throw new TypeError('Pixel cel ' + frame.id + '/' + layer + ' needs a known layer and marks');
    }
  }
  namedRegions(selections,'Pixel selections',width,height,frameIds);
  namedRegions(protectedDetails,'Protected pixel details',width,height,frameIds);
  if (sceneBindings === undefined) return;
  if (!Array.isArray(sceneBindings)) throw new TypeError('Pixel scene bindings must be an array');
  const bindingIds = new Set();
  for (const binding of sceneBindings) {
    if (!fields(binding,['id','scene','object','part','revision','frame','layer']) || !name(binding.id) ||
        bindingIds.has(binding.id) || !reference(binding.scene) || !reference(binding.object) ||
        (binding.part !== undefined && !reference(binding.part)) ||
        (binding.revision !== undefined && !reference(binding.revision)) ||
        (binding.frame !== undefined && !frameIds.has(binding.frame)) ||
        (binding.layer !== undefined && !layerIds.has(binding.layer)))
      throw new TypeError('Pixel scene bindings need unique IDs, scene and object references, and valid frame and layer scopes');
    bindingIds.add(binding.id);
  }
}

function shapes(width, height, mark) {
  if (!record(mark) || ['at','shape','steps'].filter(key => Object.hasOwn(mark,key)).length !== 1 ||
      Object.keys(mark).some(key => !['swatch','at','shape','steps'].includes(key)))
    throw new TypeError('A pixel mark needs exactly one of at, shape, or steps');
  if (mark.shape !== undefined) return [mark.shape];
  if (mark.at !== undefined) {
    if (!at(width,height,mark.at)) throw new RangeError('A pixel mark is outside the native grid');
    return [rect(...mark.at)];
  }
  if (!record(mark.steps)) throw new TypeError('A step stroke needs a start, axis, direction and run lengths');
  const { from, axis, direction, lengths } = mark.steps;
  if (!at(width,height,from) || !['x','y'].includes(axis) || !Array.isArray(direction) ||
      direction.length !== 2 || direction.some(n => n !== 1 && n !== -1) ||
      !Array.isArray(lengths) || !integer(lengths.length,1,512) || lengths.some(n => !integer(n,1,512)))
    throw new RangeError('Invalid pixel step stroke');
  const major = Number(axis === 'y'), minor = 1-major;
  const cursor = from.slice(), result = [];
  for (const length of lengths) {
    const end = cursor.slice();
    end[major] += direction[major]*(length-1);
    if (!at(width,height,cursor) || !at(width,height,end)) throw new RangeError('A pixel step stroke leaves the native grid');
    result.push(rect(Math.min(cursor[0],end[0]), Math.min(cursor[1],end[1]), major ? 1 : length, major ? length : 1));
    cursor[major] = end[major]+direction[major];
    cursor[minor] += direction[minor];
  }
  return result;
}

function composite(width,height,palette,layers) {
  const size = width*height;
  const entries = Object.entries(palette);
  if (!integer(entries.length,1,255) ||
      entries.some(([id,color]) => !name(id) || typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)))
    throw new TypeError('Pixel palettes need 1–255 named RGB swatches');
  const swatches = entries.map(([id]) => id);
  const colors = entries.map(([,color]) => Number.parseInt(color.slice(1),16));
  const ids = new Map(swatches.map((id,i) => [id,i]));
  const erase = entries.length;
  const slots = new Int16Array(size).fill(-1), owners = new Uint8Array(size), locks = new Uint8Array(size);
  const underSlots = new Int16Array(size).fill(-1), underOwners = new Uint8Array(size);
  const masks = new Map(), layerIds = [null];
  let marksUsed = 0;
  for (const layer of layers) {
    if (!record(layer) || !name(layer.id) || masks.has(layer.id) || !Array.isArray(layer.marks) ||
        (layer.clip !== undefined && !masks.has(layer.clip)) ||
        (layer.protect !== undefined && typeof layer.protect !== 'boolean') ||
        Object.keys(layer).some(key => !['id','marks','clip','protect','slots'].includes(key)))
      throw new TypeError('Pixel layers need a unique ID, marks, and an optional earlier clipping layer');
    const strokes = [];
    for (const mark of layer.marks) {
      const parts = shapes(width,height,mark);
      const slot = mark.swatch === null ? erase : ids.get(mark.swatch);
      if (slot === undefined) throw new TypeError('Unknown pixel swatch ' + mark.swatch);
      if ((marksUsed += parts.length) > 4096) throw new RangeError('Pixel designs support up to 4096 drawing operations');
      for (const shape of parts) strokes.push({ slot, shape });
    }
    let base;
    if (layer.slots !== undefined) {
      if (!Array.isArray(layer.slots) || layer.slots.length !== size)
        throw new TypeError('Pixel layer slots need a named swatch or null per art pixel');
      base = layer.slots.map(swatch => {
        if (swatch === null) return null;
        if (!ids.has(swatch)) throw new TypeError('Unknown pixel swatch ' + swatch);
        return ids.get(swatch);
      });
    }
    const painted = paint(width,height,{ slots:base, strokes });
    const clipping = masks.get(layer.clip), mask = new Uint8Array(size);
    layerIds.push(layer.id);
    masks.set(layer.id,mask);
    const lastLayer = layerIds.length-1;
    for (let p = 0; p < size; p++) {
      if (painted[p] === null || (clipping && !clipping[p])) continue;
      const slot = painted[p] === erase ? -1 : painted[p];
      mask[p] = Number(slot >= 0);
      if (locks[p]) {
        if (slot !== slots[p]) throw new RangeError(layer.id + ' changes a protected pixel at ' + [p%width,Math.floor(p/width)].join(','));
        continue;
      }
      underSlots[p] = slots[p];
      underOwners[p] = owners[p];
      slots[p] = slot;
      owners[p] = lastLayer;
      locks[p] = Number(layer.protect === true);
    }
  }
  return { width,height,slots,owners,locks,underSlots,underOwners,layerIds,swatches,colors };
}

function compileFrame(design, frame, revision) {
  const { width,height,palette,layers } = design;
  if (!frame) return { ...composite(width,height,palette,layers), revision };
  const stack = layers.map(layer => {
    const cel = Object.hasOwn(frame.cels,layer.id) ? frame.cels[layer.id] : { marks:[] };
    return { ...layer, ...cel };
  });
  const raster = composite(width,height,palette,stack);
  for (const detail of design.protectedDetails ?? []) {
    if (detail.frame !== undefined && detail.frame !== frame.id) continue;
    for (const [x,y] of detail.pixels) raster.locks[y*width+x] = 1;
  }
  return { ...raster, revision, id:frame.id, durationMs:frame.durationMs, pixelAspect:design.pixelAspect.slice() };
}

function compile(design, frameId) {
  documentShape(design);
  const frames = design.version === 2 ? design.frames : [];
  const frame = frameId === undefined ? frames[0] : frames.find(item => item.id === frameId);
  if (frameId !== undefined && !frame) throw new RangeError('Unknown pixel frame ' + frameId);
  return compileFrame(design,frame,fingerprint(design));
}

function validate(design) {
  documentShape(design);
  const revision = fingerprint(design);
  const frames = design.version === 1 ? [undefined] : design.frames;
  for (const frame of frames) {
    try {
      compileFrame(design,frame,revision);
    } catch (error) {
      if (!frame) throw error;
      throw new Error('Pixel frame ' + frame.id + ': ' + error.message, { cause:error });
    }
  }
  return { format, version:design.version, revision, grid:[design.width,design.height],
    pixelAspect:design.version === 1 ? [1,1] : design.pixelAspect, frames:frames.map(frame => ({
      id:frame?.id ?? null, durationMs:frame?.durationMs ?? null
    })) };
}

function cell(frame,p) {
  return { at:[p%frame.width,Math.floor(p/frame.width)], layer:frame.layerIds[frame.owners[p]],
    swatch:frame.swatches[frame.slots[p]] ?? null, protected:!!frame.locks[p],
    underneath:{ layer:frame.layerIds[frame.underOwners[p]], swatch:frame.swatches[frame.underSlots[p]] ?? null }
  };
}

function image(frame) {
  const rgb = new Uint8Array(frame.slots.length*3);
  for (let p = 0; p < frame.slots.length; p++) {
    if (frame.slots[p] < 0) continue;
    const color=frame.colors[frame.slots[p]], i=3*p;
    rgb[i]=color>>>16;
    rgb[i+1]=color>>>8;
    rgb[i+2]=color&255;
  }
  return { w:frame.width, h:frame.height, rgb };
}

function frameMetadata(frame) {
  return frame.id === undefined ? {} : { frame:frame.id, durationMs:frame.durationMs, pixelAspect:frame.pixelAspect };
}

function review(frame) {
  const color = image(frame);
  const result = Critic.lint(color, { background:Uint8Array.from(frame.slots, slot => Number(slot < 0)) });
  const { mark, bg, ...metrics } = result;
  const findings = {}, protectedMarks = {};
  for (const [issue, flags] of Object.entries(mark)) {
    const examples = [];
    let count = 0, protectedCount = 0;
    for (let p = 0; p < flags.length; p++) {
      if (!flags[p]) continue;
      if (frame.locks[p]) {
        protectedCount++;
        flags[p] = 0;
        continue;
      }
      count++;
      if (examples.length < 128) examples.push(cell(frame,p));
    }
    findings[issue] = { count, examples };
    protectedMarks[issue] = protectedCount;
  }
  const used = frame.swatches.map(() => 0);
  for (const slot of frame.slots) if (slot >= 0) used[slot]++;
  return {
    report:{ format:'ink-studio/pixel-art-review', version:1, grid:[frame.width,frame.height], revision:frame.revision,
      ...frameMetadata(frame), metrics,
      swatches:Object.fromEntries(frame.swatches.map((id, i) => [id,used[i]])), findings, protectedMarks },
    overlay:Critic.lintMap(color,result)
  };
}

function edit(design, frame, patch) {
  if (!record(patch) || patch.revision !== frame.revision || !name(patch.id) ||
      frame.layerIds.includes(patch.id) || !Array.isArray(patch.edits) || !integer(patch.edits.length,1,4096))
    throw new TypeError('Pixel edit needs the observed revision, a new layer ID and a list of edits');
  if (frame.revision !== fingerprint(design)) throw new RangeError('Pixel edit revision no longer matches the document');
  if (design.version === 2 && patch.frame !== frame.id)
    throw new RangeError('Pixel edit needs the observed frame ID');
  const visited = new Set(), marks = [];
  for (const change of patch.edits) {
    if (!record(change) || !at(frame.width,frame.height,change.at) || ![null,...frame.swatches].includes(change.to) ||
        !Object.hasOwn(change,'from') || !Object.hasOwn(change,'layer'))
      throw new TypeError('A pixel edit needs at, from, layer and to');
    const [x,y] = change.at, p = y*frame.width+x, state = cell(frame,p);
    if (visited.has(p) || state.protected || state.swatch !== change.from || state.layer !== change.layer)
      throw new RangeError('Pixel edit no longer applies at ' + change.at.join(','));
    visited.add(p);
    marks.push({ swatch:change.to, at:change.at });
  }
  const revised = design.version === 1
    ? { ...design, layers:[...design.layers,{ id:patch.id, marks }] }
    : { ...design, layers:[...design.layers,{ id:patch.id }], frames:design.frames.map(item =>
      item.id === frame.id ? { ...item, cels:{ ...item.cels, [patch.id]:{ marks } } } : item) };
  compile(revised,frame.id);
  return revised;
}

function stamp(frame) {
  return {
    width:frame.width, height:frame.height, origin:'top-left',
    palette:frame.colors.map(color=>'#'+color.toString(16).padStart(6,'0')),
    slots:Array.from(frame.slots,n=>n < 0 ? null : n)
  };
}

function draw(frame,directory) {
  fs.mkdirSync(directory,{ recursive:true });
  const indexed = stamp(frame), result = review(frame), { w,h,rgb } = result.overlay;
  PNG.writeIndexed(path.join(directory,'art.png'),frame.width,frame.height,indexed.slots,
    frame.colors.map(color=>[color>>>16,color>>>8&255,color&255]));
  files.write(path.join(directory,'review.png'),PNG.encode(w,h,rgb));
  files.json(path.join(directory,'stamp.json'),indexed);
  files.json(path.join(directory,'report.json'),result.report);
  return result.report;
}

function trace(frame, object, scene) {
  const { w:width, h:height, rgb, passes } = frame;
  if (!integer(width,1,512) || !integer(height,1,512) || rgb?.length !== width*height*3 ||
      passes?.w !== width || passes?.h !== height || !passes.objectId || !passes.objects)
    throw new TypeError('Trace needs native color and object ID passes on the same grid');
  const owner = passes.objects.indexOf(object);
  if (owner <= 0) throw new RangeError('Unknown render object ' + object);
  const palette = {}, slots = Array(width*height).fill(null);
  let pixels = 0;
  for (let p = 0; p < slots.length; p++) {
    if (passes.objectId[p] !== owner) continue;
    const color = (rgb[3*p]<<16 | rgb[3*p+1]<<8 | rgb[3*p+2]).toString(16).padStart(6,'0');
    const swatch = 'ink-' + color;
    slots[p] = swatch;
    palette[swatch] = '#' + color;
    pixels++;
  }
  if (!pixels) throw new RangeError('Trace subject is outside the current view');
  if (Object.keys(palette).length > 255)
    throw new RangeError('Trace found over 255 visible colors. Choose a scoped palette in the source shot first.');
  const design = { format, version:2, width, height, pixelAspect:[1,1], palette, layers:[{ id:'projection' }],
    frames:[{ id:'capture', durationMs:100, cels:{ projection:{ slots, marks:[] } } }] };
  if (scene !== undefined) design.sceneBindings = [
    { id:'projection', scene, object, frame:'capture', layer:'projection' }
  ];
  return design;
}

function command(pos,opt,outputFile,capture) {
  const [action, source, patch] = pos;
  if (!['trace','validate','draw','inspect','edit'].includes(action) || pos.length !== (action === 'edit' ? 3 : 2))
    throw new TypeError('Use pixel-art trace <scene> --subject object-id, validate <design.json>, draw <design.json>, inspect <design.json> --at x,y, or edit <design.json> <patch.json> --out revised.json');
  if (action === 'trace') {
    if (typeof opt.subject !== 'string' || !opt.subject.trim()) throw new TypeError('Trace needs --subject object-id');
    const design = trace(capture(source), opt.subject, source);
    const directory = outputFile('pixel-art-trace');
    draw(compile(design),directory);
    files.json(path.join(directory,'design.json'),design);
    console.log('wrote',directory);
    return;
  }
  const design = read(source);
  if (action === 'validate') {
    process.stdout.write(JSON.stringify(validate(design),null,2)+'\n');
    return;
  }
  const changes = action === 'edit' ? read(patch) : undefined;
  const frame = compile(design,opt.frame ?? (design.version === 2 ? changes?.frame : undefined));
  if (action === 'inspect') {
    const coordinate = /^\d+,\d+$/.test(opt.at ?? '') ? opt.at.split(',').map(Number) : null;
    if (!at(frame.width,frame.height,coordinate)) throw new RangeError('Use --at x,y inside the native grid');
    const [x,y] = coordinate;
    process.stdout.write(JSON.stringify({ revision:frame.revision, ...frameMetadata(frame), ...cell(frame,y*frame.width+x) },null,2)+'\n');
    return;
  }
  if (action === 'draw') {
    const directory=outputFile('pixel-art');
    draw(frame,directory);
    console.log('wrote',directory);
    return;
  }
  if (typeof opt.out !== 'string') throw new TypeError('Use --out revised.json to save the edited design');
  const revised=edit(design,frame,changes);
  files.json(path.resolve(opt.out),revised);
}

module.exports = { compile, validate, stamp, image, review, edit, draw, trace, command };
