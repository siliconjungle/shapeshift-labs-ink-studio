const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT } = require('..').load();
const { animationGraph, graph } = KIT.procedural;

const clear = [0, 0, 0, 0];
const orange = [255, 80, 0, 255];
const mint = [60, 220, 150, 255];
const blue = [35, 90, 220, 255];
const frame = (...pixels) => pixels.flat();
const source = {
  width: 4, height: 1, fps: 2, pivot: [1, 1],
  layers: {
    body: { frames: [frame(clear, clear, clear, blue)] },
    arm: { frames: [
      frame(clear, clear, clear, clear), frame(clear, clear, mint, clear),
      frame(clear, clear, clear, clear), frame(clear, clear, clear, mint)
    ] },
    head: { frames: [
      frame(orange, clear, clear, clear), frame(clear, orange, clear, clear),
      frame(clear, clear, orange, clear), frame(clear, clear, clear, orange)
    ] }
  },
  tags: { once: { start: 1, end: 4, loop: false }, loop: { start: 1, end: 4 } }
};

test('named fragments select independent cels and composite in the layer order', () => {
  const asset = graph.raster(source);
  const still = asset.spriteDesync({ time: .5 });
  assert.deepEqual(still.value.data, asset.composite(.5).data);
  const sampled = animationGraph.spriteDesync(asset, {
    time: 1, parts: { head: { hold: 0 }, arm: { offset: 1 } }
  });
  assert.deepEqual(sampled.frames, { base: 2, parts: { body: 0, arm: 3, head: 0 }, strips: [] });
  assert.deepEqual([...sampled.value.data], frame(orange, clear, clear, mint));
  assert.deepEqual(sampled.value.pivot, [1, 1]);
  assert.equal(sampled.value.channels, 4);
  const reversed = asset.spriteDesync({ time: 1.5, layers: ['head', 'body'] });
  assert.deepEqual([...reversed.value.data], frame(clear, clear, clear, blue));
});

test('fragment offsets wrap or clamp within their tag and holds count from its start', () => {
  const asset = graph.raster(source);
  const parts = { arm: { offset: -1 }, head: { hold: 1 } };
  const sample = (tag, time) => asset.spriteDesync({ tag, time, parts }).frames;
  assert.deepEqual(sample('loop', 0), { base: 1, parts: { body: 0, arm: 3, head: 2 }, strips: [] });
  assert.deepEqual(sample('once', 1), { base: 3, parts: { body: 0, arm: 2, head: 2 }, strips: [] });
  assert.deepEqual(sample('once', 2), { base: 3, parts: { body: 0, arm: 3, head: 2 }, strips: [] });
  assert.throws(() => asset.spriteDesync({ tag: 'once', parts: { head: { hold: 3 } } }), /in-tag hold/);
  assert.throws(() => asset.spriteDesync({ parts: { head: { hold: 1, offset: 0 } } }), /signed frame offset/);
  assert.throws(() => asset.spriteDesync({ parts: { shoe: { hold: 0 } } }), /Invalid sprite fragment/);
  assert.throws(() => asset.spriteDesync({ strips: [{ rect: [0, 0, 1, 0] }] }), /integer rectangle/);
});

test('rectangular fragments replace alpha in order and sample the synchronized layer selection', () => {
  const result = animationGraph.spriteDesync(source, {
    time: .5, parts: { head: { hold: 0 } }, layers: ['body', 'head'],
    strips: [{ rect: [-1, 0, 4, 1], offset: -1 }, { rect: [0, 0, 2, 1], hold: 1 }]
  });
  assert.deepEqual(result.frames, { base: 1, parts: { body: 0, head: 0 }, strips: [0, 1] });
  assert.deepEqual([...result.value.data], frame(clear, orange, clear, blue));
  assert.deepEqual(result.value.pivot, [1, 1]);
});

test('the stock operation evaluates raw or compiled sources, seeks and accepts an explicit clock', () => {
  const session = graph.create({
    inputs: { sprite: 'any', settings: 'record' },
    nodes: { takes: { op: 'anim.spriteDesync', inputs: {
      source: { input: 'sprite' }, options: { input: 'settings' }
    } } },
    outputs: { frame: { node: 'takes' }, frames: { node: 'takes', port: 'frames' } }
  });
  const sprite = graph.raster(source);
  const at = (time, settings, input = sprite) => session.evaluate({ sprite: input, settings }, { time }).outputs;
  const settings = { parts: { head: { offset: 1 } } };
  const first = at(.5, settings);
  assert.deepEqual(first.frames, { base: 1, parts: { body: 0, arm: 1, head: 2 }, strips: [] });
  assert.equal(at(1.5, settings).frames.parts.head, 0);
  assert.deepEqual(at(5, { ...settings, time: .5 }, source), first);
  assert.deepEqual(at(.5, settings), first);
});
