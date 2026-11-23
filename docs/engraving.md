# Engraving and tonal art maps

Render native SDF/splat objects with parallel hatching, cross engraving, white-cut woodcut or stippled shading. Ink density responds to lighting or lit color. Retained surface coordinates keep the marks attached through camera motion, bone animation, CPU deformation, fragment reconstruction, copies and instances.

The same charts support [surface brushwork](surface-brushwork.md) with curvature-directed paint and broad pigment groups for distant views.

The [Copperplate Cabinet](../examples/engraving.html) contains an animated moth and an etched observatory, with free orbit/pan/zoom, live lighting, four techniques, density/spacing and ink/paper controls, and native-material comparison. Build `dist/ink-studio.browser.js` with `require('.').bundle()` and serve the repository over HTTP.

This implementation adapts the nested-tone and related-scale ideas in Praun et al., [Real-Time Hatching](https://hhoppe.com/proj/hatching/) (SIGGRAPH 2001). It uses retained splat charts and procedural projection rather than the paper's mesh-based lapped parameterization.

## Scene and material authoring

```js
const { KIT: K, makeBuilder, makeSculpt } = require('@shapeshift-labs/ink-studio').load();
const B = makeBuilder(51, [0x15263b, 0xf0dbb2]);
const S = K.sculpt(makeSculpt(B));
S.ball([0, 0, 0], [1.5, 2, 1], {
  r: [0, 1],
  engraving: {
    style: 'engraving', projection: 'triplanar',
    scale: .65, ink: '#15263b', paper: '#f0dbb2',
    tone: 'hybrid', density: 1, seed: 51
  }
}, { res: .12 });
S.bake();
const world = B.finish();
```

Set `S.engraving` for a sculpt default, `material.engraving` for an individual surface, or `finish.look.engraving` for a scene-wide default at bake completion. A material's `top`/`materialAt` override can supply another technique; explicit `false` opts out of the scene default. These settings also accept a technique name or `true` for defaults. Material settings are collected during authoring and applied in one batch.

Existing worlds can use `K.engraving.bind(world, selection, settings)`, where `selection` is `'all'` or an iterable of row indices. Bind before establishing rigs or deformation rest poses. Eligible rows need a retained surface frame or a nonzero authored normal. Emissive, particle and reserved rows keep their existing representations. Builder users can assign `B.describeEngraving(first,end,settings)` to an authored range.

## Controls

| Setting | Default / behavior |
| --- | --- |
| `style` | `engraving`; also `hatching`, `woodcut`, `stippling` |
| `projection` | `triplanar`; also `plane`, `cylinder`, `sphere` |
| `scale` | `.65` world units per repeating tile; `.001–1000` |
| `origin` | `[0,0,0]` in retained chart coordinates |
| `along`, `across` | `[1,0,0]`, `[0,1,0]`; finite nonzero independent axes, orthonormalized at preparation |
| `radius` | `1`, positive through 1000; arc-length scale for cylindrical/spherical coordinates |
| `ink`, `paper` | `#15263b`, `#f0dbb2`; hex colors or RGB triples in `0–1` |
| `strength` | `1`; `0–1` contribution to the lit color |
| `density` | `1`; `.05–4`, adjusts darkness entering the tone map |
| `contrast`, `bias` | `1` and `0`; `.1–4` and `−1–1` |
| `ambient` | `.16`; `0–1` fill light for the normal-driven tone |
| `tone` | `normal`, or `luminance`, or `hybrid` (65% normal, 35% lit-color darkness) |
| `strokeWidth` | `1.15` texels; `.35–3` |
| `jitter` | `.08`; `0–.3`, seeded line irregularity |
| `seed` | `1`; unsigned 32-bit integer, independent of scene random streams |
| `resolution` | `64`; `32`, `64` or `128`, with two successively smaller scale levels |
| `lodBias` | `0`; `−3–3`, adjusts projected-footprint scale selection |

Triplanar projection blends three fixed charts using the retained normal, with small weights skipped. Plane projection uses the authored axes. Cylinder and sphere projection use those axes as the radial and longitudinal basis. They have the usual angular seam and polar singularities; place the seam away from the focal area or use triplanar mapping. These projections are object-attached, locally planar splat charts rather than geodesic surface ribbons.

At render time, `engravingLight: [x,y,z]` supplies a finite nonzero direction. The default is `[-.45,.8,.55]`. It changes normal-driven shading without rebuilding maps or uploading charts. `engraving: false` bypasses the pass for comparison. `normal` uses the animated surface normal, `luminance` follows baked or live lit color including shadows, and `hybrid` combines both. Geometry coverage, opacity, ownership and picking remain the native geometry's; paper areas remain surfaces. Fog and later palette/compositing stages still apply. Choose colors present in your palette when using quantized output.

## Interactive meshes and curves

Assign `engraving` to an indexed mesh material or to a curve's appearance.
The WebGL renderer uses the same engraving styles and tone maps as retained
splats. Mesh marks follow the rest vertices through `K.sceneMeshes.pose` and
skinning. For moving curves, use `K.curveSplats.bind` so the analytic hit can be
mapped through the live strand frame into the authored frame. This also works
with UV- and SDF-grown strands. Ink retains individual authored spans when
they carry engraving or a bound rest anchor.

```js
const cord = K.curveSplats.bind(B, { kind: 'path', points }, reference =>
  reference.points.map(bend), {
  width: .04,
  edge: 'hard',
  color: '#bb7655',
  engraving: { style: 'woodcut', scale: .18, tone: 'luminance' }
});
cord.pose(world);
```

Use `engraving: false` in the browser render options for comparison.
See [Stable dithering](stable-dithering.md#review-the-interactive-renderer)
for the turning prop and deforming coat demo.

## Shared maps and live edits

`K.engraving.prepare(settings)` validates and normalizes settings. `maps(settings)` returns eight nested tone images at each of three resolutions. Each darker image retains the earlier marks, and line/dot locations are related across scales. `sample(settings,u,v,darkness,footprint)` blends adjacent tones and scales, with a mean-tone fallback once the coarsest detail becomes subpixel. Its coverage is in `0–1`; it is also used by the software renderer.

`K.engraving.update(world, slot, settings)` replaces a one-based style slot without changing chart identities. Geometry-equivalent styles share the same maps: ink, paper, light, density, projection and scale changes reuse the raster data. The GPU packs four neighboring tone images into RGBA channels to reduce sampling work, deduplicates identical maps between material slots, and computes chart derivatives and normal-light response in the vertex stage.

Default maps occupy 172,032 bytes before row padding. A world supports up to 16 style slots; the CPU geometry cache is bounded to 16 map sets. An opt-in geometry attachment buffer holds chart metadata, style parameters and shared map pages in the existing geometry sampler. No new texture unit, draw per hatch stroke, external image asset, dependency, or frame-time raster generation is required. GPU bone animation updates the existing bone table. CPU deformation/rig edits update their retained surface frames and chart rows; large animated surfaces should use GPU skins.

## Native data lifecycle

`world.engraving` contains versioned `styles`, `indices`, rest `anchors` and `restFrames`. Live axes reuse the optional native footprint frame channel, including coordinate-only rows with no custom silhouette. Treat these arrays as retained data and use the editing APIs.

Provenance subsets/joins, bake-cache snapshots and instance expansion preserve chart metadata. Instances keep prototype chart coordinates while their live axes follow placement transforms. CPU deformation starts from rest frames, GPU bones use the native covariance basis, reconstruction rotates live axes, and afterimages snapshot posed axes while retaining their chart coordinates. Native aggregate LOD and interaction thinning protect engraved rows from merging incompatible charts.

The engraving pass resolves native splat contributions before scene compositing. It can be combined with custom footprints and surface brush masks. Sprite and atlas artwork retain their separately authored pixel imagery.
