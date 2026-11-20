# Procedural math fields

`K.procedural.mathFields` provides dependency-free complex-plane charts, polar and logarithmic coordinates, bounded vector fields, scalar masks, and fixed-clock chaotic dynamics. The same coordinate mapping drives material coordinates, SDF/splat deformation, particle flow, or reveal selection. Geometry remains native SDFs and splats; these are optional authoring and simulation tools.

The interactive [strange garden](../examples/math-fields.html) combines a mapped pixel tapestry, live attractor particles, an analytically deformed flower, and a reveal lattice. It uses original atlas print and native splats, a small GPU skin, baked material cels, free camera controls, and individual switches.

## Coordinate charts

```js
const math = K.procedural.mathFields;
const chart = math.mapping({
  plane: 'xz', origin: [0, 0, 0], scale: [1.2, 1.2],
  steps: [
    { type: 'mobius', a: [1, .2], b: [.15, 0], c: [.28, .16], d: [1, 0] },
    { type: 'spiral', twist: 1.65 },
    { type: 'affine', rotate: .3, spin: .1, velocity: [.02, 0] }
  ],
  epsilon: 1e-6, limit: 10000, maxOperations: 128
});
const point = chart(x, y, z, time); // XYZ, unchanged component outside the chart plane
const sample = chart.sample(x, y, z, time);
// {point, jacobian:[9 row-major values], dt:[3], valid, singular, limited, seam}
chart.sampleInto(reusableSample, x, y, z, time);
```

`plane` is `xy`, `xz`, or `yz`. The selected coordinates are centered on `origin` and divided by the two signed, nonzero `scale` components, then evaluated in order. Results are multiplied by `outputScale` (defaults to `scale`) and returned to world space. The other axis passes through. Optional output arrays can be passed as the fifth argument to `chart(...)`; `sampleInto` reuses a sample's point/Jacobian/time arrays.

| Operation | Controls | Mapping |
| --- | --- | --- |
| `affine` | `scale:[1,1]`, `offset:[0,0]`, `rotate:0`, `velocity:[0,0]`, `spin:0` | Scale, rotate, translate; spin is radians/second and velocity is chart units/second. |
| `mobius` | complex `a,b,c,d` as `[real,imaginary]` | `(a*z+b)/(c*z+d)`; default identity. Coefficients are normalized up to common scale; a numerically degenerate determinant is rejected. |
| `power` | `exponent:2` in `[-16,16]` | Branch-controlled complex power, including fractional and negative exponents. |
| `reciprocal` | none | `1/z`. |
| `exp`, `log`, `sin` | none | Complex exponential, branch-controlled logarithm, and sine. |
| `conjugate` | none | Negates the imaginary coordinate. |
| `polar` | `logRadius:false` | `[radius,angle]`, or `[log(radius),angle]`. |
| `cartesian` | `logRadius:false` | Inverse polar mapping; exponentiates the first coordinate for log-radius charts. |
| `spiral` | `twist:1` | Rotates `z` by `twist*log(abs(z))`; radius is retained. |

Angles use radians. `cut` defaults to `-Math.PI` and sets the argument interval `[cut,cut+2π)`. `seam` flags a nearby branch cut for logarithms, polar maps, or noninteger powers; derivatives are local and do not bridge a discontinuity. Compositions can carry conservative seam flags even when a later inverse removes the discontinuity.

There are at most 32 operations, with an independently validated abstract operation budget. Transcendental/division operations cost more than affine ones; `chart.cost` exposes the compiled cost. These are predictable evaluation units, not wall-clock estimates.

### Singularities and finite limits

`epsilon` excludes poles and undefined polar/logarithmic origins. Such samples set `singular:true`, `valid:false`, and use `singularity:'identity'` (default) or `'zero'` in chart space. Overflow or a chart component beyond `limit` is clamped, marked `limited`, and invalidated. Returned world components stay finite and bounded by `1e9`. Jacobian/time components beyond `1e9` invalidate the derivative sample and return zero derivatives. Invalid samples yield zero masks/flow, and identity deformation. Inverted masks also leave singularities hidden.

These fallbacks are explicit authoring policies. A finite fallback is not an analytic continuation across a pole. Call `sample` to inspect validity, and choose an appropriate scene scale/domain.

## Deformation, flow and materials

```js
const deform = chart.deform({ amount: .5, maxDisplacement: .4, time: 0 });
deform.time = animationTime;
K.deform.apply(world, ids, rest, deform);
// Or evaluate at a small number of skin cells and retain GPU-carried splats:
skin.fill(boneMatrices, 0, deform);

const velocity = chart.flow({ gain: 2, maxSpeed: .7 });
const path = K.procedural.motion.streamline(velocity, seed, {
  maxSteps: 1200, maxChecks: 20000, maxLength: 8, bounds
});
const fieldSource = K.fieldViews.source({ type:'vec3', sample:velocity, bounds });

// Material coordinates use the same callable chart:
const materialAt = (x,y,z,t) => {
  const [u,,v] = chart(x,y,z,t);
  return sampleYourMaterial(u,v);
};
```

`deform` is a point map. Its analytic `jacobian(point)` includes the displacement-length cap, so splat covariance and skin matrices follow the same bounded displacement. `K.deform.jac` now accepts a finite nine-component analytic Jacobian before falling back to numerical differences. Existing deformation functions remain supported.

`flow` is displacement from the original point multiplied by `gain`, capped by **vector length**, not component. Its signature is `(x,y,z,time=0,out=[0,0,0]) => XYZ`; it plugs into the existing bounded streamline and field-view APIs. Finite speed caps can intentionally change a trajectory's time parameterization.

The scalar field expression compiler also accepts JSON nodes:

```js
const material = K.procedural.fields.compile({
  type: 'coordinateMap', mapping: chart.spec,
  source: { type:'ridge', scale:.7, octaves:3 }, fallback:0
});
const reveal = K.procedural.fields.compile({
  type:'mathMask', mapping:chart.spec,
  pattern:'rings', frequency:1.2, rate:-.12, threshold:.4, feather:.08
});
```

`coordinateMap` transforms the source's material/sample domain, including analytic spatial and time derivatives. `fallback` is a finite scalar used outside the chart's valid domain. The outer compiler charges the full source-plus-chart cost against `maxOperations`. These nodes can feed existing terrain, material, brush, and SDF expression consumers. They do not automatically add arbitrary GLSL to a renderer: bake material rasters/cels for repeated pixel sampling, or sample at a bounded number of skin/field points.

## Reveal masks

```js
const reveal = chart.mask({
  pattern:'rings', frequency:1.2, phase:0, rate:-.12,
  threshold:.4, feather:.08, invert:false
});
const coverage = reveal(x,y,z,time); // [0,1]
const jet = reveal.sample(x,y,z,time); // value, gradient, dt, valid, seam
materialisation.dissolve({ mask:reveal, duration:1.5, stagger:.3 });
```

Patterns are `bands` (first chart coordinate), `checker` (smooth alternating cells), `rings` (chart radius), and `angular` (turns around the chart origin). `frequency` is cycles per chart unit, `phase` is cycles, and `rate` is cycles/second. The smoothstep transition has width `feather` in normalized pattern value, centered on `threshold`. Width zero gives a hard mask. Angular patterns have their own principal-angle seam; noninteger frequency need not join continuously there.

The returned scalar callback already matches materialisation selection masks, procedural placement masks, and other scalar field consumers. Materialisation masks select deterministic subsets rather than partially fading every carrier. A render/alpha consumer can instead interpret the returned value as coverage. The demo removes original lattice carriers completely where coverage is zero and restores those same rows.

## Bounded chaotic dynamics

Lorenz, Rössler, Thomas, and Aizawa are continuous systems; Clifford and de Jong are discrete maps. `math.families` lists them. Existing `K.procedural.attractors.trace()` now shares their kernels and RK4 implementation; its path, density, camera-route and replay interfaces remain available.

```js
const simulation = math.integrator({
  family:'lorenz', parameters:{sigma:10,rho:28,beta:8/3},
  start:[1,1,1], dt:.01, escape:1000,
  maxSteps:64, maxEvaluations:256, maxPending:1,
  boundary:'stop'
});
const state = simulation.advance(frameDelta);
// {point,previous,tick,time,pending,status,resets,steps,evaluations,dt}
if(state.status==='budget') simulation.advance(0); // bounded catch-up; no lost time
simulation.reset();
```

Continuous systems use fixed-step fourth-order Runge–Kutta with default steps `.01` (Lorenz), `.04` (Rössler/Thomas), `.005` (Aizawa). Allowed steps are `[1e-6,.25]`. Discrete maps advance in unit iterations (`dt:1`) and accept two- or three-component initial points; their third component is zero after a map step. `reset(start)` validates before changing state. Snapshots are copies.

Custom nonautonomous flow callbacks are supported with `{field:(x,y,z,time)=>[vx,vy,vz],start,dt,...}` instead of a named family. Intermediate RK4 stage coordinates are checked against the hard escape bound before invoking a custom callback. Invalid callback output never enters retained state. Named coefficients are validated and limited to `[-1000,1000]`; unknown coefficients are rejected.

`escape` defaults to `1e5` in attractor coordinates. Optional `bounds:{min:[...],max:[...]}` defines a closed XYZ box inside that bound. On a failed step:

- `stop` (default) keeps the last finite point, clears pending time, and reports `escaped` until reset.
- `reset` returns to the initial point and increments `resets`.
- `clamp` or `wrap` applies to finite endpoints. Nonfinite endpoints reset instead; invalid numbers never propagate.

Each `advance` accepts at most 60 seconds and consumes at most `maxSteps` (default 256, maximum 65,536) and `maxEvaluations` (default four per flow step, one per discrete map step). A complete RK4 step must fit the evaluation budget. Unconsumed time remains in `pending`, with status `budget`; `advance(0)` drains another bounded slice. `maxPending` defaults to 60 seconds (maximum 3,600); exceeding it throws before queuing more time. Callers can pause, slow playback, or catch up explicitly. Fixed ticks determine time, independent of presentation frame rate, provided the pending work is eventually consumed.

These bounds control work and finite state, not numerical accuracy for every coefficient/step combination. Choose a suitable step for the system. Existing `trace()` provides bounded precomputation for static paths; the live integrator does not retain an ever-growing trajectory.

A placed, capped derivative/displacement field is also available:

```js
const velocity = math.attractorFlow({
  family:'thomas', origin:[0,1,0], scale:[.4,.4,.4], gain:1, maxSpeed:.8
});
const particle = math.integrator({ field:velocity, start:[.1,1,0], dt:.01 });
```

Continuous families return world-space derivatives; discrete families return `map(local)-local`, carried through scale and gain. Their speed cap is a separate artistic flow policy; direct named integrators retain the original equations.

## Inspect from the CLI

```sh
ink-studio math-fields chart.json --point .7,.3,0 --time 2 --out chart-report.json
ink-studio math-fields lorenz.json --integrate .1 --out integration-report.json
```

Mapping reports include the normalized immutable definition, cost, validity, branch flags, coordinates and derivatives. Integration reports include budgets and clock/escape state. JSON files do not evaluate JavaScript callbacks. `MathFields` is also exported by the browser module and Node toolkit for renderer-independent use.
