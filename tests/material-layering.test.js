const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');

const kit = Ink.load();
const P = kit.KIT.procedural, I = P.graphImages, M = P.materialChannels;
const image = (intent, data, options = {}) => {
  const { width = data.length, height = 1, channels = 1, pivot, ...descriptor } = options;
  return I.declare({ width, height, channels, data, pivot }, { intent, ...descriptor });
};
const scalar = data => image('data', data);
const height = (data, units = 'mm') => image('height', data, { units });
const samples = (result, map) => [...M.channel(result, map).raster.raster.data];
const rule = (mode, opacity = 1) => ({ mode, opacity });
const near = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert(Math.abs(value - expected[i]) < 1e-7, value + ' vs ' + expected[i]));
};

test('height dominance and shared coverage drive maps at their own resolutions', () => {
  const base = M.pack({
    height: height([.8, .1]), roughness: image('data', [.25, .25, .25, .25], { pivot: [2, 0], pixelPitchMm: [.3, .8] }),
    ao: scalar([.5, .5]), opacity: scalar([1, 1]), flow: image('data', [-.5, .5], { width: 1, channels: 2 })
  }, { roughness: { label: 'Foundry finish', texCoord: 0 } });
  const layer = M.pack({
    height: height([.6, .6]), roughness: scalar([.75, .75]), ao: scalar([.6, .6]),
    'mask.edge': image('mask', [1, 1])
  }, { 'mask.edge': { label: 'Lip' } });
  const result = M.layer(base, layer, {
    opacity: .5, height: { offset: .1 }, channels: { ao: rule('multiply'), roughness: rule('copy', .5) }
  }, image('mask', [.4, .8]));
  near(samples(result, 'height'), [.8, .34]);
  near(samples(result, 'roughness'), [.25, .25, .35, .35]);
  near(samples(result, 'ao'), [.5, .42]);
  near(samples(result, 'mask.edge'), [0, .4]);
  assert.strictEqual(result.channels.opacity, base.channels.opacity);
  assert.strictEqual(result.channels.flow, base.channels.flow);
  assert.strictEqual(result.channels.roughness.metadata, base.channels.roughness.metadata);
  assert.deepEqual(result.channels.roughness.raster.raster.pivot, [2, 0]);
  assert.deepEqual(result.channels.roughness.raster.descriptor.pixelPitchMm, [.3, .8]);
  assert.deepEqual(result.channels['mask.edge'].metadata, { label: 'Lip' });

  const soft = M.layer(M.pack({ height: height([.5]) }), M.pack({ height: height([.6]) }), { height: { softness: .2 } });
  near(samples(soft, 'height'), [.584375]);
});

test('UV transforms place layer and base masks with correctly weighted transparent borders', () => {
  const base = M.pack({ roughness: scalar([0, 0, 0, 0]) });
  const layer = M.pack({ roughness: scalar([1, .2, .3, .4]) });
  const mask = image('mask', [1, 0, 0, 0]);
  const transform = { offset: [.25, 0], border: 'transparent' };
  near(samples(M.layer(base, layer, { transform }, mask), 'roughness'), [0, 1, 0, 0]);
  near(samples(M.layer(base, layer, { transform, maskSpace: 'base' }, mask), 'roughness'), [0, 0, 0, 0]);
  const edged = M.layer(base, layer, { transform: { ...transform, offset: [.125, 0], filter: 'linear' } },
    image('mask', [1, 1, 1, 1]));
  near(samples(edged, 'roughness'), [.5, .6, .25, .35]);
  const wrapped = M.layer(base, layer, { transform: { offset: [.25, 0], border: 'wrap' } });
  near(samples(wrapped, 'roughness'), [.4, 1, .2, .3]);
});

test('normals share Ink composition, honor orientation and rotate with tangent relief and UV flow', () => {
  const n = (data, options) => image('normal', data, { width: 1, channels: data.length, ...options });
  const raised = n([.6, 0, .8]), tilted = n([0, .6, .8], { normalOrientation: 'directx' });
  const move = image('data', [.4, 0], { width: 1, channels: 2 });
  const base = M.pack({ normal: n([0, 0, 1]), flow: move });
  const coat = M.pack({ normal: raised, flow: move });
  const rotated = M.layer(base, coat, { transform: { rotation: 90 } });
  near(samples(rotated, 'normal'), [0, -.6, .8]);
  near(samples(rotated, 'flow'), [0, .4]);
  const mirrored = M.layer(base, coat, { transform: { offset: [1, 0], border: 'mirror' } });
  near(samples(mirrored, 'normal'), [-.6, 0, .8]);
  near(samples(mirrored, 'flow'), [-.4, 0]);
  for (const method of ['rnm', 'whiteout', 'lerp']) {
    const composed = M.layer(M.pack({ normal: raised }), M.pack({ normal: tilted }), {
      channels: { normal: rule(method, .7) }
    });
    const expected = I.normals.normalCombine(raised, tilted, { method, amount: .7 });
    near(samples(composed, 'normal'), [...expected.raster.data]);
  }
  const world = n([.6, 0, .8], { normalSpace: 'world' });
  near(samples(M.layer(M.pack({ normal: world }), M.pack({ normal: world }), { transform: { rotation: 90 } }), 'normal'),
    [.6, 0, .8]);
  assert.throws(() => M.layer(base, M.pack({ normal: world })), /matching units or normal space/);
});

test('pigment blends in linear light and preserves base precision, alpha and HDR', () => {
  const color = (data, options = {}) => image('color', data, { width: 1, channels: data.length, ...options });
  const base = M.pack({ baseColor: color([0, 0, 0]), emission: color([4, 2, 1], { colorSpace: 'srgb-linear' }) });
  const layer = M.pack({ baseColor: color([.5, .5, .5, .5], { alpha: 'premultiplied' }),
    emission: color([2, 4, 3], { colorSpace: 'srgb-linear' }) });
  const merged = M.layer(base, layer);
  near(samples(merged, 'baseColor'), [.735356983, .735356983, .735356983]);
  near(samples(merged, 'emission'), [2, 4, 3]);
  const target = color([0, 0, 0, .25], { alpha: 'premultiplied', colorSpace: 'srgb-linear' });
  const result = M.layer(M.pack({ baseColor: target }), layer);
  near(samples(result, 'baseColor'), [.5, .5, .5, .625]);
  assert.equal(result.channels.baseColor.raster.descriptor.alpha, 'premultiplied');
});

test('layer is available in saved editable projects and overrides touch only the named map', () => {
  const base = M.pack({ roughness: scalar([.3]), opacity: scalar([.75]) });
  const front = M.pack({ roughness: scalar([.6]), opacity: scalar([.1]) });
  const link = node => ({ node });
  const bind = input => ({ input });
  const graph = Ink.createGraphProject(Ink.openMaterialGraph({
    format: 'ink-studio/graph-project', version: 1,
    inputs: { base: 'materialChannels', front: 'materialChannels', finish: 'record' },
    nodes: {
      replace: { op: 'material.replace', inputs: { source: bind('front'), maps: bind('finish') } },
      finish: { op: 'material.layer', inputs: { base: bind('base'), layer: link('replace'),
        options: { defaultMode: 'keep', channels: { roughness: rule('copy') } } } }
    },
    outputs: { value: link('finish') }
  }, { id: 'enamel-test' }), { kit });
  assert.equal(graph.plan().outputs.value.type, 'materialChannels');
  const result = graph.run({ inputs: { base, front, finish: { roughness: scalar([.2]) } } }).outputs.value;
  near(samples(result, 'roughness'), [.2]);
  near(samples(result, 'opacity'), [.75]);
  near(samples(front, 'roughness'), [.6]);
  assert.strictEqual(M.layer(base, front, { opacity: 0 }), base);
  assert.strictEqual(M.layer(base, front, { defaultMode: 'keep' }), base);
  assert.throws(() => M.layer(base, front, { channels: { pigment: rule('copy') } }), /unknown map/);
  assert.throws(() => M.layer(base, front, { channels: { roughness: null } }), /Invalid material rule/);
  assert.throws(() => M.layer(base, front, {}, scalar([1.5])), /samples must be in/);
  assert.throws(() => M.layer(M.pack({ height: height([.1]) }), M.pack({ height: height([.2], 'm') }),
    { height: {} }), /matching units/);
  const raw = M.pack({ roughness: { width: 1, height: 1, channels: 1, data: [.3] } });
  assert.throws(() => M.layer(raw, front), /needs a typed image/);
  assert.strictEqual(M.layer(raw, front, { defaultMode: 'keep' }), raw);
});
