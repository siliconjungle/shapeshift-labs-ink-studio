# Surface phyllotaxis

`KIT.procedural.sampling.phyllotaxis` returns golden-angle placements
on a sphere or a normalized UV chart. Every placement includes a numeric
ID, its surface coordinates, a local frame and a spacing estimate.
Use the frame to orient a scale, petal, pin, lamp or splat.

## Grow from one pole

```js
const { sphere } = KIT.procedural.sampling.phyllotaxis;
const layout = sphere({
  center: [0, 2, 0], radius: 1.5, axis: [-0.2, 1, 0],
  capacity: 320,
  density: ({ uv: [, v] }) => 0.7 + 1.3 * Math.sin(Math.PI * v) ** 2
});

const early = layout.points(40);
const grown = layout.points(120);
const next = layout.at(120);
```

Choose `capacity` as the final number of placements. IDs run from zero
to `capacity - 1`. Grow the arrangement by requesting a longer prefix,
or fetch new IDs with `at(id)`. Earlier coordinates, frames and sizes
remain identical for a fixed layout. Defaults are a unit sphere centered
at the origin, with `axis: [0, 1, 0]`. Growth starts toward the positive
axis and progresses toward the opposite pole. `phase` rotates the
sequence around the axis in radians. The unweighted sphere uses exact
equal-area latitude and advances by `goldenAngle` in longitude.

## Use a curved surface

```js
const { surface } = KIT.procedural.sampling.phyllotaxis;
const scales = surface(meshChart, {
  capacity: 440, wrapU: true, resolution: [64, 120],
  density: ({ uv: [u] }) => 0.2 + 3 * (0.5 - 0.5 * Math.sin(u * 2 * Math.PI)) ** 4
});

for (const { point, normal, tangent, bitangent, spacing } of scales.points()) {
  S.place(scaleTemplate, KIT.V.mad(point, normal, 0.025), {
    R: [...bitangent, ...normal, ...tangent],
    scale: Math.min(0.2, spacing),
    solid: false
  });
}
```

Supply a `TexturedSurface` chart, an object with `sample(u, v)`, or a
sampling function. A sample can be an XYZ vector or an object with
`point` and optional `normal` and `tangent`. Missing frame directions
are estimated from neighboring points. The chart accepts U and V in
`[0, 1]`, including boundaries. Enable `wrapU` for closed U seams so
tangent estimation can cross the join. Growth progresses from low to
high V, and the rotation uses the weighted area along each band.

The solver approximates patch area from a grid of triangles. Each cell
gets an optional nonnegative `density({ uv, point })` multiplier sampled
at its center. Density is measured relative to physical area. A zero
weight leaves a sampled cell empty. Increase `resolution` to follow
sharp density boundaries or strong changes in chart scale. Resolution
defaults to `[64, 64]` and is bounded by `[256, 256]`. Density weights
range from 0 to 1,000,000. A layout requires positive weighted area.

The layout exposes `area` before density weighting and supports up to
65,536 points. Each immutable placement contains
`{ id, uv, point, normal, tangent, bitangent, spacing }`. The bitangent
is `normal × tangent`. The spacing estimates local coverage by taking
the square root of area per point. Chart folds, boundaries and strong
density changes can bring placements closer together. Use
[geodesic spacing](procedural.md#progressive-samples-and-surface-detail)
when an application needs an enforced minimum separation.

## Demos

[Spiral specimens](../examples/surface-phyllotaxis.js) reveals 320 scales
on a sphere in ID order and places 440 scales along a wrapped shell chart.
The shell biases coverage toward its outer face.

```sh
node cli/ink-studio.js clip examples/surface-phyllotaxis.js --w 720 --h 510 --to 5.1 --fps 14 --out spiral-orb.png
node cli/ink-studio.js render examples/surface-phyllotaxis.js --params '{"form":"shell"}' --w 840 --h 590 --out nacre-shell.png
```
