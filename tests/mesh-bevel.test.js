'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const example = require('../examples/mesh-bevel/fixture.cjs');
const { KIT } = ink.load(), api = KIT.meshTopology;
const close = (a, b) => assert(Math.abs(a - b) < 1e-8, String(a));

test('weighted round bevels cut real facets and join corners while retaining the separate coating', () => {
  const doc = api.create(example.consoleMesh()), request = example.request(api, doc);
  const plan = api.planBevel(doc, request);
  assert(plan.report.canCommit, JSON.stringify(plan.report.issues));
  const faces = plan.report.faces;
  assert.equal(faces.filter(row => row.corner).length, 4);
  assert.equal(faces.filter(row => !row.corner).length, 16);
  close(plan.report.edges.find(row => row.weight < 1).width, .117);
  assert(api.inspect(plan.document).edges.every(edge => edge.uses.length === 2));
  const rim = plan.document.faces.filter(face => face.material === 'machined-rim');
  assert.equal(rim.length, 20);
  assert(rim.every(face => face.corners.every(c => Array.isArray(c.attributes.grain))));
  const before = doc.faces.filter(face => face.material === 'painted-rail');
  assert.deepEqual(plan.document.faces.filter(face => face.material === 'painted-rail'), before);
  assert.deepEqual(plan.document.vertices.filter(vertex => vertex.id.startsWith('rail/')),
    doc.vertices.filter(vertex => vertex.id.startsWith('rail/')));
  assert(plan.patch.vertices.some(row => row.weights.knob > .1 && row.weights.knob < .6));
  assert(plan.report.lineage.edges.some(row => request.bevel.selection.ids.includes(row.from)));
  assert(plan.report.protection.paint[0].retained);
  assert(plan.report.protection.gaps[0].retained);
  assert.deepEqual(api.edit(doc, plan.patch), plan.document);
  assert.deepEqual(api.planBevel(doc, request), plan);
  assert.throws(() => api.planBevel(plan.document, request), /Stale/);
});

test('chamfer, custom profile and zero weights preserve declared widths and paint guards', () => {
  const doc = api.create(example.consoleMesh());
  const chamfer = example.request(api, doc, { bevel: { profile: 'chamfer', segments: 1, join: 'miter' } });
  chamfer.bevel.weights[0].weight = 0;
  const result = api.planBevel(doc, chamfer);
  assert(result.report.canCommit);
  assert.equal(result.report.faces.length, 3);
  assert(result.report.edges.some(row => row.width === 0));
  const custom = example.request(api, doc, { bevel: { segments: 3,
    profile: { points: [[1, 0], [.45, .10], [.18, .36], [0, 1]] } } });
  const shaped = api.planBevel(doc, custom);
  assert(shaped.report.canCommit, JSON.stringify(shaped.report.issues));
  assert.equal(shaped.report.faces.filter(row => !row.corner).length, 12);
  const blocked = api.planBevel(doc, example.request(api, doc, { bevel: { width: .33 },
    protect: { faces: ['panel/side/0'] } }));
  assert.equal(blocked.report.canCommit, false);
  assert(blocked.report.issues.some(row => row.kind === 'protected-face'));
  assert.equal(blocked.report.protection.paint[0].reason, 'trimmed-paint');
  assert(blocked.report.protection.gaps[0].retained);
  assert(blocked.document);
});

test('a bevel uses the scene and bound-pixel journal and guards active protected bakes', () => {
  const doc = api.create(example.consoleMesh()), request = example.request(api, doc);
  const source = { id: 'bench', style: 'slate', solids: [], topologyMeshes: {
    console: { document: doc, part: 'shell', materials: example.materials(),
      bindings: [{ id: 'legend', domain: 'faces', element: 'panel/face' }] }
  } };
  const baked = { ...source, topologyMeshes: { console: { ...source.topologyMeshes.console,
    bakes: [{ id: 'legend-bake', material: 'lettering', maps: { roughness: .3 } }]
  } } };
  const bakedEditor = ink.createSceneEditor(baked), bakePlan = bakedEditor.planMeshBevel('console', request);
  assert.equal(bakePlan.report.canCommit, false);
  assert.deepEqual(bakePlan.report.issues.at(-1), { kind: 'protected-bake', bakes: ['legend-bake'] });
  const editor = ink.createSceneEditor(source);
  const design = { format: 'ink-studio/pixel-art', version: 2, width: 8, height: 8, pixelAspect: [1, 1],
    palette: { chalk: '#c3aa76' }, layers: [{ id: 'ink' }], frames: [{ id: 'front', durationMs: 100, cels: {} }],
    sceneBindings: [{ id: 'console', scene: 'bench', object: 'console', part: 'shell' }],
    destinations: [{ id: 'geometry', kind: 'mesh-topology', binding: 'console' }] };
  const pixels = ink.createPixelEditor(design, { sceneEditor: editor });
  const edit = { id: 'round-edges', frame: 'front', revision: pixels.describe().revision, destination: 'geometry',
    operation: { bevel: request } };
  edit.sourceRevision = pixels.previewEdit(edit).sourceRevision;
  const preview = pixels.previewEdit(edit, { exact: true });
  assert(preview.valid, JSON.stringify(preview.conflicts));
  assert(preview.targets[0].bevel.protection.paint[0].retained);
  pixels.apply(edit);
  const received = pixels.receipts()[0], current = editor.snapshot();
  assert.equal(current.topologyMeshes.console.bindings[0].element, 'panel/face');
  assert(pixels.undo());
  assert.deepEqual(editor.meshTopology('console').document, doc);
  pixels.replay(received);
  assert.deepEqual(editor.snapshot(), current);
});

test('native CLI produces a matched 1× art-grid preview and rejects a changed protected pixel', t => {
  const doc = api.create(example.consoleMesh()), request = example.request(api, doc);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-native-bevel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const run = (view, out) => spawnSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'),
    'mesh-topology', 'bevel', 'mesh.json', 'request.json', '--view', view, '--out', out,
    '--report', out + '-report', '--preview', out + '-frames'], { cwd: dir, encoding: 'utf8' });
  save('mesh.json', doc);
  save('request.json', request);
  const view = { w: 160, h: 112, camera: { yaw: 0, pitch: 0, target: [-.1, 0, 0], dist: 4.25, ortho: true },
    materials: example.materials(), protectPixels: [{ id: 'gap', at: [110, 55], kind: 'gap' },
      { id: 'paint', at: [75, 55], kind: 'color' }] };
  save('view.json', view);
  const accepted = run('view.json', 'after.json');
  assert.equal(accepted.status, 0, accepted.stderr);
  const report = read('after.json-report');
  assert(report.native.pixels.every(row => row.retained));
  assert(report.native.changedPixels > 0);
  assert(report.native.pixels[1].before.covered);
  const pic = fs.readFileSync(path.join(dir, 'after.json-frames/after.png'));
  assert.deepEqual([pic.readUInt32BE(16), pic.readUInt32BE(20)], [160, 112]);
  assert.deepEqual(read('after.json'), api.planBevel(doc, request).document);

  view.protectPixels.push({ id: 'old-edge-color', at: [109, 55], kind: 'color' });
  save('blocked-view.json', view);
  const failure = run('blocked-view.json', 'blocked.json');
  assert.equal(failure.status, 1, failure.stderr);
  assert(!fs.existsSync(path.join(dir, 'blocked.json')));
  const blocked = read('blocked.json-report');
  assert.equal(blocked.issues.at(-1).kind, 'protected-native-pixels');
  assert.equal(blocked.native.pixels.at(-1).retained, false);
});
