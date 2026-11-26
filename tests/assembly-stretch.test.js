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

function scene() {
  return { id: 'handle-stretch',
    parts: { bed: { joint: [0, .2, 0] }, beam: { parent: 'bed', joint: [0, .2, 0] },
      head: { parent: 'beam', joint: [2, 0, 0] } },
    solids: [
      { id: 'base', part: 'bed', kind: 'box', at: [-.4, 0, 0], half: [.41, .34, .4], mat: 'stone',
        sockets: { fixed: { p: [0, 0, 0] }, nose: { p: [0, .2, 0], dir: [1, 0, 0] } } },
      { id: 'rail', part: 'beam', kind: 'box', at: [1, 0, 0], half: [1, .32, .3], mat: 'stone',
        transform: { pivot: [.75, 0, 0] },
        sockets: { in: { p: [0, .2, 0], dir: [-1, 0, 0] }, out: { p: [2, 0, 0], dir: [1, 0, 0] } },
        sdfPaint: { version: 1, strokes: [{ id: 'stripe', material: 'moss', grid: [2, 2],
          projection: { origin: [1, 2, 0], right: [.25, 0, 0], down: [0, 0, .25], forward: [0, -1, 0], perspective: false },
          cells: [[1, 1, [1.06, .32, .05], [0, 1, 0], .06]] }] } },
      { id: 'camera', part: 'head', kind: 'box', at: [2.28, 0, 0], half: [.28, .26, .25], mat: 'metal',
        sockets: { drag: { p: [2, 0, 0], dir: [-1, 0, 0] }, cable: { p: [2.53, 0, 0] } } },
      { id: 'guide', kind: 'ball', at: [2.75, 0, .5], r: .12, mat: 'stone',
        sockets: { cable: { p: [2.53, 0, 0] } } }
    ]
  };
}

const request = { members: [{ solid: 'base', mode: 'fixed' }, { solid: 'rail' }, { solid: 'camera', mode: 'rigid' }],
  anchor: { solid: 'base', socket: 'fixed' }, handle: { solid: 'camera', socket: 'drag' }, length: 3,
  connections: [
    { id: 'inlet', a: { solid: 'base', socket: 'nose' }, b: { solid: 'rail', socket: 'in' }, maxAngle: 1 },
    { id: 'outlet', a: { solid: 'rail', socket: 'out' }, b: { solid: 'camera', socket: 'drag' }, maxAngle: 1 }
  ],
  jointLimits: [{ part: 'head', maxLength: 3.25 }]
};
const round = point => point.map(value => Number(value.toFixed(8)));

test('a handle stretch carries the rail pivot, native paint, and rig sockets while the head keeps size', () => {
  const before = scene(), editor = ink.createSceneEditor(before);
  const proposed = editor.planAssemblyStretch(request);
  assert.deepEqual(editor.snapshot(), before);
  assert.equal(proposed.report.canCommit, true);
  const report = editor.stretchAssembly(request);
  const edited = editor.snapshot();
  assert.deepEqual(edited, proposed.scene);
  assert.deepEqual(report.length, { before: 2, requested: 3, after: 3 });
  assert.deepEqual(round(report.members.find(row => row.solid === 'rail').pivot.after), [1.125, 0, 0]);
  assert.deepEqual(round(edited.parts.head.joint), [3, 0, 0]);
  assert(report.connections.every(row => row.gap.after < 1e-8));
  assert.deepEqual(edited.solids[0], before.solids[0]);
  assert.deepEqual(edited.solids[1].sdfPaint, before.solids[1].sdfPaint);
  const world = editor.build();
  assert.deepEqual(round(world.anim.where('rail/out')), [3, 0, 0]);
  assert.deepEqual(round(world.anim.where('camera/drag')), [3, 0, 0]);
  assert.deepEqual(round(world.anim.where('camera/cable')), [3.53, 0, 0]);
  const field = K.diorama.brushField(edited), p = [1.59, .32, .05], normal = [0, 1, 0];
  const owner = field.renderSurface(...p).owner;
  assert.equal(owner.renderTarget.entity, 'rail');
  assert.equal(field.materialAt(owner.mat, p, normal).materialId, 'moss');
  assert(field.sdf(3.53, 0, 0) < 0);
  assert(field.sdf(3.6, 0, 0) > 0);
  editor.undo();
  assert.deepEqual(editor.snapshot(), before);
  editor.redo();
  assert.deepEqual(editor.snapshot(), edited);
});

test('previews external socket slip, a wrong rigid grip, and joint length and swing limits atomically', () => {
  const editor = ink.createSceneEditor(scene()), original = editor.snapshot();
  const blocked = { ...request, length: 4,
    members: [...request.members.slice(0, 2), { solid: 'camera', mode: 'rigid', grip: { socket: 'cable' } }],
    connections: [...request.connections, { id: 'bracket', a: { solid: 'camera', socket: 'cable' },
      b: { solid: 'guide', socket: 'cable' }, maxGap: .02 }],
    jointLimits: [{ part: 'head', maxLength: 3.25, maxSwing: .5 }]
  };
  const { scene: preview, report } = editor.planAssemblyStretch(blocked);
  const codes = new Set(report.issues.map(row => row.code));
  for (const code of ['handle-slip', 'socket-gap', 'joint-slip', 'joint-length-limit', 'joint-swing-limit'])
    assert(codes.has(code), code);
  assert.equal(report.canCommit, false);
  assert(preview.solids.find(solid => solid.id === 'rail').restAffine);
  assert.throws(() => editor.stretchAssembly(blocked), error => error.report?.canCommit === false);
  assert.equal(editor.snapshot(), original);
});

test('an angled cross-section stretch maps geometry and catches a projected decal that would skew', () => {
  const source = { id: 'angle', solids: [{ id: 'body', kind: 'ball', at: [0, 0, 0], r: 1, mat: 'stone',
    transform: { translation: [.5, 0, 0], rotation: [.19, 0, 0], pivot: [0, 0, 0] } }],
    surfaceDecals: { format: 'ink-studio/surface-decals', version: 1, decals: [{ id: 'label',
      anchor: { object: 'body', at: [.5, 0, 1], normal: [0, 0, 1], up: [0, 1, 0], size: [.2, .2] },
      image: { width: 1, height: 1, pixels: [20, 120, 170, 255] } }] } };
  const editor = ink.createSceneEditor(source);
  const input = { members: [{ solid: 'body' }], anchor: { solid: 'body', pivot: true },
    handle: { solid: 'body', point: [1, .5, 0] }, length: 2.1, cross: [.5, .75] };
  const plan = editor.planAssemblyStretch(input);
  assert(plan.report.issues.some(issue => issue.code === 'decal-projector-slip' && issue.decal === 'label'));

  source.surfaceDecals.decals[0].anchor.at = [0, 0, 1];
  delete source.solids[0].transform;
  const aligned = ink.createSceneEditor(source);
  const report = aligned.stretchAssembly({ ...input, handle: { solid: 'body', point: [1, 0, 0] }, length: 2 });
  assert.equal(report.decals[0].status, 'carried');
  assert.deepEqual(round(aligned.snapshot().surfaceDecals.decals[0].anchor.size), [.4, .15]);
  const field = K.diorama.brushField(aligned.snapshot());
  assert(field.sdf(1.95, 0, 0) < 0 && field.sdf(0, .80, 0) > 0);
});

test('CLI exports a blocked preview and preserves the approved scene on a blocked apply', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-assembly-stretch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const read = file => fs.readFileSync(path.join(dir, file), 'utf8');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  put('base.json', scene());
  put('pull.json', request);
  const apply = () => run('assembly-stretch', 'apply', 'base.json', 'pull.json', '--out', 'approved.json');
  assert.equal(JSON.parse(apply()).canCommit, true);
  const approved = read('approved.json');
  put('pull.json', { ...request, length: 5 });
  const plan = JSON.parse(run('assembly-stretch', 'plan', 'base.json', 'pull.json', '--preview', 'blocked.json'));
  assert.equal(plan.canCommit, false);
  assert(plan.issues.some(row => row.code === 'joint-length-limit'));
  assert.throws(apply, /Assembly stretch needs review/);
  assert.equal(read('approved.json'), approved);
  run('render', 'blocked.json', '--ortho', '--w', '125', '--h', '100', '--out', 'preview.png');
  assert(fs.statSync(path.join(dir, 'preview.png')).size > 250);
});
