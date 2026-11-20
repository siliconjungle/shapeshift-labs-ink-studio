const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT: K, makeBuilder, SpriteSurface } = ink.load();
const P = K.procedural, A = P.lod.preview;
const box = { min: [-1, -1, 0], max: [1, 1, 0] };
const xy = [[1, 0, 0], [0, 1, 0]];
const world = { cam: { target: [0, 0, 0], dist: 10, yaw: 0, pitch: 0, fov: Math.PI / 2 } };
const view = (args = {}) => A.camera(world, { width: 120, height: 120, ...args });
const close = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, a + ' != ' + b);

function levels(build = i => i) {
  return [.90, .42, .16].map((feature, i) => ({ feature, work: [10, 32, 90][i], build: () => build(i) }));
}

test('a twelve-pixel projection retains its base and lazily reveals resolvable detail', () => {
  const built = [], program = A.create({ bounds: box, basis: xy, minPixels: 3, levels: levels(i => built.push(i)) });
  const far = program.inspect(view());
  close(far.projected.width, 12);
  close(far.projected.height, 12);
  assert.deepEqual(far.limitedBy, ['art-pixels']);
  assert.equal(far.level.index, 0);
  assert.deepEqual(built, []);
  program.select(view());
  program.select(view({ dist: 3 }));
  program.select(view({ dist: 2 }));
  program.select(view());
  assert.deepEqual(built, [0, 2]);
  assert.equal(program.select(view({ width: 240, height: 240, pixelSize: 2 })).level.index, 0);
  assert.equal(program.select(view({ width: 240, height: 240, pixelSize: 1 })).level.index, 1);
});

test('world feature limits and work caps apply even in extreme close-ups', () => {
  const a = A.create({ bounds: box, levels: levels(), minWorldSize: .3 });
  const b = A.create({ bounds: box, levels: levels(), maxWork: 33 });
  const c = A.create({ bounds: box, levels: levels(), minWorldSize: .3, maxWork: 33 });
  const near = view({ dist: 1 });
  assert.deepEqual(a.inspect(near).limitedBy, ['world-size']);
  assert.deepEqual(b.inspect(near).limitedBy, ['work']);
  assert.deepEqual(c.inspect(near).limitedBy, ['world-size', 'work']);
  assert.equal(c.inspect(near).level.index, 1);
  assert.throws(() => A.create({ bounds: box, levels: levels(), maxWork: 2 }), /coarse preview/);
});

test('camera projection accounts for oblique charts, depth, and offscreen or clipped boxes', () => {
  const p = A.create({ bounds: box, basis: xy, levels: levels(), minPixels: 3 });
  const front = p.inspect(view({ dist: 2, ortho: true }));
  const edge = p.inspect(view({ dist: 2, ortho: true, yaw: 1.4 }));
  assert.equal(front.level.index, 2);
  assert.equal(edge.level.index, 0);
  assert(edge.projected.pixelsPerWorld / front.projected.pixelsPerWorld < .18);

  const back = A.create({ bounds: { min: [-1, -1, 20], max: [1, 1, 21] }, levels: levels(() => {
    throw Error('a clipped generator should stay cold');
  }) });
  assert.equal(back.select(view()).asset, null);
  assert.equal(p.select(view({ target: [35, 2, 0] })).asset, null);
  const cut = A.create({ bounds: { min: [-.2, -.3, -.5], max: [.2, .3, .9] }, levels: levels() });
  assert(cut.inspect(view({ dist: .5 })).projected.visible);
  assert(Number.isFinite(cut.inspect(view({ dist: .5 })).projected.height));
});

test('tiling estimates match both subdivision families and retain root addresses', () => {
  for (const family of ['penrose', 'ammannBeenker']) {
    const estimates = P.tiles.quasiperiodic.levels({ family, depth: 3 });
    for (const estimate of estimates) {
      const layout = P.tiles.quasiperiodic({ family, depth: estimate.depth });
      assert.deepEqual(layout.work, { pieces: estimate.pieces, visited: estimate.visited });
    }
    const p = A.tiling({ bounds: box, basis: xy, family, depth: 3, minPixels: 3,
      maxWork: estimates[2].visited });
    const wide = p.select(view()), near = p.select(view({ dist: .9 }));
    assert.equal(wide.asset.depth, 0);
    assert.equal(near.asset.depth, 2);
    const ancestor = near.asset.tiles[0].addresses[0].slice(0, 1);
    assert.deepEqual(near.asset.at(ancestor), wide.asset.at(ancestor));
  }
});

test('Menger levels keep the central opening and add smaller openings only at the next fold', () => {
  const p = A.menger({ iterations: 4, maxWork: 3000, build: (form, tier) => ({ form, tier }) });
  const wide = p.select(view()), near = p.select(view({ dist: 2.2 }));
  assert.equal(wide.asset.tier.iterations, 1);
  assert.equal(near.asset.tier.iterations, 2);
  assert.equal(near.asset.tier.samplesPerAxis, 9);
  assert(wide.asset.form.sd(0, 0, 0) > 0 && near.asset.form.sd(0, 0, 0) > 0);
  const corner = [2 / 3, 2 / 3, 2 / 3];
  assert(wide.asset.form.sd(...corner) < 0 && near.asset.form.sd(...corner) > 0);
  assert(near.limitedBy.includes('work'));
});

function fixture({ KIT: K, makeBuilder, SpriteSurface }) {
  const A = K.procedural.lod.preview, built = [];
  const tile = (at, size, color) => {
    const atlas = SpriteSurface.make(8);
    atlas.face(at, [size, 0, 0], [0, size, 0], 4, 4, () => color);
    return atlas.finish();
  };
  const plane = { min: [-1, -1, .22], max: [1, 1, .22] };
  const preview = A.create({ id: 'mosaic', bounds: plane, minPixels: 3,
    levels: [[.9, 10, 0xd08030], [.21, 30, 0x40ce60]].map(([feature, work, color]) => ({
      feature, work, build: level => { built.push(level.index); return tile([-1, -1, .22], 2, color); }
    })) });
  const front = A.create({ id: 'chip', bounds: { min: [-.3, -.3, .5], max: [.3, .3, .5] },
    levels: [{ feature: .6, work: 1, build: () => tile([-.3, -.3, .5], .6, 0xffd080) }] });
  const b = makeBuilder(42, [0x10141c, 0x4d7acf, 0xd08030, 0x40ce60, 0xffd080]);
  const world = b.finish({ cam: { target: [0, 0, 0], dist: 10, yaw: 0, pitch: 0, fov: Math.PI / 2 },
    spriteSurfaces: tile([-1.3, -1.3, -.12], 2.6, 0x4d7acf), scalePreviews: [preview, front], dither: 0,
    look: { pixelSize: 1 } });
  return { world, built };
}

test('headless rendering composes preview geometry with regular surfaces on the native art grid', () => {
  const { world, built } = fixture(ink.load());
  const lists = [];
  const render = (args = {}) => ink.render(world, { w: 120, h: 120, px: 1, raw: true,
    scalePreviewFrame: reports => lists.push(reports.map(row => row.level.index)), ...args });
  const far = render(), near = render({ dist: 3 }), off = render({ dist: 3, scalePreviews: false });
  const pixel = (image, x, y) => [...image.rgb.slice((y * image.w + x) * 3, (y * image.w + x) * 3 + 3)];
  assert.deepEqual(lists, [[0, 0], [1, 0]]);
  assert.deepEqual(built, [0, 1]);
  assert.deepEqual(pixel(far, 63, 60), [208, 128, 48]);
  assert.deepEqual(pixel(near, 72, 60), [64, 206, 96]);
  assert.deepEqual(pixel(near, 60, 60), [255, 208, 128]);
  assert.deepEqual(pixel(off, 60, 60), [77, 122, 207]);
  assert.deepEqual(render().rgb, far.rgb);

  const styled = fixture(ink.load()), reported = [];
  ink.render(styled.world, { w: 240, h: 240, px: 2, dist: 8, colored: true,
    scalePreviewFrame: rows => reported.push(rows.map(row => row.level.index)) });
  assert.deepEqual(reported, [[0, 0]]);
  assert.deepEqual(styled.built, [0]);
});

test('WebGL resolves the same levels and draws the nearest of several atlases', { skip: !process.env.INK_TEST_CHROME }, () => {
  const webgl = require('../cli/look-webgl.js');
  const { browser, ...actual } = webgl({}, (kit, { fixture }) =>
    (new Function('return (' + fixture + ')'))()({ ...kit, SpriteSurface }),
  (kit, build, backend, payload) => {
    const { world, built } = build(kit, payload), runner = backend(120, 120, { raw: true, offscreen: true });
    const lists = [], scalePreviewFrame = rows => lists.push(rows.map(row => row.level.index));
    runner.draw(world, { time: 0, scalePreviewFrame });
    const far = runner.sample({ tile: [63, 60] });
    runner.draw(world, { time: 0, dist: 3, scalePreviewFrame });
    const near = runner.sample({ tile: [72, 60], center: [60, 60] });
    runner.draw(world, { time: 0, dist: 3, scalePreviews: false });
    const off = runner.sample({ center: [60, 60] });
    return { far, near, off, lists, built };
  }, { fixture: fixture.toString() });
  assert.deepEqual(actual, {
    far: { tile: [208, 128, 48] }, near: { tile: [64, 206, 96], center: [255, 208, 128] },
    off: { center: [77, 122, 207] }, lists: [[0, 0], [1, 0]], built: [0, 1]
  });
});
