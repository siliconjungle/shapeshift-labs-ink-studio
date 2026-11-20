# Orbits and attractors

`KIT.procedural.attractors.trace(options)` records an orbit with
positions, sample times, distances, and speeds. It can also create
an arc-length path or a bounded visit-density field from those samples.

```js
const orbit = KIT.procedural.attractors.trace({
  family: 'lorenz',
  steps: 1600,
  burnIn: 1000,
  dt: .01,
  pose: { scale: [.11, .05, .1], rotation: [-Math.PI / 2, 0, 0] }
});

const rail = orbit.path({ from: 1, to: 5, maxPoints: 120 });
S.tube(rail.points, .022, .022, { r: [1, 2, 3, 4] }, { res: .032 });

const fog = KIT.atmosphere.field({
  field: orbit.density({ resolution: [65, 65, 27] }),
  density: 1.9, color: '#487890', step: .055
});

const pulse = time => orbit.at(1 + (1 - Math.cos(time * Math.PI / 3)) * 2);
const volumeLighting = {
  ambient: .5,
  point: {
    at: time => pulse(time).p,
    intensity: time => Math.min(10, .5 + pulse(time).speed * .4),
    color: '#ffd095', radius: .85
  }
};
```

Put the fog in `finish.atmosphere` and use `volumeLighting` on the same
world. Feed `pulse(time).p` and `.tan` to swarm systems or live framing.
A world-space copy of `rail.points` can be placed as the eye path in a
[camera rig](camera-rigs.md). Native point rails allow up to 128 points.

## Systems and clocks

| Family | Type | Default parameters | Default start |
| --- | --- | --- | --- |
| `lorenz` | 3D flow, `dt: .01` | `{ sigma: 10, rho: 28, beta: 8 / 3 }` | `[1, 1, 1]` |
| `rossler` | 3D flow, `dt: .04` | `{ a: .2, b: .2, c: 5.7 }` | `[1, 0, 0]` |
| `clifford` | 2D map | `{ a: -1.4, b: 1.6, c: 1, d: .7 }` | `[.1, .1]` |
| `deJong` | 2D map | `{ a: 1.4, b: -2.3, c: 2.4, d: -2.1 }` | `[.1, .1]` |

The flows use fixed-step fourth-order Runge–Kutta. Their `dt` can
range from `1e-6` to `.25`. Smaller steps can resolve sharper
motion. Maps advance once per tick and use a step of one.
[Lorenz’s equations](https://journals.ametsoc.org/doi/10.1175/1520-0469%281963%29020%3C0130%3ADNF%3E2.0.CO%3B2) · [Rössler’s equations](https://www.cfm.brown.edu/people/dobrush/am34/tutorial/AN-EQUATION-FOR-CONTINUOUS-CHAOS_ROSSLER.pdf)

`steps` bounds the number of updates after `burnIn`. The defaults are
4,000 steps and 1,000 warm-up steps for flows, or 60,000 steps and 100
warm-up steps for maps. The caps are 300,000 and 25,000. `stride` keeps
every nth measured step, with the first and last positions included.
The clock starts at zero after warm-up. The orbit stops with status
`escaped` if a coordinate exceeds the raw `escape` envelope (100,000
by default) or becomes nonfinite. `warmed` and `completed`
report successful warm-up and measured steps. When warm-up escapes,
the returned trace has no samples.

## Paths, speeds, and density

- `points`, `times`, `speeds`, and `distances` are aligned immutable arrays.
  Map points start on XY with Z equal to zero. `pose` places the output
  using the normal implicit-form transform and applies its linear part
  before computing speed. `bounds` encloses the placed samples.
- For flows, speed is the magnitude of the vector field in scene units
  per simulation time unit. For maps, speed is the displacement to the
  next iterate, in scene units per iteration. `distances` accumulates
  chord lengths between recorded positions.
- `at(time)` interpolates `{ p, tan, time, distance, speed }` on the
  recorded clock and clamps to the endpoints. In an empty trace it
  returns `null`. Its tangent follows the sampled chord.
- `path({ from, to, maxPoints, up })` compiles an open `KIT.curve` path
  from a clock interval. It keeps the captured bends when they fit
  within the point cap (2–4,097). If needed it resamples uniformly
  in time. A stationary or zero-duration window returns `null`.

`density({ projection, bounds, resolution, exposure })` deposits one
visit per recorded position. Use `xyz` (the flow default) for a 3D
field, or `xy` (the map default), `xz`, or `yz` for a flat projection.
Bounds default to the projected orbit with a small pad. Supply bounds
explicitly to query a fixed viewport, compare traces, or bin an
empty trace. Resolution defaults to 256² or 64³ and can have up to
512 bins per axis and 2,000,000 bins total.

Use `bin(i, j, k)` for exact hit `mass` and `at(x, y, z)` for interpolated
mass. Both return display `density` and the mass-weighted mean `speed`.
An empty bin or out-of-bounds point has zero mass and density with
`null` speed. `sample(x, y, z)` returns only normalized density, suitable
for [bounded volumes](scene-optics.md#bounded-density-and-lit-volumes),
raster ink, or scattering. Set `exposure: 0` for linear density or
positive exposure for logarithmic density. To compare raw occupancy,
use mass and keep the bounds, resolution, and stride fixed.

## Demos

[Attractor Atlas and Strange Current](../examples/orbit-attractor-studies.js)
plots Lorenz and Rössler by speed and the Clifford and de Jong maps by
visit density. In Strange Current, one Lorenz orbit defines the tube,
the particle trails, the moving volume light, and the camera rail.

```sh
node cli/ink-studio.js render examples/orbit-attractor-studies.js --w 1140 --h 880 --out attractor-atlas.png
node cli/ink-studio.js render examples/orbit-attractor-studies.js --params '{"study":"current"}' --t 1.2 --w 760 --h 700 --out strange-current.png
node cli/ink-studio.js clip examples/orbit-attractor-studies.js --params '{"study":"current"}' --w 600 --h 552 --to 5 --fps 10 --out strange-current-clip.png
```
