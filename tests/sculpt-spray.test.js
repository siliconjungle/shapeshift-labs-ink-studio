'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { KIT: K } = ink.load();
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

const body = { id: 'vessel', kind: 'ball', at: [0, 0, 0], r: 1, mat: 'stone' };
const wall = { id: 'mask', kind: 'box', at: [0, 0, -1.25], half: [.27, .8, .13], mat: 'stone' };
const base = { id: 'test-spray', solids: [body, wall] };
const brush = { id: 'glaze', targets: ['vessel'], color: '#ff4830', resolution: 64,
  brush: { shape: 'box', center: [0, 0, 0], direction: [0, 0, 1], half: [1, 1.4, 1.8] }, facing: 'all' };
const point = (x, sign) => [x, 0, sign * Math.sqrt(1 - x * x)];
const read = (trace, p) => trace.materialAt(p, p).paintIds;

test('first-hit spray respects unselected blockers and self-occlusion', () => {
  const editor = ink.createSceneEditor(base);
  const preview = editor.planSculptSpray(brush);
  assert.deepEqual(editor.snapshot(), base);
  assert.deepEqual(editor.applySculptSpray(brush), preview);
  assert(preview.receivers[0].receiverRays > 100);
  const scene = JSON.parse(JSON.stringify(editor.snapshot()));
  assert.deepEqual(scene.solids[1], wall);
  const trace = K.diorama.sculptRestTrace(scene, 'vessel');
  assert.deepEqual(read(trace, point(.55, -1)), ['glaze']);
  assert.deepEqual(read(trace, point(.0, -1)), []);
  assert.deepEqual(read(trace, point(.55, 1)), []);

  const shifted = structuredClone(scene);
  shifted.solids[0].transform = { translation: [2, 1, -1] };
  shifted.solids[1].transform = { translation: [-4, 0, 0] };
  const { field } = K.diorama.sculptFieldReceivers(shifted);
  for (const [x, paints] of [[0, false], [.55, true]]) {
    const p = point(x, -1);
    const moved = K.V.add(p, [2, 1, -1]);
    const { material } = field.surfaceAt(...moved);
    assert.equal(Boolean(material.sdfSpray.locate(moved, p)), paints);
  }
  assert.deepEqual(editor.inspectSculptSprays(), preview.receivers);
  assert.throws(() => editor.applySculptSpray(brush), /already exists/);
  editor.undo();
  assert.deepEqual(editor.snapshot(), base);
});

test('wrap reaches the back, and falloff, facing and taper are independently controlled', () => {
  const editor = ink.createSceneEditor(base);
  editor.applySculptSpray({ ...brush, occlusion: 'wrap', softness: .45 });
  const trace = K.diorama.sculptRestTrace(editor.snapshot(), 'vessel');
  const { sdfSpray: paint } = trace.output.mat;
  assert.deepEqual(read(trace, point(0, -1)), ['glaze']);
  assert.deepEqual(read(trace, point(0, 1)), ['glaze']);
  const baseColor = [.5, .5, .5];
  const tint = p => paint.locate(p, p)(baseColor);
  assert(tint(point(.55, 1))[0] > tint(point(.9, 1))[0]);
  const options = { ...brush, occlusion: 'wrap', facing: { minDot: .5, feather: .2 } };
  const second = ink.createSceneEditor(base);
  second.applySculptSpray(options);
  const limited = K.diorama.sculptRestTrace(second.snapshot(), 'vessel');
  assert.deepEqual(read(limited, point(.55, -1)), ['glaze']);
  assert.deepEqual(read(limited, point(.9, -1)), []);
  assert.deepEqual(read(limited, point(.55, 1)), []);
  const cone = ink.createSceneEditor(base);
  cone.applySculptSpray({ ...brush, occlusion: 'wrap', brush: { ...brush.brush, shape: 'cone', tip: .12 } });
  const taper = K.diorama.sculptRestTrace(cone.snapshot(), 'vessel');
  assert.deepEqual(read(taper, point(.55, -1)), []);
  assert.deepEqual(read(taper, point(.55, 1)), ['glaze']);
});

test('only selected receivers are painted and a bad multi-target operation is atomic', () => {
  const editor = ink.createSceneEditor(base);
  assert.throws(() => editor.applySculptSpray({ ...brush, targets: ['vessel', 'missing'] }), /missing/);
  assert.deepEqual(editor.snapshot(), base);
  const report = editor.applySculptSpray({ ...brush, targets: ['vessel', 'mask'] });
  assert(report.receivers.every(row => row.receiverRays > 0));
  assert.equal(editor.snapshot().solids.filter(solid => solid.sdfSpray).length, 2);
});

test('a front-facing carved surface receives spray without changing its cut material', () => {
  const scene = { id: 'spray-cut', solids: [
    { ...body, kind: 'box', r: undefined, half: [1, 1, 1] },
    { id: 'carve', kind: 'ball', at: [0, 0, -.9], r: .45, carve: true, mat: 'metal' }
  ] };
  delete scene.solids[0].r;
  const editor = ink.createSceneEditor(scene);
  editor.applySculptSpray(brush);
  const { field } = K.diorama.sculptFieldReceivers(editor.snapshot());
  const p = [0, 0, -.45], n = [0, 0, -1], material = field.surfaceAt(...p).material;
  assert.equal(material.materialId, 'metal');
  assert(field.materialAt(material, p, n).model.color[0] > field.materialAt(material, p, n).model.color[2]);
});

test('CLI saves editable native paint and exported pixels show the tint', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sculpt-spray-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  save('base.json', base);
  save('brush.json', brush);
  const report = JSON.parse(run('sculpt-spray', 'apply', 'base.json', 'brush.json', '--out', 'painted.json'));
  assert.deepEqual(JSON.parse(run('sculpt-spray', 'inspect', 'painted.json')), report.receivers);
  for (const stage of ['base', 'painted'])
    run('render', stage + '.json', '--ortho', '--raw', '--yaw', '3.14', '--w', '120', '--h', '104', '--out', stage + '.png');
  const { read } = require('../cli/png.js');
  const a = read(path.join(dir, 'base.png')).rgb, b = read(path.join(dir, 'painted.png')).rgb;
  assert(a.some((x, i) => i % 3 === 0 && b[i] > x + 30 && b[i + 1] < b[i] - 45));
});
