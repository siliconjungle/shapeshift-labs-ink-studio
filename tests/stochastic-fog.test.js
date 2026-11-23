const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const kit = ink.load(), { KIT: K } = kit;
const example = require('../examples/depth-aware-fog/stochastic-aperture.js')(kit);

function fixture() {
  const world = example.build(example.seed);
  const history = K.atmosphere.history();
  function draw(t, options = {}) {
    const { stochastic = 8, seed = 29, ...view } = options;
    return ink.render(world, {
      w: 76, h: 48, px: 1, raw: true, captureFog: true, passes: ['opaque-surface', 'fogTransmittance'],
      volumeQuality: { stats: true, stochastic, stochasticHistory: 12, seed },
      t, ...view
    });
  }
  return { world, history, draw };
}

function error(image, reference) {
  return image.rgb.reduce((sum, byte, i) => sum + (byte - reference.rgb[i]) ** 2, 0);
}

test('stochastic fog keeps native opacity and geometry while sampling fewer lighting points', () => {
  const { draw } = fixture();
  const dense = draw(.0625, { stochastic: 1 }), sparse = draw(.0625);
  assert.equal(sparse.volumeStats.stochasticStride, 8);
  assert(sparse.volumeStats.lightingSamples < .20 * dense.volumeStats.lightingSamples);
  assert.equal(sparse.volumeStats.marchSteps, dense.volumeStats.marchSteps);
  assert.equal(sparse.volumeStats.fieldSamples, dense.volumeStats.fieldSamples);
  assert.deepEqual(sparse.passes.depth, dense.passes.depth);
  assert.deepEqual(sparse.fog, dense.fog);
  assert.deepEqual(sparse.passes.fogTransmittance, dense.passes.fogTransmittance);
  assert.deepEqual(sparse.rgb, draw(.0625).rgb);
  assert(error(sparse, dense) > 0);
  assert(error(sparse, draw(.125)) > 0);
  assert(error(sparse, draw(.0625, { seed: 30 })) > 0);
});

test('static fog converges and camera cuts, explicit resets, and seeks start fresh', () => {
  const { history, draw } = fixture();
  const dense = draw(0, { stochastic: 1 });
  const first = draw(0, { volumeHistory: history });
  let settled;
  for (let i = 1; i <= 12; i++) settled = draw(i/16, { volumeHistory: history });
  assert.equal(settled.volumeStats.historyFrames, 12);
  assert(settled.volumeStats.historyPixels > 200);
  assert(error(settled, dense) < .40 * error(first, dense));
  assert.deepEqual(settled.fog, dense.fog);
  for (const [t, options] of [
    [13/16, { yaw: -.32 }], [14/16, { yaw: -.32, resetRenderHistory: true }],
    [1/16, { yaw: -.32 }], [4/16, { yaw: -.32 }], [4/16, { yaw: -.32 }]
  ]) {
    const frame = draw(t, { ...options, volumeHistory: history });
    assert.equal(frame.volumeStats.historyFrames, 1);
    assert.deepEqual(frame.rgb, draw(t, options).rgb);
  }
});

test('time-varying lights skip accumulation and layered media keep dense composition', () => {
  const { history, draw, world } = fixture();
  world.volumeLighting.spots[0].intensity = t => 6 + 2*t;
  draw(0, { volumeHistory: history });
  const dynamic = draw(1/16, { volumeHistory: history });
  assert.equal(dynamic.volumeStats.stochasticStride, 8);
  assert.equal(dynamic.volumeStats.historyFrames, 1);
  assert.deepEqual(dynamic.rgb, draw(1/16).rgb);

  world.aerialPerspective = { start: 0, density: .14, contrast: .16 };
  const layered = draw(2/16, { volumeHistory: history });
  const dense = draw(2/16, { stochastic: 1 });
  assert.equal(layered.volumeStats.stochasticFallback, 'layered composition');
  assert.deepEqual(layered.rgb, dense.rgb);
  assert.deepEqual(layered.fog, dense.fog);
});
