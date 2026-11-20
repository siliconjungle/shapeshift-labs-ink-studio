const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K, TexturedSurface } = require('..').load();
const W = K.procedural.coordinateTransforms;
const close = (actual, expected, tolerance = 1e-11) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert(Math.abs(actual[i] - expected[i]) <= tolerance,
    actual[i] + ' differs from ' + expected[i]);
};

test('Möbius maps accept real and complex coefficients and expose finite domains in both directions', () => {
  const m = W.mobius({ a: 1, b: 1, c: 1, d: -1 });
  close(m.forward(2, 0), [3, 0]);
  close(m.forward(0, 1), [0, -1]);
  close(m.inverse(...m.forward(-2.3, .41)), [-2.3, .41]);
  close(m.pole, [1, 0]);
  close(m.inversePole, [1, 0]);
  assert.equal(m.orientation, 1);
  assert.equal(m.forward(1, 0), null);
  const spin = W.mobius({ a: [0, 2], b: [.5, -.3] });
  close(spin.forward(1, 2), [-3.5, 1.7]);
  close(spin.inverse(-3.5, 1.7), [1, 2]);
  assert.equal(spin.pole, null);
  assert.equal(spin.forward(NaN, 0), null);
});

test('circle inversion preserves rays, and projective composition cancels removable poles', () => {
  const circle = W.inversion({ center: [2, -1], radius: 3 });
  close(circle.forward(3, 1), [3.8, 2.6]);
  close(circle.inverse(...circle.forward(3, 1)), [3, 1]);
  close(circle.pole, [2, -1]);
  assert.equal(circle.orientation, -1);
  assert.equal(circle.forward(2, -1), null);

  const identity = W.compose(circle, circle);
  assert.equal(identity.pole, null);
  assert.equal(identity.orientation, 1);
  close(identity.forward(2, -1), [2, -1]);
  close(W.repeat(circle, 4).forward(2, -1), [2, -1]);
  const complex = W.mobius({ a: [.82, -.4], b: [.33, -.81], c: [.2, .1] });
  const mixed = W.compose(circle, complex), input = [.1, -.4];
  assert.equal(mixed.orientation, -1);
  close(mixed.forward(...input), complex.forward(...circle.forward(...input)));
  close(mixed.inverse(...mixed.forward(...input)), input);
  const walk = W.repeat(complex, 7);
  let iterated = input;
  for (let i = 0; i < 7; i++) iterated = complex.forward(...iterated);
  close(walk.forward(...input), iterated);
});

test('Droste bands keep stable level IDs, exact similarity maps, and a bounded inner cutoff', () => {
  const stack = W.droste({ ratio: .5, angle: Math.PI / 2, depth: 2 });
  assert.deepEqual(stack.levels.map(row => row.id), ['droste/0', 'droste/1', 'droste/2']);
  close(stack.levels[2].map.forward(.8, 0), [-.2, 0]);
  close(stack.levels[2].map.inverse(-.2, 0), [.8, 0]);
  const copy = stack.resolve(-.2, 0);
  assert.equal(copy.level, 2);
  close(copy.point, [.8, 0]);
  assert.equal(stack.resolve(.5, 0).level, 1);
  assert.equal(stack.resolve(.125, 0).level, 2);
  assert.equal(stack.resolve(.124, 0), null);
  assert.equal(stack.resolve(1.01, 0), null);
  assert.equal(stack.resolve(0, 0), null);
  const spiral = W.droste({ ratio: .5, angle: .4, twist: 1.3, depth: 3 }), a = -.4 - 1.3 * Math.log(.31);
  close(spiral.pullback(.31, 0), [.62 * Math.cos(a), .62 * Math.sin(a)]);
  assert(Object.isFrozen(spiral.levels));
});

test('geometry drops triangles across a pole even when their vertices have finite values', () => {
  const source = {
    points: [-1, -1, 4, 1, -1, 5, 0, 1, 6, 1, 2, 7, 2, 2, 8, 2, 3, 9],
    uvs: [0, 0, 1, 0, .5, 1, 0, 0, 1, 0, 1, 1], triangles: [0, 1, 2, 3, 4, 5]
  };
  const warp = W.mobius({ a: 0, b: 1, c: 1, d: 0 });
  assert(source.points.slice(0, 9).filter((_, i) => i % 3 === 0)
    .every((x, i) => warp.forward(x, source.points[i * 3 + 1]) !== null));
  const mesh = W.mesh(source, warp);
  assert.equal(mesh.dropped, 1);
  assert.deepEqual([...mesh.triangles], [0, 1, 2]);
  assert.deepEqual([...mesh.uvs], source.uvs.slice(6));
  assert.deepEqual([...mesh.points].filter((_, i) => i % 3 === 2), [7, 8, 9]);
  TexturedSurface.validate(mesh);
});

test('orientation changes only for inverted geometry, while UVs can drop or clamp', () => {
  const grid = TexturedSurface.grid({ point: (u, v) => [1 + u, 2, v] });
  const shell = W.mesh(grid, W.inversion(), { plane: 'xz' });
  assert.deepEqual([...shell.triangles], [0, 2, 1, 2, 3, 1]);
  assert.deepEqual([...shell.points].filter((_, i) => i % 3 === 1), [2, 2, 2, 2]);
  close(shell.points.slice(3, 6), [.5, 2, 0]);

  const uvMap = W.mobius({ a: 2, b: [-.5, -.5] });
  const uv = W.mesh(grid, uvMap, { target: 'uv' });
  assert.deepEqual([...uv.uvs], [.25, .25, .75, .25, .25, .75, .75, .75]);
  assert.deepEqual([...uv.points], [...grid.points]);
  assert.deepEqual([...uv.triangles], [...grid.triangles]);
  assert.deepEqual([...grid.uvs], [0, 0, 1, 0, 0, 1, 1, 1]);
  const shift = W.mobius({ b: [.5, 0] });
  assert.equal(W.mesh(grid, shift, { target: 'uv' }).dropped, 2);
  assert.deepEqual([...W.mesh(grid, shift, { target: 'uv', outside: 'clamp' }).uvs], [0, 0, .5, 0, 0, 1, .5, 1]);
});

test('raster warping pulls from the inverse, preserves nearest bytes, and filters alpha without bleed', () => {
  const rgba = Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 0]), source = { w: 2, h: 1, rgba };
  assert.deepEqual(W.image(source, { map: W.mobius() }).rgba, rgba);
  assert.deepEqual([...W.image(source, { map: W.mobius(), w: 1, filter: 'linear' }).rgba], [255, 0, 0, 128]);
  const shift = W.mobius({ b: [.5, 0] });
  const tile = W.image(source, { map: shift, background: [1, 2, 3, 4] });
  assert.deepEqual([...tile.rgba], [1, 2, 3, 4, 255, 0, 0, 255]);
  const flipped = W.image({ w: 2, h: 1, rgb: Uint8Array.from([1, 2, 3, 4, 5, 6]) }, { map: (u, v) => [1 - u, v] });
  assert.deepEqual([...flipped.rgba], [4, 5, 6, 255, 1, 2, 3, 255]);
});

test('a camera atlas tile can feed the next level through a Droste pullback', () => {
  const nest = W.droste({ center: [.5, .5], ratio: .5, depth: 1 });
  let atlas;
  const world = { pixels: Uint8Array.from([23, 64, 81, 255]) };
  atlas = K.cameraAtlas.raster({ width: 2, height: 1, maxViewsPerFrame: 2,
    views: [{ id: 'inside', rect: [0, 0, 1, 1] },
      { id: 'outside', rect: [1, 0, 1, 1], frame() {
        world.pixels = W.image(atlas.read('inside'), { map: nest.levels[1].map }).rgba;
        return {};
      } }]
  }, current => ({ w: 1, h: 1, rgba: current.pixels }));
  assert.deepEqual(atlas.capture(world, { time: 0 }).updated, ['inside', 'outside']);
  assert.deepEqual(atlas.read('outside').rgba, atlas.read('inside').rgba);
});

test('invalid coefficients, work bounds, and warp options fail before output allocation', () => {
  assert.throws(() => W.mobius({ a: 1, b: 1, c: 1, d: 1 }), /singular/);
  assert.throws(() => W.mobius({ a: [0, NaN] }), /complex/);
  assert.throws(() => W.inversion({ radius: 0 }), /radius/);
  assert.throws(() => W.compose({ forward() {} }), /compiled/);
  assert.throws(() => W.repeat(W.mobius(), 65), /count/);
  assert.throws(() => W.droste({ ratio: 1 }), /Droste/);
  assert.throws(() => W.droste({ depth: 17 }), /Droste/);
  assert.throws(() => W.image({ w: 1, h: 1, rgba: new Uint8Array(4) }, { map: W.mobius(), w: 5000 }), /dimensions/);
});
