const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const { json } = require('../../cli/asset-files.js');

const directory = path.resolve(process.argv[2] ?? 'outputs/material-subgraphs');
const at = name => path.join(directory, name);
const file = at('glaze-library.material.json');
const options = { baseDir: directory, sourceFile: file };
const project = graph => ({ format: 'ink-studio/graph-project', version: 1, nodes: {}, outputs: {}, ...graph });
const input = name => ({ input: name });
const link = (node, port = 'value') => ({ node, port });
const greens = ['#10232a', '#294950', '#42726d', '#8eb583', '#f3e8b8'];
const reds = ['#211821', '#422838', '#8d4544', '#db8561', '#f8d99b'];
const size = 64;

function plate(kind) {
  const leafCount = 7;
  const values = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const x = col - 31.5, y = row - 31.5, ax = Math.abs(x), ay = Math.abs(y);
    const border = Math.hypot(Math.max(ax - 25, 0), Math.max(ay - 25, 0));
    const grain = (Math.imul(row + 13, 12149) ^ Math.imul(col + 41, 5659)) % 13;
    let value = .29 - (x + 2 * y) * .0014 + grain * .0023;
    if (border > 4.8) value = .03;
    else if (border > 4) value = x + y < 1 ? .67 : .17;
    else if (border > 2.55) value = x + y < 5 ? .43 : .20;
    else if (border > 1.3) value = .14;
    else if (border > .48) value = .48;
    if (ax > 25 || ay > 25) { values.push(value); continue; }

    const radius = Math.hypot(x, y + 1);
    if (Math.abs(radius - 22.1) < .48) value = .53 - (x + y) * .0019;
    if (Math.abs(ax - 20.5) + Math.abs(ay - 20.5) < 1.6) value = .72;
    if (kind === 'sun') {
      const angle = Math.atan2(y + 1, x);
      const ray = Math.abs(Math.sin(angle * 6));
      if (radius < 8.4) value = y < -2 ? .9 : .79;
      else if (radius < 10) value = .51;
      else if (radius < 18.9 - 7.6 * ray && radius > 11.7) value = .84 - (y + 10) * .005;
      if (y > 14 && ax < 14.5 && Math.abs(y - 16 - Math.sin(x * .27) * 1.4) < .5) value = .65;
    } else {
      const curve = .009 * (y + 2) ** 2 - 2.3;
      if (y > -20 && y < 17 && Math.abs(x - curve) < .8) value = .83;
      for (let leaf = 0; leaf < leafCount; leaf++) {
        const sy = 12 - 4.35 * leaf, span = 15.5 - 1.7 * leaf;
        const origin = .009 * (sy + 2) ** 2 - 2.3;
        for (const side of [-1, 1]) {
          const run = side * (x - origin), start = sy - (side > 0 ? 1.7 : 0);
          if (run <= 0 || run >= span) continue;
          const phase = run / span;
          const rib = start - run * (.33 + .19 * phase);
          const width = 2.6 * Math.sin(Math.PI * phase) * (1 - leaf * .065);
          if (Math.abs(y - rib) < width) value = y < rib ? .92 - leaf * .017 : .70;
        }
      }
    }
    values.push(value);
  }
  return { width: size, height: size, channels: 1, data: values };
}

function definition(kind) {
  return Ink.openMaterialGraph(project({
    inputs: { pigments: { type: 'array<string>', default: greens } },
    nodes: {
      relief: { op: 'data.typed', type: 'raster', inputs: { value: { value: plate(kind) } } },
      glaze: { op: 'color.gradient', inputs: { source: link('relief'), ramp: input('pigments'), options: { channel: 0, range: [0, 1] } } },
      color: { op: 'image.declare', inputs: { source: link('glaze'), descriptor: { intent: 'color' } } },
      height: { op: 'image.declare', inputs: { source: link('relief'), descriptor: { intent: 'height', units: 'mm' } } }
    },
    outputs: { baseColor: link('color'), height: link('height') }
  }), { id: kind + '-glaze' });
}

const families = ['Fern', 'Sun'];
let material = Ink.openMaterialGraph(project({}), { id: 'glaze-library' });
function amend(document, request) {
  return Ink.editMaterialSubgraph(document, request, options).document;
}
for (const group of families) {
  const kind = group.toLowerCase();
  const reference = 'library/' + kind + '.group.json';
  const authored = definition(kind);
  Ink.writeMaterialGraph(at('library/' + kind + '.material.json'), authored);
  const { revision, sha256 } = Ink.publishMaterialSubgraph(at(reference), authored, { revision: 1 });
  material = amend(material, { kind: 'publish', group, reference: { file: reference, revision, sha256 } });
}

for (const node of ['fernA', 'fernB']) {
  material = amend(material, { kind: 'insert', group: 'Fern', node });
  const display = node + '-display';
  material.graph.nodes[display] = { op: 'image.toDisplay' };
  material.graph.outputs[node] = {};
  material.graph.links[node + '-color'] = { from: link(node, 'baseColor'),
    to: { node: display, slot: 'inputs', port: 'source' } };
  material.graph.links[node + '-preview'] = { from: link(display), to: { output: node } };
}
material.settings.exports = { fernA: { output: 'fernA', format: 'png' }, fernB: { output: 'fernB', format: 'png' } };
const override = node => ({ kind: 'override', node, overrides: { pigments: reds } });
const reset = node => ({ kind: 'reset', node });
const replace = node => ({ kind: 'replace', node, group: 'Sun' });
Ink.writeMaterialGraph(file, amend(material, override('fernB')));
json(at('override.json'), override('fernA'));
json(at('reset.json'), reset('fernB'));
json(at('replace.json'), replace('fernB'));
json(at('inspect.json'), { kind: 'inspect', node: 'fernB' });

const states = [
  { group: 'Fern', override: false }, { group: 'Fern', override: true },
  { group: 'Sun', override: false }, { group: 'Sun', override: true }
];
const frames = {};
function configure(document, node, state) {
  if (state.group === 'Sun') document = amend(document, replace(node));
  document = amend(document, override(node));
  return state.override ? document : amend(document, reset(node));
}
for (const [a, left] of states.entries()) for (const [b, right] of states.entries()) {
  const document = configure(configure(material, 'fernA', left), 'fernB', right);
  const graph = Ink.createGraphProject(document, options);
  const { artifacts } = graph.run();
  frames[a + '-' + b] = Object.fromEntries(artifacts.map(({ name, bytes, sha256 }) => {
    const item = graph.describeSubgraph({ node: name });
    return [name, { ...item, source: { ...item.source, file: path.relative(directory, item.source.file) },
      image: 'data:image/png;base64,' + bytes.toString('base64'), sha256 }];
  }));
}
assert.equal(frames['0-0'].fernA.sha256, frames['0-1'].fernA.sha256);
assert.notEqual(frames['0-0'].fernB.sha256, frames['0-1'].fernB.sha256);
assert.notEqual(frames['0-1'].fernB.sha256, frames['0-3'].fernB.sha256);

fs.writeFileSync(at('frames.js'), 'const frames = ' + JSON.stringify(frames) + ';\n');
fs.copyFileSync(path.join(__dirname, 'demo.html'), at('demo.html'));
console.log(at('demo.html'));
