const assert = require('node:assert/strict');
const { test } = require('node:test');
const Ink = require('..');
const { procedural: P } = Ink.load().KIT;

const width = 8, height = 7, pixels = width * height;
const settings = { width, height, pixelPitchMm: [.5, .25], reliefToleranceMm: .02 };
const target = [[0, 0], [7, 0], [7, 6], [0, 6], [3, 2]];
const truth = [.24, .39, .62];
const black = [.023, .01, .008];
const camera = ([r, g, b]) => [r * .8 + g * .12 + black[0], g * 1.1 + b * .08 + black[1], b * .7 + black[2]];
const patches = [[.7, .15, .1], [.12, .65, .09], [.1, .2, .76], [.75, .75, .75]]
  .map(reference => ({ measured: camera(reference), reference }));
const declare = (w, h, channels, data, descriptor) => P.graphImages.declare(
  { width: w, height: h, channels, data: Float32Array.from(data) }, descriptor);
const depthAt = (x, y) => (x - 4) * .1 + (y - 3) * .04;
const depthNormal = [-.2, .16, 1].map(n => n / Math.hypot(.2, .16, 1));
const close = (actual, expected, eps = 1e-6) => expected.forEach((n, i) => assert(Math.abs(n - actual[i]) < eps,
  'index ' + i + ' received ' + actual[i] + ', expected ' + n));

function capture(id, offset, intensity, { defect = false, missing = false } = {}) {
  const w = width + 2 * offset, h = height + 2 * offset, length = w * h;
  const points = Array.from({ length }, (_, p) => [p % w - offset, Math.floor(p / w) - offset]);
  const color = declare(w, h, 3, points.flatMap(([x, y]) => camera(truth.map(n =>
    intensity * n + (defect && x === 2 && y === 3 ? .32 : 0)))), { intent: 'color', colorSpace: 'srgb-linear' });
  const heightMap = declare(w, h, 1, points.map(([x, y]) => depthAt(x, y) +
    (defect && x === 2 && y === 3 ? .25 : 0)), { intent: 'height', units: 'mm' });
  const mask = declare(w, h, 1, points.map(([x, y]) => Number(!missing || x !== 5 || y !== 4)), { intent: 'mask' });
  return { id, color, height: heightMap, reliefMask: mask, lighting: { ambient: intensity },
    calibration: { patches, black }, ...(offset && {
      landmarks: target.map(([x, y]) => ({ target: [x, y], source: [x + offset, y + offset] }))
    }) };
}
const data = (value, name) => P.materialChannels.channel(value, name).raster.raster.data;

test('registered captures recover measured pigment and relief with explicit disagreement evidence', () => {
  const captures = [capture('front', 0, .55), capture('port', 2, .83), capture('starboard', 0, .71,
    { defect: true, missing: true })];
  const { value, report } = P.measuredMaterials.recover(captures, settings);
  const p = 3 * width + 2, good = 2 * width + 3, hole = 4 * width + 5;
  close(data(value, 'baseColor').subarray(p * 4, p * 4 + 4), [...truth, 1]);
  close(data(value, 'height'), Array.from({ length: pixels }, (_, i) => depthAt(i % width, Math.floor(i / width))));
  close(data(value, 'normal').subarray(good * 3, good * 3 + 3), depthNormal);
  const confidence = data(value, 'mask.relief-confidence');
  assert(confidence[good] > .99);
  assert(confidence[p] < .1);
  assert(confidence[hole] > .6 && confidence[hole] < .7);
  assert(data(value, 'mask.pigment-confidence')[p] < .15);
  assert(report.captures[1].registration.maxPx < 1e-10);
  assert(report.captures[1].calibration.max < 1e-10);
  assert.equal(report.reliefDisagreements, 1);
  assert.equal(report.rejectedPigmentSamples, 1);
  const reopened = Ink.readTexture(Ink.encodeTexture(value, { encoding: 'exr' }), { channels: ['height'] });
  assert.deepEqual(reopened.data, data(value, 'height'));
});

test('tangent transfer rotates DirectX normals into the tile frame and rejects unusable fits', () => {
  const source = capture('surface', 0, .8);
  const n = [.6, -.18, Math.sqrt(1 - .6 ** 2 - .18 ** 2)];
  const normal = declare(width, height, 3, new Array(pixels).fill(n).flat(), {
    intent: 'normal', normalSpace: 'tangent', normalOrientation: 'directx'
  });
  const irradiance = declare(width, height, 1, new Array(pixels).fill(.8), { intent: 'data' });
  const { value } = P.measuredMaterials.recover([{ id: source.id, color: source.color, calibration: source.calibration,
    irradiance, normal, normalRotation: 90 }], settings);
  close(data(value, 'normal').subarray(0, 3), [-.18, .6, n[2]]);
  close(data(value, 'baseColor').subarray(0, 4), [...truth, 1]);
  assert(!Object.hasOwn(value.channels, 'height'));
  assert.throws(() => P.measuredMaterials.recover([{ ...source, landmarks: Array.from({ length: 4 },
    (_, x) => ({ target: [x, 1], source: [x, 1] })) }], settings), /underdetermined/);
  assert.throws(() => P.measuredMaterials.recover([{ ...source, calibration: { patches: new Array(4).fill(patches[0]) } }],
    settings), /underdetermined/);
});

test('optional AxF exchange calls the host codec and retains explicit unmapped appearance properties', async () => {
  const { value } = P.measuredMaterials.recover([capture('front', 0, .85)], settings);
  const bytes = Uint8Array.of(1, 2, 3, 4);
  const metadata = { representation: 'SVBRDF', unsupported: ['spectral Fresnel'] };
  const adapter = { async decode(input) { assert.equal(input, bytes); return { value, ...metadata }; },
    encode(input) { assert.equal(input, value); return { bytes, ...metadata }; } };
  assert.deepEqual(await Ink.importAxF(bytes, { adapter }), { value, ...metadata });
  assert.deepEqual(await Ink.exportAxF(value, { adapter }), { bytes, ...metadata });
  await assert.rejects(Ink.importAxF(bytes), /X-Rite SDK/);
  await assert.rejects(Ink.exportAxF(value, { adapter: { encode: () => ({ bytes }) } }), /unsupported properties/);
});
