const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/uniform-graph-images');
const at = name => path.join(out, name);
const op = (op, inputs) => ({ op, inputs });
const link = node => ({ node });
const width = 20, height = 12;
const cases = {
  scalar: { label: 'Signed scalar', value: -2.75, descriptor: { intent: 'height', units: 'art-px' },
    note: 'The graph promotes a number to a height field. Each texel carries the same signed distance in art pixels.' },
  gray: { label: 'Grayscale', value: .375, descriptor: { intent: 'data', precision: 'unorm16' },
    note: 'The 16-bit map stores one integer code per texel. Color preview decodes that code to linear gray before the display transfer.' },
  rgb: { label: 'RGB', value: [.11, .69, .73], descriptor: { intent: 'color', precision: 'unorm8' },
    note: 'Each authored 0–1 channel is encoded as an 8-bit code. The RGB image carries no coverage channel.' },
  rgba: { label: 'RGBA', value: [.97, .52, .19, .55], descriptor: { intent: 'color', layout: 'rgba', precision: 'unorm8' },
    note: 'The fourth channel stores coverage. The checkerboard shows through the straight-alpha color preview.' },
  hdr: { label: 'HDR', value: [3.5, .5, -.125, .75],
    descriptor: { intent: 'color', layout: 'rgba', precision: 'float32', colorSpace: 'srgb-linear' },
    note: 'The native image stores 3.5 and −0.125 in linear light. The display branch explicitly clamps them for an 8-bit target.' }
};

const nodes = {}, outputs = {}, exportsSpec = {};
for (const [id, { value, descriptor }] of Object.entries(cases)) {
  nodes[id] = op('image.uniform', { value: id === 'scalar' ? { input: 'heightOffset' } : value, width, height, descriptor });
  outputs[id] = link(id);
  exportsSpec[id] = { output: id, format: 'json' };
}
nodes.grayColor = op('image.convert', { source: link('gray'), descriptor: { intent: 'color', precision: 'float64' } });
nodes.hdrDelivery = op('image.convert', {
  source: link('hdr'), descriptor: { intent: 'color', precision: 'unorm8' }, outOfRange: 'clamp'
});
outputs.hdrDelivery = link('hdrDelivery');
exportsSpec.hdrDelivery = { output: 'hdrDelivery', format: 'json' };
for (const [id, source] of Object.entries({ gray: 'grayColor', rgb: 'rgb', rgba: 'rgba', hdr: 'hdrDelivery' })) {
  const name = id + 'Preview';
  nodes[name] = op('image.toDisplay', { source: link(source) });
  outputs[name] = link(name);
  exportsSpec[name] = { output: name, format: 'png' };
}
const project = {
  format: 'ink-studio/graph-project', version: 1,
  inputs: { heightOffset: { type: 'number', default: cases.scalar.value } }, nodes, outputs, exports: exportsSpec
};
const strict = structuredClone(project);
delete strict.nodes.hdrDelivery.inputs.outOfRange;
let rejection;
assert.throws(() => Ink.createGraphProject(strict).run(), error => {
  rejection = error.message;
  return /outside \[0, 1\]/.test(rejection);
});

const materialFile = at('lantern-glass.material.json');
Ink.writeMaterialGraph(materialFile, Ink.openMaterialGraph(project, { id: 'lantern-glass' }));
const result = Ink.readGraphProject(materialFile).run();
for (const artifact of result.artifacts) files.write(at(artifact.file), artifact.bytes);
const pixel = image => Array.from(image.raster.data.slice(0, image.raster.channels));
const background = [15, 22, 30];

function lantern(glass) {
  const w = 144, h = 116, image = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x - 72, d = Math.abs(u);
    const checker = ((x * 7 + y * 19) % 97 === 3) ? 2 : 0;
    let color = background.map((n, i) => n + checker + Math.round(Math.max(0, 1 - Math.hypot(u, y - 54) / 75) * (i + 1) * 3));
    if ((x % 18 === 0 || y % 18 === 0) && x > 9 && x < 134 && y > 5 && y < 106) color = [25, 34, 42];
    if (Math.hypot(u * .48, (y - 101) * 1.4) < 19) color = [11, 16, 22];
    if (y >= 91 && y <= 100 && d < 31 - (y < 95 ? 3 : 0)) color = y === 91 ? [135, 109, 73] : [39, 45, 46];
    if (y >= 98 && y < 102 && d < 34) color = [23, 29, 33];
    if (y >= 37 && y < 87 && d < 26) {
      const inner = d <= 21 && y >= 43 && y <= 79;
      color = inner ? glass.map((n, i) => Math.round(n * (.57 + .33 * Math.max(0, 1 - Math.hypot(u + 4, y - 57) / 26)) +
        background[i] * .18)) : [63, 65, 60];
      if (d === 24 || y === 40 || y === 83) color = [169, 140, 90];
      if (inner && (d === 20 || y === 43 || y === 79)) color = [51, 56, 56];
      if (inner && u < -13 && y < 67 && (x + y) % 5 === 0) color = color.map(n => Math.min(255, n + 13));
      if (inner && Math.abs(d - 16) < 1) color = color.map(n => Math.round(n * .64));
      const diamond = Math.abs(u) + Math.abs(y - 60);
      if (inner && (diamond === 12 || y === 60 && d > 8 || u === 0 && (y < 51 || y > 69))) color = [44, 48, 50];
      if (inner && diamond < 8 && (d < 2 || Math.abs(y - 60) < 2 || diamond < 4))
        color = glass.map(n => Math.min(255, n + 49));
    }
    if (y >= 30 && y < 39 && d + (38 - y) * 1.6 < 30) color = y >= 36 ? [187, 155, 101] : [96, 83, 62];
    if (y >= 85 && y < 93 && d < 28) color = y === 87 ? [156, 133, 93] : [74, 69, 55];
    const ring = Math.hypot(u, y - 22);
    if (ring >= 5 && ring <= 8) color = y < 22 ? [173, 147, 102] : [114, 100, 73];
    if (y >= 27 && y < 33 && d < 4) color = [159, 137, 94];
    if ((y === 14 || y === 88) && d === 2) color = [237, 205, 144];
    image.set(color, (y * w + x) * 3);
  }
  return 'data:image/png;base64,' + PNG.encode(w, h, image, 3).toString('base64');
}

const receipt = {};
for (const [id, details] of Object.entries(cases)) {
  const image = result.outputs[id], preview = result.outputs[id + 'Preview'];
  const sample = preview ? Array.from(preview.data.slice(0, preview.channels)) : [118, 140, 176];
  const a = (sample[3] ?? 255) / 255;
  const glass = sample.slice(0, 3).map((n, i) => Math.round(n * a + background[i] * (1 - a)));
  receipt[id] = { ...details, spec: image.descriptor, stored: pixel(image), sample, art: lantern(glass),
    ...(id === 'hdr' && { delivered: pixel(result.outputs.hdrDelivery), rejection }) };
}
const template = fs.readFileSync(path.join(__dirname, 'demo.html'), 'utf8');
files.write(at('index.html'), Buffer.from(template.replace('/* EMBEDDED_RESULTS */', JSON.stringify(receipt))));
console.log('Wrote editable graph and conversion demo to ' + out);
