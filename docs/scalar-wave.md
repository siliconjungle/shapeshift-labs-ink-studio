# Wave propagation through geometry

`KIT.procedural.motion.scalarWave` simulates a damped scalar field on an XZ
slice of a scene. Use one retained frame to color a surface by signed
pressure, trace advancing contours, or drive splat emission from wave energy.
The wave diffracts through gaps as part of the solve.

```js
const wave = KIT.procedural.motion.scalarWave({
  width: 144, height: 96, cell: .06, origin: [-4.32, -2.88],
  speed: 2.7, damping: .12, boundary: 'absorb',
  mask: (x, z) => Math.abs(x) > .14 || Math.abs(z) < .52
});
wave.kick({ at: [-2.4, -.2], radius: .4, amount: 8 });
for (let i = 0; i < 12; i++) wave.step(8);
const frame = wave.frame();
const heightLines = KIT.fieldViews.contours(frame.source('pressure'), {
  cell: .06, levels: [-.05, .05]
});
```

## Medium and boundaries

| Option | Meaning |
| --- | --- |
| `width`, `height`, `cell`, `origin` | Cell counts along X and Z, a uniform size or `[dx, dz]`, and the lower XZ corner. Samples sit at cell centers. |
| `speed`, `damping` | Constants or functions `(x, z, index)` sampled once at open cells. Speed is in scene units per second and must be positive. Damping is nonnegative and defaults to zero. |
| `mask` | `(x, z, index) => open` defines open and solid cells. Reuse footprints or slice a signed-distance function at the desired height. Geometry is sampled when the solver is created. |
| `barrier` | `(a, b, axis) => blocked` seals the face between two otherwise open neighbors. `a` and `b` are XZ centers in ascending order on the given `'x'` or `'z'` axis. Use this for walls thinner than one cell. |
| `wall` | `'reflect'` uses zero normal slope and reflects without inverting the pressure phase. `'fixed'` fixes pressure to zero at the face and inverts the reflected pressure. Applies to mask and barrier faces. |
| `boundary` | An edge mode or a map on `xMin`, `xMax`, `zMin`, `zMax`. Unspecified sides use `'reflect'`. In addition to `'reflect'` and `'fixed'`, outer edges support `'absorb'`. |
| `sponge` | Absorbing edges use a quadratic damping ramp inside the domain, followed by a fixed outer face. Set its thickness with `cells` (default 14) and peak damping with `strength` (default `7 * maxSpeed / (cells * min(dx, dz))`). Corners use the stronger ramp. The layer attenuates reflections, with effectiveness depending on wavelength, direction, and thickness. |
| `initial` | `(x, z, index)` returns pressure or `{ pressure, velocity }` at time zero. Missing values start at zero. |
| `cfl`, `maxDt`, `maxWork` | Timestep safety factor (default .9, maximum 1), timestep cap in seconds (default .05), and work budget per call to `step`. Divide larger advances into batches. |

The solver advances `u_tt + 2γu_t = c²∇²u + f` on the slice using a
five-point spatial stencil and a staggered pressure rate. The fixed
timestep is the smaller of `maxDt` and
`cfl / (maxSpeed * sqrt(1/dx² + 1/dz²))`. Resolve wavelengths, gaps, and
obstacle shapes with multiple cells when rendering close-ups. The model
covers scalar waves on a plane and uses one pressure rate per cell.

## Author a pulse and replay it

- `step(count = 1, { source } = {})` advances by whole ticks and returns the
  new tick. `source(x, z, time, index)` supplies signed acceleration at the
  start of each tick. Return zero where the source is inactive.
- `kick({ at: [x, z], radius, amount, channel })` instantly adds a signed,
  compact radial impulse. The default channel is `'velocity'`. Use
  `'pressure'` to paint a displacement. Only open cells within the brush
  are affected. The return value is the number of cells reached.
- `checkpoint()` returns JSON data. `restore(saved)` restores a compatible
  grid and returns its tick. Replay the same source and kicks at the same
  ticks for deterministic seeking. `reset()` returns to the authored
  initial conditions.
- `frame()` holds one revision. Sample `pressure`, `velocity`, or `energy`
  with `frame.sample(channel, x, z)`. Here `velocity` is a scalar time
  derivative at the preceding half tick. `energy` is a nonnegative
  visualization estimate from pressure gradients and that derivative.
  `frame.data(channel)` and `frame.mask()` return copied row-major buffers
  with X varying fastest. `frame.contains(x,z)` checks the open domain.

`frame.source(channel)` creates a field for `KIT.fieldViews` at Y = 0. To
attach it to an inclined floor, wall, or mesh, call
`frame.source(channel, { bounds, project })` with a world XYZ box and a
function mapping `[x, y, z]` to grid coordinates `[x, z]`. The source
returns `null` in solid or out-of-bounds regions. For dynamic projected
material layers, register the live solver under
`surfaceEffects.fields` when finishing the world and select the desired
`maskChannel` in the material.

See [Langtangen’s finite-difference notes](https://hplgit.github.io/INF5620/doc/notes/main_wave.pdf)
for the stencil and reflective boundaries, and
[A compact finite difference scheme for the 2D and 3D wave equation with a damping layer](https://stsynkov.math.ncsu.edu/publications/a99e_sponge_layer.pdf)
for background on sponge layers.

## Render the studies

[Bell Gate and Echo Bench](../examples/wave-propagation-studies.js)
use signed pressure for amber and cyan pigment and energy for brightness.
Bell Gate sends pulses from a bronze bell through a wall opening. Echo
Bench starts two identical pulses moving right and changes only the far
boundary of the simulation.

```sh
node cli/ink-studio.js clip examples/wave-propagation-studies.js --w 850 --h 520 --to 6.4 --fps 10 --out bell-gate.png
node cli/ink-studio.js clip examples/wave-propagation-studies.js --params '{"study":"echo"}' --w 850 --h 520 --to 6.4 --fps 10 --out echo-bench.png
```
