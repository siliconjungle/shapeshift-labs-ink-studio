const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const Files = require('../../cli/asset-files.js');
const { toGraphProject } = require('../../cli/material-graph.js');
const { fixture } = require('./project.cjs'), preview = require('./preview.js');

const folder = path.resolve(process.argv[2] ?? 'studio/out/material-channel-paint');
const at = file => path.join(folder, file);
const { graph, flows } = fixture(Ink.load());
const initial = graph.inputs.session.default;
const material = Ink.openMaterialGraph(graph, { id:'tideglass' });
material.label = 'Tideglass';
const saved = Ink.writeMaterialGraph(at('tideglass.material.json'),material);
const runner = Ink.readGraphProject(at('tideglass.material.json'));
const original = runner.run({ inputs: { session: { ...initial, layers: [] } } }).outputs;
const painted = runner.run().outputs;
const channels = painted.report.channels;
assert(channels.emission.changed > 2000 && channels.height.changed > 2000 && channels.flow.changed > 2000);
assert.equal(painted.color.descriptor.precision, 'float32');
assert.equal(painted.height.descriptor.units, 'mm');
assert(painted.emission.raster.data.some(value => value > 1));
for (const [file, output, mode] of [['before',original,'material'],['after',painted,'material'],
  ['height',painted,'height'],['emission',painted,'emission'],['flow',painted,'flow']]) {
  const { width, height, data } = preview.render(output, mode);
  Files.write(at(file+'.png'),PNG.encode(width,height,data,4));
}
const { inputs, nodes, outputs } = toGraphProject(saved);
// Supply the real graph and its source files, while avoiding a second copy of the embedded payloads.
const browser = { spec:{ inputs,nodes,outputs }, saved, flows };
Files.write(at('data.js'),'const demo = '+JSON.stringify(browser)+';\n');
for (const file of ['index.html', 'live.js', 'preview.js']) Files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
for (const file of ['bitmap-resources.js','png-raster.js']) Files.write(at(file),fs.readFileSync(path.join(__dirname,'../../src',file)));
Files.write(at('ink-studio.browser.js'),Ink.bundle());
console.log(at('index.html'));
