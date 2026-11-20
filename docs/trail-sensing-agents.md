# Trail-sensing agents

Agents can sense and write to the same retained XZ deposition grid.
Each tick they compare three forward-facing sensors, turn toward a
stronger reading, and deposit where they successfully move. All sensors
read the prior field. The combined deposits then diffuse and decay.

```js
const field = KIT.deposition.grid({
  width: 144, height: 96, cell: .06, origin: [-4.32, -2.88],
  channels: {
    trail: { diffusion: .74, decay: .045 },
    beacon: { diffusion: .62, decay: .09 }
  }
});
const colony = KIT.procedural.motion.trailAgents({
  field, agents, seed: 42, capacity: 2,
  groups: { default: {
    speed: .056, sensorDistance: .38, sensorAngle: .67, turnAngle: .55,
    sense: { trail: 1, beacon: .3 }, deposit: { trail: 1.3 }
  } },
  emitters: [{ at: [2.5, .6], radius: .3, values: { beacon: .6 } }]
});
colony.step(12);
const lines = KIT.fieldViews.contours(colony.frame().source('trail'), {
  levels: [2, 5], cell: .06
});
```

## Grid and edits

`KIT.deposition.grid({ width, height, cell, origin, mask, channels,
maxWork })` makes an editable dense grid. Use one cell size or `[dx, dz]`.
`origin` is the lower corner. The optional `mask(x, z, index)` defines the
authored open cells. Choose up to eight named channels. Each channel
accepts a fraction from 0 to 1 for `diffusion` and `decay` per tick. Both
default to zero. Diffusion exchanges values with cardinal neighbors and
respects unequal cell spacing. Closed faces exchange no values.

- `stamp({ at, radius, values, mode })` paints a smooth radial brush
  into named channels. The default mode is `'add'`. Use `'set'` to
  replace affected values.
- `edit({ bounds, select, blocked, values, mode })` changes a rectangular
  region, optionally filtered by `select(x, z, index)`. Bounds default to
  the whole grid. Use `blocked: true` to close cells and erase their
  trail. Use `blocked: false` to reopen cells within the original mask.
  `values` accepts a channel record or `(x, z, index) => record` to
  import spatial cues. Return `null` to skip the write in that cell.
  The default edit mode is `'set'`.
- `step(count)` advances the field in the absence of a population.
  Use the population's `step` to integrate both together.

The dense grid shares the channel and frame interface of
[seekable deposition](persistent-spatial-fields.md). It uses local
tick-based diffusion instead of retaining an event for every deposit.

## Populations and route damage

Each agent has `at: [x, z]`. It can also carry a stable string or integer
`id`, a starting `heading` in radians, and a `group` name. Omit
`heading` for a seeded direction. The default group is `'default'`.

| Group option | Meaning |
| --- | --- |
| `speed`, `sensorDistance` | World units per tick and distance to the three sensors. Default to one and four cells respectively. |
| `sensorAngle`, `turnAngle`, `jitter` | Side-sensor offset, steering angle, and seeded exploration in radians. Defaults are .58, .53, and .13. |
| `sense`, `deposit` | Records keyed by field channel. Signed sensor weights model attraction and repulsion. Nonnegative deposits are written to the destination cell. Both default to one unit in the first channel. |

`emitters` are radial field stamps renewed each tick. Optional
`capacity` limits entry to occupied cells. Arrival is resolved in a
deterministically rotating order. A capacity of zero allows unrestricted
overlap. Use groups in one population for shared sensing and synchronous
deposition.

Movement and sensor rays stop at masked cells. Agents covered by a
closed edit pause in place until that cell reopens. Agents outside it
keep moving, allowing new traces to form around the obstruction. Use
the field mask for persistent barriers, or clear channels with an edit
to let agents cross and repaint a damaged route.

## Playback and rendering

`frame()` captures the current tick, rather than seeking automatically.
Both the field and population support JSON `checkpoint()`, `restore()`,
and `reset()`. The population checkpoint includes the grid, closures,
and all agent poses. Replay the same authored edits at the same ticks
for repeatable exports. The default grid work budget is 40 million
estimated operations per `step` call. Batch long advances.

Frames expose `sample(channel, x, z)`, copied row-major
`data(channel)` and `mask()` buffers, and `source(channel)` for world
field views. Sources live at Y = 0 by default and return `null`
outside the open mask. Supply `{ bounds, project }` for an XYZ box
and a mapping from XYZ to chart coordinates. Register a live grid
under `surfaceEffects.fields` for projected materials. Population
frames also expose retained `agents` for splats or other animation.

The local three-sensor rule follows
[Jeff Jones’s transport-network study](https://uwe-repository.worktribe.com/output/980579/characteristics-of-pattern-formation-and-evolution-in-approximations-of-physarum-transport-networks).

## Render the studies

[Mycelium Atlas and Detour Circuit](../examples/trail-sensing-studies.js)
show a growing network around obstacles and a center link that closes.
The second study uses a [boundary-driven potential field](boundary-potential-fields.md)
as a steering cue after the cut. The two groups sense it in opposite
directions and leave new deposits through the bypass.

```sh
node cli/ink-studio.js clip examples/trail-sensing-studies.js --w 850 --h 520 --px 2 --to 6.4 --fps 10 --out mycelium-atlas.png
node cli/ink-studio.js clip examples/trail-sensing-studies.js --params '{"study":"detour"}' --w 850 --h 520 --px 2 --to 6.4 --fps 10 --out detour-circuit.png
```
