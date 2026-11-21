const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');

const { pixelEffects: fx, raster: R } = ink.load().KIT.procedural;
const spec = (nodes, outputs) => ({ format: 'ink-studio/graph-project', version: 1, nodes, outputs });
const node = (op, inputs = {}) => ({ op, inputs });
const link = (node, port = 'value') => ({ node, port });

test('kernel and path tiles match whole-raster filters across seams and image edges', () => {
  const width = 29, height = 23;
  const source = { width, height, channels: 2, pivot: [3.25, 6], data: Float64Array.from(
    { length: width * height * 2 }, (_, i) => ((i * 47) % 261) + .49) };
  const route = [[-2.7, 1], [6.3, -3.9], [1.4, 8.2]];
  for (const edge of ['clamp', 'wrap', 'transparent']) {
    for (const options of [{ radius: 7 }, { radius: 3, kind: 'box' }, { kernel: [[0, 2, 0], [0, 4, 8], [1, 0, 0]] }]) {
      assert.deepEqual(fx.kernelBlur(source, { ...options, edge, tileSize: [3, 5] }),
        fx.kernelBlur(source, { ...options, edge, tileSize: false }));
    }
    for (const options of [{ anchor: 'center', filter: 'linear' }, { anchor: 'end', filter: 'nearest', falloff: 'end' }]) {
      assert.deepEqual(fx.pathBlur(source, route, { ...options, edge, tileSize: [4, 7] }),
        fx.pathBlur(source, route, { ...options, edge, tileSize: false }));
    }
  }
});

test('very long path offsets gather taps without allocating the full halo', () => {
  const source = R.canvas({ width: 53, height: 21, color: [235, 91, 45, 161] });
  const route = [[0, 0], [400000.3, -200000.4]];
  for (const edge of ['wrap', 'transparent']) {
    const options = { edge, samples: 6, tileSize: 8 };
    const plan = fx.planPathBlur(source, route, options);
    assert.equal(plan.strategy, 'gather');
    assert.ok(plan.halo.left >= 400000);
    assert.ok(plan.scratchBytes < 128);
    assert.deepEqual(fx.pathBlur(source, route, options), fx.pathBlur(source, route, { ...options, tileSize: false }));
  }
});

test('automatic tiling handles rasters beyond the whole-raster size limit', () => {
  const width = 2050, height = 1954, color = [165, 90, 53, 201];
  const source = R.canvas({ width, height, color });
  const options = { kernel: [[1]] };
  const plan = fx.planKernelBlur(source, options);
  assert.deepEqual(plan.tileSize, [256, 256]);
  assert.ok(plan.tiles > 1);
  assert.ok(plan.scratchBytes < 1100000);
  assert.throws(() => fx.planKernelBlur(source, { ...options, tileSize: false }), /need tiling/);
  const { data } = fx.kernelBlur(source, options);
  assert.equal(data.byteLength, plan.resultBytes);
  assert.deepEqual([...data.slice(-4)], color);
});

test('graph preflight follows group outputs, atlas planes and trim bounds', () => {
  const width = 260, height = 184;
  const project = (tileSize, trim) => {
    const graph = spec({
      shot: node('Shot'),
      maps: node('data.record', { normal: link('shot', 'source') }),
      sprite: node('data.record', { source: link('shot', 'filtered'), maps: link('maps') }),
      records: node('data.record', { sprite: link('sprite') }),
      sprites: node('data.collect', { source: link('records'), keys: ['sprite'] }),
      atlas: node('raster.pack', { sprites: link('sprites'), options: { maxWidth: 512, maxHeight: 384, trim } })
    }, { atlas: link('atlas') });
    graph.groups = { Shot: { nodes: {
      source: node('raster.canvas', { width, height, color: [80, 120, 160] }),
      filter: node('fx.kernelBlur', { source: link('source'), options: { radius: 5, tileSize } })
    }, outputs: { filtered: link('filter'), source: link('source') } } };
    return ink.createGraphProject(graph);
  };
  const tiled = project([64, 48], false);
  const memory = tiled.plan(undefined, { memory: true }).memory;
  assert.equal(memory.complete, true);
  assert.equal(memory.upperBound, false);
  assert.deepEqual(memory.nodes.map(row => row.node), ['shot/source', 'shot/filter', 'atlas']);
  const atlas = memory.nodes.at(-1);
  assert.deepEqual(atlas.detail.planes, ['color', 'normal']);
  assert.equal(atlas.resultBytes, (width + 2) * (height + 2) * 8);
  const whole = project(false, false);
  assert(memory.peakBytes < whole.plan(undefined, { memory: true }).memory.peakBytes);
  assert.deepEqual(tiled.run().outputs, whole.run().outputs);
  const bounded = project(64, true).plan(undefined, { memory: true }).memory;
  assert.equal(bounded.upperBound, true);
  assert.equal(bounded.nodes.at(-1).resultBytes, 512 * 384 * 8);
});

test('preflight reports unknown node costs without executing host operations', () => {
  const project = ink.createGraphProject(spec({
    image: node('raster.canvas', { width: 16, height: 8 }), host: node('custom', { value: link('image') })
  }, { output: link('host') }), { operations: {
    custom: { inputs: { value: 'raster' }, outputs: { value: 'raster' },
      run() { throw new Error('preflight executed the host'); } }
  } });
  const memory = project.plan(undefined, { memory: true }).memory;
  assert.equal(memory.complete, false);
  assert.equal(memory.peakBytes, null);
  assert.equal(memory.knownPeakBytes, 16 * 8 * 4);
  assert.equal(memory.unresolved[0].node, 'host');
});

test('CLI memory preflight reads PNG dimensions without inflating pixels', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-graph-memory-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const image = Buffer.from(PNG.encode(9, 7, new Uint8Array(9 * 7 * 4), 4));
  image[image.indexOf('IDAT') + 4] = 0;
  fs.writeFileSync(path.join(folder, 'input.png'), image);
  const graph = spec({
    source: node('pngAsset', { name: 'image' }),
    blur: node('fx.kernelBlur', { source: link('source'), options: { tileSize: [4, 3] } })
  }, { blur: link('blur') });
  graph.assets = { image: { format: 'png', file: 'input.png' } };
  const file = path.join(folder, 'project.json');
  fs.writeFileSync(file, JSON.stringify(graph));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const planned = spawnSync(process.execPath, [cli, 'graph', 'plan', file, '--memory', '--json'], { encoding: 'utf8' });
  assert.equal(planned.status, 0, planned.stderr);
  const memory = JSON.parse(planned.stdout).memory;
  assert.equal(memory.complete, true);
  assert.equal(memory.initialBytes, 9 * 7 * 4);
  assert.equal(memory.nodes[0].detail.tiles, 9);
  const run = spawnSync(process.execPath, [cli, 'graph', 'run', file], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /header check|compression method|PNG IDAT/i);
});
