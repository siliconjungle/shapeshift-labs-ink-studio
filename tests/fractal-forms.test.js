const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K, makeBuilder, makeSculpt } = require('..').load();
const { fractal } = K.procedural.forms;

test('zero-constant quaternion Julia samples the expected finite orbit ball in its 4D slice', () => {
  const options = { family: 'quaternionJulia', constant: [0, 0, 0, 0], iterations: 7, bailout: 4 };
  const ball = fractal(options), slice = fractal({ ...options, slice: .6 });
  const radius = 4 ** (1 / (2 ** options.iterations)), sliceRadius = Math.sqrt(radius ** 2 - .6 ** 2);
  for (const axis of [0, 1, 2]) {
    const probe = r => [0, 1, 2].map(i => i === axis ? r : 0);
    assert(ball.sd(...probe(radius - .003)) < 0);
    assert(ball.sd(...probe(radius + .003)) > 0);
    assert(slice.sd(...probe(sliceRadius - .003)) < 0);
    assert(slice.sd(...probe(sliceRadius + .003)) > 0);
  }
  assert(fractal({ ...options, slice: 1.1 }).sd(0, 0, 0) > 0);
});

test('Mandelbulb power two follows the quadratic parameter orbit on the positive polar axis', () => {
  const bulb = fractal({ family: 'mandelbulb', power: 2, iterations: 24, bailout: 2 });
  assert(bulb.sd(0, 0, 0) < 0);
  assert(bulb.sd(0, 0, .245) < 0);
  assert(bulb.sd(0, 0, .36) > 0);
  assert.notEqual(fractal({ power: 8 }).sd(0, 0, .36) < 0, bulb.sd(0, 0, .36) < 0);
  assert(Number.isFinite(fractal({ power: 12, bailout: 8, iterations: 24 }).sd(.7, .7, .7)));
});

test('Menger folds remove nested orthogonal passages and retain the outside shell between openings', () => {
  const first = fractal({ family: 'menger', iterations: 1 });
  const second = fractal({ family: 'menger', iterations: 2 });
  assert(first.sd(0, 0, 0) > 0);
  assert(first.sd(0, 0, .95) > 0);
  assert(first.sd(.72, .72, .72) < 0);
  assert(second.sd(.72, .72, .72) > 0);
  assert(second.sd(-.91, .92, -.96) < 0);
  assert(Math.abs(second.sd(1.3, 1.4, 1.5) - Math.hypot(.3, .4, .5)) < 1e-12);
  assert(first.sd(.25, .29, .8) > 0);
  assert(fractal({ family: 'menger', gap: .18, iterations: 1 }).sd(.25, .29, .8) < 0);
});

test('fractal bounds clip solid material in local space and travel with the existing pose', () => {
  const bounds = { min: [-1, -1, -1], max: [.3, 1, 1] };
  const pose = { position: [2, 3, -1], rotation: [0, Math.PI / 2, 0], scale: [1.5, 2, .75] };
  const solid = fractal({ family: 'quaternionJulia', constant: [0, 0, 0, 0], bounds, pose });
  bounds.max[0] = 10;
  const transform = K.procedural.transforms, affine = transform.local(pose);
  const sample = x => solid.sd(...transform.point(affine, [x, 0, 0]));
  assert(sample(.29) < 0);
  assert(Math.abs(sample(.3)) < 1e-12);
  assert(sample(.31) > 0);
  assert(Object.isFrozen(solid.bounds.min));
  assert.deepEqual(solid.bounds, transform.bounds(affine, { min: [-1, -1, -1], max: [.3, 1, 1] }));
});

test('bounded folded forms bake finite native splats through both adaptive and uniform paths', () => {
  const source = fractal({ family: 'menger', iterations: 2, bounds: { min: [-1, -1, -1], max: [1, 1, .74] } });
  function bake(adaptiveSampling) {
    const builder = makeBuilder(9, [0x1b2034, 0x526072, 0xa0bac8]);
    const sculpt = K.sculpt(makeSculpt(builder));
    sculpt.adaptiveSampling = adaptiveSampling;
    sculpt.implicitForm(source, { r: [1, 2] }, { res: .11, objectId: 'fold' });
    sculpt.bake();
    return builder.finish();
  }
  const uniform = bake(false), adaptive = bake({ coarse: 1.7, fine: .8, curvature: .13 });
  assert(uniform.count > 500 && adaptive.count > 500);
  assert.notEqual(adaptive.count, uniform.count);
  assert(adaptive.data.every(Number.isFinite));
  assert.deepEqual(bake({ coarse: 1.7, fine: .8, curvature: .13 }).data, adaptive.data);
  for (let row = 0; row < adaptive.count; row++)
    assert(adaptive.data[row * 16 + 2] <= .747);
});

test('malformed fractal controls fail before evaluating or allocating a bake grid', () => {
  assert.throws(() => fractal({ family: 'bad' }), /family/);
  assert.throws(() => fractal({ iterations: 1.5 }), /iteration/);
  assert.throws(() => fractal({ family: 'menger', iterations: 8 }), /iteration/);
  assert.throws(() => fractal({ family: 'menger', gap: .8 }), /gap/);
  assert.throws(() => fractal({ family: 'quaternionJulia', constant: new Array(4) }), /constant/);
  assert.throws(() => fractal({ family: 'quaternionJulia', constant: [3, 0, 0, 0], bailout: 2 }), /bailout/);
  assert.throws(() => fractal({ power: 2.1 }), /power/);
  assert.throws(() => fractal({ bounds: { min: [-1, -1, -1], max: [1, 1, -1] } }), /extents/);
});
