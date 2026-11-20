# Additional light emitters

`K.lightEmitters` extends the existing `areaLights` and `volumeLighting` systems.
It adds line emitters, colored/procedural cookies, animated source settings and
native browser rendering of shaped lights on splats, textured surfaces and lit
analytic fog. SDFs and splats remain the core representation; atlas surfaces
are optional. There are no new package or external font/image dependencies.

Open [The prism court](../examples/light-emitters.html) to compare a stained-glass
panel, a disc, two fluorescent lines and a rotating projector. Its solid lettering
uses the existing outline typography primitive. The paving and labels use crisp
atlas pixels. Switch sources, stencils, shadows and haze independently, hold the
lighting, and orbit/dolly with the free camera.

## Shape a source

```js
const E = K.lightEmitters;
world.areaLights = [
  E.rectangle({
    id: 'billboard', at: [-2,2,0], normal: [0,0,1], size: [2,1],
    color: '#bba0ef', intensity: 8, radius: 6, sampleGrid: 3
  }),
  E.disc({
    id: 'ceiling-disc', at: [0,3,0], normal: [0,-1,0], size: [1,1],
    color: '#ffd18c', intensity: 6, radius: 5
  }),
  E.line({
    id: 'fluorescent', from: [-2,2,1], to: [2,2,1], width: .04,
    color: '#c3a0ec', intensity: 4, radius: 5, sampleGrid: 6,
    shadows: false
  })
];
```

These constructors return ordinary existing `areaLights` definitions. JSON
scenes can specify `shape: "rectangle"`, `"disk"` or `"line"` directly under
`finish.areaLights`. The original rectangle/disk definitions remain valid.

`size` is full width/height in world units; a disk may be elliptical. A line's
size is total capsule length and diameter. The endpoint helper includes the
rounded caps outside the endpoints. Its emitting quadrature lies between the
endpoints. A raw line's length must be at least its diameter. Line emission is
radial; rectangles and discs emit along `normal`, or both ways with `twoSided`.
Lines default to `twoSided: true`; other shapes default to false.

`sampleGrid` is deterministic, 1–8. Rectangles/discs use its square sample count;
lines use that many samples along their axis. Intensity is normalized by sample
count. Samples produce distance falloff, receiver cosine and shaped penumbras.
The existing `radius`, `bias`, `shadows` and optional stepped `shadowSteps`
retain their meanings. Line lights use a thin, depth-tested capsule for camera
and reflection visibility; it is a luminous surface rather than a tessellated
cylinder. Add an SDF housing when the physical fixture matters.

`visible` and `reflection` independently control the emitting surface. They do
not disable its illumination. Set `intensity: 0` to turn off surface emission
and direct lighting. `volumeIntensity` independently controls scattering and
otherwise defaults to the direct intensity. A visible source is clipped and
depth-tested against the scene, and participates in existing planar captures.

JavaScript sources can animate `at`, `normal`, `up`, `color`, `intensity` and
`volumeIntensity` with `time => value`. Each is sampled once per prepared frame.
`AreaLights.prepare(lights,{time})` exposes sampled frames and quadrature.
`AreaLights.evaluate(prepared,point,normal,out,{shadow})` returns linear RGB
irradiance. Existing point/sun behavior remains available; spots continue to
use `volumeLighting` with separate `intensity` and `surfaceIntensity`.

`E.follow(graph,node,definition)` follows a live scene hierarchy's local
position and orientation. Source size remains in world units. Update the graph
before rendering, just as for the existing hierarchy's light bindings.

## Colored cookies and patterns

```js
const stencil = E.cookie({
  pattern: 'stainedGlass', width: 64, height: 64,
  frequency: 4, thickness: .6,
  colors: ['#ffca7c','#a889e4','#ffe3ae'],
  angle: 30, filter: 'nearest'
});
world.areaLights[0].cookie = stencil;
world.volumeLighting = { ambient: .08, spots: [{
  at: [0,3,3], direction: [0,-.3,-1], radius: 9,
  innerAngle: 28, outerAngle: 34,
  color: '#ffffff', intensity: 3, surfaceIntensity: 12,
  cookie: { ...stencil, roll: t => t * 10 }
}] };
```

A cookie can supply exactly one raster:

- `mask`: one transmission byte per texel, preserving existing grayscale spots.
- `rgb`: three transmission bytes per texel.
- `rgba`: RGB transmission multiplied by alpha.

Bytes describe linear transmission: black blocks light; white passes it;
colored pixels filter its channels. A mask changes light, not fog density or
the painted texture. The same projector is used in fog and on surfaces. Area
cookies use the source center's projection while the source's quadrature still
controls its diffuse spread and shadow softness. Visible area emitters show
their cookie as an aperture image as well.

`angle` is the vertical half-angle in degrees, with horizontal aspect from the
raster. `up` controls orientation. `roll` uses degrees; `offset: [u,v]` and
`repeat: [u,v]` modify UVs inside the lens. `roll` and `offset` can be time
functions. `wrap: true` repeats inside the projected lens; outside remains dark.
`filter` is `nearest` or `linear` in both renderers.

`E.cookie()` / `LightCookies.pattern()` generates `stripes`, `checker`, `rings`,
`rosette`, `window` or `stainedGlass`. It accepts a foreground `color`,
`background`, optional color array, `frequency`, `thickness` and `phase`.
The returned byte asset supports JSON serialization without a library.

Raster compilation is cached by definition identity. After changing bytes,
increment `cookie.revision` or call `LightCookies.invalidate(cookie)`. Animated
projection coordinates do not require recompiling or reuploading the raster.
`LightCookies.prepare`, `projection` and `sample` are also standalone tools.

Use [geometric caustic projection](geometric-caustics.md) to generate
an animated cookie from refractive lens surfaces and an authored aperture.

## Light-catching fog

```js
world.atmosphere = [K.atmosphere.box({
  min: [-4,.05,-2], max: [4,3.5,3], density: .06,
  color: '#d4c6dd', lit: true, step: .2
})];
```

`fog`, `box`, `sphere` and `shaft` may opt into `lit: true`; defaults remain
unchanged. CPU integration reuses the existing volume light integrator, including
point/sun/spot sources, colored cookies and anisotropy. The native renderer
supports isotropic lighting of these analytic volumes with a shared world-space
irradiance field, sampled during their existing depth-clipped integration.
Their density/transmittance stays independent of light output.

The existing bounded procedural-field CPU path remains available. Arbitrary
JavaScript density functions are not compiled into browser GLSL by this change.
Use analytic volumes for the native example. `volumeLocalLights` and
`volumeLocalShadows` still control the local fog paths independently.

## Rendering, shadows and caches

The headless renderer uses the existing direct-light compositor, area quadrature
and retained static SDF ray queries. New area lights also reuse those casters in
lit fog if no explicit volume shadow query is supplied. The existing spotlight
shadow callback remains supported.

The browser renderer shares the source frames and cookie assets. It evaluates
splats in a GPU receiver pass feeding the existing relight table, so pixel-art
material/detail paths retain their light contribution. Textured surfaces use
separate per-triangle irradiance charts; reusing one atlas stamp in several
places still gives each receiver its own lighting. Original texels stay intact.
Two-sided atlas receivers face the viewing side consistently in both renderers.

Receiver caches are stored per light. Changing one source updates its layers;
unchanged sources reuse theirs. Camera-only movement reuses lighting and haze
fields while visibility/depth tests still use the current camera. Changing
receiver geometry, source parameters, stencil assets or retained casters
invalidates the relevant cache. All new GPU resources share renderer disposal.

For shadows, set `S.keepRenderSdf = true` before baking static geometry. As with
the original area lights, bake moving/transparent geometry separately; stale or
actively rigged/destructed source groups are excluded. Browser shadows sample a
bounded SDF grid and are approximate at its resolution. Keep emitting faces
outside their opaque housings, with clearance appropriate to that grid. This
avoids a coarse housing voxel swallowing its own light. Custom
`K.atmosphere.occluder(field)` queries expose their distance field for the native
cache; increment `emitterShadowRevision` when that field changes.

Native frame options:

| Setting | Default | Meaning |
| --- | --- | --- |
| `emitterShadowResolution` | 48 | Longest SDF grid axis, 8–128 |
| `emitterShadowRevision` | unset | Explicit invalidation for changed custom SDFs |
| `emitterFogResolution` | 48 | Longest irradiance-field axis, 8–128 |
| `emitterSurfaceResolution` | 16 | Per-triangle light chart, 4–64 |

The example uses a 32-cell fog field for its animated preview. Increasing it
sharpens volumetric stencil detail. Painted texels keep their authored resolution. Projected lighting detail on
atlas meshes follows the light-chart resolution and triangle density; splats
retain per-sample lighting. Lit fog uses four integration samples per
homogeneous interval; the CPU integrator retains its independent step budget.

The native path supports up to 32 combined shaped/volume lights, within the
existing limit of 16 area emitters. Texture-cache budgets are bounded and report
an error rather than silently discarding sources. It uses WebGL 2 float render
targets through
[`EXT_color_buffer_float`](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/)
and filterable half-float volumes; no runtime packages are needed.

## Inspect an emitter rig

`ink-studio light-emitters lights.json --at 1.2` reports sampled positions,
orientations, source sizes, quadrature counts, visibility/shadow flags and cookie
projection axes. The input is an emitter array or `{ "areaLights": [...] }`.
`--out report.json` saves the report. The same data is available through
`K.lightEmitters.report(lights,{time})`.

Render a headless specimen using the existing tools:

```sh
ink-studio render examples/light-emitters.js --t 1.2 --w 640 --h 480 --px 1 --out court.png
```
