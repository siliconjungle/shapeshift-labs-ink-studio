# Cycle detection and loop authoring

`KIT.loopAuthoring` finds exact discrete repeats, fits periodic tracks to
one clip length, and builds a playback loop from an evolving simulation
checkpoint. Add `--loop-join` to a clip or scene export to review the cut
as rendered.

## Find an exact discrete repeat

```js
const L = K.loopAuthoring;
const grid = K.cellular.create({
  width: 16, height: 1, boundary: 'wrap',
  neighborhood: [[-1, 0]],
  initial: ({ x }) => Number(x === 2),
  rule: ({ neighbors }) => neighbors[0]
});
const frames = [];
const cycle = L.detect({ maxTicks: 64, stateAt(tick) {
  if (tick) grid.step();
  const { cells, locked } = grid.snapshot();
  frames.push(cells);
  return { cells, locked };
} });
const repeated = frames.slice(cycle.startTick, cycle.endTick);
```

`detect` calls `stateAt(tick)` in order from `from` (default zero) through
`from + maxTicks`. A match compares full canonical contents, including
ordered array values and any authored record keys. The sampler can reuse
typed arrays. Include all state needed to predict the next tick, such as
locks, delayed inputs, or the parity of a reversible block partition. A
clock or outside input can send identical visible states down different
paths. Use `confirm` to compare additional complete repeats, with one
additional repeat by default. Use `confirm: 0` for a single recurrence.

The result gives `startTick`, exclusive `endTick`, `periodTicks`, and
`confirmedThrough`. A search can return `found: false` at its tick or state
budget. `maxStateChars` limits retained serialized state and defaults to
16 million characters.

## Phase-lock periodic generators

```js
const lock = K.loopAuthoring.phaseLock({
  from: 0, period: 6.4,
  tracks: {
    noise: { period: 2.19, turns: 3, phase: .14 },
    rotor: { period: 3.15, turns: -2, phase: .08 }
  }
});
const noiseTime = lock.sample('noise', 1.25).time;
const rotorAngle = K.TAU * lock.sample('rotor', 1.25).phase;
```

The outer `period` is the clip duration in seconds. Each track supplies its
native `period`, an optional offset `phase` in turns, and an optional
integer `turns` per clip. Omit `turns` to fit the nearest positive whole
number of cycles. Negative turns reverse playback. A sample gives wrapped
`phase`, native `time`, chosen `turns`, and the signed playback `rate`.
Pass the native time to a periodic generator such as `loopTrajectory` or a
periodic noise field. Samples at the clip origin and after one clip period
have the same phase. Use `period = frameCount / fps` to align a clock with
an export.

## Loop an evolving checkpoint

```js
const saved = run.checkpoint(); // A KIT.simulationInputs session
const loop = K.loopAuthoring.fromCheckpoint(saved, {
  open: checkpoint => K.simulationInputs.open(checkpoint, { build }),
  read: playback => playback.frame().data('ink'),
  blend: (a, b, f) => Float32Array.from(a, (n, i) => n + (b[i] - n) * f),
  periodTicks: 64,
  overlapTicks: 16
});
const field = loop.sample(2.7); // seconds
```

`open` must open a fresh run at the checkpoint. `read` returns a retained
output snapshot, such as a copied field plane or positions with stable IDs.
The loop captures `periodTicks + overlapTicks + 1` samples on the solver's
fixed timestep. Pass `dt` for a solver that leaves it unspecified.
`from` sets the output time of the wrap.

The last frame approaches the forward run at the boundary. At time zero,
playback continues from that same run's boundary tick. During the overlap
at the head of the clip, it eases from that continuing tail into replay
from the checkpoint. Only the outputs are blended. The solver advances on
its own states. `blend(a,b,f)` defines composition for your field or scene.
Set `interpolate: false` to hold whole simulation ticks while keeping the
overlap fade. `describe(seconds)` reports the source head and tail ticks
and the head weight. `join` gives the output origin, excluded endpoint,
and source tick where the clip wraps.

## Inspect the rendered join

```sh
node cli/ink-studio.js clip examples/loop-authoring-studies.js --w 960 --h 455 --px 1 --to 6.4 --fps 10 --loop-join --out loop-studies.png
```

The animation excludes the final endpoint. The accompanying
`loop-studies-join.png` shows the last included frame, the first frame,
their difference, the preceding frame, and the excluded endpoint with
its difference from the start. The matching JSON gives the exact frame
indices, scene times, and full-resolution pixel deltas, including alpha.
The sampled endpoint time is `from + frameCount / fps`. A matching
endpoint confirms image closure. The last-to-first difference shows the
actual motion step viewers will see. Compare it with the preceding step
to assess the cut.

`export-scene --loop-join` writes the same evidence into the take and
identifies it in `export.json`. The extra endpoint sample appears only in
the review. Shot recipes for clips preserve the join evidence when replayed.

[Loop Studies](../examples/loop-authoring-studies.js) previews a confirmed
16-tick discrete cycle, two counter-rotating periodic tracks, and a moving
pigment field assembled from a checkpoint.
