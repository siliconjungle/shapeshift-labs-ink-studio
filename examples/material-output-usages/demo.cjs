const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const PNG = require('../../cli/png.js');

const directory = path.resolve(process.argv[2] ?? 'outputs/material-output-usages');
const at = name => path.join(directory, name);
const size = 72;
const count = size * size;
const clamp = value => Math.max(0, Math.min(1, value));
const link = node => ({ node, port: 'value' });
const op = (op, inputs) => ({ op, inputs });

function tile(x, y, col, row) {
  const edge = Math.hypot(Math.max(Math.abs(x) - 29, 0), Math.max(Math.abs(y) - 29, 0));
  const fleck = ((Math.imul(col + 7, 129937) ^ Math.imul(row + 51, 61757)) & 31) / 31;
  const glaze = Math.round(5 * fleck - y * .29 + 2 * Math.sin(x * .24 + y * .19));
  const brass = [208, 143, 69], darkBrass = [135, 72, 45], cream = [249, 206, 130];
  let color = [23 + glaze, 65 + glaze, 70 + glaze], height = 0, ao = .93 - .08 * fleck;
  let rough = .53 + .1 * fleck, metal = .06, glass = 0;
  if (edge > 4.4) return { color: [13, 26, 34], height: -.55, ao: .53, rough: .8, metal: .02, glass };
  if (edge > 3.35) {
    color = x + y < -3 ? [103, 151, 145] : [33, 65, 68];
    height = .32;
    rough = .45;
  } else if (edge > 1.6) {
    color = x + 1.4 * y < 0 ? [62, 111, 111] : [19, 44, 50];
    height = .64;
    rough = .48;
  } else if (edge > .65) {
    color = x + y < 0 ? [152, 151, 105] : [142, 95, 61];
    height = .28;
    metal = .65;
  }
  const ax = Math.abs(x), ay = Math.abs(y);
  const corner = Math.abs(ax - 23) / 3.5 + Math.abs(ay - 22) / 4.2;
  const halo = Math.hypot(x, y + 1);
  if (corner < 1 || Math.abs(halo - 25.1) < .48) {
    color = corner < 1 ? brass : [102, 143, 130];
    height = .25;
    metal = corner < 1 ? .67 : .23;
    rough = .42;
  }
  const hook = Math.hypot(x - .5, y + 20);
  const roof = y >= -16 && y < -6 && ax < (y + 18) * 1.17 + 3;
  const lid = y >= -7 && y < -4 && ax < 17;
  const stand = y >= 13 && y < 18 && ax < 13 + (y - 13) * .75;
  const body = y >= -5 && y < 14 && ax < 12.8 - (y + 3) * .094;
  const ring = hook < 4.65 && hook > 2.6;
  if (ax < 18 && y >= 18 && y < 23) {
    color = [19, 49, 54];
    ao = .6;
  }
  if (ring || roof || lid || stand || body) {
    const lit = ax < 2.5 || x < -5 && y < 4;
    color = lit ? cream : x > 6 || y > 14 ? darkBrass : brass;
    height = roof ? 1.15 + (ax / 17) * -.4 : lid || stand ? 1.22 : 1;
    ao = lid && y >= -5 || stand && y === 13.5 ? .53 : .78 + .14 * fleck;
    rough = .25 + .09 * fleck;
    metal = .82;
    if (body && ax > 1.5 && ax < 9.1 - (y + 2) * .10 && y >= -2 && y < 12) {
      const gradient = clamp(.77 - Math.abs(y - 2) * .055 - (ax - 1.5) * .046);
      color = [Math.round(130 + 125 * gradient), Math.round(68 + 138 * gradient), Math.round(41 + 60 * gradient)];
      if (x > -7.7 && x < -5.8 && y >= -.5 && y < 4.5) color = [255, 225, 151];
      height = .56;
      ao = .76 + .19 * gradient;
      rough = .13 + .03 * fleck;
      metal = .02;
      glass = .44 + .55 * gradient;
    }
  }
  return { color, height, ao, rough, metal, glass };
}

const texels = [];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
  texels.push(tile(x - 35.5, y - 35.5, x, y));
const height = (x, y) => texels[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))].height;
const normals = [];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const dx = height(x - 1, y) - height(x + 1, y), dy = height(x, y - 1) - height(x, y + 1);
  const scale = Math.hypot(dx, dy, .78);
  normals.push(dx / scale, dy / scale, .78 / scale);
}

const descriptor = { pixelPitchMm: [.8, .8], tiling: { u: 'clamp', v: 'clamp' }, sampling: 'nearest' };
function image(data, intent, extra, channels = 1) {
  return op('image.declare', { source: { width: size, height: size, data, channels }, descriptor: { intent, ...descriptor, ...extra } });
}
const maps = {};
function define(id, usage, label, order, bitDepth, source, extra = {}) {
  maps[id] = { usage, label, order, format: bitDepth ? { format: 'png', bitDepth } : { format: 'json' }, source, ...extra };
}
const packet = channel => ({ output: 'surface', channel });
define('enamel', 'baseColor', 'Base color', 10, 8, { output: 'color' });
define('occlusion', 'ao', 'Ambient occlusion', 20, 8, packet('ao'));
define('roughness', 'roughness', 'Roughness', 30, 16, packet('roughness'));
define('metallic', 'metalness', 'Metalness', 40, 8, packet('metalness'));
define('normal', 'normal', 'Tangent normal', 50, 8, { output: 'normal' });
define('relief', 'height', 'Relief height', 60, 0, { output: 'relief' });
define('glass', 'mask.glass', 'Glass mask', 70, 8, { output: 'glass' }, { export: false });
maps.delivery = { usage: 'packed', label: 'Packed delivery', order: 80, format: { format: 'png', bitDepth: 16 },
  packing: { r: { map: 'occlusion' }, g: { map: 'roughness' }, b: { map: 'metallic' }, a: { map: 'glass' } } };

const document = Ink.openMaterialGraph({
  format: 'ink-studio/graph-project', version: 1, outputUsages: maps,
  nodes: {
    color: image(texels.flatMap(pixel => pixel.color), 'color', { precision: 'unorm8' }, 3),
    normal: image(normals, 'normal', {}, 3),
    relief: image(texels.map(pixel => pixel.height), 'height', { units: 'mm' }),
    ao: image(texels.map(pixel => pixel.ao), 'mask'),
    roughness: image(texels.map(pixel => pixel.rough), 'mask'),
    metalness: image(texels.map(pixel => pixel.metal), 'mask'),
    glass: image(texels.map(pixel => pixel.glass), 'mask'),
    inputs: op('data.record', { ao: link('ao'), roughness: link('roughness'), metalness: link('metalness') }),
    packet: op('material.pack', { maps: link('inputs') })
  },
  outputs: { color: link('color'), normal: link('normal'), relief: link('relief'), glass: link('glass'), surface: link('packet') }
}, { id: 'lantern-enamel' });

const file = at('lantern.material.json');
Ink.writeMaterialGraph(file, document);
files.json(at('maps.json'), maps);
const project = Ink.readGraphProject(file), { report, artifacts } = project.run();
for (const artifact of artifacts) files.write(at(artifact.file), artifact.bytes);
files.json(at('report.json'), report);

const packed = artifacts.find(artifact => artifact.name === 'delivery');
const decoded = PNG.raster(packed.bytes).data;
for (let pixel = 0; pixel < count; pixel++) {
  const { ao, rough, metal, glass } = texels[pixel];
  const values = [ao, rough, metal, glass];
  for (let channel = 0; channel < 4; channel++)
    assert.equal(decoded[pixel * 4 + channel], Math.round(values[channel] * 65535));
}
const uri = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const preview = (map, component) => {
  const result = project.inspect({ map, component });
  const [artifact] = result.artifacts;
  return { image: uri(artifact.bytes), ...result.report.materialPreview };
};
const payload = report.outputUsages.map(row => ({
  ...row, preview: preview(row.id),
  ...(row.artifact && { download: 'data:application/octet-stream;base64,' +
    artifacts.find(artifact => artifact.name === row.id).bytes.toString('base64') }),
  ...(row.packing && { components: Object.fromEntries(Object.keys(row.packing).map(component => [component, preview(row.id, component)])) })
}));
files.write(at('data.js'), 'const maps = ' + JSON.stringify(payload) + ';\n');
files.write(at('demo.html'), fs.readFileSync(path.join(__dirname, 'demo.html')));
console.log(at('demo.html'));
