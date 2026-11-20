# Live Gray–Scott brushing

`KIT.procedural.growth.grayScott.create` keeps the Gray–Scott concentrations
and rate fields alive between edits. Advance the existing reaction–diffusion
solver on one or more sampled UV charts. Paint seed concentrations, feed or
kill, then use a velocity field to carry the chemistry along and across the
surfaces. The one-shot `grayScottGrid` and `grayScottSurface` calls use the
same numerical core. [John E. Pearson, Complex Patterns in a Simple System](https://arxiv.org/abs/patt-sol/9304003)

```js
const P = K.procedural;
const tile = P.surface.plane({ id: 'tile', origin: [0, 0, 0], u: [4, 0, 0], v: [0, 0, 3] });
const lip = P.surface.plane({ id: 'lip', origin: [4, 0, 0], u: [0, 1.5, 0], v: [0, 0, 3] });
const ink = P.growth.grayScott.create({
  charts: [
    { id: 'tile', width: 80, height: 60, carrier: tile },
    { id: 'lip', width: 30, height: 60, carrier: lip }
  ],
  seams: [{ a: ['tile', 'u1'], b: ['lip', 'u0'] }],
  feed: ({ chart, uv: [u] }) => chart === 'tile' ? .032 + .009 * u : .025,
  kill: .061
});
for (const at of [[.86, .44], [.89, .46], [.92, .48]]) {
  ink.brush({ chart: 'tile', at, radius: 5, values: { u: .48, v: .3, kill: .058 } });
}
ink.step(40);
const atSeam = ink.frame('lip').sample('v', 0, .48);
```

## Surfaces, brushes, and rates

- Each chart has `id`, `width`, `height` and an optional `carrier` with
  `sample([u,v])` returning `{ p }` in world space. The default carrier is
  a unit plane in XZ. A carrier may supply `du` and `dv` derivatives for
  world-space flow. The solver estimates missing derivatives from nearby
  samples. The chart samples fixed geometry at construction. An optional
  `mask(cell)` excludes cells from chemistry, brush paths and transport.
- A cell record supplies `{ chart, x, y, uv, p, index }`. `x` and `y` are
  zero-based grid indices. UV values lie at the cell centers in `[0, 1]`.
  `initial(cell)` returns `[u,v]` and defaults to `[1,0]`. Feed and kill
  accept a scalar or a function of the cell. Diffusion coefficients `du`
  and `dv` and the fixed reaction step `dt` are shared across the domain.
- Link two edges with `{ a: [chart, edge], b: [chart, edge], reverse, weight }`.
  Use `u0`, `u1`, `v0`, or `v1` for the edges. Tangential sample counts must
  match. Along either edge, the other coordinate increases from 0 to 1.
  `reverse: true` reverses one side. The default weight of 4 matches the
  grid's cardinal links. Seams include diagonal diffusion neighbors as the
  stencil continues across the edge. A chart can link its opposite edges to
  close a loop. Without a seam or at a masked neighbor the boundary is sealed.
- `brush({ chart, at, radius, values, mode, falloff })` starts in the active
  cell containing `at`. The radius is measured in cell steps along the
  connected surface, including diagonal steps and joined edges. The brush
  returns the number of cells addressed. Apply successive dabs along a stroke.
  A dab centered in a masked cell affects zero cells. With the default
  `mode: 'replace'`, blend toward channel targets in `[0, 1]`. Use `'add'`
  for signed edits and `falloff: 'flat'` for full strength inside the radius.
  The default smooth falloff reaches zero at the boundary. Valid channels
  are `u`, `v`, `feed`, and `kill`.

## Drive the concentrations with flow

Pass `flow(cell, clock)` at construction or in `step(count, { flow })`.
`clock` contains `{ tick, time, dt }` at the start of the update. Return
`[du,dv]` in chart coordinates per unit simulation time, an XYZ world
velocity, or `null` for a stationary cell. XYZ velocities are projected onto
the carrier's tangent plane. Every tick first evolves the reaction and
diffusion, then transports both concentrations through upwind neighbors.
This advects concentrations, using bounded substeps for high speeds. Rate
fields remain painted to their original surfaces. The same links carry
advection around folds and periodic seams. Pass `flow: null` to advance a
reference without transport.

Both `motion.shallowWater` and `motion.stableFluid` snapshots supply XZ
velocities. Sample a snapshot in world coordinates and scale its time units
to match the reaction simulation. A 3D wind field can supply XYZ directly.

```js
ink.step(12, { flow: ({ p: [x, , z] }) => {
  const sample = waterSnapshot.sample(x, z);
  return sample ? [.04 * sample.velocity[0], 0, .04 * sample.velocity[1]] : null;
} });
```

The solver supports up to 64 charts and 180,000 cells across all charts.
Step batches are bounded by `maxWork` and the flow substep limit. Split long
runs into multiple calls and scale velocity to the chemical time step. A
failed step batch leaves the simulation at its starting state.

## Read and replay

`frame(id)` retains an immutable view at the current tick. `data(name)`
copies a row-major Float64 plane. `sample(name, u, v)` interpolates the
plane, reading neighboring charts at linked edges. `active(x,y)` identifies
unmasked cells. Use `field(id)` as a live chart adapter in
`B.finish({ surfaceEffects: { fields: { ink: sim.field(id) } } })` and bind a
projected layer to `maskChannel`, `contourChannel`, or `bandChannel`. Advance
the simulation before shading. For texture atlases and splats, choose any
retained frame and map its UV coordinates through the carrier.

`checkpoint()` copies both concentrations, the painted rates and the tick into
a JSON-ready record. Restore on a matching topology with the same integration
settings. For deterministic replay, run the same dabs and velocity samples
from that tick. `reset()` restores the original concentrations and rates.

## Render the studies

[Seam Garden and Shear Flume](../examples/reaction-diffusion-brushing.js)
shows a brushed seed spreading across a folded glaze. The comparison starts
both flume basins from a shared checkpoint and applies a sampled shallow-water
current to the right basin.

```sh
node cli/ink-studio.js clip examples/reaction-diffusion-brushing.js --w 820 --h 520 --to 6 --fps 10 --out seam-garden.png
node cli/ink-studio.js clip examples/reaction-diffusion-brushing.js --params '{"study":"water"}' --w 820 --h 520 --to 6 --fps 10 --out shear-flume.png
```
