# Complex-plane fields

`KIT.procedural.complexPlane.compile(options)` creates a renderer-independent
sampler from a Mandelbrot, Julia, or Newton recipe. Sample in complex-plane
coordinates and map the results to any surface, volume slice, or raster.

```js
const julia = KIT.procedural.complexPlane.compile({
  family: 'julia',
  constant: [-.78, .136],
  iterations: 80,
  traps: [{ id: 'ring', type: 'circle', center: [.14, .12], radius: .42 }]
});

const distance = julia.field('trap', 'ring');
const bounds = { min: [-1.64, -1.64], max: [1.64, 1.64] };
const grooves = KIT.procedural.contours.march(distance, { bounds, iso: .035, cell: .012 });
const pigment = (re, im) => Math.exp(-6.8 * distance(re, im));
const emission = (re, im) => Math.exp(-185 * Math.abs(distance(re, im) - .035));
```

The pigment parameter changes with distance. The paths follow the .035
distance level, and the emission mask peaks at that same level. A slice
or contour source can use the callback directly, or wrap it with a
world-to-complex coordinate transform. See [field visualization](field-visualization.md).

## Families and outputs

| Family | Orbit | Options |
| --- | --- | --- |
| `mandelbrot` (default) | Start at zero and iterate `z² + c`, with the sample coordinate as `c`. | `escapeRadius` defaults to 4 and must be at least 2. |
| `julia` | Start at the sample coordinate and iterate `z² + c` for a fixed `c`. | `constant` defaults to `[-.8, .156]`. The radius must be at least 2 and large enough that `radius² - radius >= abs(c)`. The default is 4 or that bound if higher. |
| `newton` | Start at the sample coordinate and apply Newton's method to the polynomial with the supplied simple roots. | `roots` defaults to the three roots of `z³ - 1`. Pass 2–12 roots in the order you want for basin IDs. `tolerance` defaults to `1e-7` and can range from `1e-15` up to, but excluding, 1. Root distances must exceed twice the tolerance. |

Coordinates, centers, constants, and roots use real and imaginary components
within ±1e12. The quadratic escape radius is also capped at 1e12.
`iterations` sets a budget of 1–1024 updates and defaults to 64.

`sample(re, im)` returns these channels in one orbit evaluation.

- `status` is `escaped`, `converged`, `singular` (Newton encountered an
  undefined or numerically unstable step), or `limit` (the budget ran out).
- `iterations` counts completed updates. A Julia point already outside
  the escape radius can escape at zero updates.
- `escapeTime` is the nonnegative smooth quadratic escape time, normalized
  to the escape radius. It is `null` unless the sample escaped.
- `basinId` is the zero-based index of the converged Newton root, or `null`.
- `trap` maps each trap ID to its nearest observed distance, or `null` if no
  valid distance was recorded.

`domain(re, im)` evaluates a complex function independently of the orbit
budget and returns `{ value: [real, imaginary], phase, logMagnitude, rgb }`.
It colors the second Mandelbrot iterate `c² + c`, the Julia map `z² + c`,
or the Newton polynomial itself. Hue follows the argument in radians,
and a brightness band repeats at each octave of magnitude. Exact zero has
black `rgb` and `null` phase and log magnitude. `rgb` is packed 24-bit RGB
and works as a sprite paint value.

Use `field(channel)` for a scalar callback on `iterations`, `escapeTime`,
`basinId`, `phase`, or `logMagnitude`. Use `field('trap', id)` for one named
distance. A missing value stays `null`, so contour and slice tools can
leave a gap. For several orbit channels at the same point, call `sample`
once and reuse the result.

## Orbit traps

An orbit trap finds the smallest absolute distance to a target over
the visited orbit. [Clifford A. Carlson's orbit-trap paper](https://www.sciencedirect.com/science/article/abs/pii/S0097849399001235)

Supply up to 16 entries in `traps`. IDs default to the string form of
the entry index and must be unique. By default, Julia and Newton traps
visit the seed and Mandelbrot traps start after the first update.
Override that with `includeInitial`. All traps visit each completed update,
including the step that escapes or converges.

| Type | Distance |
| --- | --- |
| `point` (default) | Euclidean distance to `center`, which defaults to `[0, 0]`. |
| `circle` | Absolute distance to the circumference at `center`. Set a positive `radius` (default 1). |
| `line` | Perpendicular distance to the line through `center` at `angle` radians from the real axis (default 0). |
| `cross` | Distance to the closer of two perpendicular lines through `center`, rotated by `angle`. |
| `custom` | Absolute value of `distance(re, im)`. Return `null` to skip a visit. Use a pure callback for repeatable renders. |

## Demos

[Complex Plane Atlas and Orbit Press](../examples/complex-plane-studies.js)
shows all four output types, then applies one Julia orbit trap to painted
enamel, recessed bronze contours, and an animated emissive mask.

```sh
node cli/ink-studio.js render examples/complex-plane-studies.js --w 1152 --h 486 --out complex-plane-atlas.png
node cli/ink-studio.js clip examples/complex-plane-studies.js --params '{"study":"press"}' --w 920 --h 454 --to 5 --fps 12 --out complex-orbit-press.png
```
