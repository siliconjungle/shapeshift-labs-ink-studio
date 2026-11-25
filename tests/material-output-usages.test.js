const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Ink = require('..');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const link = (node, port = 'value') => ({ node, port });
const op = (op, inputs) => ({ op, inputs });
const png = bitDepth => ({ format: 'png', bitDepth });
const json = { format: 'json' };
const map = (usage, order, source, format = png(8), extra) =>
  ({ usage, label: 'Material ' + usage, order, source, format, ...extra });
const raster = (samples, channels = 1, width = 2) => ({ width, height: 1, channels, data: samples });
const image = (samples, descriptor, channels, width) => op('image.declare',
  { source: raster(samples, channels, width), descriptor });

function fixture() {
  const pitch = { pixelPitchMm: [.5, .25] };
  const settings = {
    ormh: { usage: 'packed', label: 'Occlusion, roughness, metal, finish', order: 70, format: png(16),
      packing: { a: { map: 'finish' }, b: { value: .25 }, r: { map: 'shade' }, g: { map: 'gloss' } } },
    relief: map('height', 50, { output: 'raised' }, json),
    gloss: map('roughness', 30, { output: 'surface', channel: 'roughness' }, png(16)),
    pigment: map('baseColor', 10, { output: 'pigment' }),
    normals: map('normal', 40, { output: 'normal' }),
    finish: map('mask.finish', 60, { output: 'mask' }, png(8), { export: false }),
    shade: map('ao', 20, { output: 'surface', channel: 'ao' })
  };
  return {
    format: 'ink-studio/graph-project', version: 1, outputUsages: settings,
    nodes: {
      ao: image([255, 64], { intent: 'data', precision: 'unorm8', ...pitch }),
      rough: image([0, 32768], { intent: 'data', precision: 'unorm16', ...pitch }),
      mask: image([0, .8], { intent: 'mask', ...pitch }),
      height: image([-2, 3], { intent: 'height', units: 'mm', ...pitch }),
      normal: image([-1, 0, 1, 0, 1, 0], { intent: 'normal', ...pitch }, 3),
      color: image([.25, 0, .5, 1, 1, 0, 0, 1], { intent: 'color', colorSpace: 'srgb-linear', ...pitch }, 4),
      collect: op('data.record', { ao: link('ao'), roughness: link('rough') }),
      packet: op('material.pack', { maps: link('collect') })
    },
    outputs: { surface: link('packet'), raised: link('height'), mask: link('mask'),
      pigment: link('color'), normal: link('normal'), scalar: link('ao') },
    exports: { 'old-height': { output: 'raised', format: 'json' } }
  };
}

const decode = artifact => [...PNG.raster(artifact.bytes).data];
const bytesFor = (artifacts, name) => artifacts.find(a => a.name === name);

test('one ordered usage catalog drives typed, packed and legacy deliveries with explicit channel assignments', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ink-material-maps-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = file => path.join(root, file);
  const source = fixture(), file = at('tiles.material.json');
  const editable = Ink.openMaterialGraph(source, { id: 'tiles' });
  Ink.writeMaterialGraph(file, editable);
  assert.deepEqual(Ink.readMaterialGraph(file).settings.outputUsages, source.outputUsages);
  const project = Ink.readGraphProject(file);
  const ordered = ['pigment', 'shade', 'gloss', 'normals', 'relief', 'finish', 'ormh'];
  assert.deepEqual(project.plan().outputUsages.map(row => row.id), ordered);
  assert.deepEqual(project.snapshot().settings.outputUsages, source.outputUsages);
  const rendered = project.run(), outputs = rendered.artifacts;
  assert.deepEqual(rendered.report.outputUsages.map(row => row.id), ordered);
  assert.deepEqual(outputs.map(row => row.name), ['old-height', ...ordered.filter(id => id !== 'finish')]);
  assert.deepEqual(decode(bytesFor(outputs, 'ormh')),
    [65535, 0, 16384, 0, 64 * 257, 32768, 16384, 52428]);
  assert.deepEqual(decode(bytesFor(outputs, 'gloss')), [0, 0, 0, 65535, 32768, 32768, 32768, 65535]);
  assert.equal(decode(bytesFor(outputs, 'pigment'))[0], 137);
  assert.equal(bytesFor(outputs, 'ormh').bytes[24], 16);
  assert.equal(bytesFor(outputs, 'ormh').bytes[25], 6);
  const density = bytesFor(outputs, 'ormh').bytes;
  const index = density.indexOf('pHYs');
  assert.deepEqual([density.readUInt32BE(index + 4), density.readUInt32BE(index + 8)], [2000, 4000]);
  assert.deepEqual(JSON.parse(bytesFor(outputs, 'relief').bytes).raster.data, [-2, 3]);
  assert.equal(rendered.report.outputUsages.at(-1).artifact.sha256, bytesFor(outputs, 'ormh').sha256);
  assert.deepEqual(rendered.report.outputUsages.at(-1).packing.b, { value: .25 });

  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'graph', ...args], { cwd: root }));
  const editedCatalog = { ...source.outputUsages, pigment: { ...source.outputUsages.pigment, label: 'Kiln-red glaze' } };
  fs.writeFileSync(at('maps.json'), JSON.stringify(editedCatalog));
  const receipt = run('material', file, '--output-usages', at('maps.json'), '--out', at('selected.json'));
  assert.equal(run('plan', receipt.file).outputUsages[0].label, 'Kiln-red glaze');
  const preview = run('inspect', receipt.file, '--map', 'ormh', '--component', 'a', '--out', at('view'));
  assert.equal(preview.materialPreview.component, 'a');
  assert.deepEqual([...PNG.raster(fs.readFileSync(at('view/artifacts/preview.png'))).data], [0, 0, 0, 255, 204, 204, 204, 255]);
});

test('previews use the map intent and show packed data without alpha compositing', async () => {
  const project = Ink.createGraphProject(fixture());
  const inspect = (map, component) => project.inspect({ map, component });
  assert.deepEqual(inspect('relief').report.materialPreview, { mode: 'height', units: 'mm', range: [-2, 3] });
  assert.deepEqual(decode(inspect('relief').artifacts[0]), [0, 0, 0, 255, 255, 255, 255, 255]);
  assert.deepEqual(decode(inspect('normals').artifacts[0]), [0, 128, 255, 255, 128, 255, 128, 255]);
  assert.deepEqual(decode(inspect('ormh').artifacts[0]), [255, 0, 64, 255, 64, 128, 64, 255]);
  assert.equal(inspect('pigment').report.materialPreview.mode, 'color');
  assert.throws(() => inspect('pigment', 'g'), /packed channel/);
  const frame = await project.previewFrame({ mask: { map: 'finish' }, alpha: { map: 'ormh', component: 'a' } });
  assert.deepEqual(frame.artifacts.map(row => row.file), ['previews/mask.png', 'previews/alpha.png']);
  assert.equal(frame.report.previews.alpha.materialPreview.component, 'a');
});

test('invalid sources, encoder collisions and incompatible packed textures fail explicitly', () => {
  const compile = change => {
    const source = fixture();
    change(source);
    return Ink.createGraphProject(source);
  };
  assert.throws(() => compile(s => { s.outputUsages.ormh.packing.r.map = 'pigment'; }), /unpacked scalar/);
  assert.throws(() => compile(s => { delete s.outputUsages.ormh.packing.b; }), /explicit r, g and b/);
  assert.throws(() => compile(s => { s.outputUsages.shade.source = { output: 'surface' }; }), /typed image output/);
  assert.throws(() => compile(s => { s.outputUsages.shade.source.channel = 'missing'; }).run(), /Missing material channel/);
  assert.throws(() => compile(s => { s.outputUsages.relief.format = png(16); }), /JSON delivery format/);
  assert.throws(() => compile(s => { s.exports.PIGMENT = { output: 'raised', format: 'json' }; }), /distinct names/);
  assert.throws(() => compile(s => { s.outputUsages.shade.source = { output: 'pigment' }; }).run(), /does not match.*ao usage/);
  assert.throws(() => compile(s => { s.nodes.mask.inputs.descriptor.pixelPitchMm = [1, 1]; }).run(), /must match extent.*pitch/);
  assert.throws(() => compile(s => { s.nodes.mask.inputs.source = raster([.3], 1, 1); }).run(), /must match extent/);
  const rgb = compile(s => {
    delete s.outputUsages.ormh.packing.a;
    delete s.nodes.color.inputs.descriptor.pixelPitchMm;
  }).run();
  assert.equal(bytesFor(rgb.artifacts, 'ormh').bytes[25], 2);
  assert.equal(bytesFor(rgb.artifacts, 'pigment').bytes.includes(Buffer.from('pHYs')), false);
  const packed = compile(s => { s.outputUsages.ormh.format = json; }).run();
  assert.deepEqual(JSON.parse(bytesFor(packed.artifacts, 'ormh').bytes).raster.data,
    [1, 0, .25, 0, 64 / 255, 32768 / 65535, .25, .8]);
});
