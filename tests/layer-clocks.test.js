const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const K = ink.load().KIT, A = K.procedural.animationGraph;
const link = (node, port) => ({ node, ...(port && { port }) });
const project = (spec) => ink.createGraphProject({ format: 'ink-studio/graph-project', version: 1, ...spec });

test('each authored clock accumulates its own rate, holds, restarts and rejoins its parent', () => {
  const cues = [{ time: 4, seek: 'parent', rate: 1 }, { time: 2, seek: 0, rate: 2 }, { time: 1, rate: 0 }];
  const clock = A.compileClock({ range: [0, 8], phase: .5, rate: .5, cues });
  cues[2].rate = 9;
  const times = [0, .5, 1, 1.99, 2, 2.5, 4, 4.5, 8, 12];
  const values = [.5, .75, 1, 1, 0, 1, 4, 4.5, 8, 8];
  assert.deepEqual(times.map(time => clock.sample(time).value), values);
  assert.deepEqual(times.reverse().map(time => clock.sample(time).value), values.reverse());

  const signed = A.compileClock({ range: [.1, .4], phase: -.1, mode: 'loop' });
  assert.equal(signed.sample(0).value, .3);
  assert.equal(signed.sample(.4).value, .1);
  assert.equal(A.clock(1, { delay: 2, phase: .25 }).active, false);
  assert.equal(A.clock(2.5, { delay: 2, cues: [{ time: 1, seek: .25, rate: 0 }] }).value, .25);
  assert.equal(A.clock(5, { phase: .4, rate: 0 }).value, .4);
  assert.throws(() => A.compileClock({ cues: [
    { time: .25, rate: 0 }, { time: { numerator: 1, denominator: 4 }, rate: 1 }
  ] }), /unique/);
  assert.throws(() => A.compileClock({ cues: [{ time: 1, seek: 'typo' }] }), /numerator/);
  assert.throws(() => A.compileClock({ cues: [{ time: 1, reset: 0 }] }), /cue/);
});

test('graph layers and frame sources take effect on an exact picture boundary', () => {
  const cut = { numerator: 1001, denominator: 30000 };
  const clock = K.timeDomains.take({ fps: { numerator: 30000, denominator: 1001 } });
  const timing = { range: [0, 10], phase: .5, cues: [{ time: cut, seek: 0, rate: 0 }] };
  const other = { range: [0, 10], rate: 1, phase: 2 };
  const raster = (v) => ({ width: 1, height: 1, channels: 4, data: [v, 0, 0, 255] });
  const graph = project({
    groups: { source: { nodes: { time: { op: 'time' } }, outputs: { value: link('time') } } },
    nodes: {
      first: { op: 'anim.retime', group: 'source', inputs: { timing } },
      second: { op: 'anim.retime', group: 'source', inputs: { timing: other } },
      read: { op: 'anim.clock', inputs: { options: timing } },
      frame: { op: 'anim.frame', inputs: { frames: [raster(0), raster(255)], options: { ...timing, fps: 2 } } }
    },
    outputs: { first: link('first'), second: link('second'), read: link('read'), index: link('frame', 'index') }
  });
  const before = { first: .5, second: 2, read: .5, index: 1 };
  assert.deepEqual(graph.run({ take: clock.at(0) }).outputs, before);
  assert.deepEqual(graph.run({ take: clock.at(1) }).outputs, { first: 0, second: 2 + 1001 / 30000, read: 0, index: 0 });
  assert.deepEqual(graph.run({ take: clock.at(0) }).outputs, before);
  assert.equal(A.compileClock(timing).forTake(clock.at(1)).value, 0);
  assert.equal(A.compileClock(timing).sample(cut).value, 0);
  // A 3-fps raster loop uses its exact frame period even when the total
  // duration has no terminating decimal representation.
  const clips = project({
    nodes: { frames: { op: 'anim.frame', inputs: { frames: [raster(0), raster(255)],
      options: { fps: 3, phase: 0, mode: 'loop' } } } },
    outputs: { time: link('frames', 'time'), index: link('frames', 'index') }
  });
  assert.deepEqual(clips.run({ take: K.timeDomains.take({ fps: 3 }).at(2) }).outputs, { time: 0, index: 0 });
});

test('an authored seek starts a fresh feedback segment only on the affected layer', () => {
  const frame = (alpha) => ({ width: 1, height: 1, channels: 4, data: [255, 0, 0, alpha] });
  const graph = project({
    groups: { signal: { nodes: {
      echo: { op: 'anim.feedback', inputs: { frames: [frame(255), frame(0)], options: { fps: 4, dt: .05, halfLife: 5 } } }
    }, outputs: { value: link('echo') } } },
    nodes: {
      restart: { op: 'anim.retime', group: 'signal', inputs: { timing: { range: [0, 2],
        cues: [{ time: .25, rate: 0 }, { time: .5, seek: .25 }] } } },
      keep: { op: 'anim.retime', group: 'signal', inputs: { timing: { range: [0, 2],
        cues: [{ time: .25, rate: 0 }] } } }
    },
    outputs: { restart: link('restart'), keep: link('keep') }
  });
  const { artifacts } = graph.clip({ output: 'restart', to: 3, clock: { fps: 4 }, format: 'frames' });
  const alpha = artifact => require('../cli/png.js').raster(artifact.bytes).data[3];
  assert(alpha(artifacts[1]) > 0);
  assert.equal(alpha(artifacts[2]), 0);
  const keep = graph.clip({ output: 'keep', to: 3, clock: { fps: 4 }, format: 'frames' }).artifacts;
  assert.equal(alpha(keep[1]), alpha(keep[2]));
});

test('pose layers share cue semantics while weights stay on shot time', () => {
  const clip = K.anim.clip({ dur: 1, tracks: { 'arm.pos': [[0, [0, 0, 0], 'linear'], [1, [0, 1, 0]]] } });
  const definition = { phase: .2, cues: [{ time: .5, rate: 0 }, { time: 1, seek: 0, rate: 1 }] };
  const layers = K.anim.motionLayers.create({ duration: 3, sources: { clip }, layers: [
    { id: 'arm', clip: 'clip', clock: definition, weight: [[0, 0, 'linear'], [2, 1]], loop: true }
  ] });
  definition.cues[0].rate = 2;
  assert.deepEqual(layers.at(1.25), [{ id: 'arm', order: 0, weight: .625, sourceTime: .25 }]);
  assert.equal(layers.at(.75)[0].sourceTime, 11 / 30);
  assert.equal(layers.apply({}, 1.25).arm.pos[1], .15625);
  assert.equal(layers.at(3)[0].sourceTime, 0);
  const fitted = layers.edit('arm', { clock: {} });
  assert.equal(fitted.at(3)[0].sourceTime, 0);
  assert.throws(() => layers.edit('arm', { clock: { phase: null } }), /numerator/);
});

test('sprite parts and strips sample clocks within their tag and compose independent cels', () => {
  const cut = { numerator: 1001, denominator: 30000 };
  const sprite = { width: 2, height: 1, fps: 4,
    tags: { signal: { start: 1, end: 4 } },
    layers: {
      red: { frames: [0, 10, 20, 30].map(v => [v, 0, 0, 255, v, 0, 0, 255]) },
      green: { frames: [0, 10, 20, 30].map(v => [0, v, 0, 0, 0, v, 0, 255]) }
    }
  };
  const options = { tag: 'signal', parts: {
    red: { clock: { phase: .5, rate: 0, cues: [{ time: cut, seek: 0 }] } },
    green: { clock: { phase: .25, rate: 0 } }
  }, strips: [{ rect: [1, 0, 1, 1], clock: { phase: .5, rate: 0 } }] };
  const graph = project({
    nodes: { sprite: { op: 'anim.spriteDesync', inputs: { source: sprite, options } } },
    outputs: { value: link('sprite'), frames: link('sprite', 'frames') }
  });
  const clock = K.timeDomains.take({ fps: { numerator: 30000, denominator: 1001 } });
  assert.deepEqual(graph.run({ take: clock.at(0) }).outputs.frames, { base: 1, parts: { red: 3, green: 2 }, strips: [3] });
  const after = graph.run({ take: clock.at(1) }).outputs;
  assert.deepEqual(after.frames, { base: 1, parts: { red: 1, green: 2 }, strips: [3] });
  assert.deepEqual([...after.value.data], [10, 0, 0, 255, 0, 30, 0, 255]);
  assert.throws(() => A.spriteDesync(sprite, { parts: { red: { offset: 1, clock: {} } } }), /without a frame hold or offset/);
});
