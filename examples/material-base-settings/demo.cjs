const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/material-base-settings');
const at = file => path.join(out, file);
const size = 96;
const clamp = n => Math.max(0, Math.min(1, n));
const mix = (a, b, t) => a.map((value, axis) => Math.round(value + (b[axis] - value) * t));

function stamp() {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x - 47.5, v = y - 47.5;
    const edge = Math.max(Math.abs(u), Math.abs(v));
    const radius = Math.hypot(u, v);
    const inlay = Math.min(Math.abs(radius - 34), Math.abs(radius - 38));
    const angle = Math.atan2(v, u);
    const wave = Math.sin(u*.15 + .6);
    const crest = Math.abs(v - (16 + wave * 4)) < 1.3 && Math.abs(u) < 28;
    const foam = Math.abs(v - (23 + Math.sin(u*.17 + 1.2)*3)) < .8 && Math.abs(u) < 18;
    const body = Math.hypot((u + 1)/19, (v + 5 + .20*u)/8.6) < 1;
    const tail = u > 13 && u < 26 && Math.abs(Math.abs(v+8) - (u-13)*.46) < (3.5-(u-13)*.13);
    const fin = u > -2 && u < 8 && v > -1 && v < 9 &&
      Math.abs((u - 1) - .32*v) < 5.3 - .39*v;
    const eye = Math.hypot(u + 12, v + 7) < 1.45;
    const ray = Math.abs(u + 1) + 1.7*Math.abs(v + 22) < 7 ||
      Math.abs(u + 1) < .8 && Math.abs(v + 22) < 7.5;
    const bubble = Math.min(Math.hypot(u + 25, v + 12), Math.hypot(u + 21, v + 19)) < 1.7;
    const ornament = radius > 35.2 && radius < 36.6 && Math.abs(Math.sin(angle*24)) < .33;
    const worn = ((Math.imul(x+17, 17539) ^ Math.imul(y+13, 7837)) & 31) / 31;
    const gradient = clamp(.47 + (-u-v) / 230 + .07 * Math.sin(u*.21 + v*.05) + .07*worn);
    const sea = radius < 35 ? mix([17, 41, 53], [60, 130, 126], gradient) :
      mix([22, 37, 53], [65, 91, 97], gradient);
    const gold = mix([103, 63, 48], [255, 222, 143], clamp(.18+1.08*gradient));
    let rgb = sea;
    if (edge > 44) rgb = mix([24, 35, 43], gold, .23 + .25 * (v < 0));
    if (Math.abs(edge - 42.5) < .65 || inlay < 1 || ornament) rgb = gold;
    if (crest || foam) rgb = mix(sea, [125, 195, 168], crest ? .73 : .43);
    if (body || tail || fin) {
      const curve = .39 + .35 * Math.sin((u + v*.64)*.22)*Math.sin((v+u*.15)*.31);
      rgb = mix(gold, [254, 224, 157], clamp(curve+(v < -9 ? .24 : 0)));
      if (v > -1) rgb = mix(rgb, [111, 67, 47], .32);
    }
    if (eye) rgb = [17, 36, 43];
    if (ray || bubble) rgb = mix(gold, [248, 231, 166], ray ? .54 : .26);
    pixels.set([...rgb, 255], (y*size+x)*4);
  }
  return pixels;
}

const pixelData = stamp();
files.write(at('stamp.png'), PNG.encode(size, size, pixelData, 4));
const link = (node, port = 'value') => ({ node, port });
const setting = { input: 'materialBase' };
const node = (op, inputs) => ({ op, inputs });
const shared = { pixelSizeMm: .7, pixelRatio: [1, 1], tiling: { u: 'wrap', v: 'mirror' }, seed: 17 };
const presets = {
  wide: { ...shared, size: { width: 124, height: 84, lock: false }, output: { format: 'png', bitDepth: 8 } },
  locked: { ...shared, size: { width: 108, height: 84, lock: true }, output: { format: 'png', bitDepth: 16 } },
  reseeded: { ...shared, seed: 91, pixelRatio: [5, 4], size: { width: 108, height: 84, lock: true }, output: { format: 'json' } }
};
const graph = {
  format: 'ink-studio/graph-project', version: 1, base: presets.wide,
  assets: { stamp: { format: 'png', file: 'stamp.png' } },
  nodes: {
    stock: node('pngAsset', { name: 'stamp' }),
    defaults: node('material.base', { settings: setting }),
    pigment: node('image.declare', { source: link('stock'), descriptor: { intent: 'color', sampling: 'linear' } }),
    plate: node('material.imageOutput', { source: link('pigment'), settings: setting }),
    display: node('image.toDisplay', { source: link('plate') }),
    glaze: node('proc.noise', { definition: { type: 'fbm', scale: 17, axes: ['x', 'y'], octaves: 4 } }),
    field: node('proc.sample', { source: link('glaze'), options: link('defaults', 'samples') }),
    stains: node('color.gradient', { source: link('field'), ramp: ['#161c2d', '#71727a', '#d3c0a0'],
      options: { channel: 0, range: [-.63, .63] } }),
    fired: node('raster.blend', { background: link('display'), foreground: link('stains'),
      options: { mode: 'softLight', opacity: .69 } }),
    color: node('image.declare', { source: link('fired'), descriptor: { intent: 'color' } }),
    colorOutput: node('material.imageOutput', { source: link('color'), settings: setting }),
    scaled: node('raster.math', { a: link('field'), b: .37, op: 'multiply' }),
    bias: node('raster.math', { a: link('scaled'), b: .55, op: 'add' }),
    low: node('raster.math', { a: link('bias'), b: 0, op: 'max' }),
    high: node('raster.math', { a: link('low'), b: 1, op: 'min' }),
    glazeMap: node('image.declare', { source: link('high'), descriptor: { intent: 'data', units: 'unitless' } })
  },
  outputs: { color: link('colorOutput'), roughness: link('glazeMap') },
  exports: { pigment: { output: 'color', format: 'material-image' },
    roughness: { output: 'roughness', format: 'material-image' } }
};
const authored = Ink.openMaterialGraph(graph, { id: 'ferry-glaze' });
authored.label = 'Ferry glaze';
const kit = Ink.load(), preview = image => kit.KIT.procedural.graphImages.toDisplay(image);
const receipt = {};
for (const [id, base] of Object.entries(presets)) {
  const material = { ...authored, settings: { ...authored.settings, base } };
  const project = at(id + '.material.json');
  Ink.writeMaterialGraph(project, material);
  const result = Ink.readGraphProject(project).run();
  for (const artifact of result.artifacts) files.write(at(id + '/' + artifact.file), artifact.bytes);
  const { raster: map } = result.outputs.roughness;
  const previewMap = Uint8Array.from(map.data, n => Math.round(n * 255));
  files.write(at(id + '-roughness.png'), PNG.encodeGray(map.width, map.height, previewMap));
  const color = preview(result.outputs.color);
  files.write(at(id + '-color.png'), PNG.encode(color.width, color.height, color.data, color.channels));
  receipt[id] = { ...result.report.base, physicalSizeMm: Ink.readGraphProject(project).plan().physicalSizeMm,
    roughness: result.artifacts.find(row => row.name === 'roughness').sha256 };
}
assert.notEqual(receipt.locked.roughness, receipt.reseeded.roughness);
assert.equal(receipt.locked.size.width, receipt.locked.size.height);
files.json(at('receipt.json'), receipt);

const browserSpec = { inputs: { materialBase: 'record', pigment: 'raster' },
  nodes: { ...graph.nodes, stock: { op: 'data.typed', type: 'raster', inputs: { value: { input: 'pigment' } } } },
  outputs: graph.outputs };
files.write(at('toolkit.js'), Ink.bundle());
files.write(at('recipe.js'), 'const ferryGlaze = ' + JSON.stringify({
  browserSpec, presets, rgba: { width: size, height: size, channels: 4, data: Array.from(pixelData) }
}) + ';\n');
files.write(at('demo.html'), fs.readFileSync(path.join(__dirname, 'controls.html')));
console.log('Saved the Ferry glaze demo and three material deliveries in ' + out);
