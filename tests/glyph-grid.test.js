const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl');
const kit = studio.load();
const G = kit.KIT.glyphGrid;
const array = grid => Array.from(grid.snapshot().cells);

test('neighborhood rules step synchronously, with configurable edges and pinned cells', () => {
  const blinker = G.create({
    width: 5, height: 5, rule: G.rules.life(),
    initial: ({ x, y }) => Number(y === 2 && x >= 1 && x <= 3)
  });
  blinker.step();
  assert.deepEqual(array(blinker).map((state, index) => state ? index : -1).filter(i => i >= 0), [7, 12, 17]);
  blinker.step();
  assert.deepEqual(array(blinker).map((state, index) => state ? index : -1).filter(i => i >= 0), [11, 12, 13]);
  blinker.edit([{ x: 2, y: 1, locked: true }]);
  blinker.step();
  assert.equal(blinker.get(2, 1), 0);

  const next = boundary => G.create({ width: 3, height: 1, boundary,
    initial: [1, 0, 1], neighborhood: [[1, 0]], rule: ({ neighbors }) => neighbors[0] });
  const wrap = next('wrap'), empty = next('empty');
  wrap.step(); empty.step();
  assert.deepEqual(array(wrap), [0, 1, 1]);
  assert.deepEqual(array(empty), [0, 1, 0]);
});

test('seeded rules can branch from a snapshot and fail atomically', () => {
  const grid = G.create({ width: 5, height: 4, states: 5, seed: 14,
    initial: ({ random }) => Math.floor(random() * 5),
    rule: ({ neighbors, random }) => neighbors[Math.floor(random() * neighbors.length)] });
  const initial = grid.snapshot(), version = grid.revision;
  assert.throws(() => grid.edit([{ x: 2, y: 1, state: 3 }, { x: 8, y: 2, state: 1 }]), /edit/);
  assert.throws(() => grid.step(2, ({ tick }) => tick === 1 ? 4 : 5), /valid cell state/);
  assert.equal(grid.tick, 0);
  assert.equal(grid.revision, version);
  assert.deepEqual(grid.snapshot(), initial);
  grid.step(5);
  const after = grid.snapshot();
  grid.restore(initial);
  grid.step(5);
  assert.deepEqual(grid.snapshot(), after);
  initial.cells.fill(4);
  grid.reset();
  assert.notDeepEqual(grid.snapshot().cells, initial.cells);
});

test('addressed pattern recall heals errors around fixed conflicting fragments', () => {
  const original = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
  const rival = [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1];
  const grid = G.create({ width: 6, height: 2, states: 4, seed: 2, initial: original,
    patterns: [{ cells: original, weight: 1 }, { cells: rival, weight: .1 }] });
  grid.edit([{ x: 0, y: 0, state: 3, locked: true }, { x: 3, y: 1, state: 0 },
    { x: 4, y: 0, state: 0 }]);
  const damaged = grid.snapshot();
  grid.recall(9, { fraction: .38 });
  const recovered = grid.snapshot();
  assert.deepEqual(Array.from(recovered.cells), [3, ...original.slice(1)]);
  assert.notDeepEqual(Array.from(recovered.cells), rival);
  assert.equal(recovered.locked[0], 1);
  grid.restore(damaged);
  grid.recall(9, { fraction: .38 });
  assert.deepEqual(grid.snapshot(), recovered);
  grid.learn([]);
  assert.throws(() => grid.recall(), /learned patterns/);
});

function fixture({ KIT: K, SpriteSurface: surfaces, makeBuilder }) {
  const sprite = surfaces ?? SpriteSurface;
  const grid = K.glyphGrid.create({ width: 3, height: 1, states: 3, initial: [1, 2, 0] });
  const paper = K.glyphGrid.paint({ tiles: [
    null, { glyph: 'A', color: '#ff0000', background: '#000030' }, { glyph: '◇', color: '#00ff00' }
  ], glyphs: { '◇': ['..##..', '.#..#.', '#....#', '.#..#.', '..##..'] } });
  const frame = grid.snapshot();
  const raster = paper.raster(frame);
  const B = makeBuilder(9, [0x070c15, 0x00ff66]);
  const atlas = sprite.make(raster.w, raster.h);
  const region = atlas.reserve(raster.w, raster.h);
  atlas.faceRegion([-1.35, -.6, .1], [2.7, 0, 0], [0, 1.2, 0], region);
  const texture = atlas.finish();
  sprite.update(texture, region, raster);
  const splats = K.frameSplats(B, 144, draw => {
    paper.emit(frame, draw, { origin: [-1.15, 1.38, .2], across: [.115, 0, 0], down: [0, -.11, 0],
      width: .035, density: 1, depth: false });
  });
  const world = B.finish({ cam: { target: [0, .46, 0], dist: 4, yaw: 0, pitch: 0 }, radius: 4,
    spriteSurfaces: texture });
  const stage = K.stage(world);
  stage.add(splats);
  stage.update(0, 0);
  return { world, frame, raster, paper };
}

test('atlas and custom glyphs produce matching raster ink and world-space splat positions', () => {
  const { world, raster, frame, paper } = fixture(kit);
  assert.equal(raster.w, 18);
  assert.equal(raster.h, 8);
  const { rgba } = paper.raster(frame, { scale: 2 });
  const pixel = (data, stride, x, y) => Array.from(data.subarray((y * stride + x) * 4, (y * stride + x + 1) * 4));
  const data = raster.rgba;
  assert.deepEqual(pixel(data, 18, 0, 0), [0, 0, 48, 255]);
  assert.deepEqual(pixel(data, 18, 8, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(data, 18, 8, 1), [0, 0, 0, 0]);
  assert.deepEqual(pixel(rgba, 36, 17, 1), [0, 255, 0, 255]);
  const points = [];
  const draw = { point(position, options) { points.push([position, options]); } };
  const result = paper.emit(frame, draw, { origin: [2, 3, 4], across: [.1, 0, 0], down: [0, -.1, 0], maxSplats: 1 });
  assert.deepEqual(result, { emitted: 1, truncated: true });
  assert.equal(points[0][0][2], 4);
  assert.deepEqual(points[0][1].rgb, [1, 0, 0]);
  assert.deepEqual(paper.emit(frame, { point() { return false; } }), { emitted: 0, truncated: true });
  const rendered = studio.render(world, { w: 112, h: 92, px: 1, raw: true });
  assert(rendered.rgb.some((value, i) => i % 3 === 1 && value > 130));
});

test('WebGL renders a live grid as a world texture and emissive splats', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, fixture, (kit, build, backend) => {
    const { world } = build(kit), gpu = backend(112, 92, { raw: true, offscreen: true });
    try {
      gpu.draw(world);
      const data = atob(gpu.image());
      let upper = 0, lower = 0;
      for (let y = 0; y < 92; y++) for (let x = 0; x < 112; x++) {
        const p = (y * 112 + x) * 3;
        if (data.charCodeAt(p + 1) < 140) continue;
        if (y < 32) upper++;
        if (y > 39) lower++;
      }
      return { upper, lower };
    } finally {
      gpu.close();
    }
  });
  assert(result.upper > 3, 'splat glyph should be visible above the panel');
  assert(result.lower > 3, 'textured glyph should be visible on the panel');
});
