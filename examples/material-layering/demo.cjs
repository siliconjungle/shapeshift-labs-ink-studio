const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const art = require('./art.cjs');
const preview = require('./preview.js');

const folder = path.resolve(process.argv[2] ?? 'studio/out/material-layering');
const at = file => path.join(folder, file);
const { graphImages: I, materialChannels: M } = Ink.load().KIT.procedural;
const { base, enamel, stamp, glazeMask, stampMask, enamelGain } = art.source(I);
const inputs = {
  brass: { type: 'materialChannels', default: M.pack(base) },
  enamel: { type: 'materialChannels', default: M.pack({ ...enamel, baseColor: preview.pigment(I, enamelGain, 'jade') }) },
  stamp: { type: 'materialChannels', default: M.pack(stamp) },
  enamelGain: { type: 'grayImage', default: enamelGain },
  glazeMask: { type: 'grayImage', default: glazeMask },
  stampMask: { type: 'grayImage', default: stampMask },
  enamelEdits: { type: 'record', default: {} },
  glazeSettings: { type: 'record', default: { height: { softness: .022 },
    channels: { normal: { mode: 'rnm', opacity: .88 }, ao: { mode: 'multiply', opacity: .45 } } } },
  stampSettings: { type: 'record', default: { height: { softness: .045 },
    transform: { scale: .57, rotation: -11, offset: [.18, .15], border: 'transparent' },
    channels: { normal: { mode: 'whiteout', opacity: .65 } } } }
};
const op = (op, inputs) => ({ op, inputs });
const input = input => ({ input }), node = node => ({ node });
const nodes = {
  glazeEdits: op('material.replace', { source: input('enamel'), maps: input('enamelEdits') }),
  firedEnamel: op('material.layer', {
    base: input('brass'), layer: node('glazeEdits'), mask: input('glazeMask'), options: input('glazeSettings') }),
  makerSeal: op('material.layer', {
    base: node('firedEnamel'), layer: input('stamp'), mask: input('stampMask'), options: input('stampSettings') })
};
const outputs = { material: node('makerSeal'), enamelOnly: node('firedEnamel') };
const graph = { format: 'ink-studio/graph-project', version: 1, inputs, nodes, outputs };
const graphFile = at('lantern-relay.material.json');
const serialize = (_, value) => ArrayBuffer.isView(value) ? Array.from(value) : value;
const saved = Ink.openMaterialGraph(JSON.parse(JSON.stringify(graph, serialize)), { id: 'lantern-relay' });
saved.label = 'Lantern Relay';
saved.settings.outputUsages = Object.fromEntries([
  ['baseColor', 'Pigment', 'png'], ['normal', 'Tangent normal', 'png'], ['height', 'Relief in millimeters', 'exr'],
  ['roughness', 'Roughness', 'png'], ['metalness', 'Metalness', 'png'], ['ao', 'Ambient occlusion', 'png'], ['opacity', 'Plaque coverage', 'png']
].map(([channel, label, format], order) => [channel, { usage: channel, label, order,
  source: { output: 'material', channel }, format: { format, bitDepth: format === 'png' ? 16 : 32 } }]));
Ink.writeMaterialGraph(graphFile, saved);
const runner = Ink.readGraphProject(graphFile);
const run = settings => runner.run({ inputs: settings }).outputs.material;
const layered = run();
const noHeight = run({ glazeSettings: { ...inputs.glazeSettings.default, height: null } });
const ember = run({ enamelEdits: { baseColor: preview.pigment(I, enamelGain, 'ember') } });
const matte = run({ enamelEdits: { roughness: I.uniform(.79, 1, 1, { intent: 'data' }) } });
const samples = (material, map) => material.channels[map].raster.raster.data;
assert.notDeepEqual(samples(layered, 'baseColor'), samples(noHeight, 'baseColor'));
assert.notDeepEqual(samples(layered, 'baseColor'), samples(ember, 'baseColor'));
assert.deepEqual(samples(layered, 'roughness'), samples(ember, 'roughness'));
assert.deepEqual(samples(layered, 'normal'), samples(matte, 'normal'));
assert.deepEqual(samples(layered, 'baseColor'), samples(matte, 'baseColor'));
assert.notDeepEqual(samples(layered, 'roughness'), samples(matte, 'roughness'));

for (const [name, material, mode] of [
  ['relayed', layered, 'lit'], ['height-disabled', noHeight, 'lit'], ['ember', ember, 'lit'],
  ['relief', layered, 'height'], ['roughness', layered, 'roughness']
]) {
  const { width, height, pixels } = preview.render(material, mode);
  files.write(at(name + '.png'), PNG.encode(width, height, pixels, 4));
}
files.write(at('data.js'), 'const relayGraph = ' + JSON.stringify({ inputs, nodes, outputs }, serialize) + ';\n');
for (const name of ['index.html', 'live.js', 'preview.js']) files.write(at(name), fs.readFileSync(path.join(__dirname, name)));
files.write(at('ink-studio.browser.js'), Ink.bundle());
console.log(at('index.html'));
