const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');

const directory = path.resolve(process.argv[2] ?? 'outputs/material-conditional-visibility');
const at = name => path.join(directory, name);
const w = 80, h = 64;
const mix = (a, b, f) => a.map((value, i) => Math.round(value + (b[i] - value) * Math.max(0, Math.min(1, f))));
const pigment = [], lens = [], brush = [], patina = [];
for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) {
  const x = ix - 39.5, y = iy - 31.5;
  const r = Math.hypot(x, y + 1.5), a = Math.atan2(y + 1.5, x);
  const edge = Math.hypot(Math.max(Math.abs(x) - 32, 0), Math.max(Math.abs(y) - 24, 0));
  const grain = ((Math.imul(ix + 9, 12397) ^ Math.imul(iy + 3, 6491)) & 31) / 31;
  const enamel = [26, 76, 76], bronze = [186, 123, 64], gold = [244, 197, 116], shadow = [14, 25, 31];
  let color = mix(enamel, [113, 152, 134], .19 - (x + 1.4 * y) * .003 + grain * .06), light = 0, metal = .08;
  let wear = Math.max(0, (x - y + 12) / 75) * (.48 + grain * .35);
  if (edge > 5.4) { color = shadow; wear = 0; }
  else if (edge > 3.8) { color = x + y < 0 ? bronze : [65, 54, 46]; metal = .62; }
  else if (edge > 2) { color = x + y < 0 ? [104, 148, 128] : [37, 70, 64]; metal = .24; }
  else if (edge > .65) color = mix(enamel, shadow, .44);
  for (const dx of [-29.5, 29.5]) for (const dy of [-19.5, 19.5]) {
    const bolt = Math.hypot(x - dx, y - dy);
    if (bolt < 3.4) {
      color = bolt < 2.2 ? (x - dx + y - dy < 0 ? gold : bronze) : [32, 48, 45];
      if (Math.abs(y - dy + .4 * (x - dx)) < .52) color = [64, 53, 43];
      metal = .86;
    }
  }
  if (r < 21.5) {
    metal = .9;
    color = r > 19.3 ? mix([78, 54, 37], gold, .43 - y * .019 - x * .006) :
      r > 17.6 ? [66, 56, 47] : r > 15.1 ? mix(bronze, gold, .45 - y * .02) : [64, 35, 35];
    if (r > 18.4 && r < 20.1 && Math.abs(Math.sin(a * 12)) < .32) color = gold;
    if (r < 14.8) {
      light = Math.max(.06, .89 - .034 * r + .008 * y + .07 * Math.cos(.68 * x));
      const ribs = Math.abs((x + 18) % 4 - 1.6) < .51;
      color = mix([77, 39, 41], [254, 210, 123], light - (ribs ? .17 : 0));
      if (x < -6 && y < 1 && y > -7 && x > -10.8) color = mix(color, [255, 235, 167], .48);
      if (Math.abs(y - 6 - .015 * x * x) < .62) color = mix(color, [80, 44, 42], .33);
      metal = .04;
      wear = .09 * grain;
    }
  }
  pigment.push(...color);
  lens.push(light);
  brush.push(metal * (.65 + .29 * grain));
  patina.push(Math.min(1, wear));
}

const op = (intent, data, channels = 1) => ({ op: 'image.declare', inputs: {
  source: { width: w, height: h, channels, data },
  descriptor: { intent, ...(intent === 'color' && { precision: 'unorm8' }) }
} });
const socket = (type, value) => ({ type, default: value });
const controls = {
  finish: socket('string', 'enamel'), signal: socket('boolean', true), glow: socket('number', .64),
  grain: socket('number', .45), wear: socket('number', .32), patina: socket('number', .38)
};
const maps = [
  ['pigment', 'baseColor', 'Base color'],
  ['lens', 'emission-mask', 'Signal mask'],
  ['brush', 'brush-lines', 'Brush mask'],
  ['patina', 'patina-map', 'Patina map']
];
const document = Ink.openMaterialGraph({
  format: 'ink-studio/graph-project', version: 1, inputs: controls,
  nodes: { pigment: op('color', pigment, 3), lens: op('mask', lens), brush: op('mask', brush), patina: op('mask', patina) },
  outputs: Object.fromEntries(maps.map(([node, id]) => [id, { node }])),
  outputUsages: Object.fromEntries(maps.map(([, id, label], order) => [id, {
    usage: id === 'baseColor' ? 'baseColor' : 'mask.' + id, label, order, format: { format: 'png', bitDepth: 8 }, source: { output: id }
  }]))
}, { id: 'signal-lens' });

const expr = (op, ...args) => ({ op, args });
const input = name => ({ source: 'input', name });
const enamel = expr('eq', input('finish'), 'enamel'), brushed = expr('eq', input('finish'), 'brushed');
const lamp = expr('and', enamel, { source: 'control', name: 'signal' });
const wear = expr('gte', input('wear'), .55);
for (const [id, label, visibleWhen] of [
  ['finish', 'Finish'], ['signal', 'Signal lamp', enamel], ['glow', 'Glow', lamp],
  ['grain', 'Brush grain', brushed], ['wear', 'Wear'], ['patina', 'Patina strength', expr('gte', input('wear'), '0.55')]
]) {
  document.controls[id].label = label;
  if (visibleWhen !== undefined) document.controls[id].visibleWhen = visibleWhen;
}
document.graph.inputs.glow.visibleWhen = lamp;
document.graph.inputs.grain.visibleWhen = brushed;
document.graph.outputs['emission-mask'].visibleWhen = lamp;
document.graph.outputs['brush-lines'].visibleWhen = brushed;
document.graph.outputs['patina-map'].visibleWhen = wear;

const graph = at('signal-lens.material.json');
Ink.writeMaterialGraph(graph, document);
const project = Ink.readGraphProject(graph);
const pictures = {};
for (const [, map, label] of maps) {
  const { artifacts: [artifact] } = project.inspect({ map });
  const file = 'previews/' + map + '.png';
  files.write(at(file), artifact.bytes);
  pictures[map] = { file, label };
}
files.json(at('initial-visibility.json'), Ink.inspectMaterialVisibility(document));
files.write(at('inspector.js'), 'const signalLens = ' + JSON.stringify({
  scope: { controls: document.controls, inputs: document.graph.inputs, outputs: document.graph.outputs },
  values: Object.fromEntries(Object.entries(controls).map(([id, { default: value }]) => [id, value])), pictures
}) + ';\n');
files.write(at('toolkit.js'), Ink.bundle());
files.write(at('demo.html'), fs.readFileSync(path.join(__dirname, 'demo.html')));
console.log(at('demo.html'));
