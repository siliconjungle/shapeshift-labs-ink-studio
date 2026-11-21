const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = ink.load(), P = kit.KIT.procedural, F = P.subjectFeedback;
const chrome = process.env.INK_TEST_CHROME;
const raster = (width, height, channels, data) => ({ width, height, channels, data });
const rgb = (...pixels) => raster(pixels.length, 1, 4, Uint8Array.from(pixels.flat()));
const row = (...data) => raster(data.length, 1, 1, data);
const clear = [0, 0, 0, 0], red = [230, 20, 50, 255], blue = [10, 60, 240, 255];
const alphas = ({ value }) => [...value.data].filter((_, i) => i % 4 === 3);

test('local feedback drifts across a wrapped seam, fades behind occlusion, and clears only selected texels', () => {
  const history = F.create({ width: 4, height: 1, halfLife: 1, velocity: [1, 0], wrapU: true });
  const first = history.sample(rgb(clear, clear, clear, red), 0);
  assert.deepEqual([...first.deposited.data], [0, 0, 0, 255]);
  const hidden = history.sample(null, 1);
  assert.deepEqual(alphas(hidden), [128, 0, 0, 0]);
  assert.deepEqual([...hidden.deposited.data], [0, 0, 0, 0]);
  assert.deepEqual(hidden, history.sample(rgb(blue, blue, blue, blue), 1));
  assert.deepEqual(alphas(history.sample(rgb(clear, clear, blue, clear), 2, { refresh: row(0, 255, 0, 0) })),
    [0, 0, 255, 0]);
  assert.deepEqual(alphas(history.sample(null, .1)), [0, 0, 0, 0]);
  const filtered = F.create({ width: 4, height: 1, halfLife: 1, velocity: [.5, 0], wrapU: true, filter: 'linear' });
  filtered.sample(rgb(clear, clear, clear, red), 0);
  assert.deepEqual(alphas(filtered.sample(null, 1)), [64, 0, 0, 64]);
});

test('chart deposition uses visible ownership, averages collisions and rejects non-finite visible coordinates', () => {
  const history = F.create({ width: 2, height: 1 });
  const source = rgb(red, blue, red, blue);
  const coordinates = raster(4, 1, 2, [.08, .5, .12, .5, .8, .5, NaN, .5]);
  const owners = row(7, 7, 8, 7), valid = row(255, 255, 255, 0);
  const result = history.sample(source, 0, { coordinates, owners, owner: 7, valid });
  assert.deepEqual([...result.value.data], [120, 40, 145, 255, 0, 0, 0, 0]);
  assert.deepEqual([...result.deposited.data], [255, 0]);
  assert.throws(() => history.sample(source, .25, { coordinates, owners, owner: 7 }), /finite/);
  assert.deepEqual(result, history.sample(source, 0, { coordinates, owners, owner: 7, valid }));
  assert.throws(() => history.sample(source, .25), /chart dimensions/);
  assert.deepEqual(alphas(history.sample(null, .25, { reset: true })), [0, 0]);
});

test('a native object-position pass deposits only on the selected object in rest space', () => {
  const B = kit.makeBuilder(13, [0x101820, 0x22ff44, 0xe84010]);
  B.disc(0, 0, 0, [0, 0, 1], .52, .03, B.P[1], 3);
  B.describeSplats(0, 1, { object: 'receiver' });
  B.disc(.25, 0, .7, [0, 0, 1], .25, .03, B.P[2], 3);
  B.describeSplats(1, 2, { object: 'wall' });
  const world = B.finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }, radius: 3 });
  const rendered = ink.renderGraphScene(world, { channels: ['objectPosition', 'objectId'],
    options: { width: 56, height: 40, ortho: true, raw: true }, kit });
  const coords = ink.graphRenderPass(rendered.frame, 'objectPosition', { kit });
  const ids = ink.graphRenderPass(rendered.frame, 'objectId', { kit });
  const chart = F.create({ width: 12, height: 12, projection: { origin: [-.75, -.75, 0], across: [0, 1, 0] }, extent: [1.5, 1.5] });
  const result = chart.sample(rendered.value, 0, { coordinates: coords.data, valid: coords.valid,
    owners: ids.data, owner: ids.report.legend.findIndex(row => row.label === 'receiver') });
  const samples = result.value.data;
  let count = 0;
  for (let i = 0; i < samples.length; i += 4) if (samples[i + 3]) {
    assert(samples[i + 1] > samples[i] + 20);
    count++;
  }
  assert(count > 6);
});

test('graph clip history persists when the feed is absent and resets on an authored cut', () => {
  const link = node => ({ node });
  const project = ink.createGraphProject({
    format: 'ink-studio/graph-project', version: 1,
    nodes: { source: { op: 'guide' }, chart: { op: 'anim.subjectFeedback',
      inputs: { source: link('source'), options: { width: 1, height: 1, halfLife: .25 } } } },
    outputs: { value: link('chart') }
  }, { kit, operations: { guide: { time: true, outputs: { value: 'any' }, run(_, { time }) {
    return { value: time === 0 ? rgb(red) : null };
  } } } });
  const { artifacts } = project.clip({ output: 'value', from: 1, to: 3, warmup: 1, clock: { fps: 4,
    cuts: [{ frame: 2, id: 'restart' }] }, format: 'frames' });
  assert.deepEqual(artifacts.map(({ bytes }) => require('../cli/png.js').raster(bytes).data[3]), [128, 0]);
});

function fixture({ makeBuilder, SpriteSurface, KIT }) {
  const P = KIT.procedural, atlasBuilder = SpriteSurface.make(16, 16);
  const region = atlasBuilder.reserve(8, 8, () => 0x20456a);
  atlasBuilder.faceRegion([-1.8, -.5, 0], [.85, 0, 0], [0, 1, 0], region);
  atlasBuilder.face([-.67, -.7, .6], [1.15, 0, 0], [0, 1.4, 0], 1, 1, () => 0x9ac5c4);
  const atlas = atlasBuilder.finish();
  const world = makeBuilder(19, [0x102436]).finish({
    cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }, radius: 3, spriteSurfaces: atlas
  });
  const chart = P.subjectFeedback.create({ width: 8, height: 8, halfLife: 1 }), bind = P.subjectFeedback.bindAtlas(atlas, region);
  const rest = atlas.vertices.slice(0, 30);
  const ink = P.raster.canvas({ width: 8, height: 8, color: [249, 74, 43, 255] });
  function update(i) {
    const { value } = chart.sample(i ? null : ink, i * .25);
    bind.apply(value);
    for (let row = 0; row < 6; row++) atlas.vertices[row * 5] = rest[row * 5] + i * 1.3;
    SpriteSurface.markGeometryDirty(atlas, { first: 0, count: 6 });
  }
  return { world, atlas, region, update, bind, chart };
}

function measure(size, rgba) {
  let count = 0, x = 0;
  for (let i = 0; i < rgba.length; i += 3) {
    if (rgba[i] > rgba[i + 1] + 25 && rgba[i] > rgba[i + 2] + 25) {
      x += (i / 3) % size; count++;
    }
  }
  return { count, center: x / (count || 1) };
}

test('atlas texture stays on moving geometry, respects occlusion and appears again after the subject emerges', () => {
  const { world, atlas, region, update, bind } = fixture(kit);
  const observed = [0, 1, 2].map(i => {
    update(i);
    return measure(128, ink.render(world, { w: 128, h: 72, px: 1, t: i * .25, ortho: true, raw: true }).rgb);
  });
  assert(observed[0].count > 30);
  assert.equal(observed[1].count, 0);
  assert(observed[2].count > 30 && observed[2].center > observed[0].center + 20);
  assert.equal(atlas.revision, 3);
  bind.clear();
  assert.equal(atlas.revision, 4);
  assert.deepEqual([...atlas.pixels.slice((region.y * atlas.width + region.x) * 4, (region.y * atlas.width + region.x) * 4 + 4)],
    [32, 69, 106, 255]);
});

test('WebGL follows atlas texture and geometry revisions with the same occlusion as CPU', { skip: !chrome }, () => {
  const { observed } = runWebGL({ chrome }, fixture, (toolkit, build, backend, check) => {
    const { world, update } = build(toolkit), draw = backend(128, 72, { raw: true, offscreen: true, camera: { ortho: true } });
    const measure = new Function('return (' + check + ')')();
    try {
      return { observed: [0, 1, 2].map(i => {
        update(i);
        draw.draw(world, { time: i * .25 });
        return measure(128, Uint8Array.from(atob(draw.image()), value => value.charCodeAt(0)));
      }) };
    } finally { draw.close(); }
  }, measure.toString());
  assert(observed[0].count > 30);
  assert.equal(observed[1].count, 0);
  assert(observed[2].count > 30 && observed[2].center > observed[0].center + 20);
});
