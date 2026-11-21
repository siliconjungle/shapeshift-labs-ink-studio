const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const { drawing2d: D, pixelEffects: E, graph } = KIT.procedural;

const region = (x, y, confidence = 1, id = 1) => ({ id, center: [x, y], confidence,
  bounds: { x: x - 2, y: y - 3, width: 4, height: 6 } });
const obs = (time, ...regions) => ({ time, regions });
const rect = { type: 'rect', rect: [-1, -1, 2, 2], fill: '#ffffff' };
const alpha = (image, x, y) => image.data[(y * image.width + x) * 4 + 3];

test('anchors use stable feature IDs and independently sample bounds, offsets, lag, and smoothing', () => {
  const timeline = [obs(0, region(0, 2), region(80, 60, .8, 2)),
    obs(1, region(76, 58, .9, 2), region(10, 6)), obs(2, region(20, 10), region(72, 56, 1, 2))];
  const binding = { id: 'label', track: 1, lag: .25, smoothing: 1,
    offset: [1, -2], boundsAnchor: [.5, 0], commands: [rect] };
  const other = { id: 'other', track: 2, commands: [{ ...rect, translate: [3, 4] }] };
  const sample = D.trackedAnchors(timeline, [binding, other]).sample;
  assert.deepEqual(sample(.2).anchors[0], { id: 'label', track: 1, observedAt: null, confidence: null,
    status: 'hidden', position: null });
  const first = sample(.25);
  assert.deepEqual(first.anchors[0].position, [1, -3]);
  assert.deepEqual(first.anchors[1].position, [79, 59.5]);
  assert.deepEqual(first.value[1].translate, [82, 63.5]);
  assert.deepEqual(sample(1.25).anchors[0].position, [6, -1]);
  assert.deepEqual(sample(1.75).anchors[0].position, [9.75, .5]);
  assert.deepEqual(sample(.25), first);
});

test('a low-confidence observation starts the hold and expiry without affecting other IDs', () => {
  const time = [obs(0, region(10, 15)), obs(.1, region(11, 16, .3)), obs(.2, region(22, 20, 1, 2)),
    obs(.6, region(30, 20))];
  const sample = D.trackedAnchors(time, [
    { id: 'persistent', track: 1, hold: .22, minConfidence: .7, smoothing: .5, commands: [rect], masks: [rect] },
    { id: 'instant', track: 1, minConfidence: .7, commands: [rect] }
  ]).sample;
  assert.equal(sample(.09).anchors[0].status, 'tracked');
  const held = sample(.1);
  assert.deepEqual(held.anchors.map(({ status }) => status), ['held', 'hidden']);
  assert.deepEqual(held.anchors[0].position, [10, 15]);
  assert.equal(held.value.length, 1);
  assert.equal(held.masks.length, 1);
  assert.equal(sample(.319).anchors[0].status, 'held');
  assert.equal(sample(.32).anchors[0].status, 'hidden');
  assert.equal(sample(.4).masks.length, 0);
  assert.deepEqual(sample(.6).anchors[0].position, [30, 20]);
});

test('translated curves, labels, brush ribbons, and masks render through the existing drawing operation', () => {
  const bindings = [{ id: 'mixed', track: 1, commands: [
    { type: 'path', d: 'M -5 0 H 5', color: '#ffffff', width: 1 },
    { type: 'text', text: 'A', at: [2, 2], color: '#ffffff' },
    { type: 'ribbon', points: [[-5, -4], [5, -4]], width: 3, fill: '#ffffff' }
  ], masks: [{ type: 'polygon', points: [[-2, -2], [2, -2], [2, 2], [-2, 2]], fill: '#ffffff' }] }];
  const pop = D.trackedAnchors([obs(0, region(13.5, 13.5))], bindings).sample(0);
  const art = D.render({ width: 28, height: 25, commands: pop.value, edges: 'hard' });
  const mask = D.render({ width: 28, height: 25, commands: pop.masks, edges: 'hard' });
  assert.equal(alpha(art, 13, 13), 255);
  assert.equal(alpha(art, 10, 9), 255);
  const label = D.render({ width: 28, height: 25, commands: [pop.value[1]], edges: 'hard' });
  assert.deepEqual(label, D.render({ width: 28, height: 25,
    commands: [{ ...bindings[0].commands[1], at: [16, 16] }], edges: 'hard' }));
  assert.equal(alpha(mask, 13, 13), 255);
  assert.equal(alpha(mask, 17, 13), 0);
  assert.throws(() => D.render({ width: 28, height: 25, commands: [{ ...rect, translate: [Infinity, 0] }] }), /finite XY/);
});

test('raster observation graphs provide replayable placements and alpha masks after a missing frame', () => {
  const place = x => ({ width: 24, height: 16, channels: 1,
    data: Uint8Array.from({ length: 24 * 16 }, (_, p) => p === 24 * 5 + x ? 255 : 0) });
  const frames = [place(3), place(5), place(-1000), place(9)];
  const link = (node, port) => ({ node, ...(port && { port }) });
  const session = graph.create({
    inputs: { frames: 'array<raster>' },
    nodes: {
      observed: { op: 'fx.regionObservations', inputs: { frames: { input: 'frames' }, options: { value: { fps: 4 } } } },
      attached: { op: 'draw.trackedAnchors', inputs: { observations: link('observed'),
        bindings: { value: [{ id: 'mark', track: 1, hold: .2, commands: [rect], masks: [rect] }] } } },
      mask: { op: 'draw.render', inputs: { width: 24, height: 16, commands: link('attached', 'masks'), edges: 'hard' } }
    },
    outputs: { anchors: link('attached', 'anchors'), mask: link('mask') }
  });
  const at = time => session.evaluate({ frames }, { time }).outputs;
  assert.equal(E.regionObservations(frames, { fps: 4 })[3].regions[0].id, 1);
  assert.equal(at(.55).anchors[0].status, 'held');
  assert.equal(alpha(at(.55).mask, 5, 5), 255);
  assert.equal(at(.71).anchors[0].status, 'hidden');
  const after = at(.75);
  assert.deepEqual(after.anchors[0].position, [9.5, 5.5]);
  assert.equal(alpha(after.mask, 9, 5), 255);
  assert.equal(at(0).anchors[0].status, 'tracked');
  assert.deepEqual(at(.75), after);
});

test('compiled anchors validate observations and retain authored drawing data across seeks', () => {
  const bindings = [{ id: 'mark', track: 'hand', commands: [{ type: 'rect', rect: [0, 0, 2, 2], fill: '#ffffff' }] }];
  const track = [obs(0, region(3, 4, 1, 'hand'))];
  const prepared = D.trackedAnchors(track, bindings);
  track[0].regions[0].center[0] = 400;
  bindings[0].commands[0].rect[0] = -50;
  const result = prepared.sample(0);
  assert.deepEqual(result.anchors[0].position, [3, 4]);
  assert.deepEqual(result.value[0].rect, [0, 0, 2, 2]);
  assert.throws(() => D.trackedAnchors([obs(1), obs(1)], bindings), /increasing/);
  assert.throws(() => D.trackedAnchors([obs(0, region(3, 4), region(5, 6))], bindings), /duplicate/);
  assert.throws(() => D.trackedAnchors([], [...bindings, ...bindings]), /ID/);
});
