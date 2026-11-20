# Continuous cellular automata

`KIT.cellular.continuous` evolves floating-point state channels on a 2D chart.
Each rule can read one or more weighted neighborhoods from any state channel
and write one or more new states. Use the same chart as projected material
pigment, a contour source, or positions and intensity for emission splats.

```js
const C = K.cellular.continuous;
const preset = C.presets.lenia({ radius: 13, mu: .15, sigma: .016, dt: .1 });
const sim = C.create({
  ...preset,
  width: 128, height: 64, boundary: 'empty',
  mask: ({ u, v }) => Number(((u - .5) / .49) ** 2 + ((v - .5) / .48) ** 2 < 1)
});
sim.inject({ at: [64, 32], radius: 7, values: { life: .45 } });
sim.step();
const frame = sim.frame();
const density = frame.sample('life', .5, .5);
const potential = frame.data('potential');
```

The injection above illustrates the brush. The [culture chamber example](../examples/continuous-cellular-studies.js)
uses asymmetric ring seeds that develop into moving forms.

## Rules and sampled kernels

`create` takes `channels`, a list of distinct state names, and optional
`neighborhoods`, a map of observable names to `{ channel, kernel }`. A
rule receives `{ state, fields, x, y, tick, time, dt }`. Both maps contain
values from the preceding tick at that cell. The tick and time are for
its next state. Return any subset of the state channels as a map. Missing
channels keep their values, and returned finite values clamp to `[0, 1]`.
The entire step is applied synchronously. Internal state and neighborhood
outputs are stored as Float32 planes in row-major order, with `x` changing
fastest. Within a batch, a rejected rule result leaves the grid at its
starting tick and state.

- `kernel({ radius, weight, samples = 1, normalize = 'sum' })` samples a
  disc of the given radius in cell units. `weight(dx, dy, r)` reads each
  subcell offset and its distance as a fraction of the radius. `samples`
  gives 1–4 samples per axis. Samples outside the disc contribute zero.
- `kernel({ taps, normalize })` accepts `[dx, dy, weight]` rows at integer
  offsets. A tap reads `(x + dx, y + dy)`. Use `'sum'` for an average,
  `'l1'` to normalize a signed filter by its absolute weight sum, and
  `'none'` to retain the given weights. The returned tap table is immutable.
- Neighborhoods use CPU FFT correlation. `'wrap'` wraps the input across
  both edges. `'empty'` contributes zero beyond the grid. A normalized
  kernel keeps its original weights at edges and through masked cells.
  Small floating-point deviations can appear in derived neighborhood values.

`C.presets.lenia(options)` returns a recipe with a ring potential and
Gaussian growth integrated with the fixed `dt`. Options include `radius`,
`peaks` for successive rings, `mu`, `sigma`, `dt`, `channel` and `field`.
[Bert Wang-Chak Chan, Lenia](https://arxiv.org/abs/1812.05433)

`C.presets.smoothLife(options)` returns a recipe with independently
normalized inner disc and annulus measurements. Options include `radius`,
`innerRadius`, `birth`, `survival`, `alphaN`, `alphaM`, `dt`, `channel`,
`inner` and `outer`. Its default `mode: 'discrete'` sets each cell from the
smoothed birth/survival transition. `mode: 'rate'` integrates the transition
as a signed rate multiplied by `dt`. [Stephan Rafler, SmoothLife](https://arxiv.org/abs/1111.1567)

### Couple channels

Each preset is an ordinary recipe. This example adds a pigment channel
that gathers from living cells, diffuses, and slightly reduces growth.

```js
const coupled = C.create({
  ...preset,
  width: 128, height: 64,
  channels: ['life', 'pigment'],
  neighborhoods: {
    ...preset.neighborhoods,
    spread: { channel: 'pigment', kernel: C.kernel({ radius: 3,
      weight: (_x, _y, r) => (1 - r) ** 2 }) }
  },
  rule(context) {
    const { state, fields } = context;
    const { life } = preset.rule({ ...context,
      fields: { potential: fields.potential - .00015 * fields.spread } });
    return { life, pigment: .90 * state.pigment + .048 * fields.spread + .20 * state.life };
  }
});
```

## Masks, injections, and replay

- `initial` maps state names to a scalar, a row-major array, or a sampler
  `({ x, y, u, v }) => value`. Missing channels start at zero. `mask` and
  `setMask` accept the same forms. A zero mask clears a cell and keeps it
  inactive. A fractional mask blends each new state toward its previous
  state and scales local injections by the same fraction. Masked cells
  contribute their current stored values when neighbors sample them.
- `inject({ at: [x,y], radius, values, mode, falloff })` applies a local
  brush at the current tick. Its center and radius use cell coordinates
  with integer positions at cell centers. Add signed values with `mode:
  'add'` or blend toward target values with `'replace'`. The default
  `falloff: 'smooth'` fades to zero at the radius. Use `'flat'` for a disk
  with a hard edge. Periodic grids use the shortest distance across seams.
- `step(count)` advances a fixed number of ticks. `checkpoint()` returns a
  JSON-ready copy of the tick, state planes, mask and chart settings.
  `restore(saved)` restores that state and checks chart size, channel order,
  bounds, time step and boundary. Re-create the same rule and kernels to
  replay. Apply injections again at the same ticks after the checkpoint.
  `reset()` returns to the original state and mask.

Use up to twelve state channels, sixteen neighborhood outputs and 262,144
total state cells, with at most 512 cells on either axis and a kernel
radius of at most 64. The solver bounds the padded FFT and per-batch work.
Large kernels and grids benefit from power-of-two sizes with wrap.

## Read the field in a scene

`sim.frame()` retains the current state and resolves its neighborhood
outputs on demand. `frame.sample(name, u, v)` interpolates at chart
coordinates. Bounds default to `[0, 1]` on each axis. `frame.data(name)`
returns a copy of a row-major plane. Use `sim.center(x, y)` to map a cell
index to chart coordinates for splat emission. `frame.source(name,
{ bounds, project })` adapts the chart to a world-space
[`K.fieldViews`](field-visualization.md) scalar source.

Register a live grid in `B.finish({ surfaceEffects: { fields: { culture:
sim } } })` and point a projected layer at `field: 'culture'` with a
`maskChannel`, `contourChannel`, or `bandChannel` naming a state or a
neighborhood. Advance the grid from the scene or timeline before rendering.
The supplied render time samples the grid already at that tick. Use
checkpoints to control seeking in a live scene. [Projected material settings](projected-effects.md)

The culture chamber plots Lenia activity, ring potential and a coupled
pigment trail. Its SmoothLife study plots activity beside the disc and
annulus measurements and applies a local pulse. Both render activity as
an animated material texture and emit light splats from the same state.

```sh
node cli/ink-studio.js clip examples/continuous-cellular-studies.js --w 790 --h 460 --to 6 --fps 10 --out lenia.png
node cli/ink-studio.js clip examples/continuous-cellular-studies.js --params '{"study":"smoothlife"}' --w 790 --h 460 --to 6 --fps 10 --out smoothlife.png
```
