'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const { viewSettings, worldFor, render } = require('./mesh-native-view.js');

const format = 'ink-studio/mesh-modifier-stack';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const name = value => typeof value === 'string' && value.trim();
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const allowed = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));

function preview(toolkit, source, plan, object, editor, viewPath, previewPath) {
  const raw = viewPath ? read(viewPath) : {};
  if (!allowed(raw, ['w', 'h', 't', 'camera', 'raw', 'materials']))
    throw new TypeError('Use mesh preview size, time, camera and optional standalone materials');
  const view = viewSettings({ raw: !editor, ...raw }, !editor);
  let world;
  if (editor) {
    world = editor.build();
    const authored = editor.meshTopology(object), previous = world.topologyMeshes[object];
    const row = { ...authored, document: plan.document, modifiers: [], bindings: [] };
    const [[, stage]] = toolkit.KIT.authoring.meshTopologyScene.prepare({ [object]: row });
    world.meshes = world.meshes.map(mesh => mesh === previous.mesh ? stage.mesh : mesh);
    world.topologyMeshes = { ...world.topologyMeshes, [object]: stage };
  } else world = worldFor(plan.document, view, toolkit, source);
  const frame = render(world, view, toolkit, []);
  files.write(previewPath, PNG.encode(frame.w, frame.h, frame.rgb));
  return { file: previewPath, grid: [frame.w, frame.h] };
}

function standalone(toolkit, source, verb, input, { through, targets }) {
  const { KIT: { meshTopology: api } } = toolkit;
  const portable = source?.format === format;
  if (portable && (!allowed(source, ['format', 'version', 'document', 'modifiers']) || source.version !== 1))
    throw new TypeError('Use a version 1 retained mesh modifier stack');
  const cage = api.create(portable ? source.document : source);
  let modifiers = portable ? api.modifierStack(source.modifiers) : [];
  if (verb === 'update') {
    if (!allowed(input, ['id', 'patch'])) throw new TypeError('Update a modifier with its id and patch');
    modifiers = api.updateModifier(modifiers, input.id, input.patch);
  } else if (input !== undefined) modifiers = api.modifierStack(input);
  const references = targets ? read(targets) : {};
  if (!record(references)) throw new TypeError('Use a map of projection target IDs to mesh documents');
  const plan = api.evaluateModifiers(cage, modifiers, { through,
    target: id => Object.hasOwn(references, id) ? references[id] : undefined });
  const saved = (document, modifiers) => ({ format, version: 1, document, modifiers });
  const output = verb === 'inspect' ? plan.document : verb === 'apply' ?
    (plan.remaining.length ? saved(plan.document, plan.remaining) : plan.document) : saved(cage, modifiers);
  return { cage, plan, output, report: plan.report };
}

function inScene(editor, verb, input, object, through) {
  const cage = editor.meshTopology(object).document;
  if (verb === 'set') editor.setMeshModifiers(object, input);
  if (verb === 'update') {
    if (!allowed(input, ['id', 'patch'])) throw new TypeError('Update a modifier with its id and patch');
    editor.updateMeshModifier(object, input.id, input.patch);
  }
  const plan = editor.inspectMeshModifiers(object, { through });
  if (verb !== 'apply' || !plan.report.canApply)
    return { cage, plan, output: verb === 'inspect' ? plan.document : editor.snapshot(), report: plan.report };
  const apply = editor.planApplyMeshModifiers(object, { through });
  const scene = editor.snapshot();
  const output = { ...scene, topologyMeshes: { ...scene.topologyMeshes, [object]: apply.row } };
  const { topology, report } = apply;
  return { cage, plan, output, report: { ...report, topology } };
}

function command([verb, file, input, ...rest], flags, toolkit, openEditor) {
  const { object, through, out, report, view, preview: directory, targets } = flags;
  const set = verb === 'set' || verb === 'update';
  if (!['inspect', 'set', 'update', 'apply'].includes(verb) || !file || rest.length || set && !input ||
      object && (targets || input && !set) || set && through || view && !directory ||
      [file, input, object, through, out, report, view, directory, targets].some(value => value !== undefined && !name(value)) ||
      Object.keys(flags).some(key => !['object', 'through', 'out', 'report', 'view', 'preview', 'targets'].includes(key)))
    throw new TypeError('Use mesh-topology modifiers inspect|set|update|apply <mesh-or-scene.json> [stack-or-edit.json] [--object id] [--through id] [--preview dir] [--out file] [--report file]');
  const previewPath = directory && path.resolve(directory, 'stage.png');
  const inputs = [file, input, view, targets].filter(Boolean).map(p => path.resolve(p));
  const outputs = [out, report, previewPath].filter(Boolean).map(p => path.resolve(p));
  if (new Set(outputs).size !== outputs.length || outputs.some(p => inputs.includes(p)))
    throw new RangeError('Write modifier outputs separately from their inputs');
  if (object && out && verb !== 'inspect' && path.dirname(path.resolve(file)) !== path.dirname(path.resolve(out)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const source = read(file);
  if (source?.topologyMeshes && !object) throw new TypeError('Choose an editable scene mesh with --object');
  const editor = object && openEditor(file), request = input && read(input);
  const result = editor ? inScene(editor, verb, request, object, through) : standalone(toolkit, source, verb, request, { through, targets });
  if (previewPath) result.report = { ...result.report, native: preview(toolkit, result.cage, result.plan, object, editor, view, previewPath) };
  if (report) files.json(path.resolve(report), result.report);
  if (!out) process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
  else {
    if (!result.report.canApply) throw new RangeError('Resolve the blocked mesh modifier before writing an output');
    let output = result.output;
    if (editor && verb === 'apply') {
      editor.applyMeshModifiers(object, { through });
      output = editor.snapshot();
    }
    files.json(path.resolve(out), output);
  }
}

module.exports = { command };
