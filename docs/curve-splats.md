# Curve splat sources

Ink can render a 3D path as connected splat segments. The headless renderer
integrates density along each finite segment and composites its colour at the
segment's local depth. Splitting a straight span preserves its density through
the joint. Ordinary native splats can share the frame and occlude the curves. [The WebGL 2 preview](gpu-finite-curves.md)
uses the same authored shapes and has a matched reference review.
[Projected-error subdivision](curve-subdivision.md) adapts those spans to the art grid.
[Curve baking](curve-bake.md) turns them into depth cards and textured ribbons.

## Author a source

```js
const { KIT: K, makeBuilder } = require('@shapeshift-labs/ink-studio').load();
const builder = makeBuilder(1, [0x142333, 0xefb973]);
const source = {
  kind: 'spline',
  points: [[-2, 0, 0], [-.6, .9, .2], [.8, -.3, .6], [2, 0, 0]],
  samples: 8
};
const ranges = K.curveSplats.draw(builder, source, {
  radius: .05, color: '#efb973', opacity: .94, object: 'rope', material: 'hemp'
});
```

Edit the control points or original source data and draw again into a fresh
builder to rebuild its native rows. `draw` leaves its inputs available for
editing and returns the total segment count and row ranges per strand. The
round `radius` sets the Gaussian standard deviation in world units.
`opacity` runs from 0 to 1 and determines the centre opacity of a long
span seen broadside. `color` accepts a hex colour or three RGB bytes.
A JavaScript callback can select colours by strand ID, family, index,
world position, arc distance, and textile UV when present.

| Source | Data |
| --- | --- |
| Path | An array of 3D points, a compiled `K.curve.path`, or a `{ kind: 'path', points, closed }` record. |
| Spline | `{ kind: 'spline', points, samples }` samples a Catmull–Rom spline through editable control points. `samples` is per pair of controls. |
| Curve family | `{ kind: 'family', definition }` uses an existing `K.curve.create` definition. |
| Strand bundle | `{ kind: 'bundle', style, guide, count, separation, lengthVariation, seed }` generates member paths from one guide. A version 1 `bundle-plan` can be drawn directly. |
| Surface stroke | `{ kind: 'surface', chart, points, lift, inset }` follows an editable UV path on a chart. |
| Textile | `{ kind: 'textile', plan }` reads a textile or interlace plan, keeping each strand's ID and width. Set `renderer: 'curve-splats'` in `K.textile.draw` appearance to opt in directly. Existing textile plans can still use `renderer: 'patches'`. |
| Routed link | `{ kind: 'routed', link }` uses a sampled routed link's `paths`, material, and radius. Cut and broken links retain their separate spans. In simulation visuals set `visual.routedLinkRenderer: 'curve-splats'` alongside `visual.fields.routedLinks`. |
| Particle trail | `{ kind: 'trail', samples }` takes one particle's ordered XYZ points or `{ point: [x,y,z], time }` samples. Use `null` for a discontinuity or spawn break. Submit each particle separately. |

The optional `maxSegments` bounds preparation before the builder receives
any rows. Standalone scenes have a total budget of 60,000 segments.

## Set width, taper, and twist

Set the three channels independently on a strand. A number holds across the
whole strand. An array of `[u, value]` keys interpolates linearly. Use
`{ "samples": [...] }` for painted values spaced evenly along the path.
Positions run from 0 to 1 by arc length on each strand. A JavaScript
function can paint a channel from `{ u, distance, point, id, family, index, uv }`.
The `uv` entry is available on textile charts.

```js
K.curveSplats.draw(builder, source, {
  width: { samples: [.05, .11, .28, .36, .17] },
  taper: [[0, 1], [.72, 1], [1, 0]],
  twist: [[0, 0], [1, 2 * Math.PI]],
  aspect: .24
});
```

- `width` sets the nominal world-space width and takes precedence over
  `radius`. For a Gaussian section it is twice the major-axis standard
  deviation. For a flattened ribbon it measures the band before edge
  rounding. A fixed width keeps a cable at the same world gauge through bends.
- `taper` multiplies the width by a value from 0 to 1. A zero profile omits
  coverage there.
- `twist` rotates the section about the path tangent in radians. Set `up`
  to choose the initial major-axis direction. `aspect` sets the minor
  width as a fraction of the major width, from .1 to 1. Supplying `twist`
  defaults this ratio to .35 so the roll is visible. A round section uses 1.

`profileSamples` sets the sampling resolution for varying channels and
defaults to 96. The builder also splits at control keys and adds samples
for fast changes in keyed twist. The resulting piecewise sections fit
within the existing segment budget. Adjust the profiles or source geometry
and rebuild to update them.

Set `appearance.curveProfile` on a textile with `renderer: 'curve-splats'`
to pass the same options to its strands. With the simulation's curve splat
renderer enabled, set `visual.routedLinkProfiles.<link-id>` for an
individual routed link. The [profile example](../examples/curve-splat-profiles.json)
shows a fixed cable, painted stroke, tapered tip, and twisted ribbon. Run
`node examples/curve-splat-profiles.cjs studio/out/curve-splat-profiles`
to render an animated review.

## Choose a cross-section

Set `section` per strand. All three profiles support the same width, taper,
and twist channels.

| Section | Profile |
| --- | --- |
| `round` | Circular section around the tangent. It uses aspect 1 and keeps its shape under roll. |
| `elliptical` | Two transverse axes. The default minor-to-major ratio is .5. Set `aspect` from .1 to 1 for a narrower or rounder yarn. |
| `flattened` | A ribbon with a broad face, rounded edges, and a narrower thickness axis. The default thickness ratio is .16. Set `aspect` from .1 to .99. |

A compiled path supplies its transported frame. Named elliptical and flattened
sections on textile charts use the chart normal as the thin axis. Raw polylines
and sampled routes use a transported frame from world up. Set `up` to override
the strand's reference width direction, or key `twist` to turn it along the path.

```js
const ribbon = K.curve.path(points, { up: [0, 1, 0] });
K.curveSplats.draw(builder, ribbon, {
  section: 'flattened',
  width: .24,
  aspect: .16,
  twist: [[0, 0], [1, Math.PI]]
});
```

For soft edges, the headless renderer integrates the ribbon's lateral density
with seven quadrature samples and combines it into one fragment per segment
and pixel. This keeps the profile continuous across straight subdivisions.
Existing recipes also accept the implicit section chosen by `aspect` or `twist`.
The [section comparison](../examples/curve-splat-sections.json) is editable
and renders with the normal still and clip commands.

## Choose an edge profile

Set `edge` on the strand or in a textile's `curveProfile` or a routed
link's profile. Each edge works with round, elliptical, and flattened sections.

| Edge | Coverage |
| --- | --- |
| `gaussian` | The default soft falloff. Good for fibres, ink washes, and glowing strands. |
| `beta` | A compact quadratic Beta kernel integrated over the finite segment. Coverage smoothly reaches zero. Its radius of support is √6 times the Gaussian section scale in the corresponding section coordinates. A flattened section integrates the bounded kernel across its band. |
| `hard` | A binary test of the art pixel's camera ray against the swept section. Inside pixels use the strand's authored opacity, which defaults to 1 in this mode. Adjacent segments share one coverage shape and contribute once per strand per pixel. |

The hard round and elliptical modes use capsules in the section's coordinates.
Hard flattened ribbons use a rounded band. Depth comes from the first
intersection. The hard edge is evaluated at the pixel centre, so preserve the
intended art resolution when previewing it. The two soft modes default to
opacity .94.

```js
K.curveSplats.draw(builder, path, { section: 'flattened', edge: 'hard', width: .18 });
```

Open the [editable edge comparison](../examples/curve-splat-edges.json) or run
`node examples/curve-splat-edges.cjs studio/out/curve-splat-edges` to render
the matched orbit and measured coverage plots.

## Finish caps and joins

Set `caps` once for both ends or give it separate `start` and `end` styles.
Terminal caps apply to open path endpoints.

| Cap | Appearance |
| --- | --- |
| `rounded` | The default end from the selected edge kernel. |
| `blunt` | Cuts off coverage at the endpoint. Hard edges use a tangent-plane cut in world space. Soft edges use the projected tangent-plane boundary. |
| `tapered` | Narrows to a point over `length`, a fraction of the whole path. |
| `fading` | Reduces density or hard-coverage opacity over `length` while keeping the prescribed width. |

The taper and fade length defaults to .16. Use `joins` to edit an explicit
position on the strand. `at` and `length` use normalized arc length, like a
width key. A `break` removes a centered interval and trims both newly exposed
ends. It also works across a closed path's seam. A `pool` adds local density
with `strength` and width with `spread`. Set `color` for an optional pigment
tint. Both soften toward the boundary of the pool. Overlapping break
intervals combine into one gap.

```js
K.curveSplats.draw(builder, path, {
  width: .18,
  edge: 'beta',
  caps: { start: 'blunt', end: { type: 'fading', length: .22 } },
  joins: [
    { type: 'pool', at: .45, length: .10, strength: 1.5, spread: .4, color: '#d49872' },
    { type: 'break', at: .72, length: .035 }
  ]
});
```

The [editable cap and join sheet](../examples/curve-splat-caps.json) uses all
four ends and both join edits. Run `node examples/curve-splat-caps.cjs
studio/out/curve-splat-caps` for an animated comparison.

## Paint materials along the strand

Set `along` on a strand to author independent material channels by normalized
arc length. Each channel accepts a constant, `[u, value]` keys, evenly spaced
`{ samples: [...] }`, or an SDK callback with the same sample context as width.
Key and sample objects can opt into `interpolation: 'step'` or `'linear'`.
Palette roles default to step interpolation. All other channels default to linear.

| Channel | Meaning |
| --- | --- |
| `paletteRole` | Selects a named palette role with one swatch, or a stop such as `copper.highlight` or `copper.2`. Standalone scenes use the recipe's `paletteRoles` and `palette`, with background at slot 0. SDK drawing uses the builder palette and the draw option `paletteRoles`. |
| `pigment` | Supplies paint as hex or three RGB bytes. If a palette role is also present, pigment tints its swatch by multiplying the RGB channels. White preserves the role colour. |
| `opacity` | Sets local opacity from 0 to 1 and takes precedence over the strand's plain `opacity`. Cap fades and pigment pools still modify it. |
| `roughness` | Controls the width and strength of a view-dependent highlight from the nominal section. 0 is polished, 1 is matte. It uses the scene's live sun direction and intensity when enabled, or a default directional key otherwise. |
| `emission` | Adds local emitted light to the strand colour, from 0 to 8. The isolated light is available in the existing `emission` art pass. |
| `emissionColor` | Supplies a hex or RGB emission tint. It defaults to the local paint after any palette binding and pigment pool. |

```js
const materialBuilder = makeBuilder(1, [0x142333, 0xe5a271, 0x6fbcb0]);
K.curveSplats.draw(materialBuilder, source, {
  paletteRoles: { warm: [1], cool: [2] },
  along: {
    paletteRole: [[0, 'warm'], [.4, 'cool'], [.74, 'warm']],
    pigment: { samples: ['#ffeece', '#ffffff'] },
    opacity: [[0, 1], [.9, 1], [1, .2]],
    roughness: [[0, .85], [1, .16]],
    emission: [[0, 0], [.72, 0], [.88, .7], [1, 0]],
    emissionColor: '#ffac68'
  }
});
```

Material keys share the same profile resolution and segment budget as width.
Change the source palette or role bindings and rebuild to repaint the strand.
Use `appearance.curveProfile.along` for textiles and
`visual.routedLinkProfiles.<link-id>.along` for routed links. A standalone
textile world can provide the packed scene palette as `pal` and the role map as
`paletteRoles`.

The exact section highlight and the strand emission pass are available in the
headless renderer. Gaussian carriers retain the sampled pigment and opacity.
The [copper wire recipe](../examples/curve-splat-materials.json) works with the
normal render and clip commands. Run
`node examples/curve-splat-materials.cjs studio/out/curve-splat-materials`
to render the copper wire, woven yarn, and isolated channel studies.

## Light strands along their tangent

Opt into `lighting` on any strand. Give it a preset name or an object with a
`preset` and independent overrides. The headless renderer lights the local
section and follows the strand's posed tangent through bends and twists.

| Preset | Starting appearance |
| --- | --- |
| `matte-thread` | Diffuse body and broad fibre sheen. |
| `glossy-hair` | Strong tangent-aligned highlights with a little transmitted light. |
| `metal-wire` | Tight directional glints and an opaque body. |
| `backlit-fibre` | Strong forward scatter, with a brighter grazing rim when the key is behind the strand. |

| Control | Range and effect |
| --- | --- |
| `diffuse` | 0 to 1. Blends the authored pigment with directional diffuse lighting. |
| `roughness` | 0 to 1. Controls specular width. `along.roughness` takes precedence when supplied. |
| `anisotropy` | 0 to 1. Zero gives circular specular alignment around the surface normal. Higher values align the response with the tangent. |
| `sheen` | 0 to 4. Broad reflection strongest on grazing parts of the fibre. |
| `specular` | 0 to 4. Strength of the tighter reflection lobe. |
| `transmission` | 0 to 4. Strength of the light scattered toward the camera from behind. |
| `highlightColor` | Hex or RGB bytes. Tints sheen and specular together. Defaults to white. |
| `transmissionColor` | Hex or RGB bytes. Tints transmission. Defaults to the local pigment. |

Controls support the same keys, samples, and SDK callbacks used by `along`.
An object without a preset starts from `matte-thread`. In JavaScript,
`K.curveSplats.lightingPresets` exposes the preset values. Set the scene's
`liveSun` for its directional key, ambient, and intensity. Ink uses its
default key when a live sun is absent. Transmission adjusts the lit colour.
Use `along.opacity` for coverage and `along.emission` for emitted light.

```js
K.curveSplats.draw(builder, source, {
  edge: 'beta',
  lighting: {
    preset: 'glossy-hair',
    specular: [[0, .4], [.54, 1], [1, .2]],
    sheen: .12,
    highlightColor: '#d7dfff',
    transmission: .2,
    transmissionColor: '#e0a888'
  }
});
```

Use `appearance.curveProfile.lighting` for textiles and
`visual.routedLinkProfiles.<link-id>.lighting` for routed links. The
Gaussian carrier fallback uses the base pigment and coverage. Render all
four presets with `node examples/curve-splat-lighting.cjs
studio/out/curve-splat-lighting`. The script also writes editable scene JSON
for the ordinary CLI still and clip commands.

The tangent-aligned lobe draws on the same principle used in
[Scheuermann's real-time hair shading](https://shaderwrangler.com/publications/hairsketch/).
Ink uses a stylized forward-scatter term for transmission.

## Bind strokes to a surface chart

Give a stroke `kind: 'surface'`, a chart, and a polyline in chart UV.
Ink subdivides the path on the surface and carries its normal into the
strand section. The default flattened section gives paint and hatching
a low profile. Use `section: 'round'` for raised thread, or set the
section, width, and finish as on any other strand.

```js
const chart = K.procedural.surface.cylinder({
  id: 'pot', origin: [0, -1, 0], radius: 1.2, height: 2
});
const stroke = {
  kind: 'surface', chart, id: 'stem',
  points: [[.18, .2], [.22, .42], [.26, .55], [.32, .8]], lift: .008
};
K.curveSplats.draw(builder, stroke, {
  edge: 'hard', width: .06, color: '#16435d', object: 'pot'
});
```

`lift` moves outward along the chart normal and `inset` moves inward.
Both use world units and default to zero. Use a constant or an arc-length
track to vary them along a mark. For instance, `lift: { samples: [0, .09, 0] }`
arches a stitch while its ends sit on the chart. Offset callbacks receive
`{ id, uv, point, normal, distance, u }` on the underlying chart path.
`tolerance` sets the target chord error in world units and defaults to .001.
`source.profileSamples` controls varying offsets and defaults to 64.

Use an existing sampler with `sample([u, v])` or
`samplePointNormal([u, v])` returning `{ p, n }`. Standalone
curve-splat scene JSON can place a native chart definition inline as
`source.chart` or use its name from a top-level `charts` map. Definitions
use `kind` with the native `plane`, `cylinder`, `mobius`, `kleinBottle`,
`helicoid`, or `catenoid` options. These scene files render the marks by
themselves. Add them to an existing sculpt with the SDK for occlusion and
relief.

UVs are unit coordinates by default. On a joined chart, Ink picks each
point's nearest equivalent to the preceding point. Use
`coordinates: 'lifted'` for an explicit winding. For example, U can run
from .8 to 1.8 on a cylinder. Open axes stay within the unit interval.
Supply `closed: true` to make a loop. Its endpoints must meet at the same
offset and side of the chart. An offset on a Möbius centreline can take
two circuits to close. `K.curveSplats.surfacePath(stroke)` exposes sampled
positions, lifted UVs, and normals for inspection. Rebuild from the UV
path after changing or placing the chart.

### Cut a groove

Use the same stroke source with `K.curveSplats.carve` before baking a
sculpt. Each groove subtracts a round swept cutter from a held host solid.
The cutter's `radius` and the stroke's signed offset control the opening
and depth. Place the cutter so it intersects the host surface. A deep
inset can bury it completely. The cut's walls contribute real surface
depth and can use the sculpt's existing `inner` ramp.

```js
const solid = S.lathe([0, -1, 0], 2, 1.2, stone, { hold: true, res: .06 });
K.curveSplats.carve(S, solid, [
  { source: { ...stroke, lift: 0, inset: .025 }, radius: .08 }
], { inner: [2, 3, 4] });
S.bake();
```

Run the [curved-surface studies](../examples/surface-bound-strokes.js) with
`node examples/surface-bound-strokes.cjs studio/out/surface-bound-strokes`.
The CLI can render the same editable study with
`node cli/ink-studio.js render examples/surface-bound-strokes.js --params '{"study":"groove"}' --raw --out groove.png`.

## Drive strands from rigs and simulation

`K.curveSplats.bind(builder, source, driver, appearance)` prepares the
reference path and assigns its splat rows once. Each pose moves the knots and
rebuilds the segment geometry in those rows. Width, taper, twist, caps,
material tracks, and the strand's selection ID stay attached to the same
places on the reference path. Patterns use reference arc length, so an
extending span carries its bands with it.

```js
const C = K.curveSplats;
const cord = C.bind(builder, { kind: 'path', id: 'lanyard', points: restPoints },
  C.drivers.sockets(['belt', { socket: 'grip', offset: [0, .06, 0] }]),
  { width: .07, lighting: 'matte-thread' });

// Register the sockets and install the rig's pose system on the stage.
stage.add(cord);
```

| Driver | Input |
| --- | --- |
| `drivers.bones(influences)` | One bone index or named stage rig part per reference knot. Use `{ bone, second, weight }` to blend two transforms at a knot. On a native bone table pass the handles in `K.bones.bind(world, { ..., curveBindings: [cord] })`. |
| `drivers.sockets(anchors)` | Stage socket names, fixed XYZ points, or `{ socket, offset }` records. Supply `{ entity, socket, offset }` and a world query when posing from an entity socket. |
| `drivers.xpbd(solver, indices, { links })` | Solver point indices per knot. The optional link list suppresses broken spans without changing row IDs. A callback can supply a saved solver motion record with `positions` and `broken`. |
| `drivers.chart(chartOrCallback)` | Reprojects retained stroke UVs and their authored normal offsets onto a posed chart. Optional `chart.intact(uv)` controls whether spans render across damaged cells. |

Pass the handle to `stage.add` to sample after the stage's pose and
simulation systems. To present an external snapshot, call
`handle.pose(world, { time, stage, query })` with the context your driver
uses. A custom driver receives the frozen reference path and this context.
It returns one XYZ point per retained knot, or
`{ points, normals?, up?, active? }`. Use `active` to enable or hide each
reference span. Keep the world and its native row range for the life of the
binding. Use the curve driver for those rows and native rig ownership for
the surrounding sculpt.

A native cloth writes its posed UV strokes during the same presentation as
its surface, including explicit cloth review poses.

```js
const hem = cloth.bindStroke({
  id: 'hem', points: [[.08, .95], [.92, .95]], lift: .02
}, { edge: 'hard', width: .05, color: '#ffc981' });
stage.add(cloth);
```

For hair or tassels set `renderer: 'curve-splats'` in `K.hair` and pass any
strand look in `curveProfile`. The groom solver and root rig bindings drive
the segments. Supply a root `id` to select an individual lock. These options
use the finite strand renderer in Node and the CLI. WebGL uses the moving
Gaussian carriers.

Run the four [editable binding studies](../examples/curve-splat-bindings.js)
with `node examples/curve-splat-bindings.cjs studio/out/curve-splat-bindings`.
The CLI can select an individual study with
`--params '{"study":"bones"}'`, `sockets`, `cloth`, or `strands`.

## Generate strand bundles from a guide

Use a `kind: 'bundle'` source to draw multiple continuous strands from one
editable guide. The guide can be a point list, native `K.curve.path`, spline,
curve family, or surface stroke. A surface guide can use a chart from the
standalone scene's `charts` map. The generated member paths carry stable
`<id>:<index>` labels for picking and material callbacks.

```js
const source = {
  kind: 'bundle', id: 'signal-cord', style: 'twisted-cable',
  guide: { kind: 'spline', points: [[-2, 0, 0], [0, .6, .2], [2, 0, 0]] },
  count: 4, separation: .18, turns: 3, lengthVariation: .08, seed: 31
};
K.curveSplats.draw(builder, source, {
  edge: 'hard', lighting: 'metal-wire',
  color: ({ index }) => ['#e1a267', '#b87853', '#995e50', '#f2c991'][index]
});
```

| Style | How separation is measured | Additional controls |
| --- | --- | --- |
| `braid` | Distance between adjacent braid slots in the guide's transported frame. | Signed `word`, `repeats`, `clearance`, and `samplesPerCrossing` use the [interlacing solver](weaving-braiding.md#braid-around-a-path). |
| `twisted-cable` | Distance between adjacent strand centres at each guide station. | Signed `turns` along the guide and optional `samples`. Use a whole number of turns on a closed guide. |
| `clumped-hair` | Base spacing for the lock layout. | `clumps`, `tightness` from 0 to 1, `frizz` relative to separation, and `samples`. Colour callbacks can use the member's `clump` index. |
| `frayed-hem` | Arc distance between roots centred along the guide. Omit it to distribute roots over the full guide. | Fibre `length` in world units, `frizz` relative to separation, and `samples` per fibre. Raw guides default to a downward fibre direction. Set `up` or supply a framed native guide to orient the fibres. |

`lengthVariation` ranges from 0 to .9 and shortens each member by a seeded
fraction of its own length. It leaves the root in place. For cable and braid
loops, shortening opens the tips. Supply `radius` on the source to override
the default member size. Braids check clearance with that declared radius.
Width, taper, palette, and lighting are ordinary curve-splat appearance
controls. The per-bundle `seed` takes precedence over the standalone scene
seed when both are supplied.

Use `K.curveSplats.bundle(source)` to generate an immutable, serializable
plan. Each member has a path, length, radius, and ID. Braid plans also report
over-under crossings. Pass the plan to `K.curveSplats.draw` or place it in a
curve-splat scene as a `source`. Keep the guide recipe to regenerate after
an edit.

Run the [editable bundle studies](../examples/curve-splat-bundles.js) with
`node examples/curve-splat-bundles.cjs studio/out/curve-splat-bundles`.
Use `--params '{"style":"frayed-hem"}'` to select a study in CLI
`render` and `clip` commands.

## Animate a reveal window

Add `reveal` to a strand's appearance. `start` and `end` are independent
positions from 0 to 1 along the strand's reference arc length. They default
to 0 and 1. Where the window is empty the strand is hidden. The renderer
trims partial segments at the sampled positions, including on posed paths.

```js
K.curveSplats.draw(builder, source, {
  width: .12,
  edge: 'hard',
  reveal: {
    end: [[0, 0], [.24, 0, 'smooth'], [1.18, 1]],
    start: [[0, 0], [1.28, 0], [2.15, 1]],
    width: [[0, .65], [.8, 1.25], [2.15, .55]],
    opacity: 1
  }
});
```

Reveal controls accept a constant or `[seconds, value, easing?]` keys.
Use `{ keys, ease }` to set a shared easing. Each key applies its easing to
the following interval. The default is linear. Start, end, and opacity
range from 0 to 1. Width is a multiplier from 0 to 8. The keys use the
renderer scene clock and hold their first and last values outside the
key range. Use successive strands with different key times to write
multi-stroke lettering.

## Age a recorded trail

Set `trail` on the appearance and give each trail sample a time in seconds.
Times increase within each continuous run. Keep `null` between runs to
separate spawns, teleports, or sweeps. The head follows the recorded
positions between samples. The tail stops at `time - lifetime`.

```js
K.curveSplats.draw(builder, {
  kind: 'trail',
  samples: [
    { time: 0, point: [-2, 0, 0] },
    { time: .35, point: [-.4, .6, .2] },
    { time: .7, point: [1.4, -.1, .4] }
  ]
}, {
  edge: 'beta',
  width: .19,
  trail: {
    lifetime: .54,
    width: [[0, 1], [.38, .8], [1, .1]],
    fade: [[0, 1], [.25, .9], [1, 0]]
  }
});
```

Trail width and fade use normalized age. 0 is newborn and 1 is the end
of the lifetime. They use the existing spatial profile syntax, including
`{ samples: [...] }` and SDK callbacks receiving `{ u, age, time }`. Age and time
are in seconds. Width ranges from 0 to 8 and fade from 0 to 1. `trail: true`
uses a one-second lifetime, constant width, and a linear fade. `ageSamples`
sets the sample density per lifetime for wide timestamp gaps and defaults
to 24. These subdivisions use the same strand segment budget as the
existing profiles. Combine `reveal` and `trail` to apply their windows and
gains together.

Timed controls are sampled by the finite curve path in the headless library
and CLI. Keep `curveSplats` enabled when rendering a timed shot. Run
`node examples/timed-curve-trails.cjs studio/out/timed-curve-trails` to render
the three studies and write their editable curve-scene JSON. Render or clip
those files with the ordinary CLI and the intended scene times.

## Filter subpixel coverage by material

Use `look.edgeFilter` with the strand's `material` label to choose how its
coverage resolves. This scene filters `rigging` while keeping the deliberate
pixel steps of `sign-paint`. Set `strength` to 0 for a single centre sample,
1 for the full filter, or a value between them to blend. Unmatched materials
use centre sampling unless the settings include a fallback strength.

```json
{
  "look": {
    "edgeFilter": {
      "rules": [
        { "select": { "material": "sign-paint" }, "strength": 0 },
        { "select": { "material": "rigging" }, "strength": 1 }
      ]
    }
  }
}
```

The filter works with the curve's existing `edge` and section settings in
both headless camera projections. It traces 16 staggered positions per
native art pixel. Hard profiles resolve overlapping segments of a strand
once at each sample position. Beta and Gaussian profiles average optical
depth so dividing a path into more segments preserves its density.
Coverage resolves before the palette. Include intermediate swatches if
you want faint partial coverage to survive palette matching.

Run `node examples/curve-splat-coverage.cjs studio/out/curve-splat-coverage`
for matched pans, an APNG, an editable scene, and measured coverage. The
normal CLI `--edge-filter off` switch previews centre sampling for all
materials, and `--edge-filter file.json` previews alternate rules.
The [edge filtering guide](edge-filter.md) lists all selectors and overrides.

## Set art-pixel width by material

Use `look.curveWidth` in a curve-splat scene or JavaScript world, or
`finish.look.curveWidth` in a diorama. The first matching selector wins.
Materials keep their physical gauge by default. Set an explicit
`physical` rule to exempt a material when the scene has a different default.

```json
{
  "rules": [
    {
      "select": { "material": "tension-cord" },
      "policy": { "mode": "minimum", "pixels": 1.12, "maxScale": 6 }
    },
    {
      "select": { "material": "linen-infill" },
      "policy": { "mode": "fade", "range": [0.48, 0.91] }
    },
    {
      "select": { "material": "body-yarn" },
      "policy": { "mode": "physical" }
    }
  ]
}
```

| Mode | Behaviour |
| --- | --- |
| `physical` | Use the authored width, including any width profile, taper or animation. |
| `minimum` | Enlarge the cross-section if its projected nominal width drops below `pixels`. Optional `maxScale` limits how much it can grow. Rounded caps grow with the section. |
| `fade` | Keep the physical cross-section and fade opacity smoothly through `range: [hiddenAt, fullAt]` in art pixels. Use this on fine threads where a width floor would fill the gaps. |

The headless renderer measures across the projected path, including the
orientation of elliptical and flattened sections. For optical profiles the
width is the nominal gauge, independent of the soft halo. Perspective depth
can vary along a strand, so a part close to the camera can stay at its
physical width while a distant part widens or fades. The policy applies
after timed width and reveal and before subpixel sampling and palette resolve.

Use `render(world, { curveWidth })` or `--curve-width file.json` to audition
alternate rules. Use `--curve-width off` to preview physical widths throughout.
The [loom demo](../examples/curve-splat-minimum-width.cjs) makes three matched
zooms and writes the editable scene and an alternate policy file.

## Anchor grain, dashes, and dither

Set `pattern` on a curve appearance in a JSON scene or in
`K.curveSplats.draw` and `K.curveSplats.bind`. Each layer can use its own
anchor and spacing. Omit a layer or set it to `false` to disable it.

```json
{
  "pattern": {
    "dash": { "anchor": "arc", "spacing": 0.48, "duty": 0.68, "phase": 0.03 },
    "grain": { "anchor": "chart", "spacing": [0.04, 0.035], "seed": 11, "strength": 0.24 },
    "dither": { "anchor": "screen", "spacing": 2, "colors": ["#b6614d", "#f4c279"], "mix": 0.5 }
  }
}
```

| Anchor | Coordinates |
| --- | --- |
| `arc` | Reference distance from the strand's authored start in world units. Use this for stripes or dashes that stretch and bend with the curve. |
| `chart` | The surface's UV coordinates. Surface strokes extend the UVs across their width from the chart tangent. Textile paths use the UVs supplied at their stations. Periodic native charts wrap to the same UVs across a seam. |
| `screen` | Native art pixels measured from the upper-left output corner. Use this for a print grid that stays fixed as a curve moves across it. |

`dash.spacing` is the full period. `duty` is the visible fraction,
`phase` offsets the pattern in the same units as spacing, and
`offOpacity` defaults to 0 for an actual gap. For chart and screen
dashes, set `axis: "v"` for the second coordinate. The default is `"u"`.
Dashes are applied before coverage resolve, including on soft profiles.

Grain gives each cell seeded brightness variation. Dither uses Ink's
ordered Bayer thresholds to choose between two pigment colors. The
`colors` entries can be hex colors, RGB bytes, or individual named
palette roles. `mix` is the fraction of the second swatch. Grain and
dither accept a single cell spacing or a pair for the two axes. The
default spacing is .12 world units for arc, .05 for chart, and 1 for
screen. Pigment still receives curve lighting and scene palette resolve.

The headless renderer reads reference coordinates at the fragment.
Splitting a straight span or clipping it with a reveal window preserves
pattern phase. Bound curves carry the reference coordinates to the posed
geometry. Hard dither selects one pigment per representative pixel hit,
while filtered coverage can soften the rim of a dash.

Run `node examples/curve-stable-pigment.cjs studio/out/curve-stable-pigment`
to compare a bending cable with arc and screen anchors and see a
chart-anchored band on a rotating cylinder. The demo writes the editable
curve scenes alongside its PNG and APNG.

## Depth, crossings, and shadows

Author over-under crossings by separating the strands in 3D. The headless
renderer sorts each fragment by the depth of its finite strand intersection.
Touching spans of a hard strand share coverage at the join. Separate spans at
a self-crossing retain independent depth and opacity. Ordinary solids and
SDF-assisted surfaces can occlude the strand at the same pixel.

Set `atmosphere` on a curve scene or a JavaScript world to place curves
through bounded mist. Ink applies the medium up to each fragment's depth,
including translucent spans. Use the normal `--atmosphere off` override
for a clear comparison.

Set `shadow: { cast: true, receive: true }` on a strand appearance to
participate in headless [live sun lighting](live-sun.md). The two switches
default to false and can be set independently.

- Cast uses the posed physical section, timed reveal, and arc or chart
  dash gaps. Translucent spans attenuate the light by their coverage.
- Receive samples the shadow map at the fragment's position. Strand
  lighting keeps its ambient fill and emission while direct light dims.
- Scene `shadowArt` filters still apply. A curve's art-pixel width floor
  and screen-anchored dash pattern are camera effects. Shadow casting
  uses its world shape.

Run `node examples/curve-depth-crossings.cjs studio/out/curve-depth-crossings`
to render the woven crossings, the mist pass, and the shadow switches.

## Simplify strands at a distance

Set `lod` on a strand appearance or a grouped source such as a bundle or
textile plan. It applies to the headless view. The source paths stay
editable and the physical strands still cast their authored shadows.

```json
{
  "lod": {
    "simplify": [0.16, 0.38],
    "aggregate": {
      "transition": [0.48, 1.35],
      "color": "#c58655",
      "samples": 20
    }
  }
}
```

- `simplify: [merge, full]` measures chord error in art pixels, including
  the projected equivalent of depth error. Contiguous round spans with the
  same appearance can merge below `merge`. Their intermediate vertices
  ease toward the chord up to `full`. Tight bends, section changes, patterned
  spans and authored cuts retain their detail. `lod: true` uses the default
  simplification range `[0.16, 0.38]`.
- `aggregate.transition: [coarse, detail]` measures the projected pitch
  of neighboring strands. Above `detail`, draw the individual strands.
  Below `coarse`, draw one larger strand on their shared centreline.
  In between, an ordered art-pixel pattern selects one representation per
  pixel, preserving depth and avoiding double opacity.
- Group threads that run in the same direction. The representative follows
  their mean centreline and takes its width and pigment from the group.
  Supply `pitch` or `width` in world units, an explicit `color` or
  `opacity`, or `samples` from 4 to 64 to art-direct that shape.
  Bound groups update their centreline and measured spacing as they pose.
  A group with partially revealed or inactive strands keeps the detail view.

Use `render(world, { curveLod: false })` or `--curve-lod off` for a matched
comparison. Render statistics include `curveSegments` and, for active LODs,
counts for removed spans, selected aggregate groups, and groups in transition.
The [distance demo](../examples/curve-distance-simplification.cjs) shows
the same bands and bends in both modes during a zoom out.

## Layer budgets and quality review

Set `look.curveQuality` in the scene, pass `curveQuality` to the Node
renderer, or give the CLI `--curve-quality budgets.json`. Layer rules use
[target selectors](art-passes.md) in order, with the first match taking
precedence. Each rule needs a unique ID and at least one limit. Use zero
to omit a layer or leave a limit unset to give that layer no cap for that
resource. Pass `false` in Node or `--curve-quality off` in the CLI to
disable the layer budgets.

```json
{
  "layers": [
    { "id": "frame", "select": { "material": "frame-cord" }, "segments": 96 },
    { "id": "strings", "select": { "material": "silk" }, "segments": 68 },
    { "id": "winding", "select": { "material": "winding" }, "fragments": 3100 }
  ]
}
```

Each color raster pass admits whole visible strands in source order after
timing and authored LOD. A group crossfading to its proxy within a layer is
admitted together. The segment cap counts visible spans submitted to the
rasterizer. The fragment cap reserves one slot per art pixel in each span's
projected bounds, including the edge filter margin. That conservative
reservation bounds raster work even when a span's rectangular footprint
contains empty space. `renderStats.curveQuality` reports the requested and
admitted slots, actual composited fragments, and omitted strands per layer.
Use the existing LOD settings to simplify eligible spans before admission.

```sh
ink-studio strand-review examples/curve-quality-harp.js --w 176 --h 112 \
  --from 0 --to 4 --fps 12 --camera-orbit 52 --out harp-review
```

The review renders both versions from one pose, at the same time, camera,
lighting, palette, and native export dimensions. Use `--camera-pan x,y,z`
for a pan or `--t seconds` for a still. The preview puts the reference on
the left, the budgeted render in the middle, and the evidence on the right.
The JSON includes frame time, segment and fragment counts, and pixel and
path-station evidence for these checks.

| Check | Measurement |
| --- | --- |
| Strand breaks and omissions | Missing visible samples bracketed by surviving samples on the same continuous reference run count as a break. A wholly missing strand has its own count. The preview marks missing stations in red. |
| Join brightness | Compare the sRGB luma step across an authored join against the matched reference. Report the largest step and added change. Amber marks threshold crossings. |
| Flicker | Follow the reference strand motion across frames and measure reversals in the brightness difference between versions. Magenta marks reversals above the threshold. Cuts restart the comparison. |

The checks sample visible paths from the finite-curve passes. Reference
gaps, offscreen paths and disocclusions are excluded where there is no
matched sample. In Node, `reviewCurveQuality(world, options, receive)`
returns the same measurements and optionally passes each matched image and
evidence map to `receive`. Use `options.thresholds` to tune `coverage`,
`joinLuma` and `flickerLuma`, each expressed from zero to one.

## Render and compare

The [editable example](../examples/curve-splat-scene.json) uses
`format: "ink-studio/curve-splat-scene"`, `version: 1`, an `id`, and a
`strands` array. Each entry combines a `source` with drawing options. Supply
`background`, `palette`, or `camera` for a particular shot. In Node, build the
same JSON with `K.curveSplats.world(recipe)`.

```sh
node cli/ink-studio.js render examples/curve-splat-scene.json --raw --w 192 --h 96 --out crossing.png
node cli/ink-studio.js clip examples/curve-splat-scene.json --raw --w 192 --h 96 --fps 12 --to 3 --camera-orbit 30 --out crossing-orbit.png
node cli/ink-studio.js render examples/curve-splat-scene.json --curve-mode splats --raw --w 192 --h 96 --px 1 --out gaussian-carriers.png
node examples/curve-splat-gallery.cjs studio/out/curve-splats
```

`--curve-mode splats|curves` selects the ordinary Gaussian carriers or the
finite-curve kernel for `render` and `clip`. Both named modes evaluate timed
reveal and trail controls, and use the same scene depth and atmosphere
compositing. Curve-only coverage profiles, caps, tangent lighting, and
distance proxies apply in `curves` mode.

```sh
node cli/ink-studio.js compare examples/curve-mode-signal-coil.js --curve-modes \
  --w 176 --h 112 --from 0 --to 4 --fps 12 --camera-orbit 28 --out studio/out/coil-modes
```

Use `--t 1.5` for a still. The comparison poses one world per sample, uses
the same camera, palette and lighting inputs, and keeps each renderer's temporal
history independent. Each PNG under `splats/` and `curves/` is exactly the
requested size in art pixels. The preview places splats on the left and curves
on the right, with a native APNG for sequences. `manifest.json` records the
sampled time, resolved camera, and number of pixels that changed for each frame.
Graphs with feedback use the usual CLI feedback clock, so the manifest records
both the requested time and the sampled time.

In Node, use `render(world, { curveMode: 'splats' })` for one renderer.
`compareCurveModes(world, { width, height, time, frame }, receive)` returns
the report and calls `receive({ index, time, camera, splats, curves, changedPixels })`
for each matched frame. `frame` holds shared render options. Supply
`from`, exclusive `to`, and `fps` in place of `time` for a sequence.
`writeCurveComparison(world, options, directory)` writes the same assets as the CLI.

`--curve-splats off` or `render(world, { curveSplats: false })` shows the
legacy Gaussian fallback used in WebGL. The matched comparison is headless and works in perspective and
orthographic views. Use `--fragment-budget` when a large export with overlapping
strands needs more depth-sorted fragments.

Use `passes --channels strands` to export strand IDs, depth, coverage,
tangents, and motion. `strand-pixel --at x,y` reports the contributing
paths and their stations at an art pixel. See [strand passes](art-passes.md#strand-passes-and-pixel-inspection).

The integration follows the finite Gaussian segment in
[Shramko et al., *Spaghetti Splatting*](https://arxiv.org/html/2611.12716v1).
Ink starts from authored or simulated paths. The implementation is
dependency-free.
