const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');
const I = Ink.load().KIT.procedural.graphImages;
const F = I.filters;
const image = (width, height, data, descriptor = {}, channels = 1, pivot) =>
  I.declare({ width, height, data, channels, pivot }, { intent: channels === 1 ? 'data' : 'color', ...descriptor });
const raw = result => Array.from(result.raster.data);
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  for (const [i, value] of actual.entries())
    assert(Math.abs(value - expected[i]) < 1e-10, value + ' != ' + expected[i] + ' at ' + i);
};

test('Gaussian is separable, supports per-axis borders and preserves exact 16-bit identity', () => {
  const source = image(3, 1, [1, 0, 0]);
  const w = Math.exp(-.5), gain = w / (1 + 2 * w), center = 1 - 2 * gain;
  close(raw(F.gaussianBlur(source, { radius: 1, sigma: 1, border: 'wrap' })), [center, gain, gain]);
  close(raw(F.gaussianBlur(source, { radius: 1, sigma: 1, border: { u: 'transparent' } })), [center, gain, 0]);
  close(raw(F.gaussianBlur(source, { radius: 1, sigma: 1, border: 'clamp' })), [center + gain, gain, 0]);
  const a = image(2, 1, [30001, 30002], { precision: 'unorm16', pixelPitchMm: [.5, .75] }, 1, [.5, 1]);
  assert.strictEqual(F.gaussianBlur(a, { radius: 0 }), a);
  assert.strictEqual(F.gaussianBlur(a, { intensity: 0 }), a);
  const result = F.gaussianBlur(a, { precision: 'float64' });
  assert.equal(result.descriptor.precision, 'float64');
  assert.deepEqual(result.descriptor.pixelPitchMm, [.5, .75]);
  assert.deepEqual(result.raster.pivot, [.5, 1]);
  assert.throws(() => F.gaussianBlur(a, { radius: 65 }), /radius/);
  assert.throws(() => F.gaussianBlur(a, { border: 'zero' }), /Unknown.*border/);
});

test('rotated material blurs confine their axes and distinguish spin from zoom', () => {
  const impulse = image(5, 5, Array.from({ length: 25 }, (_, i) => +(i === 12)));
  const h = raw(F.directionalBlur(impulse, { radius: 1, angle: 0, samples: 3 }));
  const v = raw(F.directionalBlur(impulse, { radius: 1, angle: 90, samples: 3 }));
  close(h.slice(10, 15), [0, 1 / 3, 1 / 3, 1 / 3, 0]);
  assert.equal(h[7], 0);
  assert.equal(v[7], 1 / 3);
  assert.equal(v[11], 0);
  const a = raw(F.anisotropicBlur(impulse, { radii: [2, 0], angle: 90 }));
  assert(a[2] > 0 && a[7] > a[2] && a[7] < a[12]);
  assert.equal(a[11], 0);
  close(raw(F.anisotropicBlur(impulse, { radii: [2, 2], angle: 0 })), raw(F.gaussianBlur(impulse)));
  const offset = image(5, 5, Array.from({ length: 25 }, (_, i) => +(i === 13)));
  const spin = F.radialBlur(offset, { radius: 2, samples: 9 });
  const zoom = F.radialBlur(offset, { radius: 2, samples: 9, mode: 'zoom' });
  assert.notDeepEqual(raw(spin), raw(zoom));
  assert.equal(spin.raster.data[12], 0);
  assert.equal(zoom.raster.data[12], 0);
  assert(spin.raster.data[8] > 0);
  assert(zoom.raster.data[14] > 0);
});

test('variable blur responds continuously to a local radius map', () => {
  const source = image(5, 1, [0, 0, 1, 0, 0]);
  const none = image(5, 1, [0, 0, 0, 0, 0], { intent: 'mask' });
  const full = image(5, 1, Array(5).fill(1), { intent: 'mask' });
  const mixed = image(5, 1, [0, 0, .5, 1, 0], { intent: 'mask' });
  assert.strictEqual(F.variableBlur(source, none, { radius: 2 }), source);
  const maximum = F.gaussianBlur(source, { radius: 2 });
  close(raw(F.variableBlur(source, full, { radius: 2 })), raw(maximum));
  const result = F.variableBlur(source, mixed, { radius: 2 });
  assert(result.raster.data[2] > maximum.raster.data[2] && result.raster.data[2] < 1);
  assert.equal(result.raster.data[1], 0);
  close([result.raster.data[3]], [maximum.raster.data[3]]);
  assert.throws(() => F.variableBlur(source, image(5, 1, [0, 0, 2, 0, 0])), /range|samples/);
  assert.throws(() => F.variableBlur(source, image(1, 1, [1])), /aligned/);
  const large = I.uniform(.5, 256, 256, { intent: 'data' });
  assert.throws(() => F.variableBlur(large, large, { radius: 16 }), /sample budget/);
});

test('linear-light and premultiplied filtering prevent dark blends and hidden RGB fringes', () => {
  const rgb = image(2, 1, [0, 0, 0, 1, 1, 1], {}, 3);
  const blend = { radius: .5, samples: 2, angle: 0 };
  close(raw(F.directionalBlur(rgb, { ...blend, space: 'native' })), [.25, .25, .25, .75, .75, .75]);
  assert(F.directionalBlur(rgb, blend).raster.data[0] > .5);
  const rgba = image(2, 1, [1, 0, 0, 1, 0, 0, 1, 0], { colorSpace: 'srgb-linear' }, 4);
  close(raw(F.directionalBlur(rgba, blend)), [1, 0, 0, .75, 1, 0, 0, .25]);
  const premul = I.convert(rgba, { intent: 'color', alpha: 'premultiplied' });
  assert.equal(F.directionalBlur(premul, blend).descriptor.alpha, 'premultiplied');
  close(raw(F.directionalBlur(premul, blend)), [.75, 0, 0, .75, .25, 0, 0, .25]);
  const hdr = image(2, 1, [3, -.5, 1, 2, -1, .5], { colorSpace: 'srgb-linear' }, 3);
  const filtered = F.gaussianBlur(hdr, { radius: 1 });
  assert(filtered.raster.data[0] > 2 && filtered.raster.data[1] < -.5);
});

test('high pass is signed, unsharp recombines detail and cross sharpen retains alpha', () => {
  const source = image(3, 1, [0, 1, 0], { intent: 'mask' });
  const high = F.highPass(source, { radius: 1 });
  assert.equal(high.descriptor.intent, 'data');
  assert.equal(high.descriptor.precision, 'float64');
  assert(high.raster.data[0] < 0 && high.raster.data[1] > 0);
  const data = image(3, 1, [0, 1, 0]);
  close(raw(F.unsharpMask(data, { radius: 1, intensity: .75 })),
    raw(high).map((sample, i) => (i === 1 ? 1 : 0) + .75 * sample));
  close(raw(F.unsharpMask(data, { radius: 1, threshold: 2 })), [0, 1, 0]);
  close(raw(F.sharpen(data)), [-.25, 1.5, -.25]);
  const color = image(2, 1, [1, 1, 1, .5, 0, 0, 0, .25], {}, 4);
  const detail = F.highPass(color);
  assert.equal(detail.descriptor.colorSpace, 'srgb-linear');
  assert(detail.raster.data[4] < 0);
  close(raw(F.sharpen(color)).filter((_value, i) => i % 4 === 3), [.5, .25]);
});

test('edge-adaptive antialiasing reconstructs diagonal alpha and retains straight aligned edges', () => {
  const make = aside => image(5, 5, Array.from({ length: 25 }, (_, i) => [
    1, .125, 0, Number(aside(i % 5, Math.floor(i / 5)))
  ]).flat(), { colorSpace: 'srgb-linear' }, 4);
  const diagonal = F.antialias(make((x, y) => x >= y));
  const coverage = raw(diagonal).filter((_value, i) => i % 4 === 3);
  assert(coverage.some(value => value > 0 && value < 1));
  const aligned = make(x => x >= 2);
  close(raw(F.antialias(aligned)).filter((_value, i) => i % 4 === 3),
    raw(aligned).filter((_value, i) => i % 4 === 3));
  assert.equal(F.antialias(make((x, y) => x >= y), { precision: 'unorm16' }).descriptor.precision, 'unorm16');
});

test('typed filters compose in the editable material graph and keep native height units', () => {
  const op = (op, inputs) => ({ op, inputs }), link = node => ({ node });
  const project = Ink.createGraphProject(Ink.openMaterialGraph({
    format: 'ink-studio/graph-project', version: 1, nodes: {
      plane: op('image.uniform', { width: 3, height: 3, value: -3, descriptor: { intent: 'height', units: 'art-px' } }),
      smooth: op('image.gaussianBlur', { source: link('plane') }),
      detail: op('image.highPass', { source: link('smooth') })
    }, outputs: { result: link('detail') }, exports: { detail: { output: 'result', format: 'json' } }
  }, { id: 'native-detail' }));
  assert.equal(project.plan().outputs.result.type, 'heightImage');
  const result = project.run();
  assert.equal(result.outputs.result.descriptor.units, 'art-px');
  close(raw(result.outputs.result), Array(9).fill(0));
  assert(I.valid(JSON.parse(result.artifacts[0].bytes), 'height'));
});
