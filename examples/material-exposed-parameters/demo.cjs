const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const { toGraphProject } = require('../../cli/material-graph.js');
const files = require('../../cli/asset-files.js');

const directory = path.resolve(process.argv[2] ?? 'outputs/material-exposed-parameters');
const at = name => path.join(directory, name);
const width = 80, height = 70;
const shade = [], glints = [], patina = [], rim = [];
for (let iy = 0; iy < height; iy++) for (let ix = 0; ix < width; ix++) {
  const x = ix - 39.5, y = iy - 34.5;
  const radius = Math.hypot(x, y), angle = Math.atan2(y, x);
  const speckle = ((Math.imul(ix + 21, 5231) ^ Math.imul(iy + 39, 9719)) & 31) / 31;
  let tone = .30 - (x + y * 1.3) * .0017 + speckle * .029, flare = 0, edge = 0, wear = 0;
  if (radius > 31.8) tone = .04;
  else if (radius > 30.3) tone = x + y < 1 ? .59 : .12;
  else if (radius > 27.8) {
    tone = x + y < -3 ? .43 : .19;
    edge = Math.max(.08, .52 - .013 * (x + y));
    if (Math.abs(Math.sin(angle * 14)) < .30 && radius < 29) tone = .79;
  } else if (radius > 26.9) tone = x + y < 0 ? .58 : .39;
  if (radius < 26.6) {
    const perch = y - 15 - Math.sin((x + 2) * .18) * 1.28;
    if (x > -18 && x < 20 && perch > -.7 && perch < 2.2) tone = perch < .15 ? .72 : .46;
    if (x < -12 && x > -21 && Math.abs(y - 11 + .6 * (x + 15)) < .6) tone = .66;
    if (Math.abs(y - 20 - Math.sin(x * .2) * 1.35) < .58 && Math.abs(x) < 16) tone = .48;
    const diamond = Math.abs(x - 13) + Math.abs(y + 15) * .7;
    if (diamond < 4) tone = diamond < 2 ? .95 : .77;
    const tail = x > 7 && x < 24 && Math.abs(y - 7 - .38 * (x - 7)) < 4.4 - (x - 7) * .205;
    const body = Math.hypot((x - .5) / 13.4, (y - 4 - x * .26) / 8.3) < 1;
    const head = Math.hypot((x + 9.1) / 6.1, (y + 4.4) / 6.5) < 1;
    const bill = x < -13.4 && x > -24 && Math.abs(y + 5.8 + (x + 17) * .13) < 1.95 + .155 * (x + 24);
    if (body || head || tail || bill) {
      tone = tail ? .75 : bill ? .67 : y < -3 ? .94 : .88 - Math.max(0, y + 2) * .014;
      const wing = body && Math.hypot((x - 3.2) / 9.7, (y - 2.4 - .29 * x) / 4.9) < 1;
      if (wing) tone = .76 + .052 * Math.cos((x - y) * .46) - .015 * Math.abs(y - 2);
      if (head && Math.hypot(x + 10.7, y + 6.7) < 1.19) tone = .11;
      if (head && x + y < -13 && tone > .8) flare = .55;
    }
    if (radius < 25 && (speckle < .07 || speckle > .91) && tone < .5) wear = .28 + .29 * speckle;
  }
  shade.push(tone);
  glints.push(253, 235, 181, Math.round(flare * 255));
  rim.push(249, 195, 100, Math.round(edge * 255));
  patina.push(137, 173, 126, Math.round(wear * 255));
}

const op = (operation, inputs) => ({ op: operation, inputs });
const ref = node => ({ node });
const input = name => ({ input: name });
const raster = (channels, data) => ({ width, height, channels, data });
const typedRaster = rgba => ({ op: 'data.typed', type: 'raster', inputs: { value: raster(4, rgba) } });
const palettes = {
  coast: ['#121e23','#203535','#285c56','#3e8375','#93a281','#ba864e','#edb866','#ffe2a2'],
  kiln: ['#1f1b25','#362731','#693d43','#a1534c','#ac7e62','#cb8c58','#f4b56d','#ffe0a6'],
  twilight: ['#171b30','#282b48','#363f63','#525b8a','#7f8399','#b28c7e','#e6ab8d','#ffdbb7']
};
const before = Ink.openMaterialGraph({
  format: 'ink-studio/graph-project', version: 1,
  inputs: { colorway: { type: 'string', default: 'coast' },
    age: { type: 'string', default: 'fresh' }, details: { type: 'boolean', default: true } },
  nodes: {
    palette: op('data.get', { key: input('colorway'), record: palettes }),
    surface: op('color.gradient', { source: raster(1, shade), ramp: ref('palette'), options: { channel: 0, range: [0, 1] } }),
    glare: typedRaster(glints), edge: typedRaster(rim), weathering: typedRaster(patina),
    shineWeight: op('multiply', { a: .45, b: 1 }),
    rimWeight: op('multiply', { a: .7, b: .5 }),
    patinaWeight: op('multiply', { a: 26, b: .01 }),
    ageFactor: op('data.get', { key: input('age'), record: { fresh: 0, aged: 1 } }),
    glazeAmount: op('data.record', { opacity: ref('shineWeight') }),
    rimAmount: op('data.record', { opacity: ref('rimWeight') }),
    ageAmount: op('data.record', { opacity: { node: 'patinaAmount' } }),
    patinaAmount: op('multiply', { a: ref('patinaWeight'), b: ref('ageFactor') }),
    glazed: op('raster.blend', { background: ref('surface'), foreground: ref('glare'), options: ref('glazeAmount') }),
    trimmed: op('raster.blend', { background: ref('glazed'), foreground: ref('edge'), options: ref('rimAmount') }),
    final: op('raster.blend', { background: ref('trimmed'), foreground: ref('weathering'), options: ref('ageAmount') })
  },
  outputs: { preview: ref('final') },
  exports: { medallion: { output: 'preview', format: 'png' } }
}, { id: 'kiln-medallion' });

const select = rows => rows.map(([label, value]) => ({ label, value }));
const expose = { kind: 'expose', parameters: {
  colorway: { label: 'Colorway', group: 'Glaze', widget: 'select', order: 10,
    options: select([['Coastal teal', 'coast'], ['Kiln copper', 'kiln'], ['Twilight blue', 'twilight']]) },
  gloss: { target: { node: 'shineWeight', port: 'a' }, label: 'Gloss', group: 'Glaze', widget: 'slider',
    min: 0, max: 1, step: .05, order: 20 },
  age: { label: 'Surface age', group: 'Weathering', widget: 'select', order: 30,
    options: select([['Fresh fired', 'fresh'], ['Weathered', 'aged']]) },
  patina: { target: { node: 'patinaWeight', port: 'a' }, label: 'Patina coverage', group: 'Weathering', widget: 'slider',
    min: 0, max: 100, step: 1, units: '%', order: 40,
    visibleWhen: { op: 'eq', args: [{ source: 'control', name: 'age' }, 'aged'] } },
  details: { label: 'Show coat detail', group: 'Coat', widget: 'toggle', order: 50 },
  coat: { target: { node: 'rimWeight', port: 'a' }, label: 'Coat thickness', group: 'Coat', widget: 'number',
    min: 0, max: 2, step: .05, units: 'mm', order: 60, visibleWhen: { source: 'control', name: 'details' } }
}};
const set = { kind: 'set', instance: 'kiln', values: { colorway: 'kiln', gloss: .7, age: 'aged', patina: 62, coat: 1.4 } };
const exposed = Ink.editMaterialParameters(before, expose).document;
const { document, inspector } = Ink.editMaterialParameters(exposed, set);
Ink.writeMaterialGraph(at('before.material.json'), before);
Ink.writeMaterialGraph(at('medallion.material.json'), document);
files.json(at('expose.json'), expose);
files.json(at('set.json'), set);
files.json(at('reset.json'), { kind: 'reset', instance: 'kiln' });
files.json(at('inspector.json'), inspector);
const ready = Ink.readGraphProject(at('medallion.material.json'), { instance: 'kiln' });
for (const artifact of ready.run().artifacts) files.write(at(artifact.file), artifact.bytes);
files.write(at('data.js'), 'const medallion = ' + JSON.stringify({
  graph: toGraphProject(document), scope: { inputs: document.graph.inputs, outputs: document.graph.outputs, controls: document.controls },
  overrides: document.instances.kiln.overrides, exposeCount: Object.keys(expose.parameters).length
}) + ';\n');
files.write(at('toolkit.js'), Ink.bundle());
files.write(at('demo.html'), fs.readFileSync(path.join(__dirname, 'demo.html')));
console.log(at('demo.html'));
