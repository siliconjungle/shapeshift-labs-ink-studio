const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..'), P = ink.load().KIT.procedural;
const { rasterWarp: W, drawing2d: D, raster: R } = P;
const solid = (width, height) => R.canvas({ width, height, color: [236, 89, 47, 255] });
const pixel = (value, x, y) => Array.from(value.data.slice((y * value.width + x) * value.channels,
  (y * value.width + x + 1) * value.channels));

test('following and pinning apply a consistent pivot, socket and exact numeric map', () => {
  const art = { ...solid(3, 2), pivot: [.75, 1.5] };
  const labels = { width: 3, height: 2, channels: 1, data: Int32Array.of(16384, 2, 3, 4, 5, -12) };
  const options = { rows: [{ row: 0, offset: [1, 1] }], padding: [2, 1, 2, 2],
    anchors: { nozzle: [2.25, .25] }, maps: { labels } };
  const follows = W.scanlines(art, options);
  assert.deepEqual(follows.value.pivot, [3.75, 3.5]);
  assert.deepEqual(follows.anchors.nozzle, [5.25, 2.25]);
  assert.deepEqual(follows.maps.labels.pivot, follows.value.pivot);
  assert(follows.maps.labels.data instanceof Int32Array);
  assert.deepEqual(pixel(follows.maps.labels, 3, 2), [16384]);
  assert.deepEqual(pixel(follows.maps.labels, 5, 3), [-12]);
  assert.deepEqual(pixel(follows.value, 2, 2), [0, 0, 0, 0]);
  assert.deepEqual(pixel(follows.value, 3, 2), [236, 89, 47, 255]);
  const pinned = W.scanlines(art, { ...options, pin: true });
  assert.deepEqual(pinned.value.pivot, [2.75, 2.5]);
  assert.deepEqual(pinned.anchors.nozzle, [4.25, 1.25]);
  assert.deepEqual(pixel(pinned.maps.labels, 2, 1), [16384]);
  assert.deepEqual(pixel(pinned.value, 2, 1), [236, 89, 47, 255]);
  assert.deepEqual(art.pivot, [.75, 1.5]);
});

test('destination rows invert a vertical stretch and respect hard horizontal row changes', () => {
  const original = { width: 1, height: 2, channels: 4, data: Uint8Array.of(255,0,0,255,0,255,0,255) };
  const { value, anchors, field } = W.scanlines(original, {
    rows: [{ row: 0 }, { row: 1, offset: [1, 1] }, { row: 2, offset: [1, 2] }],
    horizontal: 'step', padding: [0, 0, 1, 2], anchors: { marker: [.5, .75] }
  });
  assert.deepEqual(anchors.marker, [.5, 1.5]);
  assert.deepEqual(pixel(value, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(value, 0, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(value, 0, 2), [0, 0, 0, 0]);
  assert.deepEqual(pixel(value, 1, 2), [0, 255, 0, 255]);
  assert.deepEqual(pixel(value, 1, 3), [0, 255, 0, 255]);
  assert.deepEqual(W.sample(original, field, { filter: 'nearest', edge: 'transparent' }).data, value.data);
  assert.throws(() => W.scanlines(original, { rows: [{ row: 0 }, { row: 1, offset: [0, -1] }] }), /strictly increasing/);
  assert.throws(() => W.scanlines(original, { maps: { wrong: solid(2, 2) } }), /match the source/);
});

test('bitmap kerning continues to determine spacing after a pinned wave and at authored line origins', () => {
  const kerning = Object.assign(Object.create(null), { AV: -2, VA: 1 });
  const options = { scale: 2, tracking: 3, leading: 3, align: 'right', kerning };
  const { value, anchors, metrics } = D.text('AVA\nV', options);
  assert.deepEqual(metrics, { width: 41, height: 35, lines: 2, scale: 2 });
  assert.deepEqual(anchors, { 'line:0': [0,14], 'glyph:0:0': [0,14], 'glyph:0:1': [13,14], 'glyph:0:2': [29,14],
    'line:1': [29,33], 'glyph:1:0': [29,33] });
  const draw = time => W.scanlines(value, { anchors, pivot: anchors['line:1'], pin: true,
    wave: { amplitude: 4, period: 20, rate: .5 }, padding: [6, 0, 6, 0], time });
  const first = draw(0), next = draw(.5);
  assert.deepEqual(next.value.pivot, [35, 33]);
  assert.deepEqual(next.anchors['line:1'], [35, 33]);
  assert(Math.abs(next.anchors['glyph:0:1'][0] - next.anchors['glyph:0:0'][0] - 13) < 1e-9);
  assert.notDeepEqual(next.value.data, first.value.data);
  assert.deepEqual(draw(0), first);
  assert.throws(() => D.text('AV', { kerning: { AV: -7 } }), /kerning/);
});

test('the graph links text baselines to a scanline warp and sprites pack with their updated pivot', () => {
  const node = (id, port) => ({ node: id, ...(port && { port }) });
  const program = P.graph.create({ nodes: {
    letters: { op: 'draw.text', inputs: { text: 'AV', options: { tracking: 3, kerning: { AV: -2 } } } },
    bend: { op: 'warp.scanlines', inputs: { source: node('letters'), anchors: node('letters', 'anchors'),
      options: { rows: [{ row: 0, offset: [3, 1] }], padding: [3, 0, 4, 1] } } }
  }, outputs: { pixels: node('bend'), anchors: node('bend', 'anchors'), field: node('bend', 'field') } });
  const { pixels, anchors, field } = program.evaluate().outputs;
  assert.deepEqual(anchors['glyph:0:1'], [13, 8]);
  assert.equal(pixels.width, 20);
  assert.equal(field.height, pixels.height);
  const sprite = W.scanlines(solid(3, 2), { rows: [{ row: 0, offset: [1, 0] }],
    maps: { emission: R.canvas({ width: 3, height: 2, color: [20, 160, 230, 255] }) }, padding: [0, 0, 1, 0] });
  const atlas = R.pack([{ id: 'warped', source: sprite.value, maps: sprite.maps }], { trim: false, padding: 0 });
  assert.deepEqual(atlas.metadata.frames[0].pivot, { x: sprite.value.pivot[0], y: sprite.value.pivot[1] });
  assert.deepEqual(Array.from(atlas.atlas.images.emission.slice(4, 8)), [20, 160, 230, 255]);
  assert.deepEqual(pixel(sprite.maps.emission, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(sprite.maps.emission, 1, 0), [20, 160, 230, 255]);
});
