const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const plates = require('./plates.js')();

const out = path.resolve(process.argv[2] ?? 'studio/out/material-image-blend');
const at = file => path.join(out, file);
const op = (op, inputs) => ({ op, inputs });
const link = node => ({ node });
const { width, height } = plates.background;
const rgb = { intent: 'color', precision: 'unorm8' };
const data = { intent: 'data' };
for (const [name, source] of Object.entries(plates))
  files.write(at(name + '.png'), source.channels === 1 ? PNG.encodeGray(width, height, source.data) :
    PNG.encode(width, height, source.data, source.channels));

const nodes = {
  backgroundPNG: op('pngAsset', { name: 'background' }),
  foregroundPNG: op('pngAsset', { name: 'foreground' }),
  background: op('image.declare', { source: link('backgroundPNG'), descriptor: rgb }),
  foreground: op('image.declare', { source: link('foregroundPNG'), descriptor: rgb }),
  mask: op('image.declare', { source: { ...plates.mask, data: Array.from(plates.mask.data) },
    descriptor: { intent: 'mask', precision: 'unorm8' } }),
  blend: op('image.blend', { background: link('background'), foreground: link('foreground'), mask: link('mask'),
    mode: { input: 'mode' }, opacity: { input: 'opacity' }, crop: { input: 'crop' }, alpha: { input: 'alpha' },
    clamp: { input: 'clamp' } }),
  preview: op('image.toDisplay', { source: link('blend') }),
  sample: op('image.uniform', { width: 1, height: 1, value: .75, descriptor: data })
};
const outputs = { blend: link('blend'), preview: link('preview') };
const deliveries = { plate: { output: 'preview', format: 'png' } };
const samples = { raw: ['none', 1.125], modeClipped: ['mode', .875], outputClipped: ['output', 1] };
for (const [label, [clamp]] of Object.entries(samples)) {
  nodes[label] = op('image.blend', { background: link('sample'), foreground: link('sample'), mode: 'add', opacity: .5, clamp });
  outputs[label] = link(label);
  deliveries[label] = { output: label, format: 'json' };
}
const inputs = {
  mode: { type: 'string', default: 'screen' }, opacity: { type: 'number', default: .8 },
  crop: { type: 'record', default: {} }, alpha: { type: 'string', default: 'source' },
  clamp: { type: 'string', default: 'auto' }
};
const assets = Object.fromEntries(['background', 'foreground'].map(name => [name, { format: 'png', file: name + '.png' }]));
const project = { format: 'ink-studio/graph-project', version: 1, inputs, assets, nodes, outputs, exports: deliveries };
const material = at('breakwater.material.json');
Ink.writeMaterialGraph(material, Ink.openMaterialGraph(project, { id: 'breakwater-blend' }));
const result = Ink.readGraphProject(material).run();
for (const [label, [, value]] of Object.entries(samples))
  assert.equal(result.outputs[label].raster.data[0], value);
for (const artifact of result.artifacts) files.write(at(artifact.file), artifact.bytes);
for (const name of ['index.html', 'plates.js']) files.write(at(name), fs.readFileSync(path.join(__dirname, name)));
files.write(at('ink-studio.browser.js'), Buffer.from(Ink.bundle()));
console.log('Wrote the editable material graph and live browser demo to ' + out);
