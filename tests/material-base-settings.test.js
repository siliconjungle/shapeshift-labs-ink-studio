const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Ink = require('..');
const PNG = require('../cli/png.js');

const link = (node, port = 'value') => ({ node, port });
const op = (op, inputs) => ({ op, inputs });
const settings = { size: { width: 8, height: 4 }, pixelSizeMm: .5, pixelRatio: [3, 2],
  tiling: { u: 'wrap', v: 'mirror' }, seed: 13, output: { format: 'png', bitDepth: 16 } };
const baseLink = { input: 'materialBase' };

function fixture(base = settings) {
  return {
    format: 'ink-studio/graph-project', version: 1, base, seed: 17,
    groups: {
      Measure: {
        inputs: { shared: 'record' },
        nodes: { info: op('material.base', { settings: { input: 'shared' } }) },
        outputs: { width: link('info', 'width'), height: link('info', 'height'), seed: link('info', 'seed') }
      }
    },
    nodes: {
      measures: op('Measure', { shared: baseLink }),
      color: op('raster.canvas', { width: link('measures', 'width'), height: link('measures', 'height'), color: [28, 85, 190, 212] }),
      typed: op('image.declare', { source: link('color'), descriptor: { intent: 'color' } }),
      framed: op('material.imageOutput', { source: link('typed'), settings: baseLink }),
      noise: { op: 'random' }
    },
    outputs: { color: link('framed'), random: link('noise'), seed: link('measures', 'seed') },
    exports: { image: { output: 'color', format: 'material-image' } }
  };
}

function pngDensity(png) {
  let position = 8;
  while (position < png.length) {
    const length = png.readUInt32BE(position), begin = position + 8;
    if (png.toString('ascii', position + 4, begin) === 'pHYs')
      return [png.readUInt32BE(begin), png.readUInt32BE(begin + 4), png[begin + 8]];
    position = begin + length + 4;
  }
}

test('shared settings resolve dimensions, physical pitch, independent edges, and a width-driven lock', () => {
  const resolve = Ink.resolveMaterialBaseSettings;
  assert.deepEqual(resolve(settings), { ...settings, size: { ...settings.size, lock: false } });
  assert.deepEqual(resolve({ ...settings, size: { ...settings.size, lock: true } }).size, { width: 8, height: 8, lock: true });
  assert.deepEqual(resolve({}).output, { format: 'png', bitDepth: 8 });
  assert.throws(() => resolve({ size: { width: 8192, height: 32, lock: true } }), /size exceeds/);
  assert.throws(() => resolve({ output: { format: 'json', bitDepth: 8 } }), /needs PNG/);
  assert.throws(() => resolve({ pixelSizeMm: 1e-12 }), /density range/);
  assert.throws(() => resolve({ pixelRatio: [0, 1] }), /X:Y pixel ratio/);
  assert.throws(() => resolve({ tiling: { u: 'bogus' } }), /tiling/);
  assert.throws(() => resolve({ seed: 2.2 }), /safe integer/);
});

test('editable graphs drive ports, seed, PNG precision and physical metadata from a single settings record', () => {
  const uploaded = Ink.openMaterialGraph(fixture(), { id: 'cedar-inlay' });
  const runner = Ink.createGraphProject(uploaded);
  const renders = [runner.run(), runner.run(), runner.run({ seed: 41 })];
  const { outputs, report, artifacts } = renders[0];
  assert.equal(outputs.seed, 13);
  assert.equal(report.seed, 13);
  assert.equal(renders[2].outputs.seed, 41);
  assert.equal(renders[2].report.base.seed, 41);
  assert.equal(runner.snapshot({ seed: 41 }).settings.base.seed, 41);
  assert.equal(outputs.random, renders[1].outputs.random);
  assert.notEqual(outputs.random, renders[2].outputs.random);
  assert.equal(artifacts[0].sha256, renders[1].artifacts[0].sha256);
  assert.deepEqual(outputs.color.descriptor.pixelPitchMm, [.5, 1/3]);
  assert.deepEqual(outputs.color.descriptor.tiling, settings.tiling);
  assert.deepEqual(runner.plan().physicalSizeMm, [4, 4/3]);
  assert.throws(() => runner.run({ inputs: { materialBase: settings } }), /Change shared material settings/);
  const bytes = artifacts[0].bytes;
  assert.equal(bytes[24], 16);
  assert.deepEqual(pngDensity(bytes), [2000, 3000, 1]);
  const { w, h, data } = PNG.raster(bytes);
  assert.deepEqual([w, h], [8, 4]);
  assert.deepEqual([...data.slice(0, 4)], [28*257, 85*257, 190*257, 212*257]);
});

test('material delivery resizes typed outputs with the configured per-axis filter and retains floating values in JSON', () => {
  const raster = { width: 2, height: 1, channels: 1, data: [0, .6187] };
  const make = (u, output) => ({
    format: 'ink-studio/graph-project', version: 1,
    base: { ...settings, size: { width: 4, height: 1 }, tiling: { u, v: 'clamp' }, output },
    nodes: { source: op('image.declare', { source: raster, descriptor: { intent: 'mask', sampling: 'linear' } }) },
    outputs: { texture: link('source') },
    exports: { mask: { output: 'texture', format: 'material-image' } }
  });
  const encode = (u, output) => Ink.createGraphProject(make(u, output)).run().artifacts[0];
  const json = JSON.parse(encode('wrap', { format: 'json' }).bytes);
  assert.deepEqual(json.raster.data, [.6187*.25, .6187*.25, .6187*.75, .6187*.75]);
  assert.equal(json.raster.width, 4);
  assert.equal(json.descriptor.tiling.u, 'wrap');
  assert.deepEqual(json.descriptor.pixelPitchMm, [.5, 1/3]);
  const png = encode('clamp', { bitDepth: 16 }).bytes;
  assert.equal(png[25], 0);
  assert.deepEqual([...PNG.raster(png).data].filter((_, i) => i%4===0),
    [0, .6187*.25, .6187*.75, .6187].map(n => Math.round(n*65535)));
  assert.equal(encode('clamp', { bitDepth: 8 }).bytes[24], 8);
});

test('CLI saves shared settings, reopens them with axis lock, and leaves the saved independent axis available', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-base-settings-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const at = file => path.join(folder, file);
  const material = Ink.openMaterialGraph(fixture());
  Ink.writeMaterialGraph(at('before.json'), material);
  const locked = { ...settings, size: { width: 11, height: 5, lock: true }, output: { format: 'json' } };
  fs.writeFileSync(at('base.json'), JSON.stringify(locked));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const result = execFileSync(process.execPath, [cli, 'graph', 'material', at('before.json'),
    '--base', at('base.json'), '--out', at('locked.json')], { cwd: folder, encoding: 'utf8' });
  assert.equal(JSON.parse(result).id, material.id);
  const reopened = Ink.readMaterialGraph(at('locked.json'));
  assert.deepEqual(reopened.settings.base, locked);
  const image = JSON.parse(Ink.readGraphProject(at('locked.json')).run().artifacts[0].bytes);
  assert.deepEqual([image.raster.width, image.raster.height], [11, 11]);
  reopened.settings.base.size.lock = false;
  Ink.writeMaterialGraph(at('unlocked.json'), reopened);
  const { color } = Ink.readGraphProject(at('unlocked.json')).run().outputs;
  assert.deepEqual([color.raster.width, color.raster.height], [11, 5]);
  assert.equal(Ink.readMaterialGraph(at('before.json')).settings.base.size.width, 8);
});
