# Coupled phase changes

`KIT.procedural.motion.phaseChange(options)` runs authored reactions on
a masked XZ grid. Each cell can hold several amounts, such as liquid,
ice, dissolved pigment, or heat. A reaction can read those amounts and
nearby cells, consume several channels, and produce new phases together.

```js
const frost = KIT.procedural.motion.phaseChange({
  width: 120, height: 80, cell: .06, origin: [-3.6, -2.4], dt: .05,
  channels: {
    liquid: { initial: .8, diffusion: .0004 },
    ice: {},
    chill: { diffusion: .04 }
  },
  rules: [{
    id: 'freeze',
    consume: { liquid: 1, chill: .12 },
    produce: { ice: 1 },
    rate: ({ fields, nearby }) =>
      Math.max(0, fields.chill - .18 + .25 * nearby.ice) * fields.liquid * 3,
    emitEvery: .16
  }],
  finish: ({ fields: { ice } }) => ({
    color: [.08 + .72 * ice, .14 + .78 * ice, .22 + .74 * ice],
    roughness: .16 + .74 * ice,
    relief: .09 * ice
  })
});
const frame = frost.step(12, {
  drive: ({ at: [x, z], fields }) => ({
    sources: { chill: (Math.exp(-((x + 2) ** 2 + z ** 2) * 3) - fields.chill) * 3 }
  })
});
const relief = frame.source('relief');
const flecks = frame.events;
```

## Author a phase recipe

- Supply `width`, `height`, `cell`, `origin`, and an optional
  `mask(x,z,index)` using the cell-centered motion grid. Spacing can
  be a scalar or an XZ pair. `initial(x,z,index)` optionally sets
  per-cell values.
- Each of up to twelve named `channels` has an `initial` value
  (default zero), a `capacity` (default one), and `diffusion`
  (default zero). Diffusion shares amounts across open cardinal faces
  and automatically subdivides when needed for numerical stability.
- Each rule names an `id`, a `rate`, and one or both of `consume`
  and `produce`. The maps hold positive coefficients per unit of
  conversion. A rule can represent a loss such as venting or a gain
  such as deposition. Rate is conversion per scene second and can be
  constant or a function of
  `{ cell, at, time, fields, nearby, inputs }`. `nearby` holds the
  cardinal-neighbor mean for each channel.
- `step(count, { drive })` advances whole ticks of length `dt`.
  For each tick, cells diffuse, then all rates read that shared state.
  The optional `drive` receives the cell context and returns
  `{ inputs, sources }`. Supply signed scalar input values for recipes
  to read and signed source rates to add to channels. Sources apply
  first, then rules claim available reactants and remaining product
  capacity in authored order.
- `emitEvery` generates one event per fixed amount of completed
  conversion. Fractional amounts carry across ticks. Events include
  `id`, `rule`, `cell`, `at`, `time`, and `amount`. The time marks
  the tick when conversion crossed the threshold. Apply a seeded
  lifetime or velocity when drawing them as splats.

## Finish and replay

An optional `finish` function derives normalized RGB `color`,
`roughness` from zero to one, and signed `relief` in scene units.
It reads the completed tick's cell state with the same fields and
neighbor means used by the solver. Keep it deterministic so retained
frames produce the same finish whenever sampled.

Use `frame.data(name)` for a copy of the row-major buffers. Color uses
three numbers per cell. `frame.sample(name,x,z)` interpolates inside
open cells. `frame.source(name,{ bounds,project,units })` adapts a
channel to `KIT.fieldViews`, with an optional projection from XYZ
world coordinates to the chart. Scalar channels can drive contour
plots, material masks, or a displaced mesh.

`step` frames contain the events for that step call. `frame()` reads
current values without replaying emissions. `checkpoint()`,
`restore(token)`, and `reset()` retain fields, emission remainders,
and the next event ID. Repeat the same timed drivers on replay. Steps
that exceed the work or event budget roll back the whole batch.

## Render the studies

[Frost Circuit and Evaporation Plate](../examples/phase-change-studies.js)
use phase color in a native texture, roughness to shade the finish,
relief to displace actual mesh vertices, and conversion events to
emit short-lived splats. The dish starts with more dissolved pigment
at the wet perimeter, where drying first leaves a raised deposit.

```sh
node cli/ink-studio.js clip examples/phase-change-studies.js --w 900 --h 560 --px 2 --to 6.4 --fps 10 --out frost-circuit.png
node cli/ink-studio.js clip examples/phase-change-studies.js --params '{"study":"drying"}' --w 900 --h 560 --px 2 --to 6.4 --fps 10 --out evaporation-plate.png
```
