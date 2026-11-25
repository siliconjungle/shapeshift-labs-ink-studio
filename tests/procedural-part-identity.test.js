const {test} = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const {KIT: K} = studio.load(), P = K.procedural, W = K.world;
const link = (node, port) => ({node, ...(port && {port})});
const input = input => ({input});
const op = (op, inputs) => ({op, inputs});
const edit = (path, value) => ({op: 'set', path, value});
const panel = (size, mat = 'metal') => ({kind: 'box', at: [0, 0, 0], half: [size, .2, .1], mat, res: .1});
const part = (id, value, splitFrom) => ({id, value, ...(splitFrom && {splitFrom})});
const visual = (revision, rows, model = 'signal') => P.model.prefab({model, revision, sections: {solids: rows}});

test('grid distributions retain positions and group seeds when bounds or row order change', () => {
  const grid = {id: 'bolt', origin: [0, 0, 0], step: [.4, .5, .6], jitter: .2}, radius = .25;
  const scatter = bounds => P.generator.scatter({bounds, grid, radius, seed: 43}).samples;
  const before = scatter({min: [-.5, -.7, -.8], max: [.5, .7, .8]});
  const after = scatter({min: [-.9, -.7, -.8], max: [.9, .7, .8]});
  assert(before.length > 0 && after.length > before.length);
  const positions = new Map(after.map(row => [row.id, row]));
  for (const row of before) assert.deepEqual(positions.get(row.id), row);
  const masked = P.generator.scatter({grid, radius, seed: 43,
    bounds: {min: [-.9, -.7, -.8], max: [.9, .7, .8]}, mask: x => x}).samples;
  assert.deepEqual(masked, after.filter(({point}) => point[0] > 0));
  for (const [i, a] of after.entries())
    for (const b of after.slice(i + 1)) assert(K.V.dist(a.point, b.point) >= radius);
  assert.throws(() => P.generator.scatter({grid: {...grid, origin: [0, 0], step: .01}, radius}), /radius and jitter/);
  assert.throws(() => P.generator.scatter({grid: {id: 'dense', origin: [0, 0], step: .001}, radius: 0}), /cell budget/);
  assert.throws(() => P.generator.scatter({grid: {id: 'grid', origin: [0, 0], step: .5}, reseed: 0}), /Poisson options/);

  const graph = studio.createGraphProject({format: 'ink-studio/graph-project', version: 1,
    inputs: {options: 'record', roles: 'array<record>'},
    groups: {bolt: {inputs: {item: 'record'}, nodes: {
      at: op('data.get', {record: input('item'), key: 'point'}),
      size: op('random', {}),
      shape: op('data.record', {kind: 'ball', at: link('at'), r: link('size')})
    }, outputs: {value: link('shape')}}},
    nodes: {scatter: op('proc.scatter', {options: input('options')}),
      bolts: {...op('array.mapById', {items: link('scatter', 'samples')}), group: 'bolt'},
      panels: {...op('array.mapById', {items: input('roles')}), group: 'bolt'},
      sections: op('data.record', {solids: link('bolts')}),
      prefab: op('model.prefab', {model: 'signal', revision: 2, sections: link('sections')})},
    outputs: {value: link('prefab'), roles: link('panels')}});
  function run(extent, roles) {
    return graph.run({seed: 43, inputs: {options: {grid, radius,
      bounds: {min: [-extent, -.7, -.8], max: [extent, .7, .8]}}, roles}}).outputs;
  }
  const roles = [{id: 'face', point: [0, 0, 0]}, {id: 'rim', point: [1, 0, 0], splitFrom: 'border'}];
  const a = run(.5, roles), b = run(.9, roles.slice().reverse());
  for (const [id, shape] of Object.entries(a.value.solids)) assert.deepEqual(b.value.solids[id], shape);
  assert.deepEqual(a.roles, b.roles.slice().reverse());
  assert.equal(a.roles[1].splitFrom, 'border');
  assert.throws(() => run(.5, [roles[0], roles[0]]), /unique part IDs/);
  assert.throws(() => visual(1, [part('face', panel(.2)), part('face', panel(.4))]), /Duplicate procedural part/);
});

test('visual prefab refresh previews stable local overrides and blocks retired and split targets', () => {
  const before = visual(1, [part('face', panel(.3)), part('rim', panel(.5)), part('lug', panel(.1))]);
  const next = visual(2, [part('rim', panel(.7)), part('face', panel(.42)), part('lug', panel(.1))]);
  const split = visual(3, [part('face', panel(.5)), part('rim-left', panel(.2), 'rim'), part('rim-right', panel(.2), 'rim')]);
  const source = {id: 'signal-box', solids: [], prefabLibrary: 'library.json', instances: {north: {prefab: 'signal',
    overrides: [edit('/solids/face/mat', 'ember'), edit('/solids/rim/mat', 'stone'), edit('/solids/lug/mat', 'dark')]}}};
  const editor = studio.createSceneEditor(source, {env: {prefabs: {signal: before}}}), snapshot = editor.serialize();
  const preview = editor.planPrefabRefresh({signal: next});
  assert(preview.ok);
  assert.deepEqual(preview.instances[0].overrides.map(row => row.status), ['preserved', 'preserved', 'preserved']);
  assert.equal(editor.node('prefab:north').revision, 1);
  assert.deepEqual(editor.refreshPrefabs({signal: next}), preview);
  assert.equal(editor.node('prefab:north').revision, 2);
  const solids = K.authoring.scenePrefabs.expand(source, {prefabs: {signal: next}}).spec.solids;
  assert.equal(solids.find(solid => solid.id === 'north.face').mat, 'ember');
  assert.equal(solids.find(solid => solid.id === 'north.face').half[0], .42);
  assert.equal(editor.serialize(), snapshot);
  const report = editor.planPrefabRefresh({signal: split});
  assert.equal(report.ok, false);
  assert.deepEqual(report.instances[0].overrides.map(row => row.status), ['preserved', 'split', 'removed']);
  assert.deepEqual(report.instances[0].overrides[1].descendants, ['rim-left', 'rim-right']);
  const incomplete = visual(3,[part('rim-left',panel(.3),'rim')]);
  assert.equal(P.model.compare(next,incomplete).sections.solids.rim.status, 'conflict');
  assert.throws(() => editor.refreshPrefabs({signal: split}), error => {
    assert.match(error.message, /Split descendants are rim-left, rim-right/);
    assert.deepEqual(error.report, report);
    return true;
  });
  const changedModel = visual(3, [part('face', panel(.4)), part('rim', panel(.7)), part('lug', panel(.1))], 'other');
  assert.throws(() => editor.refreshPrefabs({signal: changedModel}), /identities need review/);
  assert.equal(editor.node('prefab:north').revision, 2);
  assert.equal(editor.serialize(), snapshot);
});

test('world release keeps generated entity IDs and uses the existing explicit repair for splits', () => {
  const prefab = (revision, rows) => P.model.prefab({model: 'bridge', revision, kind: 'world', sections: {entities: rows}});
  const panel = (y, material = 'metal') => ({position: [0, y, 0], visual: {material, size: y}});
  const before = prefab(1, [part('deck', panel(1)), part('rail', panel(2))]);
  const next = prefab(2, [part('rail', panel(3)), part('deck', panel(2)), part('cap', panel(4))]);
  const world = W.stamp(W.manifest({prefabs: {bridge: before}}), 'bridge', 'west', {
    overrides: [edit('/entities/west.deck/visual/material', 'red'), edit('/entities/west.rail/visual/material', 'gold')]
  }).world;
  const updated = W.syncPrefab([{world}], {id: 'bridge', definition: next});
  assert(updated.report.ok, JSON.stringify(updated.report));
  const current = updated.scenes[0].world;
  assert.equal(updated.report.scenes[0].instances[0].generation.sections.entities.deck.status, 'retained');
  assert.deepEqual(current.entities['west.deck'].visual, {material: 'red', size: 2});
  const definition = prefab(3, [part('deck', panel(3)), part('cap', panel(4)),
    part('rail-left', panel(3), 'rail'), part('rail-right', panel(3), 'rail')]);
  const blocked = W.syncPrefab([{world: current}], {id: 'bridge', definition});
  assert(!blocked.report.ok && !blocked.scenes);
  const issue = blocked.report.scenes[0].instances[0].issues.find(row => row.kind === 'override');
  assert.deepEqual(issue.descendants, ['rail-left', 'rail-right']);
  const result = W.syncPrefab([{world: current}], {id: 'bridge', definition, migration: {
    overridePaths: {'/entities/rail/visual/material': '/entities/rail-left/visual/material'}
  }});
  assert(result.report.ok, JSON.stringify(result.report));
  const renamed = result.scenes[0].world.entities;
  assert.equal(renamed['west.rail'], undefined);
  assert.equal(renamed['west.rail-left'].visual.material, 'gold');
  assert.equal(renamed['west.rail-right'].visual.material, 'metal');
});
