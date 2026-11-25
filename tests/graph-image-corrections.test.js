const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');
const I = Ink.load().KIT.procedural.graphImages;
const C = I.corrections;
const lift = (data, spec = {}, channels = 1) => I.declare({
  width: data.length / channels, height: 1, channels, pivot: [.5, .5], data
}, { intent: channels === 1 ? 'data' : 'color', ...spec });
const samples = value => Array.from(value.raster.data);
const check = (value, expected, epsilon = 1e-12) => {
  const got = samples(value);
  assert.equal(got.length, expected.length);
  got.forEach((component, i) => assert(Math.abs(component - expected[i]) <= epsilon, component + ' != ' + expected[i]));
};

test('manual levels, contrast, exposure and inversion have explicit range behavior', () => {
  const scalar = lift([-.25, .25, .5, .75, 1.5]);
  check(C.levels(scalar, { inputRange: [.25, .75], outputRange: [-1, 3], gamma: 2 }), [-1, -1, 4 * Math.sqrt(.5) - 1, 3, 3]);
  check(C.contrast(scalar, { factor: 2, pivot: .25 }), [-.75, .25, .75, 1.25, 2.75]);
  check(C.exposure(scalar, { stops: 1 }), [-.5, .5, 1, 1.5, 3]);
  check(C.invert(scalar), [1.25, .75, .5, .25, -.5]);
  const nonlinear = lift([.5, .5, .5], {}, 3);
  check(C.exposure(nonlinear, { stops: 1 }), Array(3).fill(.6858361190643691));
  const bounded = lift([45000, 25000, 100], { precision: 'unorm16' }, 3);
  const grade = C.contrast(bounded, { factor: 2, pivot: .4 });
  assert.equal(grade.descriptor.precision, 'unorm16');
  assert.deepEqual(samples(grade), [63786, 23786, 0]);
  assert.throws(() => C.contrast(bounded, { factor: 2, outOfRange: 'error' }), /outside/);
  assert.throws(() => C.levels(scalar, { inputRange: [1, 1] }), /positive gamma/);
});

test('nonlinear transfer and no-op precision changes handle premultiplied HDR, alpha and metadata', () => {
  const source = lift([2, -.125, .25, .5, 0, 0, 0, 0],
    { colorSpace: 'srgb-linear', alpha: 'premultiplied', pixelPitchMm: [.25, .5], materialSeed: 12 }, 4);
  const exposed = C.exposure(source, { stops: 1 });
  check(exposed, [4, -.25, .5, .5, 0, 0, 0, 0]);
  assert.equal(exposed.descriptor.alpha, 'premultiplied');
  assert.deepEqual(exposed.descriptor.pixelPitchMm, [.25, .5]);
  assert.deepEqual(exposed.raster.pivot, [.5, .5]);
  assert.equal(exposed.descriptor.materialSeed, 12);
  const encoded = C.exposure(source, { stops: 0, precision: 'unorm16' });
  assert(I.valid(encoded));
  assert.deepEqual(samples(encoded), [32768, 0, 16384, 32768, 0, 0, 0, 0]);
  const hidden = lift([.7, .1, .2, 0], {}, 4);
  check(C.invert(hidden), samples(hidden));
});

test('histograms separate range overflow and auto levels fit exact visible percentiles', () => {
  const image = lift([-.5, 0, .125, .33, .5, 1, 3]);
  assert.deepEqual(C.histogram(image, { bins: 4 }), {
    channel: 'luminance', range: [0, 1], counts: [2, 1, 1, 1], count: 7, below: 1, above: 1,
    min: -.5, max: 3, inRange: [0, 1]
  });
  const gray = lift([.2, .3, .4, .45, .7], { precision: 'float64' });
  const auto = C.autoLevels(gray, { percentiles: [.125, .875] });
  assert.deepEqual(auto.report.bounds, [.25, .575]);
  check(auto.value, [0, .05 / .325, .15 / .325, .2 / .325, 1]);
  const rgba = lift([0, 1, 0, 0, .25, .25, .25, .5, .75, .75, .75, 1], {}, 4);
  assert.deepEqual(C.autoLevels(rgba, { channel: 'r', percentiles: [0, 1] }).report,
    { channel: 'r', percentiles: [0, 1], bounds: [.25, .75], count: 2, flat: false });
  assert.equal(C.histogram(rgba, { channel: 'r', includeTransparent: true }).count, 3);
  const flat = lift([.4, .4]);
  const result = C.autoLevels(flat);
  assert.equal(result.report.flat, true);
  check(result.value, [.4, .4]);
  assert.equal(C.autoLevels(lift([.8, .5, .5, 0], {}, 4)).report.bounds, null);
});

test('histogram operations include remap, cyclic shift, scan, band select and equalization', () => {
  const source = lift([0, .25, .5, .75, 1]);
  check(C.histogramAdjust(source, { mode: 'range', position: .6, span: .4 }), [.4, .5, .6, .7, .8]);
  check(C.histogramAdjust(source, { mode: 'shift', offset: .25 }), [.25, .5, .75, 0, .25]);
  check(C.histogramAdjust(source, { mode: 'shift', offset: -.25 }), [.75, 0, .25, .5, .75]);
  check(C.histogramAdjust(source, { mode: 'scan', position: .5, softness: .5 }), [0, .5, 1, 1, 1]);
  check(C.histogramAdjust(source, { mode: 'select', position: .5, span: .25, softness: .25 }), [0, .5, 1, .5, 0]);
  check(C.histogramAdjust(lift([.2, .2, .5, .8, 2]), { mode: 'equalize', bins: 4 }), [0, 0, .25, 1, 2]);
  check(C.histogramAdjust(lift([.21, .22]), { mode: 'equalize', bins: 4 }), [.21, .22]);
  assert.throws(() => C.histogramAdjust(source, { mode: 'unsupported' }), /Unknown material histogram/);
});

test('HSL and HSV transfer hue independently of alpha and obey their input range', () => {
  const red = lift([1, 0, 0, .6], {}, 4);
  check(C.hsl(red, { degrees: 120 }), [0, 1, 0, .6]);
  check(C.hsl(red, { saturation: 0 }), [.5, .5, .5, .6]);
  check(C.hsl(red, { lightness: .25 }), [1, .5, .5, .6]);
  check(C.hsv(red, { degrees: -120, valueFactor: .5 }), [0, 0, .5, .6]);
  const wide = lift([2, 0, 0], { colorSpace: 'display-p3-linear' }, 3);
  assert.throws(() => C.hsv(wide, { degrees: 120 }), /outside/);
  const clipped = C.hsv(wide, { degrees: 120, inputRange: 'clamp' });
  check(clipped, [0, 1, 0]);
  assert.equal(clipped.descriptor.colorSpace, 'display-p3-linear');
});

test('threshold and swatch selection produce reusable alpha-aware masks', () => {
  const rgba = lift([.25, 0, 0, .5, .5, 0, 0, 1, 1, 0, 0, 0], {}, 4);
  const result = C.threshold(rgba, { level: .5, channel: 'r', softness: .5 });
  check(result, [.25, 1, 0]);
  assert.equal(result.descriptor.intent, 'mask');
  check(C.threshold(rgba, { level: .5, channel: 'r', invert: true, useAlpha: false }), [1, 0, 0]);
  check(C.colorSelect(rgba, [.25, 0, 0], { metric: 'rgb', tolerance: 0 }), [.5, 0, 0]);
  check(C.colorSelect(rgba, [.25, 0, 0], { metric: 'perceptual', tolerance: 0 }), [.5, 0, 0]);
  const replaced = C.colorReplace(rgba, [.25, 0, 0], '#0000ff', { metric: 'rgb', tolerance: 0, amount: .5 });
  check(replaced, [.125, 0, .5, .5, .5, 0, 0, 1, 1, 0, 0, 0]);
  check(C.posterize(lift([-.3, .24, .25, .74, .75, 2]), { steps: 3 }), [0, 0, .5, .5, 1, 1]);
  const chosen = C.posterize(rgba, { palette: [[0, 0, 0], [1, 1, 1]] });
  assert.equal(chosen.raster.data[3], .5);
});

test('editable typed graph chains correction nodes, histogram and a material mask', () => {
  const op = (op, inputs) => ({ op, inputs }), link = (node, port = 'value') => ({ node, port });
  const spec = { format: 'ink-studio/graph-project', version: 1, nodes: {
    source: op('image.uniform', { width: 2, height: 1, value: [1.5, .25, .1, .75],
      descriptor: { intent: 'color', layout: 'rgba', colorSpace: 'srgb-linear', precision: 'float32' } }),
    graded: op('image.exposure', { source: link('source'), options: { stops: 1 } }),
    bins: op('image.histogram', { source: link('graded'), options: { channel: 'r' } }),
    selected: op('image.threshold', { source: link('graded'), options: { channel: 'r', level: 2 } }),
    coat: op('image.blend', { background: link('source'), foreground: link('graded'), mask: link('selected') })
  }, outputs: { coat: link('coat'), selected: link('selected'), bins: link('bins') },
  exports: { mask: { output: 'selected', format: 'json' } } };
  const project = Ink.createGraphProject(Ink.openMaterialGraph(spec, { id: 'typed-coat' }));
  const result = project.run();
  assert.equal(project.plan().outputs.coat.type, 'colorImage');
  assert.equal(result.outputs.bins.above, 2);
  assert(I.valid(JSON.parse(result.artifacts[0].bytes), 'mask'));
  check(result.outputs.selected, [.75, .75]);
});
