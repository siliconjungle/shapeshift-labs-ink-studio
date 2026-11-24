'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const R = require('./render.js');
const files = require('./asset-files.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const name = value => typeof value === 'string' && value.trim();
const fields = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(key => keys.includes(key));

function settings(raw, standalone) {
  if (!fields(raw, ['w', 'h', 't', 'camera', 'raw', 'materials', 'protectPixels']))
    throw new TypeError('Use a native bevel view with size, camera, optional materials and protected pixels');
  const { w = 160, h = 112, t = 0, camera, raw: literal = standalone, materials, protectPixels = [] } = raw;
  if (![w, h].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 1024) || !Number.isFinite(t) || t < 0 ||
      typeof literal !== 'boolean' || materials !== undefined && (!standalone || !Array.isArray(materials)) ||
      !Array.isArray(protectPixels) || protectPixels.length > 8192)
    throw new RangeError('Bevel view needs a native grid up to 1024 × 1024, optional standalone materials and bounded pixel guards');
  for (const row of protectPixels) {
    if (!fields(row, ['id', 'at', 'kind']) || row.id !== undefined && !name(row.id) ||
        !Array.isArray(row.at) || row.at.length !== 2 ||
        !Array.from(row.at).every((n, i) => Number.isSafeInteger(n) && n >= 0 && n < [w, h][i]) ||
        !['color', 'coverage', 'gap'].includes(row.kind))
      throw new RangeError('A protected pixel needs native [x,y] coordinates and color, coverage or gap');
  }
  return { w, h, t, camera, raw: literal, materials, protectPixels };
}

function worldFor(document, view, { KIT, makeBuilder }, reference = document) {
  const [entry] = KIT.authoring.meshTopologyScene.prepare({ workpiece: { document, materials: view.materials } });
  const bounds = KIT.procedural.spatial.boxOf(reference.vertices.map(row => row.position));
  const target = KIT.V.lerp(bounds.min, bounds.max, .5);
  const span = Math.max(...KIT.V.sub(bounds.max, bounds.min));
  return makeBuilder(23, [0x14242e]).finish({ meshes: [entry[1].mesh], dither: 0,
    radius: Math.max(5, span), cam: { target, dist: Math.max(.01, span * 2.05), yaw: -.48, pitch: .37, ortho: true } });
}

function render(world, view, toolkit) {
  require('./diarama-pose.js').pose(world, view.t, { kit: toolkit, maxSteps: 7200 });
  const frame = R.render(world, { w: view.w, h: view.h, t: view.t, px: 1, camera: view.camera,
    raw: view.raw, passes: ['depth', 'geometricNormal'], renderGrid: false, shutter: false, cameraGuides: false });
  if (frame.w !== view.w || frame.h !== view.h || frame.passes?.depth?.length !== view.w * view.h ||
      frame.passes?.geometricNormal?.length !== view.w * view.h * 3)
    throw new RangeError('Bevel preview needs a matching native-grid depth and color capture');
  return frame;
}

const cover = (frame, i) => Number.isFinite(frame.passes.depth[i]);
const pigment = (frame, i) => Array.from(frame.rgb.subarray(i * 3, i * 3 + 3));
const equalColor = (a, b, i) => [0, 1, 2].every(k => a.rgb[i * 3 + k] === b.rgb[i * 3 + k]);

function compare(before, after, view, paths) {
  const diff = new Uint8Array(before.rgb.length);
  let changed = 0, coverage = 0;
  for (let i = 0; i < before.w * before.h; i++) {
    const step = cover(before, i) !== cover(after, i), color = !equalColor(before, after, i);
    if (step || color) changed++;
    if (step) coverage++;
    diff.set(step ? [246, 190, 97] : color ? [228, 102, 140] : pigment(after, i).map(n => Math.round(n * .35)), i * 3);
  }
  const pixels = view.protectPixels.map(row => {
    const i = row.at[0] + row.at[1] * before.w;
    const a = cover(before, i), b = cover(after, i);
    const retained = row.kind === 'gap' ? !a && !b : a === b && (row.kind === 'coverage' || equalColor(before, after, i));
    return { ...row, retained, before: { covered: a, rgb: pigment(before, i) }, after: { covered: b, rgb: pigment(after, i) } };
  });
  if (paths.length) files.write(paths[2], PNG.encode(before.w, before.h, diff));
  return { grid: [before.w, before.h], changedPixels: changed, changedCoverage: coverage, pixels };
}

function normalImage(frame) {
  const rgb = new Uint8Array(frame.rgb.length), normal = frame.passes.geometricNormal;
  for (let i = 0; i < frame.w * frame.h; i++) {
    if (!cover(frame, i)) rgb.set([20, 36, 46], i * 3);
    else for (let k = 0; k < 3; k++) {
      const at = i * 3 + k;
      rgb[at] = Math.round(Math.max(0, Math.min(255, 127.5 + normal[at] * 127.5)));
    }
  }
  return PNG.encode(frame.w, frame.h, rgb);
}

function viewPlan(plan, source, editor, object, view, paths, toolkit) {
  const before = render(editor ? editor.build() : worldFor(source, view, toolkit), view, toolkit);
  if (paths.length) files.write(paths[0], PNG.encode(before.w, before.h, before.rgb));
  if (!plan.document)
    return { ...plan.report, native: { grid: [before.w, before.h], available: false, ...(paths.length && { before: paths[0] }) } };
  let world;
  if (editor) {
    const draft = editor.fork();
    if (Object.keys(plan.patch).length) draft.editMeshTopology(object, plan.patch);
    world = draft.build();
  } else world = worldFor(plan.document, view, toolkit, source);
  const after = render(world, view, toolkit);
  if (paths.length) {
    files.write(paths[1], PNG.encode(after.w, after.h, after.rgb));
    files.write(paths[3], normalImage(after));
  }
  const native = { ...compare(before, after, view, paths), available: true,
    ...(paths.length && { before: paths[0], after: paths[1], difference: paths[2], normals: paths[3] }) };
  const failed = native.pixels.filter(row => !row.retained);
  return { ...plan.report, native, ...(failed.length && { canCommit: false,
    issues: [...plan.report.issues, { kind: 'protected-native-pixels', pixels: failed.map(row => row.at) }] }) };
}

function command(file, input, rest, opt, toolkit, openEditor) {
  const { object, out, report, view, preview } = opt, { KIT: { meshTopology } } = toolkit;
  if (!file || !input || rest.length ||
      [file, input, object, out, report, view, preview].some(arg => arg !== undefined && !name(arg)) ||
      ['selection', 'from', 'visibility', 'projection', 'lineage', 'match-ids', 'pieces'].some(key => opt[key] !== undefined))
    throw new TypeError('Use mesh-topology bevel <mesh-or-scene.json> <request.json> [--object id] [--view file] [--preview dir] [--out file] [--report file]');
  const inputs = [file, input, view].filter(Boolean).map(arg => path.resolve(arg));
  const images = preview ? ['before.png', 'after.png', 'difference.png', 'normals.png'].map(name => path.resolve(preview, name)) : [];
  const outputs = [...[out, report].filter(Boolean).map(arg => path.resolve(arg)), ...images];
  if (new Set(outputs).size !== outputs.length || outputs.some(arg => inputs.includes(arg)))
    throw new RangeError('Write bevel reports, captures and edited meshes separately from their inputs');
  if (object && out && path.dirname(path.resolve(out)) !== path.dirname(path.resolve(file)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const source = read(file), request = read(input);
  if (!object && source?.topologyMeshes) throw new TypeError('Choose an editable scene mesh with --object');
  const editor = object && openEditor(file);
  const plan = editor ? editor.planMeshBevel(object, request) : meshTopology.planBevel(source, request);
  const evidence = preview || view ? viewPlan(plan, meshTopology.create(editor ? editor.meshTopology(object).document : source),
    editor, object, settings(view ? read(view) : {}, !editor), images, toolkit) : plan.report;

  if (report && (!out || !evidence.canCommit)) files.json(path.resolve(report), evidence);
  if (!out) {
    process.stdout.write(JSON.stringify({ patch: plan.patch, report: evidence }, null, 2) + '\n');
    return;
  }
  if (!evidence.canCommit) throw new RangeError('Bevel failed geometry or protection checks');
  const result = editor && editor.bevelMeshTopology(object, request);
  files.json(path.resolve(out), editor ? editor.snapshot() : plan.document);
  if (report) files.json(path.resolve(report), result ? { ...result, bevel: evidence } : evidence);
}

module.exports = { command };
