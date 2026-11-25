const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const { toGraphProject } = require('../../cli/material-graph.js');
const files = require('../../cli/asset-files.js');
const { exposed } = require('../material-exposed-parameters/demo.cjs');

const directory = path.resolve(process.argv[2] ?? 'outputs/material-parameter-presets');
const at = name => path.join(directory, name);
let document = { ...exposed, instances: { 'platform': { label: 'Platform wall' }, 'hall': { label: 'Ticket hall' } } };
const edit = request => { document = Ink.editMaterialPresets(document, request).document; };

edit({ kind: 'save', id: 'coastal', label: 'Coastal enamel' });
edit({ kind: 'save', id: 'copper', label: 'Kiln copper',
  values: { colorway: 'kiln', age: 'aged', gloss: .7, patina: 62, coat: 1.4, details: true } });
edit({ kind: 'save', id: 'twilight', label: 'Twilight accent', values: { colorway: 'twilight', coat: .9 } });
edit({ kind: 'apply', id: 'coastal', instance: 'platform' });
edit({ kind: 'apply', id: 'copper', instance: 'hall' });
document = Ink.editMaterialParameters(document, { kind: 'set', instance: 'hall', values: { gloss: .4 } }).document;
const graph = at('station.material.json');
Ink.writeMaterialGraph(graph, document);

const bundle = Ink.exportMaterialPresets(document);
files.json(at('station-presets.json'), bundle);
const exchange = { ...bundle, presets: { 'night-shift': { label: 'Night shift', values: { colorway: 'twilight', gloss: .8 } } } };
files.json(at('night-shift-presets.json'), exchange);
files.json(at('inspector.json'), Ink.inspectMaterialPresets(document));
files.json(at('apply-twilight.json'), { kind: 'apply', id: 'twilight', instance: 'hall' });
for (const instance of ['platform', 'hall']) {
  const render = Ink.readGraphProject(graph, { instance }).run();
  files.write(at('previews/' + instance + '.png'), render.artifacts[0].bytes);
}
files.write(at('data.js'), 'const station = ' + JSON.stringify({
  material: document.id, graph: toGraphProject(document),
  scope: { inputs: document.graph.inputs, outputs: document.graph.outputs, controls: document.controls },
  state: { presets: document.presets, instances: document.instances }
}) + ';\n');
files.write(at('toolkit.js'), Ink.bundle());
files.write(at('demo.html'), fs.readFileSync(path.join(__dirname, 'demo.html')));
console.log(at('demo.html'));
