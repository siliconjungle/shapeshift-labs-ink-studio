const assert = require('node:assert/strict');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/graph-image-types');
const at = file => path.join(out, file);
const width = 160, height = 112;
const clamp = n => Math.min(1, Math.max(0, n));
const byte = n => Math.round(255 * clamp(n));
const op = (op, inputs) => ({ op, inputs });
const link = (node, port = 'value') => ({ node, port });

function art() {
  const drawing = new Uint8Array(width * height * 4), enamel = new Uint8Array(drawing.length);
  const mask = { width, height, channels: 1, data: [] };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x - 79.5, dy = y - 59, radius = Math.hypot(dx, Math.min(0, dy));
    const panel = Math.max(Math.abs(dx) - 62, Math.abs(y - 55.5) - 46, (Math.abs(dx) + Math.abs(y - 55.5) - 101) / 1.414);
    const onPanel = panel <= 0;
    const footing = y >= 92 && y <= 101 && Math.abs(dx) < 57;
    const inside = radius < 32 && y < 96;
    const paving = (y + 5) % 15 === 0 || (x + Math.floor(y / 15) % 2 * 11) % 23 === 0;
    const arch = radius >= 32 && radius < 46 && y < 94;
    const band = radius >= 46 && radius < 51 && y < 94;
    const angle = Math.atan2(Math.min(dy, 0), dx);
    const joint = dy < 0 && Math.abs(Math.sin(angle * 9)) < .13 || dy >= 0 && (y - 55) % 12 === 0;
    const lip = Math.min(Math.abs(radius - 33), Math.abs(radius - 44.5));
    const rivet = Math.hypot(Math.abs(dx) - 54, y - 80) < 3;
    const star = Math.abs(dx) + 1.35 * Math.abs(y - 45) < 6 || Math.abs(dx) < .75 && Math.abs(y - 45) < 11;
    const sigil = inside && (star || Math.abs(Math.hypot(dx, y - 45) - 14) < 1);
    const sweep = Math.abs(y - 73 - Math.sin(dx * .12) * 3) < 1.25 ||
      Math.abs(y - 81 - Math.sin(dx * .12 - 1) * 3) < 1;
    const inscribed = inside && sweep && Math.abs(dx) < 25;
    const noise = ((Math.imul(x + 3, 8753) ^ Math.imul(y + 13, 4033)) & 31) / 31 - .5;
    let value = .04, palette = [.09, .13, .16];
    if (onPanel) {
      value = .20 + .10 * clamp(-panel / 2) + .025 * noise;
      palette = paving ? [.07, .12, .16] : [.115, .22, .27];
      if (paving) value -= .07;
      if (panel >= -3.5) { value += .38; palette = [.22, .25, .25]; }
      if (inside) { value *= .29; palette = [.035, .085, .105]; }
      if (band) { value += .17; palette = [.16, .265, .30]; }
      if (arch) {
        value = joint ? .41 : .63 + .29 * clamp((lip - .4) / 2.6) + noise * .035;
        palette = joint ? [.18, .136, .115] : [.49, .34, .185];
      }
      if (footing) { value = .32 + .32 * clamp((y - 92) / 3); palette = [.29, .215, .145]; }
      if (sigil || inscribed) { value = sigil ? .49 : .24; palette = sigil ? [.47, .365, .21] : [.095, .28, .30]; }
      if (rivet) { value = .63; palette = [.46, .30, .17]; }
    }
    const index = 4 * (y * width + x);
    drawing.set([byte(value * 1.07), byte(value * .99), byte(value * .88), 255], index);
    const light = .86 + .29 * value + .09 * noise;
    enamel.set([...palette.map(component => byte(component * light)), 255], index);
    mask.data.push(onPanel ? 255 : 0);
  }
  return { drawing, enamel, mask };
}

function lamp(x, y, color) {
  const data = new Uint8Array(width * height * 4);
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
    const a = byte(clamp(1 - Math.hypot(i, j) / 4) * .7);
    data.set([...color, a], ((y + j) * width + x + i) * 4);
  }
  return data;
}

const { drawing, enamel, mask } = art();
for (const [name, pixels] of Object.entries({ paint: drawing, enamel,
  lantern: lamp(56, 27, [255, 177, 78]), water: lamp(111, 81, [68, 200, 240]) }))
  files.write(at(name + '.png'), PNG.encode(width, height, pixels, 4));

const assets = Object.fromEntries(['paint', 'enamel', 'lantern', 'water'].map(name => [name, { format: 'png', file: name + '.png' }]));
const plan = {
  format: 'ink-studio/graph-project', version: 1, assets,
  nodes: {
    ...Object.fromEntries(Object.keys(assets).map(name => [name, op('pngAsset', { name })])),
    drawing: op('image.declare', { source: link('paint'), descriptor: {
      intent: 'color', colorSpace: 'srgb', alpha: 'straight', tiling: { u: 'mirror', v: 'clamp' }, sampling: 'nearest' } }),
    height: op('image.toHeight', { source: link('drawing'), scale: 10, offset: -.7, units: 'art-px' }),
    unpackHeight: op('image.toRaster', { source: link('height') }),
    map: op('color.gradient', { source: link('unpackHeight'), ramp: ['#162230', '#344a79', '#759fc8', '#e3e6cf'],
      options: { channel: 0, range: [-.7, 8.3] } }),
    warm: op('fx.relight', { emission: link('lantern'), height: link('height'), mask,
      options: { radius: 100, emitterHeight: 13, strength: .37, sampleStep: 1 } }),
    cool: op('fx.relight', { emission: link('water'), height: link('height'), mask,
      options: { radius: 100, emitterHeight: 10, strength: .33, sampleStep: 1 } }),
    gold: op('raster.blend', { background: link('enamel'), foreground: link('warm'), options: { mode: 'add', opacity: .6 } }),
    finish: op('raster.blend', { background: link('gold'), foreground: link('cool'), options: { mode: 'add', opacity: .53 } })
  },
  outputs: { imported: link('drawing'), relief: link('height'), heightPreview: link('map'), lit: link('finish') },
  exports: { relief: { output: 'relief', format: 'json' }, relief_preview: { output: 'heightPreview', format: 'png' },
    lit: { output: 'lit', format: 'png' } }
};

const rejected = structuredClone(plan);
rejected.nodes.warm.inputs.height = link('drawing');
let error;
assert.throws(() => Ink.createGraphProject(rejected, { baseDir: out }), cause => {
  error = cause.message;
  return /warm\.height.*typed color image.*height in art pixels.*image\.toHeight/.test(error);
});
const file = at('tideglass.material.json');
Ink.writeMaterialGraph(file, Ink.openMaterialGraph(plan, { id: 'tideglass' }));
const result = Ink.readGraphProject(file).run();
for (const artifact of result.artifacts) files.write(at(artifact.file), artifact.bytes);
assert.notDeepEqual(result.outputs.lit.data, enamel);
const { imported, relief } = result.report.outputs;
files.json(at('receipt.json'), { error, imported, relief });
console.log('Rejected the RGB link and relit the explicitly converted height field in ' + out);
