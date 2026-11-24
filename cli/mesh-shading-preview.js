'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const { viewSettings, worldFor, render, cover, normalImage } = require('./mesh-native-view.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const name = arg => typeof arg === 'string' && arg.trim();

function preview(document, view, paths, toolkit, editor, object, levels) {
  const { KIT: { meshTopology } } = toolkit;
  const derived = meshTopology.subdivide(document, { levels });
  let world;
  if (editor) {
    const scene = editor.snapshot(), row = scene.topologyMeshes[object];
    const override = { ...row, document: derived, ...(levels && { bindings: [] }) };
    world = editor.fork({ ...scene, topologyMeshes: { ...scene.topologyMeshes, [object]: override } }).build();
  } else world = worldFor(derived, view, toolkit, document);
  const frame = render(world, view, toolkit, ['geometricNormal', 'shadingNormal']);
  const { geometricNormal: geometric, shadingNormal: shading } = frame.passes;
  let occupied = 0, changed = 0, maxDegrees = 0;
  for (let i = 0; i < frame.w * frame.h; i++) {
    if (!cover(frame, i)) continue;
    occupied++;
    const a = geometric.subarray(i * 3, i * 3 + 3), b = shading.subarray(i * 3, i * 3 + 3);
    const cosine = a.reduce((sum, n, k) => sum + n * b[k], 0) / (Math.hypot(...a) * Math.hypot(...b));
    if (!Number.isFinite(cosine)) continue;
    const degrees = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
    if (degrees > .01) changed++;
    maxDegrees = Math.max(maxDegrees, degrees);
  }
  files.write(paths.beauty, PNG.encode(frame.w, frame.h, frame.rgb));
  files.write(paths.geometric, normalImage(frame, 'geometricNormal'));
  files.write(paths.shading, normalImage(frame, 'shadingNormal'));
  if (levels) files.json(paths.derived, derived);
  return { grid: [frame.w, frame.h], occupied, changed, maxDegrees, levels, ...paths };
}

function command(file, input, rest, opt, toolkit, openEditor) {
  const { object, out, report, view, preview: directory, subdivision } = opt, { KIT: { meshTopology } } = toolkit;
  if (!file || rest.length || [file, input, object, out, report, view, directory].some(arg => arg !== undefined && !name(arg)) ||
      out && !input || !directory && (view !== undefined || subdivision !== undefined) ||
      subdivision !== undefined && !/^[0-3]$/.test(subdivision) ||
      ['selection', 'from', 'visibility', 'projection', 'lineage', 'match-ids', 'pieces'].some(key => opt[key] !== undefined))
    throw new TypeError('Use mesh-topology shading <mesh-or-scene.json> [request.json] [--object id] [--view file] [--preview dir] [--subdivision 0–3] [--out file] [--report file]');
  const levels = Number(subdivision ?? 0), inputs = [file, input, view].filter(Boolean).map(arg => path.resolve(arg));
  const paths = directory && { beauty: path.resolve(directory, 'beauty.png'), geometric: path.resolve(directory, 'geometric.png'),
    shading: path.resolve(directory, 'shading.png'), ...(levels && { derived: path.resolve(directory, 'derived.json') }) };
  const outputs = [...[out, report].filter(Boolean).map(arg => path.resolve(arg)), ...Object.values(paths || {})];
  if (new Set(outputs).size !== outputs.length || outputs.some(arg => inputs.includes(arg)))
    throw new RangeError('Write shading reports, captures and edited meshes separately from their inputs');
  if (object && out && path.dirname(path.resolve(out)) !== path.dirname(path.resolve(file)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const source = read(file);
  if (source?.topologyMeshes && !object) throw new TypeError('Choose an editable scene mesh with --object');
  const editor = object && openEditor(file), cage = meshTopology.create(editor ? editor.meshTopology(object).document : source);
  const request = input && read(input);
  const plan = input && (editor ? editor.planMeshShading(object, request) : meshTopology.planShading(cage, request));
  const document = plan ? plan.document : cage;
  let result = plan ? { ...plan.report } : meshTopology.inspectShading(document);
  const committed = out && editor && editor.editMeshShading(object, request);
  if (paths) {
    const raw = view ? read(view) : {};
    if (!raw || Object.getPrototypeOf(raw) !== Object.prototype ||
        Object.keys(raw).some(key => !['w', 'h', 't', 'camera', 'raw', 'materials'].includes(key)))
      throw new TypeError('Use a mesh shading view with optional size, time, camera and materials');
    // Use a revised scratch scene so authored paint and ordinary scene framing match the committed result.
    const draft = editor && !committed && Object.keys(plan?.patch ?? {}).length ? editor.fork() : editor;
    if (draft && draft !== editor) draft.editMeshTopology(object, plan.patch);
    result = { ...result, native: preview(document, viewSettings({ raw: !editor, ...raw }, !editor),
      paths, toolkit, draft, object, levels) };
  }
  if (!out) process.stdout.write(JSON.stringify(plan ? { patch: plan.patch, report: result } : result, null, 2) + '\n');
  else files.json(path.resolve(out), editor ? editor.snapshot() : document);
  if (report) files.json(path.resolve(report), committed ? { ...committed, shading: result } : result);
}

module.exports = { command };
