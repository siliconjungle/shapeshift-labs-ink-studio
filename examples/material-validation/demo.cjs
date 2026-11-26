const assert = require('node:assert/strict');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { save } = require('../../cli/graph-outputs.js');
const root = path.resolve(process.argv[2] ?? 'studio/out/material-validation');
const at = file => path.join(root, file);
const { graphImages: I } = Ink.load().KIT.procedural;

const width = 140, height = 112, count = width * height;
const cap = n => Math.min(1, Math.max(0, n));
const ramp = (threshold, value, feather = 1) => {
  const t = cap(.5 + (value - threshold) / feather);
  return t * t * (3 - 2 * t);
};
const line = (x, y, ax, ay, bx, by) => {
  const u = bx - ax, v = by - ay, t = cap(((x - ax) * u + (y - ay) * v) / (u * u + v * v));
  return Math.hypot(x - ax - t * u, y - ay - t * v);
};
const ellipse = (x, y, a, b, theta, rx, ry) => {
  const u = x - a, v = y - b, c = Math.cos(theta), s = Math.sin(theta);
  const r = Math.hypot((u * c + v * s) / rx, (v * c - u * s) / ry);
  return ramp(0, (1 - r) * ry, 1.15);
};
const color = new Uint8Array(count * 4), heightData = new Float32Array(count), roughness = new Float32Array(count);
const emission = new Float32Array(count * 3);
const leaves = [[-16, 9, .53, 19, 6.7], [10, 0, -.49, 20, 7.2], [-7, -13, .68, 16, 6.6], [18, -20, -.56, 15, 5.3],
  [9, -32, -1.08, 12, 4.5]];
const linear = { intent: 'color', colorSpace: 'srgb-linear' };
const pitch = { intent: 'height', units: 'mm' };
function hash(x, y) {
  const h = Math.imul(x + 86, 1767690321) ^ Math.imul(y + 133, 687311533);
  return (Math.imul(h ^ h >>> 15, 1749215) >>> 0) / 4294967295;
}
for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
  const u = x - (width - 1) / 2, v = y - (height - 1) / 2;
  const bevel = Math.min(62 - Math.abs(u), 47 - Math.abs(v), (95 - Math.abs(u) - Math.abs(v)) / Math.SQRT2);
  const outer = ramp(0, bevel), rim = ramp(0, Math.min(bevel - 6.0, 12 - bevel), .7);
  const thread = ramp(0, .73 - Math.abs(bevel - 16)), disc = Math.hypot(u / 43, v / 41);
  const engraving = ramp(0, .014 - Math.abs(disc - .91), .024);
  const warmth = Math.max(0, 1 - Math.hypot(u / 72, (v + 40) / 100));
  const grain = (.64 * hash(x, y) + .36 * hash(x >> 2, y >> 2)) - .5;
  const oxidation = cap(.46 + .23 * Math.sin(u * .15 + v * .11) + .18 * Math.cos(u * .27 - v * .339) + grain * .46);
  const stem = ramp(0, 1.22 - Math.min(line(u, v, -18, 35, -4, 10), line(u, v, -4, 10, 3, -12),
    line(u, v, 3, -12, 12, -40)), 1);
  let leaf = stem, veins = 0;
  for (const [a, b, theta, rx, ry] of leaves) {
    const shape = ellipse(u, v, a, b, theta, rx, ry);
    const length = line(u, v, a - .87 * rx * Math.cos(theta), b - .87 * rx * Math.sin(theta),
      a + .77 * rx * Math.cos(theta), b + .77 * rx * Math.sin(theta));
    leaf = Math.max(leaf, shape);
    veins = Math.max(veins, shape * ramp(0, .62 - length, .65));
  }
  const rivet = ramp(0, 3.2 - Math.hypot(Math.abs(u) - 50, Math.abs(v) - 33));
  const molten = ramp(0, 3.1 - Math.hypot(Math.abs(u) - 28, v + 15));
  const accent = Math.max(leaf * (.76 + .2 * veins), rim * .58, thread * .48, engraving * .5, rivet * .8);
  const reflectance = [
    [23, 70, 68], [177 + 42 * warmth, 112 + 44 * warmth, 51 + 38 * warmth]
  ];
  for (let c = 0; c < 3; c++) {
    const a = reflectance[0][c] + [7, 33, 35][c] * oxidation;
    color[p * 4 + c] = Math.round(a * (1 - accent) + reflectance[1][c] * accent + grain * 13);
  }
  color[p * 4 + 3] = Math.round(255 * outer);
  heightData[p] = (.12 * ramp(3, bevel, 7) + .12 * rim + .14 * rivet + .30 * leaf - .045 * veins +
    .014 * (grain + .5)) * outer;
  roughness[p] = .39 + .23 * oxidation + .105 * leaf + .11 * rim + .012 * grain;
  emission.set([1.68 * molten, .32 * molten, .099 * molten], 3 * p);
}
const declare = (channels, data, descriptor) => I.declare({ width, height, channels, data }, descriptor);
const h = declare(1, heightData, pitch);
const normal = I.normals.heightToNormal(h, { spacing: [.16, .16], orientation: 'directx' });
const n = normal.raster.data.slice();
for (let y = 54; y <= 58; y++) for (let x = 63; x <= 68; x++) n.fill(0, 3 * (y * width + x), 3 * (y * width + x) + 3);
const maps = {
  pigment: [declare(4, color, { intent: 'color', colorSpace: 'srgb' }), 'png', { intent: 'color', colorSpace: 'srgb' }],
  relief: [h, 'exr', pitch],
  direction: [declare(3, n, normal.descriptor), 'exr', { intent: 'normal', normalSpace: 'tangent', normalOrientation: 'directx' }],
  finish: [declare(1, roughness, { intent: 'data' }), 'exr', { intent: 'data' }],
  glow: [declare(3, emission, linear), 'exr', linear]
};
const ref = (node, port = 'value') => ({ node, port });
const op = (op, inputs) => ({ op, inputs });
const assets = {}, nodes = {};
for (const [name, [image, encoding, interpretation]] of Object.entries(maps)) {
  const file = 'sources/' + name + '.' + encoding;
  files.write(at(file), Ink.encodeTexture(image, { encoding, bitDepth: encoding === 'exr' ? 32 : 8 }));
  assets[name] = { format: 'bitmap', interpretation, source: { file } };
  nodes[name] = op('bitmapAsset', { name });
}

const profile = {
  aligned: true,
  required: ['baseColor', 'normal', 'height', 'roughness', 'emission'],
  maps: {
    height: { range: [0, .56], units: 'mm', delivery: { format: 'exr', bitDepth: 32 } },
    normal: { normalSpace: 'tangent', normalOrientation: 'opengl' },
    baseColor: { delivery: { format: 'png', bitDepth: 16 } },
    emission: { delivery: { format: 'exr', bitDepth: 32 } }
  }
};
files.json(at('validation.json'), profile);

function project(approved) {
  const settings = { tint: approved ? .81 : 1.58, tint2: approved ? .83 : 1.25, roughness: approved ? .04 : .32 };
  const session = { format: 'ink-studio/material-paint', version: 1,
    layers: [
      { id: 'sunlit-fronds', label: 'Sunlit fronds', channel: 'baseColor',
        strokes: [{ samples: [[46, 57], [51, 60], [58, 62]], brush: { radius: 2.8, hardness: .84 },
          value: [settings.tint, .39, .11], colorSpace: 'srgb-linear' }] },
      { id: 'copper-sparks', label: 'Copper sparks', channel: 'baseColor',
        strokes: [{ samples: [[91, 31], [94, 29], [97, 26]], brush: { radius: 2.7, hardness: .88 },
          value: [settings.tint2, .44, .17], colorSpace: 'srgb-linear' }] }
    ] };
  const group = {
    inputs: { source: 'materialChannels', finish: 'grayImage' },
    nodes: {
      polish: op('image.channelMath', { a: { input: 'finish' }, b: settings.roughness, operation: 'add' }),
      edits: op('data.record', { roughness: ref('polish') }),
      override: op('material.replace', { source: { input: 'source' }, maps: ref('edits') }),
      finalBrush: op('material.paint', { source: ref('override'), session })
    },
    outputs: { value: ref('finalBrush') }
  };
  const graph = {
    format: 'ink-studio/graph-project', version: 1, assets,
    groups: { FinishPass: group },
    nodes: {
      ...nodes,
      reliefGain: op('image.channelMath', { a: ref('relief'), b: approved ? 1 : 1.68, operation: 'multiply' }),
      ...(approved && {
        normalize: op('image.normalNormalize', { source: ref('direction') }),
        orientation: op('image.normalOrientation', { source: ref('normalize'), options: { orientation: 'opengl' } }),
        emissionCap: op('image.exposure', { source: ref('glow'), options: { stops: -1 } })
      }),
      ...(approved ? {} : { emissionClip: op('image.convert', { source: ref('glow'),
        descriptor: { intent: 'color', precision: 'unorm8', colorSpace: 'srgb' }, outOfRange: 'clamp' }) }),
      collect: op('data.record', { baseColor: ref('pigment'), height: ref('reliefGain'), roughness: ref('finish'),
        normal: ref(approved ? 'orientation' : 'direction'), emission: ref(approved ? 'emissionCap' : 'emissionClip') }),
      material: op('material.pack', { maps: ref('collect') }),
      craft: op('FinishPass', { source: ref('material'), finish: ref('finish') })
    },
    outputs: { surface: ref('craft') }
  };
  const doc = Ink.openMaterialGraph(graph, { id: approved ? 'copperleaf-approved' : 'copperleaf-review' });
  doc.label = approved ? 'Copperleaf — approved' : 'Copperleaf';
  const filename = at(approved ? 'copperleaf-approved.material.json' : 'copperleaf.material.json');
  Ink.writeMaterialGraph(filename, doc);
  return Ink.readGraphProject(filename);
}

for (const [name, approved] of [['review', false], ['approved', true]]) {
  const graph = project(approved), result = graph.validateMaterial({}, profile);
  assert.equal(result.report.valid, approved, JSON.stringify(result.report.findings));
  if (!approved) {
    const by = (channel, code) => result.report.findings.find(row => row.channel === channel && row.code === code);
    assert.deepEqual(by('baseColor', 'paint-clipping').sources.map(row => row.layer).sort(), ['copper-sparks', 'sunlit-fronds']);
    assert.equal(by('roughness', 'physical-range').sources[0].node, 'craft/polish');
    assert.equal(by('normal', 'convention').sources[0].node, 'direction');
    assert.equal(by('height', 'physical-range').sources[0].node, 'reliefGain');
    assert.equal(by('emission', 'conversion-clipping').sources[0].node, 'emissionClip');
  }
  save(at(name), result, graph.sourceFiles());
}
console.log(at('review/index.html'));
