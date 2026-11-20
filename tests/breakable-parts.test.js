const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const studio = require('..');
const { KIT: K, makeBuilder, TargetSelectors } = studio.load();
const source = require('../examples/breakable-parts.json');
const setup = world => {
  const stage = world.anim ?? K.stage(world);
  return stage.add(K.destruction(stage, { points: 1 }));
};
const across = (d, [x, y], options) => d.sweep([x, y, 2], [x, y, -2], .035, options);
const strike = (d, at, impulse) => {
  const hit = across(d, at);
  return d.impact({ p: hit.p, impulse, group: hit.group });
};

test('a swept strike detaches the authored lantern shell, keeping chain samples and collider fixed', () => {
  const world = K.diorama.build(source), d = setup(world), original = world.data.slice();
  const lantern = world.breakables.groups.find(g => g.id === 'lantern');
  const chain = world.breakables.groups.find(g => g.id === 'chain');
  const lanternAt = [-2.17, 3.26], chainAt = [-2.17, 4.19];
  const before = across(d, lanternAt);
  assert.equal(before.group, 'lantern');
  assert(lantern.ids.includes(before.splat));
  assert.equal(across(d, chainAt).group, 'chain');
  assert.deepEqual(d.inspect('lantern').parts, lantern.parts);

  const struck = strike(d, lanternAt, [0.2, 0, -1.3]);
  assert.deepEqual(struck.released, ['lantern']);
  assert.equal(struck.pieces.length, 1);
  assert.equal(struck.pieces[0].pts.length, 1);
  assert.deepEqual(world.data, original);
  const released = across(d, lanternAt, { dynamic: true });
  assert.equal(released.group, 'lantern');
  assert.equal(released.splat, before.splat);
  assert(Math.abs(released.fraction - before.fraction) < 1e-7);
  assert.equal(across(d, lanternAt, { dynamic: true, exclude: 'lantern' }), null);

  for (let i = 0; i < 44; i++) d.update(1 / 120);
  assert.equal(across(d, lanternAt, { dynamic: true }), null);
  assert.equal(across(d, chainAt, { dynamic: true }).group, 'chain');
  for (const i of chain.ids) assert.deepEqual(world.data.subarray(i * 16, i * 16 + 16), original.subarray(i * 16, i * 16 + 16));
  const sample = Array.from(world.data.subarray(before.splat * 16, before.splat * 16 + 3));
  assert.equal(d.sweep(sample, sample, 0, { dynamic: true }).group, 'lantern');
  assert.equal(d.sweep(sample, sample), null);
  d.reset();
  assert.deepEqual(world.data, original);
  assert.equal(across(d, lanternAt).group, 'lantern');
});

test('retained SDF coverage follows destruction ownership at the release boundary', () => {
  const world = K.diorama.build({ id: 'breakable-sdf', finish: { look: { sdfAssist: true } },
    solids: [{ id: 'prop', kind: 'ball', at: [0, 1, 0], r: .5, res: .06 }],
    breakables: { groups: [{ id: 'prop', parts: ['solid:prop'] }] } });
  const d = setup(world), raster = require('../cli/sdf-assist.js'), settings = require('../src/sdf-assist.js').prepare(true);
  const trace = () => raster.rasterize(world, world.data, settings, { w: 1, h: 1, near: .1,
    rayAt: () => ({ origin: [0, 1, 2], direction: [0, 0, -1], axial: 1 }) });
  assert.equal(trace().samples.length, 1);
  d.release('prop');
  assert.equal(trace(), null);
  d.reset();
  assert.equal(trace().samples.length, 1);
});

test('a sculpted terrain seal opens a passage while authored edits keep unrelated chunks and groups', () => {
  const editor = studio.createSceneEditor(source), world = editor.build(), d = setup(world);
  const doorway = [2.44, .8], jamb = [1.38, .85];
  assert.equal(across(d, doorway).group, 'seal');
  assert.equal(across(d, jamb).group, 'arch');
  assert.deepEqual(strike(d, doorway, [0, 0, -3]).released, ['seal']);
  assert.equal(across(d, doorway, { dynamic: true }), null);
  assert.equal(across(d, jamb, { dynamic: true }).group, 'arch');
  for (let i = 0; i < 24; i++) d.update(1 / 120);
  const edited = editor.applyBrush({ id: 'survey-dot', mode: 'place', shape: 'ball',
    points: [[3.36, .3, .39]], radius: .17, material: 'accent' });
  assert(edited.brushRegion.work.reused > 0);
  assert(edited.brushRegion.work.sampled.length > 0);
  const seal = edited.breakables.groups.find(g => g.id === 'seal');
  const targets = TargetSelectors.index(edited);
  assert(seal.ids.every(id => targets.row(id).entity === 'brush-stroke:chalk-seal'));
  assert.equal(across(setup(edited), doorway).group, 'seal');
});

test('bindings resolve rig parts after resampling and reject conflicting or empty groups', () => {
  const scene = { id: 'breakable-rig', solids: [
    { id: 'hinge', kind: 'box', at: [-1, 2, 0], half: [.25, .2, .3], res: .08 },
    { id: 'panel', part: 'panel', kind: 'box', at: [0, 2, 0], half: [.65, .5, .14], res: .075 },
    { kind: 'ball', part: 'panel', at: [.18, 2.12, .19], r: .13, res: .05 },
    { id: 'wall', part: 'jamb', kind: 'box', at: [1, 2, 0], half: [.28, .54, .24], res: .08 }
  ], motion: [{ do: 'bob', part: 'panel', period: 2, amount: .2 }] };
  const editor = studio.createSceneEditor(scene);
  const definitions = { groups: [{ id: 'panel', parts: ['part:panel'] }] };
  const world = editor.setBreakables(definitions);
  const stage = world.anim, d = setup(world), beforePose = world.data.slice();
  stage.update(0, 0); stage.update(.04, .25);
  assert.notDeepEqual(world.data, beforePose);
  const posed = world.data.slice();
  const released = d.release('panel');
  assert.equal(released.length, 1);
  assert.deepEqual(world.data, posed);
  const ids = world.breakables.groups[0].ids;
  assert(ids.every(i => stage.physicsOwned[i]));
  const targets = TargetSelectors.index(world);
  assert(ids.every(i => targets.row(i).object === 'panel'));
  d.dispose();
  assert(editor.undo());
  assert.equal(editor.build().breakables, undefined);
  assert(editor.redo());
  const rebaked = K.diorama.build({ ...editor.snapshot(), solids: scene.solids.slice().reverse().map(solid => ({ ...solid, res: .09 })) });
  assert.notEqual(rebaked.breakables.groups[0].ids.length, ids.length);
  const rebakedTargets = TargetSelectors.index(rebaked);
  assert(rebaked.breakables.groups[0].ids.every(i => rebakedTargets.row(i).object === 'panel'));

  const before = editor.serialize();
  assert.throws(() => editor.setBreakables({ groups: [{ id: 'missing', parts: ['solid:no-such-part'] }] }), /Unknown breakable part/);
  assert.throws(() => editor.setBreakables({ groups: [...definitions.groups, { id: 'duplicate', parts: ['solid:panel'] }] }), /overlap/);
  assert.throws(() => editor.setBreakables({ groups: [...definitions.groups, { id: 'duplicate', parts: ['part:panel'] }] }), /single group/);
  assert.equal(editor.serialize(), before);
  assert.equal(editor.setBreakables(null).breakables, undefined);
  assert(editor.undo());
  assert.equal(editor.build().breakables.groups.length, 1);
});

test('prefab instances bind separately and a fully carved part fails the bake', () => {
  const scene = { id: 'breakable-prefabs', prefabs: { marker: { revision: 1,
    solids: { tip: { kind: 'ball', at: [0, 1, 0], r: .2, res: .06 } } } },
    instances: { first: { prefab: 'marker' }, second: { prefab: 'marker', transform: { translation: [2, 0, 0] } } },
    solids: [], breakables: { groups: [{ id: 'marker', parts: ['solid:second.tip'] }] } };
  const world = K.diorama.build(scene);
  const targets = TargetSelectors.index(world);
  assert(world.breakables.groups[0].ids.every(i => targets.row(i).entity === 'second.tip'));
  assert.equal(across(setup(world), [2, 1]).group, 'marker');
  assert.throws(() => K.diorama.build({ ...scene, solids: [
    { kind: 'ball', at: [2, 1, 0], r: .6, carve: true }
  ] }), /no visible splats: solid:second.tip/);
});

test('nearby suggestions respect ownership, reject open terrain, and work through the CLI', () => {
  const editor = studio.createSceneEditor(source), before = editor.serialize();
  const options = { at: [2.44, .8, .45], radius: 1.35, voxel: .12 };
  const first = editor.suggestBreakable(options);
  assert.equal(first.status, 'suggested');
  assert.deepEqual(first.parts, ['stroke:chalk-seal']);
  assert(first.ids.length > 500);
  assert.deepEqual(editor.suggestBreakable(options), first);
  assert.equal(editor.suggestBreakable({ at: [0, 0, 0], radius: .75, voxel: .15 }).status, 'touches-boundary');
  assert.equal(editor.suggestBreakable({ ...options, maxSamples: 20 }).status, 'sample-budget');
  assert.equal(editor.suggestBreakable({ at: [100, .1, 0] }).status, 'miss');
  assert.equal(editor.serialize(), before);

  const builder = makeBuilder(5);
  for (let i = 0; i < 6; i++) builder.iso(i * .03, 1, 0, .05, builder.P[2], 2);
  const imported = K.authoring.breakables.suggest(builder.finish(), { at: [0, 1, 0] });
  assert.equal(imported.status, 'suggested');
  assert.deepEqual(imported.parts, []);
  assert.equal(imported.ids.length, 6);

  const report = JSON.parse(execFileSync(process.execPath, [
    path.resolve(__dirname, '../cli/ink-studio.js'), 'authoring', 'suggest-breakable',
    path.resolve(__dirname, '../examples/breakable-parts.json'), '--at', options.at.join(','),
    '--radius', String(options.radius), '--voxel', String(options.voxel)
  ], { stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.deepEqual(report, { status: first.status, parts: first.parts, samples: first.ids.length });
});
