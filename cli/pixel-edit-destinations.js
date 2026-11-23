'use strict';

const ShotCorrections = require('../src/shot-corrections.js');
const Targets = require('../src/target-selectors.js');
const SplatFit = require('./splat-fit-asset.js');
const { signature } = require('./render-row-assets.js');

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

function resolve(design, edit) {
  const name = edit.destination === undefined ? 'raster' : edit.destination;
  const destination = (design.version === 2 && design.destinations?.find(target => target.id === name)) ||
    (name === 'raster' && { id:'raster', kind:'raster' });
  if (!destination) throw new RangeError('Unknown pixel edit destination ' + name);
  const binding = destination.binding && design.sceneBindings.find(item => item.id === destination.binding);
  if (binding?.frame !== undefined && binding.frame !== edit.frame)
    throw new RangeError('Pixel edit destination ' + name + ' is bound to frame ' + binding.frame);
  return { destination, binding };
}

function checkRevision(binding, revision) {
  if (binding.revision !== undefined && binding.revision !== revision)
    throw new RangeError('Pixel edit scene binding is stale: ' + binding.id);
}

function sceneTarget(binding) {
  return Targets.prepare({ object:binding.object, ...(binding.part !== undefined && { part:binding.part }) });
}

function splatRows(world, binding) {
  const target = sceneTarget(binding), { row } = Targets.index(world);
  let names;
  return function resolveSplat(source) {
    let index = source;
    if (typeof source === 'string') {
      if (!names) {
        names = new Map();
        for (const [i,key] of (world.splatIds ?? []).entries()) names.set(key,names.has(key) ? -1 : i);
      }
      index = names.get(source);
    }
    if (!Number.isSafeInteger(index) || index < 0 || index >= world.count ||
        !Targets.matches(target,row(index)))
      throw new RangeError('Splat ' + source + ' is missing, ambiguous, or outside binding ' + binding.id);
    return index;
  };
}

function shot(frame, edit, binding, world, marks) {
  const operation = edit.operation;
  if (!fields(operation,['at','fps','startTime','frames','anchor','depthTolerance']) ||
      !Array.isArray(operation.at) || operation.at.length !== 2 ||
      !Number.isSafeInteger(operation.at[0]) || operation.at[0] < 0 || operation.at[0] >= frame.width ||
      !Number.isSafeInteger(operation.at[1]) || operation.at[1] < 0 || operation.at[1] >= frame.height ||
      !fields(operation.anchor,['splat','offset','depthOffset']))
    throw new TypeError('A shot correction needs an art-grid anchor pixel and explicit splat anchor');
  if (marks.some(mark => mark.swatch === null)) throw new TypeError('Shot correction pixels need an RGB swatch');
  const { at:[x,y], fps, startTime, frames, anchor, depthTolerance } = operation;
  const colors = new Map(frame.swatches.map((swatch,i) => [swatch,'#'+frame.colors[i].toString(16).padStart(6,'0')]));
  const pixels = marks.map(mark => [mark.at[0]-x,mark.at[1]-y,colors.get(mark.swatch)]);
  checkRevision(binding,signature(world));
  splatRows(world,binding)(anchor.splat);
  const base = world.look?.shotCorrections;
  const size = [frame.width,frame.height];
  const prior = ShotCorrections.prepare(base);
  const clock = ShotCorrections.prepare({ size, fps, startTime:startTime ?? prior?.startTime });
  if (prior && (prior.size[0] !== size[0] || prior.size[1] !== size[1] ||
      prior.fps !== clock.fps || prior.startTime !== clock.startTime))
    throw new RangeError('Shot correction grid and clock must match the existing shot');
  return ShotCorrections.paint(prior ?? clock,{
    id:edit.id, frames, anchor:{ ...anchor, target:sceneTarget(binding) }, pixels, depthTolerance
  });
}

function splats(edit, binding, world) {
  const operation = edit.operation;
  if (!fields(operation,['splats']) || !Array.isArray(operation.splats) || !operation.splats.length)
    throw new TypeError('A splat attribute edit needs a list of explicit source splats');
  const bake = signature(world);
  checkRevision(binding,bake);
  const row = splatRows(world,binding);
  const edits = operation.splats.map(change => {
    if (!fields(change,['splat','footprintScale','visible']) ||
        (change.footprintScale === undefined) === (change.visible === undefined) ||
        (change.visible !== undefined && typeof change.visible !== 'boolean') ||
        (change.footprintScale !== undefined && (!Number.isFinite(change.footprintScale) ||
          change.footprintScale < .4 || change.footprintScale > 2)))
      throw new TypeError('A splat attribute edit needs either footprintScale (0.4–2) or visible (boolean)');
    return [row(change.splat),change.footprintScale ?? Number(change.visible)];
  });
  const asset = { format:SplatFit.format, version:1, rows:world.count, signature:bake, edits };
  SplatFit.prepare(world,asset);
  const prior = world.look?.splatFit;
  return SplatFit.prepare(world,prior)
    ? { ...asset, edits:[...new Map([...prior.edits,...edits])] }
    : asset;
}

function solidEdit(edit, destination, binding, editor, revision) {
  checkRevision(binding,revision);
  const key = 'solid:' + binding.object;
  const solid = editor.node(key)?.solid;
  if (!solid || binding.part !== undefined && solid.part !== binding.part)
    throw new RangeError('Scene binding does not resolve to an authored solid: ' + binding.id);
  const operation = edit.operation;
  if (destination.kind === 'surface-channel') {
    const state = solid.surfaceState, { chart, channel } = destination;
    const target = state?.charts && Object.hasOwn(state.charts,chart) && state.charts[chart];
    if (!target) throw new RangeError('Unknown rest chart ' + chart + ' on ' + binding.object);
    if (!fields(operation,['stamp']) || !fields(operation.stamp,['brush','value','mode','strength','window']))
      throw new TypeError('A surface channel edit needs a native UV stamp');
    editor.setSurfaceState({ ...state, charts:{ ...state.charts,
      [chart]:{ ...target, stamps:[...(target.stamps ?? []),{ ...operation.stamp, channel }] }
    } },key);
  } else if (destination.kind === 'sdf-shape') {
    if (!fields(operation,['parameters','modifier']) ||
        (operation.parameters === undefined) === (operation.modifier === undefined))
      throw new TypeError('An SDF shape edit needs shape parameters or a single modifier');
    if (operation.modifier !== undefined) {
      const modifiers = solid.modifiers ?? [];
      if (!record(operation.modifier) || Object.hasOwn(operation.modifier,'id') ||
          modifiers.some(modifier => modifier.id === edit.id))
        throw new TypeError('An SDF modifier uses the edit ID, which must be new on the solid');
      editor.setModifiers([...modifiers,{ ...operation.modifier, id:edit.id }],key);
    } else editor.updateShape(operation.parameters,key);
  } else {
    if (!fields(operation,['material']) || (typeof operation.material !== 'string' && !record(operation.material)))
      throw new TypeError('An SDF material edit needs a palette role or a native material object');
    editor.setMaterial(operation.material,key);
  }
  return editor.snapshot();
}

function apply(frame, edit, { destination, binding }, context, readMarks) {
  if (destination.kind === 'shot-correction') {
    const marks = readMarks(frame,edit);
    return shot(frame,edit,binding,context.world(binding),marks);
  }
  if (edit.edits !== undefined)
    throw new TypeError('Destination ' + destination.kind + ' needs explicit source coordinates or IDs in operation');
  if (destination.kind === 'splat-attributes') return splats(edit,binding,context.world(binding));
  const { editor, revision } = context.scene(binding);
  return solidEdit(edit,destination,binding,editor,revision);
}

module.exports = { validate, resolve, apply };
