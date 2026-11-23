# Material-point passes and impacts

Use `sim.mpm` to sample a planar `mpm` recipe with the same graph clock,
checkpoint, seek, and cache interface as `sim.run`. The existing color,
density field, points, point buffer, grid, and report remain available.
Use `raster.select` to connect an individual material plane by its zero-based
index in the recipe.

| Port | Values |
| --- | --- |
| `materialCoverage` | One raster per material. Coverage runs from 0 to 1, using the solver's visual footprint. |
| `materialDensity` | One raster per material, splatting the particle mass onto the native pixel grid. This is an unclamped field. |
| `materialCompression` | One raster per material, measuring local area contraction from the deformation gradient. A value of 0.2 represents 20% contraction. |
| `compression` | The area-weighted compression of all materials at each pixel. |
| `contact` | Obstacle contact strength for the most recently completed tick. The value combines normal momentum corrections from grid and particle collisions over that tick in relative mass × art pixels per second. |
| `collisionMask` | The registered static and moving obstacles as 0/255 coverage. |

Compression is a footprint-weighted average of `clamp(1 − det(F), 0, 1)`,
where `F` is the simulated deformation gradient. Fluid and elastic
materials use the same measurement. Obstacle contact measures the solver's
boundary response. Materials interacting through the shared grid can also
compress each other. That interaction is visible in the compression planes.

`report.impact` gives the sum, the peak pixel strength, and that pixel's
XY center, or a null position on an empty tick. `report.colliders` gives each
moving mask's current snapped origin. Use the spatial contact pass for
placement, and threshold or palette-grade it for an impact effect.
Normalize coverage with mask scale 1 when using it as a raster mask.

## Timed velocity impulses

Set `settings.impulses` on the MPM recipe. Each entry has a `deltaVelocity`
in art pixels per second. Use a 1-based `tick` or a `time` in seconds.
An impulse runs once before that tick's first substep. A time between tick
starts rounds up to the next start. Time 0 runs during tick 1.

```js
impulses: [
  { tick: 24, body: 0, deltaVelocity: [18, -30] },
  { time: 1.2, material: 1, at: [76, 50], radius: 18, deltaVelocity: [-22, -10] }
]
```

`body` and `material` optionally filter by authored index. Supply both
`at` and `radius` for a linear radial falloff. The solver applies simultaneous
entries in authored order to released points and caps the resulting velocity
at its configured component limit.

## Moving collision masks

Set `settings.colliders` to a list of stamped rasters. A stamp can be any
size within the source pixel budget. Its origin uses top-left art coordinates.

```js
colliders: [{
  id: 'lift',
  mask: platformRaster,
  maskChannel: 0,
  maskThreshold: 128,
  keys: [{ time: 0, at: [30, 64] }, { time: .7, at: [38, 49] }]
}]
```

Supply a fixed `at` or linearly interpolated `keys` in seconds. Endpoints
hold outside the keyed range. The solver samples translation each substep
and snaps the mask to the native grid. Rebound uses the wall's velocity
relative to the material, so a moving mask can push a stationary body.
Static walls and the original aligned `settings.mask` remain available.
Tracks can move at most half a pixel per substep within the solver's speed
limit. Leave clearance where a moving stamp meets another obstacle.

The recipe permits 256 impulses and eight stamps with up to 65,536 total
source pixels. The full simulation and its rendered passes are replayable.
New checkpoints save the last tick's contact samples. Older checkpoints can
restore particle state and replay subsequent ticks with contact. Their
imported tick has an empty contact pass.

In Node, use `rasterSimulation.session(recipe, { materialPasses: true })`
and read the same six planes from `frame.passes`. For a graph example and
a rendered study:

```sh
ink-studio graph describe sim.mpm --example > mpm.json
ink-studio graph run mpm.json --out mpm
node examples/material-point-impacts.cjs ./slip-cast
```
