# Scene optics

Use [SDF-assisted rendering](sdf-assist.md) to trace opaque static sculpt surfaces while keeping their baked splat color.

Ink Studio can capture the objects around a planar mirror, move their reflected colours with a ripple field, and composite fog, mist or beams against scene depth. Each tool works independently. The [beacon pool](../examples/beacon-pool.js) uses all three with sculpted geometry.

```sh
ink-studio render examples/beacon-pool.js --t 0.94 --raw --out pool.png
ink-studio sheet examples/beacon-pool.js --t 0.4,0.94,1.5 --raw --out pool-motion.png
```

Use `--reflections off` or `--atmosphere off` to inspect each effect separately. The software renderer supports perspective and orthographic views, and the effects run before palette quantization.

The [WebGL canvas renderer](browser-renderer.md) supports the shared glass-beam pass, analytic fog, water bodies and live planar captures bound to water optics. The CPU renderer additionally supports arbitrary material planar receivers, ripple-field normals and sampled atmosphere fields.

For moving directional light and cast shadows on solid geometry, see [Live sun lighting](live-sun.md). See [Moving cloud shadows](cloud-shadows.md) for a shared coverage grid that shades the terrain, fog, and water. Use [Authored lightning](lightning.md) to time flashes that light clouds, appear in water reflections, and reveal nearby geometry. See [Indoor and outdoor exposure](scene-exposure.md) for rain boundaries and shelter for fog, light, and wind.

Use [Animated splat fields](animated-splat-fields.md) for drifting particles, aurora curtains, dust walls, and wakes that follow a route.

Use [Celestial tracks](celestial-tracks.md) to key authored suns, moons, stars, and eclipses on the same clock as sky profiles.

Use [Atmosphere emitters](atmosphere-emitters.md) to release smoke, steam, spray, or fog from fixed or moving scene sockets.

Use [Effect palette ramps](effect-palettes.md) to reserve tone steps for fog, clouds, night skies, and emissive details.

Use [Art direction](art-direction.md) to control cloud edges, atmospheric bands, foreground contrast, and held motion.

Use [Silhouette protection](silhouette-protection.md) to tune fog and contrast on a selected subject and review it across the export directions.

Use [Layered horizon art](layered-horizon.md) to paint a distant vista with depth-dependent parallax, bounded tiling, and camera fades.

Use [Transition review](transition-review.md) to compare native export frames through changes in weather, lighting, and camera. Save a [shot recipe](shot-recipes.md) to replay a review from the same camera path and weather state. The [environment review shots](environment-review-shots.md) cover wet stone under a moving sun, offshore cloud parallax and a fog crossing, and localized rain and reflections at a sheltered market.

Use [Environment packs](environment-packs.md) to share versioned sky, weather, and atmosphere settings across scenes.

Use [Interruptible transitions](interruptible-sky.md) to carry the current sky and weather values into a new transition.

Use [Conditional weather tracks](conditional-weather.md) to drive sky transitions from cues and simulation state.

Use the [environment inspector](environment-inspector.md) to report which keys, profiles, and regional overrides contribute at a world position.

Export [environment passes](art-passes.md#environment-passes-for-compositing) for downstream compositing of sky, fog, precipitation, reflections, and foreground coverage.


## Interactive water captures

Use the existing `K.reflection.plane` definitions with `optics.reflection` on a
column water body. The [three reflecting gardens](../examples/water-garden.html)
uses three heights, a moving lantern boat, SDF trees, and optional atlas terrain.

```js
const pool = K.procedural.waterBodies.create({
  id: 'garden-pool',
  bounds: { min: [-3, -2], max: [3, 2] },
  resolution: [64, 64],
  sample(x, z) {
    const bed = terrain.height(x, z); // same triangulated surface that is drawn
    return bed < 0 ? { bed, surface: 0, current: [0.1, 0] } : null;
  },
  optics: {
    optical: { reflection: 0.18, absorption: 0.3 },
    reflection: { plane: 'garden-mirror', distortion: 3, blur: 0.5 }
  }
});
const world = B.finish({
  water: K.procedural.waterBodies.scene([pool]),
  reflections: [K.reflection.plane({ id: 'garden-mirror', at: [0, 0, 0] })],
  spriteSurfaces: optionalTerrainAtlas
});
```

A binding is optional; existing water, sky reflections, `K.reflect`, and material
receivers keep their existing APIs. Pools can share a plane and capture; a water
scene supports up to four distinct capture planes, including layered/atlas water.
Water capture planes face up and match the flat exposed water level. In WebGL,
unmatched heights fall back to the body's surface color. These captures use the
existing water wave/current normal, rather than a new wave simulation. Distortion
(default 5, range 0–64) and five-tap blur (default 0, range 0–16) use art pixels.

The native renderer captures current splats, rigs, shader motion and atlas meshes
each frame. `plane.select(index, x, y, z, world)` filters splat sources. Sources
behind the plane are clipped, and captures do not recursively reflect other pools.
Global grading runs after reflection compositing. The CPU renderer uses its existing
lazy planar captures for the same water binding.

Water column intervals clip reflections at wet/dry shoreline cells and air pockets.
Textured terrain receives water absorption, tint, caustics and surface reflection at
its own fragment depth. A submerged lakebed does not occlude the reflected object
at its virtual mirrored depth; raised foreground terrain still occludes the water.
[Geometric caustic cookies](geometric-caustics.md) can project authored lens
patterns onto these terrain receivers through the existing light pipeline.
No reflection proxies or custom ellipse masks are required.

For WebGL, `frame.reflections: false` disables live captures while retaining the
body's fallback surface reflection. `reflectionScale` defaults to 0.5; the longest
capture edge is capped by `reflectionMaxSize` (default 512, maximum 2048). Both are
independent of the main frame size. One bounded capture is shared per plane, its
resources are reused, and back-facing planes are skipped. Scenes without capture
bindings allocate no capture targets. On the CLI, `--reflections off` disables the
same geometry captures; the existing CPU reflection sampling scale is unchanged.

## Unified optical materials

Create a reusable profile with `K.optical.material(settings)`, or supply the same settings as an inline object.
Attach the profile as `optical` on a sculpt or diorama material, as `optical` on an atmosphere volume, or as
`optics.optical` on a water body. Diorama materials can also set `glass: true` for the glass pass.

| Setting | Effect |
| --- | --- |
| `absorption` | Removes transmitted light per world unit. Ranges from 0 to 32. |
| `scattering` | Redirects light into the authored scattering color. Ranges from 0 to 32. |
| `reflection` | Sets the normal-incidence reflectance of glass, splats and water. It increases at grazing angles when enabled. In fog, it adds a diffuse backscatter term. Ranges from 0 to 1. |
| `scatteringColor` | A hex color or normalized RGB triple. Defaults to the shaded surface color, water tint or atmosphere color. |
| `reflectionColor` | A hex color or normalized RGB triple. Defaults to white. |
| `depth.thickness` | Thickness in world units for a glass or splat surface. Defaults to 1 with a range of 0.0001 to 1024. Water and fog use the ray distance through their bounds. |
| `depth.scale` | Multiplies the distance used for absorption and scattering. Defaults to 1. Ranges from 0 to 32. |

Absorption, reflection and scattering default to zero. Surface splats use the view angle to estimate the
distance through each dab and composite over the scene without taking ownership of the opaque depth.
Fog still uses its density, limits and field to shape the profile spatially. Water still supports foam,
caustics, refraction and depth tint. Reflection uses the authored tint with a Fresnel response on surfaces
and a diffuse term in fog. Overlapping surface dabs each contribute to transmission.

The CPU and WebGL renderers share these coefficients for native splats, water and analytic fog. The CPU
renderer also applies them to sampled atmosphere fields. Existing materials and media use their legacy
settings until a profile is attached.

## Stable transparency during motion

Set `look.stableTransparency` to `true` when overlapping glass, optical splats or other translucent splats
keep switching order as the camera moves. The depth tolerance defaults to 0.04 world units along the
camera axis. Set `look.stableTransparency` to an object with a `depthTolerance` field to tune it.
Depth-separated layers return to their current back-to-front order, and opaque or explicitly
background splats remain ordering boundaries.

WebGL retains the order between frames of the same world. Set `frame.resetTransparency` at a cut or
`frame.stableTransparency` to override the scene setting. Time rewinds and large changes in camera
direction start a fresh order. In the coverage-aware glass pass, nearby translucent splats stay
together at the pane boundary. Stabilized WebGL instances use the renderer's expanded geometry path.

For Node image sequences, create `K.stableTransparency.history()` and pass it as `transparencyHistory`
to successive `render()` calls. Call `history.reset()` at a cut. Individual images without history use
the baked splat indices to resolve nearby layers deterministically. The CPU's surface order also
applies the tolerance to the local fragment depths. The CLI carries history through clips, sheets
and turntables. Use `--stable-transparency on` or `off` to override the scene setting.

For shots where translucent surfaces cross rain or other translucent layers, select
`look.stableTransparency: { mode: 'blend', depthTolerance: 0.10 }` in the headless
renderer. Node and JSON dioramas use the same settings. Blending spreads each
fragment's optical depth between two adjacent slices. Nearby layers mix through
the crossing and clearly separated layers composite in depth order. Opaque
geometry remains an ordering boundary. The renderer evaluates bounded mist and
water at each fragment's depth and eases in water-surface reflection across the
same tolerance as fragments pass behind the interface. Glass refraction samples
between neighboring art pixels and eases where translucent layers meet. Give
each pane its own object ID to keep its splats together for refraction. The blend
is deterministic at a given time and camera and needs no frame history.

`depthTolerance` is the slice spacing in world units along the camera axis.
Layers separated by at least twice this spacing have independent coverage.
Use a small value for closely stacked panes. Per-fragment sorting and medium
sampling cost more than the center-order path. Blended exports report an error if
they exceed the fragment budget. Set `--fragment-budget N` or use fewer art pixels
for dense scenes. The existing WebGL renderer uses its history-based hold mode.

```sh
node cli/ink-studio.js clip examples/layered-transparency.js \
  --w 160 --h 104 --px 1 --from 0 --to 2 --fps 16 --raw --out gauge.png
node cli/ink-studio.js clip examples/layered-transparency.js \
  --w 160 --h 104 --px 1 --from 0 --to 2 --fps 16 --raw --splat-order surface --stable-transparency off --out gauge-hard.png
```

Use `--stable-transparency blend` to turn on blending with the default 0.04 spacing
for a scene without an authored setting. The tide gauge scene provides a colored
pane that moves through bounded mist, world-space rain, and a reflective basin.

## Local bounce probes

[Add local bounce probes](bounce-probes.md) for baked surface color transfer and directional sky fill that follows the active environment profile.

## Shaped area lights

[Set up shaped emitters](area-lights.md) to give windows and lanterns a world-space size, soft or stepped shadows, and a visible silhouette in planar reflections.

## Local contact shadows

[Use contact shadows](contact-shadows.md) to ground feet, crates, railing posts, and foliage with a short world-space reach. Configure strength and cast or receive masks independently of the directional lights.

## Measured render budgets

Run the headless benchmark from the repository root. It covers the fog observatory, the shaped-mist ravine, sparse illuminated mist pockets, and the lens workshop's transparent layers.

```sh
node scripts/benchmark-render.js 7 > render-budgets.json
```

The report records median and 95th-percentile frame time, translucent fragments, optical ray samples, density and cloud lookups, and skipped work. It measures warmed render calls at 128 × 80 art pixels before image encoding. The uncached and dense reference lanes use the same camera, lighting and sampling quality. The benchmark checks identical RGB bytes.

In Node, pass `renderStats: true` to `render(world, options)` and read `frame.renderStats`. Its `frameMs` measures the render with counters enabled, including any internal color and reflection passes. The benchmark records its timing samples with counters disabled and captures the work totals separately.

- `fragments` counts blended splat and sprite contributions. `translucentFragments` counts contributions with opacity below one that leave the surface depth buffer unchanged.
- `volume.raySamples` counts optical solves at pixel ray depths. `densitySamples` and `cloudSamples` count primary optical density lookups during the frame. Light and shadow probes and asset baking are outside those lookup counts. Analytic bounds, cached fog, and empty march steps have separate counters.
- `volumeQuality.cacheBounds: false` bypasses the per-ray volume bounds and full-fog caches for comparison. `volumeQuality.skip: false` bypasses conservative field skipping and evaluates the same march grid densely.

## Planar reflections

```js
const mirror = K.reflection.plane({ id: 'pool', at: [0, 0, 0], normal: [0, 1, 0] });
const water = K.reflection.material({ r: [1, 2, 3], a: 0.65 }, 'pool', {
  f0: 0.3,
  color: '#b8e0ea',
  distortion: 10,
  blur: 0.7
});
// Use water when adding the flat basin surface to S, then bake.
const world = B.finish({ cam, reflections: [mirror] });
```

The receiving material limits the reflected area, including irregular outlines. Put the receiving surface on the mirror plane and point the plane normal toward the objects and camera. The renderer samples a single mirrored view per visible, referenced plane. Splat centres behind the plane are excluded. Use `bias` in world units to exclude splats very close to the plane, or use `select(index, x, y, z, world)` to control which animated splats appear in the capture.

`K.reflection.material` adds a `planarReflection` layer named `mirror`. The layer takes the usual finish tint, `strength`, Fresnel `f0` and `power`, and optional finish masks. `distortion` controls how much a normal perturbation shifts the reflection in art pixels. `blur` is a small reflection filter radius in art pixels. Any finish normal, including `waves`, `noise` and ripple rings, can perturb the capture. Empty reflected pixels reveal the other finish layers and the base colour.

For finishes that use the scene sky and its active profile, see [Shared sky reflections](shared-sky-reflections.md).

The existing `reflection` finish type supplies a three-colour sky. It can be layered underneath a planar mirror. `K.reflection.reflectedView(matrix, plane)` supplies the mirrored column-major world-to-view transform to other renderers. `K.reflection.captureView(matrix, plane, eye)` also supplies the clipping equation `[nx, ny, nz, -dot(at, normal)]` and the clip bias. It returns `null` if the eye is on or behind the reflecting side's bias. Use `SurfaceLook.shade` with a `reflection(layer, normal, geometricNormal)` callback returning `{ rgb, coverage }` in 0–1.

## Local reflection probes

Add a named probe to capture nearby geometry for curved, glazed, and
uneven surfaces. A finish can sample a sharply defined reflection or
filter the same capture into a broad streak along the grain.

```js
const probe = K.reflection.probe({
  id: 'lantern-bench',
  at: [0, 0.7, 0],
  size: 128,
  bounds: { min: [-3, 0, -2], max: [3, 3, 2], feather: 0.2 },
  capture: { exclude: [{ material: 'brushed-copper' }] }
});
const copper = K.reflection.localMaterial({ r: [4, 5, 6], materialId: 'brushed-copper' },
  'lantern-bench', { roughness: [0.57, 0.09], rotation: 0.1, f0: 0.78 });
const world = B.finish({ cam, reflectionProbes: [probe] });
```

The helper creates a `localReflection` finish layer. Its `roughness` is
zero to one and can be a single value or an along/across pair. A pair
widens the reflection on the rougher axis. `direction` on the surface and
`rotation` on the layer orient that axis. Finish normal patterns also
steer the reflection. Use `strength`, Fresnel `f0` and `power`, a
`color` tint, and optional masks as for other finishes. Surface signals
can drive roughness, strength, tint, and `f0`.

The headless renderer takes six 90-degree views the first time a probe
is sampled in a frame. It filters premultiplied coverage in linear light
using mip levels and cross-face sampling. The active probe captures are
reused across art-resolution passes in that frame. `size` selects 32,
64, 128, or 256 pixels per face and defaults to 64. Use `near` to choose
the capture's near clipping distance in world units. The default is .05.
Up to eight probes may be authored.

Optional `bounds` project the reflected ray onto a world-space box so
the capture follows receiver position as well as its normal. Put the
probe inside that box and position the box near the reflected features.
`feather` fades the probe near the bounds. The optional `capture` mask
uses existing named target selectors to include or exclude native splats.
An empty part of the capture reveals the finish underneath it, such as
a shared-sky reflection.

In JSON, use `finish.reflectionProbes` with a list of descriptors and a
material layer like `{ "type": "localReflection", "probe": "lantern-bench", "roughness": 0.25 }`.
Use `--reflection-probes off` to compare while keeping planar reflections
available. `--reflections off` disables both kinds of scene capture.
The `reflections` export pass contains both kinds.

```sh
ink-studio render examples/local-reflection-workshop.js --w 356 --h 183 --px 1 --out workshop.png
```

## Ripple sources

```js
const ripples = K.ripple.field({ scale: 0.48, amplitude: 0.4, speed: 1.2, damping: 0.25 });
const finish = K.surface.preset('rippling-water', { r: [1, 2, 3] }, { normal: ripples.normal });
// This can also be called later, after the world is baked.
const drop = ripples.add({ at: [1, 0, -0.5], start: 0.3, strength: 1 });
```

Drop coordinates use the material's pattern space, which defaults to the sculpt's rest coordinates. The optional material `origin` and `scale` shift and scale that space. The ripple plane defaults to XZ. Set `axis` and `cross` to two perpendicular XYZ directions for another plane. `scale` sets the wavelength, `width` sets the width around the travelling wavefront, and `speed` is distance per second. Set `repeat` on a drop for a repeating source.

Add and remove sources while rendering without rebaking. `remove(drop)` removes one source, `clear()` removes all, and `prune(time, reach)` retires non-repeating drops whose last rings have travelled beyond the given maximum radius. `sample(position, time, footprint)` returns the normal offset. Use a declarative `{ type: 'rings', amplitude, scale, drops }` normal for data-authored scenes.

A renderer can call `field.frame(time, storage)` once per frame and upload the
result. `axes` contains the two world-space tangents, `shape` contains
`[amplitude, wavelength, packetHalfWidth, damping]`, and each of the first
`count` entries in `drops` packs `[u, v, wavefrontRadius, strength]`.
Optional `Float32Array` storage needs four slots per active source. A field's
`capacity` defaults to 64 and can be lowered to fit a host's buffer.
`K.ripple.sampleFrame(frame, position, footprint, out)` evaluates the same
world-space slope as the surface normal sampler, within float packing precision.
Shader hosts can include `K.ripple.glsl` and sum `inkRippleSlope` for each drop
at a tangent-plane position. The host chooses how that slope affects its
material or reflected view.

## Atmosphere

For sky-coloured extinction at scene depth, see [Aerial perspective](aerial-perspective.md).

```js
const world = B.finish({
  cam,
  atmosphere: [
    K.atmosphere.fog({ top: 0.2, near: 3, density: 0.14, color: '#6e889f' }),
    K.atmosphere.sphere({ at: [-1, 0.3, -2], radius: 1.4, density: 0.3, color: '#93a4b0' }),
    K.atmosphere.box({ min: [-2, 0, -1], max: [-0.3, 0.5, 3], density: 0.2 }),
    K.atmosphere.shaft({ from: [0, 3, -0.8], to: [1.4, 0, 1], radius: 0.22,
      density: 0.5, color: '#ffdb94' })
  ]
});
```

Fog can occupy a height slab with `bottom` and `top`, or cover the whole view. Sphere and box volumes let mist stay around an object or in a defined region. A shaft is a capped cylinder of tinted atmosphere. Combine volumes freely. Integration accounts for overlaps in camera-depth order and stops at the nearest opaque surface. Use `near` or `far` to bound a volume by camera ray distance. Colours accept a palette index, a hex string, or 0–1 RGB.

Hosts can use `K.atmosphere.prepare(world.atmosphere, world.pal)` and `K.atmosphere.trace(volumes, eye, unitDirection, distance)`. Trace returns premultiplied RGB and remaining transmittance `[r, g, b, t]`, so the final colour is the returned RGB plus `t` times the scene RGB.

## Atmosphere depth bands

Use `atmosphereDepthBands` on a JavaScript world, in a diorama's `finish`, or in a simulation's `visual` settings. Each named band is an optical volume between two depths along the viewing axis. Perspective and orthographic views both measure from the authored camera. The volume stops at the visible surface, so nearby rails can stay clear while mist crosses behind them.

```json
[
  {
    "id": "crossing mist",
    "depth": [8.8, 24.2],
    "feather": [2.8, 5.2],
    "height": [0.60, 3.1],
    "heightFeather": [0.38, 0.82],
    "density": 0.185,
    "color": "#bdd0da",
    "texture": { "scale": [3.4, 0.59, 1.85], "strength": 0.93, "seed": 27,
      "velocity": [0.8, 0.015, -0.14], "windInfluence": 0.3 }
  }
]
```

- `depth` and optional world-space `height` are pairs in scene units. `feather` and `heightFeather` accept one distance or separate distances for the two edges. Keep some overlap between neighboring bands if the fog should stay continuous across them.
- `density` controls extinction. `color` accepts a hex color, normalized RGB, or a scene palette index. Named bands take the same fog weather bindings, volume cutouts, and exposure controls as other fog. They contribute to the fog transmittance export.
- `texture.scale` accepts one length or separate XYZ lengths. A narrow Y scale makes horizontal filaments. `velocity` moves the texture in world units per second on the environment clock. `windInfluence` blends in scene wind. The seed and world coordinates keep the texture stable during a camera move.
- `step` optionally sets the sampling distance in scene units for a feathered or textured band. A band with zero feathering and no texture uses the analytic fog path when the other active optics allow it.

Use `--atmosphere-depth-bands on|off|file.json` or `render(world, { atmosphereDepthBands })` to select the authored list, disable the bands, or supply a replacement list. The CLI includes a band file in saved shot recipes. Reuse the same list under an environment preset's `settings.atmosphereDepthBands`.

```sh
node cli/ink-studio.js render examples/cliff-depth-bands.js --t 1.8 --w 336 --h 190 --px 1 --out cliff.png
```

The headless renderer binds the list for the current camera. Custom hosts can use `K.atmosphere.depthBands.settings` and pass its result to `K.atmosphere.depthBands.frame(bands, { origin, forward }, { time, seed })`. Feed the resulting volumes to the shared atmosphere sampler. Pass the nominal camera origin and a forward vector pointing into the scene.

## Bounded density and lit volumes

Use [geometry-shaped atmosphere](geometry-shaped-atmosphere.md) to fit clouds and fog to paths, signed-distance shapes, or terrain. [Volume cutouts](volume-cutouts.md) clear feathered pockets in those volumes.

```js
const D = K.procedural.density;
const shape = D.fromSdf({
  bounds: { min: [-2, 0, -2], max: [2, 1.4, 2] },
  field: (x, y, z) => Math.hypot(x / 1.6, (y - .55) / .52, z / 1.4) - 1,
  feather: .20,
  breakup: .65,
  noise: (x, y, z, t) => .5 + .5 * Math.sin(4 * x + t + z),
  drift: [.10, .04], windInfluence: .6
});
const volume = K.atmosphere.field({
  field: shape, density: .8, step: .14, ramp: ['#435969', '#769599', '#adc5bd'],
  anisotropy: .22, emissive: '#5cb3aa', emissiveGain: .14
});
const volumeLighting = {
  ambient: .4,
  sun: { direction: [-.4, .8, .4], intensity: .7 },
  point: { at: [0, 1.4, -1], color: '#ffc984', radius: 4, intensity: 2 },
  shadow: K.atmosphere.occluder(sceneSdf)
};
```

Put `volume` in `finish.atmosphere`, and pass `volumeLighting` and optional `volumeQuality` to the finished world. The integrator clips each ray against opaque geometry, evaluates bounded density through overlapping media, and adds single scattering, geometry shadowing and emission before palette resolution. Use `windInfluence` to let live airflow advect the density pattern. Directional light is defined as a vector from a sample toward the light. Set `lit: false` on a volume to use its density ramp and emission without scene scattering.

`D.bounded({ bounds, sample, skip })` accepts a custom density. A skip callback returns a conservative distance to the next possible nonzero sample. `D.sparse(field, { resolution, brick, time })` caches occupied bricks at one time and includes conservative interpolation-aware skipping. `D.toMesh(field, { iso, resolution })` extracts a threshold surface. `D.scatter(field, { minDensity, radius, seed })` places deterministic points inside density.

Use `--atmosphere off` to disable the pass. `volumeQuality` controls `scale` (1–4), `depthTolerance`, `steps`, `stepScale`, `skip`, `samples`, `seed`, and `jitter`. The coarser pass only reuses nearby samples with compatible depth. Set `stats: true` to inspect `frame.volumeStats` ray and fallback counts. Set `jitter: 'blue-noise'` for stable spatial offsets, or `jitter: 'spatiotemporal'` with an explicit `volumeHistory: K.atmosphere.history()` for frame-varying offsets and filtered accumulation. The history resets across a changed camera, a time discontinuity, or incompatible opaque depth. CLI options include `--volume-scale`, `--volume-steps`, and `--volume-jitter`.

Render `examples/art-pipeline.js` to see sculpted pool mist, a local light, and emission coloring at art resolution. For aimable beams and multiple lamps, see [Local lights in fog](fog-lighting.md).

## Pixel budgets and upload profiling

Give a scene a soft internal raster budget through `look.pixelBudget`.
The headless renderer chooses an integer scale that fits the budget before
upscaling. An explicit `--px` controls the scale for an individual render.
Ordinary scenes that omit the budget use their existing scale. Browser hosts
can apply the same limit with `FrameBudget.artScale` from the studio bundle.

`FrameBudget.uploadRows(rows, upload, gap)` visits half-open dirty row runs and
clears rows after a successful upload. A gap of one can batch two small
transfers together. The visitor receives the first row and the exclusive end
row and can transfer directly from the original typed array.

Use `ink-studio perf <scene> --secs 10 --fps 60 --json` to compare animation
step time, p95, peak upload bytes and planned upload calls. Use
`--upload-gap 1` for a browser host that batches adjacent ranges across a
single clean row. These are animation and transfer measurements. Measure
compositor time and frame rate in the browser at the intended viewport.

For densely sculpted dioramas, `FrameBudget.staticGroups` builds conservative
boxes for consecutive splat ranges. Pass the ranges that the host or an
animation can move as `mutable`. Mark shader-driven translations that the
planner cannot infer as mutable too. `visibleIndices` writes the original
indices for each retained group using a column-major view-projection matrix.
Use its returned count as the instance count for color, ID and mask passes.

## Render pass quality

Set `look.passQuality` on a world or `finish.look.passQuality` in diorama JSON. Override the profile with `render(world, { passQuality })` or `renderer.render(world, { passQuality })`. Pass `false` to use full quality for that frame. The CLI accepts `--pass-quality file.json|off`.

| Control | Work it scales |
| --- | --- |
| `background: { select, retain }` | Retain a stable fraction of eligible opaque splats matched by target selectors. The fraction ranges from 0.125 to 1. Select distant detail that can be thinned. Transparent, emissive, and special-purpose rows retain their authored coverage. |
| `particles: { retain, select }` | Retain a stable fraction of particle rows from 0 to 1. Precipitation, effect pools, and afterimage rows are recognized automatically. Optional selectors include additional rows. Custom worlds can declare `qualityParticleRanges` with `{ first, count }` records. Particle states and identifiers stay intact. |
| `reflections: { primary, secondaryScale, maxSecondary }` | Preserve the regular capture resolution for named primary planes and probes. Scale the secondary width and height from 0.125 to 1, or cap the number of secondary captures. If `primary` is omitted, the first eligible capture of each type is primary. The headless renderer scales planar captures and local probes. WebGL scales its planar water captures. |
| `preserve` | List additional target selectors whose original rows remain submitted. Data marks and configured silhouette protection targets are included automatically. |

The scaling changes the render submission while retaining the source world and original splat IDs. An omitted plane or probe uses the existing material fallback. A scaled WebGL capture is rendered to a smaller target before it is copied into the reflection atlas.

Headless `renderStats` includes submitted and omitted rows across raster passes, planar capture pixels, and local probe pixels. A lower particle fraction reduces draw work while the world continues to advance the authored effects.

## Ordered ink coverage

`InkVeil.footprint(bounds, size, signedDistance, feather)` bakes an R8 mask
for a horizontal receiving surface. Positive world-space distance is inside
the shape. Use the mask bounds to map the ray-plane intersection to texels.

`InkVeil.glsl` applies the same ordered thresholds as `InkVeil.rank`.
Shaded pixels below the coverage threshold return black. Light intensity,
a feathered shoreline, and projected caustics drive coverage on the plane.
The view depth occludes the plane behind foreground geometry. Each of the up to
eight light sources supplies world X and Z, radius and signed intensity. Use the
internal art-pixel coordinates so the pattern stays sharp at integer scales.

For an optional scene reveal, attach a track to `world.inkVeil.reveal`.
The track works with or without a receiving surface. Each cue opens an
ellipsoid centered at `at` with positive XYZ radii in `extent`. Its opening
starts and ends at the supplied times in seconds. The settle interval ramps
the whole scene to full coverage.

```js
world.inkVeil = {
  reveal: InkVeil.reveal([
    { at: [0, 1, 4], extent: [4, 3, 5], start: 0.25, end: 2 },
    { at: [1, 7, 0], extent: [6, 5, 5], start: 1.5, end: 3.5 }
  ], [3.5, 4.5])
};
```

Sample the track once per frame with seconds since playback started and
upload the returned `centers`, `extents`, and `settled` before compositing.
Use the surface depth and camera to evaluate coverage in world space.

`InkVeil.sweep({ from, to, start, end, feather })` moves a single ordered
edge through the scene. Use world-space endpoints beyond the foreground
and rear silhouettes. Upload `frame.plane` to `u_inkSweep` and
`frame.feather` to `u_inkSweepFeather` while the track plays. Zero disables
the sweep. A negative feather holds the frame at black before the edge starts.

Use `InkVeil.flow(keys, { period, delay, rise, wake, distortion })` for a
cyclic reveal that follows action and closes behind it. Keys use `time`,
`at`, and `extent`. The first time must be zero and later times must fall
inside the period. The track holds black during its initial delay and then
grows the moving area over `rise` seconds. The `wake` option gives the
area a trailing edge in seconds, and `distortion` bends the contour in world
units. Send `frame.warp` to `u_inkRevealWarp` alongside the cue uniforms.
`track.coverage(seconds, point)` lets overlays share the scene's visibility.

## Pixel art on flat surfaces

`SpriteSurface.make()` batches world-space rectangles into an RGBA atlas.
Each rectangle specifies its bottom-left corner and two span vectors in world
units. The paint callback receives integer column and row coordinates from
the upper-left texel and returns a packed RGB value or `null` for a cutout.

```js
const signs = SpriteSurface.make();
signs.face([-1, 1, 2], [2, 0, 0], [0, 1, 0], 48, 24, (x, y) =>
  x < 2 || x >= 46 || y < 2 || y >= 22 ? 0x36e4ff : 0x131a2c);
world.spriteSurfaces = signs.finish();
```

The batch contains the atlas bitmap and interleaved XYZ and UV-in-texels
vertices. Inkwell Rebirth draws those triangles once into the scene color and
depth before drawing the splats. Use nearest filtering to keep the art sharp.

## Look bindings for media and reflection captures

Use `finish.look.optics` on a diorama, `visual.look.optics` on a simulation
world, or `look.optics` on a JavaScript scene. Rules accept inline RGB
stacks, palette swatches, or a versioned look asset. They share look
selectors, `order`, and `weight`. These bindings adjust uniform
optical colors. Author spatial variation with volumes, water columns,
or coverage-aware material rules.

```json
{
  "optics": [
    { "select": { "medium": "cistern-water", "mediumKind": "water" }, "asset": "cistern/verdigris" },
    { "select": { "medium": "drift" }, "asset": "cistern/mauve" },
    { "select": { "medium": "inspection-pane", "mediumKind": "glass" }, "palette": ["#cd8e56", "#edd6a0"] },
    { "select": { "medium": "cistern-mirror", "mediumKind": "reflection" }, "asset": "cistern/mirror-wash" }
  ]
}
```

- **Water.** Bind a native water body or span medium by ID. Its bound
  tint enters the existing channel-wise extinction calculation. In the
  headless renderer, the camera ray crosses the published columns or
  spans, subtracts air pockets, and accumulates absorption and color
  up to each splat's depth. A simulation view with a matching optical
  rule builds the water frame from `visual.fields.water`. It can
  also specify base coefficients in `visual.waterOptics`.
- **Fog.** Match the volume ID or its kind. The binding grades its color,
  density ramp colors, and emission before the volume integrator uses
  them. With native water, air volumes are integrated through the dry
  parts of the ray and water through the wet parts.
- **Glass.** Match `mediumKind: "glass"`, or add the pane's surface or
  object name as `medium`. The glass flag comes from the material or
  splat. The optical binding grades that pane's own contribution,
  preserving its coverage and the other looks behind it.
- **Reflections.** Match the reflection plane ID with
  `mediumKind: "reflection"`. Materials and scoped splat looks are
  evaluated in the mirrored capture. An optional capture look then
  grades its RGB while preserving capture coverage, before the
  receiving material uses it.

Water bindings work in the standard WebGL renderer when the host
supplies the bundled `RenderStages` toolkit. The headless renderer
supports all four bindings. It uses the native water frame for
transmission, and separate surface materials for effects like ripples
and planar reflections. Fog-only views can use the separate coarser
and temporal atmosphere pass.

```sh
node cli/ink-studio.js render examples/optical-look-bindings.js --ortho --out cistern.png
node cli/ink-studio.js render examples/optical-look-bindings.js --ortho \
  --params '{"variant":"reflection"}' --out cistern-reflection.png
node cli/ink-studio.js probe examples/optical-look-bindings.js \
  --select '{"medium":"cistern-water"}' --args '{"stage":"optics","rgb":[0.2,0.21,0.24]}'
```

Use `--water off`, `--atmosphere off`, or `--reflections off` to
inspect individual passes. The optical probe reports the coefficient
mapping supplied to the integrator.
