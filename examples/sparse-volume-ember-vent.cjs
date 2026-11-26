const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT: K, makeBuilder, makeSculpt } = require('..').load();
const PNG = require('../cli/png.js');
const Render = require('../cli/render.js');
const Composite = require('../src/frame-composite.js');

const destination = path.resolve(process.argv[2] ?? 'ember-vent');
fs.mkdirSync(destination, { recursive: true });
const file = name => path.join(destination, name);
const save = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const cli = path.join(__dirname, '../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, 'volume', ...args], { encoding: 'utf8' });
const V = K.procedural.sparseVolume, limit = n => Math.max(0, Math.min(1, n));
const grid = { origin: [-3.12, -1.08, -1.92], spacing: [.12, .12, .12], size: [52, 37, 32] };
const target = { origin: [-3.04, -.96, -1.84], spacing: [.16, .16, .16], size: [38, 27, 23] };
const fields = { density: { units: 'opacity/world' }, temperature: { units: 'K above ambient' },
  velocity: { units: 'world/s' }, signedDistance: { background: .31, units: 'world' } };

function source(side) {
  const center = side * .83, height = side === -1 ? 2.46 : 1.96;
  const outer = K.shape.box([center, .06, -.09], [.64, .38, .6], .13).sd;
  const collar = K.shape.box([center, .42, -.09], [.47, .15, .46], .09).sd;
  const bore = K.shape.capsule([center, -.42, -.09], [center, .7, -.09], .25).sd;
  const foundation = K.shape.box([center * .78, -.33, -.12], [.91, .15, .76], .10).sd;
  return V.bake({ grid, fields, brickSize: 6 }, (name, [x, y, z]) => {
    if (name === 'signedDistance') {
      const shell = Math.max(Math.min(outer(x, y, z), collar(x, y, z)), -bore(x, y, z));
      return Math.min(.31, Math.min(shell, foundation(x, y, z)));
    }
    const h = (y - .34) / height;
    if (h <= 0 || h >= 1) return name === 'velocity' ? [0, 0, 0] : 0;
    const driftX = center + side * (.68 * h + .19 * Math.sin(h * 8.3));
    const driftZ = -.07 + .18 * Math.sin(h * 6.8 + side);
    const dx = x - driftX, dz = z - driftZ;
    const angle = Math.atan2(dz, dx);
    const radius = (.24 + h * .55) * (1 + .18 * Math.sin(3 * angle + h * 15));
    const extent = Math.hypot(dx, dz) / radius;
    const puff = limit(1 - extent) * limit(h * 8) * limit((1 - h) * 4.7);
    if (puff < .024) return name === 'velocity' ? [0, 0, 0] : 0;
    const variation = .78 + .18 * Math.sin(x * 10 + y * 16 + side) * Math.cos(9 * z - 4 * y);
    if (name === 'density') return 3.7 * puff * variation;
    if (name === 'temperature') return puff * (side === -1 ? 990 : 625) * (1 - .65 * h);
    return [side * .37 + .9 * dz + .32 * Math.cos(h * 6), .53 + 1.8 * puff, -1.1 * dx - side * .23];
  });
}
const west = source(-1), east = source(1);
save('west.json', west.document);
save('east.json', east.document);
save('combine.json', { operations: { density: 'add', temperature: 'max', velocity: 'lerp', signedDistance: 'union' },
  mix: .5, maxSamples: 140000 });
run('combine', file('west.json'), file('east.json'), file('combine.json'), '--out', file('combined.json'),
  '--report', file('combine-report.json'));
save('resample.json', { grid: target, brickSize: 5, filter: 'linear', maxCells: 30000 });
run('resample', file('combined.json'), file('resample.json'), '--out', file('resampled.json'),
  '--report', file('resample-report.json'));
run('inspect', file('resampled.json'), '--out', file('inspect.json'));

const { logicalCells, storedComponents, bricks } = read('inspect.json');
assert.equal(logicalCells, 38 * 27 * 23);
assert(storedComponents < logicalCells * 6 * .4);
const meshSettings = { kind: 'isosurface', channel: 'signedDistance', resolution: .115, maxCells: 96000, maxTriangles: 42000 };
save('shell-export.json', meshSettings);
run('export', file('resampled.json'), file('shell-export.json'), '--out', file('shell.json'), '--report', file('shell-report.json'));
assert(read('shell-report.json').triangles > 500);
save('dense-export.json', { kind: 'dense', maxCells: 30000 });
run('export', file('resampled.json'), file('dense-export.json'), '--out', file('dense.json'),
  '--report', file('dense-report.json'));
run('pack', file('dense.json'), '--out', file('repacked.json'), '--report', file('pack-report.json'));
assert.deepEqual(read('repacked.json'), read('resampled.json'));

const plane = { origin: [-2.7, -.55, -.06], u: [1, 0, 0], v: [0, 1, 0], size: [5.4, 3.72] };
const counts = [96, 66];
const channels = ['density', 'temperature', 'velocity', 'signedDistance'];
for (const name of channels) {
  const request = name + '-slice-request.json';
  save(request, { kind: 'slice', channel: name, plane, counts });
  run('export', file('resampled.json'), file(request), '--out', file(name + '-slice.json'));
}
const points = Array.from({ length: 90 }, (_, i) => [-2.43 + i % 10 * .54, -.32 + Math.floor(i / 10) * .41, -.06]);
save('flow-samples.json', { points, channels: ['density', 'velocity'] });
run('sample', file('resampled.json'), file('flow-samples.json'), '--out', file('flow-report.json'));

const palette = [0x151e2c, 0x293142, 0x384254, 0x535463, 0x776876, 0x8d635c, 0xc18064, 0xf9bc78, 0xffe1a5, 0x30626e, 0x63a4a6];
const { points: vertices, faces } = read('shell.json');
const mat = [{ id: 'cast-copper', color: palette[6] }, { id: 'sooted-base', color: palette[3] },
  { id: 'hot-rim', color: palette[7] }];
const mesh = K.sceneMeshes.create({ id: 'vent-shell', positions: vertices.flat(), indices: faces.flat(),
  uvs: vertices.flatMap(([x, y]) => [limit(.5 + x / 5.4), limit((y + .55) / 3.72)]), materials: mat,
  faceMaterials: faces.map(ids => {
    const y = ids.reduce((sum, id) => sum + vertices[id][1] / 3, 0);
    return y < -.19 ? 1 : y > .39 ? 2 : 0;
  }) });
const ink = makeBuilder(47, palette), sculpt = K.sculpt(makeSculpt(ink));
Object.assign(sculpt, { pixel: true, sun: K.V.norm([-.38, .5, .79]), amb: .36, sky: .23, sunK: .54, shLen: 0 });
sculpt.box([0, -.55, -.12], [2.45, .19, 1.3], { r: [1, 2, 3, 4] }, { res: .095, rd: .07 });
sculpt.box([0, -.72, -.19], [2.71, .07, 1.51], { r: [1, 2, 3] }, { res: .12, rd: .045 });
for (const side of [-1, 1]) {
  sculpt.box([1.62 * side, -.332, .49], [.28, .09, .29], { r: [3, 4, 5] }, { res: .063, rd: .035 });
  const color = side === -1 ? 7 : 10;
  for (const i of [-1, 0, 1])
    sculpt.box([side * .84 + i * .115, .005, .49], [.024, .095, .032], { r: [color, 8], em: true }, { res: .036, rd: .012 });
}
sculpt.bake();
const sample = V.sampler(read('resampled.json')), fog = sample.density();
const hot = K.procedural.density.bounded({ bounds: fog.bounds,
  sample: (x, y, z) => fog.sample(x, y, z) * limit(sample.sample('temperature', [x, y, z]) / 300) });
const world = ink.finish({
  meshes: [mesh],
  cam: { ortho: true, target: [.02, 1.00, -.05], yaw: -.24, pitch: .26, dist: 10.9, fov: .55, sway: 0 },
  radius: 10, dither: 0,
  atmosphere: [
    K.atmosphere.field({ field: fog, density: 1.34, step: .092, color: '#72b1ab', lit: false }),
    K.atmosphere.field({ field: hot, density: 1.5, step: .092, color: '#e8a670', lit: false })
  ],
  volumeQuality: { steps: 78, jitter: 'off' }
});
const hero = Render.render(world, { w: 302, h: 303, px: 1, raw: true, edges: false, lockCamera: true, volumeJitter: 'off' });

const dark = [21, 31, 45], line = [29, 45, 58];
const ramps = {
  density: [[30, 61, 69], [42, 97, 102], [73, 147, 143], [130, 199, 178], [201, 228, 191]],
  temperature: [[78, 45, 58], [139, 67, 68], [192, 98, 79], [238, 151, 100], [255, 219, 150]],
  velocity: [[26, 58, 67], [46, 90, 107], [75, 135, 162], [115, 176, 195], [159, 203, 203]]
};
const dp = (x, y, width) => (y * width + x) * 3;
function heatmap(name) {
  const { counts: [w, h], values } = read(name + '-slice.json');
  const rgb = new Uint8Array(w * h * 3);
  function pixel(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < w && y >= 0 && y < h) rgb.set(c, dp(x, y, w));
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const value = values[(h - y - 1) * w + x];
    let color = x % 12 === 0 || (h - y - 1) % 12 === 0 ? line : dark;
    if (name === 'signedDistance') {
      if (Math.abs(value) < .037) color = [254, 194, 126];
      else if (value < 0) color = value < -.12 ? [168, 100, 82] : [209, 133, 99];
      else if (value < .11) color = [69, 56, 66];
    } else {
      const scale = name === 'density' ? 2.55 : name === 'temperature' ? 490 : 1.37;
      const ramp = ramps[name], index = Math.ceil(limit(value / scale) * ramp.length) - 1;
      if (value > scale * .028 && index >= 0) color = ramp[index];
    }
    pixel(x, y, color);
  }
  if (name === 'velocity') {
    function trace(x, y, u, v, color) {
      const steps = Math.max(1, Math.ceil(Math.hypot(u, v)));
      for (let i = 0; i <= steps; i++) pixel(x + u * i / steps, y + v * i / steps, color);
    }
    for (const { point: [x, y], values: v } of read('flow-report.json').samples) {
      if (v.density < .065) continue;
      const [u, t] = v.velocity, sx = (x - plane.origin[0]) / plane.size[0] * w,
        sy = (1 - (y - plane.origin[1]) / plane.size[1]) * h;
      const length = Math.hypot(u, t);
      if (!length) continue;
      const vx = u / length, vy = -t / length, scale = 2.7 + length * 2.5;
      const tip = [sx + vx * scale, sy + vy * scale], color = [250, 226, 163];
      trace(sx, sy, vx * scale, vy * scale, color);
      trace(...tip, -vx * 2.5 + vy * 1.5, -vy * 2.5 - vx * 1.5, color);
      trace(...tip, -vx * 2.5 - vy * 1.5, -vy * 2.5 + vx * 1.5, color);
    }
  }
  return Render.upscale({ w, h, rgb }, 2);
}

const w = 720, h = 394, base = { w, h, rgb: new Uint8Array(w * h * 3) };
for (let i = 0; i < base.rgb.length; i += 3) base.rgb.set(dark, i);
function copy(image, x, y) {
  for (let row = 0; row < image.h; row++)
    base.rgb.set(image.rgb.subarray(row * image.w * 3, (row + 1) * image.w * 3), dp(x, y + row, w));
}
copy(hero, 16, 58);
const columns = [324, 524], rows = [62, 222];
for (const [i, name] of channels.entries()) copy(heatmap(name), columns[i % 2], rows[i >> 1]);
const scaled = Render.upscale(base, 2);
const type = (text, x, y, size, color) => ({ type: 'text', text, at: [x * 2, y * 2], size: size * 2, color });
const draw = [
  type('EMBER VENT', 163, 27, 18, '#ffd68e'),
  type('DENSITY', 420, 53, 10, '#c5dfc9'), type('TEMPERATURE', 620, 53, 10, '#f7c5a6'),
  type('VELOCITY', 420, 213, 10, '#aed6de'), type('SIGNED DISTANCE', 620, 213, 10, '#f7c5a6'),
  type(bricks + ' BRICKS     ' + logicalCells.toLocaleString('en-US') + ' LOGICAL CELLS', 163, 375, 9, '#a7bac3')
];
const layout = K.frameComposite.prepare({ layers: [{ draw }] }, scaled.w, scaled.h, 1);
const sheet = Composite.compose(scaled, K.frameComposite.layers(layout, {}, 0), scaled.w, scaled.h, 'nearest');
PNG.write(file('ember-vent.png'), sheet.w, sheet.h, sheet.rgb);
save('report.json', { image: 'ember-vent.png', inspect: read('inspect.json'), combination: read('combine-report.json'),
  resample: read('resample-report.json'), isosurface: read('shell-report.json'), denseRoundTrip: true,
  slices: channels.map(channel => channel + '-slice.json'), velocity: 'flow-report.json' });
console.log(file('ember-vent.png'));
