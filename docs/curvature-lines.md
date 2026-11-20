# Curvature-line ornament

`KIT.procedural.surface.curvature` evaluates and traces the principal
directions of a smooth surface. A trace comes with a native `KIT.curve.path`
for sweeps, tubes, and motion. It also carries surface-aligned frames for
placing engraved marks, shingles, scales, or fibers. On a UV chart, each
sample includes coordinates that can feed a surface mask.

```js
const { surface, surfaceMasks } = KIT.procedural;
const shell = surface.catenoid({ radius: .9, height: 2.7 });
const solver = surface.curvature.chart(shell);
const engraving = solver.trace([.1, .5], {
  family: 'min', direction: 'forward', step: .03, length: 6
});
const paint = surfaceMasks.compile([{
  points: engraving.samples.map(s => s.uv),
  width: .06,
  softness: .012
}], { size: [6, 2.7], topology: shell.topology });

const vessel = surface.curvature.implicit((x, y, z) =>
  (x / 3) ** 2 + (y / 1.5) ** 2 + (z / 1.1) ** 2 - 1);
const row = vessel.trace([0, .4, 1.1], {
  family: 'min', heading: [1, 0, 0], mask: ([, , z]) => z > .2
});
for (let d = .1; row.path && d < row.path.length; d += .22) {
  const { point, normal, tangent, side } = row.frame(d);
  // Place a scale in the tangent-side plane, with relief along the normal.
}
```

## Surface inputs and samples

- `chart(carrier, options)` accepts a smooth surface with
  `sample([u, v]) -> { p, n, du?, dv? }` on the unit square. Supplying
  `du` and `dv` gives the solver the authored world-space derivatives.
  Otherwise it estimates them from positions. The solver estimates normal
  derivatives in either case. The default finite-difference `interval`
  is `1e-4` in chart coordinates. Use [native chart topology](topological-surfaces.md)
  to keep frames continuous across periodic and orientation-reversing joins.
  A custom unit-only sampler can set `periodicU` or `periodicV` and will
  receive wrapped coordinates on those axes.
- `implicit((x, y, z) => F, options)` follows the regular zero surface
  of a smooth scalar field. Seeds are XYZ points on or near the surface.
  The gradient sets the normal and bounded Newton projection puts samples
  on the surface. Defaults are `interval: .001` in world units,
  `maxProjection: .5`, `projectionIterations: 12`, and
  `projectionTolerance: 1e-7` in world units. Optional
  `bounds: { min, max }` clips projected samples in world space.
  Define the field in a neighborhood around the zero surface so the
  difference stencil and projection can evaluate there.

To trace an Ink Studio sculpt, call `S.ready()` after adding its base
geometry and pass `S.sdf` to `surface.curvature.implicit`. Generate the
traces before adding ornament or baking the sculpt. Use seeds on smooth
patches away from sharp CSG joins.

Both adapters give you `sample(seed)` and `trace(seed, options)`.
A sample exposes `point`, `normal`, `min`, `max`, `mean`, `gaussian`,
`gap`, and `directions: { min, max }`. Chart samples also include
`du`, `dv`, canonical `uv`, raw `lift`, and `orientation` relative
to the canonical chart. The eigenvalues use the normal differential
`dN`, with positive curvature on an outward sphere. The chart calculation
accounts for the world-space metric, including skewed UV axes. The
implicit calculation restricts the field Hessian to the tangent plane
and divides it by the gradient magnitude.
[Goldman, *Curvature formulas for implicit curves and surfaces*](https://www.cgeo.uliege.be/CAO/Goldman_Curvature_formulas_implicit.pdf)

Direction vectors describe unoriented axes. Where the signed curvature
difference falls below the gap tolerance, `directions` is `null` and a
trace stops with `umbilic`. Adjust `absoluteGap` (default `1e-5`, in
inverse world units) and `relativeGap` (default `.001`) to account
for the scale and smoothness of the surface. Off-domain or singular
samples return `null`.

## Trace and placement controls

| Option | Default | Use |
| --- | --- | --- |
| `family` | `'max'` | Select the larger or smaller signed curvature with `'max'` or `'min'`. |
| `direction` | `'both'` | Trace forward, backward, or both from the seed. |
| `heading` | Local eigenvector | Choose the forward sign using a world vector. |
| `step` | `.05` | Set the nominal world-space integration step. The solver halves steps near tight bends and boundaries. |
| `length` | `4` | Limit the integration distance per traced direction. |
| `maxSteps` | `4096` | Limit the accepted steps per direction. |
| `mask(point, sample)` | Accept all | Restrict samples to a region in world or chart coordinates. Choose a step small enough to resolve narrow features. |
| `closeDistance` | `0` | Optionally close on a return to the seed within this distance, at most one step, with a matching tangent and normal. |

`trace` returns `{ samples, path, frame, closed, start, end }`. Every
sample includes cumulative arc `distance`, directed `tangent`, and
`side` across the trace. `frame(distance)` interpolates those
surface-aligned frames along the polyline. It clamps open traces and
wraps closed ones. Sample denser where surface contact or high relief
requires smaller chord error. `path` is `null` when fewer than two
stations survive. The `start` and `end` statuses report the termination
in each direction, with `null` at a seed endpoint. Statuses include
`'surface'`, `'mask'`, `'umbilic'`, `'step'`, `'steps'`,
`'length'`, and `'closed'`.

## Studies

[Saddle Engraving and Principal Scales](../examples/curvature-ornament-studies.js)
use both curvature families to etch a copper saddle and one family to
set the grain and overlap of the tiles on a glazed shell.

```sh
node cli/ink-studio.js clip examples/curvature-ornament-studies.js --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out saddle-engraving.png
node cli/ink-studio.js clip examples/curvature-ornament-studies.js --params '{"study":"scales"}' --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out principal-scales.png
```
