const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { KIT: K } = require('..').load();
const V = K.procedural.sparseVolume;

const grid = { origin: [-1, 2, -.5], spacing: [.5, 2, 1], size: [5, 3, 2] };
const values = { density: 4, temperature: 20, velocity: [3, -6, 9], signedDistance: -.5 };
const fields = { density: { units: 'density' }, temperature: { background: 8 }, velocity: { units: 'world/s' },
  signedDistance: { background: 1.5 } };
const bg = { density: 0, temperature: 8, velocity: [0, 0, 0], signedDistance: 1.5 };
const sampleIndex = [2, 1, 0];
const site = sampleIndex.map((n, i) => grid.origin[i] + (n + .5) * grid.spacing[i]);
function fixture() {
  return V.bake({ grid, brickSize: 2, fields }, (name, _, slot) => slot === 7 ? values[name] : bg[name]).document;
}
function shell({ fields = { density: {} }, size = [5, 3, 2], bricks = [] } = {}) {
  return { format: V.format, version: 1, grid: { ...grid, size }, brickSize: 2, fields, bricks };
}
const run = (start, ...values) => ({ start, values });
const brick = (at, fields) => ({ at, fields });

test('portable bricks keep anisotropic world centers, vector axes and background across seams', () => {
  const doc = V.create(JSON.parse(JSON.stringify(fixture()))), read = V.sampler(doc);
  assert.deepEqual(doc.bricks.map(row => row.at), [[1, 0, 0]]);
  assert.deepEqual(doc.bricks[0].fields.velocity, [run(2, 3, -6, 9)]);
  for (const [name, value] of Object.entries(values)) assert.deepEqual(read.sample(name, site), value);
  for (const name of Object.keys(values)) assert.deepEqual(read.sample(name, [-2, -2, -2]), bg[name]);
  const seam = [site[0] - .25, ...site.slice(1)];
  assert.deepEqual(read.sample('velocity', seam), [1.5, -3, 4.5]);
  assert.equal(read.sample('density', seam), 2);
  assert.equal(V.sampler(doc, { filter: 'nearest' }).sample('density', seam), 4);
  const report = V.inspect(doc);
  assert.equal(report.logicalCells, 30);
  assert.equal(report.storedComponents, 6);
  assert.deepEqual(report.fields.velocity.range, { min: [0, -6, 0], max: [3, 0, 9] });
  assert.deepEqual(report.fields.density.activeIndexBounds, { min: sampleIndex, max: sampleIndex });
  assert.equal(read.density().sample(...site), 4);
  assert.deepEqual(read.density().bounds, { min: [-.25, 1, -1], max: [1.25, 7, 2] });
  assert.deepEqual(read.field('velocity').sample(...site), values.velocity);
});

test('a Float32 density background does not erase a tiny active value at its center', () => {
  const doc = V.create(shell({ fields: { density: { background: 1e38 } },
    bricks: [brick([0, 0, 0], { density: [run(0, 1e-7)] })] }));
  const value = V.sampler(doc).sample('density', [-.75, 3, 0]);
  assert.equal(value, Math.fround(1e-7));
  assert.throws(() => V.sampler(doc).density(), /zero background/);
});

test('reader canonicalizes named runs and rejects malformed, padded and negative density samples', () => {
  const normalized = V.create(shell({ bricks: [
    brick([2, 0, 0], { density: [run(0, 0)] }),
    brick([0, 0, 0], { density: [run(0, 1), run(1, 2, 0, 3)] })
  ] }));
  assert.deepEqual(normalized.bricks, [brick([0, 0, 0], { density: [run(0, 1, 2), run(3, 3)] })]);
  assert.throws(() => V.create(shell({ bricks: [brick([2, 0, 0], { density: [run(1, 1)] })] })), /outside the logical grid/);
  assert.throws(() => V.create(shell({ bricks: [brick([0, 0, 0], { density: [run(0, 1, 2), run(1, 3)] })] })), /overlapping/);
  assert.throws(() => V.create(shell({ bricks: [brick([0, 0, 0], { density: [run(0, -.001)] })] })), /density component/);
  assert.throws(() => V.create(shell({ fields: { signedDistance: { background: 0 } } })), /positive outside/);
  assert.throws(() => V.create(shell({ bricks: [
    brick([0, 0, 0], { density: [run(0, 1)] }), brick([0, 0, 0], { density: [run(1, 2)] })
  ] })), /duplicate brick/);
});

test('combining aligned fields visits sparse sites and composes defaults, units and signed distances', () => {
  const a = fixture();
  const other = V.bake({ grid, brickSize: 2, fields }, (name, _, slot) => slot === 7
    ? { density: 2, temperature: 12, velocity: [0, 2, 6], signedDistance: -.8 }[name] : bg[name]).document;
  const op = { density: 'add', temperature: 'lerp', velocity: 'add', signedDistance: 'subtract' };
  const { document, report } = V.combine(a, other, { operations: op, mix: .25 });
  assert.deepEqual(report.operations, op);
  assert.equal(report.work, 4);
  const read = V.sampler(document);
  assert.equal(read.sample('density', site), 6);
  assert.equal(read.sample('temperature', site), 18);
  assert.deepEqual(read.sample('velocity', site), [3, -4, 15]);
  assert.equal(read.sample('signedDistance', site), Math.fround(.8));
  const s = [100000, 10000, 100], sparse = shell({ size: s, bricks: [brick([0, 0, 0], { density: [run(0, 2)] })] });
  const right = shell({ size: s, bricks: [brick([49999, 4999, 49], { density: [run(0, 5)] })] });
  const joined = V.combine(sparse, right, { maxSamples: 2 });
  assert.equal(V.inspect(joined.document).logicalCells, 100000000000);
  assert.equal(joined.report.work, 2);
  assert.equal(joined.document.bricks.length, 2);
  assert.throws(() => V.combine(sparse, right, { maxSamples: 1 }), /active sample budget/);
  assert.throws(() => V.combine(a, sparse), /shared grid/);
  assert.throws(() => V.combine(a, { ...a, fields: { ...a.fields, density: { units: 'different' } } }), /units differ/);
  const disjoint = V.combine(V.extract(a, ['density']), V.extract(a, ['velocity']));
  assert.deepEqual(disjoint.document, V.extract(a, ['density', 'velocity']));
});

test('regridding and dense exchange round-trip and reject oversized work before sampling', () => {
  const input = fixture();
  assert.deepEqual(V.pack(V.dense(input)).document, input);
  assert.deepEqual(V.resample(input, { grid }).document, input);
  const target = { ...grid, origin: [-1.25, 2, -.5] };
  const { document, report } = V.resample(input, { grid: target, filter: 'linear', brickSize: 3, channels: ['density'] });
  assert.equal(report.cells, 30);
  assert.deepEqual(Object.keys(document.fields), ['density']);
  assert.equal(V.sampler(document).sample('density', [0, 5, 0]), 2);
  assert.equal(V.sampler(document).sample('density', [0.5, 5, 0]), 2);
  assert.throws(() => V.resample(input, { grid: target, maxCells: 29 }), /cell budget/);
  assert.throws(() => V.bake({ grid, fields, maxCells: 1 }, () => assert.fail('oversized bake sampled')), /cell budget/);
  assert.throws(() => V.dense(input, { maxCells: 29 }), /cell budget/);
});

test('CLI exports a slice and indexed isosurface and can repack the dense interchange file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-volume-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = name => path.join(directory, name);
  const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
  const vol = V.bake({ grid: { origin: [-1.5, -1.5, -1.5], spacing: [.25, .25, .25], size: [12, 12, 12] },
    fields: { signedDistance: {}, velocity: {} } }, (name, [x, y, z]) => name === 'signedDistance'
    ? Math.min(1, Math.hypot(x, y, z) - .8) : Math.abs(x) < 1 ? [x, 0, 0] : [0, 0, 0]).document;
  save('volume.json', vol);
  save('mesh-request.json', { kind: 'isosurface', channel: 'signedDistance', resolution: .23, maxCells: 10000 });
  save('slice-request.json', { kind: 'slice', channel: 'velocity', component: 'x', plane: { axis: 'z', at: 0 }, counts: [12, 10] });
  save('dense-request.json', { kind: 'dense' });
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const runCLI = (...args) => execFileSync(process.execPath, [cli, 'volume', ...args], { encoding: 'utf8' });
  const mesh = JSON.parse(runCLI('export', file('volume.json'), file('mesh-request.json'), '--report', file('mesh-receipt.json')));
  assert(mesh.faces.length > 80);
  assert(mesh.faces.length > mesh.points.length);
  for (const point of mesh.points) assert(Math.abs(Math.hypot(...point) - .8) < .09);
  const slice = JSON.parse(runCLI('export', file('volume.json'), file('slice-request.json')));
  assert.equal(slice.values.length, 120);
  assert(slice.range[0] < -.5 && slice.range[1] > .5);
  runCLI('export', file('volume.json'), file('dense-request.json'), '--out', file('dense.json'));
  assert.deepEqual(JSON.parse(runCLI('pack', file('dense.json'))), vol);
  const refused = spawnSync(process.execPath, [cli, 'volume', 'export', file('volume.json'), file('dense-request.json'),
    '--out', file('volume.json')], { encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('volume.json'))), vol);
});
