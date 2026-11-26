const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { captures, finish, width, height, pitch, broken, punch } = require('./swatch.cjs');

const out = path.resolve(process.argv[2] ?? 'studio/out/scan-processing');
const at = file => path.join(out, file);
const { graphImages: I } = Ink.load().KIT.procedural;
const ref = (node, port = 'value') => ({ node, port }), op = (op, inputs) => ({ op, inputs });
const interpretations = {
  baseColor: { intent: 'color', colorSpace: 'srgb-linear' },
  height: { intent: 'height', units: 'mm' },
  normal: { intent: 'normal', normalSpace: 'tangent', normalOrientation: 'opengl' },
  roughness: { intent: 'data' },
  irradiance: { intent: 'color', colorSpace: 'srgb-linear' },
  defects: { intent: 'mask' },
  validHeight: { intent: 'mask' }
};
const { source, settings } = captures();
const assets = {}, nodes = {};
for (const [name, grid] of Object.entries(source)) {
  const interpretation = interpretations[name];
  const image = I.declare(grid, interpretation), isMask = interpretation.intent === 'mask';
  const encoding = isMask ? 'png' : 'exr', file = 'capture/' + name + '.' + encoding;
  files.write(at(file), Ink.encodeTexture(image, { encoding, bitDepth: isMask ? 8 : 32 }));
  assets[name] = { format: 'bitmap', interpretation, source: { file } };
  nodes[name] = op('bitmapAsset', { name });
}
const channels = ['baseColor', 'height', 'normal', 'roughness'];
nodes.maps = op('data.record', Object.fromEntries(channels.map(name => [name, ref(name)])));
nodes.packet = op('material.pack', { maps: ref('maps') });
nodes.validity = op('data.record', { height: ref('validHeight') });
const options = {
  align: { width, height, pixelPitchMm: [pitch, pitch], perChannel: settings },
  repair: { radius: 12 },
  tile: { crop: [4, 4, 120, 120], axes: 'both', band: 10 }
};
nodes.scan = op('material.scanProcess', { source: ref('packet'), options: { input: 'processing' },
  defects: ref('defects'), validity: ref('validity'), illumination: ref('irradiance') });
const outputs = {
  captured: ref('packet'),
  ...Object.fromEntries(['value', 'aligned', 'delit', 'repaired', 'repairedMask', 'unresolved', 'support', 'report']
    .map(name => [name, ref('scan', name)]))
};
const graph = { format: 'ink-studio/graph-project', version: 1, assets, nodes, outputs,
  inputs: { processing: { type: 'record', default: options } },
  exports: { material: { output: 'value', format: 'texture', options: { encoding: 'exr', bitDepth: 32 } } } };
const saved = Ink.openMaterialGraph(graph, { id: 'juniper-kiln' });
saved.label = 'Juniper Kiln';
saved.settings.outputUsages = Object.fromEntries(channels.map((name, order) => [name, {
  usage: name, label: ['Pigment', 'Height (mm)', 'Tangent normal', 'Roughness'][order], order,
  source: { output: 'value', channel: name }, format: { format: name === 'height' ? 'exr' : 'png', bitDepth: name === 'height' ? 32 : 16 }
}]));
Ink.writeMaterialGraph(at('juniper-kiln.material.json'), saved);
const result = Ink.readGraphProject(at('juniper-kiln.material.json')).run();
for (const artifact of result.artifacts) files.write(at('delivery/' + artifact.file), artifact.bytes);
const { report, aligned, delit, repairedMask, value } = result.outputs;

let before = 0, after = 0, n = 0;
const raw = aligned.channels.baseColor.raster.raster, corrected = delit.channels.baseColor.raster.raster;
for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
  if (broken(x, y) || punch(x, y) || repairedMask.raster.data[p]) continue;
  const truth = finish(x, y).pigment;
  for (let c = 0; c < 3; c++) {
    before += (raw.data[raw.channels * p + c] - truth[c]) ** 2;
    after += (corrected.data[corrected.channels * p + c] - truth[c]) ** 2;
    n++;
  }
}
const error = { captured: Math.sqrt(before / n), corrected: Math.sqrt(after / n) };
assert(error.corrected < error.captured * .45, JSON.stringify(error));
assert(report.repair.repaired > 90 && report.repair.unresolved === 0, JSON.stringify(report.repair));
for (const name of ['baseColor', 'height', 'roughness']) assert(report.tile.seams[name].after < .000001);
assert.equal(report.tile.normalMode, 'height-detail');
const exported = Ink.readTexture(at('delivery/artifacts/height.exr'));
assert.deepEqual(exported.data, value.channels.height.raster.raster.data);

const pack = image => {
  const { raster: { width, height, channels, data }, descriptor } = image;
  return { width, height, channels, precision: descriptor.precision,
    bytes: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64') };
};
const stages = {};
for (const key of ['captured', 'aligned', 'delit', 'repaired', 'value'])
  stages[key] = Object.fromEntries(channels.map(name => [name, pack(result.outputs[key].channels[name].raster)]));
const inspection = { report, error, stages, repairedMask: pack(repairedMask) };
files.write(at('data.js'), 'const scan = ' + JSON.stringify(inspection) + ';\n');
files.json(at('verification.json'), { report, error });
for (const name of ['index.html', 'live.js']) files.write(at(name), fs.readFileSync(path.join(__dirname, name)));
console.log(at('index.html'));
