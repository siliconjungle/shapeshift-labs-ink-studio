const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K } = require('..').load();
const { ifs } = K.procedural;

test('affine orbits burn in, track structural color, and keep the final map out of feedback', () => {
  const recipe = {
    transforms: [{ matrix: [.5, 0, 0, .5], offset: [1, -1], color: 1, colorMix: .5 },
      { offset: [99, 99], weight: 0 }],
    final: { offset: [10, 1] }
  };
  const model = ifs.compile(recipe);
  recipe.transforms[0].matrix[0] = 10;
  recipe.final.offset[0] = 0;
  const cloud = model.points({ count: 3, burnIn: 1 });
  assert.deepEqual([...cloud.positions], [11.5, -.5, 11.75, -.75, 11.875, -.875]);
  assert.deepEqual([...cloud.colors], [.875, .9375, .96875]);
  assert.deepEqual([...cloud.branches], [0, 0, 0]);
  assert.deepEqual(model.points({ count: 3, burnIn: 1 }), cloud);
});

test('flame variations add weighted 3D results between two affine maps', () => {
  const system = ifs.compile({ dimension: 3, transforms: [{
    matrix: Array(9).fill(0), offset: [1, 2, 2],
    variations: [{ type: 'bubble', weight: .75 }, { type: 'linear', weight: .25 },
      { type: 'polar', weight: 0 }],
    post: { offset: [0, 1, -.5] }
  }] });
  const q = .25 + .75 * 4 / 13;
  assert.deepEqual([...system.points({ count: 1, burnIn: 0 }).positions], [q, 1 + 2 * q, 2 * q - .5].map(Math.fround));
  const sample = type => ifs.compile({ dimension: 3, transforms: [{ variations: [{ type }] }] })
    .points({ count: 1, burnIn: 0, start: [1, 0, 2] }).positions;
  assert.deepEqual([...sample('swirl')], [Math.sin(1), Math.cos(1), 2].map(Math.fround));
  assert.deepEqual([...sample('spherical')], [.2, 0, .4].map(Math.fround));
});

test('ferns and Sierpiński presets are seeded and retain their characteristic regions', () => {
  const options = { seed: 42, count: 4000 };
  const fern = ifs.preset('barnsley'), f = fern.points(options);
  assert.deepEqual(f, fern.points(options));
  assert.notDeepEqual(f.branches, fern.points({ ...options, seed: 43 }).branches);
  assert(f.branches.filter(i => i === 1).length > 3200);
  for (let i = 1; i < f.positions.length; i += 2) assert(f.positions[i] >= 0 && f.positions[i] <= 10.05);

  const triangle = ifs.preset('sierpinski').points(options);
  for (let i = 0; i < triangle.positions.length; i += 2) {
    const x = triangle.positions[i], y = triangle.positions[i + 1];
    assert(Math.abs(x) >= y / Math.sqrt(3) - 1e-7 || y >= Math.sqrt(3) / 2 - 1e-7);
  }
  const tetrahedron = ifs.preset('tetrahedron').points(options);
  assert.equal(tetrahedron.dimension, 3);
  assert.equal(tetrahedron.positions.length, tetrahedron.count * 3);
  assert(tetrahedron.positions.some((p, i) => i % 3 === 2 && p > .6));
});

test('density counts and weights tone per bin and includes the upper boundary', () => {
  const system = ifs.compile({ transforms: [{ offset: [1, 0], color: 1, colorMix: .5 }] });
  const options = { count: 5, burnIn: 0, bounds: { min: [1, -1], max: [4, 1] }, resolution: [3, 1] };
  const linear = system.density({ ...options, exposure: 0 }), log = system.density({ ...options, exposure: 1 });
  assert.equal(linear.count, 5);
  assert.equal(linear.clipped, 1);
  assert.equal(linear.deposited, 4);
  assert.equal(linear.peak, 2);
  assert.deepEqual(linear.bin(0, 0), { mass: 1, density: .5, color: .75 });
  assert.deepEqual(linear.bin(2, 0), { mass: 2, density: 1, color: (.9375 + .96875) / 2 });
  assert.equal(log.bin(0, 0).density, Math.log(2) / Math.log(3));
  assert.deepEqual(linear.at(4.01, 0), { mass: 0, density: 0, color: null });
  assert.deepEqual(linear.at(4, 0), linear.bin(2, 0));
  const interpolated = linear.at(3, 0);
  assert.equal(interpolated.mass, 1.5);
  assert.equal(interpolated.color, (.875 + .9375 + .96875) / 3);
});

test('3D interpolation preserves weighted tone and passes directly to the atmosphere field', () => {
  const system = ifs.compile({ dimension: 3, transforms: [{ color: .7, colorMix: 1 }] });
  const grid = system.density({ bounds: { min: [0, 0, 0], max: [1, 1, 1] }, resolution: 2,
    count: 3, burnIn: 0, start: [.25, .25, .25], exposure: 0
  });
  assert.deepEqual(grid.at(.5, .5, .5), { mass: 3 / 8, density: 1 / 8, color: (.7 + .7 + .7) / 3 });
  assert.equal(grid.sample(-.01, .25, .25), 0);
  const volume = K.atmosphere.field({ field: grid, density: .6, lit: false });
  assert.equal(volume.field.sample(.5, .5, .5, 12), 1 / 8);
  assert.deepEqual(volume.max, [1, 1, 1]);
});

test('zero-weight transforms are skipped even when authored weights are subnormal', () => {
  const systems = [Number.MIN_VALUE, 1].map(weight => ifs.compile({
    transforms: [{ weight }, { weight, offset: [1, 0] }, { weight: 0, offset: [100, 0] }]
  }));
  const samples = systems.map(system => system.points({ count: 128, burnIn: 0, seed: 8 }));
  assert.deepEqual(samples[0], samples[1]);
  assert(samples[0].branches.every(i => i < 2));
});

test('escaping maps restart within a fixed work budget and bad projections do not reset the orbit', () => {
  const settings = { count: 5, burnIn: 3, escape: 2 };
  const escaped = ifs.compile({ transforms: [{ offset: [3, 0] }] }).points(settings);
  assert.equal(escaped.restarts, 8);
  assert.equal(escaped.count, 0);
  assert.equal(escaped.discarded, 5);
  const projected = ifs.compile({ transforms: [{}], final: { offset: [3, 0] } }).points(settings);
  assert.equal(projected.restarts, 0);
  assert.equal(projected.count, 0);
  assert.equal(projected.discarded, 5);
  assert.equal(projected.positions.length, 0);
});

test('invalid transform, grid, and iteration budgets fail before sampling', () => {
  assert.throws(() => ifs.preset('__proto__'), /preset/);
  assert.throws(() => ifs.compile({ dimension: 4, transforms: [{}] }), /dimensions/);
  assert.throws(() => ifs.compile({ transforms: [{ weight: 0 }] }), /positive/);
  assert.throws(() => ifs.compile({ transforms: [{ matrix: [1, 0, 1, Infinity] }] }), /matrix/);
  assert.throws(() => ifs.compile({ transforms: [{ post: [] }] }), /transform/);
  assert.throws(() => ifs.compile({ transforms: [{ variations: [{ type: 'constructor' }] }] }), /variation/);
  const model = ifs.preset('tetrahedron');
  assert.throws(() => model.points({ count: 2000001 }), /budget/);
  assert.throws(() => model.points({ start: [0, 0, 999], escape: 2 }), /coordinate/);
  assert.throws(() => model.density({ bounds: { min: [-1, -1, -1], max: [1, 1, 1] }, resolution: 256 }), /resolution/);
});
