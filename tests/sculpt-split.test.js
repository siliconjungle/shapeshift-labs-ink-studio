'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load();
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

function source() {
  return { id: 'split-test', solids: [{
    id: 'case', kind: 'box', at: [0, 0, 0], half: [1.7, .45, .8], round: .06, res: .08,
    mat: { role: 'metal', materialId: 'enamel-shell' },
    transform: { translation: [2, .4, -.3], rotation: [.2, 0, 0], scale: 1.1 },
    sockets: { left: { p: [-.9, .45, 0] }, right: { p: [.9, .45, 0], dir: [1, 0, 0] },
      seam: { p: [.12, .45, 0] } },
    modifiers: [{ id: 'drain', kind: 'mask', mode: 'cut',
      shape: { id: 'drain-tool', kind: 'ball', at: [1, .44, .54], r: .11 } }],
    sdfPaint: { version: 1, strokes: [{
      id: 'stripe', grid: [4, 2], material: 'moss',
      projection: { origin: [0, 2, 0], right: [1, 0, 0], down: [0, 0, 1], forward: [0, -1, 0], perspective: false },
      cells: [[1, 1, [-.52, .45, 0], [0, 1, 0], .07], [2, 1, [.52, .45, 0], [0, 1, 0], .07]]
    }, {
      id: 'crossing', grid: [1, 1], material: 'accent',
      projection: { origin: [2, 0, 0], right: [0, 0, 1], down: [0, 1, 0], forward: [-1, 0, 0], perspective: false },
      cells: [[0, 0, [.12, 0, 0], [1, 0, 0], .17]]
    }] }
  }] };
}

const request = { id: 'interface', solid: 'case', extract: 'tip', capMaterial: { role: 'bone', materialId: 'cut-core' },
  cutter: { kind: 'plane', at: [.12, 0, 0], normal: [1, 0, 0] } };

test('complementary pieces share the cut, retain paint and material IDs, and move separately', () => {
  const original = source(), editor = ink.createSceneEditor(original);
  const plan = editor.planSculptSplit(request);
  assert.deepEqual(editor.snapshot(), original);
  const report = editor.splitSculpt(request);
  assert.deepEqual(report, plan);
  assert(report.boundary.intersectsInterior);
  assert(Math.abs(report.boundary.witness[0] - .12) < 1e-6);
  assert.deepEqual(report.materials, { retainedIds: ['accent', 'enamel-shell', 'moss'], cutId: 'cut-core' });
  assert.deepEqual(report.paint.strokes[0].anchors, { remainder: 1, extracted: 1, boundary: 0 });
  assert.deepEqual(report.sockets.map(row => [row.name, row.address, row.onBoundary]), [
    ['left', 'case/left', false], ['right', 'tip/right', false], ['seam', 'case/seam', true]
  ]);
  const scene = editor.snapshot(), left = scene.solids[0], right = scene.solids[1];
  assert.deepEqual(left.modifiers.at(-1).shape, right.modifiers.at(-1).shape);
  assert.equal(editor.node('solid:tip/drain-tool').solid.kind, 'ball');
  assert.deepEqual(left.sdfPaint, right.sdfPaint);
  const a = K.diorama.sculptRestTrace(scene, 'case'), b = K.diorama.sculptRestTrace(scene, 'tip');
  const uncut = K.diorama.sculptRestTrace(original, 'case');
  for (const t of [a, b]) {
    assert(Math.abs(t.distance(t.output, [.12, 0, 0])) < 1e-7);
    assert.deepEqual(t.materialAt([.12, 0, 0], [1, 0, 0]), { role: 'cut-core', paintIds: [] });
    assert.equal(t.materialAt([t === a ? -.52 : .52, .45, 0], [0, 1, 0]).role, 'moss');
  }
  for (const point of [[-.5, 0, 0], [.5, 0, 0], [-1.6, .1, 0], [.25, .6, 0], [2, 0, 0]])
    assert.equal(Math.min(a.distance(a.output, point), b.distance(b.output, point)) < 0,
      uncut.distance(uncut.output, point) < 0);
  const before = editor.build(), moved = [3, .4, -.3];
  editor.setTransform({ translation: moved }, 'solid:tip');
  const exploded = editor.build();
  assert.deepEqual(exploded.anim.where('case/left'), before.anim.where('case/left'));
  assert(Math.abs(exploded.anim.where('tip/right')[0] - before.anim.where('tip/right')[0] - 1) < 1e-9);
  assert.equal(exploded.anim.where('case/right'), null);
  const { materials, materialIds, targets, targetIds } = exploded.renderMetadata;
  const cutOwners = new Set();
  for (let i = 0; i < materialIds.length; i++)
    if (materials[materialIds[i]] === 'cut-core') cutOwners.add(targets[targetIds[i]].entity);
  assert.deepEqual(cutOwners, new Set(['case', 'tip']));
  editor.undo();
  assert.deepEqual(editor.snapshot(), scene);
  editor.undo();
  assert.deepEqual(editor.snapshot(), original);
});

test('a shaped extraction keeps generated procedural sockets on the correct owners', () => {
  const scene = { id: 'pipe-split', solids: [{ id: 'duct', kind: 'pipe', r: .38, wall: .09,
    mat: 'metal', pts: [[-1.4, 0, 0], [1.4, 0, 0]], res: .07 }] };
  const editor = ink.createSceneEditor(scene);
  const report = editor.splitSculpt({ solid: 'duct', extract: 'outlet', id: 'cut',
    cutter: { kind: 'ball', at: [1.1, 0, 0], r: .58 } });
  assert.deepEqual(report.sockets.map(row => row.address), ['duct/a', 'outlet/b']);
  assert.equal(report.materials.cutId, 'metal');
  const world = editor.build();
  assert.deepEqual(world.anim.where('duct/a'), [-1.4, 0, 0]);
  assert.deepEqual(world.anim.where('outlet/b'), [1.4, 0, 0]);
});

test('copies source parameter paths and finds a thin planar extract', () => {
  const original = { id: 'thin-split', solids: [{ id: 'plate', kind: 'box', at: [0, 0, 0], half: [2, .35, .5], mat: 'stone' }],
    parameterBindings: { controls: { lift: .05 }, bindings: [{ parameter: 'lift', path: '/solids/0/at/1' }] } };
  const editor = ink.createSceneEditor(original);
  const report = editor.splitSculpt({ solid: 'plate', extract: 'slice', id: 'trim',
    cutter: { kind: 'plane', at: [1.99, 0, 0], normal: [1, 0, 0] } });
  assert(report.pieces.extracted.witness[0] > 1.99);
  assert.equal(editor.snapshot().parameterBindings.bindings.length, 2);
  assert.equal(editor.snapshot().parameterBindings.bindings[1].path[1], 1);
});

test('CLI plans without writes, publishes one valid split and keeps previous output on a failed split', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sculpt-split-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const get = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  put('base.json', source());
  put('split.json', request);
  const plan = JSON.parse(run('sculpt-split', 'plan', 'base.json', 'split.json'));
  assert(!fs.existsSync(path.join(dir, 'split-scene.json')));
  const apply = () => run('sculpt-split', 'apply', 'base.json', 'split.json', '--out', 'split-scene.json');
  assert.deepEqual(JSON.parse(apply()), plan);
  const saved = get('split-scene.json');
  assert.deepEqual(saved.solids.map(solid => solid.id), ['case', 'tip']);
  run('render', 'split-scene.json', '--ortho', '--w', '110', '--h', '80', '--out', 'proof.png');
  assert(fs.statSync(path.join(dir, 'proof.png')).size > 250);
  put('split.json', { ...request, cutter: { kind: 'ball', at: [100, 100, 0], r: 1 } });
  assert.throws(apply, /leave measurable volume/);
  assert.deepEqual(get('split-scene.json'), saved);
  assert.deepEqual(get('base.json'), source());
});

test('retains the same sculpt bump phase on both sides of the common boundary', () => {
  const original = { id: 'bumped-split', solids: [{ id: 'case', kind: 'ball',
    at: [0, 0, 0], r: 1, bump: [.18, 4], mat: 'stone' }] };
  const editor = ink.createSceneEditor(original);
  editor.splitSculpt(request);
  const snapshot = editor.snapshot();
  assert.equal(typeof snapshot.solids[0].bumpPhase, 'number');
  assert.equal(snapshot.solids[0].bumpPhase, snapshot.solids[1].bumpPhase);
  const before = K.diorama.sculptRestTrace(original, 'case');
  const left = K.diorama.sculptRestTrace(snapshot, 'case');
  const right = K.diorama.sculptRestTrace(snapshot, 'tip');
  for (const x of [-.32, .12, .38]) for (let i = 0; i < 20; i++) {
    const y = (i - 10) / 9, point = [x, y, .2];
    const source = before.distance(before.output, point);
    assert(Math.abs(left.distance(left.output, point) - Math.max(source, x - .12)) < 1e-8);
    assert(Math.abs(right.distance(right.output, point) - Math.max(source, .12 - x)) < 1e-8);
  }
});
