# Curve analysis and rotation interpolation

These dependency-free tools extend the [shared curve paths](curve-families.md). They retain the SDF/splat geometry core, point arrays, distance sampling and transported frames. Try [Path observatory](../examples/curve-analysis.html) for a movable nearest-point probe, curvature and sampling plots, periodic paths and a quaternion-driven rider. The browser example uses the same APIs as Node.

## Closest point

```js
const path = K.curve.create({type:'torusKnot'});
const hit = path.closest([2,1,0]);
// Also: K.curve.closest(pathOrPoints, query)
const pose = path.frame(hit.along);
```

Returns `{p, distance, along, t, tan, segment, fraction, parameter?}`. `distance` is the Euclidean query-to-path separation; `along` is distance from the path start; `t` is normalized arc distance. `parameter` is the underlying evaluator coordinate when available. The result is the exact closest point on the **sampled polyline**, matching geometry and route distance lookup. It does not claim to solve the continuous parametric curve. Equal-distance ties select the smaller `along`.

A lazily built, median-split segment bounding hierarchy is cached per immutable compiled path in a WeakMap. Queries prune boxes outside the current best distance. Reuse a compiled path for repeated queries; passing a mutable raw array constructs a fresh path.

## Curvature

```js
const bend = path.curvature(hit.along);
// Also: K.curve.curvature(pathOrPoints, distance, {step:.001})
if (bend.defined && bend.normal && Number.isFinite(bend.radius)) {
  const center = K.V.mad(bend.p, bend.normal, bend.radius);
}
```

Returns `{p,tan,normal,value,radius,defined,method,along,parameter?}`. `value` is unsigned curvature, `radius = 1/value`, and `normal` points toward the bend center. Straight sections have `value:0`, `normal:null`, `radius:Infinity`; zero-speed cusps or numerical failures report `defined:false` with null value/radius. JSON serializes Infinity as null.

Paths with an evaluator and retained sample parameters use five-point derivative stencils on the mathematical curve. The default parameter step is `.001` (`1e-6….02` allowed); closed paths wrap, open ends use one-sided stencils. Distance-to-parameter lookup is interpolated from the sampled length table. `p` is the evaluated point at that parameter, so it may differ slightly from the polyline point. Uniform scaling changes curvature inversely. The method is reported as `parametric`.

Raw point paths use interpolated three-point circumcircle estimates (`method:'circumcircle'`). This estimates an underlying smooth bend; a polyline itself is straight on its segments and nonsmooth at vertices. Interpolated cubic paths are C1, so their second derivatives can differ at control knots; a finite stencil there samples both sides. Estimates around singular parameterizations, tiny geometry at large world coordinates and intrinsic cusps need appropriate sampling/step sizes. No curvature value is an analytic precision guarantee.

## Adaptive sampling

```js
const path = K.curve.create({
  type:'flower', petals:7,
  adaptive:{tolerance:.003, angle:.15, maxSegments:1024}
});
const helix = K.curve.adaptive(
  u => [2*Math.cos(u*4*Math.PI), u*2, 2*Math.sin(u*4*Math.PI)],
  {tolerance:.005, maxSegmentLength:.2}
);
K.sweep(S, helix.points, profile, material);
```

`K.curve.adaptive(evaluatorOrParametricPath, options)` returns an immutable distance-sampled path, with `evaluate(u)`, retained `parameters`, `breaks`, and `sampling` diagnostics. Family definitions accept the same settings under `adaptive`, replacing uniform segment spacing. Existing uniform defaults are unchanged.

| Option | Default | Meaning |
| --- | --- | --- |
| `tolerance` | `.005` | Maximum observed probe-to-chord deviation in world units |
| `angle` | `.15` | Maximum observed angle between adjacent quarter-probe chords, radians |
| `minSegments` | `8` | Initial uniform intervals; family frequency floors apply to family definitions |
| `maxSegments` | `4096` | Hard output segment budget, ≤4096 |
| `maxDepth` | `18` | Subdivision depth per initial interval, ≤24 |
| `maxSegmentLength` | `Infinity` | Maximum endpoint chord length |
| `closed` | Input closure / false | Require meeting endpoints and repeat the first point exactly |
| `up` | `[0,1,0]` | Initial transported frame normal |
| `breaks` | Input breaks / `[0,1]` | Mandatory evaluator parameters, combined with initial samples |

The sampler checks quarter, middle and three-quarter positions and bisects failing intervals. Mandatory section/control knots remain in the output. Family definitions choose initial sampling appropriate to frequency; user-supplied family minima cannot go below that floor. Generic evaluators must have enough initial samples/breaks to expose their features: finite probes can miss high-frequency detail between them.

`sampling` contains `mode`, `segments`, `evaluations`, `tolerance`, `angle`, `maxError`, `maxAngle` and `limited`. `limited:true` means a depth/point budget prevented satisfying an observed criterion. `maxError` and `maxAngle` are the largest observed values on retained intervals, not rigorous global bounds. Raising a budget or loosening tolerance is explicit. Compilation/evaluation occurs outside render frames. Pure evaluators should return bounded finite XYZ coordinates.

Generic function evaluators cannot be serialized. Their inherited `snapshot()` preserves the sampled polyline and frame up, not executable math. Families preserve their definition, including adaptive settings. `parameters` always matches the retained points, including after redundant positions are removed.

## Interpolated paths and closed seams

```js
const loop = K.curve.interpolate(controlPoints, {
  closed:true, alpha:.5, tension:0,
  adaptive:{tolerance:.003}
});
const route = K.anim.route(loop, {speed:2});
const letters = K.curve.text(loop, 'CLOSED LOOP', {fit:true});
```

`K.curve.interpolate(points, options)` implements nonuniform Catmull–Rom as cubic Hermite spans. Options: inferred `closed`, frame `up`, `alpha:.5` (`0…1`, zero = uniform knots, half = centripetal, one = chord length), `tension:0` (`0…1`, one = zero knot derivatives), `segmentsPerSpan:12` or optional `adaptive`. Uniform interpolation allows at most 4096 segments. Closed interpolation uses periodic control neighbors, meets its start position exactly and shares first derivative across the seam. Shape crossings remain crossings; interpolation does not promise to remove them.

The existing `K.curve.spline` and other point constructors keep their behavior. Use the new interpolator when periodic/parameter-aware curves are needed. `snapshot()` returns `{points,options}`; restore with `K.curve.interpolate(snapshot.points,snapshot.options)`.

Transported path frames now return a normalized quaternion `rotation` in addition to `{p,T,N,B,t,matrix}`. They use shortest-arc SLERP between cached frame rotations. `matrix` has tangent/normal/binormal columns, as before; route vehicles retain right/up/forward matrices. Existing closed frame transport distributes residual roll and meets at the seam. A closed swept profile must also have matching width/height and compatible total twist. SLERP keeps rotations continuous; use SQUAD when interpolated key rotations need continuous angular velocity.

Camera rails can consume an interpolated snapshot directly, without smoothing it again:

```js
const rig = K.cameraRig.compile({
  rails:{track:{interpolated:loop.snapshot()}},
  shots:{ride:{target:[0,2,0],rail:'track',progress:[
    {time:0,value:0},{time:12,value:1}
  ]}}
});
```

## Quaternion rotations

`K.Q` uses unit quaternions `[x,y,z,w]` and existing row-major `K.M` rotation matrices. Inputs normalize automatically; invalid/nonfinite/zero rotations fail explicitly. Matrix conversion accepts proper orthonormal rotations and rejects scale, shear and reflections.

```js
const a = K.Q.fromAxisAngle([0,1,0], 170*Math.PI/180);
const b = K.Q.fromAxisAngle([0,1,0], -170*Math.PI/180);
const turn = K.Q.slerp(a,b,.5); // crosses the short 20° arc
const matrix = K.Q.toMatrix(turn);
const point = K.Q.rotate(turn,[0,0,1]);
```

Available: `id()`, `normalize(q)`, `fromAxisAngle(axis,radians)`, `fromMatrix(matrix)`, `toMatrix(q)`, `mul(a,b)`, `inverse(q)`, `rotate(q,XYZ)`, `angle(a,b)`, `nlerp(a,b,u)` and `slerp(a,b,u)`. Composition matches `K.M.mul`. Rotation distance is radians in `[0,π]`. Interpolation clamps `u` to `[0,1]`, handles opposite quaternion representations and uses the shortest physical rotation. SLERP uses a normalized linear fallback for nearly identical rotations. Angle measurement uses a relative quaternion and `atan2` for stability near zero.

```js
const rotations = K.Q.spline(keys, {closed:true, method:'squad'});
const q = rotations.sample(phase); // phase wraps for loops, clamps for open splines
const matrix = rotations.matrix(phase);
```

`K.Q.spline` takes 2–4096 rotations (≥3 for a loop), uniformly spaced in phase. Default `method:'squad'` uses logarithm/exponential tangent controls; `method:'slerp'` gives piecewise SLERP. SQUAD joins angular velocity at ordinary interior/periodic knots. End controls are held to endpoint rotations. Very large ambiguous turns are still shortest-arc rotations: add intermediate keys to author an intended full turn. A full 360° physical loop can change quaternion sign across the seam while its rotation matrix stays continuous. Snapshots contain `{rotations,options}` and restore with the same factory.

Existing seconds-based keyframe tracks accept a `quaternion` channel:

```js
const track = K.anim.keyframeTrack.create({rotation:'quaternion'}, [
  {time:0,value:{rotation:a},ease:'linear'},
  {time:2,value:{rotation:b}}
]);
const matrix = K.Q.toMatrix(track.sample(seconds).rotation);
```

Matrix `orientation` channels and their existing behavior are preserved. All interpolation runs in the CPU toolkit; renderers receive ordinary matrices and splats.

## CLI and references

```sh
node cli/ink-studio.js curve examples/curve-family.json --closest 1,2,0 --curvature 3 --out analysis.json
```

The curve CLI accepts family definitions or interpolated snapshots `{points,options}` and exports sampling diagnostics, parameters, optional nearest-point and curvature reports, along with the original geometry/text output.

The quaternion construction follows the standard SLERP/SQUAD approach described in [Shoemake, Animating rotation with quaternion curves](https://doi.org/10.1145/325334.325242) and [the original quaternion interpolation report](https://www.cs.cmu.edu/~compsim/papers/cs_0268.pdf). The algorithms here are implemented directly, without packages, external tables or borrowed source code.
