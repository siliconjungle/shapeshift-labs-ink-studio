const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const { shapeSweeps } = ink.load().KIT.procedural;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

test('Sculpt sweeps interpolate each supported bounded shape while retaining orientation and pressure', () => {
  const brushes = [
    { kind: 'box', half: [.35, .22, .27], round: .06 },
    { kind: 'wedge', half: [.35, .22, .27] },
    { kind: 'profile', points: [[-.32, -.25], [.33, -.25], [.28, .22], [-.25, .21]], depth: .5 },
    { kind: 'sphere', radius: .22 },
    { kind: 'capsule', radius: .23, length: .5 },
    { kind: 'cylinder', radius: .23, length: .5 }
  ];
  for (const brush of brushes) {
    const poses = [{ point: [-.7, 0, 0], pressure: .7 }, { point: [.7, 0, 0], pressure: 1.3 }];
    const sweep = shapeSweeps.prepare({ brush, poses, blendRadius: .08 });
    assert(sweep.sampleCount > poses.length, brush.kind);
    assert(sweep.sd(0, -.05, 0) < 0, brush.kind);
    assert(sweep.sd(0, 1, 0) > 0, brush.kind);
    assert(sweep.bounds.min.every((value, axis) => value < sweep.bounds.max[axis]));
  }
  const torus = shapeSweeps.prepare({ brush: { kind: 'torus', major: .45, minor: .12 },
    poses: [{ point: [0, -.6, 0] }, { point: [0, .6, 0] }] });
  assert(torus.sd(0, 0, 0) > .3);
  assert(torus.sd(.45, 0, 0) < -.1);

  const brush = { kind: 'box', half: [.6, .13, .13] };
  const poses = [{ point: [0, 0, 0] }, { point: [0, 0, 0], rotation: [0, 0, 1, 0] }];
  const arc = shapeSweeps.prepare({ brush, poses });
  assert(arc.sd(0, .5, 0) < 0, 'intermediate rotations sweep through vertical');
  assert(arc.sd(0, 0, .25) > 0);
  const soft = shapeSweeps.prepare({ brush, poses, blendRadius: .12 });
  assert(soft.sd(0, .5, 0) < arc.sd(0, .5, 0));
  const tapered = shapeSweeps.prepare({ brush: { kind: 'sphere', radius: .25 },
    poses: [{ point: [0, 0, 0], pressure: 0 }, { point: [1, 0, 0], pressure: 1 }] });
  assert(tapered.sd(.1, .12, 0) > 0 && tapered.sd(.9, .12, 0) < 0);
  assert.throws(() => shapeSweeps.prepare({ brush, poses: poses.map(p => ({ ...p, pressure: 0 })) }), /positive pressure/);
  assert.throws(() => shapeSweeps.prepare({ brush, poses: [{ point: [0, 0, 0] }, { point: [9, 0, 0] }], step: .0001 }),
    /evaluated poses/);
});

test('CLI carves, attaches, inspects and revises a saved sweep with atomic validation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sweep-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = file => path.join(dir, file);
  const put = (file, value) => fs.writeFileSync(filename(file), JSON.stringify(value));
  const get = file => JSON.parse(fs.readFileSync(filename(file), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const edit = (verb, scene, request, out, ...options) =>
    run('sculpt-sweep', verb, scene, request, '--out', out, ...options);
  put('base.json', { id: 'sweep-test', solids: [
    { id: 'plate', kind: 'box', at: [0, 0, 0], half: [1.45, .32, .7], mat: 'stone', res: .075 }
  ] });
  const poses = [{ point: [-.85, .34, .08], pressure: .7 }, { point: [.73, .34, -.07], pressure: 1.15 }];
  const request = { id: 'channel', brush: { kind: 'box', half: [.22, .24, .2], round: .05 }, poses, blendRadius: .06 };
  put('sweep.json', request);
  edit('cut', 'base.json', 'sweep.json', 'cut.json', '--target', 'plate');
  const saved = get('cut.json');
  const modifier = saved.solids[0].modifiers[0];
  assert.equal(modifier.how, 'cut');
  assert.deepEqual(modifier.shape.poses, poses);
  assert.equal(modifier.shape.blendRadius, .06);
  const inspect = JSON.parse(run('sculpt-sweep', 'inspect', 'cut.json', '--target', 'plate', '--id', 'channel'));
  assert(inspect.sampleCount > 2);
  assert.deepEqual(inspect.sweep, modifier.shape);

  const revised = poses.map(row => ({ ...row, point: row.point.map((v, i) => i === 2 ? v + .4 : v) }));
  put('revise.json', { id: 'channel', poses: revised, blendRadius: .11 });
  edit('update', 'cut.json', 'revise.json', 'revised.json', '--target', 'plate');
  assert.deepEqual(get('cut.json'), saved);
  assert.deepEqual(get('revised.json').solids[0].modifiers[0].shape.poses, revised);
  const sample = scene => ink.load().KIT.diorama.brushField(scene).sdf(0, .26, 0);
  assert(sample(get('base.json')) < 0);
  assert(sample(saved) > 0);
  assert(sample(get('revised.json')) < 0);

  put('invalid.json', { id: 'channel', poses: [] });
  assert.throws(() => edit('update', 'cut.json', 'invalid.json', 'broken.json', '--target', 'plate'));
  assert(!fs.existsSync(filename('broken.json')));

  put('add.json', { ...request, id: 'rail', mat: 'metal', poses: poses.map(row => ({ ...row,
    point: [row.point[0], .67, row.point[2]] })) });
  edit('add', 'revised.json', 'add.json', 'raised.json');
  const editor = ink.createSceneEditor(get('raised.json'));
  const world = editor.build();
  assert(world.renderMetadata.objects.includes('rail'));
  editor.updateShape({ blendRadius: .12 }, 'solid:rail');
  assert.equal(editor.node('solid:rail').solid.blendRadius, .12);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(), get('raised.json'));

  edit('add', 'revised.json', 'add.json', 'attached.json', '--target', 'plate');
  const attached = get('attached.json').solids[0].modifiers[1];
  assert.equal(attached.how, 'union');
  assert.deepEqual(attached.shape.poses, get('add.json').poses);
  run('render', 'raised.json', '--w', '96', '--h', '64', '--px', '1', '--ortho', '--out', 'frame.png');
  assert(fs.statSync(filename('frame.png')).size > 100);
});
