const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const kit = ink.load();
const api = kit.KIT.sprite.reconstruction;

function fixture(kit, { depth = true, wall = true, two = false } = {}) {
  const { KIT: K, makeBuilder } = kit,
    B = makeBuilder(1, [0x101722, 0xeeeeff]);
  const rect = (cx, z, r, color, object) => {
    const points = [
      [cx - r, -r, z],
      [cx + r, -r, z],
      [cx + r, r, z],
      [cx - r, r, z]
    ];
    for (const ids of [
      [0, 1, 2],
      [0, 2, 3]
    ])
      K.surfacePatches.triangle(
        B,
        ids.map(i => points[i]),
        { color, object }
      );
  };
  rect(0, 0, 0.58, [243, 37, 11], 'signal');
  if (two) rect(2.2, -4, 0.58, [243, 37, 11], 'second');
  if (wall) rect(0, 0.25, 0.16, [17, 42, 239], 'screen');
  const world = B.finish({
    cam: { dist: 7, target: [0, 0, 0], yaw: 0, pitch: 0, sway: 0 },
    radius: 12,
    dither: 0,
    look: { splatCoverage: 'continuous' },
    fog: { c: 0, start: 1, max: 0 }
  });
  const rgba = (...v) => [...v, ...v];
  const frames = [0, 1].flatMap(frame =>
    [0, 1].map(direction => ({
      frame,
      direction,
      time: frame * 0.5,
      duration: 0.5,
      yaw: direction * Math.PI,
      rect: { x: (frame * 2 + direction) * 2, y: 0, width: 2, height: 2 }
    }))
  );
  const atlas = {
    metadata: {
      width: 8,
      height: 2,
      frames,
      unitsPerPixel: 0.59,
      depthRange: [-0.68, -0.68],
      depthOrigin: 0,
      normalSpace: 'asset'
    },
    images: {
      color: [
        ...rgba(14, 237, 66, 255),
        ...rgba(220, 63, 212, 255),
        ...rgba(244, 175, 14, 255),
        ...rgba(199, 80, 218, 255),
        ...rgba(14, 237, 66, 255),
        ...rgba(220, 63, 212, 255),
        ...rgba(244, 175, 14, 255),
        ...rgba(199, 80, 218, 255)
      ],
      depth: Array.from({ length: 16 }, () => [0, 0, 0, 255]).flat(),
      normal: Array.from({ length: 16 }, () => [128, 128, 255, 255]).flat()
    }
  };
  const api = K.sprite.reconstruction,
    asset = api.asset({ atlas, range: [5, 9] });
  const placements = [{ asset, object: 'signal', at: [0, 0, 0], playback: 'loop', depth }];
  if (two) placements.push({ asset, object: 'second', at: [2.2, 0, -4], depth });
  api.bind(world, placements);
  return { world, asset, placements };
}

const camera = (distance, extra = {}) => ({ eye: [0, 0, distance], back: [0, 0, 1], time: 0, ...extra });

test('shared assets transition independently and the mask is complementary on every art pixel', () => {
  const { world } = fixture(kit, { two: true, wall: false });
  const close = api.resolve(world, camera(4)),
    mid = api.resolve(world, camera(7)),
    far = api.resolve(world, camera(15));
  assert.equal(close.states[0].geometry, 1);
  assert.equal(mid.states[0].geometry, 0.5);
  assert.equal(mid.states[1].geometry, 0);
  assert.equal(mid.geometryRows, 2);
  assert.equal(far.geometryRows, 0);
  assert.equal(far.rows.length, 2);
  const mask = mid.mask.codes,
    row = mid.rows[0];
  let visible = 0;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const native = api.geometry(mask[0], x, y);
      assert.equal(native, !api.sprite(row, x, y));
      visible += native;
    }
  assert.equal(visible, 32);
  assert(api.hidden(mask[2]));
  assert.equal(api.resolve(world, camera(7, { mode: 'geometry' })), null);
  // The artificial orthographic setback does not change the transition.
  assert.equal(api.resolve(world, camera(107, { ortho: true, setback: 100 })).states[0].geometry, 0.5);
});

test('view selection and looping cel clocks retain registered depth and normal maps', () => {
  const { world } = fixture(kit, { wall: false });
  const side = api.resolve(world, camera(-12, { back: [0, 0, -1], time: 0.61 })),
    row = side.rows[0],
    image = api.tile(row);
  assert.deepEqual(side.states[0].view, { frame: 1, yaw: Math.PI, pitch: 0 });
  assert.equal(api.tile(row), image);
  assert(image.values[2] > 0.7 && image.values[0] > 0.7);
  const front = api.resolve(world, camera(12, { time: 1.04 })),
    next = api.tile(front.rows[0]);
  assert.equal(front.states[0].view.frame, 0);
  assert(next.values[1] > 0.9);
  assert(Math.abs(next.values[16 + 3] + 0.68) < 1e-6);
  assert.equal(next.values[16 + 2], 1);
});

test('binding is atomic and rejects overlapping or absent named geometry', () => {
  const { world, placements } = fixture(kit),
    previous = world.spriteReconstruction;
  assert.throws(() => api.bind(world, [...placements, placements[0]]), /unique/);
  assert.throws(() => api.bind(world, [{ ...placements[0], object: 'missing' }]), /cannot find/);
  assert.equal(world.spriteReconstruction, previous);
  assert.throws(() => api.asset({ atlas: placements[0].asset.atlas, range: [10, 9] }), /near and far/);
  api.bind(world, []);
  assert.equal(world.spriteReconstruction, undefined);
});

function rgbAt(image, x, y) {
  return Array.from(image.rgb.subarray((y * image.W + x) * 3, (y * image.W + x) * 3 + 3));
}
const points = { center: [64, 64], left: [61, 62], right: [62, 62] };
test('headless reconstruction uses the atlas depth in front of overlapping native geometry', () => {
  const { world } = fixture(kit),
    flat = fixture(kit, { depth: false }).world;
  const render = (world, mode, t = 0) =>
    ink.render(world, { raw: true, w: 128, h: 128, px: 1, t, spriteReconstruction: mode });
  const fixed = render(world, 'sprite'),
    near = render(world, 'geometry'),
    flatImage = render(flat, 'sprite'),
    next = render(world, 'sprite', 0.55);
  assert(fixed.rgb.some(Boolean));
  function center(image) {
    return rgbAt({ ...image, W: 128 }, ...points.center);
  }
  const green = center(fixed),
    blue = center(near),
    flatBlue = center(flatImage),
    gold = center(next);
  assert(green[1] > green[2] * 2, JSON.stringify(green));
  assert(blue[2] > blue[1] * 2, JSON.stringify(blue));
  assert(flatBlue[2] > flatBlue[1] * 2, JSON.stringify(flatBlue));
  assert(gold[0] > gold[2] * 2, JSON.stringify(gold));
  const { world: clean } = fixture(kit, { wall: false });
  const mixed = render(clean, 'auto'),
    sample = [];
  for (let y = 58; y < 70; y++) for (let x = 58; x < 70; x++) sample.push(rgbAt({ ...mixed, W: 128 }, x, y));
  assert(sample.some(([r, g]) => r > g * 2) && sample.some(([r, g]) => g > r * 2));
  assert(sample.every(([r, g]) => r > g * 2 || g > r * 2));
});

test(
  'hardware matches depth occlusion, the shared screen mask, time sampling, and picking',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const out = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      fixture,
      (kit, build, backend) => {
        const b = backend(128, 128, { raw: true, damp: false }),
          { world } = build(kit),
          clean = build(kit, { wall: false }).world,
          flat = build(kit, { depth: false }).world,
          screen = Object.fromEntries(
            [59, 60, 61, 62, 63, 64, 65, 66].flatMap(y =>
              [59, 60, 61, 62, 63, 64, 65, 66].map(x => [x + '/' + y, [x, y]])
            )
          );
        const center = { center: [64, 64] },
          sprite = { spriteReconstruction: 'sprite' },
          geo = { spriteReconstruction: 'geometry' };
        const draw = (w, opts) => {
          b.draw(w, opts);
          return b.sample(center).center;
        };
        const ray = { origin: [0, 0, 7], direction: [0, 0, -1] };
        const green = draw(world, sprite),
          blue = draw(world, geo),
          flatBlue = draw(flat, sprite),
          gold = draw(world, { ...sprite, time: 0.55 });
        const spritePick = b.pick(world, ray, sprite).solid,
          geoPick = b.pick(world, ray, geo).solid;
        const shaded = draw(world, { ...sprite, liveSun: { direction: [0, 0, -1], ambient: 0.26, intensity: 1 } });
        let stats;
        b.draw(clean, { spriteReconstructionFrame: s => (stats = s) });
        const samples = Object.values(b.sample(screen));
        b.close();
        return {
          shaded,
          green,
          blue,
          flatBlue,
          gold,
          samples,
          coverage: stats.states[0].geometry,
          spritePick: spritePick?.target.object,
          geoPick: geoPick?.target.object
        };
      }
    );
    assert(out.green[1] > out.green[2] * 2, JSON.stringify(out.green));
    assert(out.blue[2] > out.blue[1] * 2 && out.flatBlue[2] > out.flatBlue[1] * 2);
    assert(out.gold[0] > out.gold[2] * 2, JSON.stringify(out.gold));
    assert(out.shaded[1] < out.green[1] * 0.4, JSON.stringify(out.shaded));
    assert.equal(out.coverage, 0.5);
    assert(out.samples.filter(([r, g]) => r > g * 2).length >= 30);
    assert(out.samples.filter(([r, g]) => g > r * 2).length >= 30);
    assert.equal(out.spritePick, 'signal');
    assert.equal(out.geoPick, 'screen');
  }
);
