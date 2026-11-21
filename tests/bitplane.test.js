const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const PNG = require('../cli/png');
const { KIT } = require('..').load();
const { bitplane } = KIT.procedural.pixelEffects;

const palette = ['#181d24', '#53665e', '#9caa87', '#e2dfaf'];
const plane = data => ({ width: data.length, height: 1, channels: 1, data });

test('flip and clear update only one slot bit and keep masks, holes, alpha and pivot intact', () => {
  const source = { ...plane([0, 1, 2, 3, -1, 1]), pivot: [3, 1] };
  const coverage = plane([255, 104, 255, 255, 255, 0]);
  const mask = plane([255, 255, 127, 255, 255, 255]);
  const flipped = bitplane(source, palette, { bit: 1, mask, alpha: coverage });
  assert.deepEqual([...flipped.indices.data], [2, 3, 2, 1, -1, 1]);
  assert.deepEqual([...flipped.value.data], [
    156, 170, 135, 255, 226, 223, 175, 104, 156, 170, 135, 255,
    83, 102, 94, 255, 0, 0, 0, 0, 83, 102, 94, 0
  ]);
  assert.deepEqual(flipped.indices.pivot, source.pivot);
  assert.deepEqual(flipped.value.pivot, source.pivot);
  assert.deepEqual(source.data, [0, 1, 2, 3, -1, 1]);
  const cleared = bitplane(source, palette, { bit: 1, mode: 'clear' });
  assert.deepEqual([...cleared.indices.data], [0, 1, 0, 1, -1, 1]);
});

test('borrow moves a bank bit between planes and holds the original index for absent or unlisted slots', () => {
  const source = plane([0, 1, 2, 0, -1]);
  const bank = plane([128, 128, 0, -1, 128]);
  const result = bitplane(source, { palette: palette.slice(0, 3) },
    { bit: 1, mode: 'borrow', bank, bankBit: 7 });
  assert.deepEqual([...result.indices.data], [2, 1, 0, 0, -1]);
  assert.deepEqual(bank.data, [128, 128, 0, -1, 128]);
  assert.throws(() => bitplane(source, palette, { mode: 'borrow' }), /donor bank/);
  assert.throws(() => bitplane(source, palette, { mode: 'borrow', bank: plane([0]) }), /source grid/);
  assert.throws(() => bitplane(plane([.5]), palette), /invalid sample/);
  assert.throws(() => bitplane(source, palette, { bit: 8 }), /settings/);
});

test('the stock node accepts palettes and indices directly from palette resolution', () => {
  const { graph } = KIT.procedural;
  const session = graph.create({
    inputs: { image: 'raster' },
    nodes: {
      indexed: { op: 'palette.resolve', inputs: { source: { input: 'image' }, policy: { value: { palette } },
        options: { value: { method: 'solid' } } } },
      corrupt: { op: 'fx.bitplane', inputs: { source: { node: 'indexed', port: 'indices' },
        palette: { node: 'indexed', port: 'palette' }, options: { value: { bit: 1 } } } }
    },
    outputs: { value: { node: 'corrupt' }, indices: { node: 'corrupt', port: 'indices' } }
  });
  const image = { width: 2, height: 1, channels: 4, data: Uint8Array.of(24, 29, 36, 255, 83, 102, 94, 255) };
  const { outputs } = session.evaluate({ image });
  assert.deepEqual([...outputs.indices.data], [2, 3]);
  assert.deepEqual([...outputs.value.data], [156, 170, 135, 255, 226, 223, 175, 255]);
});

test('CLI graph preserves original indexed PNG slots even when two slots have the same color', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-bitplane-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'source.png');
  PNG.writeIndexed(file, 5, 1, [0, 1, 2, 3, null], [[0, 0, 0], [0, 0, 0], [170, 90, 10], [240, 220, 170]]);
  const indexed = PNG.indexedRaster(file);
  assert.deepEqual([...indexed.value.data], [0, 1, 2, 3, 4]);
  assert.deepEqual([...indexed.alpha.data], [255, 255, 255, 255, 0]);
  assert.throws(() => PNG.indexedRaster(PNG.encode(1, 1, Uint8Array.of(2, 3, 4))), /palette-indexed PNG/);
  const project = path.join(dir, 'bitplane.json');
  fs.writeFileSync(project, JSON.stringify({
    format: 'ink-studio/graph-project', version: 1,
    assets: { image: { format: 'indexed-png', file: 'source.png' } },
    nodes: {
      source: { op: 'indexedPngAsset', inputs: { name: 'image' } },
      options: { op: 'data.record', inputs: { bit: 1, alpha: { node: 'source', port: 'alpha' } } },
      effect: { op: 'fx.bitplane', inputs: { source: { node: 'source' }, palette: { node: 'source', port: 'palette' },
        options: { node: 'options' } } }
    },
    outputs: { value: { node: 'effect' }, indices: { node: 'effect', port: 'indices' } },
    exports: { image: { output: 'value', format: 'png' }, slots: { output: 'indices', format: 'json' } }
  }));
  const command = spawnSync(process.execPath, [path.resolve(__dirname, '../cli/ink-studio.js'), 'graph', 'run',
    project, '--out', dir], { encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  const indices = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts', 'slots.json'), 'utf8'));
  assert.deepEqual(indices.data, [2, 3, 0, 1, 4]);
  const { data } = PNG.raster(path.join(dir, 'artifacts', 'image.png'));
  assert.deepEqual([...data], [170, 90, 10, 255, 240, 220, 170, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0]);
});
