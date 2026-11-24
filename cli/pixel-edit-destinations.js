'use strict';

const ShotCorrections = require('../src/shot-corrections.js');
const Targets = require('../src/target-selectors.js');
const SplatFit = require('./splat-fit-asset.js');
const { observe } = require('./pixel-edit-revisions.js');
const Provenance = require('../src/splat-provenance.js');
const { conflict } = require('./pixel-edit-preview.js');
const CanvasTransforms = require('../src/pixel-canvas-transforms.js');
const LayerStack = require('../src/pixel-layer-stack.js');

const record = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const kindFields = new Map([
  ['raster', []],
  ['shot-correction', ['binding']],
  ['surface-channel', ['binding','chart','channel']],
  ['splat-attributes', ['binding']],
  ['sdf-shape', ['binding']],
  ['sdf-material', ['binding']]
]);

function validate(destinations, bindings) {
  if (destinations === undefined) return;
  if (!Array.isArray(destinations)) throw new TypeError('Pixel edit destinations must be an array');
  const ids = new Set();
  for (const destination of destinations) {
    const allowed = kindFields.get(destination?.kind);
    if (!allowed || !fields(destination,['id','kind',...allowed]) || !id(destination.id) ||
        ids.has(destination.id) || destination.id === 'raster' && destination.kind !== 'raster')
      throw new TypeError('Pixel edit destinations need a unique ID and fields for a supported kind');
    if (destination.kind !== 'raster' && !bindings.has(destination.binding))
      throw new RangeError('Unknown scene binding for pixel edit destination ' + destination.id);
    if (destination.kind === 'surface-channel' &&
        (!Targets.name(destination.chart) || !Targets.name(destination.channel)))
      throw new TypeError('A surface channel destination needs a chart and channel');
    ids.add(destination.id);
  }
}

function resolve(design, name = 'raster') {
  const scoped = design.version === 2 && typeof name === 'string' && name.startsWith('layer:');
  const layer = scoped && design.layers.find(row=>row.id === name.slice(6) && row.kind === 'surface');
  const destination = (design.version === 2 && design.destinations?.find(target => target.id === (layer ? layer.destination : name))) ||
    (name === 'raster' && { id:name,kind:name }) ||
    (['canvas','document:canvas'].includes(name) && { id:'canvas',kind:'canvas' }) ||
    (['palette','document:palette'].includes(name) && { id:'palette',kind:'palette' }) ||
    (['adjustments','document:adjustments'].includes(name) && { id:'adjustments',kind:'adjustments' }) ||
    (design.version === 2 && ['protection','document:protection'].includes(name) && { id:'protection',kind:'protection' }) ||
    (['layers','document:layers'].includes(name) && { id:'layers',kind:'layers' }) ||
    (design.version === 2 && ['guides','selections'].includes(name) && { id:name, kind:name });
  if (!destination) throw conflict('unknown-destination','Unknown pixel edit destination ' + name,{ destination:name });
  const binding = destination.binding && design.sceneBindings.find(item => item.id === destination.binding);
  const boundLayer = layer?.id ?? binding?.layer;
  return { destination,binding,...(boundLayer !== undefined && design.version === 2 && {
    layer:LayerStack.prepare(design.layers).rows.get(boundLayer)
  }) };
}

function checkRevision(binding, { revision,sourceRevision }, expected) {
  if (expected !== undefined && expected !== sourceRevision)
    throw conflict('stale-source','Inspected scene source or binding has changed: ' + binding.id,
      { binding:binding.id, expected, actual:sourceRevision });
  if (binding.revision !== undefined && binding.revision !== revision)
    throw conflict('stale-source','Pixel edit scene binding is stale: ' + binding.id,
      { binding:binding.id, expected:binding.revision, actual:revision });
}

function sceneTarget(binding) {
  return Targets.prepare({ object:binding.object, ...(binding.part !== undefined && { part:binding.part }) });
}

function splatRows(world, binding, onSplat) {
  const target = sceneTarget(binding), { row } = Targets.index(world);
  let ids;
  return function resolveSplat(source) {
    const index = typeof source === 'string' ? (ids ??= Provenance.identities(world,{ fresh:true })).rowOf(source) : source;
    const scope = Number.isSafeInteger(index) && index >= 0 && index < world.count && Targets.objectScope(target,row(index));
    if (!scope)
      throw conflict('unavailable-splat','Splat ' + source + ' is missing, ambiguous, or outside binding ' + binding.id,
        { binding:binding.id, splat:source });
    if (onSplat) {
      const id = (ids ??= Provenance.identities(world,{ fresh:true })).idAt(index);
      onSplat({ requested:source, row:index, id:id ?? null });
    }
    return { index, scope };
  };
}

function shot(frame, edit, binding, world, marks, onSplat) {
  const operation = edit.operation;
  if (!fields(operation,['at','fps','startTime','frames','anchor','depthTolerance']) ||
      !Array.isArray(operation.at) || operation.at.length !== 2 ||
      !Number.isSafeInteger(operation.at[0]) || operation.at[0] < 0 || operation.at[0] >= frame.width ||
      !Number.isSafeInteger(operation.at[1]) || operation.at[1] < 0 || operation.at[1] >= frame.height ||
      !fields(operation.anchor,['splat','offset','depthOffset']))
    throw new TypeError('A shot correction needs an art-grid anchor pixel and explicit splat anchor');
  if (marks.some(mark => mark.swatch === null)) throw new TypeError('Shot correction pixels need an RGB swatch');
  const { fps,startTime,frames,anchor,depthTolerance } = operation;
  const grid = [frame.width,frame.height], size = binding.canvas?.size ?? grid;
  function sourcePixel(at) {
    const mapped = CanvasTransforms.sourcePoint(grid,at,binding.canvas);
    if (!mapped) throw conflict('outside-bound-canvas','Shot pixel is outside the bound camera grid',{ binding:binding.id,at });
    return mapped.map(Math.floor);
  }
  const [x,y] = sourcePixel(operation.at), seen = new Set();
  const colors = new Map(frame.swatches.map((swatch,i) => [swatch,'#'+frame.colors[i].toString(16).padStart(6,'0')]));
  const pixels = marks.map(mark => {
    const [u,v] = sourcePixel(mark.at), key = v*size[0]+u;
    if (seen.has(key)) throw conflict('duplicate-bound-pixel','Shot pixels resolve to the same bound pixel',
      { binding:binding.id,at:mark.at,source:[u,v] });
    seen.add(key);
    return [u-x,v-y,colors.get(mark.swatch)];
  });
  const { scope } = splatRows(world,binding,onSplat)(anchor.splat);
  const base = world.look?.shotCorrections;
  const prior = ShotCorrections.prepare(base);
  const clock = ShotCorrections.prepare({ size, fps, startTime:startTime ?? prior?.startTime });
  if (prior && (prior.size[0] !== size[0] || prior.size[1] !== size[1] ||
      prior.fps !== clock.fps || prior.startTime !== clock.startTime))
    throw new RangeError('Shot correction grid and clock must match the existing shot');
  return ShotCorrections.paint(prior ?? clock,{
    id:edit.id, frames, anchor:{ ...anchor, target:scope }, pixels, depthTolerance
  });
}

function splats(edit, binding, world, bake, onSplat) {
  const operation = edit.operation;
  if (!fields(operation,['splats']) || !Array.isArray(operation.splats) || !operation.splats.length)
    throw new TypeError('A splat attribute edit needs a list of explicit source splats');
  const row = splatRows(world,binding,onSplat);
  const seen = new Set();
  const edits = operation.splats.map(change => {
    if (!fields(change,['splat','footprintScale','visible']) ||
        (change.footprintScale === undefined) === (change.visible === undefined) ||
        (change.visible !== undefined && typeof change.visible !== 'boolean') ||
        (change.footprintScale !== undefined && (!Number.isFinite(change.footprintScale) ||
          change.footprintScale < .4 || change.footprintScale > 2)))
      throw new TypeError('A splat attribute edit needs either footprintScale (0.4–2) or visible (boolean)');
    const { index } = row(change.splat);
    if (seen.has(index)) throw new RangeError('Duplicate splat edit ' + change.splat);
    seen.add(index);
    return [index,change.footprintScale ?? Number(change.visible)];
  });
  const prior = world.look?.splatFit;
  SplatFit.prepare(world,prior);
  const target = sceneTarget(binding);
  const sameScope = prior?.version === 2 && prior.target.object === target.object && prior.target.part === target.part;
  const stable = (!prior || sameScope) && operation.splats.every(change => typeof change.splat === 'string');
  const ids = (stable || prior?.version === 2) && Provenance.identities(world);
  const previous = prior?.edits?.map(([source,scale]) =>
    [prior.version === 2 ? ids.rowOf(source) : source,scale]) ?? [];
  const merged = [...new Map([...previous,...edits])];
  const attributes=prior?.attributes?.map(([source,change])=>{
    const index=prior.version===2 ? ids.rowOf(source) : source;
    return [stable ? ids.idAt(index) : index,change];
  });
  const asset = stable
    ? { format:SplatFit.format, version:2, scene:SplatFit.sceneId(world), target,
      edits:merged.map(([index,scale]) => [ids.idAt(index),scale]) }
    : { format:SplatFit.format, version:1, rows:world.count, signature:bake, edits:merged };
  if (attributes?.length) asset.attributes=attributes;
  SplatFit.prepare(world,asset);
  return asset;
}

function boundSolid(binding, editor) {
  const key = 'solid:' + binding.object;
  const solid = editor.node(key)?.solid;
  if (!solid || binding.part !== undefined && solid.part !== binding.part)
    throw conflict('missing-source-object','Scene binding does not resolve to an authored solid: ' + binding.id,
      { binding:binding.id, object:binding.object });
  return { key, solid };
}

function restChart(solid, chart) {
  const charts = solid.surfaceState?.charts;
  const target = charts && Object.hasOwn(charts,chart) && charts[chart];
  if (!target) throw conflict('missing-chart','Unknown rest chart ' + chart + ' on ' + solid.id,
    { object:solid.id, chart });
  return target;
}

function channelSource(route, context) {
  const { destination,binding,layer } = route;
  if (destination.kind !== 'surface-channel')
    throw new TypeError('Choose a surface-channel destination to sample its material source');
  const source = observe(route,context);
  checkRevision(binding,source);
  const { solid } = boundSolid(binding,source.editor);
  const { chart,channel } = destination;
  const surface = require('../index.js').load().KIT.procedural.surfaceState;
  const definitions = surface.channels();
  if (!Object.hasOwn(definitions,channel))
    throw new RangeError('Unknown source material channel ' + channel);
  const definition = definitions[channel];
  const sampler = surface.restSampler(restChart(solid,chart));
  return { destination:destination.id, binding:binding.id, frame:binding.frame,
    scene:binding.scene,object:solid.id, ...(binding.part !== undefined && { part:binding.part }),
    chart,channel,...(layer && { layer:layer.id }),...definition,sourceRevision:source.sourceRevision,...(binding.canvas && { canvas:binding.canvas }),
    sample:uv => sampler.sample(uv)[channel] };
}

function solidEdit(edit, destination, binding, editor) {
  const { key, solid } = boundSolid(binding,editor);
  const operation = edit.operation;
  if (destination.kind === 'surface-channel') {
    const state = solid.surfaceState, { chart, channel } = destination;
    const target = restChart(solid,chart);
    if (!fields(operation,['stamp']) || !fields(operation.stamp,['brush','value','mode','strength','window']))
      throw new TypeError('A surface channel edit needs a native UV stamp');
    editor.setSurfaceState({ ...state, charts:{ ...state.charts,
      [chart]:{ ...target, stamps:[...(target.stamps ?? []),{ ...operation.stamp, channel }] }
    } },key);
  } else if (destination.kind === 'sdf-shape') {
    if (!fields(operation,['parameters','modifier','updateModifier']) || Object.keys(operation).length !== 1)
      throw new TypeError('An SDF shape edit needs shape parameters, a new modifier, or an update by modifier ID');
    if (operation.modifier !== undefined) {
      const modifiers = solid.modifiers ?? [];
      if (!record(operation.modifier) || Object.hasOwn(operation.modifier,'id') ||
          modifiers.some(modifier => modifier.id === edit.id))
        throw new TypeError('An SDF modifier uses the edit ID, which must be new on the solid');
      editor.setModifiers([...modifiers,{ ...operation.modifier, id:edit.id }],key);
    } else if (operation.updateModifier !== undefined) {
      const update = operation.updateModifier;
      if (!fields(update,['id','patch'])) throw new TypeError('An SDF modifier update needs an ID and patch');
      editor.updateModifier(update.id,update.patch,key);
    } else editor.updateShape(operation.parameters,key);
  } else {
    if (!fields(operation,['material']) || (typeof operation.material !== 'string' && !record(operation.material)))
      throw new TypeError('An SDF material edit needs a palette role or a native material object');
    editor.setMaterial(operation.material,key);
  }
  return editor.snapshot();
}

function surfacePixel(frame,operation,binding,layer) {
  if (!fields(operation,['pixel','value','mode','strength','window']) || !Array.isArray(operation.pixel) ||
      operation.pixel.length !== 2 || !Array.from(operation.pixel).every((n,i)=>
        Number.isSafeInteger(n) && n >= 0 && n < [frame.width,frame.height][i]))
    throw new TypeError('A bound surface pixel needs a native [x,y] and a channel value');
  const { pixel,value,mode,strength,window } = operation;
  const p = pixel[1]*frame.width+pixel[0], source = frame.layerSources?.get(layer.id);
  if (frame.locks[p] || source?.clipping && !source.clipping[p])
    throw conflict(frame.locks[p] ? 'protected-pixel' : 'clipped-pixel','Surface layer cannot paint this pixel',
      { at:pixel,layer:layer.id });
  const { size = [frame.width,frame.height],offset = [0,0],scale = [1,1] } = binding.canvas ?? {};
  const point = end=>pixel.map((n,i)=>Math.max(0,Math.min(1,(offset[i]+(n+end)*scale[i])/size[i])));
  const [x0,y0] = point(0), [x1,y1] = point(1);
  if (x0 === x1 || y0 === y1) throw conflict('outside-bound-canvas','Pixel is outside the bound UV chart',{ at:pixel });
  return { stamp:{ brush:{ kind:'rect',min:[x0,1-y1],max:[x1,1-y0] },value,
    ...(mode !== undefined && { mode }),...(strength !== undefined && { strength }),...(window !== undefined && { window }) } };
}

function apply(frame, edit, route, context, readMarks) {
  const { destination,binding,layer } = route;
  if (layer?.effectiveLock || layer?.kind === 'reference' || layer?.kind === 'group')
    throw conflict('locked-layer','Layer '+layer.id+' does not accept source edits',{ layer:layer.id });
  if (binding.frame !== undefined && binding.frame !== edit.frame)
    throw conflict('wrong-frame','Pixel edit destination ' + destination.id + ' is bound to frame ' + binding.frame,
      { binding:binding.id, expected:binding.frame, actual:edit.frame });
  const isShot = destination.kind === 'shot-correction';
  if (!isShot && edit.edits !== undefined)
    throw new TypeError('Destination ' + destination.kind + ' needs explicit source coordinates or IDs in operation');
  const marks = isShot ? readMarks(frame,edit) : undefined;
  const source = observe(route,context,{ guard:edit.sourceRevision !== undefined || !!context.onSource });
  context.onSource?.(source.sourceRevision,source);
  checkRevision(binding,source,edit.sourceRevision);
  if (isShot) return shot(frame,edit,binding,source.world,marks,context.onSplat);
  if (destination.kind === 'splat-attributes') return splats(edit,binding,source.world,source.revision,context.onSplat);
  const change = destination.kind === 'surface-channel' && layer?.kind === 'surface' &&
    edit.operation?.pixel !== undefined ? { ...edit,operation:surfacePixel(frame,edit.operation,binding,layer) } : edit;
  return solidEdit(change,destination,binding,source.editor);
}

function targets(route, context, limit) {
  const { destination,binding } = route;
  if (!binding) throw new TypeError('Choose a scene destination. Pixel document IDs are listed by pixel-art validate.');
  const source = observe(route,context);
  checkRevision(binding,source);
  const { world,editor,revision,sourceRevision } = source;
  if (world) {
    const ids = Provenance.identities(world,{ fresh:true }), { row } = Targets.index(world), scope = sceneTarget(binding);
    const rest = world.rest ?? world.data, splats = [];
    let count = 0;
    for (let i = 0; i < world.count; i++) {
      const id = ids.idAt(i);
      if (!id || !Targets.objectScope(scope,row(i)) ||
          destination.kind === 'splat-attributes' && !SplatFit.eligible(world,i)) continue;
      count++;
      if (splats.length < limit) splats.push({ id, at:Array.from(rest.subarray(i*16,i*16+3)) });
    }
    return { destination:destination.id, binding, revision, sourceRevision, count, splats };
  }
  const { key, solid } = boundSolid(binding,editor);
  const { chart, channel } = destination;
  if (destination.kind === 'surface-channel') restChart(solid,chart);
  return { destination:destination.id, binding, revision, sourceRevision,
    solid:{ id:solid.id, key, label:solid.label, part:solid.part },
    ...(channel !== undefined && { surfaceChannel:{ object:solid.id, chart, channel } }),
    modifiers:(solid.modifiers ?? []).map(({id,kind,label}) => ({ id,kind,label }))
  };
}

module.exports = { validate, resolve, apply, targets, channelSource };
