const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { toGraphProject } = require('../../cli/material-graph.js');
const { png, hdr } = require('./art.cjs');

const folder = path.resolve(process.argv[2] ?? 'studio/out/bitmap-resources');
const at = file => path.join(folder, file);
const links = {};
const embedded = (bytes, encoding = 'png') => ({ encoding, base64: bytes.toString('base64') });
function linked(file, bytes) {
  const name = 'bitmaps/' + file;
  if (bytes) {
    files.write(at(name), bytes);
    links[name] = bytes.toString('base64');
  }
  return { file: name };
}
const assets = {
  lantern: { format: 'bitmap', sequence: { first: 1001, fps: 4, playback: 'loop', frames: [
    linked('lantern.1001.png', png(0, .60, 1)),
    embedded(png(0, .84, 0)),
    linked('lantern.1003.png'),
    linked('lantern.1004.png', png(0, .98, -2)),
    embedded(png(0, .73, .5)),
    embedded(png(0, .46, 1))
  ] }, missing: { policy: 'hold' } },
  atlas: { format: 'bitmap', tiles: [
    { udim: 1001, source: linked('enamel.1001.png', png(1, .88, -2)) },
    { udim: 1002, source: embedded(png(2, .91, 1)) },
    { udim: 1011, source: linked('enamel.1011.png', png(0, .74, 2)) }
  ], missing: { policy: 'blank' } },
  radiance: { format: 'bitmap', source: embedded(hdr(), 'pfm'), interpretation: { colorSpace: 'srgb-linear' } }
};
const input = input => ({ input });
const ref = (node, port = 'value') => ({ node, port });
const spec = {
  format: 'ink-studio/graph-project', version: 1, assets,
  inputs: {
    resource: { type: 'string', default: 'lantern' }, frame: { type: 'integer', default: -1 },
    tile: { type: 'vec2', default: [0, 0] }, stops: { type: 'number', default: 0 }
  },
  nodes: {
    source: { op: 'bitmapAsset', inputs: { name: input('resource'), frame: input('frame'), tile: input('tile') } },
    exposure: { op: 'data.record', inputs: { stops: input('stops') } },
    grade: { op: 'image.exposure', inputs: { source: ref('source'), options: ref('exposure') } },
    display: { op: 'image.toDisplay', inputs: { source: ref('grade') } }
  },
  outputs: { native: ref('source'), status: ref('source', 'info'), display: ref('display') },
  exports: { display: { output: 'display', format: 'png' } }
};
let material = Ink.openMaterialGraph(spec, { id: 'switchyard-glass' });
material.label = 'Switchyard Glass';
for (const [id, label] of Object.entries({ lantern: 'Lantern pulse', atlas: 'Enamel tiles', radiance: 'Lantern radiance' }))
  material.resources[id].label = label;
const saved = Ink.writeMaterialGraph(at('switchyard-glass.material.json'), material);

const runner = Ink.readGraphProject(at('switchyard-glass.material.json'));
const cases = [
  ['lantern', {}, 'ready', 'unorm16'],
  ['held', { frame: 1003 }, 'held', 'unorm16'],
  ['tile', { resource: 'atlas', tile: [1, 0] }, 'ready', 'unorm16'],
  ['blank', { resource: 'atlas', tile: [1, 1] }, 'blank', 'unorm16'],
  ['radiance', { resource: 'radiance', stops: -2 }, 'ready', 'float32']
];
for (const [file, inputs, status, precision] of cases) {
  const { outputs, artifacts } = runner.run({ inputs });
  assert.equal(outputs.status.status, status);
  assert.equal(outputs.native.descriptor.precision, precision);
  files.write(at('plates/' + file + '.png'), artifacts[0].bytes);
}
material = saved;
for (const [id, selectors] of [['lantern', [{ frame: 1001 }, { frame: 1004 }]],
  ['atlas', [{ tile: [0, 0] }, { tile: [0, 1] }]]]) {
  for (const selected of selectors) material = Ink.editMaterialBitmap(material, { kind: 'embed', id, ...selected },
    { baseDir: folder }).document;
}
material.resources.lantern.definition.sequence.frames[2] = null;
Ink.writeMaterialGraph(at('switchyard-glass-portable.material.json'), material);
const { inputs, nodes, outputs } = toGraphProject(saved);
files.write(at('data.js'), 'const demo = ' + JSON.stringify({ spec: { inputs, nodes, outputs }, saved, links }) + ';\n');
for (const file of ['index.html', 'live.js']) files.write(at(file), fs.readFileSync(path.join(__dirname, file)));
for (const file of ['bitmap-resources.js', 'png-raster.js'])
  files.write(at(file), fs.readFileSync(path.join(__dirname, '../../src', file)));
files.write(at('ink-studio.browser.js'), Ink.bundle());
console.log(at('index.html'));
