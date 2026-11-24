'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual:equal } = require('node:util');
const { paint, image:stampImage } = require('../src/pixel-stamps.js');
const PixelGuides = require('../src/pixel-guides.js');
const RasterTools = require('../src/pixel-paint-tools.js');
const PixelBrushes = require('../src/pixel-brushes.js');
const PixelSelections = require('../src/pixel-selections.js');
const PixelTransforms = require('../src/pixel-selection-transforms.js');
const CanvasTransforms = require('../src/pixel-canvas-transforms.js');
const PixelAdjustments = require('../src/pixel-adjustments.js');
const LayerStack = require('../src/pixel-layer-stack.js');
const Timeline = require('./pixel-cel-timeline.js');
const PixelInspection = require('../src/pixel-inspection.js');
const ViewSource = require('../src/pixel-view-source.js');
const SourceBindings = require('../src/pixel-source-bindings.js');
const Protection = require('../src/pixel-protection.js');
const ArtPasses = require('../src/art-passes.js');
const PixelColors = require('../src/pixel-raster-colors.js');
const PixelPalette = require('../src/pixel-palette.js');
const PaletteExtract = require('../src/palette-extract.js');
const SelectionSources = require('./pixel-selection-sources.js');
const PNG = require('./png.js');
const Craft = require('../src/pixel-craft.js');
const Motion = require('../src/pixel-motion-checks.js');
const MotionReview = require('./pixel-motion-review.js');
const SelectionTrack = require('./pixel-selection-track.js');
const TrackedCorrection = require('./pixel-tracked-correction.js');
const ArtRules = require('../src/pixel-art-rules.js');
const Cleanup = require('../src/pixel-cleanup.js');
const files = require('./asset-files.js');
const Destinations = require('./pixel-edit-destinations.js');
const Preview = require('./pixel-edit-preview.js');
const SplatPreview = require('./pixel-splat-preview.js');
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
const { celName,celId,getCel } = Timeline;
const swatchColor = value => typeof value === 'string' ? value : value?.color;

function paletteEntries(palette, version) {
  const entries = Object.entries(palette);
  if (!integer(entries.length,1,255) || entries.some(([id,value]) => !name(id) ||
      (typeof value !== 'string' && !(version === 2 && fields(value,['color','label','locked']) && label(value.label) &&
        (value.locked === undefined || typeof value.locked === 'boolean'))) ||
      typeof swatchColor(value) !== 'string' || !/^#[\da-f]{6}$/i.test(swatchColor(value))))
    throw new TypeError('Pixel palettes need 1–255 RGB swatches keyed by stable ID');
  return entries.map(([id,value]) => ({ id,color:swatchColor(value),
    ...(value.label !== undefined && { label:value.label }),...(value.locked && { locked:true }) }));
}

function paletteAsset(design) {
  return PixelPalette.asset(paletteEntries(design.palette,design.version),design.version === 2 ? design.ramps : undefined);
}

function paletteDefinition(swatches) {
  return Object.fromEntries(swatches.map(({ id,color,label,locked })=>[id,
    label === undefined && !locked ? color : { color,...(label !== undefined && { label }),...(locked && { locked:true }) }]));
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
    'selections','protectedDetails','sceneBindings','destinations','guides','ramps','legacyMetadata','artRules','tags']))
    throw new TypeError('Unknown pixel document field');
  if (design.ramps !== undefined) paletteAsset(design);
  if (legacyMetadata !== undefined && !record(legacyMetadata)) throw new TypeError('Legacy pixel metadata must be an object');
  if (!Array.isArray(pixelAspect) || pixelAspect.length !== 2 ||
      !integer(pixelAspect[0],1,Number.MAX_SAFE_INTEGER) || !integer(pixelAspect[1],1,Number.MAX_SAFE_INTEGER))
    throw new RangeError('Pixel aspect needs two positive integers [width,height]');
  const { rows:layerRows } = LayerStack.prepare(layers);
  if (!Array.isArray(frames) || !frames.length) throw new TypeError('Pixel documents need at least one frame');
  const frameIds = new Set();
  for (const frame of frames) {
    if (!fields(frame,['id','label','durationMs','cels']) || !name(frame.id) || frameIds.has(frame.id) || !label(frame.label) ||
        !integer(frame.durationMs,1,Number.MAX_SAFE_INTEGER) || !record(frame.cels))
      throw new TypeError('Pixel frames need unique IDs, positive integer durations in milliseconds and cels');
    frameIds.add(frame.id);
    for (const [layer,cel] of Object.entries(frame.cels)) {
      if (!layerRows.has(layer) || layerRows.get(layer).kind === 'group' ||
          !fields(cel,['id','label','marks','slots','offset','hold']) || !label(cel.label) ||
          (cel.hold === undefined ? !Array.isArray(cel.marks) :
            !celName(cel.hold) || cel.marks !== undefined || cel.slots !== undefined) ||
          (cel.id !== undefined && !celName(cel.id)) ||
          (cel.offset !== undefined && !LayerStack.validOffset(cel.offset)))
        throw new TypeError('Pixel cel ' + frame.id + '/' + layer + ' needs a known layer and valid marks or hold, ID and offset');
    }
  }
  const timed = Timeline.timing(frames);
  if (design.tags !== undefined) Timeline.validateTags(design,timed);
  const lookup = Timeline.index(frames);
  namedRegions(selections,'Pixel selections',width,height,frameIds);
  Protection.validate(protectedDetails,width,height,[...frameIds]);
  PixelGuides.prepare(guides,frameIds);
  rulesFor(design);
  if (!Array.isArray(sceneBindings)) throw new TypeError('Pixel scene bindings must be an array');
  const bindingIds = new Set();
  for (const binding of sceneBindings) {
    if (!fields(binding,['id','scene','object','part','revision','frame','layer','canvas','mapping','stale']) || !name(binding.id) ||
        bindingIds.has(binding.id) || !reference(binding.scene) || !reference(binding.object) ||
        (binding.part !== undefined && !reference(binding.part)) ||
        (binding.revision !== undefined && !reference(binding.revision)) ||
        (binding.frame !== undefined && !frameIds.has(binding.frame)) ||
        (binding.layer !== undefined && !layerRows.has(binding.layer)) ||
        (binding.canvas !== undefined && !CanvasTransforms.registered(binding.canvas)))
      throw new TypeError('Pixel scene bindings need unique IDs, scene and object references, and valid frame and layer scopes');
    if (binding.mapping !== undefined && (!binding.part || !SourceBindings.registeredMapping(binding.mapping)))
      throw new TypeError('A pixel source mapping needs a part and a valid version 1 registration');
    if (binding.stale !== undefined && !SourceBindings.validStale(binding.stale,width,height))
      throw new TypeError('Stale binding pixels need ordered, non-overlapping native row runs');
    bindingIds.add(binding.id);
  }
  Destinations.validate(destinations,bindingIds);
  for (const layer of layers) if (layer.kind === 'surface') {
    const destination = destinations?.find(row=>row.id === layer.destination && ['surface-channel','decal-layer'].includes(row.kind));
    const binding = destination && sceneBindings.find(row=>row.id === destination.binding);
    if (!binding || binding.layer !== undefined && binding.layer !== layer.id)
      throw new RangeError('Surface layer '+layer.id+' needs a matching material channel or decal destination');
  }
  return lookup;
}

function rulesFor(design) {
  if (design.version !== 2 || design.artRules === undefined) return;
  return ArtRules.prepare(design.artRules,{ swatches:paletteEntries(design.palette,2),ramps:design.ramps,
    layers:design.layers,frames:design.frames.map(row=>row.id),selections:design.selections });
}

function artRulesReport(design,{ frame,shot,layer } = {}) {
  documentShape(design);
  if (frame !== undefined && !design.frames?.some(row=>row.id === frame)) throw new RangeError('Unknown pixel frame '+frame);
  if (layer !== undefined && !design.layers.some(row=>row.id === layer)) throw new RangeError('Unknown pixel layer '+layer);
  const plan = rulesFor(design), options = { frame,shot,layer };
  return { revision:fingerprint(design),...options,active:ArtRules.describe(plan,options),
    scene:ArtRules.scene(plan,options),definition:design.artRules ?? null };
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

function composite(width,height,entries,layers,capture,options,legacy = false) {
  const size = width*height, swatches = entries.map(row=>row.id);
  const colors = entries.map(row=>Number.parseInt(row.color.slice(1),16));
  const ids = new Map(swatches.map((id,i)=>[id,i])), erase = swatches.length;
  const byId = new Map(layers.map(row=>[row.id,row]));
  const stack = LayerStack.prepare(layers.map(({ slots,marks,sourceOffset,...layer })=>{
    if (legacy && (sourceOffset !== undefined || !fields(layer,['id','clip','protect'])))
      throw new TypeError('Legacy layers need a unique ID, marks and optional clipping or protection');
    return layer;
  }));
  let marksUsed = 0, runBudget = 32e6;
  const compiled = LayerStack.compose(width,height,colors,stack,id=>{
    const layer = byId.get(id);
    if (!Array.isArray(layer.marks)) throw new TypeError('Pixel layers need marks');
    let base;
    if (layer.slots !== undefined) {
      if (!Array.isArray(layer.slots) || layer.slots.length !== size)
        throw new TypeError('Pixel layer slots need a named swatch or null per art pixel');
      base = Array.from(layer.slots,swatch=>{
        if (swatch === null) return null;
        if (!ids.has(swatch)) throw new TypeError('Unknown pixel swatch '+swatch);
        return ids.get(swatch);
      });
    }
    const { painted,alpha } = rasterLayer(layer,base,ids,width,height,erase,operations=>{
      if ((marksUsed += operations) > 4096) throw new RangeError('Pixel designs support up to 4096 drawing operations');
    },size=>{
      if ((runBudget -= size) < 0) throw new RangeError('Pixel runs exceed the drawing budget');
    });
    const source = { slots:Int16Array.from(painted,slot=>slot === null ? -1 : slot === erase ? -2 : slot),...(alpha && { alpha }) };
    return layer.sourceOffset ? Timeline.translate(width,height,source,layer.sourceOffset) : source;
  },{ ...options,capture });
  return { ...compiled,colors,swatches,layerStack:stack };
}

function frameProtection(design,frame) {
  if (!design.protectedDetails?.length) return [];
  const frames = design.frames.map(row=>row.id);
  return Protection.active(design.protectedDetails,frames,frames.indexOf(frame));
}

function celLayers(layers,frame,lookup,cels) {
  return layers.map(layer=>{
    const { id } = layer, cel = getCel(frame,id);
    if (cel) cels?.set(id,celId(frame,id,cel));
    const content = Timeline.content(cel,lookup);
    return { ...layer,marks:content?.marks ?? [],slots:content?.slots,sourceOffset:Timeline.offset(layer,cel) };
  });
}

function compileFrame(design, frame, revision, palette,capture,options,lookup) {
  const { width,height,layers } = design;
  if (!frame) return { ...composite(width,height,palette,layers,capture,options,true), revision,paletteEntries:palette };
  const cels = new Map();
  const stack = celLayers(layers,frame,lookup ?? Timeline.index(design.frames),cels);
  const raster = composite(width,height,palette,stack,capture,options);
  const protectedDetails = frameProtection(design,frame.id), layerLocks = raster.locks;
  if (protectedDetails.length) {
    raster.locks = layerLocks.slice();
    Protection.paintLocks(protectedDetails,width,raster,{ validateGaps:!options?.references });
  }
  return { ...raster,layerLocks,protectedDetails,cels, revision,paletteEntries:palette,ramps:design.ramps, id:frame.id, durationMs:frame.durationMs, pixelAspect:design.pixelAspect.slice(),
    ...(design.guides && { guides:PixelGuides.active(design.guides,frame.id) }),
    ...(design.sceneBindings?.length && { sceneBindings:design.sceneBindings.filter(row=>row.frame === undefined || row.frame === frame.id) }),
    ...(design.selections && { selections:design.selections.filter(row=>row.frame === undefined || row.frame === frame.id) }) };
}

function compile(design, frameId, targetCel, capture,options) {
  const lookup = documentShape(design);
  const frames = design.version === 2 ? design.frames : [];
  const hasCel = item => Object.entries(item.cels).some(([layer,cel]) => celId(item,layer,cel) === targetCel);
  let frame;
  if (frameId !== undefined) frame = frames.find(item => item.id === frameId);
  else if (targetCel !== undefined) frame = frames.find(hasCel);
  else frame = frames[0];
  if (frameId !== undefined && !frame) throw new RangeError('Unknown pixel frame ' + frameId);
  if (targetCel !== undefined && (!frame || !hasCel(frame)))
    throw new RangeError('Unknown pixel cel ' + targetCel + (frame ? ' on frame ' + frame.id : ''));
  return compileFrame(design,frame,fingerprint(design),paletteEntries(design.palette,design.version),capture,options,lookup);
}

function validate(design) {
  const lookup = documentShape(design);
  const revision = fingerprint(design);
  const frames = design.version === 1 ? [undefined] : design.frames;
  const palette = paletteEntries(design.palette,design.version);
  for (const frame of frames) {
    try {
      compileFrame(design,frame,revision,palette,undefined,undefined,lookup);
    } catch (error) {
      if (!frame) throw error;
      throw new Error('Pixel frame ' + frame.id + ': ' + error.message, { cause:error });
    }
  }
  const identities = design.version === 2 ? {
    layers:design.layers.map(layer=>({ ...layer })),
    swatches:palette,
    cels:frames.flatMap(frame => Object.entries(frame.cels).map(([layer,cel]) =>
      ({ id:celId(frame,layer,cel), frame:frame.id, layer, ...(cel.label !== undefined && { label:cel.label }) })))
  } : undefined;
  return { format, version:design.version, revision, grid:[design.width,design.height],
    pixelAspect:design.version === 1 ? [1,1] : design.pixelAspect, frames:frames.map(frame => ({
      id:frame?.id ?? null, durationMs:frame?.durationMs ?? null, ...(frame?.label !== undefined && { label:frame.label })
    })), ...(identities && { identities }),
    ...(design.version === 2 && design.artRules !== undefined && { artRules:structuredClone(design.artRules) }),
    ...(design.version === 2 && design.protectedDetails !== undefined && { protectedDetails:structuredClone(design.protectedDetails) }),
    ...(design.version === 2 && design.ramps !== undefined && { ramps:structuredClone(design.ramps) }),
    ...(design.version === 2 && design.tags !== undefined && { tags:structuredClone(design.tags) }),
    ...(design.version === 2 && design.guides && { guides:structuredClone(design.guides) }),
    ...(design.version === 2 && design.destinations !== undefined && { destinations:design.destinations }) };
}

function timelineReport(design) {
  const lookup = documentShape(design);
  if (design.version !== 2) throw new TypeError('Upgrade to a version 2 document to inspect the cel timeline');
  return Timeline.describe(design,fingerprint(design),lookup);
}

function cell(frame,p) {
  const layer = frame.layerIds[frame.owners[p]];
  const under = frame.layerIds[frame.underOwners?.[p] ?? 0];
  return { at:[p%frame.width,Math.floor(p/frame.width)], layer,
    ...(frame.cels && { cel:frame.cels.get(layer) ?? null }),
    swatch:frame.swatches[frame.slots[p]] ?? null, protected:!!frame.locks[p],
    ...(frame.opacity && { alpha:frame.opacity[p] }),
    underneath:{ layer:under, ...(frame.cels && { cel:frame.cels.get(under) ?? null }),
      swatch:frame.swatches[frame.underSlots?.[p]] ?? null }
  };
}

function sameScene(ref,requested) {
  return ref === requested || (typeof requested === 'string' && /\.(?:js|json|obj|gltf|glb|ply|spz|gsz)$/i.test(ref) &&
    path.resolve(requested) === path.resolve(ref));
}

function inspectionMaterials(design,destinations,context,frame) {
  const names = destinations ?? (context?.sceneRef === undefined ? [] : (design.destinations ?? [])
    .filter(row=>row.kind === 'surface-channel' && design.sceneBindings.some(binding=>
      binding.id === row.binding && sameScene(binding.scene,context.sceneRef) &&
      (frame === undefined || binding.frame === undefined || binding.frame === frame))).map(row=>row.id));
  if (!Array.isArray(names) || !Array.from(names).every(reference) || new Set(names).size !== names.length)
    throw new TypeError('Choose a list of distinct surface destinations to inspect');
  return names.map(id=>({ name:id,...Destinations.channelSource(Destinations.resolve(design,id),context) }));
}

function inspectMaterial(source,coordinate,width,height) {
  const { name,sample,canvas,...metadata } = source, uv = pixelUV(width,height,coordinate,canvas);
  return { ...metadata,requestedDestination:name,uv,value:uv ? sample(uv) : null };
}

function inspectionCapture(width,height,coordinate,context,binding) {
  if (!context?.captureSelection) return;
  const pixelSelection = binding && (!context.sceneRef || sameScene(binding.scene,context.sceneRef)) ?
    { object:binding.object,...(binding.part !== undefined && {part:binding.part}),captureDepth:true } : undefined;
  const frame = context.captureSelection({ w:width,h:height,passes:[...PixelInspection.channels,...ArtPasses.sourceBindings],
    ...(coordinate && { palettePixel:coordinate,strandPixel:coordinate,inspectFragmentPixel:coordinate }),
    sceneInspection:true,...(pixelSelection && { pixelSelection }) });
  if (frame?.w !== width || frame?.h !== height || frame.passes && (frame.passes.w !== width || frame.passes.h !== height))
    throw new RangeError('Scene inspection must use the requested native grid');
  if (!pixelSelection || frame.bindingEvidence) return frame;
  const normal = frame.pixelSelection;
  const matches = (shot,isolated)=>shot?.w === width && shot.h === height &&
    shot.object === binding.object && shot.part === binding.part && shot.isolated === isolated &&
    shot.coverage instanceof Float32Array && shot.coverage.length === width*height;
  if (!matches(normal,false)) return frame;
  const projected = context.captureSelection({ w:width,h:height,passes:[],sceneInspection:true,
    pixelSelection:{ ...pixelSelection,isolated:true } });
  const source = projected?.pixelSelection;
  if (!matches(source,true) || !(source.depth instanceof Float32Array) || source.depth.length !== width*height)
    return frame;
  const camera = frame.sourceView?.camera ?? normal.view;
  if (!camera) return frame;
  if (frame.scene !== projected.scene || normal.scene !== source.scene || frame.time !== projected.time ||
      !equal(camera,projected.sourceView?.camera ?? source.view))
    throw new RangeError('Binding diagnostics need matched scene and isolated captures on the same camera grid');
  return { ...frame,bindingEvidence:{ object:binding.object,part:binding.part,
    visible:normal.coverage,projected:source.coverage,depth:source.depth } };
}

function inspect(design,coordinate,{ frame,cel,binding,destinations,references = false } = {},context) {
  const compiled = compile(design,frame,cel,true,{ references }), { width,height } = compiled;
  if (!at(width,height,coordinate)) throw new RangeError('Use a pixel coordinate inside the native grid');
  const p = coordinate[1]*width+coordinate[0];
  const trace = LayerStack.inspect(compiled.layerStack,compiled.colors,id=>{
    const row = compiled.layerSources.get(id);
    return { slot:row.slots[p],alpha:row.alpha?.[p] };
  },{ references });
  const description = PixelInspection.document(trace,compiled.paletteEntries,id=>compiled.cels?.get(id) ?? null);
  const materials = inspectionMaterials(design,destinations,context,compiled.id)
    .filter(row=>row.frame === undefined || row.frame === compiled.id)
    .map(source=>inspectMaterial(source,coordinate,width,height));
  const bindings = design.sceneBindings ?? [];
  const selected = binding === undefined ? undefined : bindings.find(row=>row.id === binding);
  if (binding !== undefined && !selected) throw new RangeError('Unknown pixel scene binding '+binding);
  if (selected && !context?.captureSelection) throw new TypeError('Binding inspection needs a captured scene view');
  const grid = [width,height], size = selected?.canvas?.size ?? grid;
  const mapped = selected ? CanvasTransforms.sourcePoint(grid,coordinate,selected.canvas)?.map(Math.floor) : coordinate;
  const activeScope = selected?.frame !== undefined && selected.frame !== compiled.id ? undefined : selected;
  const scene = inspectionCapture(...size,mapped,context,activeScope);
  const sceneRef = scene?.sourceView?.source ?? context?.sceneRef ?? scene?.scene ?? scene?.pixelSelection?.scene;
  const candidates = selected ? [selected] : bindings.filter(row=>sceneRef !== undefined && sameScene(row.scene,sceneRef) &&
    (row.frame === undefined || row.frame === compiled.id));
  const resolved = scene && candidates.map(row=>SourceBindings.resolve(scene,row,coordinate,{
    grid,frameId:compiled.id,layerId:cel ? compiled.layerIds.find(id=>compiled.cels?.get(id) === cel) : undefined,
    sceneMatches:sceneRef !== undefined && sameScene(row.scene,sceneRef),ArtPasses,sourcePoint:CanvasTransforms.sourcePoint
  }));
  const atSource = mapped && scene && PixelInspection.scene(scene,mapped,ArtPasses);
  const protection = Protection.at(compiled.protectedDetails ?? [],...coordinate);
  return { revision:compiled.revision,...frameMetadata(compiled),...cell(compiled,p),...description,
    protection,materials,...(scene && { scene:{ ...atSource,
      ...(resolved.length && { bindings:resolved }) } }) };
}

function hexColor(packed) {
  return packed === undefined ? null : '#' + packed.toString(16).padStart(6,'0');
}

function pixelUV(width,height,coordinate,registration) {
  return CanvasTransforms.uv([width,height],coordinate,registration);
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
    const point = uv ?? pixelUV(width,height,coordinate,source.canvas);
    if (point === null) return { ...common,...source,uv:null,value:null };
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
      knockout:slot === -2,clipped:!!source.clipping && !source.clipping[p],
      ...(source.locked && { locked:true }) };
  }
  const observed = cell(active,p);
  return { ...common,layer:observed.layer,cel:observed.cel ?? null,
    swatch:observed.swatch,color:active.slots[p] < 0 ? null : hexColor(active.mixedColors?.[p] ?? active.colors[active.slots[p]]),
    ...(active.opacity && { alpha:active.opacity[p] }),protected:observed.protected };
}

function selectPixels(design,query,{ frame,layer,cel } = {},context) {
  if (layer !== undefined && cel !== undefined) throw new TypeError('Select from the composite, a layer or a cel');
  if (query?.type === 'recall' && frame === undefined && cel === undefined)
    frame = namedSelection(design,query.id).frame;
  const source = layer !== undefined || cel !== undefined;
  const active = compile(design,frame,cel,source && (layer ?? true));
  const target = layer ?? (cel !== undefined ? [...active.cels].find(([,id])=>id === cel)?.[0] : undefined);
  const raster = source ? active.layerSources?.get(target) : active;
  if (!raster) throw new RangeError('Unknown pixel layer ' + target);
  const { width,height } = active;
  const alpha = source ? raster.alpha : active.opacity;
  const visible = p => !raster.clipping || raster.clipping[p];
  const rendering = SelectionSources.sourceFor(width,height,query,{
    capture:context?.captureSelection,
    binding(id) {
      const binding = design.sceneBindings?.find(row=>row.id === id);
      if (!binding) throw new RangeError('Unknown pixel scene binding '+id);
      if (binding.frame !== undefined && binding.frame !== active.id)
        throw new RangeError('Selection binding is scoped to frame '+binding.frame);
      if (binding.layer !== undefined && target !== undefined && binding.layer !== target)
        throw new RangeError('Selection binding is scoped to layer '+binding.layer);
      return binding;
    },
    sceneMatches(binding,frame) {
      const ref = frame.sourceView?.source ?? frame.scene ?? context?.sceneRef ?? frame.pixelSelection?.scene;
      return reference(ref) && sameScene(binding.scene,ref);
    },
    material(destination) {
      if (!context) throw new TypeError('Selection needs the scene bound to material destination ' + destination);
      const reader = Destinations.channelSource(Destinations.resolve(design,destination),context);
      if (reader.frame !== undefined && reader.frame !== active.id)
        throw new RangeError('The source channel is bound to frame ' + reader.frame);
      return reader;
    }
  });
  const mask = PixelSelections.mask(width,height,query,p => {
    const slot = raster.slots[p];
    if (slot < 0 || !visible(p)) return 0;
    const rgb = source ? active.colors[slot] : active.mixedColors?.[p] ?? active.colors[slot];
    return (rgb<<8) | (alpha?.[p] ?? 255);
  },id=>namedSelection(design,id,active.id).pixels,meaning=>{
    if (meaning.type !== 'swatch') return rendering.match(meaning);
    if (meaning.at && !visible(meaning.at[1]*width+meaning.at[0])) return () => false;
    const test = PixelSelections.swatch(width,meaning,raster.slots,alpha,active.swatches);
    return p=>visible(p) && test(p);
  });
  const pixels = PixelSelections.pixels(width,mask), { sources } = rendering;
  return { revision:active.revision,frame:active.id ?? null,grid:[width,height],pixelCount:pixels.length,pixels,
    ...(sources.length && { sources }) };
}

function namedSelection(design,id,frame) {
  const saved = design.version === 2 && design.selections?.find(row=>row.id === id);
  if (!saved) throw new RangeError('Unknown pixel selection ' + id);
  if (frame !== undefined && saved.frame !== undefined && frame !== saved.frame)
    throw new RangeError('Pixel selection belongs to frame ' + saved.frame);
  return saved;
}

function copySelection(design,{ selection,frame,layer,cel } = {}) {
  if ((layer === undefined) === (cel === undefined))
    throw new TypeError('Copy needs a source layer or cel');
  documentShape(design);
  const saved = namedSelection(design,selection,frame);
  const compiled = compile(design,frame ?? saved.frame,cel,layer ?? true);
  const target = layer ?? [...compiled.cels].find(([,id])=>id === cel)?.[0];
  const source = compiled.layerSources.get(target);
  if (!source) throw new RangeError('Unknown pixel layer ' + target);
  const { width,height } = compiled;
  const mask = PixelSelections.fromPixels(width,height,saved.pixels);
  return PixelTransforms.capture(width,height,{ ...source,palette:paletteEntries(design.palette,design.version) },mask);
}

function captureBrush(design,{ selection,pixels,rect,frame,layer,cel,anchor,settings } = {}) {
  documentShape(design);
  if ([selection,pixels,rect].filter(value=>value !== undefined).length !== 1 ||
      layer !== undefined && cel !== undefined)
    throw new TypeError('Choose one brush selection and, optionally, one source layer or cel');
  if (selection !== undefined) {
    const saved = namedSelection(design,selection,frame);
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

function review(frame,{ kind,finding,overlay = true,rules,shot,layer } = {}) {
  if (kind !== undefined && !Object.hasOwn(ArtRules.kinds,kind))
    throw new TypeError('Choose a diagnostic kind: '+Object.keys(ArtRules.kinds).join(', '));
  if (finding !== undefined && !reference(finding)) throw new TypeError('Use a diagnostic ID for --finding');
  const options = { frame:frame.id,shot,layer };
  const { image:color,result,diagnostics,acceptedMarks } = ArtRules.audit(frame,Craft.analyze(frame),rules,options);
  const addressed = diagnostics.filter(row=>(kind === undefined || kind === row.kind) && (finding === undefined || finding === row.id));
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
      ...(rules && { artRules:ArtRules.describe(rules,options),
        ...(shot !== undefined && { artShot:shot }),acceptedMarks:acceptedMarks ?? {} }),
      ...(frame.protectedDetails?.length && { protectedDetails:frame.protectedDetails.map(({ id,kind,pixels })=>
        ({ id,kind:kind ?? 'pixel',pixelCount:pixels.length })) }),
      swatches:Object.fromEntries(frame.swatches.map((id, i) => [id,used[i]])), findings, protectedMarks,diagnostics:addressed },
    ...(overlay && { overlay:Craft.lintMap(color,result) })
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
      (patch.frame !== undefined || (patch.cel === undefined && !['guides','canvas','palette','adjustments','layers','protection','art-rules','timeline'].includes(route.destination.kind))))
    throw Preview.conflict('wrong-frame','Pixel edit needs the observed frame ID',{ expected:patch.frame, actual:frame.id });
  if (patch.sourceRevision !== undefined && (!route.binding || !isRevision(patch.sourceRevision)))
    throw Preview.conflict('invalid-source-revision','An inspected sourceRevision must be a SHA-256 digest for a scene destination');
  if (route.destination.kind === 'art-rules') return editArtRules(design,patch,context);
  if (route.destination.kind === 'protection') return editProtection(design,patch,context);
  if (route.destination.kind === 'timeline') return editTimeline(design,patch,context);
  if (route.destination.kind === 'layers') return editLayers(design,patch,context);
  if (route.destination.kind === 'adjustments') return editAdjustment(design,patch,context);
  if (route.destination.kind === 'canvas') return editCanvas(design,patch,context);
  if (route.destination.kind === 'palette') return editPalette(design,patch,context);
  if (route.destination.kind === 'guides') return editGuides(design,patch);
  if (route.destination.kind === 'selections') return editSelection(design,frame,patch,context);
  if (route.destination.kind !== 'raster') {
    if (patch.cel !== undefined) throw new TypeError('A cel ID is a raster edit target');
    if (!context) throw new TypeError('Scene edit needs a scene context');
    return Destinations.apply(frame,patch,route,context,readPixelEdits);
  }
  if (patch.operation !== undefined) {
    if (patch.operation?.tool === 'cleanup') return editCleanup(design,frame,patch,route.destination,context);
    if (patch.operation?.tool === 'rgba') return editRGBA(design,frame,patch,route.destination,context);
    if (patch.operation?.tool === 'replace-swatch') return replaceSwatch(design,frame,patch,route.destination,context);
    if (['transform','paste'].includes(patch.operation?.tool))
      return editTransform(design,frame,patch,route.destination,context);
    return editRasterTool(design,frame,patch,route.destination,context);
  }
  if (patch.cel === undefined && frame.layerIds.includes(patch.id))
    throw new TypeError('A raster edit needs a new layer ID and pixel edits');
  if (patch.cel !== undefined) {
    const layer = frame.cels && [...frame.cels].find(([,id]) => id === patch.cel)?.[0];
    if (layer === undefined) throw new RangeError('Unknown pixel cel ' + patch.cel + ' on frame ' + frame.id);
    requireWritableLayer(frame.layerStack.rows.get(layer));
    const marks = readPixelEdits(frame,patch,layer);
    const revised = appendRasterMarks(design,frame,layer,marks,[]);
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
  const id = rasterCelId(design,frame,patch.id);
  const revised = design.version === 1
    ? { ...design, layers:[...design.layers,{ id:patch.id, marks }] }
    : { ...design, layers:[...design.layers,{ id:patch.id }], frames:design.frames.map(item =>
      item.id === frame.id ? { ...item, cels:{ ...item.cels, [patch.id]:{ ...(id !== frame.id+'/'+patch.id && { id }),marks } } } : item) };
  compile(revised,frame.id);
  return revised;
}

function rasterToolLayer(frame,patch) {
  const { layer } = patch.operation;
  const target = patch.cel === undefined ? layer : frame.cels &&
    [...frame.cels].find(([,id])=>id === patch.cel)?.[0];
  if (typeof target !== 'string' || !frame.layerIds.includes(target) || patch.cel !== undefined && layer !== undefined)
    throw new TypeError('Choose an existing raster layer or cel for the paint tool');
  requireWritableLayer(frame.layerStack.rows.get(target));
  return target;
}

function requireWritableLayer(row) {
  if (row.kind === 'group' || row.kind === 'reference' || row.effectiveLock)
    throw Preview.conflict('locked-layer','Layer '+row.id+' does not accept pixel edits',{ layer:row.id });
}

function editRasterTool(design,frame,patch,destination,context) {
  const { operation } = patch;
  if (patch.edits !== undefined || !fields(operation,['tool','layer','at','points','samples','swatch','pixelPerfect','shape','brush','shading','drawing','selection']))
    throw new TypeError('A raster tool needs a layer or cel and a pencil, eraser, fill, shape or brush operation');
  const { tool,swatch,pixelPerfect,shape,brush,samples,shading,drawing,selection } = operation;
  const fill = tool === 'fill', erase = tool === 'eraser', precise = tool === 'shape', brushing = tool === 'brush';
  if (pixelPerfect !== undefined && (tool !== 'pencil' || typeof pixelPerfect !== 'boolean'))
    throw new TypeError('Pixel-perfect cleanup is a boolean pencil option');
  const { width,height } = frame;
  const grid = drawing === undefined ? undefined : RasterTools.drawingGrid(width,height,drawing);
  const layer = rasterToolLayer(frame,patch);
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
  const selected = selection === undefined ? null : new Set(
    namedSelection(design,selection,frame.id).pixels.map(([x,y])=>y*width+x));
  const inside = p => !selected || selected.has(p);
  const usable = p => inside(p) && !frame.locks[p] && (!captured.clipping || captured.clipping[p]);
  function check(p) {
    if (!inside(p) || usable(p)) return;
    const code = frame.locks[p] ? 'protected-pixel' : 'clipped-pixel';
    throw Preview.conflict(code,'Paint tool cannot change this pixel',
      { at:[p%width,Math.floor(p/width)], layer });
  }
  let changed, added = [], brushMarks = [];
  if (brushing) {
    const result = brushChanges(design,frame,brush,slot,{ points,samples,shading },captured,check,grid,inside);
    ({ changed,added,marks:brushMarks } = result);
  } else if (precise) {
    const mask = require('../index.js').load().KIT.pixelShapes.raster(width,height,shape,grid);
    changed = [];
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p] || !inside(p)) continue;
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
    changed = old === slot || !inside(first) ? [] : RasterTools.region(width,height,points[0],p => usable(p) && captured.slots[p] === old).sort((a,b)=>a-b);
  } else {
    const visited = new Set();
    const recordPixel = grid ? (x,y)=>grid.pixels(x,y,p=>visited.add(p)) : (x,y)=>{ visited.add(y*width+x); };
    const stroke = RasterTools.freehand(recordPixel,{ pixelPerfect });
    for (const point of points) stroke.add(point);
    recordPixel(...stroke.tip());
    for (const p of visited) check(p);
    changed = [...visited].filter(p => inside(p) && captured.slots[p] !== slot).sort((a,b) => a-b);
  }
  const runs = RasterTools.runs(width,changed), cel = rasterCelId(design,frame,layer);
  const report = context?.onEditTarget ?? context?.onRasterTool;
  report?.({ destination:destination.id, kind:'raster', tool,frame:frame.id ?? null, layer,
    cel:cel ?? null, ...(pixelPerfect && { pixelPerfect }), ...(precise && { shape:shape.type }),
    ...(shading !== undefined && { shading:shading.mode }),
    ...(shading?.mode === 'ramp' && typeof shading.ramp === 'string' && { ramp:shading.ramp }), ...(grid && { drawing }),
    ...(selection !== undefined && { selection }),
    ...(added.length && { addedSwatches:added.map(entry=>entry.id) }), pixelCount:changed.length,runs });
  if (!runs.length) return design;
  const marks = brushing ? brushMarks : [erase ? { clear:true,runs } : { swatch,runs }];
  const revised = appendRasterMarks(design,frame,layer,marks,added);
  compile(revised,frame.id);
  return revised;
}

function rasterCelId(design,frame,layer,lookup) {
  return frame.id === undefined ? null : frame.cels.get(layer) ??
    Timeline.availableId(frame.id,layer,lookup ?? Timeline.index(design.frames));
}

function appendRasterMarks(design,frame,layer,marks,added,skipProtectedFrame) {
  if (!marks.length) return design;
  const base = added.length ? { ...design,palette:{ ...design.palette,
    ...Object.fromEntries(added.map(entry=>[entry.id,entry.color])) } } : design;
  if (frame.id === undefined)
    return { ...base,layers:base.layers.map(item=>item.id === layer ? { ...item,marks:[...item.marks,...marks] } : item) };
  const lookup = Timeline.index(base.frames);
  const revised = { ...base,frames:base.frames.map(item=>{
    if (item.id !== frame.id) return item;
    const cel = withRasterMarks(frame,item,layer,marks,lookup);
    return { ...item,cels:{ ...item.cels,[layer]:cel } };
  }) };
  assertHeldProtection(design,revised,skipProtectedFrame,lookup);
  return revised;
}

function withRasterMarks(frame,item,layer,marks,lookup) {
  const row = frame.layerStack.rows.get(layer), source = Timeline.independent(getCel(item,layer),lookup);
  const local = Timeline.localMarks(frame.width,frame.height,marks,Timeline.offset(row,source),layer);
  const id = frame.cels.get(layer) ?? Timeline.availableId(frame.id,layer,lookup);
  return { ...source,...(!source && id !== frame.id+'/'+layer && { id }),marks:[...(source?.marks ?? []),...local] };
}

function assertHeldProtection(design,revised,skipFrame,lookup) {
  if (design.protectedDetails?.length && [...lookup.cels.values()].some(cel=>cel.hold !== undefined))
    assertProtectionUnchanged(design,revised,skipFrame);
}

function rasterWriteMarks(width,source,palette,writes,changed) {
  const bySlot = new Map(), byAlpha = new Map();
  function group(groups,key,p) {
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(p);
  }
  for (const p of changed) {
    const { slot,alpha } = writes.get(p), previous = source.slots[p];
    if (previous !== slot) group(bySlot,slot,p);
    if (slot >= 0 && alpha !== (previous < 0 ? 255 : source.alpha?.[p] ?? 255)) group(byAlpha,alpha,p);
  }
  const marks = [...bySlot].map(([slot,indices])=>({
    ...(slot === -1 ? { clear:true } : { swatch:slot < 0 ? null : palette[slot].id }),
    runs:RasterTools.runs(width,indices)
  }));
  for (const [alpha,indices] of byAlpha) marks.push({ alpha,runs:RasterTools.runs(width,indices) });
  return marks;
}

function editCleanup(design,frame,patch,destination,context) {
  const { operation } = patch, { width,height } = frame;
  if (patch.edits !== undefined || !fields(operation,['tool','layer','selection','pixels','kind','mode','at','swatch','maxChanges']) ||
      (operation.selection === undefined) === (operation.pixels === undefined))
    throw new TypeError('Cleanup needs a saved selection or an explicit list of native pixels');
  const { selection,pixels,kind,mode,at,swatch,maxChanges } = operation;
  const layer = rasterToolLayer(frame,patch);
  const captured = compile(design,frame.id,patch.cel,layer).layerSources.get(layer);
  const mask = PixelSelections.fromPixels(width,height,pixels === undefined ? namedSelection(design,selection,frame.id).pixels : pixels);
  const plan = Cleanup.plan({ width,height,...captured,locks:frame.locks,swatches:frame.swatches,colors:frame.colors },mask,
    { kind,mode,at,swatch,maxChanges });
  const marks = rasterWriteMarks(width,captured,frame.paletteEntries,plan.writes,plan.indices);
  const revised = appendRasterMarks(design,frame,layer,marks,[]);
  compile(revised,frame.id);
  context?.onEditTarget?.({ destination:destination.id,kind:'raster',tool:'cleanup',cleanup:kind,
    frame:frame.id ?? null,layer,cel:rasterCelId(design,frame,layer),
    ...(selection !== undefined && { selection }),...(mode !== undefined && { mode }),
    maxChanges:plan.maxChanges,pixelCount:plan.indices.length,runs:RasterTools.runs(width,plan.indices),changes:plan.changes });
  return revised;
}

function editRGBA(design,frame,patch,destination,context) {
  const { operation } = patch, { width,height } = frame;
  if (patch.edits !== undefined || !fields(operation,['tool','layer','pixels']) ||
      !Array.isArray(operation.pixels) || !integer(operation.pixels.length,1,width*height))
    throw new TypeError('An RGBA edit needs a layer or cel and native pixels');
  const layer = rasterToolLayer(frame,patch);
  const source = compile(design,frame.id,patch.cel,layer).layerSources.get(layer);
  const original = paletteEntries(design.palette,design.version), colors = PixelColors.paletteEditor(original);
  const writes = new Map(), visited = new Set();
  for (const pixel of operation.pixels) {
    if (!fields(pixel,['at','rgba','swatch']) || !at(width,height,pixel.at) ||
        (pixel.rgba === null ? pixel.swatch !== undefined : !PixelColors.rgbaPixel(pixel.rgba)))
      throw new TypeError('An RGBA pixel needs an in-bounds coordinate, four bytes or null, and an optional swatch ID');
    const [x,y] = pixel.at, p = y*width+x, previous = source.slots[p];
    if (visited.has(p)) throw new RangeError('RGBA edit repeats a pixel at '+pixel.at.join(','));
    visited.add(p);
    const slot = pixel.rgba === null ? -1 : colors.resolve(PixelColors.fromBytes(...pixel.rgba),pixel.swatch,previous);
    const alpha = pixel.rgba?.[3] ?? 255;
    if (slot === previous && (slot < 0 || alpha === (source.alpha?.[p] ?? 255))) continue;
    if (frame.locks[p] || source.clipping && !source.clipping[p])
      throw Preview.conflict(frame.locks[p] ? 'protected-pixel' : 'clipped-pixel','RGBA edit cannot change this pixel',
        { layer,at:pixel.at });
    writes.set(p,{ slot,alpha });
  }
  const changed = [...writes.keys()].sort((a,b)=>a-b), added = colors.palette.slice(original.length);
  const revised = appendRasterMarks(design,frame,layer,rasterWriteMarks(width,source,colors.palette,writes,changed),added);
  compile(revised,frame.id);
  context?.onEditTarget?.({ destination:destination.id,kind:'raster',tool:'rgba',frame:frame.id ?? null,layer,
    cel:rasterCelId(design,frame,layer),pixelCount:changed.length,
    runs:RasterTools.runs(width,changed),...(added.length && { addedSwatches:added.map(entry=>entry.id) }) });
  return revised;
}

function replaceSwatch(design,frame,patch,destination,context) {
  const { operation } = patch, { selection,from,to } = operation;
  if (patch.edits !== undefined || !fields(operation,['tool','layer','selection','from','to']) || !name(selection))
    throw new TypeError('Swatch replacement needs a layer or cel and a saved selection');
  const slot = frame.swatches.indexOf(from);
  if (slot < 0 || from === to || !frame.swatches.includes(to))
    throw new RangeError('Choose two distinct existing swatch IDs');
  const layer = rasterToolLayer(frame,patch), { width } = frame;
  const saved = namedSelection(design,selection,frame.id);
  const source = compile(design,frame.id,patch.cel,layer).layerSources.get(layer);
  const pixels = [];
  for (const at of saved.pixels) {
    const [x,y] = at, p = y*width+x;
    if (source.slots[p] !== slot) continue;
    if (frame.locks[p] || source.clipping && !source.clipping[p])
      throw Preview.conflict(frame.locks[p] ? 'protected-pixel' : 'clipped-pixel',
        'Swatch replacement cannot change this pixel',{ layer,at });
    pixels.push(p);
  }
  const runs = RasterTools.runs(width,pixels.sort((a,b)=>a-b));
  const revised = runs.length ? appendRasterMarks(design,frame,layer,[{ swatch:to,runs }],[]) : design;
  compile(revised,frame.id);
  context?.onEditTarget?.({ destination:destination.id,kind:'raster',tool:'replace-swatch',frame:frame.id,
    layer,cel:rasterCelId(design,frame,layer),selection,from,to,pixelCount:pixels.length,runs });
  return revised;
}

function editTransform(design,frame,patch,destination,context) {
  const { operation } = patch, paste = operation.tool === 'paste';
  const input = paste ? ['clipboard'] : ['selection','mode','carryProtection'];
  if (patch.edits !== undefined || !fields(operation,['tool','layer','transform','resultSelection',...input]))
    throw new TypeError('A transform needs a named selection or an indexed clipboard to paste');
  const { tool,selection,resultSelection,mode = 'move',transform,clipboard,carryProtection = false } = operation;
  if (typeof carryProtection !== 'boolean' || carryProtection && mode !== 'move')
    throw new TypeError('Only a selection move can carry protection');
  if ((!paste && !['move','copy'].includes(mode)) ||
      (resultSelection !== undefined && (design.version !== 2 || !name(resultSelection))))
    throw new TypeError('Use move or copy and an optional result selection ID in a version 2 document');
  const { width,height } = frame, layer = rasterToolLayer(frame,patch);
  const source = compile(design,frame.id,patch.cel,layer).layerSources.get(layer);
  const palette = paletteEntries(design.palette,design.version), current = { ...source,palette };
  const mask = !paste && PixelSelections.fromPixels(width,height,namedSelection(design,selection,frame.id).pixels);
  const clip = paste ? clipboard : PixelTransforms.capture(width,height,current,mask);
  const result = PixelTransforms.stage(width,height,current,clip,transform,
    { move:!paste && mode === 'move',named:true,captureSources:carryProtection });
  const carried = carryProtection ? Protection.carry(frame.protectedDetails ?? [],frame.id,width,mask,result.sources) : undefined;
  const changed = [...result.writes.keys()].sort((a,b)=>a-b);
  for (const p of changed) {
    const locked = carried ? frame.layerLocks[p] || carried.locked.has(p) : frame.locks[p];
    if (locked || source.clipping && !source.clipping[p])
      throw Preview.conflict(locked ? 'protected-pixel' : 'clipped-pixel','Transform cannot change this pixel',
        { layer,at:[p%width,Math.floor(p/width)] });
  }
  const marks = rasterWriteMarks(width,source,result.palette,result.writes,changed);
  const added = result.palette.slice(palette.length);
  let revised = appendRasterMarks(design,frame,layer,marks,added,carried?.moved.size ? frame.id : undefined);
  let selectionRuns;
  if (resultSelection !== undefined) {
    const pixels = PixelSelections.pixels(width,result.mask);
    selectionRuns = RasterTools.runs(width,pixels.map(([x,y])=>y*width+x));
    revised = saveNamedSelection(revised,{ id:resultSelection,frame:frame.id,pixels });
  }
  if (carried?.moved.size) {
    const after = compile({ ...revised,protectedDetails:undefined },frame.id);
    const problem = Protection.carriedChange(carried,width,frame,after);
    if (problem) throw Preview.conflict('protected-pixel','Transform would change protected detail '+problem.id,
      { layer,detail:problem.id,at:problem.at });
    revised = { ...revised,protectedDetails:revised.protectedDetails.map(row=>carried.moved.get(row.id) ?? row) };
  }
  compile(revised,frame.id);
  context?.onEditTarget?.({ destination:destination.id,kind:'raster',tool,frame:frame.id ?? null,layer,
    ...(carried?.moved.size && { carriedProtection:[...carried.moved.values()] }),
    cel:rasterCelId(design,frame,layer),
    ...(!paste && { selection,mode }),...(resultSelection !== undefined && { resultSelection,selectionRuns }),
    bounds:result.bounds,clippedPixels:result.clippedPixels,pixelCount:changed.length,
    runs:RasterTools.runs(width,changed),...(added.length && { addedSwatches:added.map(entry=>entry.id) }) });
  return revised;
}

function brushChanges(design,frame,brush,override,{ points,samples,shading },{ slots:current,alpha },check,grid,inside) {
  const { width,height } = frame, stamps = new Map();
  const emit = (p,slot) => { if (inside(p)) stamps.set(p,slot); };
  if (samples === undefined) PixelBrushes.stroke(width,height,PixelBrushes.footprint(brush),points,emit,grid);
  else PixelBrushes.dynamicStroke(width,height,brush,samples,emit,grid);
  let ramp = shading?.ramp;
  if (shading?.mode === 'ramp' && typeof ramp === 'string') {
    const named = frame.ramps?.find(row=>row.id === ramp);
    if (!named) throw new RangeError('Unknown palette ramp '+ramp);
    ramp = named.swatches;
  }
  const resolve = shading === undefined ? null : PixelBrushes.shade(
    shading.mode === 'ramp' ? { ...shading,ramp } : shading,frame.swatches);
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

function editArtRules(design,patch,context) {
  if (patch.frame !== undefined || patch.cel !== undefined || patch.edits !== undefined ||
      !fields(patch.operation,['artRules']) || !Object.hasOwn(patch.operation,'artRules'))
    throw new TypeError('Art rule edits need an artRules definition or null');
  const { artRules:before,...base } = design, { artRules } = patch.operation;
  const revised = artRules === null ? base : { ...base,artRules };
  documentShape(revised);
  context?.onEditTarget?.({ destination:'art-rules',kind:'art-rules',before:before ?? null,after:artRules });
  return revised;
}

function editProtection(design,patch,context) {
  const { operation } = patch;
  if (patch.frame !== undefined || patch.cel !== undefined || patch.edits !== undefined ||
      !record(operation) || !name(operation.id))
    throw new TypeError('A protection edit needs a stable detail ID and its own frame scope');
  const details = new Map((design.protectedDetails ?? []).map(row=>[row.id,row]));
  const { type,id,kind,frame,frames,selection } = operation, before = details.get(id);
  if (type === 'remove' && fields(operation,['type','id'])) {
    if (!details.delete(id)) throw Preview.conflict('missing-protection','Unknown protected detail '+id,{ detail:id });
  } else if (type === 'set' && fields(operation,['type','id','kind','frame','frames','pixels','selection']) &&
      Protection.kinds.includes(kind) && (operation.pixels !== undefined) !== (selection !== undefined)) {
    const saved = selection === undefined ? null : namedSelection(design,selection,frame);
    if (saved?.frame !== undefined && saved.frame !== frame)
      throw new RangeError('A frame-scoped selection needs the same protection frame');
    details.set(id,{ id,kind,...(frame !== undefined && { frame }),...(frames !== undefined && { frames }),
      pixels:saved?.pixels ?? operation.pixels });
  } else {
    throw new TypeError('Set protection from pixels or a saved selection, or remove a protected detail');
  }
  const revised = { ...design,protectedDetails:[...details.values()] };
  validate(revised);
  context?.onEditTarget?.({ destination:'protection',kind:'protection',tool:type,id,before:before ?? null,after:details.get(id) ?? null });
  return revised;
}

function assertProtectionUnchanged(design,revised,skipFrame) {
  if (!design.protectedDetails?.length) return;
  const lookup = documentShape(revised), prior = Timeline.index(design.frames);
  const afterFrames = new Map(revised.frames.map(frame=>[frame.id,frame]));
  const beforePalette = paletteEntries(design.palette,2), afterPalette = paletteEntries(revised.palette,2);
  const next = { ...revised,protectedDetails:undefined };
  for (const frame of design.frames) {
    const active = frameProtection(design,frame.id);
    if (!active.length || frame.id === skipFrame) continue;
    const before = compileFrame(design,frame,undefined,beforePalette,undefined,undefined,prior);
    const after = compileFrame(next,afterFrames.get(frame.id),undefined,afterPalette,undefined,undefined,lookup);
    const change = Protection.changed(active,design.width,before,after);
    if (change) throw Preview.conflict('protected-pixel','Edit would change protected detail '+change.id+' at '+change.at.join(', '),
      { frame:frame.id,detail:change.id,at:change.at });
  }
}

function editTimeline(design,patch,context) {
  if (design.version !== 2) throw new TypeError('Upgrade to a version 2 document before editing the cel timeline');
  if (patch.frame !== undefined || patch.cel !== undefined || patch.edits !== undefined)
    throw new TypeError('Timeline edits use frame and layer addresses inside their operation');
  const { design:revised,report } = Timeline.edit(design,patch.operation);
  assertProtectionUnchanged(design,revised);
  validate(revised);
  context?.onEditTarget?.(report);
  return revised;
}

function editLayers(design,patch,context) {
  if (design.version !== 2) throw new TypeError('Upgrade to a version 2 document before editing the layer stack');
  if (patch.frame !== undefined || patch.cel !== undefined || patch.edits !== undefined || !record(patch.operation))
    throw new TypeError('Layer edits use their own operation and scope');
  const { operation } = patch, { type,layer } = operation;
  const stack = LayerStack.prepare(design.layers);
  const requireLayer = id=>{
    const row = stack.rows.get(id);
    if (!row) throw new RangeError('Unknown pixel layer '+id);
    return row;
  };
  const checkRemoved = ids=>{
    const binding = design.sceneBindings?.find(row=>ids.includes(row.layer));
    if (binding) throw new RangeError('Layer '+binding.layer+' is used by scene binding '+binding.id);
  };
  let revised, report = {};
  if (type === 'add' && fields(operation,['type','layer','before'])) {
    const layers = design.layers.slice();
    const before = operation.before === undefined ? layers.length : layers.findIndex(row=>row.id === operation.before);
    if (before < 0) throw new RangeError('Unknown layer insertion point');
    layers.splice(before,0,layer);
    revised = { ...design,layers };
  } else if (type === 'update' && fields(operation,['type','layer','changes']) &&
      fields(operation.changes,['label','parent','clip','visible','locked','opacity','blend','protect','destination'])) {
    requireLayer(layer);
    const layers = design.layers.map(row=>{
      if (row.id !== layer) return row;
      const next = { ...row,...operation.changes };
      for (const key of Object.keys(operation.changes)) if (next[key] === null) delete next[key];
      return next;
    });
    revised = { ...design,layers };
  } else if (type === 'reorder' && fields(operation,['type','order']) && Array.isArray(operation.order) &&
      operation.order.length === design.layers.length && new Set(operation.order).size === design.layers.length) {
    const rows = new Map(design.layers.map(row=>[row.id,row]));
    revised = { ...design,layers:Array.from(operation.order,id=>{ requireLayer(id); return rows.get(id); }) };
  } else if (type === 'set-cel' && fields(operation,['type','frame','layer','cel'])) {
    const row = requireLayer(layer);
    if (row.effectiveLock || row.kind === 'group')
      throw Preview.conflict('locked-layer','Layer '+layer+' does not accept a cel',{ layer });
    if (!design.frames.some(frame=>frame.id === operation.frame)) throw new RangeError('Unknown pixel frame '+operation.frame);
    if (!record(operation.cel)) throw new TypeError('Set cel needs a pixel cel');
    revised = { ...design,frames:design.frames.map(frame=>{
      if (frame.id !== operation.frame) return frame;
      const prior = getCel(frame,layer), fallback = frame.id+'/'+layer;
      const id = prior ? celId(frame,layer,prior) : Timeline.availableId(frame.id,layer,Timeline.index(design.frames));
      const cel = operation.cel.id === undefined && id !== fallback ? { ...operation.cel,id } : operation.cel;
      return { ...frame,cels:{ ...frame.cels,[layer]:cel } };
    }) };
  } else if (type === 'remove' && fields(operation,['type','layer'])) {
    requireLayer(layer);
    const removed = LayerStack.descendants(stack,layer);
    for (const id of removed) if (stack.rows.get(id).effectiveLock) throw new RangeError('Layer '+id+' is locked');
    checkRemoved(removed);
    const ids = new Set(removed);
    const frames = design.frames.map(frame=>({ ...frame,cels:Object.fromEntries(
      Object.entries(frame.cels).filter(([id])=>!ids.has(id))) }));
    revised = { ...design,frames,layers:design.layers.filter(row=>!ids.has(row.id)) };
    report = { removed };
  } else if (['merge-down','flatten-group','flatten'].includes(type) && fields(operation,['type','layer'])) {
    const plan = LayerStack.mergePlan(design.layers,operation);
    checkRemoved(plan.removed);
    const merged = mergeLayers(design,plan);
    revised = merged.design;
    report = { target:plan.target,removed:plan.removed,addedSwatches:merged.added };
  } else {
    throw new TypeError('Choose add, update, reorder, set-cel, remove, merge-down, flatten-group, or flatten');
  }
  assertProtectionUnchanged(design,revised);
  validate(revised);
  context?.onEditTarget?.({ destination:'layers',kind:'layers',tool:type,
    before:design.layers,after:revised.layers,...(typeof layer === 'string' && { layer }),...report });
  return revised;
}

function mergeLayers(design,plan) {
  const { width,height } = design, palette = paletteEntries(design.palette,design.version);
  const editor = PixelColors.paletteEditor(palette), revision = fingerprint(design);
  const discarded = new Set([...plan.removed,plan.target]), lookup = Timeline.index(design.frames);
  const frames = design.frames.map(frame=>{
    const layers = celLayers(plan.inputs,frame,lookup);
    const flattened = composite(width,height,palette,layers);
    const baked = LayerStack.bake(flattened,flattened.colors,editor.resolve,plan.knockouts);
    const { slots,marks } = authoredCel(width,baked,editor.palette.map(row=>row.id));
    const current = getCel(frame,plan.target), label = current?.label;
    const fallback = frame.id+'/'+plan.target;
    const id = current ? celId(frame,plan.target,current) : Timeline.availableId(frame.id,plan.target,lookup);
    const cels = Object.fromEntries(Object.entries(frame.cels).filter(([id])=>!discarded.has(id)));
    cels[plan.target] = { ...(current?.id !== undefined || id !== fallback ? { id } : {}),...(label !== undefined && { label }),slots,marks };
    return { ...frame,cels };
  });
  const added = editor.palette.slice(palette.length), revised = { ...design,layers:plan.layers,frames,
    ...(added.length && { palette:{ ...design.palette,...Object.fromEntries(added.map(row=>[row.id,row.color])) } }) };
  for (let i = 0; i < frames.length; i++) {
    const old = compileFrame(design,design.frames[i],revision,palette), next = compileFrame(revised,frames[i],revision,editor.palette);
    if (!equal(LayerStack.image(old,old.colors).rgba,LayerStack.image(next,next.colors).rgba))
      throw new RangeError('Merge would change the rendered pixels in frame '+frames[i].id+'; flatten against the full backdrop');
  }
  return { design:revised,added:added.map(row=>row.id) };
}

function editAdjustment(design,patch,context) {
  if (design.version !== 2) throw new TypeError('Upgrade to a version 2 document before using scoped adjustments');
  const { operation } = patch;
  if (patch.frame !== undefined || patch.cel !== undefined || patch.edits !== undefined ||
      !fields(operation,['scope','adjustment']) || !fields(operation.scope,['frame','frames','layer','selection']))
    throw new TypeError('Use an adjustment and a scope with one frame or an inclusive frame range');
  const stack = LayerStack.prepare(design.layers);
  const { scope,adjustment } = operation, { width,height } = design;
  const { frame,frames,layer,selection } = scope;
  if ((frame === undefined) === (frames === undefined) || (frame !== undefined && !name(frame)) ||
      (frames !== undefined && (!Array.isArray(frames) || frames.length !== 2 || !Array.from(frames).every(name))) ||
      (layer !== undefined && !design.layers.some(row=>row.id === layer)) ||
      (selection !== undefined && !name(selection)))
    throw new TypeError('Choose known frame endpoints and an optional layer and saved selection');
  const [first,last] = (frames ?? [frame,frame]).map(id=>design.frames.findIndex(row=>row.id === id));
  if (first < 0 || last < first) throw new RangeError('Adjustment frame range must be known and in document order');
  if (layer !== undefined) requireWritableLayer(stack.rows.get(layer));
  const selected = selection === undefined ? null : namedSelection(design,selection);
  if (selected?.frame !== undefined && (first !== last || selected.frame !== design.frames[first].id))
    throw new RangeError('Pixel selection belongs to frame '+selected.frame);
  const mask = selected && PixelSelections.fromPixels(width,height,selected.pixels);
  const palette = paletteEntries(design.palette,design.version), editor = PixelColors.paletteEditor(palette);
  const prepared = PixelAdjustments.prepare(adjustment,editor), revision = fingerprint(design), lookup = Timeline.index(design.frames);
  const targets = [];
  const revisedFrames = design.frames.map((row,i)=>{
    if (i < first || i > last) return row;
    const before = targets.length;
    const captured = compileFrame(design,row,revision,palette,layer ?? true,undefined,lookup), cels = { ...row.cels };
    for (const [id,cel] of Object.entries(row.cels)) {
      const definition = stack.rows.get(id);
      if (layer !== undefined && id !== layer || definition.effectiveLock || definition.kind === 'reference') continue;
      const source = captured.layerSources.get(id), writes = prepared.apply(width,height,source,mask);
      if (!writes.size) continue;
      const changed = [...writes.keys()];
      for (const p of changed) if (captured.locks[p] || source.clipping && !source.clipping[p])
        throw Preview.conflict(captured.locks[p] ? 'protected-pixel' : 'clipped-pixel',
          'Adjustment cannot change this pixel',{ frame:row.id,layer:id,at:[p%width,Math.floor(p/width)] });
      cels[id] = withRasterMarks(captured,row,id,rasterWriteMarks(width,source,editor.palette,writes,changed),lookup);
      targets.push({ frame:row.id,layer:id,cel:celId(row,id,cel),pixelCount:changed.length,
        runs:RasterTools.runs(width,changed) });
    }
    return targets.length === before ? row : { ...row,cels };
  });
  const added = editor.palette.slice(palette.length);
  const revised = targets.length ? { ...design,frames:revisedFrames,...(added.length && {
    palette:{ ...design.palette,...Object.fromEntries(added.map(row=>[row.id,row.color])) }
  }) } : design;
  if (targets.length) {
    assertHeldProtection(design,revised,undefined,lookup);
    validate(revised);
  }
  context?.onEditTarget?.({ destination:'adjustments',kind:'adjustments',tool:adjustment.type,scope,
    frames:design.frames.slice(first,last+1).map(row=>row.id),cels:targets,
    pixelCount:targets.reduce((n,row)=>n+row.pixelCount,0),
    ...(added.length && { addedSwatches:added.map(row=>row.id) }) });
  return revised;
}

function editPalette(design,patch,context) {
  if (design.version !== 2) throw new TypeError('Upgrade the document to version 2 before editing the palette');
  if (patch.edits !== undefined || patch.frame !== undefined || patch.cel !== undefined)
    throw new TypeError('Palette edits apply to the whole document');
  const before = paletteAsset(design), { operation } = patch;
  const { palette,replacements,removed } = PixelPalette.edit(before,operation);
  const prior = new Map(before.swatches.map(row=>[row.id,row])), definition = paletteDefinition(palette.swatches);
  for (const row of palette.swatches) if (equal(prior.get(row.id),row)) definition[row.id] = design.palette[row.id];
  const revised = { ...design,palette:definition };
  if (palette.ramps.length || design.ramps !== undefined) revised.ramps = palette.ramps;
  let remappedCels = 0;
  if (replacements) {
    const stack = LayerStack.prepare(design.layers);
    const replace = swatch=>replacements.get(swatch) ?? swatch;
    revised.frames = design.frames.map(frame=>{
      let changed = false;
      const cels = Object.entries(frame.cels).map(([id,cel])=>{
        if (!cel.slots?.some(slot=>replacements.has(slot)) &&
            !cel.marks?.some(mark=>replacements.has(mark.swatch))) return [id,cel];
        requireWritableLayer(stack.rows.get(id));
        changed = true;
        remappedCels++;
        return [id,{ ...cel,
          ...(cel.slots && { slots:cel.slots.map(replace) }),
          marks:cel.marks.map(mark=>replacements.has(mark.swatch) ? { ...mark,swatch:replace(mark.swatch) } : mark) }];
      });
      return changed ? { ...frame,cels:Object.fromEntries(cels) } : frame;
    });
  }
  assertProtectionUnchanged(design,revised);
  validate(revised);
  context?.onEditTarget?.({ destination:'palette',kind:'palette',tool:operation.type,
    before,after:palette,...(replacements && { remappedCels,map:Object.fromEntries(replacements),removed }),
    ...(operation.type === 'remap-indices' && { indices:operation.map }) });
  return revised;
}

function editCanvas(design,patch,context) {
  if (!record(patch.operation) || patch.edits !== undefined || patch.frame !== undefined || patch.cel !== undefined)
    throw new TypeError('A canvas edit applies to the whole document');
  const { bindingPolicy,...operation } = patch.operation;
  if (bindingPolicy !== undefined && !['preserve','reframe'].includes(bindingPolicy))
    throw new TypeError('Choose preserve or reframe for canvas bindings');
  const sourceBindings = design.version === 2 ? design.sceneBindings : undefined;
  if (sourceBindings?.length && bindingPolicy === undefined)
    throw new TypeError('Use bindingPolicy preserve or reframe for a bound canvas');

  const { width,height } = design, legacy = design.version === 1;
  const frames = legacy ? [undefined] : design.frames;
  const palette = paletteEntries(design.palette,design.version), revision = fingerprint(design);
  const trim = CanvasTransforms.extent(width,height);
  if (operation.type === 'trim') {
    for (const frame of frames) {
      const { slots,opacity,locks } = compileFrame(design,frame,revision,palette);
      for (let p = 0; p < slots.length; p++)
        if (locks[p] || slots[p] >= 0 && (opacity?.[p] ?? 255) > 0)
          trim.include(p%width,Math.floor(p/width));
    }
  }
  const map = CanvasTransforms.plan(width,height,operation,trim), [w,h] = map.size;
  const changesGrid = w !== width || h !== height || map.offset.some(Boolean);
  const bindings = [], droppedProtected = [];
  let revised = design;

  function resizeCel(cel,source,sampling = map) {
    const raster = CanvasTransforms.raster(sampling,source.slots,source.alpha);
    const knockout = [], byAlpha = new Map();
    const slots = raster.slots.map((slot,p) => {
      if (slot === -2) knockout.push(p);
      const value = raster.alpha?.[p] ?? 255;
      if (value !== 255) {
        if (!byAlpha.has(value)) byAlpha.set(value,[]);
        byAlpha.get(value).push(p);
      }
      return palette[slot]?.id ?? null;
    });
    const marks = knockout.length ? [{ swatch:null,runs:RasterTools.runs(w,knockout) }] : [];
    for (const [alpha,pixels] of byAlpha) marks.push({ alpha,runs:RasterTools.runs(w,pixels) });
    return { ...cel,slots,marks };
  }

  if (changesGrid) {
    revised = { ...design,width:w,height:h };
    if (legacy) {
      const { layerSources } = compileFrame(design,undefined,revision,palette,true);
      revised.layers = design.layers.map(layer=>resizeCel(layer,layerSources.get(layer.id)));
    } else {
      const mapping = Protection.remap(map,design.protectedDetails,CanvasTransforms.region,
        (id,pixels)=>droppedProtected.push({ id,pixels }));
      const lookup = Timeline.index(frames);
      revised.layers = design.layers.map(({ offset,...layer })=>layer);
      revised.frames = frames.map(frame => {
        const raster = compileFrame(design,frame,revision,palette,true,undefined,lookup);
        const sampling = mapping.forFrame(raster.protectedDetails,raster);
        return { ...frame,cels:Object.fromEntries(Object.entries(frame.cels).map(([id,cel])=>
          [id,resizeCel(Object.fromEntries(Object.entries(cel).filter(([key])=>key !== 'hold' && key !== 'offset')),
            raster.layerSources.get(id),sampling)])) };
      });
      if (design.guides) revised.guides = CanvasTransforms.guides(map,design.guides);
      if (design.selections) revised.selections = design.selections.map(row=>({ ...row,pixels:CanvasTransforms.region(map,row.pixels).pixels }));
      if (mapping.rows) revised.protectedDetails = mapping.rows;
    }
  }
  if (sourceBindings?.length) {
    const sceneBindings = sourceBindings.map(({ canvas,stale,...binding }) => {
      if (stale?.length) {
        const pixels = stale.flatMap(([y,x,length])=>Array.from({length},(_,i)=>[x+i,y]));
        const pending = CanvasTransforms.region(map,pixels).pixels.map(([x,y])=>y*w+x).sort((a,b)=>a-b);
        if (pending.length) binding.stale = RasterTools.runs(w,pending);
      }
      const next = bindingPolicy === 'preserve' ? CanvasTransforms.preserve(map,canvas) : undefined;
      bindings.push({ id:binding.id,policy:bindingPolicy,before:canvas ?? null,after:next ?? null });
      return { ...binding,...(next && { canvas:next }) };
    });
    revised = { ...revised,sceneBindings };
  }
  validate(revised);
  context?.onEditTarget?.({ destination:'canvas',kind:'canvas',tool:operation.type,beforeGrid:[width,height],grid:map.size,
    offset:map.offset,scale:map.scale,filter:map.filter,bindings,droppedProtected });
  return revised;
}

function saveNamedSelection(design,row) {
  const selections = [...(design.selections ?? [])];
  const index = selections.findIndex(saved=>saved.id === row.id);
  if (index < 0) selections.push(row);
  else selections[index] = row;
  return { ...design,selections };
}

function editSelection(design,frame,patch,context) {
  const { operation } = patch;
  if (patch.edits !== undefined || patch.cel !== undefined ||
      !fields(operation,['id','query','layer','cel','sources']) || !name(operation.id))
    throw new TypeError('A selection edit needs a stable selection ID and a query');
  const { id,query,layer,cel } = operation;
  const { pixels,sources } = selectPixels(design,query,{ frame:frame.id,layer,cel },context);
  if (sources) context?.onSelectionSources?.(sources);
  if (operation.sources !== undefined && !equal(operation.sources,sources ?? []))
    throw Preview.conflict('stale-source','Selection sources differ from the inspected sources',
      { expected:operation.sources,actual:sources ?? [] });
  const runs = RasterTools.runs(frame.width,pixels.map(([x,y])=>y*frame.width+x));
  context?.onEditTarget?.({ destination:'selections',kind:'selections',selection:id,frame:frame.id,
    tool:query.type,pixelCount:pixels.length,runs,...(sources && { sources }) });
  return saveNamedSelection(design,{ id,frame:frame.id,pixels });
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
  let world, editTarget;
  try {
    command.patch = jsonValue(rawPatch ?? null);
    if (expected && !equal(options,expected.command.options))
      throw Preview.conflict('receipt-arguments','Replay needs the same edit options recorded in the receipt');
    if (expected && documentRevision !== expected.inputs.documentRevision)
      throw Preview.conflict('stale-document','Receipt was recorded against a different pixel document',
        { expected:expected.inputs.documentRevision, actual:documentRevision });
    const route = Destinations.resolve(design,patch?.destination), { destination,binding,layer } = route;
    const frame = compile(design,frameId,patch?.cel,layer?.kind === 'surface' ? layer.id : undefined);
    command.frame = ['canvas','palette','adjustments','layers','protection','art-rules','timeline'].includes(destination.kind) ? null : frame.id ?? null;
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
      onSelectionSources(sources) {
        inputs.selectionSources = sources;
        if (expected && !equal(sources,expected.inputs.selectionSources))
          throw Preview.conflict('stale-source','Selection passes or material channels differ from the edit receipt',
            { expected:expected.inputs.selectionSources,actual:sources });
      },
      onSplat: splat => splats.push(splat),
      onEditTarget: target => { editTarget = target; }
    });
    let target = Preview.sourceTarget(route,patch), shotHits, skippedHits = (editTarget?.brush ?? editTarget?.surfacePaint)?.skippedHits ?? [];
    if (editTarget) target = editTarget;
    else if (destination.kind === 'raster') {
      const layer = patch.cel === undefined ? patch.id : [...frame.cels].find(([,id]) => id === patch.cel)[0];
      target = { destination:destination.id, kind:'raster', frame:command.frame, layer,
        cel:rasterCelId(design,frame,layer),
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
    } else if (destination.kind !== 'decal-layer') {
      target.node = 'solid:' + binding.object;
      if (patch.operation.modifier) target.modifier = patch.id;
      if (patch.operation.updateModifier) target.modifier = patch.operation.updateModifier.id;
    }
    const artifactRevision = fingerprint(result);
    const celLinks = !binding && Timeline.linkChanges(design,result);
    const receipt = jsonValue({ ...common, status:'applied', affectedTargets:[target], skippedHits,
      ...(celLinks && { celLinks }),...(shotHits && { shotHits }), outputs:{ kind:destination.kind,
        documentRevision:binding ? documentRevision : artifactRevision, artifactRevision } });
    if (expected) {
      // Version 1 receipts recorded before link reporting can still replay.
      const { celLinks,...baseReceipt } = receipt;
      if (!equal(Object.hasOwn(expected,'celLinks') ? receipt : baseReceipt,expected))
        throw Preview.conflict('receipt-mismatch','Replay did not reproduce the recorded targets, hits, or output revisions');
    }
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

function reportPreview({ baseline,candidate,...options }) {
  return Preview.report({ baseline,candidate,...options,compile,cell,celLinks:Timeline.linkChanges(baseline,candidate ?? baseline) });
}

function previewEdit(design, patch, context, { frameId,limit } = {}) {
  const previewLimit=Preview.previewLimit(limit);
  const targets = [], sources = [], warnings = [];
  let candidate = design, issues = [], source, sourceRevision, sourceWorld;
  try {
    const route = Destinations.resolve(design,patch?.destination);
    const target = Preview.sourceTarget(route,patch), resolvedRows=new Set();
    if (target) targets.push(target);
    const frame = compile(design,frameId ?? (design.version === 2 ? patch?.frame : undefined),patch?.cel,
      route.layer?.kind === 'surface' ? route.layer.id : undefined);
    const output = edit(design,frame,patch,{
      captureSelection:context.captureSelection,
      sceneRef:context.sceneRef,
      onSource(revision,observed) {
        sourceWorld = observed.world;
        sourceRevision = revision;
        if (patch.sourceRevision === undefined) warnings.push(sourceWarning(route.binding.id));
      },
      onSplat(splat) {
        resolvedRows.add(splat.id??splat.row);
        if (splat.weight!==undefined) (target.paintHits ??= []).push(splat);
        if (splat.footprint) (target.footprintHits ??= []).push(splat);
        if (splat.attributes) (target.attributeHits ??= []).push(splat);
        if (splat.topology) (target.topologyHits ??= []).push(splat);
      },
      onEditTarget: summary => {
        if (target && (summary.kind==='scan-material' || summary.brush || summary.surfacePaint)) Object.assign(target,summary);
        else targets.push(summary);
      },
      world:binding => context.world(binding),
      scene(binding) {
        const { editor,revision } = context.scene(binding);
        const fork = editor.fork();
        source = { scene:binding.scene, before:editor.snapshot(), fork };
        return { editor:fork, revision };
      }
    });
    if (!route.binding) candidate = output;
    if (target?.attributeHits || target?.topologyHits || context.splatDiagnostics && resolvedRows.size) {
      target.render=SplatPreview.compare(sourceWorld,sourceWorld.look?.splatFit,output,{
        grid:route.binding.canvas?.size??[design.width,design.height],
        rows:resolvedRows,
        limit:previewLimit,time:context.time,view:context.splatView,diagnostics:context.splatDiagnostics
      });
    }
    if (source) sources.push(...Preview.sourceChanges(source.scene,source.before,source.fork.snapshot()));
  } catch (error) {
    issues = Preview.conflicts(error);
  }
  return reportPreview({ baseline:design,candidate,sources,targets,issues,warnings,sourceRevision,limit });
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
      if (request.frame === undefined && request.cel === undefined && !['canvas','document:canvas','palette','document:palette','adjustments','document:adjustments','layers','document:layers','protection','document:protection','art-rules','document:art-rules','timeline','document:timeline'].includes(request.destination))
        request.frame = 'artwork';
    }
    return request;
  }

  function editContext(context, grouped) {
    return {
      time:context?.time,splatView:context?.view,splatDiagnostics:context?.diagnostics,
      captureSelection:context?.captureSelection ?? (context?.renderFrame && (()=>context.renderFrame)),
      sceneRef:context?.sceneRef ?? (sceneEditor ? sceneName : undefined),
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
      const option = { 'shot-correction':'shotCorrections', 'splat-attributes':'splatFit', 'scan-material':'scanPaint' }[destination.kind];
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

  function previewChanges(options = {}) {
    const {limit,time,view,diagnostics}=options, previewLimit=Preview.previewLimit(limit);
    const before = journal.transactionBase();
    if (!before) throw new Error('No active transaction');
    const content = before.entities[slot]?.content;
    const base = content === undefined ? baseline : JSON.parse(content);
    const draft = state(), targetsByKey = new Map(), verifiedReplays = new Set(draft.verifiedReplays);
    const splatReviews=new Map();
    for (let index = base.receipts.length; index < draft.receipts.length; index++) {
      const receipt = draft.receipts[index];
      const patch = receipt.command.patch, route = Destinations.resolve(draft.design,patch.destination);
      const target = Preview.sourceTarget(route,patch);
      const [painted] = receipt.affectedTargets;
      if (target) {
        const key = JSON.stringify([target.scene,target.destination,target.id]);
        const splats = painted?.kind === 'splat-attributes' ? painted.splats : [];
        const paintHits = splats.filter(row=>row.weight!==undefined);
        const footprintHits = splats.filter(row=>row.footprint);
        const attributeHits = splats.filter(row=>row.attributes);
        const topologyHits = splats.filter(row=>row.topology);
        const summary={ ...target,...((painted?.kind==='scan-material' || painted?.brush || painted?.surfacePaint) && painted), sourceRevision:receipt.inputs.sourceRevision,
          sourceChecked:patch.sourceRevision !== undefined || verifiedReplays.has(index),
          ...(paintHits.length && {paintHits}),
          ...(footprintHits.length && {footprintHits}),
          ...(attributeHits.length && {attributeHits}),
          ...(topologyHits.length && {topologyHits}) };
        targetsByKey.set(key,summary);
        if (attributeHits.length || topologyHits.length || diagnostics && splats.length) {
          const binding=route.binding, grid=binding.canvas?.size??[draft.design.width,draft.design.height];
          const reviewKey=JSON.stringify([binding.scene,grid]);
          if (!splatReviews.has(reviewKey)) splatReviews.set(reviewKey,{binding,grid,rows:new Set(),target:summary});
          for (const row of splats) splatReviews.get(reviewKey).rows.add(row.id??row.row);
        }
      }
      if (['canvas','palette','selections','adjustments','layers','protection','art-rules','timeline'].includes(painted?.kind) || painted?.kind === 'raster' && painted.tool) targetsByKey.set(index,structuredClone(painted));
    }
    const targets = [...targetsByKey.values()];
    let candidate = state().design, scene = sceneEditor?.snapshot(), issues = [];
    try {
      journal.preview();
      candidate = state().design;
      scene = sceneEditor?.snapshot();
      for (const {binding,grid,rows,target} of splatReviews.values()) {
        const world=options.world?.(binding) ?? resolveScene(binding).build();
        const authored=world.look?.splatFit;
        target.render=SplatPreview.compare(world,base.renderOutputs[binding.scene]?.splatFit??authored,
          draft.renderOutputs[binding.scene]?.splatFit??authored,{grid,rows,limit:previewLimit,time,view,diagnostics});
      }
    } catch (error) {
      issues = Preview.conflicts(error);
    }
    const sources = Preview.sourceChanges(sceneName,before.environment,scene);
    const warnings = targets.filter(target => target.binding && !target.sourceChecked).map(target => sourceWarning(target.binding));
    return reportPreview({ baseline:base.design,candidate,sources,targets,issues,warnings,limit });
  }

  const editor = Object.freeze({
    sceneEditor,
    snapshot: () => structuredClone(state().design),
    serialize: (space = 2) => JSON.stringify(state().design,null,space),
    describe: () => validate(state().design),
    palette: () => structuredClone(paletteAsset(state().design)),
    layerDeck: () => structuredClone(layerDeck(state().design)),
    timeline: () => timelineReport(state().design),
    extractPalette: ({ frame,layer,...options } = {})=>extractPalette(
      stampImage(stamp(compile(state().design,frame,undefined,layer),layer),{ preserveHidden:true }),options),
    inspect: (coordinate,options = {}) => inspect(state().design,coordinate,options,
      { ...editContext(options,false),sceneRef:sceneEditor && sceneName }),
    lint: (options = {}) => lintDesign(state().design,options),
    motion: (options = {}) => motionDocument(state().design,options).report,
    artRules: (options = {}) => structuredClone(artRulesReport(state().design,options)),
    sample: (coordinate,options = {}) => samplePixel(state().design,coordinate,options,editContext(options,false)),
    captureBrush: options => captureBrush(state().design,options),
    copySelection: options => copySelection(state().design,options),
    select: (query,options) => selectPixels(state().design,query,options,editContext(options,false)),
    snap: (coordinate,{ frame,radius } = {}) => snapPoint(compile(state().design,frame),coordinate,radius),
    stamp: ({ frame,cel,layer,references } = {}) =>
      stamp(compile(state().design,frame,cel,layer,{ references }),layer),
    png: ({ frame,cel,layer,colorMode } = {}) =>
      PNG.encodePaint(stamp(compile(state().design,frame,cel,layer),layer),colorMode),
    renderOptions: (scene = sceneName) => structuredClone(renderOptions(scene)),
    targets(destination,options = {}) {
      return inspectTargets(state().design,destination,editContext(options,false),options.limit,options);
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
        return reportPreview({ baseline:draft.design,issues:Preview.conflicts(error),limit });
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

function stamp(frame,layer) {
  const raw = layer === undefined ? undefined : frame.layerSources?.get(layer);
  if (layer !== undefined && !raw) throw new RangeError('Unknown pixel layer '+layer);
  const palette = frame.colors.map(hexColor), ids = frame.swatches.slice();
  const slots = Array.from(raw?.slots ?? frame.slots,n=>n < 0 ? null : n);
  if (!raw && frame.mixedColors) {
    const blends = new Map(), occupied = new Set(ids);
    for (let p = 0; p < slots.length; p++) {
      if (slots[p] === null || frame.mixedColors[p] === frame.colors[slots[p]]) continue;
      const color = frame.mixedColors[p];
      if (!blends.has(color)) {
        const rgb = hexColor(color), id = PixelColors.uniqueId(occupied,'blend-'+rgb.slice(1));
        blends.set(color,palette.length);
        occupied.add(id);
        palette.push(rgb);
        ids.push(id);
      }
      slots[p] = blends.get(color);
    }
  }
  const alpha = raw ? raw.alpha : frame.opacity;
  const knockouts = raw && Array.from(raw.slots).flatMap((slot,p)=>slot === -2 ? [p] : []);
  return { width:frame.width,height:frame.height,origin:'top-left',palette,swatchIds:ids,slots,
    ...PixelPalette.stampMetadata({ swatches:frame.paletteEntries,ramps:frame.ramps }),
    ...(alpha && { alpha:Array.from(alpha,(a,p)=>slots[p] === null ? 255 : a) }),
    ...(knockouts?.length && { knockouts }),
    ...(frame.guides?.length && { guides:structuredClone(frame.guides) }),
    ...(frame.sceneBindings?.length && { sceneBindings:structuredClone(frame.sceneBindings) }),
    ...(frame.selections?.length && { selections:frame.selections.map(({ id,pixels })=>({ id,pixels:structuredClone(pixels) })) }) };
}

function authoredCel(width,{ slots,alpha,knockouts },swatchIds) {
  const byAlpha = new Map(), marks = [];
  for (let p = 0; p < slots.length; p++) {
    const value = alpha?.[p] ?? 255;
    if (value === 255 || slots[p] === null) continue;
    if (!byAlpha.has(value)) byAlpha.set(value,[]);
    byAlpha.get(value).push(p);
  }
  for (const [coverage,indices] of byAlpha) marks.push({ alpha:coverage,runs:RasterTools.runs(width,indices) });
  if (knockouts?.length) marks.push({ swatch:null,runs:RasterTools.runs(width,knockouts) });
  return { slots:slots.map(slot=>slot === null ? null : swatchIds[slot]),marks };
}

function documentFromPNG(file) {
  const image = PNG.paintRaster(file), { width,height,swatchIds } = image;
  const palette = PixelPalette.fromStamp(image);
  return { format,version:2,width,height,pixelAspect:[1,1],
    palette:paletteDefinition(palette.swatches),...(palette.ramps.length && { ramps:palette.ramps }),
    layers:[{ id:'image' }],frames:[{ id:'artwork',durationMs:100,
      cels:{ image:authoredCel(width,image,swatchIds) } }] };
}

const stackFormat = 'ink-studio/pixel-layer-deck';

function layerDeck(design) {
  const { width,height,layers,pixelAspect,sceneBindings,destinations,guides,protectedDetails,legacyMetadata,artRules,tags } = design;
  const palette = paletteAsset(design), revision = fingerprint(design), lookup = Timeline.index(design.frames);
  const frames = design.frames.map(frame=>{
    const compiled = compileFrame(design,frame,revision,palette.swatches,true,undefined,lookup);
    const cels = Object.fromEntries(Object.entries(frame.cels).map(([id,cel])=>{
      const { slots,alpha,knockouts } = stamp(compiled,id);
      return [id,{ ...(cel.id && { id:cel.id }),...(cel.label && { label:cel.label }),slots,
        ...(alpha && { alpha }),...(knockouts && { knockouts }) }];
    }));
    return { id:frame.id,...(frame.label && { label:frame.label }),duration:frame.durationMs/1000,cels,
      ...(design.selections && { selections:design.selections.filter(row=>row.frame === frame.id).map(({ id,pixels })=>({ id,pixels })) }),
      ...(guides && { guides:guides.filter(row=>row.frame === frame.id).map(({ frame,...guide })=>guide) }) };
  });
  return { format:stackFormat,version:1,width,height,pixelAspect,origin:'top-left',layers:layers.map(({ offset,...layer })=>layer),
    palette:palette.swatches.map(row=>row.color),swatchIds:palette.swatches.map(row=>row.id),
    ...PixelPalette.stampMetadata(palette),frames,
    ...(guides?.some(row=>row.frame === undefined) && { guides:guides.filter(row=>row.frame === undefined) }),
    ...(design.selections?.some(row=>row.frame === undefined) && { sharedSelections:design.selections.filter(row=>row.frame === undefined) }),
    ...(sceneBindings && { sceneBindings }),...(destinations && { destinations }),...(protectedDetails && { protectedDetails }),
    ...(artRules && { artRules }),...(legacyMetadata && { legacyMetadata }),...(tags && { tags }) };
}

function documentFromDeck(deck) {
  if (deck?.format !== stackFormat || deck.version !== 1 || !Array.isArray(deck.frames) || !deck.frames.length)
    throw new TypeError('Expected a version 1 Ink pixel layer deck');
  const { width,height,pixelAspect = [1,1],layers,swatchIds,sceneBindings,destinations,protectedDetails,legacyMetadata,artRules,tags } = deck;
  const asset = PixelPalette.fromStamp(deck);
  const guides = [...(deck.guides ?? [])], selections = [...(deck.sharedSelections ?? [])], frameIds = new Set();
  for (const frame of deck.frames) if (frame.id !== undefined) {
    if (!name(frame.id) || frameIds.has(frame.id)) throw new RangeError('Layer deck frame IDs must be unique');
    frameIds.add(frame.id);
  }
  const frames = deck.frames.map((frame,i)=>{
    let id = frame.id;
    if (id === undefined) {
      id = PixelColors.uniqueId(frameIds,'frame-'+(i+1));
      frameIds.add(id);
    }
    const valid = require('../src/pixel-stamps.js').prepare;
    const cels = Object.fromEntries(Object.entries(frame.cels).map(([layer,cel])=>{
      const { entries } = valid({ width,height,palette:deck.palette,frames:[cel] },{ preserveHidden:true });
      const { slots,alpha } = entries[0], { knockouts } = cel;
      if (knockouts !== undefined && (!Array.isArray(knockouts) ||
          !Array.from(knockouts).every((p,i)=>Number.isInteger(p) && slots[p] === null && (i === 0 || p > knockouts[i-1]))))
        throw new TypeError('Layer deck knockouts must be sorted transparent cells');
      return [layer,{ ...(cel.id && { id:cel.id }),...(cel.label && { label:cel.label }),
        ...authoredCel(width,{ slots,alpha,knockouts },swatchIds) }];
    }));
    for (const guide of frame.guides ?? []) guides.push({ ...guide,frame:id });
    for (const selection of frame.selections ?? []) selections.push({ ...selection,frame:id });
    if (!Number.isFinite(frame.duration) || frame.duration <= 0) throw new RangeError('Deck frames need positive durations');
    return { id,durationMs:Math.max(1,Math.round(frame.duration*1000)),...(frame.label && { label:frame.label }),cels };
  });
  const design = { format,version:2,width,height,pixelAspect,layers,frames,palette:paletteDefinition(asset.swatches),
    ...(asset.ramps.length && { ramps:asset.ramps }),...(guides.length && { guides }),...(selections.length && { selections }),
    ...(sceneBindings && { sceneBindings }),...(destinations && { destinations }),...(protectedDetails && { protectedDetails }),
    ...(artRules && { artRules }),...(legacyMetadata && { legacyMetadata }),...(tags !== undefined && { tags }) };
  validate(design);
  return design;
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

function craftLayer(frame,layer) {
  if (layer === undefined) return frame;
  const raw = frame.layerSources?.get(layer);
  if (!raw) throw new RangeError('Unknown pixel layer '+layer);
  const slots = Int16Array.from(raw.slots,(slot,p)=>slot < 0 || raw.alpha?.[p] === 0 ? -1 : slot);
  return { ...frame,slots,opacity:raw.alpha,owners:Uint8Array.from(slots,slot=>Number(slot >= 0)),
    layerIds:[null,layer],mixedColors:undefined,underSlots:undefined,underOwners:undefined };
}

function lintDesign(design,{ frame,layer,cel,kind,finding,shot } = {}) {
  if (layer !== undefined && cel !== undefined) throw new TypeError('Choose one layer or cel to lint');
  const compiled = compile(design,frame,cel,layer ?? (cel !== undefined));
  layer ??= cel === undefined ? undefined : [...compiled.cels].find(([,id])=>id === cel)?.[0];
  const { report } = review(craftLayer(compiled,layer),{ kind,finding,overlay:false,rules:rulesFor(design),shot,layer });
  if (finding !== undefined && !report.diagnostics.length) throw new RangeError('No diagnostic '+finding+' in this native frame');
  return { ...report,...(layer !== undefined && { layer }) };
}

function motionDocument(design,{ plan,layer } = {}) {
  documentShape(design);
  if (design.version !== 2) throw new TypeError('Motion checks need a version 2 pixel animation');
  const { width,height,frames } = design, revision = fingerprint(design);
  const palette = paletteEntries(design.palette,2), byId = new Map();
  let elapsed = 0;
  for (const frame of frames) {
    byId.set(frame.id,{ frame,time:elapsed/1000 });
    elapsed += frame.durationMs;
  }
  const prepared = MotionReview.plan(plan,'document',width,height,frames.map(frame=>({ frame:frame.id })));
  const images = prepared.samples.map(row=>{
    const entry = byId.get(row.frame);
    if (!entry) throw new RangeError('Unknown motion frame '+row.frame);
    const raster = compileFrame(design,entry.frame,revision,palette,layer);
    const { guides,durationMs } = raster;
    const gaps = [...(row.gaps ?? []),...(raster.protectedDetails ?? [])
      .filter(row=>row.kind === 'gap').flatMap(row=>row.pixels)];
    return Motion.fromRaster(craftLayer(raster,layer),{
      ...row,id:row.id ?? row.frame,label:row.label ?? entry.frame.label ?? row.id ?? row.frame,
      time:entry.time,durationMs,anchor:row.anchor ?? Motion.registration(guides,row.guide),gaps
    });
  });
  return { images,report:{ ...Motion.audit(images,prepared.options),revision,
    ...(layer !== undefined && { layer }) } };
}

function motionCommand(source,opt,captureMotion) {
  if (opt.views === undefined ? opt.subject !== undefined : opt.layer !== undefined)
    throw new TypeError('Choose --layer for a pixel document or --subject for scene views');
  const plans = [opt.plan,opt.views].filter(value=>value !== undefined);
  if (plans.length > 1 || plans.some(value=>typeof value !== 'string'))
    throw new TypeError('Use --plan for a document or --views for a rendered scene');
  const outputs = [opt.out,opt.review].filter(value=>value !== undefined);
  if (outputs.some(value=>typeof value !== 'string' || [source,...plans].some(file=>path.resolve(file) === path.resolve(value))) ||
      new Set(outputs.map(file=>path.resolve(file))).size !== outputs.length ||
      opt.review !== undefined && !/\.html$/i.test(opt.review))
    throw new TypeError('Write the motion report and HTML review to separate paths');
  const plan = plans.length ? read(plans[0]) : undefined;
  const { images,report } = opt.views === undefined ? motionDocument(read(source),{ plan,layer:opt.layer }) :
    captureMotion(source,plan,opt.subject,!!opt.review);
  if (opt.review) MotionReview.writeReview(path.resolve(opt.review),images,report);
  if (opt.out) files.json(path.resolve(opt.out),report);
  else process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

function trackCommand(source,opt,captureTrack) {
  const { selection:id,binding:bindingId,views,scene,out,review } = opt;
  if (![id,bindingId,views].every(reference) || scene !== undefined && !reference(scene) ||
      opt['source-view'] !== undefined || opt.w !== undefined || opt.h !== undefined || opt.t !== undefined)
    throw new TypeError('Use pixel-art track <document.json> --selection id --binding id --views plan.json [--scene scene]');
  const design = read(source);
  documentShape(design);
  const binding = design.sceneBindings?.find(row=>row.id === bindingId);
  if (!binding) throw new RangeError('Unknown pixel scene binding '+bindingId);
  if (scene !== undefined && !sameScene(binding.scene,scene)) throw new RangeError('The selection binding belongs to '+binding.scene);
  const sceneRef = scene ?? binding.scene, selection = namedSelection(design,id,binding.frame);
  const outputs = [out,review].filter(value=>value !== undefined);
  if (outputs.some(value=>!reference(value) || [source,views,sceneRef].some(file=>path.resolve(file) === path.resolve(value))) ||
      new Set(outputs.map(file=>path.resolve(file))).size !== outputs.length || review !== undefined && !/\.html$/i.test(review))
    throw new TypeError('Write the tracking report and HTML review to separate paths');
  const { images,report } = SelectionTrack.track({ binding,selection,documentGrid:[design.width,design.height],
    revision:fingerprint(design),views:read(views),render:captureTrack(sceneRef,binding),review:!!review });
  if (review) SelectionTrack.writeReview(path.resolve(review),images,report);
  if (out) files.json(path.resolve(out),report);
  else process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

function correctCommand(source, planFile, opt, captureTrack) {
  const { apply,approval,out,review } = opt;
  if ((apply === undefined) !== (approval === undefined) || approval !== undefined && !isRevision(approval) ||
      [opt.scene,opt.binding,opt.frame,opt.w,opt.h,opt.t].some(value => value !== undefined))
    throw new TypeError('Use pixel-art correct <document.json> <plan.json> with --apply <document.json> and --approval <digest> to commit');
  const design = read(source), plan = read(planFile);
  documentShape(design);
  const binding = design.sceneBindings?.find(row => row.id === plan?.binding);
  const inputs = [source,planFile,binding?.scene].filter(reference).map(file => path.resolve(file));
  const outputs = [apply,out,review].filter(value => value !== undefined);
  if (outputs.some(file => !reference(file) || inputs.includes(path.resolve(file))) ||
      new Set(outputs.map(file => path.resolve(file))).size !== outputs.length ||
      review !== undefined && !/\.html$/i.test(review))
    throw new TypeError('Write the corrected document, report and HTML review to separate output paths');
  const result = TrackedCorrection.run(design,plan,{ compile,edit,captureTrack,approval,includeImages:!!review });
  if (review) TrackedCorrection.writeReview(path.resolve(review),result.images,result.report);
  if (apply) files.json(path.resolve(apply),result.document);
  if (out) files.json(path.resolve(out),result.report);
  else process.stdout.write(JSON.stringify(result.report,null,2)+'\n');
}

function reprobeCommand(source,opt,capture) {
  const { binding:id,before,after,selection,rect:rectangle,out,invalidate,accept } = opt;
  if (![id,before].every(reference) || after !== undefined && !reference(after) ||
      (selection === undefined) === (rectangle === undefined) || selection !== undefined && !reference(selection) ||
      accept !== undefined && (accept !== true || !reference(invalidate)))
    throw new TypeError('Use pixel-art reprobe <document.json> --binding id --before view.json --selection id or --rect x,y,w,h');
  const design = read(source);
  documentShape(design);
  const binding = design.sceneBindings?.find(row=>row.id === id);
  if (!binding) throw new RangeError('Unknown pixel scene binding '+id);
  const { width,height } = design;
  let pixels;
  if (selection !== undefined) pixels = namedSelection(design,selection,binding.frame).pixels;
  else {
    if (typeof rectangle !== 'string' || !/^\d+,\d+,\d+,\d+$/.test(rectangle))
      throw new TypeError('Use --rect x,y,width,height inside the document grid');
    const [x,y,w,h] = rectangle.split(',').map(Number);
    if (!at(width,height,[x,y]) || !integer(w,1,width-x) || !integer(h,1,height-y))
      throw new RangeError('Reprobe rectangle is outside the document grid');
    pixels = Array.from({length:w*h},(_,i)=>[x+i%w,y+Math.floor(i/w)]);
  }
  const inputs = [source,before,after,binding.scene].filter(reference).map(file=>path.resolve(file));
  const outputs = [out,invalidate].filter(value=>value !== undefined);
  if (outputs.some(value=>!reference(value) || inputs.includes(path.resolve(value))) ||
      new Set(outputs.map(file=>path.resolve(file))).size !== outputs.length)
    throw new TypeError('Write the reprobe report and invalidated document to separate paths');
  if (opt.scene !== undefined || opt['source-view'] !== undefined)
    throw new TypeError('Use the binding’s scene or supply --after with a matching captured view');
  const baseline = ViewSource.unpack(read(before));
  if (!sameScene(binding.scene,baseline.sourceView.source))
    throw new RangeError('The before capture belongs to a different scene');
  const current = after ? ViewSource.unpack(read(after)) : inspectionCapture(baseline.w,baseline.h,undefined,{
    sceneRef:binding.scene,captureSelection:settings=>capture(binding.scene,{
      ...settings,time:baseline.sourceView.frame.time,captureId:'reprobe'
    })
  },binding);
  if (!sameScene(binding.scene,current.sourceView.source))
    throw new RangeError('The after capture belongs to a different scene');
  const { report,stale } = require('./pixel-binding-reprobe.js').probe(design,binding,pixels,baseline,current,{accept});
  if (invalidate) {
    if (stale.length) binding.stale = stale;
    else delete binding.stale;
    files.json(path.resolve(invalidate),design);
  }
  if (out) files.json(path.resolve(out),report);
  else process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

function multiviewCommand(source,planFile,opt,{ scene,captureMultiview }) {
  const { out,patch,review } = opt, raw = read(planFile), design = read(source);
  documentShape(design);
  if (!reference(raw?.destination)) throw new TypeError('A multiview plan needs a surface-channel destination');
  const route = Destinations.resolve(design,raw.destination), { binding,layer } = route;
  if (route.destination.kind !== 'surface-channel') throw new TypeError('Multiview edits need a surface-channel destination');
  if (opt.scene !== undefined && (!reference(opt.scene) || !sameScene(binding.scene,opt.scene)))
    throw new RangeError('The multiview destination is bound to '+binding.scene);
  const sceneRef = opt.scene ?? binding.scene, outputs = [out,patch,review].filter(file=>file !== undefined);
  const inputs = [source,planFile,sceneRef].map(file=>path.resolve(file));
  if (outputs.some(file=>!reference(file) || inputs.includes(path.resolve(file))) ||
      new Set(outputs.map(file=>path.resolve(file))).size !== outputs.length ||
      review !== undefined && !/\.html$/i.test(review))
    throw new TypeError('Write the multiview report, patch and HTML review to separate paths');
  const original = scene(sceneRef), context = { scene:()=>original };
  const target = Destinations.surfaceSource(route,context);
  const compiled = compile(design,raw.frame ?? binding.frame,undefined,layer?.kind === 'surface' ? layer.id : undefined);
  if (binding.frame !== undefined && binding.frame !== compiled.id) throw new RangeError('Multiview edit belongs to frame '+binding.frame);
  const clipping = layer?.kind === 'surface' && compiled.layerSources?.get(layer.id)?.clipping;
  const Multiview = require('./pixel-multiview.js');
  const result = Multiview.review(raw,design,{ ...route,...target },{
    revision:compiled.revision,frame:compiled.id,includeImages:!!review,
    render:(candidate = original.editor.snapshot())=>captureMultiview(sceneRef,candidate),
    preview:request=>edit(design,compiled,request,{
      scene:()=>({ editor:original.editor.fork(),revision:original.revision })
    }),
    protect([x,y]) {
      const p = y*compiled.width+x;
      return compiled.locks[p] ? 'protected-pixel' : clipping && !clipping[p] ? 'clipped-pixel' : null;
    }
  });
  if (review) Multiview.writeReview(path.resolve(review),result.report,result.images);
  if (out) files.json(path.resolve(out),result.report);
  else process.stdout.write(JSON.stringify(result.report,null,2)+'\n');
  if (patch && result.patch) files.json(path.resolve(patch),result.patch);
  else if (patch) process.exitCode = 2;
}

function draw(frame,directory,{ layer,colorMode,rules,shot } = {}) {
  const indexed = stamp(frame,layer), art = PNG.encodePaint(indexed,colorMode);
  const result = review(craftLayer(frame,layer),{ rules,shot,layer }), { w,h,rgb } = result.overlay;
  fs.mkdirSync(directory,{ recursive:true });
  files.write(path.join(directory,'art.png'),art);
  files.write(path.join(directory,'review.png'),PNG.encode(w,h,rgb));
  files.json(path.join(directory,'stamp.json'),indexed);
  files.json(path.join(directory,'report.json'),result.report);
  return result.report;
}

function canvasReview(design,frameId,file,sources,scene,artShot,reviewBinding) {
  const lookup = documentShape(design);
  const palette = paletteEntries(design.palette,design.version), revision = fingerprint(design);
  const frames = design.version === 1 ? [undefined] : design.frames;
  if (frameId !== undefined && !frames.some(frame => frame?.id === frameId))
    throw new RangeError('Unknown pixel frame ' + frameId);
  const chosen = frameId === undefined ? frames : frames.filter(frame => frame.id === frameId);
  if (sources.some(source=>source.frame !== undefined && !chosen.some(frame=>frame?.id === source.frame)))
    throw new RangeError('A source channel is bound to a frame outside this canvas');
  const encodeSlots = slots => Buffer.from(Uint8Array.from(slots,slot => slot < 0 ? 255 : slot)).toString('base64');
  const definitions = design.version === 1 ? design.layers.map(({ id,clip,protect })=>({ id,clip,protect })) : design.layers;
  const layerIds = [null,...LayerStack.prepare(definitions).rows.keys()];
  const hasReferences = definitions.some(row=>row.kind === 'reference' && row.visible !== false);
  const deck = chosen.map(frame => {
    const compiled = compileFrame(design,frame,revision,palette,true,{ references:true },lookup);
    const encode = bytes => Buffer.from(bytes).toString('base64');
    const clean = hasReferences ? compileFrame(design,frame,revision,palette,undefined,undefined,lookup) : compiled;
    const { width,height,rgba } = stampImage(stamp(compiled));
    return { label:frame?.label ?? frame?.id ?? 'Drawing', diagnosticSource:{
      owners:encode(clean.owners),locks:encode(clean.locks),
      ...(hasReferences && { slots:encodeSlots(clean.slots),
        ...(clean.opacity && { alpha:encode(clean.opacity),rgb:encode(image(clean).rgb) }) })
    }, png:encode(PNG.encode(width,height,rgba,4)),
      guides:compiled.guides ?? [], id:frame?.id, durationMs:frame?.durationMs ?? 100, protectedDetails:compiled.protectedDetails ?? [], composite:encodeSlots(compiled.slots),
      ...(compiled.opacity && { alpha:encode(compiled.opacity),rgb:encode(image(compiled).rgb) }),
      layers:[...compiled.layerSources].map(([id,row]) => ({
        id,cel:compiled.cels?.get(id) ?? null,slots:encodeSlots(row.slots),...(row.alpha && { alpha:encode(row.alpha) }),
        ...(row.slots.includes(-2) && { knockouts:encode(Uint8Array.from(row.slots,slot=>Number(slot === -2))) })
      })) };
  });
  const { width,height } = design, cells = width*height;
  if (sources.reduce((size,source)=>size+(source.type === 'number' ? 1 : 4)*cells,0) > 2_000_000)
    throw new RangeError('Choose fewer source channels for the offline canvas');
  const materials = sources.map(source=>{
    const { sample,...metadata } = source;
    const count = source.type === 'number' ? 1 : 4, values = Buffer.alloc(cells*count*8);
    let missing;
    for (let p=0; p<cells; p++) {
      const uv = pixelUV(width,height,[p%width,Math.floor(p/width)],source.canvas);
      if (!uv) {
        missing ??= Buffer.alloc(cells);
        missing[p] = 1;
        continue;
      }
      const value = sample(uv);
      if (count === 1) values.writeDoubleLE(value,p*8);
      else if (value) [...value.color,value.coverage].forEach((component,i) => values.writeDoubleLE(component,(p*4+i)*8));
      else values.writeDoubleLE(-1,(p*4+3)*8);
    }
    return { ...metadata,values:values.toString('base64'),...(missing && { missing:missing.toString('base64') }) };
  });
  const template = fs.readFileSync(path.join(__dirname,'pixel-grid-review.html'),'utf8');
  const browserSource = ext => fs.readFileSync(path.join(__dirname,'../src/pixel-grid-canvas.'+ext),'utf8');
  const rulesSource = design.version === 2 && design.artRules && {
    definition:design.artRules,artShot,ramps:design.ramps,layers:design.layers,
    frames:design.frames.map(row=>row.id),selections:design.selections
  };
  if (artShot !== undefined) ArtRules.describe(rulesFor(design),{ shot:artShot });
  const sceneRef = scene?.sourceView?.source ?? scene?.scene;
  const sceneBindings = sceneRef === undefined ? [] : (design.sceneBindings ?? []).filter(row=>sameScene(row.scene,sceneRef));
  const timeline = lookup && Timeline.describe(design,revision,lookup);
  const data = JSON.stringify({ frames:deck,timeline,palette,materials,definitions,scene:scene && ViewSource.pack(scene),
    sceneBindings,reviewBinding,layerIds,rulesSource }).replaceAll('<','\\u003c');
  files.write(file,template.replace('/*PIXEL_GRID_CSS*/',() => browserSource('css'))
    .replace('/*PIXEL_GUIDES_MODULE*/',() => fs.readFileSync(path.join(__dirname,'../src/pixel-guides.js'),'utf8'))
    .replace('/*PIXEL_GRID_MODULE*/',() => browserSource('mjs'))
    .replace('/*PIXEL_ONION_MODULE*/',() => fs.readFileSync(path.join(__dirname,'../src/pixel-onion-skin.mjs'),'utf8'))
    .replace('/*PIXEL_PLAYBACK_MODULES*/',() => ['pixel-playback-ranges.js','pixel-range-player.mjs']
      .map(file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8')).join('\n'))
    .replace('/*PIXEL_INSPECT_MODULES*/',() => [
      'pixel-layer-stack.js','pixel-canvas-transforms.js','pixel-source-bindings.js','pixel-inspection.js','pixel-view-source.js','pixel-protection.js','art-passes.js',
      'pixel-craft.js','target-selectors.js','pixel-art-rules.js','pixel-inspector.mjs','pixel-craft-panel.mjs'
    ].map(file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8')).join('\n'))
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

const actions = ['capture','trace','import','upgrade','validate','timeline','targets','draw','canvas','inspect','lint','rules','motion','track','correct','reprobe','multiview','sample','select','snap','brush','copy',
  'preview','edit','replay'];
const sessionActions = ['init','status','begin','apply','preview','commit','cancel','undo','redo',
  'inspect','sample','select','snap','brush','copy','timeline','targets','export'];
const paletteActions = ['export','extract','import'];
const stackActions = ['export','import'];

function extractPalette(image,options) {
  return PixelPalette.fromExtraction(PaletteExtract.extract(image,options));
}

function paletteCommand(pos,opt) {
  const [action,source,input] = pos;
  if (!paletteActions.includes(action) || pos.length !== (action === 'import' ? 3 : 2) ||
      typeof opt.out !== 'string' || !opt.out.trim())
    throw new TypeError('Use pixel-art palette export <document.json>, extract <image.png|document.json>, or import <document.json> <palette.json> with --out');
  const out = path.resolve(opt.out);
  if ([source,input].some(file=>file && path.resolve(file) === out))
    throw new RangeError('Write the palette result separately from its inputs');
  if (action === 'extract') {
    const options = { size:opt.size === undefined ? undefined : typeof opt.size === 'string' ? Number(opt.size) : NaN,
      alpha:opt.alpha };
    const image = /\.json$/i.test(source)
      ? stampImage(stamp(compile(read(source),opt.frame,undefined,opt.layer),opt.layer),{ preserveHidden:true })
      : PNG.paletteSource(source);
    files.json(out,extractPalette(image,options));
    return;
  }
  if (action === 'export') {
    const design = read(source);
    documentShape(design);
    files.json(out,paletteAsset(design));
    return;
  }
  const design = read(source);
  const patch = { id:'import-palette',revision:fingerprint(design),destination:'document:palette',
    operation:{ type:'import',palette:read(input) } };
  const { result,receipt } = editWithReceipt(design,patch,{}, { runner:'cli',options:{} });
  files.json(out,result);
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
}

function stackCommand(pos,opt) {
  const [action,source] = pos;
  if (!stackActions.includes(action) || pos.length !== 2 || typeof opt.out !== 'string' ||
      !opt.out.trim() || path.resolve(source) === path.resolve(opt.out))
    throw new TypeError('Use pixel-art stack export <document.json> --out deck.json or stack import <deck.json> --out document.json');
  const data = read(source);
  files.json(path.resolve(opt.out),action === 'export' ? layerDeck(openDesign(data).design) : documentFromDeck(data));
}

function destinationList(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.split(',').some(id=>!id.trim()))
    throw new TypeError('Use --destination with comma-separated surface destination IDs');
  return raw.split(',').map(id=>id.trim());
}

function inspectCoordinate(raw) {
  if (typeof raw !== 'string' || !/^\d+,\d+$/.test(raw))
    throw new TypeError('Use --at x,y inside the native grid');
  return raw.split(',').map(Number);
}

function command(pos,opt,outputFile,{ capture, captureMotion, captureTrack, captureMultiview, world, scene, view }) {
  if (pos[0] === 'stack') return stackCommand(pos.slice(1),opt);
  if (pos[0] === 'palette') return paletteCommand(pos.slice(1),opt);
  const [action, source, patch] = pos;
  const writing = action === 'edit' || action === 'replay';
  if (!actions.includes(action) ||
      pos.length !== (writing || ['preview','select','multiview','correct'].includes(action) ? 3 : 2))
    throw new TypeError('Use pixel-art capture, trace, import, upgrade, validate, timeline, targets, draw, canvas, inspect, lint, rules, motion, track, correct, reprobe, multiview, sample, select, snap, brush, copy, preview, edit, or replay. See ink-studio help.');
  if (action === 'track') return trackCommand(source,opt,captureTrack);
  if (action === 'correct') return correctCommand(source,patch,opt,captureTrack);
  if (action === 'reprobe') return reprobeCommand(source,opt,capture);
  if (action === 'multiview') return multiviewCommand(source,patch,opt,{ scene,captureMultiview });
  const sourceViewFile = opt['source-view'];
  if (opt.binding !== undefined && (!['inspect','canvas'].includes(action) || !reference(opt.binding)))
    throw new TypeError('Use --binding id with pixel-art inspect or canvas');
  if (sourceViewFile !== undefined && (!reference(sourceViewFile) ||
      (action === 'targets' ? !reference(opt.scene) || !reference(opt.query) :
        !['inspect','canvas'].includes(action) || opt.scene !== undefined)))
    throw new TypeError('Use --source-view by itself with inspect or canvas, or with --scene and --query for splat targets');
  if (action === 'motion') return motionCommand(source,opt,captureMotion);
  if (action === 'capture') {
    if (!reference(opt.out) || path.resolve(source) === path.resolve(opt.out) ||
        (opt['view-id'] !== undefined && !reference(opt['view-id'])))
      throw new TypeError('Use pixel-art capture <scene> --out <view.json> [--view-id id]');
    if (opt.w === true || opt.h === true) throw new TypeError('--w and --h need native grid dimensions');
    const w = opt.w === undefined ? 160 : Number(opt.w), h = opt.h === undefined ? 96 : Number(opt.h);
    ViewSource.grid(w,h);
    const coordinate = opt.at === undefined ? undefined : inspectCoordinate(opt.at);
    if (coordinate && !at(w,h,coordinate)) throw new RangeError('Scene pixel is outside the native grid');
    const frame = inspectionCapture(w,h,coordinate,{
      captureSelection:settings=>capture(source,{ ...settings,captureId:opt['view-id'] })
    });
    files.json(path.resolve(opt.out),ViewSource.pack(frame));
    return;
  }
  if (action === 'trace') {
    if (typeof opt.subject !== 'string' || !opt.subject.trim()) throw new TypeError('Trace needs --subject object-id');
    const frame = capture(source,{ sceneInspection:true,captureId:'trace' });
    const design = trace(frame,opt.subject,source), saved = ViewSource.pack(frame);
    const directory = outputFile('pixel-art-trace');
    draw(compile(design),directory);
    files.json(path.join(directory,'design.json'),design);
    files.json(path.join(directory,'source-view.json'),saved);
    console.log('wrote',directory);
    return;
  }
  if (action === 'import') {
    if (typeof opt.out !== 'string' || !opt.out.trim() || path.resolve(source) === path.resolve(opt.out))
      throw new TypeError('Use pixel-art import <image.png> --out <document.json>');
    const design = documentFromPNG(source);
    files.json(path.resolve(opt.out),design);
    return;
  }
  const design = read(source);
  if (action === 'lint' || action === 'rules') {
    const { frame,layer,cel,kind,finding } = opt, shot = opt['art-shot'];
    if (opt.out !== undefined && (typeof opt.out !== 'string' || path.resolve(opt.out) === path.resolve(source)))
      throw new TypeError('Write the diagnostic report to a separate JSON file');
    const report = action === 'lint' ? lintDesign(design,{ frame,layer,cel,kind,finding,shot }) :
      artRulesReport(design,{ frame,layer,shot });
    if (opt.out) files.json(path.resolve(opt.out),report);
    else process.stdout.write(JSON.stringify(report,null,2)+'\n');
    return;
  }
  if (action === 'copy') {
    const { selection,frame,layer,cel } = opt;
    process.stdout.write(JSON.stringify(copySelection(design,{ selection,frame,layer,cel }),null,2)+'\n');
    return;
  }
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
  if (action === 'validate' || action === 'timeline') {
    const report = action === 'timeline' ? timelineReport(design) : validate(design);
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    return;
  }
  const out = writing && typeof opt.out === 'string' ? path.resolve(opt.out) : undefined;
  function sourceFor(binding) {
    if (!sameScene(binding.scene,opt.scene))
      throw new TypeError('Pass --scene ' + binding.scene + ' to use the bound source');
    if (out && [source,patch,binding.scene].some(file => path.resolve(file) === out))
      throw new RangeError('Write the scene edit to a separate output from its inputs');
    return opt.scene;
  }
  const context = {
    sceneRef:opt.scene,splatView:view,splatDiagnostics:splatDiagnosticOptions(opt),
    time:opt.t===undefined ? undefined : typeof opt.t==='string' ? Number(opt.t) : NaN,
    captureSelection:sourceViewFile ? ()=>ViewSource.unpack(read(sourceViewFile)) : reference(opt.scene) ? settings=>{
      if (out === path.resolve(opt.scene))
        throw new RangeError('Write the edit to a separate output from the rendered scene');
      return capture(opt.scene,settings);
    } : undefined,
    world:binding => world(sourceFor(binding)),
    scene:binding => scene(sourceFor(binding))
  };
  if (action === 'select') {
    const { frame,layer,cel } = opt;
    process.stdout.write(JSON.stringify(selectPixels(design,read(patch),{ frame,layer,cel },context),null,2)+'\n');
    return;
  }
  if (action === 'canvas') {
    if (typeof opt.out !== 'string' || !/\.html$/i.test(opt.out) || path.resolve(opt.out) === path.resolve(source))
      throw new TypeError('Use pixel-art canvas <design.json> --out <canvas.html>');
    const destinations = destinationList(opt.destination);
    if ([opt.scene,sourceViewFile].some(input=>reference(input) && path.resolve(input) === path.resolve(opt.out)))
      throw new RangeError('Write the canvas separately from its inputs');
    if (destinations && !reference(opt.scene)) throw new TypeError('Use --scene with surface destinations');
    if (opt.at !== undefined && !reference(opt.scene) && !sourceViewFile)
      throw new TypeError('Use --scene or --source-view with a pinned scene pixel');
    documentShape(design);
    const coordinate = opt.at === undefined ? undefined : inspectCoordinate(opt.at);
    if (coordinate && !at(design.width,design.height,coordinate)) throw new RangeError('Scene pixel is outside the native grid');
    const materials = inspectionMaterials(design,destinations,context,opt.frame);
    const binding = opt.binding === undefined ? undefined : design.sceneBindings?.find(row=>row.id === opt.binding);
    if (opt.binding !== undefined && !binding) throw new RangeError('Unknown pixel scene binding '+opt.binding);
    if (binding && !context.captureSelection) throw new TypeError('A binding canvas needs --scene or --source-view');
    if (binding && opt.frame !== undefined && binding.frame !== undefined && binding.frame !== opt.frame)
      throw new RangeError('Canvas binding is scoped to frame '+binding.frame);
    const grid = [design.width,design.height], size = binding?.canvas?.size ?? grid;
    const sample = coordinate && (binding ? CanvasTransforms.sourcePoint(grid,coordinate,binding.canvas)?.map(Math.floor) : coordinate);
    const scene = inspectionCapture(...size,sample,context,binding);
    const sceneRef = scene?.sourceView?.source ?? context.sceneRef ?? scene?.scene;
    if (binding && (!sceneRef || !sameScene(binding.scene,sceneRef)))
      throw new RangeError('Canvas source is not the scene of binding '+binding.id);
    const file = path.resolve(opt.out);
    canvasReview(design,opt.frame,file,materials,scene,opt['art-shot'],binding?.id);
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
    const query = targetQuery(opt);
    const report = inspectTargets(design,opt.destination,context,limit,{query,frame:opt.frame});
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
  if (action === 'inspect') {
    const destinations = destinationList(opt.destination);
    if (opt.scene === true) throw new TypeError('--scene needs a scene reference');
    if (opt.out === true) throw new TypeError('--out needs an inspection report path');
    if (destinations && !reference(opt.scene)) throw new TypeError('Use --scene to inspect source destinations');
    const result = inspect(design,inspectCoordinate(opt.at),{ frame:opt.frame,cel:opt.cel,binding:opt.binding,
      destinations,references:opt.references === true },context);
    if (typeof opt.out === 'string') {
      if ([source,opt.scene,sourceViewFile].some(file=>reference(file) && path.resolve(opt.out) === path.resolve(file)))
        throw new RangeError('Write the inspection report separately from its inputs');
      files.json(path.resolve(opt.out),result);
    } else process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return;
  }
  const frame = compile(design,opt.frame,undefined,action === 'draw' ? opt.layer : undefined);
  if (action === 'snap') {
    const { point,radius } = snapOptions(opt);
    process.stdout.write(JSON.stringify(snapPoint(frame,point,radius),null,2)+'\n');
    return;
  }
  if (action === 'draw') {
    const directory=outputFile('pixel-art');
    draw(frame,directory,{ layer:opt.layer,colorMode:opt['color-mode'],rules:rulesFor(design),shot:opt['art-shot'] });
    console.log('wrote',directory);
    return;
  }
}

function targetQuery(opt) {
  if (opt.query === undefined) return;
  if (!reference(opt.query)) throw new TypeError('--query needs a splat query JSON file');
  return read(opt.query);
}

function inspectTargets(design,destination,context,limit = 128,{query,frame} = {}) {
  documentShape(design);
  if (!integer(limit,1,Number.MAX_SAFE_INTEGER)) throw new RangeError('Pixel target limit must be a positive integer');
  const route=Destinations.resolve(design,destination);
  let plan;
  if (query !== undefined) {
    if (route.destination.kind !== 'splat-attributes') throw new TypeError('A splat query needs a splat-attributes destination');
    if (frame !== undefined && (!design.frames.some(row=>row.id===frame) || route.binding.frame!==undefined && route.binding.frame!==frame))
      throw new RangeError('The requested frame is outside the splat binding scope');
    const frameId=frame??route.binding.frame??design.frames[0].id;
    plan=require('./pixel-splat-selection.js').prepare(query,[design.width,design.height],
      id=>namedSelection(design,id,frameId).pixels);
    plan.frame=frameId;
  }
  const targets = Destinations.targets(route,{...context,sameScene},limit,plan);
  return { documentRevision:fingerprint(design), ...targets };
}

function splatDiagnosticOptions(opt) {
  if (opt['splat-diagnostics'] === undefined) return;
  if (opt['splat-diagnostics'] !== true) throw new TypeError('Use --splat-diagnostics to include native splat diagnostics');
  const coordinates = key => {
    if (opt[key] === undefined) return undefined;
    if (typeof opt[key] !== 'string' || !/^\d+(,\d+)+$/.test(opt[key]))
      throw new TypeError('--'+key+' needs comma-separated art-grid integers');
    return opt[key].split(',').map(Number);
  };
  return { at:coordinates('at'),rect:coordinates('rect') };
}

function sessionCommand(pos,opt,{ scene,capture,view }) {
  const [action,directory,input] = pos;
  const argc = ['init','apply','select'].includes(action) ? 3 : 2;
  if (pos.length !== argc || !sessionActions.includes(action))
    throw new TypeError('Use pixel-art session init, status, begin, apply, preview, commit, cancel, undo, redo, inspect, sample, select, snap, brush, copy, timeline, targets, or export');

  const captureSelection = reference(opt.scene) && capture ? settings=>capture(opt.scene,settings) : undefined;
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
      editor.apply(read(input),{ shotHitFrame,captureSelection });
      result = editor.receipts().at(-1);
    } else if (action === 'preview') {
      const limit = opt.limit === undefined ? undefined : typeof opt.limit === 'string' ? Number(opt.limit) : NaN;
      result = editor.previewChanges({ limit,view,diagnostics:splatDiagnosticOptions(opt),time:opt.t===undefined ? undefined : typeof opt.t==='string' ? Number(opt.t) : NaN });
      if (!result.valid) process.exitCode = 2;
    } else if (action === 'inspect') {
      result = editor.inspect(inspectCoordinate(opt.at),{ frame:opt.frame,cel:opt.cel,
        binding:opt.binding,destinations:destinationList(opt.destination),references:opt.references === true,captureSelection });
    } else if (action === 'sample') {
      const { coordinate,options } = sampleOptions(opt);
      result = editor.sample(coordinate,options);
    } else if (action === 'select') {
      const { frame,layer,cel } = opt;
      result = editor.select(read(input),{ frame,layer,cel,captureSelection });
    } else if (action === 'copy') {
      const { selection,frame,layer,cel } = opt;
      result = editor.copySelection({ selection,frame,layer,cel });
    } else if (action === 'brush') {
      result = writeBrush(editor.snapshot(),opt,path.resolve(directory));
    } else if (action === 'snap') {
      const { point,radius } = snapOptions(opt);
      result = editor.snap(point,{ frame:opt.frame, radius });
    } else if (action === 'timeline') {
      result = editor.timeline();
    } else if (action === 'targets') {
      if (!reference(opt.destination)) throw new TypeError('--destination needs a destination ID');
      const limit = opt.limit === undefined ? undefined : typeof opt.limit === 'string' ? Number(opt.limit) : NaN;
      const query=targetQuery(opt), sourceView=opt['source-view'];
      if (sourceView!==undefined && (!reference(sourceView) || query===undefined))
        throw new TypeError('Use --source-view with a splat query JSON file');
      const captureTargets = sourceView ? ()=>ViewSource.unpack(read(sourceView)) :
        capture && (settings=>capture(settings.scene,settings));
      result = editor.targets(opt.destination,{limit,query,frame:opt.frame,captureSelection:captureTargets});
    } else if (action === 'export') {
      if (!reference(opt.out)) throw new TypeError('--out needs a file path');
      const out = path.resolve(opt.out), artifact = opt.artifact ?? 'document';
      if (path.dirname(out) === path.resolve(directory) && /^checkpoint-\d+\.json$/.test(path.basename(out)))
        throw new RangeError('Choose an output outside the session checkpoints');
      let data;
      if (artifact === 'document') data = editor.snapshot();
      else if (artifact === 'scene') data = editor.sceneEditor?.snapshot();
      else if (['shot-corrections','splat-fit','scan-paint'].includes(artifact))
        data = editor.renderOptions(opt.scene)[{'shot-corrections':'shotCorrections','splat-fit':'splatFit','scan-paint':'scanPaint'}[artifact]];
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

module.exports = { createEditor, documentFromPNG, documentFromDeck, openEditorSession, compile, validate, stamp, image, review, edit, draw, trace, artRulesReport,
  command, sessionCommand, splatDiagnosticOptions, actions, sessionActions, paletteActions, stackActions };
