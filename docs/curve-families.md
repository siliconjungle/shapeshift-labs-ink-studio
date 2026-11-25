# Curve families

`KIT.curve` offers dependency-free parametric families. They compile once into immutable point arrays and a common distance-sampled path. The paths feed SDF sweeps, routes, particles, lettering, and camera rigs.

The [Curve conservatory](../examples/curve-families.html) has orbitable sculptures with moving followers, particle trails, curved stroke lettering, ribbon and tube profiles, and an optional rail camera. Serve the repository root after building the browser bundle with `require('.').bundle()`.

```js
const path = K.curve.create({ type: 'torusKnot', p: 2, q: 3 });
K.sweep(S, path.points, { shape: 'round', w: .08, h: .08 }, material);
const route = K.anim.route(path, { speed: 2 });
const pose = route.vehicle(time);
particles.emit({ p: pose.p, v: K.V.mul(pose.tan, .4), life: .7, size: .02 });
const lettering = K.curve.text(path, 'INK STUDIO', { size: .2, lift: .25 });
for (const stroke of lettering.strokes) {
  if (stroke.length > 1) S.tube(stroke, .012, .012, gold);
}
```

## Definitions

All angles are radians. All families accept `origin` (default `[0,0,0]`), `axis` (default `[0,1,0]`), optional in-plane `right`, positive uniform `scale` (default `1`). The parametric families below also accept integer `segments`. Local coordinates map to right, `cross(axis,right)`, and axis. Planar curves lie in XZ by default; use `axis: [0,0,1]` for XY. The new families use this explicit frame; older positional curve constructors retain their existing orientation.

| `type` / point-array helper | Options and defaults | Closure |
| --- | --- | --- |
| `clothoid` | `length:5`, `heading:0`, `startCurvature:0`, `endCurvature:.6`; or `sections:[{length,curvature},…]` | Open |
| `torusKnot` | `p:2`, `q:3`, `majorRadius:1.6`, `minorRadius:.55`, `phase:0` | Closed |
| `lissajous` | `amplitude:[1.6,1.2,.7]`, `frequency:[3,2,1]`, `phase:[π/2,0,0]` | Closed |
| `logSpiral` | `startRadius:.12`, `endRadius:2`, `turns:2.5`, `height:0`, `phase:0` | Open |
| `archimedeanSpiral` | `startRadius:0`, `endRadius:2`, `turns:2.5`, `height:0`, `phase:0` | Open |
| `fermatSpiral` | `startRadius:0`, `endRadius:2`, `turns:2.5`, `height:0`, `phase:0` | Open |
| `cycloid` | `radius:.55`, `penRadius:radius`, `turns:3`, `phase:0` | Open |
| `epitrochoid` | `fixedRadius:1.8`, `fixedTeeth:7`, `rollingTeeth:3`, `pen:.8`, `phase:0`, `penPhase:0` | Closed |
| `hypotrochoid` | `fixedRadius:1.8`, `fixedTeeth:7`, `rollingTeeth:3`, `pen:.8`, `phase:0`, `penPhase:0` | Closed |
| `superellipse` | `radii:[1.8,1.2]`, `exponent:4`, `phase:0` | Closed |
| `flower` | `petals:7`, `radius:1.5`, `depth:.38`, `height:.22`, `phase:0` | Closed |

`K.curve.flower(options)` and the other named helpers return ordinary point arrays for existing `K.sweep`, `K.curve.place`, resampling, or other point consumers. `K.curve.create({type,...})` returns the compiled path. Typed numeric vectors are accepted. A closed array repeats its first point exactly at its end.

Koch, dragon, Hilbert, and Peano use the same frame and path interface with a `generation` control. [Recursive curves and unfolding](recursive-curves.md) describes edge addresses and interpolated generations.

Clothoids integrate `heading(s) = heading0 + curvature0*s + rate*s²/2` using original five-point Gauss–Legendre quadrature with bounded phase subdivisions. No Fresnel package or external data is needed. Sections inherit the preceding endpoint, heading and curvature; `curvature` is the section's ending curvature. Sections replace `length` and `endCurvature`. This joins straight, transition and constant-curvature track pieces without a mathematical curvature jump:

```js
const transition = K.curve.create({
  type: 'clothoid', axis: [0,0,1], startCurvature: 0,
  sections: [
    { length: 2, curvature: 0 },
    { length: 3, curvature: .6 },
    { length: 2, curvature: .6 },
    { length: 3, curvature: 0 }
  ], segments: 160
});
```

Torus knots require nonzero coprime integer `p/q`, each magnitude ≤32, and major radius larger than minor radius. Lissajous frequencies are positive integers ≤32; active frequencies' common divisor is removed to trace the fundamental period once. Logarithmic spirals interpolate radius exponentially, permit negative turns, and lift along the axis through `height`. Superellipses use signed powers `2/exponent`, with exponent `.25…16`. Flowers use radius `radius*(1+depth*cos(petals*angle+phase))` and axial height `height*sin(petals*angle+phase)`; depth is `0….95`, petals `1…32`.

### Spirals and rolling curves

- **Archimedean spiral.** Radius changes linearly with angle, so successive turns are evenly spaced. Either end can start at radius zero.
- **Fermat spiral.** Squared radius changes linearly with angle. Starting at zero gives one arm of the square-root spiral. Add another arm with `phase + Math.PI` to make the paired form.
- **Cycloid.** A wheel rolls on the local X axis. `radius` is its rolling radius and `penRadius` is the pen's distance from the wheel center. A pen on the rim produces cusps. Moving the pen inside or outside the rim produces the curtate or prolate form. `phase` sets the wheel angle at the start, with its center initially above the local origin.
- **Epitrochoid and hypotrochoid.** The small wheel rolls around the outside or inside of the fixed circle. Tooth counts are integers from 1 to 32. The inside wheel requires fewer teeth than the fixed wheel. The ratio determines the rolling radius and reduces automatically to the fundamental period. `pen` is measured in rolling radii and ranges from 0 to 4. Use 0 to trace the wheel center and 1 to trace its rim. `phase` rotates the full pattern and `penPhase` sets the initial pen orientation relative to contact.

The two spirals accept different nonnegative endpoint radii and optional axial lift through `height`. Both spirals and the cycloid accept signed, nonzero `turns` up to 32 in magnitude. For rolling curves with the pen on the rim, `breaks` includes the cusp parameters and path endpoints. Both uniform and adaptive sampling retain the cusp stations. Motion and cameras sample distance along the resulting path.

The [Rolling Curves gallery](../examples/rolling-curve-gallery.js) compares all five families and sets lettering along one cycloid arch. [Gear Lantern](../examples/gear-lantern.js) combines two rolling ribbons with a lettered Fermat spiral and an Archimedean camera rail.

```sh
node cli/ink-studio.js render examples/rolling-curve-gallery.js --w 1000 --h 630 --out rolling-curves.png
node cli/ink-studio.js clip examples/gear-lantern.js --w 720 --h 478 --to 5 --fps 12 --out gear-lantern.png
```

The smooth mathematical curve is sampled into straight segments. More segments improve fidelity; they do not eliminate intrinsic crossings or derivative singularities (for example, a degenerate Lissajous line or a pointed superellipse). Sweeps may intersect themselves when the curve does. Closed transported frames distribute residual roll over arc length so their endpoints meet exactly. Profiles must also match at the seam: use matching width/height and a compatible total twist.

## Shared path contract

- `points`, `closed`, `length`: frozen samples and cumulative polyline length.
- `at(distance) → {p,tan}`: binary-search distance lookup with unit segment tangent. Closed paths wrap; open paths clamp.
- `sample(u) → XYZ`: normalized **arc-length** lookup, with `u` clamped to `[0,1]`.
- `evaluate(u) → XYZ`: mathematical **parameter** lookup. It generally does not travel at constant speed. Closed `u=1` equals `u=0`.
- `frame(distance) → {p,T,N,B,t,matrix}`: cached transported frames, interpolated and orthonormalized. Matrix columns are tangent/normal/binormal, matching `K.curve.place`. Route vehicle matrices retain their existing right/up/forward convention.
- `properties`: clothoid analytic arc length, local start/end heading, and world-scaled start/end curvature.
- `snapshot()`: fresh JSON family definition; pass it to `create()` again.

`K.curve.path(points, {closed,up})` adapts arbitrary polylines to the same contract. Its snapshot contains points, closure and frame up; restore with `K.curve.path(snapshot.points, {closed:snapshot.closed,up:snapshot.up})`. The original generators remain backward compatible. Family definitions and compiled paths are distinct from raw point arrays.

## Edit retained splines

Use `KIT.curve.retained` when a cable, rail, or stroke needs named geometry
that stays editable. A version 1 `ink-studio/retained-splines` document
contains ordered splines, each with control points and directed segments.
Spline, control-point, segment, and attachment IDs are unique within their
respective namespaces in the document. Handles are XYZ offsets from the
control point. Radius is in world units and tilt is in radians around the
transported tangent.

```js
const api = K.curve.retained;
const rail = api.create({
  format: api.format, version: 1, id: 'relay-panel',
  splines: [{
    id: 'cable',
    points: [
      { id: 'start', position: [-2, 0, 0], outHandle: [.7, 1, 0], radius: .08 },
      { id: 'end', position: [2, 0, 0], inHandle: [-1, .3, 0], radius: .16, tilt: .5 }
    ],
    segments: [{ id: 'span', from: 'start', to: 'end' }]
  }],
  attachments: [{ id: 'socket', spline: 'cable', segment: 'span', t: .72 }]
});
const plan = api.plan(rail, {
  revision: api.revision(rail),
  operations: [
    { op: 'split', segment: 'span', t: .4, point: 'junction', rightSegment: 'tail' }
  ]
});
const revised = api.compile(plan.document, 'cable');
const socket = revised.anchor('tail', plan.document.attachments[0].t);
```

| Operation | Effect |
| --- | --- |
| `set-point` | Address a control point by `point` and change any of `position`, `inHandle`, `outHandle`, `radius`, or `tilt`. Moving the point carries its relative handles. |
| `split` | Insert a `point` at cubic parameter `t` on a `segment`. The leading span keeps the original ID and the trailing span gets `rightSegment`. Supply `newSpline` and `newStart` to separate an open route at the new point. |
| `cut` | Open a closed route at `point` or separate an open route at an interior point. `newStart` names the duplicate boundary point. Separating an open route also needs `newSpline`. The segment IDs are retained. |
| `join` | Join two open routes named `first` and `second`. Use optional `firstEnd` and `secondEnd` (0 for start, 1 for end) to select the ends. The first route keeps its ID. Default endpoint tolerance is `1e-8` world units. |

A split divides the cubic and its radius and tilt profiles without changing
their evaluated values. A join reverses either chain when required, swaps
its in/out handles, and negates its tilt. A welded join keeps the first
endpoint's position, radius, and tilt and reports the differences at the
removed endpoint. To preserve both endpoints across a gap, specify a new
`bridge` segment ID and a tolerance that reaches the other end. This keeps
the existing curves and adds a connector.

`plan` validates the source revision, evaluates the whole edit, and returns
the frozen replacement document, an operation and attachment receipt, and
`mapStation(spline, station)` for external normalized route stations.
Stored attachments use cubic parameter `t` within their segment. The
[route-station remapper](procedural.md#route-station-remapping) keeps that
address through edits and computes its new arc-length station. Topology-only
splits and cuts preserve attachment centers. Handle or position edits move
attached points with the edited curve. Transported frames are rebuilt along
the revised route.

`compile(document, splineId)` returns the shared curve path plus
`locate(station)`, `anchor(segment, t)`, `radiusAt(distance)`, and
named `sections`. Anchor positions use the cubic. Normalized stations and
the shared route path use bounded adaptive arc-length samples. A one-spline
document can also be passed to `KIT.curve.create`. For finite strands,
use the compiled path with `KIT.curveSplats.draw`, or a scene strand source
of `{ kind: 'retained-spline', document, spline: 'cable' }`. Radius comes
from the curve unless the strand supplies a width or radius. Elliptical
and flattened strands use the authored tilt with the curve frame.

```sh
node cli/ink-studio.js curve topology inspect original.json
node cli/ink-studio.js curve topology edit original.json split-edit.json --out split.json --report split-receipt.json
node cli/ink-studio.js curve split.json --spline return --station .4
node examples/retained-splines.cjs demo
```

Omit `--out` on `curve topology edit` to preview the receipt. The demo
replays a split, a weld, and a handle, radius, and tilt edit on a signal
cable, with matched native renders and a receipt for each socket.

## Cameras and drawings

Family camera rails use the same definition without converting into an independently smoothed spline:

```js
const cameraRig = K.cameraRig.compile({
  rails: { orbit: { family: path.snapshot() } },
  shots: { orbit: {
    target: [0,0,0], rail: 'orbit',
    progress: [{time:0,value:0}, {time:10,value:1}]
  } }
});
```

`K.curve.text(path, label, options)` wraps the existing stroke font. It returns `{strokes, width, extent}` with world XYZ strokes. Options: `size:.22`, optional font `gap` and stroke `width`, `align:'start'|'center'|'end'` (default center), distance `offset` (default 0 / half length / full length by alignment), `fit:false` (shrink only when necessary), normal `lift:0`, `wrap` (default path closure), and `maxStep:.05` for stroke subdivision. Open-path overflow throws; closed paths can wrap. Returned strokes can feed tubes, ribbons or stroke renderers.

`K.curve.drawOnPath(path, {strokes: XYPolylines, width}, options)` maps custom drawings with the same layout options. Text placement follows the shared transported normal; choose an appropriate path `up` via `K.curve.path(path.points,{closed:path.closed,up})` when lettering needs a particular facing direction.

## Budgets and tooling

Curves allow up to 4096 segments, with family-specific minimums proportional to frequency, winding or petal count. Coordinate, axis, sampling and turn budgets fail explicitly before generating unbounded output. Clothoids accept ≤128 sections and a conservative total turning budget of 256 turns. Drawings accept ≤8192 strokes, ≤32768 input points and ≤65536 subdivided points. Text accepts ≤512 characters. Compilation, quadrature and frame construction are cached outside frame rendering.

```sh
node cli/ink-studio.js curve examples/curve-family.json --distance 2 --text INK --out curve.json
```

The report contains definition, closure, sampled length, properties, points, and optional distance sample / mapped lettering. The module runs in Node and the plain browser bundle with no runtime dependencies.

For cached closest-point queries, curvature estimates, adaptive sampling, periodic interpolation and quaternion frame rotations, see [curve analysis](curve-analysis.md) and [Path observatory](../examples/curve-analysis.html).

For a soft strand renderer, feed a compiled path into [curve splats](curve-splats.md).
