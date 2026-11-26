const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const Ink = require('..');
const PNG = require('../cli/png.js');
const Bitmap = require('../src/bitmap-resources.js');

const graph = assets => ({
  format: 'ink-studio/graph-project', version: 1, assets,
  inputs: { frame: { type: 'integer', default: -1 }, tile: { type: 'vec2', default: [0, 0] } },
  nodes: { source: { op: 'bitmapAsset', inputs: { name: 'paint', frame: { input: 'frame' }, tile: { input: 'tile' } } } },
  outputs: { value: { node: 'source' }, info: { node: 'source', port: 'info' } }
});
const bitmap = definition => ({ format: 'bitmap', ...definition });
const png = n => PNG.encodeMaterial(2, 1, Uint16Array.of(n, 65535, 9, 300, n + 1, 5, 1200, 65535), 4);
const inline = bytes => ({ base64: bytes.toString('base64'), encoding: 'png' });
const sample = (runner, frame, tile) => runner.run({ inputs: { frame, tile } }).outputs;
const temp = t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-bitmaps-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
};

test('link, embed, edit, reimport and replace keep material resource and graph link IDs', t => {
  const folder = temp(t), at = name => path.join(folder, name), baseDir = folder;
  fs.writeFileSync(at('glass.png'), png(113));
  const source = Ink.openMaterialGraph(graph({}), { id: 'glass' });
  function edit(document, kind, settings = {}) {
    return Ink.editMaterialBitmap(document, { kind, id: 'paint', ...settings }, { baseDir }).document;
  }
  const linked = edit(source, 'link', { definition: bitmap({ source: { file: 'glass.png' } }), label: 'Glass' });
  assert.equal(Object.hasOwn(source.resources, 'paint'), false);
  assert.deepEqual(linked.graph, source.graph);
  const first = Ink.createGraphProject(linked, { baseDir });
  const id = first.plan().projectHash;
  assert.equal(first.sockets('source').outputs.value.type, 'colorImage');
  assert.equal(first.run().outputs.value.raster.data[0], 113);
  assert.equal(first.run().outputs.value.descriptor.precision, 'unorm16');
  assert(first.sourceFiles().includes(at('glass.png')));
  fs.writeFileSync(at('glass.png'), png(415));
  const imported = edit(linked, 'reimport');
  const refreshed = Ink.createGraphProject(imported, { baseDir });
  assert.notEqual(refreshed.plan().projectHash, id);
  assert.equal(first.run().outputs.value.raster.data[0], 113);
  assert.equal(refreshed.run().outputs.value.raster.data[0], 415);

  const embedded = edit(imported, 'embed');
  const changed = edit(embedded, 'edit', { pixels: [{ x: 1, y: 0, value: [.5, .25, 1, 1] }] });
  fs.writeFileSync(at('glass.png'), png(1027));
  const collected = edit(changed, 'reimport');
  const savedAt = at('review/glass.material.json');
  Ink.writeMaterialGraph(savedAt, collected, { baseDir });
  assert.equal(Ink.readMaterialGraph(savedAt).resources.paint.definition.source.origin, '../glass.png');
  fs.unlinkSync(at('glass.png'));
  const reopened = Ink.readGraphProject(savedAt);
  assert(!reopened.sourceFiles().includes(at('glass.png')));
  assert.deepEqual(Array.from(reopened.run().outputs.value.raster.data), [1027, 65535, 9, 300, 32768, 16384, 65535, 65535]);
  const replacement = edit(collected, 'replace', { member: inline(png(89)) });
  assert.equal(Ink.createGraphProject(replacement, { baseDir }).run().outputs.value.raster.data[4], 90);
  assert.deepEqual(replacement.graph, linked.graph);
  assert.equal(replacement.resources.paint.label, 'Glass');
  assert.throws(() => edit(replacement, 'edit', { pixels: [{ x: 2, y: 0, value: [1, 1, 1, 1] }] }), /sample range/);
  assert.throws(() => edit(replacement, 'reimport'), /no reimport origin/);
});

test('sequences seek on the graph clock, hold holes deterministically and honor explicit frame numbers', () => {
  const paint = bitmap({ sequence: { first: 1001, fps: 4, playback: 'loop',
    frames: [inline(png(71)), null, inline(png(1023))] }, missing: { policy: 'hold' } });
  const runner = Ink.createGraphProject(graph({ paint }));
  function at(time) { return runner.run({ time }).outputs; }
  assert.deepEqual(at(.25).info, { requested: '1002', resolved: '1001', status: 'held', frame: 1002 });
  assert.equal(at(.5).value.raster.data[0], 1023);
  assert.equal(at(.75).value.raster.data[0], 71);
  assert.equal(at(-.25).value.raster.data[0], 1023);
  assert.equal(sample(runner, 1003, [0, 0]).value.raster.data[0], 1023);
  paint.sequence.playback = 'pingpong';
  const ping = Ink.createGraphProject(graph({ paint }));
  assert.equal(ping.run({ time: .75 }).outputs.info.status, 'held');
  assert.equal(ping.run({ time: 1 }).outputs.info.frame, 1001);
  paint.missing.policy = 'error';
  assert.throws(() => Ink.createGraphProject(graph({ paint })).run({ time: .25 }), /Missing bitmap member 1002/);
});

test('signed UV and UDIM tiles share native contracts and keep missing inputs blank on demand', t => {
  const folder = temp(t), baseDir = folder;
  const paint = bitmap({ tiles: [
    { udim: 1002, source: inline(png(84)) },
    { uv: [-1, 1], source: { file: 'offline.png' } },
  ], missing: { policy: 'blank' } });
  const source = graph({ paint }), runner = Ink.createGraphProject(source, { baseDir });
  assert.equal(sample(runner, -1, [1, 0]).value.raster.data[0], 84);
  for (const tile of [[-1, 1], [0, 0]]) {
    const blank = sample(runner, -1, tile);
    assert.equal(blank.info.status, 'blank');
    assert.deepEqual(Array.from(blank.value.raster.data), new Array(8).fill(0));
    assert.equal(blank.value.descriptor.precision, 'unorm16');
  }
  const plan = Ink.createGraphProject(source, { baseDir, planAssets: true }).plan({}, { memory: true });
  assert.equal(plan.projectHash, runner.plan().projectHash);
  assert.equal(plan.assets.paint.info.decodedBytes, 32);
  assert.equal(plan.assets.paint.info.members[1].available, false);
  assert(!runner.sourceFiles().includes(path.join(folder, 'offline.png')));
  fs.writeFileSync(path.join(folder, 'offline.png'), PNG.encode(1, 1, Uint8Array.of(0, 0, 0)));
  assert.throws(() => Ink.createGraphProject(source, { baseDir }), /same extent/);
  fs.writeFileSync(path.join(folder, 'offline.png'), 'invalid PNG');
  assert.throws(() => Ink.createGraphProject(source, { baseDir }), /Not a PNG/);
  assert.throws(() => Bitmap.layout(bitmap({ tiles: [...paint.tiles, { uv: [1, 0], source: inline(png(9)) }] })),
    /Duplicate bitmap tile/);
  const unavailable = graph({ paint: bitmap({ source: { file: 'offline-only.png' },
    interpretation: { intent: 'height' }, missing: { policy: 'blank', width: 3, height: 2 } }) });
  const offline = Ink.createGraphProject(unavailable, { baseDir });
  assert.equal(offline.sockets('source').outputs.value.type, 'heightImage');
  assert.deepEqual(Array.from(offline.run().outputs.value.raster.data), [0, 0, 0, 0, 0, 0]);
});

function pfm(rows, scale) {
  const header = Buffer.from('Pf\n2 2\n' + scale + '\n'), pixels = Buffer.alloc(16);
  rows.forEach((n, i) => scale < 0 ? pixels.writeFloatLE(n, 4 * i) : pixels.writeFloatBE(n, 4 * i));
  return Buffer.concat([header, pixels]);
}

test('bitmap interpretation preserves signed and HDR floats, high precision data and user alpha/color intent', () => {
  const create = paint => Ink.createGraphProject(graph({ paint: bitmap(paint) })).run().outputs.value;
  const rgb = create({ source: { base64: pfm([5, -1, .1875, .666666], -2).toString('base64'), encoding: 'pfm' } });
  assert.equal(rgb.descriptor.colorSpace, 'srgb-linear');
  assert(rgb.raster.data instanceof Float32Array);
  assert.deepEqual(Array.from(rgb.raster.data.filter((_, i) => i % 4 === 0)), [.375, Math.fround(1.333332), 10, -2]);
  const height = create({ source: { base64: pfm([-.25, 2, .5, 4], 1).toString('base64'), encoding: 'pfm', rowOrder: 'top-down' },
    interpretation: { intent: 'height', units: 'mm' } });
  assert.deepEqual(Array.from(height.raster.data), [-.25, 2, .5, 4]);
  assert.equal(height.descriptor.units, 'mm');
  const alpha = create({ source: inline(png(91)), interpretation: { intent: 'data', channel: 'a', colorSpace: 'none' } });
  assert(alpha.raster.data instanceof Uint16Array);
  assert.deepEqual(Array.from(alpha.raster.data), [300, 65535]);
  const p3 = create({ source: inline(png(91)), interpretation: { colorSpace: 'display-p3', sampling: 'linear', tiling: { u: 'wrap' } } });
  assert.equal(p3.descriptor.colorSpace, 'display-p3');
  assert.deepEqual(p3.descriptor.tiling, { u: 'wrap', v: 'clamp' });
});

test('CLI writes a relocated bitmap edit and inspects its saved member hash', t => {
  const folder = temp(t), at = name => path.join(folder, name);
  fs.writeFileSync(at('glass.png'), png(512));
  Ink.writeMaterialGraph(at('old.json'), Ink.openMaterialGraph(graph({
    paint: bitmap({ source: { file: 'glass.png' } })
  }), { id: 'glass' }));
  fs.writeFileSync(at('edit.json'), JSON.stringify({ kind: 'edit', id: 'paint', interpretation: { colorSpace: 'srgb-linear' } }));
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, [path.resolve(__dirname, '../cli/ink-studio.js'),
    'graph', 'material-bitmap', ...args], { encoding: 'utf8' }));
  const annotation = cli(at('old.json'), at('edit.json'), '--out', at('proof/edited.json'));
  assert.equal(annotation.bitmap.descriptor.colorSpace, 'srgb-linear');
  assert.equal(cli(at('proof/edited.json'), 'paint').members[0].file, '../glass.png');
  assert.equal(Ink.readGraphProject(at('proof/edited.json')).run().outputs.value.raster.data[0], 512);
});
