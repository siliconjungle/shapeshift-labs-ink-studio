'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual:equal } = require('node:util');
const { image } = require('../src/pixel-stamps.js');
const Presets = require('../src/pixel-export-preset.js');
const Playback = require('../src/pixel-playback-ranges.js');
const Slices = require('../src/pixel-slices.js');
const { readSpriteAtlas,spriteAtlasManifest } = require('./sprite-atlas.js');
const { registration } = require('./pixel-directional-views.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');

const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
const json = value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const named = (rows,id)=>rows.find(row=>row.id === id);
const rect = ([x,y,width,height])=>({ x,y,width,height });
const raster = (width,height,data)=>({ width,height,channels:4,data });

function selection(design,preset) {
  if (preset.tag) {
    const tag = named(Playback.resolve(design.frames,design.tags),preset.tag);
    if (!tag) throw new RangeError('Unknown export playback tag '+preset.tag);
    const timing = Playback.plan(design.frames.map(row=>row.durationMs),tag);
    return { frames:timing.order.map(i=>design.frames[i]),playback:{
      id:tag.id,direction:tag.direction,loop:tag.loop,...(tag.repeat !== undefined && { repeat:tag.repeat })
    } };
  }
  const frames = preset.frames?.map(id=>{
    const frame = named(design.frames,id);
    if (!frame) throw new RangeError('Unknown export frame '+id);
    return frame;
  }) ?? design.frames;
  return { frames };
}

function registeredMaps(source,directory,design,protect) {
  if (!source) return { read:()=>({ maps:{} }) };
  const ids = new Set(design.frames.map(frame=>frame.id)), { width,height } = design;
  for (const id of Object.keys(source.frames ?? source.bindings ?? {}))
    if (!ids.has(id)) throw new RangeError('Unknown frame in registered map bindings '+id);
  function input(file) {
    const resolved = path.resolve(directory,file);
    protect(resolved);
    return resolved;
  }
  if (!source.atlas) {
    const { depthRange,depthOrigin,normalSpace,emissionMode } = source;
    return { depthRange,normalSpace,emissionMode,read(id) {
      const names = Object.hasOwn(source.frames,id) ? source.frames[id] : {};
      const maps = Object.fromEntries(Object.entries(names).map(([name,file])=>{
        const parsed = PNG.raster(input(file));
        if (parsed.w !== width || parsed.h !== height || parsed.max !== 255)
          throw new RangeError('Registered '+name+' PNG for '+id+' needs the native canvas size and 8-bit channels');
        return [name,Uint8Array.from(parsed.data)];
      }));
      return { maps,depthOrigin };
    } };
  }

  const manifest = input(source.atlas), { metadata,images } = readSpriteAtlas(manifest).snapshot();
  if (metadata.cels || metadata.scenery || metadata.bump)
    throw new RangeError('Registered auxiliary atlas needs baked view tiles');
  const channels = source.channels ?? Presets.channels.filter(name=>images[name]);
  if (!channels.length || channels.some(name=>!images[name]))
    throw new RangeError('Registered atlas is missing an auxiliary map requested by the preset');
  const depthRange = metadata.encodings?.depth?.range ?? metadata.depthRange;
  const normalSpace = metadata.normalSpace ?? (typeof metadata.encodings?.normal === 'string' ? 'asset' : 'view');
  const emissionMode = metadata.emissionMode ?? (typeof metadata.encodings?.emission === 'string' ? 'baked' : 'add');
  const legacyOrigin = typeof metadata.encodings?.depth?.encoding === 'string' && depthRange ?
    .5*depthRange[0]+.5*depthRange[1] : 0;
  return { depthRange,normalSpace,emissionMode,viewBlend:metadata.viewBlend,read(id,view) {
    const binding = Object.hasOwn(source.bindings ?? {},id) ? source.bindings[id] : undefined;
    const match = entry=>equal(registration(entry,metadata),{
      pose:view.pose,yaw:view.yaw,pitch:view.pitch,pivot:view.pivot,unitsPerPixel:view.unitsPerPixel
    });
    const candidates = binding !== undefined ? [metadata.frames[binding]].filter(Boolean) :
      metadata.frames.filter(view ? match : entry=>entry.id === id);
    const entry = candidates[0];
    if (candidates.length !== 1 || entry.rect.width !== width || entry.rect.height !== height || view && !match(entry))
      throw new RangeError('Registered atlas needs one native view matching the frame registration for '+id);
    const { x,y,width:w,height:h } = entry.rect;
    const maps = Object.fromEntries(channels.map(name=>{
      const { rgba } = Slices.crop({width:metadata.width,rgba:images[name]},[x,y,w,h]);
      if (name === 'depth' && metadata.depthFormat === 'gray')
        for (let p=0;p<rgba.length;p+=4) rgba[p+1] = rgba[p+2] = rgba[p];
      return [name,rgba];
    }));
    return { maps,depthOrigin:entry.depthOrigin ?? metadata.depthOrigin ?? legacyOrigin,
      source:registration(entry,metadata),handoff:entry.handoff };
  } };
}

function cropPaint(paint,[x,y,w,h]) {
  if (x === 0 && y === 0 && w === paint.width && h === paint.height) return paint;
  const { width,slots,alpha,knockouts,...settings } = paint;
  const indices = Array.from({length:w*h},(_,i)=>(y+Math.floor(i/w))*width+x+i%w);
  const erased = new Set(knockouts);
  return { ...settings,width:w,height:h,slots:indices.map(i=>slots[i]),
    ...(alpha && { alpha:indices.map(i=>alpha[i]) }),
    ...(erased.size && { knockouts:indices.flatMap((p,i)=>erased.has(p) ? [i] : []) }) };
}

function framePlate(design,frame,compiled,preset,frameIds,aux,stamp) {
  const width = design.width, height = design.height, id = frame.id;
  const slices = Slices.active(design.slices,frameIds,frameIds.indexOf(id));
  const slice = preset.slice && named(slices,preset.slice);
  if (preset.slice && !slice) throw new RangeError('Export slice '+preset.slice+' has no key visible on frame '+id);
  const view = design.directional?.views.find(row=>row.frame === id), registered = aux.read(id,view);
  const guide = typeof preset.pivot === 'string' && named(compiled.guides ?? [],preset.pivot);
  if (typeof preset.pivot === 'string' && (!guide || !['pivot','registration'].includes(guide.kind)))
    throw new RangeError('Unknown export pivot or registration guide '+preset.pivot+' on frame '+id);
  const bounds = slice?.bounds ?? [0,0,width,height], [x,y,w,h] = bounds;
  const point = Array.isArray(preset.pivot) ? preset.pivot : guide?.at ?? slice?.registration;
  const center = point ? point.map(n=>n+.5) : view?.pivot ?? registered.source?.pivot ?? [x+w/2,y+h/2];
  const pivot = [center[0]-x,center[1]-y], unitsPerPixel = preset.unitsPerPixel ?? view?.unitsPerPixel ?? registered.source?.unitsPerPixel ?? 1;
  const paint = cropPaint(stamp(compiled),bounds);
  const maps = Object.fromEntries(Object.entries(registered.maps).map(([name,rgba])=>[
    name,raster(w,h,Slices.crop({width,rgba},bounds).rgba)
  ]));
  return { id,view,registration:registered.source,depthOrigin:registered.depthOrigin,handoff:view?.handoff ?? registered.handoff,
    paint,maps,pivot,unitsPerPixel,sourceBounds:bounds,
    ...(slice && { slice:{ id:slice.id,keyFrame:slice.keyFrame,...(slice.nineSlice && { nineSlice:slice.nineSlice,stretch:slice.stretch }) } }),
    ...(slices.length && { slices }) };
}

function atlasFor(sequence,plates,preset,design,aux,pack,add) {
  const directional = plates.some(row=>row.view);
  if (directional && (plates.some(row=>!row.view) || plates.length !== sequence.length))
    throw new RangeError('Directional atlas presets need each selected view once, with a registered angle on every frame');
  const approved = directional && new Set((design.directional.approvedSwatches ?? Object.keys(design.palette)).map(id=>{
    const swatch = design.palette[id];
    return parseInt((typeof swatch === 'string' ? swatch : swatch.color).slice(1),16);
  }));
  const { atlas } = pack(plates.map(({id,paint,maps,pivot,unitsPerPixel})=>{
    const { width,height,rgba } = image(paint,{ preserveHidden:true });
    if (approved) for (let p=0;p<rgba.length;p+=4) {
      const color = (rgba[p]<<16)|(rgba[p+1]<<8)|rgba[p+2];
      if (rgba[p+3] && !approved.has(color)) throw new RangeError('Directional view '+id+' contains unapproved colors');
    }
    return { id,source:raster(width,height,rgba),maps,pivot,unitsPerPixel };
  }),{ ...preset.atlas,depthRange:aux.depthRange,normalSpace:aux.normalSpace,emissionMode:aux.emissionMode });
  const packed = new Map(atlas.metadata.frames.map(row=>[row.id,row])), poses = new Map(), byId = new Map(plates.map(row=>[row.id,row]));
  const viewBlend = directional ? design.directional.viewBlend ?? aux.viewBlend ?? 'nearest' : 'nearest';
  if (viewBlend === 'depth-reprojected' && plates.some(plate=>!plate.maps.depth))
    throw new RangeError('Depth-reprojected exports need registered depth on every selected view');
  atlas.metadata.viewBlend = viewBlend;
  if (directional) atlas.metadata.partAnchors = design.directional.partAnchors ?? [];
  if (approved && approved.size <= 64) atlas.metadata.outputPalette = [...approved];
  atlas.metadata.frames = sequence.map((row,index)=>{
    const { view,registration,depthOrigin,handoff:authoredHandoff,paint,maps,sourceBounds,slice,slices } = byId.get(row.frame);
    const frame = { ...packed.get(row.frame),frame:index,sourceFrame:row.frame,duration:row.durationMs/1000,
      sourceBounds,...(slice && { slice }),...(slices && { slices }),...(depthOrigin !== undefined && { depthOrigin }) };
    if (!view) return registration ? { ...frame,yaw:registration.yaw,pitch:registration.pitch } : frame;
    if (!poses.has(view.pose)) poses.set(view.pose,{ index:poses.size,duration:frame.duration });
    const pose = poses.get(view.pose);
    if (pose.duration !== frame.duration) throw new RangeError('Directional views of pose '+view.pose+' need equal durations');
    const [x,y] = sourceBounds, shift = [x+frame.trim.x,y+frame.trim.y];
    const anchors = view.anchors && Object.fromEntries(Object.entries(view.anchors).map(([id,at])=>[id,at.map((n,i)=>n-shift[i])]));
    const missingDepth = viewBlend === 'depth-reprojected' && paint.slots.some((slot,p)=>
      slot !== null && (paint.alpha?.[p] ?? 255) > 0 && !maps.depth.data[p*4+3]);
    const handoff = missingDepth ? 'exact' : authoredHandoff;
    return { ...frame,frame:pose.index,sourcePose:view.pose,yaw:view.yaw,pitch:view.pitch,
      ...(anchors && { anchors }),...(handoff && { handoff }) };
  });
  const manifest = spriteAtlasManifest(atlas,(w,h,rgba)=>{
    const bytes = PNG.encode(w,h,rgba,4), file = 'images/'+sha(bytes)+'.png';
    add('atlas/'+file,bytes);
    return file;
  });
  add('atlas/atlas.json',json(manifest));
  return 'atlas/atlas.json';
}

function exportPreset(design,source,{ out,directory = process.cwd(),inputs = [] } = {},dependencies) {
  const preset = Presets.prepare(source), { stamp,frameCompiler,layerDeck,pack,revision } = dependencies;
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('Choose an export directory');
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Choose a base directory for registered map paths');
  const root = path.resolve(out), destination = path.join(root,'export.json'), protectedPaths = new Set(inputs.map(file=>path.resolve(file)));
  const protect = file=>protectedPaths.add(file);
  const outputs = {}, assets = new Map(), selected = new Set(preset.outputs);
  const add = (file,bytes)=>{ assets.set(file,bytes); return file; };
  if (selected.has('document')) outputs.document = { file:add('document.json',json(design)) };
  if (selected.has('layer-deck')) outputs['layer-deck'] = { file:add('layers.json',json(layerDeck(design))) };
  const { frames,playback } = selection(design,preset);
  const rendered = [...selected].some(kind=>['png','frames','atlas'].includes(kind));
  let sequence = [], encoding;
  if (rendered) {
    const needed = selected.has('frames') || selected.has('atlas') ? frames : frames.slice(0,1);
    if (needed.length > 1024) throw new RangeError('Export presets support up to 1024 frame exposures');
    const aux = registeredMaps(preset.auxiliary,directory,design,protect), compile = frameCompiler(design);
    const byId = new Map(), frameIds = design.frames.map(frame=>frame.id);
    let pixels = 0, time = 0;
    sequence = needed.map((frame,index)=>{
      if (!byId.has(frame.id)) {
        const plate = framePlate(design,frame,compile(frame.id),preset,frameIds,aux,stamp);
        pixels += plate.paint.width*plate.paint.height*(1+Object.keys(plate.maps).length);
        if (pixels > 16e6) throw new RangeError('Export frames exceed the native source pixel budget');
        byId.set(frame.id,plate);
      }
      const { paint,maps,pivot,unitsPerPixel,sourceBounds,slice,slices,depthOrigin } = byId.get(frame.id);
      const row = { frame:frame.id,order:index,startMs:time,durationMs:frame.durationMs,sourceBounds,pivot,unitsPerPixel,
        ...(slice && { slice }),...(slices && { slices }),...(depthOrigin !== undefined && { depthOrigin }) };
      time += frame.durationMs;
      if (!Number.isSafeInteger(time)) throw new RangeError('Export timing exceeds the safe millisecond range');
      function save(stem) {
        const file = add(stem+'.png',PNG.encodePaint(paint,preset.colorMode));
        const auxiliary = Object.fromEntries(Object.entries(maps).map(([name,raster])=>[name,
          add(stem+'-'+name+'.png',PNG.encode(raster.width,raster.height,raster.data,4))]));
        return { file,...(Object.keys(auxiliary).length && { maps:auxiliary }) };
      }
      if (selected.has('png') && index === 0) outputs.png = save('art');
      return selected.has('frames') ? { ...row,...save('frames/'+String(index+1).padStart(4,'0')+'-'+frame.id) } : row;
    });
    if (preset.auxiliary) encoding = { depthRange:aux.depthRange,normalSpace:aux.normalSpace ?? 'view',emissionMode:aux.emissionMode ?? 'add' };
    if (selected.has('frames')) outputs.frames = { file:add('frames.json',json({ format:'ink-studio/pixel-export-frames',version:1,
      pixelAspect:design.pixelAspect,frames:sequence,playback,encoding })) };
    if (selected.has('atlas')) outputs.atlas = { file:atlasFor(sequence,[...byId.values()],preset,design,aux,pack,add) };
  }
  const ordered = [...assets].sort(([a],[b])=>a.localeCompare(b));
  const content = 'assets/'+sha(json(ordered.map(([file,bytes])=>[file,sha(bytes)])));
  const report = { format:'ink-studio/pixel-export',version:1,preset,revision,content,outputs,frames:sequence,
    ...(playback && { playback }),...(encoding && { encoding }),pixelAspect:design.pixelAspect };
  if (protectedPaths.has(destination) || ordered.some(([file])=>protectedPaths.has(path.join(root,content,file))))
    throw new RangeError('Export outputs must be separate from inputs');
  // Publish the manifest last. Older manifests still point to their original content.
  for (const [file,bytes] of ordered) files.write(path.join(root,content,file),bytes);
  files.json(destination,report);
  return { file:destination,...report };
}

module.exports = { exportPreset };
