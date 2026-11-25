'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const topology = ink.load().KIT.meshTopology;

const ring = [[0,0,0],[2,0,0],[2,1,0],[0,1,0]];
const shift = (points, offset) => points.map(point => point.map((value, axis) => value + offset[axis]));
const rotate = (points, start) => [...points.slice(start), ...points.slice(0, start)];

function mesh(panels) {
  const vertices = [], faces = [];
  for (const [id, points, material] of panels) {
    const corners = points.map((position, i) => {
      const vertex = id + '/v' + i;
      vertices.push({ id: vertex, position });
      return { id: id + '/c' + i, vertex, uv: [0, 0] };
    });
    faces.push({ id, corners, material });
  }
  return topology.create({ id: 'panels', vertices, faces });
}

test('review groups fully coincident boundaries and keeps the lowest stable face ID', () => {
  const panels = [
    ['z-copy', rotate(ring, 1), 'green'],
    ['b-split', [ring[0], [1,0,0], ring[1], ring[2], ring[3]], 'yellow'],
    ['a-keeper', ring, 'blue'],
    ['opposite', [...ring].reverse()],
    ['offset', shift(ring, [0,0,1e-6])],
    ['partial', shift(ring, [1,0,0])],
    ['adjacent', shift(ring, [2,0,0])],
    ['same-box', [ring[0], ring[1], [1, .5, 0], ring[2], ring[3]]]
  ];
  const doc = mesh(panels), before = JSON.stringify(doc);
  const review = topology.reviewOverlaps(doc, { tolerance: 0 });
  assert.deepEqual(review.groups, [{
    survivor: { id: 'a-keeper', material: 'blue' },
    duplicates: [{ id: 'b-split', material: 'yellow', distance: 0 }, { id: 'z-copy', material: 'green', distance: 0 }]
  }]);
  assert.deepEqual(review.counts, { faces: 8, groups: 1, duplicates: 2 });
  assert.deepEqual(review.selection.ids, ['b-split', 'z-copy']);
  assert.equal(review.selection.revision, topology.revision(doc));
  assert.equal(topology.select(doc, { from: review.selection, convert: 'edges' }).ids.length, 9);
  assert.equal(review.complete, true);
  assert.equal(review.truncated, false);
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(topology.reviewOverlaps(mesh([...panels].reverse()), { tolerance: 0 }).groups, review.groups);
});

test('tolerance matches each duplicate to its own survivor and keeps scoped work bounded', () => {
  const doc = mesh([
    ['a', ring], ['b', shift(ring, [0,0,.00075])], ['c', shift(ring, [0,0,.0015])],
    ['d', shift(ring, [0,0,.0015])], ['e', shift(ring, [0,0,.0015])]
  ]);
  const review = topology.reviewOverlaps(doc, { tolerance: .001 });
  assert.deepEqual(review.groups.map(group => group.survivor.id), ['a', 'c']);
  assert.deepEqual(review.selection.ids, ['b', 'd', 'e']);
  assert.equal(review.groups[0].duplicates[0].distance, .00075);
  const scoped = topology.reviewOverlaps(doc, { tolerance: .001,
    selection: topology.select(doc, { domain: 'faces', ids: ['b', 'd'] }) });
  assert.equal(scoped.groups[0].survivor.id, 'b');
  assert.deepEqual(scoped.selection.ids, ['d']);
  const limited = topology.reviewOverlaps(doc, { tolerance: .001, limit: 1 });
  assert.equal(limited.complete, true);
  assert.equal(limited.truncated, true);
  assert.deepEqual(limited.selection.ids, ['b']);
  assert.deepEqual(limited.counts, review.counts);
  const budget = topology.reviewOverlaps(doc, { tolerance: .001, maxPairs: 1 });
  assert.equal(budget.complete, false);
  assert.equal(budget.comparisons, 1);
  assert.throws(() => topology.reviewOverlaps(mesh([['a', ring]]), { selection: scoped.selection }), /same topology revision/);
  for (const settings of [{ tolerance: -1 }, { maxPairs: 0 }, { limit: 1.5 }])
    assert.throws(() => topology.reviewOverlaps(doc, settings), /tolerance and positive integer/);
});

test('warped polygon matches need coincident rendered surfaces as well as boundaries', () => {
  const warped = [ring[0], ring[1], [2,1,.25], ring[3]];
  const doc = mesh([['a', warped], ['b', warped], ['c', rotate(warped, 1)]]);
  const review = topology.reviewOverlaps(doc);
  assert.deepEqual(review.selection.ids, ['b']);
});

test('CLI and scene SDK export a compatible, read-only review for a retained part', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-overlap-review-'));
  t.after(() => fs.rmSync(cwd, { force: true, recursive: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const doc = mesh([['a', ring], ['b', ring]]);
  const scene = { id: 'awning', solids: [], topologyMeshes: { roof: { part: 'panels', document: doc } } };
  const write = (name, value) => fs.writeFileSync(path.join(cwd, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(cwd, name), 'utf8'));
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'mesh-topology', ...args], { cwd, encoding: 'utf8' }));
  write('scene.json', scene);
  write('mesh.json', doc);
  write('edges.json', { convert: 'edges' });
  const native = run('overlaps', 'mesh.json', '--out', 'review.json');
  const review = run('overlaps', 'scene.json', '--object', 'roof', '--part', 'panels', '--selection-out', 'duplicates.json');
  const editor = ink.createSceneEditor(scene);
  assert.deepEqual(native, editor.reviewMeshOverlaps('roof', undefined, { part: 'panels' }));
  assert.deepEqual(read('review.json'), native);
  assert.deepEqual(read('duplicates.json'), native.selection);
  assert.deepEqual(review, { ...native, object: 'roof', part: 'panels' });
  assert.equal(run('select', 'scene.json', 'edges.json', '--object', 'roof', '--from', 'duplicates.json').ids.length, 4);
  const reject = (...args) => spawnSync(process.execPath, [cli, 'mesh-topology', 'overlaps', ...args], { cwd, encoding: 'utf8' });
  for (const args of [
    ['scene.json'], ['scene.json', '--object', 'roof', '--part', 'missing'],
    ['mesh.json', '--out', 'mesh.json'], ['mesh.json', '--selection-out', 'review.json']
  ]) assert.notEqual(reject(...args).status, 0);
  assert.deepEqual(read('scene.json'), scene);
  assert.deepEqual(read('mesh.json'), doc);
});
