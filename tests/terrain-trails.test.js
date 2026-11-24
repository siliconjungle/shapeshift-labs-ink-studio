const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ KIT: K, makeBuilder }) {
  const w = 40, h = 24;
  const rgba = new Uint8Array(w * h * 4), materials = new Uint8Array(w * h);
  for (let i = 0; i < materials.length; i++) {
    const x = i % w, y = Math.floor(i / w);
    materials[i] = x < 12 ? 1 : x < 24 ? 2 : 3;
    rgba.set([x * 5, y * 5, 95, x === 4 && y === 11 ? 0 : 255], i * 4);
  }
  const trail = K.terrainTrails.create({
    width: w, height: h, print: { radius: 3, duration: 2 }, press: { radius: 3, decay: 0 },
    ripple: { radius: 2, speed: 4, width: .7 },
    contacts: [{ at: [5.5, 11.5], time: 1, channels: ['print'] },
      { at: [16.5, 11.5], time: 1, channels: ['press'] },
      { at: [22.5, 11.5], time: 1, channels: ['press'] },
      { at: [31.5, 11.5], time: 1, channels: ['ripple'] }]
  });
  const terrain = trail.paint({ raster: { w, h, rgba }, materials, reactions: {
    1: { kind: 'print', bands: [[.1, '#804020'], [.7, '#582c14']] },
    2: { kind: 'press', shift: [3, 0] },
    3: { kind: 'ripple', bands: [[.25, '#377faa']] }
  } });
  const world = makeBuilder(7,[0x121212]).finish({
    look: { composite: { world: { resolution: [w, h] }, layers: [terrain.layer()] } }
  });
  return { trail, terrain, world };
}

const samples = { print: [5, 11], grass: [16, 11], shore: [22, 11],
  near: [33, 11], far: [35, 11], untouched: [7, 7] };
const toolkit = studio.load();

test('a shared trail paints distinct material responses, clips boundaries and supports seeking', () => {
  const { trail, terrain } = fixture(toolkit);
  const at = (frame, x, y) => Array.from(frame.rgba.subarray((y * frame.w + x) * 4, (y * frame.w + x) * 4 + 4));
  const before = terrain.render(.5), active = terrain.render(1), later = terrain.render(1.5);
  assert.deepEqual(at(active, 5, 11), [88, 44, 20, 255]);
  assert.deepEqual(at(active, 16, 11), at(before, 19, 11));
  assert.deepEqual(at(active, 22, 11), at(before, 22, 11));
  assert.deepEqual(at(active, 4, 11), [20, 55, 95, 0]);
  assert.deepEqual(at(active, 33, 11), [55, 127, 170, 255]);
  assert.deepEqual(at(later, 35, 11), [55, 127, 170, 255]);
  assert.deepEqual(at(later, 33, 11), at(before, 33, 11));
  assert.deepEqual(terrain.render(1), active);
  assert.deepEqual(terrain.render(3), before);
  assert.equal(trail.field.frame(1).sample('ripple', 33.5, 11.5), 1);
  assert.equal(trail.field.frame(1).sample('ripple', 5.5, 11.5), 0);
});

test('live writes invalidate the field without changing old snapshots', () => {
  const { trail } = fixture(toolkit);
  const first = trail.field.frame(1), revision = trail.field.revision;
  assert.throws(() => trail.stamp({ at: [6.5, 4.5], time: 1, channels: ['print', 'invalid'] }), /channel/);
  assert.equal(trail.field.revision, revision);
  assert.strictEqual(trail.field.frame(1), first);
  trail.stamp({ at: [6.5, 4.5], time: 1 });
  const next = trail.field.frame(1);
  assert.equal(first.sample('print', 6.5, 4.5), 0);
  assert.equal(next.sample('print', 6.5, 4.5), 1);
  assert.equal(trail.prune(2), 0);
  assert.equal(trail.prune(3), 5);
  assert.equal(trail.field.frame(1).sample('print', 6.5, 4.5), 0);
  trail.stamp({ at: [6.5, 4.5], time: 3 });
  trail.clear();
  assert.equal(trail.field.frame(3).sample('press', 6.5, 4.5), 0);
});

test('shared projected field batches reject a bad write without committing valid siblings', () => {
  const field = toolkit.KIT.splatEffects.field({ width: 4, height: 4, cell: 1, channels: { a: {} } });
  const stamp = { at: [1.5, 1.5], radius: 1, values: { a: 1 } };
  const before = field.frame(0);
  assert.throws(() => field.stampMany([stamp, { ...stamp, values: { missing: 1 } }]), /Unknown field channel/);
  assert.strictEqual(field.frame(0), before);
  field.stampMany([stamp]);
  assert.equal(field.revision, 1);
  assert.equal(field.frame(0).sample('a', 1.5, 1.5), 1);
});

test('the same field can shade a projected splat material in world space', () => {
  const { KIT: K, SurfaceLook } = toolkit;
  const trail = K.terrainTrails.create({ width: 12, height: 12, cell: .2, origin: [-1.2, -1.2] });
  const context = K.splatEffects.context({ fields: { trail: trail.field } });
  const material = SurfaceLook.prepare({ layers: { trail: { type: 'projected', space: 'world',
    field: 'trail', maskChannel: 'print', range: [.1, .5], color: '#e03080' } } }, [], undefined, context);
  const sample = { position: [20, 0, 20], worldPosition: [.1, 0, .1], normal: [0, 1, 0], view: [0, 1, 0], time: 1 };
  assert.deepEqual(SurfaceLook.shade(material, sample, [0, 0, 0]).slice(0, 3), [0, 0, 0]);
  trail.stamp({ at: [.1, .1], time: 1 });
  assert.deepEqual(SurfaceLook.shade(material, sample, [0, 0, 0]).slice(0, 3), [224 / 255, 48 / 255, 128 / 255]);
});

test('headless and WebGL render matching native trail pixels while seeking', { skip: !process.env.INK_TEST_CHROME }, () => {
  const times = [1.5, .5, 1], { world } = fixture(toolkit);
  const expected = times.map(t => {
    const frame = studio.render(world, { w: 40, h: 24, raw: true, t });
    return Object.fromEntries(Object.entries(samples).map(([id, [x, y]]) =>
      [id, Array.from(frame.rgb.subarray((y * 40 + x) * 3, (y * 40 + x) * 3 + 3))]));
  });
  const { frames } = runWebGL({}, fixture, (kit, make, backend, { times, samples }) => {
    const draw = backend(40, 24, { raw: true, offscreen: true });
    const { world } = make(kit);
    try {
      return { frames: times.map(time => {
        draw.draw(world, { time });
        return draw.sample(samples);
      }) };
    } finally {
      draw.close();
    }
  }, { times, samples });
  assert.deepEqual(frames, expected);
});
