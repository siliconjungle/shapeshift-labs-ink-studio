const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const { KIT: { procedural: { terrainSet: T } } } = require('..').load();

const point = (id, x, z) => ({ id, at: [x, z] });
const proto = (id, alt = false) => ({ id, variants: [{ id: 'plain',
  lods: [{ distance: 0, asset: id + '-full' }, { distance: 3, asset: id + '-far' }] },
  ...(alt ? [{ id: 'tall', weight: 2, lods: [{ distance: 0, asset: id + '-tall' }, { distance: 3, asset: id + '-far' }] }] : [])] });

function fixture() {
  const tileCells = 6, cell = .5, origin = [-4, -2], size = [3, 1];
  const tiles = Array.from({ length: 3 }, (_, i) => ({ at: [i, 0],
    heights: Array.from({ length: 49 }, (_, n) => (18 - i * 6 - n % 7) * .12 + .13 * Math.floor(n / 7) + i * .03) }));
  return { format: T.format, version: 1, id: 'fen', grid: { origin, cell, tileCells, size }, tiles,
    erosion: { strength: 1, maxDepth: .2, protect: 'keep' },
    masks: [
      { id: 'keep', source: 'paint', strokes: [{ id: 'keep-1', points: [[0, -1]], width: 1.1, softness: .1 }] },
      { id: 'river-edge', source: 'route', route: 'stream', range: [.2, 1], feather: .45 }
    ],
    biomes: { fallback: 'heath', regions: [{ id: 'riverbank', mask: 'river-edge' }] },
    routes: [
      { id: 'stream', kind: 'river', width: .7, depth: .35, grade: .01,
        points: [point('head', -4, .65), point('knee', .5, .5), point('out', 5, .6)] },
      { id: 'track', kind: 'road', width: .42,
        points: [point('west', -3.8, -1.5), point('rise', .3, -1.2), point('east', 4.7, -1.3)] },
      { id: 'huts', kind: 'buildings', width: .42, prototypeId: 'hut', spacing: 1.3, setback: .18, side: 'right',
        points: [point('west', -3.8, -1.5), point('rise', .3, -1.2), point('east', 4.7, -1.3)] }
    ],
    prototypes: [proto('pine', true), proto('stone'), proto('hut')],
    scatter: [{ id: 'grove', prototypeId: 'pine', density: .69, clearance: .06, options: { spacing: .61, slots: 2 } }] };
}
const allInstances = bake => new Map(bake.tiles.flatMap(tile => tile.instances).map(row => [row.id, row]));

test('stitch reconciles shared vertices, normals and route fragments before global erosion', () => {
  const recipe = fixture(), compiled = T.bake(recipe);
  assert(compiled.report.shared.maxDelta > .029);
  assert.equal(compiled.report.shared.sharedVertices, 14);
  assert(compiled.report.erosion.erodedVertices > 0);
  assert(compiled.report.erosion.maxDepth <= .2 + 1e-10);
  const [a, b] = compiled.tiles, ma = T.mesh(a), mb = T.mesh(b);
  for (let i = 0; i < 7; i++) {
    const j = i * 7, k = j + 6;
    assert.deepEqual(ma.points[k], mb.points[j]);
    assert.deepEqual(ma.normals.slice(k * 3, k * 3 + 3), mb.normals.slice(j * 3, j * 3 + 3));
    assert.equal(a.masks['river-edge'][k], b.masks['river-edge'][j]);
  }
  const riverA = a.routes.find(row => row.id === 'stream'), riverB = b.routes.find(row => row.id === 'stream');
  assert.equal(riverA.span, riverB.span);
  assert.equal(riverA.t[1], riverB.t[0]);
  assert.deepEqual(riverA.points[1], riverB.points[0]);
  const water = compiled.report.routes.find(row => row.kind === 'river').points.map(row => row.at[1]);
  assert(water[0] > water[1] && water[1] > water[2]);
  assert(compiled.tiles.some(tile => tile.biomes.includes('riverbank')));
  const noErosion = T.bake({ ...recipe, erosion: null });
  const unprotected = T.bake({ ...recipe, erosion: { strength: 1, maxDepth: .2 } });
  let protectedCuts = 0;
  for (const [tileNo, tile] of compiled.tiles.entries()) for (const [i, weight] of tile.masks.keep.entries()) {
    if (weight < .5) continue;
    assert.equal(tile.heights[i], noErosion.tiles[tileNo].heights[i]);
    if (unprotected.tiles[tileNo].heights[i] < tile.heights[i]) protectedCuts++;
  }
  assert(protectedCuts > 0);
  assert.throws(() => T.bake({ ...recipe, stitch: { mode: 'strict' } }), /stitch exceeds tolerance/);
});

test('route edits keep span addresses away from the edited control and frontage stations follow their route', () => {
  const recipe = fixture(), prior = T.bake(recipe);
  const revision = T.inspect(recipe).revision;
  const { document, report } = T.edit(recipe, { revision, operations: [
    { op: 'move-point', route: 'track', point: 'west', at: [-3.8, -1.8] },
    { op: 'move-point', route: 'huts', point: 'west', at: [-3.8, -1.8] }
  ] });
  const changed = T.bake(document);
  const house = id => [...allInstances(id).values()].find(row => row.id === 'frontage/huts/west:rise/0/right');
  assert.notDeepEqual(house(changed).point, house(prior).point);
  assert(house(prior).point[2] > -1.45);
  assert.deepEqual(changed.tiles[2], prior.tiles[2]);
  assert.equal(report.outputRevision, changed.revision);
  assert.throws(() => T.edit(document, { revision, operations: report.operations }), /this revision/);
});

test('scatter replacements keep placement and touch only the owning tile while distance changes the selected asset', () => {
  const recipe = fixture(), before = T.bake(recipe);
  const candidate = before.tiles[0].instances.find(row => row.group === 'grove');
  assert(candidate);
  const { document } = T.edit(recipe, { operations: [{ op: 'set-replacement', id: candidate.id, prototypeId: 'stone' }] });
  const after = T.bake(document);
  const records = allInstances(after), replacement = records.get(candidate.id);
  assert.equal(replacement.prototypeId, 'stone');
  assert.equal(replacement.yaw, candidate.yaw);
  assert.equal(replacement.scale, candidate.scale);
  assert.deepEqual(replacement.point, candidate.point);
  assert.deepEqual(after.tiles.slice(1), before.tiles.slice(1));
  assert.equal(after.report.populations.replacements, 1);
  assert.equal(T.lod(replacement, [replacement.point[0], replacement.point[2]]).asset, 'stone-full');
  assert.equal(T.lod(replacement, [replacement.point[0] + 4, replacement.point[2]]).asset, 'stone-far');
  const larger = T.bake({ ...recipe, scatter: [{ ...recipe.scatter[0], density: .95 }] });
  const expanded = allInstances(larger);
  for (const [id, row] of allInstances(before)) assert.deepEqual(expanded.get(id), row);
});

test('headless streaming verifies only resident chunks, reuses overlap and reports budget deferral', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-terrain-set-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = name => path.join(directory, name);
  const save = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => execFileSync(process.execPath, [cli, 'terrain-set', ...args], { encoding: 'utf8' });
  save('recipe.json', fixture());
  run('bake', file('recipe.json'), '--out', file('pack'));
  const manifest = JSON.parse(fs.readFileSync(file('pack/manifest.json'), 'utf8'));
  const views = [{ id: 'west', at: [-2, -1] }, { id: 'east', at: [3, -1] }];
  save('views.json', { budgetBytes: 1000000, views });
  const report = JSON.parse(run('stream', file('pack/manifest.json'), file('views.json')));
  assert.deepEqual(report.views[0].loaded, [[0, 0], [1, 0]]);
  assert.deepEqual(report.views[1].loaded, [[2, 0]]);
  assert.deepEqual(report.views[1].retained, [[1, 0]]);
  assert.deepEqual(report.views[1].evicted, [[0, 0]]);
  const third = file('pack/' + manifest.tiles[2].file), prior = fs.readFileSync(third);
  const damaged = Buffer.from(prior);
  damaged[10] ^= 1;
  fs.writeFileSync(third, damaged);
  save('views.json', { budgetBytes: manifest.tiles[0].bytes, views: [views[0]] });
  const tight = JSON.parse(run('stream', file('pack/manifest.json'), file('views.json')));
  assert.deepEqual(tight.views[0].loaded, [[0, 0]]);
  assert.deepEqual(tight.views[0].deferred, [[1, 0]]);
  save('views.json', { budgetBytes: 1000000, views: [views[1]] });
  const error = spawnSync(process.execPath, [cli, 'terrain-set', 'stream', file('pack/manifest.json'), file('views.json')],
    { encoding: 'utf8' });
  assert.notEqual(error.status, 0);
  assert.match(error.stderr, /digest mismatch/);
});
