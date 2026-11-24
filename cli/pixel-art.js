'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual:equal } = require('node:util');
const { paint, image:stampImage } = require('../src/pixel-stamps.js');
const PixelGuides = require('../src/pixel-guides.js');
const RasterTools = require('../src/pixel-paint-tools.js');
const PixelBrushes = require('../src/pixel-brushes.js');
const PNG = require('./png.js');
const Critic = require('./critic.js');
const files = require('./asset-files.js');
const Destinations = require('./pixel-edit-destinations.js');
const Preview = require('./pixel-edit-preview.js');
const Sessions = require('./pixel-edit-session.js');
const { isRevision } = require('./pixel-edit-revisions.js');

const format = 'ink-studio/pixel-art';
const receiptFormat = 'ink-studio/pixel-edit-receipt';
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
const label = value => value === undefined || reference(value);
const celName = value => typeof value === 'string' &&
  /^[a-z][a-z0-9-]{0,63}(\/[a-z][a-z0-9-]{0,63})?$/.test(value);
const celId = (frame, layer, cel) => cel.id ?? frame.id + '/' + layer;
const swatchColor = value => typeof value === 'string' ? value : value?.color;

function paletteEntries(palette, version) {
  const entries = Object.entries(palette);
  if (!integer(entries.length,1,255) || entries.some(([id,value]) => !name(id) ||
      (typeof value !== 'string' && !(version === 2 && fields(value,['color','label']) && label(value.label))) ||
      typeof swatchColor(value) !== 'string' || !/^#[\da-f]{6}$/i.test(swatchColor(value))))
    throw new TypeError('Pixel palettes need 1–255 RGB swatches keyed by stable ID');
  return entries.map(([id,value]) => ({
    id, color:swatchColor(value), ...(typeof value !== 'string' && value.label !== undefined && { label:value.label })
  }));
}

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

  const { pixelAspect,frames,selections,protectedDetails,sceneBindings = [],destinations,guides,legacyMetadata } = design;
  if (!fields(design,['format','version','width','height','pixelAspect','palette','layers','frames',
    'selections','protectedDetails','sceneBindings','destinations','guides','legacyMetadata']))
    throw new TypeError('Unknown pixel document field');
  if (legacyMetadata !== undefined && !record(legacyMetadata)) throw new TypeError('Legacy pixel metadata must be an object');
  if (!Array.isArray(pixelAspect) || pixelAspect.length !== 2 ||
      !integer(pixelAspect[0],1,Number.MAX_SAFE_INTEGER) || !integer(pixelAspect[1],1,Number.MAX_SAFE_INTEGER))
    throw new RangeError('Pixel aspect needs two positive integers [width,height]');
  const layerIds = new Set();
  for (const layer of layers) {
    if (!fields(layer,['id','label','clip','protect']) || !name(layer.id) || layerIds.has(layer.id) || !label(layer.label) ||
        (layer.clip !== undefined && !layerIds.has(layer.clip)) ||
        (layer.protect !== undefined && typeof layer.protect !== 'boolean'))
      throw new TypeError('Pixel layer definitions need unique IDs and may clip to an earlier layer');
    layerIds.add(layer.id);
  }
  if (!Array.isArray(frames) || !frames.length) throw new TypeError('Pixel documents need at least one frame');
  const frameIds = new Set(), celIds = new Set();
  for (const frame of frames) {
    if (!fields(frame,['id','label','durationMs','cels']) || !name(frame.id) || frameIds.has(frame.id) || !label(frame.label) ||
        !integer(frame.durationMs,1,Number.MAX_SAFE_INTEGER) || !record(frame.cels))
      throw new TypeError('Pixel frames need unique IDs, positive integer durations in milliseconds and cels');
    frameIds.add(frame.id);
    for (const [layer,cel] of Object.entries(frame.cels)) {
      if (!layerIds.has(layer) || !fields(cel,['id','label','marks','slots']) || !label(cel.label) ||
          !Array.isArray(cel.marks) || (cel.id !== undefined && !celName(cel.id)))
        throw new TypeError('Pixel cel ' + frame.id + '/' + layer + ' needs a known layer and marks');
      const id = celId(frame,layer,cel);
      if (celIds.has(id)) throw new RangeError('Duplicate pixel cel ID ' + id);
      celIds.add(id);
    }
  }
  namedRegions(selections,'Pixel selections',width,height,frameIds);
  namedRegions(protectedDetails,'Protected pixel details',width,height,frameIds);
  PixelGuides.prepare(guides,frameIds);
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
  Destinations.validate(destinations,bindingIds);
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
  return RasterTools.staircase(width,height,mark.steps).map(bounds => rect(...bounds));
}

function rasterLayer(layer,base,ids,width,height,erase,count,spend) {
  let painted = base, strokes = [], alpha;
  function flush() {
    if (strokes.length || painted === undefined) painted = paint(width,height,{ slots:painted,strokes });
    strokes = [];
  }
  for (const mark of layer.marks) {
    const slot = mark?.swatch === null ? erase : ids.get(mark?.swatch);
    if (mark && Object.hasOwn(mark,'runs')) {
      const alphaRun = Object.hasOwn(mark,'alpha');
      if (alphaRun ? !fields(mark,['alpha','runs']) || !integer(mark.alpha,0,255) :
          !fields(mark,['swatch','clear','runs']) || (mark.clear !== undefined
            ? mark.clear !== true || Object.hasOwn(mark,'swatch') : slot === undefined))
        throw new TypeError('A pixel run mark needs a swatch, clear flag or alpha byte');
      if (!Array.isArray(mark.runs) || !mark.runs.length || mark.runs.length > width*height)
        throw new TypeError('A pixel run mark needs native runs');
      if (alphaRun) alpha ??= new Uint8Array(width*height).fill(255);
      count(1);
      flush();
      let end = 0;
      for (const row of mark.runs) {
        if (!Array.isArray(row) || row.length !== 3 || !integer(row[0],0,height-1) ||
            !integer(row[1],0,width-1) || !integer(row[2],1,width-row[1]))
          throw new RangeError('Pixel runs need in-bounds [row, column, length] values');
        const [y,x,length] = row, first = y*width+x;
        if (first < end) throw new RangeError('Pixel runs need sorted, non-overlapping spans');
        end = first+length;
        spend(length);
        if (alphaRun) {
          for (let p = first; p < end; p++)
            if (painted[p] !== null && painted[p] !== erase) alpha[p] = mark.alpha;
        } else {
          painted.fill(mark.clear ? null : slot,first,end);
          if (mark.clear || slot === erase) alpha?.fill(255,first,end);
        }
      }
    } else {
      const parts = shapes(width,height,mark);
      if (slot === undefined) throw new TypeError('Unknown pixel swatch ' + mark.swatch);
      count(parts.length);
      for (const shape of parts) strokes.push({ slot,shape });
      if (alpha && slot === erase) {
        flush();
        spend(painted.length);
        for (let p = 0; p < painted.length; p++)
          if (painted[p] === erase) alpha[p] = 255;
      }
    }
  }
  flush();
  return { painted,alpha };
}

function overColor(front,rear,frontWeight,rearWeight) {
  let color = 0;
  for (const shift of [16,8,0]) {
    const value = ((front>>>shift&255)*frontWeight+(rear>>>shift&255)*rearWeight)/(frontWeight+rearWeight);
    color |= Math.round(value)<<shift;
  }
  return color;
}

function composite(width,height,entries,layers,capture) {
  const size = width*height;
  const swatches = entries.map(({ id }) => id);
  const colors = entries.map(({ color }) => Number.parseInt(color.slice(1),16));
  const ids = new Map(swatches.map((id,i) => [id,i]));
  const erase = entries.length;
  const slots = new Int16Array(size).fill(-1), owners = new Uint8Array(size), locks = new Uint8Array(size);
  const underSlots = new Int16Array(size).fill(-1), underOwners = new Uint8Array(size);
  const masks = new Map(), layerIds = [null];
  const layerSources = capture ? new Map() : undefined;
  let marksUsed = 0, opacity, mixedColors;
  let runBudget = 32e6;
  for (const layer of layers) {
    if (!record(layer) || !name(layer.id) || masks.has(layer.id) || !Array.isArray(layer.marks) ||
        (layer.clip !== undefined && !masks.has(layer.clip)) ||
        (layer.protect !== undefined && typeof layer.protect !== 'boolean') ||
        Object.keys(layer).some(key => !['id','marks','clip','protect','slots'].includes(key)))
      throw new TypeError('Pixel layers need a unique ID, marks, and an optional earlier clipping layer');
    let base;
    if (layer.slots !== undefined) {
      if (!Array.isArray(layer.slots) || layer.slots.length !== size)
        throw new TypeError('Pixel layer slots need a named swatch or null per art pixel');
      base = Array.from(layer.slots,swatch => {
        if (swatch === null) return null;
        if (!ids.has(swatch)) throw new TypeError('Unknown pixel swatch ' + swatch);
        return ids.get(swatch);
      });
    }
    const { painted,alpha } = rasterLayer(layer,base,ids,width,height,erase,operations => {
      if ((marksUsed += operations) > 4096) throw new RangeError('Pixel designs support up to 4096 drawing operations');
    },size => {
      if ((runBudget -= size) < 0) throw new RangeError('Pixel runs exceed the drawing budget');
    });
    if (alpha && !opacity) {
      opacity = Uint8Array.from(slots,slot=>slot < 0 ? 0 : 255);
      mixedColors = Uint32Array.from(slots,slot=>colors[slot] ?? 0);
    }
    const clipping = masks.get(layer.clip), mask = new Uint8Array(size);
    if (capture === true || capture === layer.id) {
      const raw = Int16Array.from(painted,slot => slot === null ? -1 : slot === erase ? -2 : slot);
      layerSources.set(layer.id,{ slots:raw,clipping,...(alpha && { alpha }) });
    }
    layerIds.push(layer.id);
    masks.set(layer.id,mask);
    const lastLayer = layerIds.length-1;
    for (let p = 0; p < size; p++) {
      if (painted[p] === null || (clipping && !clipping[p])) continue;
      const slot = painted[p] === erase ? -1 : painted[p];
      const amount = slot < 0 ? 0 : alpha?.[p] ?? 255;
      if (slot >= 0 && !amount) continue;
      mask[p] = Number(slot >= 0);
      if (locks[p]) {
        if (slot !== slots[p]) throw new RangeError(layer.id + ' changes a protected pixel at ' + [p%width,Math.floor(p/width)].join(','));
        continue;
      }
      if (opacity) {
        const rearWeight = opacity[p]*(255-amount)/255;
        mixedColors[p] = !amount ? 0 : !rearWeight ? colors[slot] :
          overColor(colors[slot],mixedColors[p],amount,rearWeight);
        opacity[p] = amount ? Math.round(amount+rearWeight) : 0;
      }
      underSlots[p] = slots[p];
      underOwners[p] = owners[p];
      slots[p] = slot;
      owners[p] = lastLayer;
      locks[p] = Number(layer.protect === true);
    }
  }
  return { width,height,slots,owners,locks,underSlots,underOwners,layerIds,swatches,colors,
    ...(layerSources && { layerSources }),...(opacity && { opacity,mixedColors }) };
}

function compileFrame(design, frame, revision, palette,capture) {
  const { width,height,layers } = design;
  if (!frame) return { ...composite(width,height,palette,layers,capture), revision };
  const cels = new Map();
  const stack = layers.map(layer => {
    const { id,clip,protect } = layer;
    const cel = Object.hasOwn(frame.cels,id) ? frame.cels[id] : undefined;
    if (cel) cels.set(id,celId(frame,id,cel));
    return { id,clip,protect,marks:cel?.marks ?? [],slots:cel?.slots };
  });
  const raster = composite(width,height,palette,stack,capture);
  for (const detail of design.protectedDetails ?? []) {
    if (detail.frame !== undefined && detail.frame !== frame.id) continue;
    for (const [x,y] of detail.pixels) raster.locks[y*width+x] = 1;
  }
  return { ...raster, cels, revision, id:frame.id, durationMs:frame.durationMs, pixelAspect:design.pixelAspect.slice(),
    ...(design.guides && { guides:PixelGuides.active(design.guides,frame.id) }) };
}

function compile(design, frameId, targetCel, capture) {
  documentShape(design);
  const frames = design.version === 2 ? design.frames : [];
  const hasCel = item => Object.entries(item.cels).some(([layer,cel]) => celId(item,layer,cel) === targetCel);
  let frame;
  if (frameId !== undefined) frame = frames.find(item => item.id === frameId);
  else if (targetCel !== undefined) frame = frames.find(hasCel);
  else frame = frames[0];
  if (frameId !== undefined && !frame) throw new RangeError('Unknown pixel frame ' + frameId);
  if (targetCel !== undefined && (!frame || !hasCel(frame)))
    throw new RangeError('Unknown pixel cel ' + targetCel + (frame ? ' on frame ' + frame.id : ''));
  return compileFrame(design,frame,fingerprint(design),paletteEntries(design.palette,design.version),capture);
}

function validate(design) {
  documentShape(design);
  const revision = fingerprint(design);
  const frames = design.version === 1 ? [undefined] : design.frames;
  const palette = paletteEntries(design.palette,design.version);
  for (const frame of frames) {
    try {
      compileFrame(design,frame,revision,palette);
    } catch (error) {
      if (!frame) throw error;
      throw new Error('Pixel frame ' + frame.id + ': ' + error.message, { cause:error });
    }
  }
  const identities = design.version === 2 ? {
    layers:design.layers.map(({ id,label }) => ({ id,...(label !== undefined && { label }) })),
    swatches:palette,
    cels:frames.flatMap(frame => Object.entries(frame.cels).map(([layer,cel]) =>
      ({ id:celId(frame,layer,cel), frame:frame.id, layer, ...(cel.label !== undefined && { label:cel.label }) })))
  } : undefined;
  return { format, version:design.version, revision, grid:[design.width,design.height],
    pixelAspect:design.version === 1 ? [1,1] : design.pixelAspect, frames:frames.map(frame => ({
      id:frame?.id ?? null, durationMs:frame?.durationMs ?? null, ...(frame?.label !== undefined && { label:frame.label })
    })), ...(identities && { identities }),
    ...(design.version === 2 && design.guides && { guides:structuredClone(design.guides) }),
    ...(design.version === 2 && design.destinations !== undefined && { destinations:design.destinations }) };
}

function cell(frame,p) {
  const layer = frame.layerIds[frame.owners[p]];
  const under = frame.layerIds[frame.underOwners[p]];
  return { at:[p%frame.width,Math.floor(p/frame.width)], layer,
    ...(frame.cels && { cel:frame.cels.get(layer) ?? null }),
    swatch:frame.swatches[frame.slots[p]] ?? null, protected:!!frame.locks[p],
    ...(frame.opacity && { alpha:frame.opacity[p] }),
    underneath:{ layer:under, ...(frame.cels && { cel:frame.cels.get(under) ?? null }),
      swatch:frame.swatches[frame.underSlots[p]] ?? null }
  };
}

function inspect(frame,coordinate) {
  if (!at(frame.width,frame.height,coordinate)) throw new RangeError('Use a pixel coordinate inside the native grid');
  const [x,y] = coordinate;
  return { revision:frame.revision, ...frameMetadata(frame), ...cell(frame,y*frame.width+x) };
}

function hexColor(packed) {
  return packed === undefined ? null : '#' + packed.toString(16).padStart(6,'0');
}

function pixelUV(width,height,[x,y]) {
  return [(x+.5)/width,1-(y+.5)/height];
}

function samplePixel(design,coordinate,{ mode = 'composite',frame,layer,cel,destination,uv } = {},context) {
  if (!['composite','layer','source'].includes(mode) || (mode !== 'layer' && (layer !== undefined || cel !== undefined)) ||
      (mode !== 'source' && (destination !== undefined || uv !== undefined)) ||
      (mode === 'layer' && ((layer === undefined) === (cel === undefined))) ||
      (mode === 'source' && typeof destination !== 'string'))
    throw new TypeError('Sample the composite, a layer or cel, or a surface-channel destination');
  const active = compile(design,frame,cel,mode === 'layer' && (layer ?? true));
  const { width,height } = active;
  if (!(mode === 'source' && coordinate === undefined && uv !== undefined) && !at(width,height,coordinate))
    throw new RangeError('Use a native pixel coordinate, or supply UV for a source channel');
  const common = { revision:active.revision,...frameMetadata(active),mode,
    ...(coordinate !== undefined && { at:coordinate }) };
  if (mode === 'source') {
    const { sample,frame:scope,...source } = Destinations.channelSource(Destinations.resolve(design,destination),context);
    if (scope !== undefined && scope !== active.id) throw new RangeError('The source channel is bound to frame ' + scope);
    const point = uv ?? pixelUV(width,height,coordinate);
    if (!Array.isArray(point) || point.length !== 2 || !Array.from(point).every(value =>
      Number.isFinite(value) && value >= 0 && value <= 1))
      throw new TypeError('A material sample needs unit UV coordinates');
    return { ...common,...source,uv:point,value:sample(point) };
  }
  const p = coordinate[1]*width+coordinate[0];
  if (mode === 'layer') {
    const target = layer ?? [...active.cels].find(([,id]) => id === cel)?.[0];
    const source = active.layerSources.get(target);
    if (!source) throw new RangeError('Unknown pixel layer ' + target);
    const slot = source.slots[p];
    return { ...common,layer:target,cel:active.cels?.get(target) ?? null,
      swatch:active.swatches[slot] ?? null,color:hexColor(active.colors[slot]),
      ...(source.alpha && { alpha:slot < 0 ? 0 : source.alpha[p] }),
      knockout:slot === -2,clipped:!!source.clipping && !source.clipping[p] };
  }
  const observed = cell(active,p);
  return { ...common,layer:observed.layer,cel:observed.cel ?? null,
    swatch:observed.swatch,color:active.slots[p] < 0 ? null : hexColor(active.mixedColors?.[p] ?? active.colors[active.slots[p]]),
    ...(active.opacity && { alpha:active.opacity[p] }),protected:observed.protected };
}

function captureBrush(design,{ selection,pixels,rect,frame,layer,cel,anchor,settings } = {}) {
  documentShape(design);
  if ([selection,pixels,rect].filter(value=>value !== undefined).length !== 1 ||
      layer !== undefined && cel !== undefined)
    throw new TypeError('Choose one brush selection and, optionally, one source layer or cel');
  if (selection !== undefined) {
    const saved = design.version === 2 && design.selections?.find(row=>row.id === selection);
    if (!saved) throw new RangeError('Unknown brush selection ' + selection);
    if (frame !== undefined && saved.frame !== undefined && frame !== saved.frame)
      throw new RangeError('Brush selection belongs to frame ' + saved.frame);
    frame ??= saved.frame;
    pixels = saved.pixels;
  }
  const compiled = compile(design,frame,cel,layer ?? (cel !== undefined));
  const { width,height,swatches,colors } = compiled;
  const target = layer ?? (cel !== undefined ? [...compiled.cels].find(([,id])=>id === cel)?.[0] : undefined);
  const source = target === undefined ? compiled : compiled.layerSources?.get(target);
  if (!source) throw new RangeError('Unknown brush source layer ' + target);
  return PixelBrushes.capture({ width,height,pixels,rect,anchor,settings,
    read(x,y) {
      const p = y*width+x, slot = source.slots[p];
      if (slot < 0 || source.alpha?.[p] === 0) return null;
      const color = source.mixedColors?.[p] ?? colors[slot];
      return { ...(color === colors[slot] && { id:swatches[slot] }),color:hexColor(color) };
    } });
}

function image(frame) {
  const rgb = new Uint8Array(frame.slots.length*3);
  for (let p = 0; p < frame.slots.length; p++) {
    if (frame.slots[p] < 0) continue;
    const color=frame.mixedColors?.[p] ?? frame.colors[frame.slots[p]], i=3*p;
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

function readPixelEdits(frame, patch, layer) {
  if (!Array.isArray(patch.edits) || !integer(patch.edits.length,1,4096))
    throw new TypeError('Pixel paint needs 1–4096 edits');
  const visited = new Set(), marks = [], issues = [];
  for (const change of patch.edits) {
    if (!record(change) || !at(frame.width,frame.height,change.at) || ![null,...frame.swatches].includes(change.to) ||
        !Object.hasOwn(change,'from') || !Object.hasOwn(change,'layer')) {
      issues.push({ code:'invalid-pixel', message:'A pixel edit needs at, from, layer and to',
        ...(Array.isArray(change?.at) && { at:change.at }) });
      continue;
    }
    const [x,y] = change.at, p = y*frame.width+x, state = cell(frame,p);
    let code;
    if (visited.has(p)) code = 'duplicate-pixel';
    else if (state.protected) code = 'protected-pixel';
    else if (state.swatch !== change.from || state.layer !== change.layer) code = 'pixel-changed';
    else if (layer !== undefined && state.layer !== null && state.layer !== layer) code = 'wrong-cel';
    visited.add(p);
    if (code) {
      issues.push({ code, at:change.at, message:'Pixel edit no longer applies at ' + change.at.join(','),
        expected:{ layer:change.layer, swatch:change.from }, actual:state });
      continue;
    }
    marks.push({ swatch:change.to, at:change.at });
  }
  if (issues.length) {
    const ErrorType = issues[0].code === 'invalid-pixel' ? TypeError : RangeError;
    throw Object.assign(new ErrorType(issues[0].message),{ conflicts:issues });
  }
  return marks;
}

function edit(design, frame, patch, context) {
  if (!record(patch) || !name(patch.id))
    throw new TypeError('Pixel edit needs the observed revision and a valid edit ID');
  if (patch.revision !== frame.revision)
    throw Preview.conflict('stale-document','Pixel edit needs the observed revision and a valid edit ID',
      { expected:patch.revision, actual:frame.revision },TypeError);
  const revision = fingerprint(design);
  if (frame.revision !== revision) throw Preview.conflict('stale-document','Pixel edit revision no longer matches the document',
    { expected:frame.revision, actual:revision });
  const route = Destinations.resolve(design,patch.destination);
  if (design.version === 2 && patch.frame !== frame.id &&
      (patch.frame !== undefined || (patch.cel === undefined && route.destination.kind !== 'guides')))
    throw Preview.conflict('wrong-frame','Pixel edit needs the observed frame ID',{ expected:patch.frame, actual:frame.id });
  if (patch.sourceRevision !== undefined && (!route.binding || !isRevision(patch.sourceRevision)))
    throw Preview.conflict('invalid-source-revision','An inspected sourceRevision must be a SHA-256 digest for a scene destination');
  if (route.destination.kind === 'guides') return editGuides(design,patch);
  if (route.destination.kind !== 'raster') {
    if (patch.cel !== undefined) throw new TypeError('A cel ID is a raster edit target');
    if (!context) throw new TypeError('Scene edit needs a scene context');
    return Destinations.apply(frame,patch,route,context,readPixelEdits);
  }
  if (patch.operation !== undefined) return editRasterTool(design,frame,patch,route.destination,context);
  if (patch.cel === undefined && frame.layerIds.includes(patch.id))
    throw new TypeError('A raster edit needs a new layer ID and pixel edits');
  if (patch.cel !== undefined) {
    const layer = frame.cels && [...frame.cels].find(([,id]) => id === patch.cel)?.[0];
    if (layer === undefined) throw new RangeError('Unknown pixel cel ' + patch.cel + ' on frame ' + frame.id);
    const marks = readPixelEdits(frame,patch,layer);
    const revised = { ...design, frames:design.frames.map(item => {
      if (item.id !== frame.id) return item;
      const cel = item.cels[layer];
      return { ...item, cels:{ ...item.cels, [layer]:{ ...cel, marks:[...cel.marks,...marks] } } };
    }) };
    const result = compile(revised,frame.id);
    const clipped = [];
    for (const { at:[x,y], swatch } of marks) {
      const state = cell(result,y*frame.width+x);
      if (state.cel !== patch.cel || state.swatch !== swatch)
        clipped.push({ code:'clipped-pixel', at:[x,y], message:'Pixel cel edit is clipped at ' + [x,y].join(',') });
    }
    if (clipped.length) throw Object.assign(new RangeError(clipped[0].message),{ conflicts:clipped });
    return revised;
  }
  const marks = readPixelEdits(frame,patch);
  const revised = design.version === 1
    ? { ...design, layers:[...design.layers,{ id:patch.id, marks }] }
    : { ...design, layers:[...design.layers,{ id:patch.id }], frames:design.frames.map(item =>
      item.id === frame.id ? { ...item, cels:{ ...item.cels, [patch.id]:{ marks } } } : item) };
  compile(revised,frame.id);
  return revised;
}

function editRasterTool(design,frame,patch,destination,context) {
  const { operation } = patch;
  if (patch.edits !== undefined || !fields(operation,['tool','layer','at','points','samples','swatch','pixelPerfect','shape','brush','shading','drawing']))
    throw new TypeError('A raster tool needs a layer or cel and a pencil, eraser, fill, shape or brush operation');
  const { tool,swatch,pixelPerfect,shape,brush,samples,shading,drawing } = operation;
  const fill = tool === 'fill', erase = tool === 'eraser', precise = tool === 'shape', brushing = tool === 'brush';
  if (pixelPerfect !== undefined && (tool !== 'pencil' || typeof pixelPerfect !== 'boolean'))
    throw new TypeError('Pixel-perfect cleanup is a boolean pencil option');
  const { width,height } = frame;
  const grid = drawing === undefined ? undefined : RasterTools.drawingGrid(width,height,drawing);
  const layer = patch.cel === undefined ? operation.layer : frame.cels &&
    [...frame.cels].find(([,id]) => id === patch.cel)?.[0];
  if (typeof layer !== 'string' || !frame.layerIds.includes(layer) ||
      (patch.cel !== undefined && operation.layer !== undefined))
    throw new TypeError('Choose an existing raster layer or cel for the paint tool');
  const slot = erase ? -1 : frame.swatches.indexOf(swatch);
  if (!['pencil','eraser','fill','shape','brush'].includes(tool) ||
      (erase ? swatch !== undefined : (!brushing || swatch !== undefined) && slot < 0))
    throw new TypeError('Paint tools need a known swatch or saved brush colors. Eraser clears the active layer.');
  if ((brush !== undefined) !== brushing) throw new TypeError('A brush operation needs a saved brush');
  if (shading !== undefined && (!brushing || swatch !== undefined && shading?.mode !== 'recolor'))
    throw new TypeError('Brush shading needs a saved tip. Only recolor accepts a swatch override.');
  if (precise ? operation.at !== undefined || operation.points !== undefined : shape !== undefined)
    throw new TypeError('Put shape geometry in the shape operation');
  if (samples !== undefined && (!brushing || operation.at !== undefined || operation.points !== undefined))
    throw new TypeError('Sampled brush motion replaces both at and points');
  const single = fill || brushing && operation.at !== undefined;
  const points = single ? [operation.at] : operation.points;
  if (!precise && samples === undefined) {
    if (single ? operation.points !== undefined : operation.at !== undefined ||
        !Array.isArray(points) || !integer(points.length,1,4096))
      throw new TypeError('Fill needs a seed pixel. Brush accepts one position or a path. Pencil and eraser need a path.');
    if (!Array.from(points).every(point => grid ? grid.contains(point) : at(width,height,point)))
      throw new RangeError('A paint tool needs points inside the native grid or its wrapping neighbors');
  }

  const captured = compile(design,frame.id,patch.cel,layer).layerSources.get(layer);
  const usable = p => !frame.locks[p] && (!captured.clipping || captured.clipping[p]);
  function check(p) {
    if (usable(p)) return;
    const code = frame.locks[p] ? 'protected-pixel' : 'clipped-pixel';
    throw Preview.conflict(code,'Paint tool cannot change this pixel',
      { at:[p%width,Math.floor(p/width)], layer });
  }
  let changed, added = [], brushMarks = [];
  if (brushing) {
    const result = brushChanges(design,frame,brush,slot,{ points,samples,shading },captured,check,grid);
    ({ changed,added,marks:brushMarks } = result);
  } else if (precise) {
    const mask = require('../index.js').load().KIT.pixelShapes.raster(width,height,shape,grid);
    changed = [];
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      check(p);
      if (captured.slots[p] !== slot) changed.push(p);
    }
  } else if (fill && grid) {
    grid.pixels(...points[0],check);
    changed = RasterTools.fillPixels(grid,points[0],(p,seed) =>
      captured.slots[seed] !== slot && usable(p) && captured.slots[p] === captured.slots[seed]);
  } else if (fill) {
    const first = points[0][1]*width+points[0][0], old = captured.slots[first];
    check(first);
    changed = old === slot ? [] : RasterTools.region(width,height,points[0],p => usable(p) && captured.slots[p] === old).sort();
  } else {
    const visited = new Set();
    const recordPixel = grid ? (x,y)=>grid.pixels(x,y,p=>visited.add(p)) : (x,y)=>{ visited.add(y*width+x); };
    const stroke = RasterTools.freehand(recordPixel,{ pixelPerfect });
    for (const point of points) stroke.add(point);
    recordPixel(...stroke.tip());
    for (const p of visited) check(p);
    changed = [...visited].filter(p => captured.slots[p] !== slot).sort((a,b) => a-b);
  }
  const runs = RasterTools.runs(width,changed), cel = frame.cels?.get(layer) ?? (frame.id && frame.id+'/'+layer);
  context?.onRasterTool?.({ destination:destination.id, kind:'raster', tool,frame:frame.id ?? null, layer,
    cel:cel ?? null, ...(pixelPerfect && { pixelPerfect }), ...(precise && { shape:shape.type }),
    ...(shading !== undefined && { shading:shading.mode }), ...(grid && { drawing }),
    ...(added.length && { addedSwatches:added.map(entry=>entry.id) }), pixelCount:changed.length,runs });
  if (!runs.length) return design;
  const marks = brushing ? brushMarks : [erase ? { clear:true,runs } : { swatch,runs }];
  const base = added.length ? { ...design,palette:{ ...design.palette,
    ...Object.fromEntries(added.map(entry=>[entry.id,entry.color])) } } : design;
  const revised = frame.id === undefined
    ? { ...base, layers:base.layers.map(item => item.id === layer ? { ...item, marks:[...item.marks,...marks] } : item) }
    : { ...base, frames:base.frames.map(item => {
      if (item.id !== frame.id) return item;
      const source = item.cels[layer];
      return { ...item, cels:{ ...item.cels, [layer]:{ ...source, marks:[...(source?.marks ?? []),...marks] } } };
    }) };
  compile(revised,frame.id);
  return revised;
}

function brushChanges(design,frame,brush,override,{ points,samples,shading },{ slots:current,alpha },check,grid) {
  const { width,height } = frame, stamps = new Map();
  const emit = (p,slot) => { stamps.set(p,slot); };
  if (samples === undefined) PixelBrushes.stroke(width,height,PixelBrushes.footprint(brush),points,emit,grid);
  else PixelBrushes.dynamicStroke(width,height,brush,samples,emit,grid);
  const resolve = shading === undefined ? null : PixelBrushes.shade(shading,frame.swatches);
  if (resolve) {
    for (const p of stamps.keys()) {
      const value = resolve(current[p],alpha?.[p] ?? 255);
      if (value === undefined) stamps.delete(p);
      else if (shading.mode !== 'recolor') stamps.set(p,value);
    }
  }
  for (const p of stamps.keys()) check(p);
  if (shading?.mode === 'alpha') {
    const changed = [...stamps.keys()].sort((a,b)=>a-b);
    return { changed,added:[],marks:changed.length ? [{ alpha:shading.value,runs:RasterTools.runs(width,changed) }] : [] };
  }

  const original = paletteEntries(design.palette,design.version);
  let palette = original;
  if (shading?.mode !== 'ramp') {
    const used = new Set(stamps.values());
    const resolved = override < 0 ? PixelBrushes.resolvePalette(brush,original,{ named:true,used })
      : { palette:original,mapping:Array(brush.palette.length).fill(override) };
    palette = resolved.palette;
    for (const [p,slot] of stamps) stamps.set(p,resolved.mapping[slot]);
  }
  const changed = [...stamps.keys()].filter(p=>current[p] !== stamps.get(p)).sort((a,b)=>a-b);
  const bySwatch = new Map();
  for (const p of changed) {
    const swatch = palette[stamps.get(p)].id;
    if (!bySwatch.has(swatch)) bySwatch.set(swatch,[]);
    bySwatch.get(swatch).push(p);
  }
  return { changed,added:palette.slice(original.length),
    marks:[...bySwatch].map(([swatch,pixels])=>({ swatch,runs:RasterTools.runs(width,pixels) })) };
}

function editGuides(design,patch) {
  const operation = patch.operation;
  if (patch.cel !== undefined || patch.edits !== undefined || !fields(operation,['upsert','remove']))
    throw new TypeError('A guide edit needs an upsert or remove operation');
  const { upsert = [], remove = [] } = operation;
  const changes = PixelGuides.prepare(upsert,new Set(design.frames.map(frame => frame.id)));
  if (!Array.isArray(remove) || !Array.from(remove).every(name) || new Set(remove).size !== remove.length ||
      changes.some(guide => remove.includes(guide.id)) || !changes.length && !remove.length)
    throw new TypeError('Guide edits need unique IDs and may update or remove each guide once');
  const guides = new Map((design.guides ?? []).map(guide => [guide.id,guide]));
  for (const id of remove) {
    if (!guides.delete(id)) throw Preview.conflict('missing-guide','Unknown pixel guide ' + id,{ guide:id });
  }
  for (const guide of changes) guides.set(guide.id,guide);
  const revised = { ...design, guides:[...guides.values()] };
  documentShape(revised);
  return revised;
}

const jsonValue = value => JSON.parse(JSON.stringify(value));

function replayReceipt(raw, runner) {
  if (raw?.format !== receiptFormat || raw.version !== 1 || raw.status !== 'applied' ||
      raw.command?.runner !== runner || raw.command.action !== 'edit' ||
      !record(raw.command.patch) || !record(raw.command.options) ||
      !isRevision(raw.inputs?.documentRevision) || !isRevision(raw.outputs?.artifactRevision))
    throw new TypeError('Replay needs an applied version 1 pixel edit receipt from the ' + runner);
  return raw;
}

function editWithReceipt(design, patch, context, { runner, options, frameId, shotHitFrame, expected, rawPatch = patch }) {
  const documentRevision = fingerprint(design);
  const command = { runner, action:'edit', options, patch:null };
  const inputs = { documentRevision };
  const common = { format:receiptFormat, version:1, command, inputs };
  const splats = [];
  let world, rasterTool;
  try {
    command.patch = jsonValue(rawPatch ?? null);
    if (expected && !equal(options,expected.command.options))
      throw Preview.conflict('receipt-arguments','Replay needs the same edit options recorded in the receipt');
    if (expected && documentRevision !== expected.inputs.documentRevision)
      throw Preview.conflict('stale-document','Receipt was recorded against a different pixel document',
        { expected:expected.inputs.documentRevision, actual:documentRevision });
    const frame = compile(design,frameId,patch?.cel);
    command.frame = frame.id ?? null;
    const route = Destinations.resolve(design,patch?.destination), { destination,binding } = route;
    if (shotHitFrame !== undefined && (destination.kind !== 'shot-correction' || !integer(shotHitFrame,0,1e9)))
      throw new TypeError('A shot hit sample needs a shot-correction edit and a nonnegative shot frame');
    const result = edit(design,frame,patch,{
      ...context,
      onSource(sourceRevision,source) {
        inputs.sourceRevision = sourceRevision;
        if (source.revision !== undefined) inputs.sourceContentRevision = source.revision;
        world = source.world;
        if (expected && !equal(inputs,expected.inputs))
          throw Preview.conflict('stale-source','Receipt was recorded against a different scene source',
            { binding:binding.id, expected:expected.inputs.sourceRevision, actual:sourceRevision });
      },
      onSplat: splat => splats.push(splat),
      onRasterTool: target => { rasterTool = target; }
    });
    let target = Preview.sourceTarget(route,patch), shotHits, skippedHits = [];
    if (rasterTool) target = rasterTool;
    else if (destination.kind === 'raster') {
      const layer = patch.cel === undefined ? patch.id : [...frame.cels].find(([,id]) => id === patch.cel)[0];
      target = { destination:destination.id, kind:'raster', frame:command.frame, layer,
        cel:frame.id === undefined ? null : patch.cel ?? frame.id+'/'+layer,
        pixels:patch.edits.map(({ at }) => at) };
    } else if (destination.kind === 'guides') {
      target = { destination:destination.id, kind:destination.kind, guides:Preview.guideChanges(design.guides,result.guides)
        .map(({ id,change }) => ({ id,change })) };
    } else if (destination.kind === 'shot-correction') {
      target.anchor = splats[0];
      shotHits = { status:'deferred-to-render' };
      if (shotHitFrame !== undefined) {
        const [w,h] = result.size, t = result.startTime + shotHitFrame / result.fps;
        const view = require('./render.js').render(world,{ w,h,px:1,t,raw:true,renderGrid:false,
          renderGraph:false,shutter:false,shotCorrections:result,shotCorrectionFrame:shotHitFrame,shotCorrectionHits:patch.id });
        if (!view.shotCorrections) throw new Error('The native render did not produce a shot correction report');
        const hit = view.shotCorrections.corrections.find(row => row.id === patch.id);
        shotHits = hit ? { status:'sampled', frame:shotHitFrame, time:t, at:hit.at, painted:hit.painted }
          : { status:'outside-frame-range', frame:shotHitFrame, time:t };
        skippedHits = hit?.skippedHits ?? [];
      }
    } else if (destination.kind === 'splat-attributes') {
      target.splats = splats;
    } else {
      target.node = 'solid:' + binding.object;
      if (patch.operation.modifier) target.modifier = patch.id;
      if (patch.operation.updateModifier) target.modifier = patch.operation.updateModifier.id;
    }
    const artifactRevision = fingerprint(result);
    const receipt = jsonValue({ ...common, status:'applied', affectedTargets:[target], skippedHits,
      ...(shotHits && { shotHits }), outputs:{ kind:destination.kind,
        documentRevision:binding ? documentRevision : artifactRevision, artifactRevision } });
    if (expected && !equal(receipt,expected))
      throw Preview.conflict('receipt-mismatch','Replay did not reproduce the recorded targets, hits, or output revisions');
    return { result,receipt };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const conflicts = Preview.conflicts(error);
    error.receipt = jsonValue({ ...common, status:'rejected', affectedTargets:[],
      skippedHits:conflicts.filter(issue => issue.at !== undefined || issue.splat !== undefined),
      conflicts, outputs:null });
    throw error;
  }
}

function upgradeLegacy(design) {
  const { format,version,width,height,palette,layers,...legacyMetadata } = design;
  const cels = Object.fromEntries(layers.map(({ id,marks,slots }) =>
    [id,{ id:'artwork/'+id, marks, ...(slots !== undefined && { slots }) }]));
  return { format, version:2, width, height, pixelAspect:[1,1], palette,
    layers:layers.map(({ marks,slots,...layer }) => layer),
    frames:[{ id:'artwork', durationMs:100, cels }],
    ...(Object.keys(legacyMetadata).length && { legacyMetadata })
  };
}

function openDesign(source) {
  const input = typeof source === 'string' ? JSON.parse(source) : source;
  const original = validate(input);
  const design = structuredClone(input);
  return original.version === 1 ? { design:upgradeLegacy(design), legacyRevision:original.revision }
    : { design, legacyRevision:null };
}

function sourceWarning(binding) {
  return { code:'unverified-source', binding, message:'Add the inspected sourceRevision to guard this scene edit' };
}

function previewEdit(design, patch, context, { frameId,limit } = {}) {
  Preview.previewLimit(limit);
  const targets = [], sources = [], warnings = [];
  let candidate = design, issues = [], source, sourceRevision;
  try {
    const route = Destinations.resolve(design,patch?.destination);
    const target = Preview.sourceTarget(route,patch);
    if (target) targets.push(target);
    const frame = compile(design,frameId ?? (design.version === 2 ? patch?.frame : undefined),patch?.cel);
    const output = edit(design,frame,patch,{
      onSource(revision) {
        sourceRevision = revision;
        if (patch.sourceRevision === undefined) warnings.push(sourceWarning(route.binding.id));
      },
      onRasterTool: target => targets.push(target),
      world:binding => context.world(binding),
      scene(binding) {
        const { editor,revision } = context.scene(binding);
        const fork = editor.fork();
        source = { scene:binding.scene, before:editor.snapshot(), fork };
        return { editor:fork, revision };
      }
    });
    if (!route.binding) candidate = output;
    if (source) sources.push(...Preview.sourceChanges(source.scene,source.before,source.fork.snapshot()));
  } catch (error) {
    issues = Preview.conflicts(error);
  }
  return Preview.report({ baseline:design,candidate,sources,targets,issues,warnings,sourceRevision,compile,cell,limit });
}

const persistentJournals = new WeakSet();

function sceneDependencies(editor) {
  const signature = editor.sourceDependencies();
  if (signature === undefined) throw new Error('Cannot verify dependencies for the pixel edit session scene');
  return createHash('sha256').update(signature).digest('hex');
}

function openEditorSession(directory,{ sceneEditor, env, resolveScene } = {}) {
  const loaded = Sessions.read(directory), saved = loaded.contents;
  if (!record(saved.baseline) || saved.baseline.design?.version !== 2 ||
      !(saved.baseline.legacyRevision === null || isRevision(saved.baseline.legacyRevision)) ||
      typeof saved.slot !== 'string' || !/^pixel-editor-[a-f0-9-]{36}$/.test(saved.slot))
    throw new Error('Invalid pixel edit session identity');
  validate(saved.baseline.design);
  if (saved.scene !== null) {
    if (!record(saved.scene) || !record(saved.scene.source) || !reference(saved.scene.ref) ||
        !isRevision(saved.scene.dependencies) ||
        (saved.scene.location !== undefined && !reference(saved.scene.location)))
      throw new Error('Invalid retained scene binding for the pixel edit session');
    const historyLimit = saved.journal?.historyLimit;
    sceneEditor ??= resolveScene?.(saved.scene,historyLimit) ??
      require('../index.js').createSceneEditor(saved.scene.source,{ env, historyLimit });
    if (!equal(sceneEditor.snapshot(),saved.scene.source) || sceneEditor.history().undo.length ||
        sceneEditor.history().redo.length)
      throw new Error('Reopen with a fresh editor for the retained scene source');
    if (sceneDependencies(sceneEditor) !== saved.scene.dependencies)
      throw new Error('The dependencies for the retained scene binding have changed');
  } else if (sceneEditor) throw new Error('This session has no attached scene');
  return createEditor(undefined,{ sceneEditor, sceneRef:saved.scene?.ref, sceneLocation:saved.scene?.location,
    historyLimit:saved.journal?.historyLimit, sessionDirectory:loaded.directory },loaded);
}

function createEditor(source,{ sceneEditor, sceneRef, sceneLocation, historyLimit, sessionDirectory } = {}, loaded) {
  const original = loaded?.contents.baseline ?? openDesign(source);
  const baseline = { ...original, renderOutputs:{}, receipts:[], verifiedReplays:[] };
  const { authoring } = require('../index.js').load().KIT;
  const journal = sceneEditor === undefined
    ? authoring.document(undefined,{ historyLimit })
    : authoring.sceneEditor.transactionDocument(sceneEditor);
  if (!journal) throw new TypeError('Use an Ink scene editor for a shared pixel transaction');
  const sceneName = sceneRef ?? sceneEditor?.snapshot().id;
  const retainedScene = loaded ? loaded.contents.scene?.source : sceneEditor?.snapshot();
  const slot = loaded?.contents.slot ?? 'pixel-editor-' + randomUUID();
  let cached = baseline, text, persistence;

  if (sessionDirectory !== undefined) {
    if (journal.pending() || persistentJournals.has(journal))
      throw new Error('Finish or close the existing edit session before attaching persistence');
    if ((sceneEditor && !reference(sceneName)) || (sceneLocation !== undefined && !reference(sceneLocation)))
      throw new TypeError('A persisted scene needs a valid source reference');
    if (loaded) {
      const identity = journal.snapshot().id;
      journal.restoreSession(loaded.contents.journal,(snapshot,{ draft }) => {
        if (snapshot.id !== identity || sceneEditor && snapshot.environment.id !== retainedScene.id)
          throw new Error('Session history does not belong to the retained document and scene');
        if (sceneEditor && !draft) authoring.sceneEditor.validateSnapshot(sceneEditor,snapshot.environment);
        const item = snapshot.entities[slot];
        if (!item) return;
        const data = JSON.parse(item.content);
        if (item.type !== 'pixel-document' || !record(data) || !Array.isArray(data.receipts) ||
            !Array.isArray(data.verifiedReplays) || !data.verifiedReplays.every(index => integer(index,0,data.receipts.length-1)) ||
            !record(data.renderOutputs) || !(data.legacyRevision === null || isRevision(data.legacyRevision)))
          throw new Error('Invalid retained pixel edit state');
        documentShape(data.design);
      });
    }
    persistence = Sessions.attach(sessionDirectory,() => ({
      slot, baseline:original, scene:sceneEditor ? { ref:sceneName, source:retainedScene,
        ...(sceneLocation !== undefined && { location:sceneLocation }), dependencies:sceneDependencies(sceneEditor) } : null
    }),journal,loaded);
    persistentJournals.add(journal);
  }

  function state() {
    const next = journal.get(slot)?.content;
    if (next !== text) {
      text = next;
      cached = next === undefined ? baseline : JSON.parse(next);
    }
    return cached;
  }

  function store(value) {
    // Keep the original pixel JSON, including legacy keys the scene format does not use.
    const content = JSON.stringify(value);
    if (journal.get(slot)) journal.update(slot,{ content });
    else journal.create('pixel-document',{ id:slot, content });
  }

  function renderOptions(scene) {
    const outputs = state().renderOutputs;
    return Object.hasOwn(outputs,scene) ? outputs[scene] : {};
  }

  function resolveScene(binding) {
    if (!sceneEditor || binding.scene !== sceneName)
      throw new RangeError('No attached scene editor for pixel binding ' + binding.id + ' (' + binding.scene + ')');
    return sceneEditor;
  }

  function requestFor({ design,legacyRevision }, patch) {
    const request = structuredClone(patch);
    if (legacyRevision !== null && request?.revision === legacyRevision) {
      request.revision = fingerprint(design);
      if (request.frame === undefined && request.cel === undefined) request.frame = 'artwork';
    }
    return request;
  }

  function editContext(context, grouped) {
    return {
      scene(binding) {
        if (grouped && !sceneEditor)
          throw new Error('Attach the source scene editor to group native scene and pixel edits');
        const supplied = context?.scene?.(binding);
        if (supplied) {
          if (sceneEditor && supplied.editor !== sceneEditor)
            throw new Error('The pixel transaction must use its attached scene editor');
          return supplied;
        }
        const editor = resolveScene(binding);
        return { editor, revision:fingerprint(editor.snapshot()) };
      },
      world(binding) {
        const world = context?.world?.(binding) ?? resolveScene(binding).build();
        return { ...world, look:{ ...world.look,...renderOptions(binding.scene) } };
      }
    };
  }

  function apply(patch,context,expected) {
    const grouped = journal.pending();
    const perform = () => {
      const draft = state(), { design } = draft;
      const request = requestFor(draft,patch);
      const adapter = editContext(context,grouped || !!expected || !!persistence);
      const shotHitFrame = expected ? expected.command.options.shotHitFrame : context?.shotHitFrame;
      const options = shotHitFrame === undefined ? {} : { shotHitFrame };
      const { result,receipt } = editWithReceipt(design,request,adapter,
        { runner:'sdk', options, frameId:request?.frame, shotHitFrame, expected, rawPatch:patch });
      const route = Destinations.resolve(design,request.destination), { destination,binding } = route;
      const next = { ...draft, receipts:[...draft.receipts,receipt] };
      if (expected && binding && request.sourceRevision === undefined)
        next.verifiedReplays = [...draft.verifiedReplays,draft.receipts.length];
      if (!binding) Object.assign(next,{ design:result, legacyRevision:null });
      const option = { 'shot-correction':'shotCorrections', 'splat-attributes':'splatFit' }[destination.kind];
      if (option) next.renderOutputs = { ...draft.renderOutputs,
        [binding.scene]:{ ...renderOptions(binding.scene), [option]:result }
      };
      store(next);
      return structuredClone(result);
    };
    if (!grouped) return journal.transact(patch?.id,perform);
    return journal.batchSession(() => {
      try {
        return perform();
      } catch (error) {
        journal.cancel();
        throw error;
      }
    });
  }

  function previewChanges({ limit } = {}) {
    Preview.previewLimit(limit);
    const before = journal.transactionBase();
    if (!before) throw new Error('No active transaction');
    const content = before.entities[slot]?.content;
    const base = content === undefined ? baseline : JSON.parse(content);
    const draft = state(), targetsByKey = new Map(), verifiedReplays = new Set(draft.verifiedReplays);
    for (let index = base.receipts.length; index < draft.receipts.length; index++) {
      const receipt = draft.receipts[index];
      const patch = receipt.command.patch, route = Destinations.resolve(draft.design,patch.destination);
      const target = Preview.sourceTarget(route,patch);
      if (target) {
        const key = JSON.stringify([target.scene,target.destination,target.id]);
        targetsByKey.set(key,{ ...target, sourceRevision:receipt.inputs.sourceRevision,
          sourceChecked:patch.sourceRevision !== undefined || verifiedReplays.has(index) });
      }
      const [painted] = receipt.affectedTargets;
      if (painted?.kind === 'raster' && painted.tool) targetsByKey.set(index,structuredClone(painted));
    }
    const targets = [...targetsByKey.values()];
    let candidate = state().design, scene = sceneEditor?.snapshot(), issues = [];
    try {
      journal.preview();
      candidate = state().design;
      scene = sceneEditor?.snapshot();
    } catch (error) {
      issues = Preview.conflicts(error);
    }
    const sources = Preview.sourceChanges(sceneName,before.environment,scene);
    const warnings = targets.filter(target => target.binding && !target.sourceChecked).map(target => sourceWarning(target.binding));
    return Preview.report({ baseline:base.design,candidate,sources,targets,issues,warnings,compile,cell,limit });
  }

  const editor = Object.freeze({
    sceneEditor,
    snapshot: () => structuredClone(state().design),
    serialize: (space = 2) => JSON.stringify(state().design,null,space),
    describe: () => validate(state().design),
    inspect: (coordinate,{ frame,cel } = {}) => inspect(compile(state().design,frame,cel),coordinate),
    sample: (coordinate,options = {}) => samplePixel(state().design,coordinate,options,editContext(options,false)),
    captureBrush: options => captureBrush(state().design,options),
    snap: (coordinate,{ frame,radius } = {}) => snapPoint(compile(state().design,frame),coordinate,radius),
    stamp: ({ frame,cel } = {}) => stamp(compile(state().design,frame,cel)),
    renderOptions: (scene = sceneName) => structuredClone(renderOptions(scene)),
    targets(destination,options = {}) {
      return inspectTargets(state().design,destination,editContext(options,false),options.limit);
    },
    apply: (patch,context) => apply(patch,context),
    receipts: () => structuredClone(state().receipts),
    replay(raw,context) {
      const receipt = replayReceipt(raw,'sdk');
      return apply(receipt.command.patch,context,receipt);
    },
    begin: label => { journal.begin(label); },
    preview() { journal.preview(); return editor.snapshot(); },
    previewChanges,
    previewEdit(patch,options = {}) {
      const { limit } = options;
      const draft = state();
      let request;
      try {
        request = requestFor(draft,patch);
      } catch (error) {
        return Preview.report({ baseline:draft.design, issues:Preview.conflicts(error),compile,cell,limit });
      }
      return previewEdit(draft.design,request,editContext(options,false),{ limit });
    },
    commit: journal.commit,
    cancel: journal.cancel,
    undo: journal.undo,
    redo: journal.redo,
    history: journal.history,
    sessionStatus: () => persistence ? { ...persistence.status(), pending:journal.pending() } : null,
    flushSession: () => persistence?.flush() ?? false,
    closeSession() {
      if (!persistence?.flush()) return false;
      persistence.detach();
      persistence = undefined;
      persistentJournals.delete(journal);
      return true;
    },
    transact(label,fn) {
      if (typeof fn !== 'function' || Object.prototype.toString.call(fn) === '[object AsyncFunction]')
        throw new TypeError('A pixel transaction needs a synchronous function');
      return journal.transact(label,() => fn(editor));
    }
  });
  return editor;
}

function stamp(frame) {
  const palette = frame.colors.map(hexColor), slots = Array.from(frame.slots,n=>n < 0 ? null : n);
  if (frame.mixedColors) {
    const ids = new Map(palette.map((rgb,slot)=>[rgb,slot]));
    for (let p = 0; p < slots.length; p++) {
      if (slots[p] === null || frame.mixedColors[p] === frame.colors[slots[p]]) continue;
      const rgb = hexColor(frame.mixedColors[p]);
      if (!ids.has(rgb)) {
        ids.set(rgb,palette.length);
        palette.push(rgb);
      }
      slots[p] = ids.get(rgb);
    }
  }
  return { width:frame.width,height:frame.height,origin:'top-left',palette,slots,
    ...(frame.opacity && { alpha:Array.from(frame.opacity) }),
    ...(frame.guides?.length && { guides:structuredClone(frame.guides) }) };
}

function snapPoint(frame,point,radius) {
  const { width,height,guides = [] } = frame;
  return { revision:frame.revision, ...frameMetadata(frame), input:point,
    ...PixelGuides.snap(guides,point,{ width,height,radius }) };
}

function snapOptions(opt) {
  const parts = typeof opt.at === 'string' ? opt.at.split(',') : [];
  if (parts.length !== 2 || parts.some(part => !part.trim())) throw new TypeError('Use --at x,y for guide snapping');
  const radius = typeof opt.radius === 'string' && opt.radius.trim() ? Number(opt.radius)
    : opt.radius === undefined ? undefined : NaN;
  return { point:parts.map(Number), radius };
}

function sampleOptions(opt) {
  const pair = (value,label) => {
    if (value === undefined) return;
    const parts = typeof value === 'string' ? value.split(',') : [];
    if (parts.length !== 2 || parts.some(part => !part.trim())) throw new TypeError('Use --'+label+' with two numbers');
    return parts.map(Number);
  };
  return { coordinate:pair(opt.at,'at'), options:{ mode:opt.mode,frame:opt.frame,layer:opt.layer,
    cel:opt.cel,destination:opt.destination,uv:pair(opt.uv,'uv') } };
}

function writeBrush(design,opt,source) {
  if (!reference(opt.out)) throw new TypeError('Use --out to save the brush JSON');
  const out = path.resolve(opt.out);
  if (out === source || path.dirname(out) === source && /^checkpoint-\d+\.json$/.test(path.basename(out)))
    throw new RangeError('Write the brush to a separate output');
  const tuple = (flag,length) => {
    const value = opt[flag];
    if (value === undefined) return;
    const args = typeof value === 'string' ? value.split(',') : [];
    if (args.length !== length || args.some(item=>!item.trim())) throw new TypeError('Use --'+flag+' with '+length+' numbers');
    return args.map(Number);
  };
  const settings = {};
  if (opt.angle !== undefined) settings.angle = typeof opt.angle === 'string' && opt.angle.trim() ? Number(opt.angle) : NaN;
  if (opt.size !== undefined) settings.size = tuple('size',2);
  if (opt.stabilization !== undefined || opt.pressure !== undefined || opt.velocity !== undefined) {
    const [speed,slow,fast] = tuple('velocity',3) ?? [];
    settings.dynamics = {
      ...(opt.stabilization !== undefined && { stabilization:typeof opt.stabilization === 'string' &&
        opt.stabilization.trim() ? Number(opt.stabilization) : NaN }),
      ...(opt.pressure !== undefined && { pressure:tuple('pressure',2) }),
      ...(speed !== undefined && { velocity:{ speed,size:[slow,fast] } })
    };
  }
  if (opt.tint !== undefined) {
    const entry = typeof opt.tint === 'string' && Object.hasOwn(design.palette ?? {},opt.tint) && design.palette[opt.tint];
    if (!entry) throw new RangeError('Choose a known swatch for --tint');
    settings.swatch = { mode:'tint',id:opt.tint,color:swatchColor(entry) };
  }
  const brush = captureBrush(design,{ selection:opt.selection,rect:tuple('rect',4),anchor:tuple('anchor',2),
    frame:opt.frame,layer:opt.layer,cel:opt.cel,settings });
  files.json(out,brush);
  return { file:out,format:brush.format,size:[brush.width,brush.height],anchor:brush.anchor };
}

function draw(frame,directory) {
  fs.mkdirSync(directory,{ recursive:true });
  const indexed = stamp(frame), result = review(frame), { w,h,rgb } = result.overlay;
  const art = path.join(directory,'art.png');
  if (indexed.alpha) files.write(art,PNG.encode(frame.width,frame.height,stampImage(indexed).rgba,4));
  else PNG.writeIndexed(art,frame.width,frame.height,indexed.slots,
    frame.colors.map(color=>[color>>>16,color>>>8&255,color&255]));
  files.write(path.join(directory,'review.png'),PNG.encode(w,h,rgb));
  files.json(path.join(directory,'stamp.json'),indexed);
  files.json(path.join(directory,'report.json'),result.report);
  return result.report;
}

function canvasReview(design,frameId,file,source) {
  documentShape(design);
  const palette = paletteEntries(design.palette,design.version), revision = fingerprint(design);
  const frames = design.version === 1 ? [undefined] : design.frames;
  if (frameId !== undefined && !frames.some(frame => frame?.id === frameId))
    throw new RangeError('Unknown pixel frame ' + frameId);
  const chosen = frameId === undefined ? frames : frames.filter(frame => frame.id === frameId);
  if (source?.frame !== undefined && !chosen.some(frame => frame?.id === source.frame))
    throw new RangeError('The source channel is bound to frame ' + source.frame);
  const encodeSlots = slots => Buffer.from(Uint8Array.from(slots,slot => slot < 0 ? 255 : slot)).toString('base64');
  const deck = chosen.map(frame => {
    const compiled = compileFrame(design,frame,revision,palette,true);
    const { width,height,rgba } = stampImage(stamp(compiled));
    const encode = bytes => Buffer.from(bytes).toString('base64');
    return { label:frame?.label ?? frame?.id ?? 'Drawing', png:encode(PNG.encode(width,height,rgba,4)),
      guides:compiled.guides ?? [], id:frame?.id, composite:encodeSlots(compiled.slots),
      ...(compiled.opacity && { alpha:encode(compiled.opacity),rgb:encode(image(compiled).rgb) }),
      layers:[...compiled.layerSources].map(([id,row]) => ({
        id,slots:encodeSlots(row.slots),...(row.alpha && { alpha:encode(row.alpha) })
      })) };
  });
  let material = null;
  if (source) {
    const { sample,...metadata } = source, { width,height } = design;
    const count = source.type === 'number' ? 1 : 4, values = Buffer.alloc(width*height*count*8);
    for (let p=0; p<width*height; p++) {
      const value = sample(pixelUV(width,height,[p%width,Math.floor(p/width)]));
      if (count === 1) values.writeDoubleLE(value,p*8);
      else if (value) [...value.color,value.coverage].forEach((component,i) => values.writeDoubleLE(component,(p*4+i)*8));
    }
    material = { ...metadata,values:values.toString('base64') };
  }
  const template = fs.readFileSync(path.join(__dirname,'pixel-grid-review.html'),'utf8');
  const browserSource = ext => fs.readFileSync(path.join(__dirname,'../src/pixel-grid-canvas.'+ext),'utf8');
  const data = JSON.stringify({ frames:deck,palette,material }).replaceAll('<','\\u003c');
  files.write(file,template.replace('/*PIXEL_GRID_CSS*/',() => browserSource('css'))
    .replace('/*PIXEL_GUIDES_MODULE*/',() => fs.readFileSync(path.join(__dirname,'../src/pixel-guides.js'),'utf8'))
    .replace('/*PIXEL_GRID_MODULE*/',() => browserSource('mjs'))
    .replace('/*PIXEL_GRID_DATA*/',() => data));
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
  if (scene !== undefined)
    design.sceneBindings = [{ id:'projection', scene, object, frame:'capture', layer:'projection' }];
  return design;
}

function command(pos,opt,outputFile,{ capture, world, scene }) {
  const [action, source, patch] = pos;
  const writing = action === 'edit' || action === 'replay';
  if (!['trace','upgrade','validate','targets','draw','canvas','inspect','sample','snap','brush','preview','edit','replay'].includes(action) ||
      pos.length !== (writing || action === 'preview' ? 3 : 2))
    throw new TypeError('Use pixel-art trace, upgrade, validate, targets, draw, canvas, inspect, sample, snap, brush, preview, edit, or replay. See ink-studio help.');
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
  if (action === 'brush') {
    process.stdout.write(JSON.stringify(writeBrush(design,opt,path.resolve(source)),null,2)+'\n');
    return;
  }
  if (action === 'upgrade') {
    if (typeof opt.out !== 'string' || !opt.out.trim())
      throw new TypeError('Use pixel-art upgrade <design.json> --out <document.json>');
    files.json(path.resolve(opt.out),openDesign(design).design);
    return;
  }
  if (action === 'validate') {
    process.stdout.write(JSON.stringify(validate(design),null,2)+'\n');
    return;
  }
  const out = writing && typeof opt.out === 'string' ? path.resolve(opt.out) : undefined;
  function sourceFor(binding) {
    const sameFile = typeof opt.scene === 'string' && /\.(?:js|json)$/i.test(binding.scene) &&
      path.resolve(opt.scene) === path.resolve(binding.scene);
    if (opt.scene !== binding.scene && !sameFile)
      throw new TypeError('Pass --scene ' + binding.scene + ' to use the bound source');
    if (out && [source,patch,binding.scene].some(file => path.resolve(file) === out))
      throw new RangeError('Write the scene edit to a separate output from its inputs');
    return opt.scene;
  }
  const context = {
    world:binding => world(sourceFor(binding)),
    scene:binding => scene(sourceFor(binding))
  };
  if (action === 'canvas') {
    if (typeof opt.out !== 'string' || !/\.html$/i.test(opt.out) || path.resolve(opt.out) === path.resolve(source))
      throw new TypeError('Use pixel-art canvas <design.json> --out <canvas.html>');
    let channel;
    if (opt.scene !== undefined || opt.destination !== undefined) {
      if (!reference(opt.destination) || !reference(opt.scene))
        throw new TypeError('Use --scene and --destination together to include a source material channel');
      documentShape(design);
      channel = Destinations.channelSource(Destinations.resolve(design,opt.destination),context);
    }
    const file = path.resolve(opt.out);
    canvasReview(design,opt.frame,file,channel);
    console.log('wrote',file);
    return;
  }
  if (action === 'sample') {
    const { coordinate,options } = sampleOptions(opt);
    process.stdout.write(JSON.stringify(samplePixel(design,coordinate,options,context),null,2)+'\n');
    return;
  }
  if (action === 'targets') {
    const limit = opt.limit === undefined ? undefined : typeof opt.limit === 'string' ? Number(opt.limit) : NaN;
    if (typeof opt.destination !== 'string')
      throw new TypeError('Use pixel-art targets <design.json> --destination id --scene <bound scene> [--limit count]');
    const report = inspectTargets(design,opt.destination,context,limit);
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    return;
  }
  if (action === 'preview') {
    const limit = opt.limit === undefined ? undefined : typeof opt.limit === 'string' ? Number(opt.limit) : NaN;
    const report = previewEdit(design,read(patch),context,{ frameId:opt.frame,limit });
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if (!report.valid) process.exitCode = 2;
    return;
  }
  if (writing) {
    if (!out) throw new TypeError('Use --out revised.json to save the edit');
    if (action === 'replay' && [source,patch].some(file => path.resolve(file) === out))
      throw new RangeError('Write the replay to a separate output from its inputs');
    const input = read(patch);
    const expected = action === 'replay' ? replayReceipt(input,'cli') : undefined;
    const changes = expected ? expected.command.patch : input;
    const options = Object.fromEntries(Object.entries(opt).filter(([key]) => key !== 'out'));
    const sample = opt['shot-hit-frame'];
    const shotHitFrame = sample === undefined ? undefined : typeof sample === 'string' && /^\d+$/.test(sample)
      ? Number(sample) : NaN;
    let receipt, result;
    try {
      ({ receipt,result } = editWithReceipt(design,changes,context,{ runner:'cli', options,
        frameId:opt.frame ?? (design.version === 2 ? changes?.frame : undefined), shotHitFrame, expected }));
    } catch (error) {
      if (error.receipt) process.stdout.write(JSON.stringify(error.receipt,null,2)+'\n');
      throw error;
    }
    files.json(out,result);
    process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
    return;
  }
  const frame = compile(design,opt.frame);
  if (action === 'snap') {
    const { point,radius } = snapOptions(opt);
    process.stdout.write(JSON.stringify(snapPoint(frame,point,radius),null,2)+'\n');
    return;
  }
  if (action === 'inspect') {
    const coordinate = /^\d+,\d+$/.test(opt.at ?? '') ? opt.at.split(',').map(Number) : null;
    if (!at(frame.width,frame.height,coordinate)) throw new RangeError('Use --at x,y inside the native grid');
    process.stdout.write(JSON.stringify(inspect(frame,coordinate),null,2)+'\n');
    return;
  }
  if (action === 'draw') {
    const directory=outputFile('pixel-art');
    draw(frame,directory);
    console.log('wrote',directory);
    return;
  }
}

function inspectTargets(design,destination,context,limit = 128) {
  documentShape(design);
  if (!integer(limit,1,Number.MAX_SAFE_INTEGER)) throw new RangeError('Pixel target limit must be a positive integer');
  const targets = Destinations.targets(Destinations.resolve(design,destination),context,limit);
  return { documentRevision:fingerprint(design), ...targets };
}

function sessionCommand(pos,opt,{ scene }) {
  const [action,directory,input] = pos;
  const argc = ['init','apply'].includes(action) ? 3 : 2;
  if (pos.length !== argc || !['init','status','begin','apply','preview','commit','cancel','undo','redo',
    'inspect','sample','snap','brush','targets','export'].includes(action))
    throw new TypeError('Use pixel-art session init, status, begin, apply, preview, commit, cancel, undo, redo, inspect, sample, snap, brush, targets, or export');

  let editor, result;
  if (action === 'init') {
    const design = read(input);
    const sceneRef = opt.scene;
    if (sceneRef !== undefined && !reference(sceneRef)) throw new TypeError('--scene needs an editable diorama path');
    const sceneLocation = sceneRef === undefined ? undefined : path.resolve(sceneRef);
    documentShape(design);
    const bindings = design.version === 2 ? design.sceneBindings ?? [] : [];
    const binding = bindings.find(row => row.scene === sceneRef) ??
      bindings.find(row => sceneLocation && path.resolve(row.scene) === sceneLocation);
    const sceneEditor = sceneLocation && scene(sceneLocation).editor;
    editor = createEditor(design,{ sessionDirectory:directory, sceneEditor, sceneLocation, sceneRef:binding?.scene ?? sceneRef });
  } else {
    editor = openEditorSession(directory,{ resolveScene(retained,historyLimit) {
      return retained.location && scene(retained.location,retained.source,historyLimit).editor;
    } });
    if (action === 'begin') {
      if (opt.label !== undefined && !reference(opt.label)) throw new TypeError('--label needs a transaction name');
      editor.begin(opt.label);
    } else if (action === 'apply') {
      const sample = opt['shot-hit-frame'];
      const shotHitFrame = sample === undefined ? undefined : typeof sample === 'string' && /^\d+$/.test(sample)
        ? Number(sample) : NaN;
      editor.apply(read(input),{ shotHitFrame });
      result = editor.receipts().at(-1);
    } else if (action === 'preview') {
      const limit = opt.limit === undefined ? undefined : typeof opt.limit === 'string' ? Number(opt.limit) : NaN;
      result = editor.previewChanges({ limit });
      if (!result.valid) process.exitCode = 2;
    } else if (action === 'inspect') {
      if (!/^\d+,\d+$/.test(opt.at ?? '')) throw new TypeError('Use --at x,y inside the native grid');
      result = editor.inspect(opt.at.split(',').map(Number),{ frame:opt.frame, cel:opt.cel });
    } else if (action === 'sample') {
      const { coordinate,options } = sampleOptions(opt);
      result = editor.sample(coordinate,options);
    } else if (action === 'brush') {
      result = writeBrush(editor.snapshot(),opt,path.resolve(directory));
    } else if (action === 'snap') {
      const { point,radius } = snapOptions(opt);
      result = editor.snap(point,{ frame:opt.frame, radius });
    } else if (action === 'targets') {
      if (!reference(opt.destination)) throw new TypeError('--destination needs a destination ID');
      const limit = opt.limit === undefined ? undefined : typeof opt.limit === 'string' ? Number(opt.limit) : NaN;
      result = editor.targets(opt.destination,{ limit });
    } else if (action === 'export') {
      if (!reference(opt.out)) throw new TypeError('--out needs a file path');
      const out = path.resolve(opt.out), artifact = opt.artifact ?? 'document';
      if (path.dirname(out) === path.resolve(directory) && /^checkpoint-\d+\.json$/.test(path.basename(out)))
        throw new RangeError('Choose an output outside the session checkpoints');
      let data;
      if (artifact === 'document') data = editor.snapshot();
      else if (artifact === 'scene') data = editor.sceneEditor?.snapshot();
      else if (artifact === 'shot-corrections' || artifact === 'splat-fit')
        data = editor.renderOptions(opt.scene)[artifact === 'shot-corrections' ? 'shotCorrections' : 'splatFit'];
      if (data === undefined) throw new Error('No session artifact named ' + artifact);
      files.json(out,data);
      result = { artifact, file:out };
    } else if (action !== 'status') {
      const changed = editor[action]();
      result = { ...editor.sessionStatus(), history:editor.history(), changed };
    }
  }
  const status = editor.sessionStatus();
  if (!status.saved) throw new Error(status.error);
  process.stdout.write(JSON.stringify(result ?? { ...status, history:editor.history(),
    documentRevision:editor.describe().revision },null,2)+'\n');
}

module.exports = { createEditor, openEditorSession, compile, validate, stamp, image, review, edit, draw, trace, command, sessionCommand };
