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

All angles are radians. All families accept `origin` (default `[0,0,0]`), `axis` (default `[0,1,0]`), optional in-plane `right`, positive uniform `scale` (default `1`) and integer `segments`. Local coordinates map to right, `cross(axis,right)`, and axis. Planar curves lie in XZ by default; use `axis: [0,0,1]` for XY. The new families use this explicit frame; older positional curve constructors retain their existing orientation.

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
