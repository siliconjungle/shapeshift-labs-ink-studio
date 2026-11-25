const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ink = require('..');
const PNG = require('../cli/png.js');
const kit = Ink.load();
const I = kit.KIT.procedural.graphImages;
const raster = (width, height, channels, data) => ({ width, height, channels, data });
const link = (node, port = 'value') => ({ node, port });
const op = (op, inputs) => ({ op, inputs });
const project = (nodes, outputs) => ({ format: 'ink-studio/graph-project', version: 1, nodes, outputs });
const compile = spec => Ink.createGraphProject(spec, { kit });
const typed = (source, descriptor) => op('image.declare', { source, descriptor });
const gray = raster(2, 1, 1, [0, 4]);

test('explicit linear luminance maps RGB into signed height while the raw and typed RGB links fail planning', () => {
  const nodes = {
    color: op('raster.canvas', { width: 2, height: 1, color: [128, 128, 128, 255] }),
    ink: typed(link('color'), { intent: 'color', tiling: { u: 'wrap' }, sampling: 'linear' }),
    resize: op('image.resize', { source: link('ink'), width: 2, height: 1 }),
    height: op('image.toHeight', { source: link('resize'), scale: 5, offset: -.5 }),
    light: op('fx.relight', { emission: link('color'), height: link('height') })
  };
  const spec = project(nodes, { color: link('resize'), height: link('height'), lit: link('light') });
  const graph = compile(spec), { outputs, report } = graph.run();
  assert.equal(graph.plan().outputs.color.type, 'colorImage');
  assert.equal(graph.plan().outputs.height.type, 'heightImage');
  assert.equal(outputs.height.raster.data[0].toFixed(8), (.21586050011389926 * 5 - .5).toFixed(8));
  assert.deepEqual(report.outputs.height.descriptor, {
    intent: 'height', layout: 'r', precision: 'float64', units: 'art-px', colorSpace: 'none',
    alpha: 'none', domain: 'finite', tiling: { u: 'wrap', v: 'clamp' }, sampling: 'linear'
  });
  for (const id of ['color', 'ink', 'resize']) {
    nodes.light.inputs.height = link(id);
    assert.throws(() => compile(spec), /light\.height.*height in art pixels.*image\.toHeight/);
  }
  nodes.height.inputs.units = 'world';
  nodes.light.inputs.height = link('height');
  assert.throws(() => compile(spec).run(), /light\.height.*height in art pixels/);
  nodes.height.inputs.units = 'art-px';
  nodes.light.inputs.options = { heightScale: .5 };
  assert.throws(() => compile(spec).run(), /Typed relief is already in art pixels/);
  nodes.light.inputs.height = gray;
  assert(compile(spec).run().outputs.lit.data.length);
});

test('descriptors validate precision, units, channel layout and domain', () => {
  const raw = raster(1, 1, 4, new Uint16Array([16384, 8192, 0, 32768]));
  const wrapped = I.declare(raw, { intent: 'color', colorSpace: 'display-p3', alpha: 'premultiplied' });
  assert.deepEqual(I.inspect(wrapped).extent, { width: 1, height: 1 });
  assert.equal(wrapped.descriptor.precision, 'unorm16');
  assert.equal(wrapped.descriptor.domain, 'unit');
  assert.deepEqual([...I.toDisplay(wrapped).data], [137, 59, 0, 128]);
  assert.strictEqual(wrapped.raster.data, raw.data);
  assert.throws(() => I.declare(raw, { intent: 'height', units: 'world' }), /layout or color space/);
  assert.throws(() => I.declare(gray, { intent: 'height' }), /units/);
  assert.throws(() => I.declare(gray, { intent: 'mask' }), /samples.*unit/);
  assert.throws(() => I.declare(raw, { intent: 'color', precision: 'float32' }), /samples.*float32/);
  assert.throws(() => I.declare({ ...raw, colorSpace: 'display-p3' }, { intent: 'color', colorSpace: 'srgb' }),
    /cannot change.*color space/);
  assert.throws(() => I.declare(raw, { intent: 'color', tiling: { u: 'bogus' } }), /tiling/);
  const signed = I.declare(raster(1, 1, 3, [-.6, .25, 1]), { intent: 'normal', precision: 'float32' });
  assert.equal(signed.descriptor.layout, 'xyz');
  assert.equal(signed.descriptor.domain, 'signed-unit');
  const portable = JSON.parse(JSON.stringify({ ...signed, raster: { ...signed.raster, data: Array.from(signed.raster.data) } }));
  assert(I.valid(portable));
  portable.raster.data[0] = -.6;
  assert.equal(I.valid(portable), false);
});

test('resizing preserves color and units and actually uses per-axis tiling and alpha-aware filtering', () => {
  const source = raster(2, 1, 1, new Float32Array([0, 4]));
  const make = u => I.declare(source, { intent: 'height', units: 'world', sampling: 'linear', tiling: { u } });
  assert.deepEqual([...I.resize(make('clamp'), 4, 1).raster.data], [0, 1, 3, 4]);
  const wrapped = I.resize(make('wrap'), 4, 1);
  assert.deepEqual([...wrapped.raster.data], [1, 1, 3, 3]);
  assert.equal(wrapped.descriptor.units, 'world');
  assert.equal(wrapped.descriptor.tiling.u, 'wrap');
  const vertical = I.declare(raster(1, 2, 1, [2, 6]), { intent: 'data', sampling: 'linear', tiling: { v: 'transparent' } });
  assert.equal(I.resize(vertical, 1, 4).raster.data[0], 1.5);
  const color = raster(2, 1, 4, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]));
  const soft = I.declare(color, { intent: 'color', sampling: 'linear' });
  assert.deepEqual([...I.resize(soft, 1, 1).raster.data], [255, 0, 0, 128]);
  const hard = I.declare(color, { intent: 'color' });
  assert.deepEqual(I.resize(hard, 2, 1).raster.data, color.data);
});

test('material ports and JSON exports preserve precision, policy and extent with explicit legacy adapters', () => {
  const source = raster(1, 1, 3, [73, 127, 163]);
  const spec = project({
    color: typed(source, { intent: 'color', precision: 'unorm8' }),
    height: typed(gray, { intent: 'height', units: 'art-px', precision: 'float32' }),
    maps: op('data.record', { baseColor: link('color'), height: link('height') }),
    pack: op('material.pack', { maps: link('maps'), metadata: { height: { texCoord: 2 } } }),
    pick: op('material.image', { source: link('pack'), name: 'height' }),
    display: op('image.toDisplay', { source: link('color') })
  }, { material: link('pack'), height: link('pick'), display: link('display') });
  spec.exports = { height: { output: 'height', format: 'json' }, swatch: { output: 'display', format: 'png' } };
  const material = Ink.openMaterialGraph(spec);
  const graph = compile(material), result = graph.run();
  const exported = JSON.parse(result.artifacts.find(artifact => artifact.name === 'height').bytes);
  assert(I.valid(exported, 'height'));
  assert.deepEqual(exported.raster.data, [0, 4]);
  assert.equal(result.report.outputs.material.channels.height.descriptor.precision, 'float32');
  assert.deepEqual(result.report.outputs.material.channels.height.metadata, { texCoord: 2 });
  assert.deepEqual([...result.outputs.display.data], source.data);
  spec.nodes.pick.op = 'material.channel';
  assert.throws(() => compile(spec).run(), /Use material.image to read the contract/);
  spec.nodes.pick.op = 'material.image';
  spec.exports.height.format = 'png';
  assert.throws(() => compile(spec), /needs a display raster/);
  assert.throws(() => kit.KIT.procedural.materialChannels.pack({ height: result.outputs.material.channels.baseColor.raster }),
    /Invalid material channel.*height/);
});

test('native PNG precision survives decoding, graph declaration, and JSON delivery', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-native-image-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'ramp.png'), PNG.encodeGray(2, 1, new Uint16Array([30001, 30002])));
  const spec = project({
    native: op('pngAsset', { name: 'native' }),
    legacy: op('pngAsset', { name: 'legacy' }),
    sheet: typed(link('native'), { intent: 'color', colorSpace: 'srgb-linear' }),
    height: op('image.toHeight', { source: link('sheet'), scale: 65535 })
  }, { height: link('height'), sheet: link('sheet'), legacy: link('legacy') });
  spec.assets = {
    native: { format: 'png', file: 'ramp.png', precision: 'native' },
    legacy: { format: 'png', file: 'ramp.png' }
  };
  spec.exports = { height: { output: 'height', format: 'json' } };
  const runner = Ink.createGraphProject(Ink.openMaterialGraph(spec), { kit, baseDir: folder });
  const result = runner.run();
  assert.equal(result.outputs.sheet.descriptor.precision, 'unorm16');
  assert.deepEqual([...result.outputs.sheet.raster.data], [30001, 30001, 30001, 65535, 30002, 30002, 30002, 65535]);
  assert.equal(result.outputs.legacy.data[0], result.outputs.legacy.data[4]);
  const heights = JSON.parse(result.artifacts[0].bytes).raster.data;
  assert.deepEqual(heights.map(Math.round), [30001, 30002]);
  const memory = Ink.createGraphProject(spec, { kit, baseDir: folder, planAssets: true }).plan(undefined, { memory: true }).memory;
  assert.equal(memory.initialBytes, 2 * 4 * (1 + 2));
});
