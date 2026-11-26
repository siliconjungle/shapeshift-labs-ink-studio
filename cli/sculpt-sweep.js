'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const name = value => typeof value === 'string' && value.trim() === value && value.length > 0;
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => keys.includes(key));
const controls = ['brush', 'poses', 'blendRadius', 'step', 'path', 'pressureResponse'];

function host(editor, target) {
  const node = editor.node('solid:' + target);
  if (!node || node.operand || ['ground', 'mesh'].includes(node.solid.kind) ||
      node.solid.carve || node.solid.ghost || node.solid.hold)
    throw new RangeError('Choose a named finite exterior sculpt solid as the sweep target');
  return node;
}

function sweepNode(editor, id, target) {
  const node = target ? host(editor, target).children.find(child => child.modifier === id) :
    editor.node('solid:' + id);
  if (node?.solid.kind !== 'sweep' || !target && node.operand)
    throw new RangeError('Unknown retained sweep: ' + id);
  return node;
}

module.exports = function sculptSweep([verb, scene, file, ...rest], flags, kit, openEditor) {
  const { target, id, out } = flags, inspect = verb === 'inspect';
  if (rest.length || !['add', 'cut', 'update', 'inspect'].includes(verb) || !name(scene) ||
      (inspect ? file !== undefined || !name(id) || out !== undefined : !name(file) || !name(out) || id !== undefined) ||
      target !== undefined && !name(target) || verb === 'cut' && !target ||
      Object.keys(flags).some(key => !['target', 'id', 'out'].includes(key)))
    throw new TypeError('Use sculpt-sweep add|cut|update <scene.json> <request.json> [--target solid] --out scene.json, or sculpt-sweep inspect <scene.json> --id sweep [--target solid]');
  const editor = openEditor(scene);
  const api = kit.KIT.procedural.shapeSweeps;
  if (inspect) {
    const { solid } = sweepNode(editor, id, target);
    const attachment = target && host(editor, target).solid.modifiers?.find(row => row.id === id)?.snap;
    const snap = attachment && editor.inspectSculptSnap(target, id);
    const { bounds, sampleCount, step } = api.prepare(snap?.resolvedPoses ? { ...solid, poses: snap.resolvedPoses, path: 'free' } : solid);
    console.log(JSON.stringify({ id, ...(target && { target }), sweep: solid, bounds, sampleCount, step,
      ...(snap && { snap }) }, null, 2));
    return;
  }

  const input = read(file);
  if (!fields(input, ['id', ...controls, ...(verb === 'update' ? [] : ['mat', 'res'])]) ||
      !kit.TargetSelectors.name(input.id))
    throw new TypeError('A sweep request needs a stable ID and brush controls');
  const destination = path.resolve(out);
  if ([scene, file].map(p => path.resolve(p)).includes(destination) ||
      path.dirname(destination) !== path.dirname(path.resolve(scene)))
    throw new RangeError('Write a new sweep scene beside its source to preserve relative assets');

  const { id: sweepId, ...changes } = input;
  let result = editor;
  if (verb === 'update') {
    if (!Object.keys(changes).length) throw new TypeError('Supply a sweep control to update');
    editor.updateShape(changes, sweepNode(editor, sweepId, target).key);
  } else if (target) {
    const { key, solid } = host(editor, target);
    const modifiers = solid.modifiers ?? [];
    if (modifiers.some(modifier => modifier.id === sweepId))
      throw new RangeError('Sweep modifier already exists: ' + sweepId);
    editor.setModifiers([...modifiers, {
      id: sweepId, kind: 'join', how: verb === 'cut' ? 'cut' : 'union', shape: { kind: 'sweep', ...changes }
    }], key);
  } else {
    const spec = editor.snapshot();
    if (editor.node('solid:' + sweepId)) throw new RangeError('Solid already exists: ' + sweepId);
    result = editor.fork({ ...spec, solids: [...spec.solids, { id: sweepId, kind: 'sweep', ...changes }] });
  }

  // Bake first so an oversized or invalid edit cannot publish a broken scene.
  result.build();
  files.json(destination, result.snapshot());
  console.log(destination);
};
