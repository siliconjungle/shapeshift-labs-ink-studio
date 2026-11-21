# Art-pixel render passes

`ink-studio passes <scene>` writes CPU-rendered color and diagnostic PNGs on the same art grid. Use `--channels depth,normal,emission` to select passes, `--px1` for native resolution, and `--out directory` to choose the destination.

In Node, call the library's `render(world, { passes: true })` or supply an array of channel names. The result includes `frame.passes` with `w`, `h`, and typed arrays in top-down row-major order. A caller can request any subset. `passes: true` requests the standard art passes. Request environment passes by name or with `['environment']`. A render without passes skips the per-pixel buffers. `--colored` returns passes from its native render grid.

| Channel | Data |
| --- | --- |
| `coverage` | One float per pixel. The combined opacity of splat and edge-sprite layers, independent of the background. |
| `depth` | One float per pixel. Camera-axis depth of the owner in scene units. Center sorting uses splat centers. Surface sorting and traced geometry can supply sampled depths. Empty pixels use infinity. |
| `normal` | Three floats per pixel. The owning sample's normalized world-space surface normal. Samples with no surface normal use zeros. |
| `objectId`, `materialId` | Unsigned integers. Zero means unassigned. The `objects` and `materials` arrays give authored labels, where supplied. |
| `target` | Index into `targets` for the dominant splat or frame look at each pixel. Scoped bindings take precedence over scene-wide grades. Zero means no recorded binding. The table identifies the asset, stage, and selector when available. |
| `mask` | A scalar between zero and one. The pass shows sampled spatial mask weights composited with surface coverage, including transparent splats, followed by applied frame and palette masks. |
| `emission` | Three floats per pixel. Premultiplied visible emissive RGB. Nearer layers attenuate emission. |
| `splatId` | Unsigned integers. One-based splat index of the owner, with zero for an empty pixel. Stable while the world preserves its splat slots. |
| `position`, `objectPosition` | Three floats per pixel for the owned point in world or rest-space coordinates. |
| `protected` | Per-pixel detail protection used by the stable resolve. |
| `emissionDepth` | Approximate depth of the nearest contributing emissive layer. |
| `motion`, `emissionMotion` | Two floats per pixel for XY displacement in art pixels, with positive Y downward. |

The owner is the nearest depth-writing fragment with effective opacity above 0.5. A layer drawn later wins a depth tie. Opaque edge sprites carry their anchor's splat ID. Coverage and emission also account for soft layers. These rules keep the depth, ID, and normal attached to the same surface.

Pass a solid's `objectId` or `tag` and its material's `materialId` to attach names. Unnamed sculpted objects and materials get anonymous IDs local to the build. For direct builder splats, use `builder.describeSplats(first, end, { object, material })` with a half-open range. A directly authored emissive splat can set `emission: false` alongside `em: true` to keep the legacy shading behavior while excluding it from the emission buffer. Construct the builder with `{ renderMetadata: false }` as its third argument to skip storing these fields.

Browser hosts receive `ArtPasses` in the toolkit bundle, including the channel names and GLSL helpers for ownership and blending. The default [WebGL canvas renderer](browser-renderer.md) draws the image. Node's render API provides the diagnostic buffers described here.

For motion channels, request `captureMotion: true` on the prior frame and pass its `motionReference` as `motionFrom` when rendering the next frame. The two frames must use the same art dimensions and preserve their splat slots. The emission variant also tracks translucent sources.

## Part motion and previous depth

Request `['part-motion']` or individual channels in the headless renderer. Part motion carries a visible point through the owning splat's prior pose and camera, including rotation of rig parts. It checks the prior pixel's part and surface depth before accepting that correspondence.

| Channel | Data |
| --- | --- |
| `partId` | One unsigned ID per pixel, with zero for an unassigned part. Index `parts` for the label, owning entity or object when available, and the source of the assignment. |
| `partMotion` | Two float32 values per pixel, current center minus the prior image position, in native art pixels. Positive X is right and positive Y is down. Subtract the vector from the current pixel center to find its prior position. |
| `previousDepth` | One float32 value per current pixel. The value is the exported depth at that reprojected pixel of the previous frame, along the previous camera axis in scene units. |
| `partMotionValid` | A byte per pixel. 255 means the correspondence passed. 0 means invalid. The same mask accompanies `previousDepth` as `previousDepthValid`. |

Invalid vectors use zero. Invalid previous depth uses positive infinity. Use the mask to distinguish disocclusions and cuts from valid stationary pixels. The first frame, a rewind, a new render source, a projection change, and an art-grid resize also invalidate the pair. Depth is checked at the nearest prior sample with a tolerance of 1.25 art-pixel widths measured in scene units at that depth.

Named rig parts and dominant bone assignments are discovered automatically. An explicit `target: { entity: 'tide-dial', part: 'needle' }` in `builder.describeSplats` can name a part and scope it to an entity. Otherwise a named object supplies the group, or an unnamed splat requires a matching splat slot. The pass follows opaque splat owners. Standalone atlas cards, ephemeral effect rows, and transparent layers use their existing color and coverage paths. Preserve splat slots and their meanings across samples. Approximate surface frames and art-grid occlusion checks can reject correspondences at grazing edges.

```js
const partMotionHistory = ink.createPartMotionHistory();
const frame = ink.render(world, {
  t, w: 144, h: 88, px: 1,
  passes: ['part-motion'], partMotionHistory, resetPartMotion: cut
});
```

Use one history per sequence and render in playback order. For an explicit pair, render the prior frame with `capturePartMotion: true` and pass its `motionReference` as `motionFrom`. Keep a stable `partMotionSource` token if your host supplies new render buffers for the same source. `resetRenderHistory`, `resetPartMotion`, or clearing the history starts a new pair. Recipe graphs can request the channels from `scene.render` and read exact data and validity via `scene.pass`.

```sh
ink-studio passes examples/part-motion.js --previous .25 --t .333333 --channels part-motion --w 144 --h 88 --px 1 --px1 --out tide-check
ink-studio clip examples/part-motion.js --from 0 --to 2 --fps 12 --feedback-fps 12 --feedback-cuts 1 --passes part-motion --w 144 --h 88 --px 1 --px1 --out tide-dial.png
```

Clips and sheets use the previous emitted frame and invalidate the first sample after a feedback cut. Preview PNGs visualize depth and vectors. For lossless files use the layered export.

The PNG writer includes a `passes.json` manifest with the art dimensions,
image scale, and available previews. Read `position` and `objectPosition`
directly from Node's typed arrays for floating-point coordinates.

With [mixed-resolution compositing](mixed-resolution.md), the color export uses the output grid and diagnostic passes retain their own `w` and `h` on the world grid.

## Deep compositing

Use `render(world, { deepComposite: true })` to retain four fragments per
art pixel in the headless renderer. The scene composites splats and world
sprites at their sampled surface depths and evaluates the intervening media
at each depth. Read a layer with `graphDeepLayer(frame, options)` in Node,
or pass `scene.render.frame` into `scene.deepLayer` in a recipe graph.

```js
const frame = ink.render(world, {
  w: 256, h: 144, px: 1,
  deepComposite: { layers: 8, reflections: ['basin'] }
});
const lettering = ink.graphDeepLayer(frame, { view: 'transmitted', kind: 'sprite' });
const reflected = ink.graphDeepLayer(frame, {
  view: 'reflected', plane: 'basin', object: 'buoy'
});
```

| View | Address |
| --- | --- |
| `camera` | The main camera ray. Uses front-to-back order and includes retained fragments with zero visible coverage. |
| `transmitted` | Behind the first visible glass pane. Uses the dominant valid refraction tap where the compositor bends the view. |
| `reflection` | The native mirrored camera grid for a named planar capture. |
| `reflected` | The main camera grid where water samples the named plane. Uses the strongest contributing sample of the reflection filter and the water's visibility. |

Use a zero-based `rank` after filtering by optional `kind`, `object`,
and `material`. Kinds are `splat`, `glass`, `sprite`, and `ink` for
cutaway ink and legacy edge sprites. Baked drawing strokes retain their
splat object and material identities. Select a named ID or its number.
A missing fragment yields zero coverage and an invalid sample.

| Output | Data |
| --- | --- |
| `value`, `surface` | Straight RGBA8 in the selected view. `value` includes the medium between that sample and its camera. `surface` contains the shaded fragment before the medium. Both carry the fragment's own alpha. |
| `mask`, `valid` | Floating-point visible coverage in [0, 1] and a byte validity mask. Visibility includes nearer layers and the optical receiver in transmitted and reflected views. |
| `depth` | Camera-axis depth in world units. An empty sample uses `emptyDepth`, defaulting to 1e9. Reflected samples retain the mirrored camera's depth. |
| `ids` | Four unsigned channels for kind, one-based splat index, object ID, and material ID. The report includes the kind and label tables. |
| `scatter`, `transmission` | RGB in-scattering and transmission accumulated to the selected fragment. The media stage evaluates each channel as `scatter + transmission * surface` before color quantization. |

Capture is opt-in. Set `layers` from 1 to 16 and request up to four
`reflections` by name. The main image and rendered reflection captures
share a two-million-slot limit. The usual `fragmentBudget` also applies to
the sort. The retained-layer cap leaves final compositing intact.
`frame.deep.count` reports the number of layers encountered per pixel,
including layers beyond the cap. Coincident contributions from the same
named object and material share a layer. Set `coalesce: false` to retain
those contributions individually. Color is captured at the fragment stage
ahead of final screen effects. With mixed resolutions, the capture remains
on its native art grid.

The headless renderer provides deep scene captures. A browser graph can
consume the resulting rasters as regular input slots. Run
`node examples/deep-composite.cjs tide-archive.html` for a preview of the
transmission, reflection and fog rasters from one scene.

## Layered exports

`ink-studio export-layers <scene> --t 0,1,2 --out directory` writes numbered image sequences and a `layers.json` manifest. Use the usual camera and render options and set `--w` and `--h` for the output size. Use `--px1` to keep the renderer's native color grid. A single frame at time zero is the default. Use `--from`, `--to`, and `--n` for evenly spaced samples.

In Node, use `exportLayers(world, { out, view, times, native, pose })`. The optional `pose(world, time)` callback can advance authored simulation or mutable scene state before capture. The result contains the manifest and its absolute file path.

| Layer | Encoding |
| --- | --- |
| Color | RGBA8 PNG with straight alpha. |
| Depth | Grayscale 16-bit PNG. Zero means no surface. Codes 1–65,535 interpolate linearly between that frame's recorded `depthRange.near` and `depthRange.far`. A constant finite depth uses code 1. |
| Exact depth | Headerless little-endian float32 samples in scene units along the camera axis. Positive infinity means no surface. |
| Normals | RGBA8 PNG. World XYZ is `2 * (RGB / 255) - 1`. Alpha 255 indicates a reported normal. |
| Object and material IDs | RGB24 PNG data. Decode `65536 * R + 256 * G + B` from the file's channel bytes. Index the frame's `objects` or `materials` table for labels. Zero means unassigned. |
| Material mattes | One grayscale PNG per visible material ID. White pixels belong to that material. All other pixels are black. A missing matte means the material has no pixels in that frame. |

All files in a frame have the declared dimensions and top-down rows. The manifest records the sampled camera, the original surface grid, and labels. Surface data uses nearest sampling from that grid. Surface ownership follows the render-pass rule above. Color can also include soft coverage, fog, and screen-space overlays. For analysis, read the stored PNG sample values directly.

Add `--part-motion on` or `partMotion: true` in Node to export RGB24 part IDs, interleaved float32 little-endian XY vectors, float32 little-endian previous depth, and a grayscale validity PNG. The vectors remain in native art pixels. The `parts` and `surfaceSize` fields record the frame's labels and art dimensions.

### Object mattes and light groups

Pass `--compositing file.json` or `compositing` to `exportLayers`. Either field can be omitted:

```json
{
  "objectMattes": ["harbor-signal", "window-frame"],
  "lightGroups": [
    { "id": "amber", "lights": ["area:amber-window"] },
    { "id": "blue", "lights": ["area:blue-pier"] }
  ]
}
```

An object matte can target an authored name or a positive numeric object ID. The exporter writes three grayscale 16-bit PNGs for every requested object:

| Matte | Sample |
| --- | --- |
| `camera` | Visible source-over coverage of all matching fragments, including transparent fragments. Occlusion, scalar transmission through ray-traced media, and glass refraction affect this matte. |
| `reflected` | Coverage delivered through named planar captures, including water and surface finishes. It follows the reflection filter and is attenuated by reflecting strength and foreground occlusion. |
| `combined` | Camera and reflected coverage summed and clamped to one. |

The compositor accumulates coverage as it draws, independently of the retained deep rank. It uses the renderer's actual glass and planar reflection taps, including the wider footprints used by rough reflections. Reflections from sky and cube probes supply lighting and use their existing color paths. Palette steps, screen effects, and mixed-resolution overlays are applied after the native matte capture.

In Node, pass `objectMattes: ['harbor-signal']` to `render` and read it with `objectMatte(frame, {object: 'harbor-signal', view: 'combined'})`. In recipe graphs use the same option on `scene.render`, then pass its frame to `scene.objectMatte`. The raster contains one float per native art pixel. Requesting a matte activates deep ordering. The main and planar views share a budget of two million object samples across up to eight selected objects.

Light members use the scene's authored IDs with a source prefix. Use `area:`, `spot:`, `point:`, `spill:` for emissive spills, or `shot:key`, `shot:fill`, `shot:rim`, and `shot:negativeFill` for shot roles. Assign each light to one group. Unlisted lights and baked lighting stay in the base. The renderer evaluates matched lighting plates with the groups enabled in list order. Each group records the signed difference from the preceding evaluation, including any alpha change from a visible emitter. Interactions such as clipping are assigned to the group enabled at that step.

The base, reference, and group files use interleaved little-endian float32 RGBA in linear sRGB with premultiplied RGB and top-down rows. Add the group files to the base to rebuild the raw reference to floating-point precision. Apply gain to RGB and alpha together, then unpremultiply for a straight-alpha image. The reference captures surface and optical lighting before final palette, screen effects, and temporal feedback. It has its own native dimensions in the manifest. In Node, `captureLightGroups(world, {groups, view})` returns the same rasters. Use up to eight groups and a one-million-pixel art grid.

```sh
ink-studio export-layers examples/harbor-compositing.js --w 192 --h 128 --px 1 --px1 --raw --t .35,.85,1.35 --compositing examples/harbor-compositing.json --out harbor-layers
```

## Environment passes for compositing

```sh
ink-studio passes examples/weather-front.js --t 5.8 --channels environment --px1 --out weather-passes
ink-studio clip examples/weather-front.js --from 4 --to 6 --fps 12 --passes environment --px1 --out storm.png
```

Use `environment` to request all five passes. Replace it with a comma-separated list to select individual channels. `render`, `sheet`, `clip`, and `sim render` write the requested passes beside the main export when you use `--passes`. Clips write synchronized animated PNGs. [Shot recipes](shot-recipes.md) verify each sidecar when replaying a render or clip.

| Channel | Node data per pixel | Export |
| --- | --- | --- |
| `sky` | RGB of the unobstructed backdrop, including authored sky, celestial objects, clouds, and horizon art. | RGB image |
| `fogTransmittance` | Fraction of light transmitted through fog and aerial perspective to the resolved surface or background. | Grayscale, white is fully clear |
| `precipitation` | Premultiplied RGBA of visible rain and falling snow, with depth occlusion and particle lighting. | Straight-alpha RGBA |
| `reflections` | Premultiplied RGB contributed by visible material, scene sky, and planar reflection layers. | RGB image with zero where no reflection contributes |
| `foregroundCoverage` | Coverage of scene splats and sprites, with falling precipitation and ray-traced media omitted. | Grayscale, white is fully covered |

Node returns these buffers as `Float32Array` values on the native art grid. PNGs encode each channel at 8 bits and the manifest records the encodings. Color passes are captured before volume fog, final palette mapping, and frame-wide effects. The fog channel excludes water absorption, cloud extinction, and the legacy per-splat haze tint.

## Selective ink and stable pixels

Supply these in a scene's `finish.look` or pass `ink` and `stable` overrides to `render`.

```js
const look = {
  ink: {
    silhouette: { shadow: '#101a29', highlight: '#a48d64' },
    crease: { steps: 1, litSteps: 0 },
    boundary: { color: '#243d4c' },
    light: [-.5, .8, .45],
    depthGap: .17,
    creaseCosine: .58,
    litAt: .52,
    suppressSameMaterial: true,
    materials: {
      stone: { ramp: [1, 2, 3, 4], boundary: false },
      spell: { palette: 'magic' }
    },
    reserved: {
      emission: ['#c46c38', '#fca35e', '#fff4cc'],
      fog: ['#1f303b', '#536f79', '#94b5bd'],
      magic: ['#472a64', '#a964c5', '#f5d5ee']
    },
    emissionThreshold: .25,
    fogThreshold: .27
  },
  stable: {
    snap: true,
    anchor: [0, 0, 0],
    dither: 'object',
    spacing: .08,
    resolve: 'clusters',
    threshold: .4,
    protect: ['eyes', 'spell']
  }
};
```

Use [Effect palette ramps](effect-palettes.md) to author independent fog, cloud, sky, and emission colors using the rendered effect coverage.

Give a line a fixed color, separate highlight and shadow colors, or steps along its authored material ramp. A material rule can override or disable any line independently. A palette reserved for a named material applies only to that material. The emission and fog ramps are keyed by their render signals.

Use `ink.targets` to style lines by object, entity, material, surface, prefab, or tag. Ink applies scene rules first, then material rules, then each matching target in list order. Set `occlusionSilhouettes: true` to classify the near side of a depth break between separate objects as a silhouette. Touching materials still use the boundary rule.

```js
const ink = {
  occlusionSilhouettes: true,
  silhouette: { color: '#35464b' },
  crease: { steps: 1 },
  boundary: { color: '#496873' },
  targets: [
    { select: { tag: 'masonry' }, distance: { near: 12, far: 19 },
      crease: { distance: { near: 10, far: 14 } } },
    { select: { object: 'courier' }, crease: false,
      silhouette: { shadow: '#301d37', highlight: '#711f45', distance: false } }
  ]
};
```

`distance` measures scene units along the view axis from the authored camera in either projection. A line stays at full strength through `near` and disappears at `far`. Put the range on `ink`, a material, or a target to apply it to all three line types there. A line's own range takes precedence. Use equal values for a hard cutoff or `distance: false` to clear an inherited range. Set a line to `false` to turn it off at every depth.

Use `--ink file.json` to apply a standalone ink profile through the CLI or `--ink off` to disable selective ink. The [aqueduct courier scene](../examples/selective-ink.js) shows a colored character contour in front of stonework that loses its ink over distance.

Use an [indexed paint mask](pixel-stamps.md#marking-a-surface) to gate a
line by rest-space marks. `silhouette.contrast` selects a dark or light
swatch using neighboring background pixels.

```sh
node cli/ink-studio.js render examples/selective-ink.js --w 318 --h 160 --px 1 --out aqueduct.png
```

### Hold and lose edges by shot

Set a line's `strength` from 0 to 1 to control how much ink it adds. Add
`lost` to blend the edge itself into the adjacent rendered colour. Use the
same controls on silhouettes, creases, and material boundaries.

```js
const ink = {
  occlusionSilhouettes: true,
  silhouette: { color: '#2b3144', strength: .8 },
  targets: [
    { select: { object: 'courier' }, silhouette: {
      lost: { lightness: [.24, .42], contrast: [.055, .24] }
    } },
    { select: { surface: 'courier-face' }, silhouette: {
      color: '#cc9488', strength: 1, lost: false
    } },
    { select: { surface: 'courier-hand' }, silhouette: {
      color: '#f4c49a', strength: 1, lost: false
    } },
    { select: { tag: 'distance' }, silhouette: {
      lost: { strength: .9, contrast: [.05, .24], distance: { near: 10, far: 17 } }
    } }
  ]
};
```

- `lost.strength` controls the blend and defaults to 1. Use `lost: false`
  on a more specific target to restore its edge. `strength: 0` on the
  line makes the blend its only colour operation.
- `lightness: [low, high]` limits the blend to shadows on the edge.
  `contrast: [low, high]` limits it by the lightness difference across
  the edge. Each gate is full through `low` and feathers to zero at
  `high`. Lightness and contrast use the rendered colour in 0–1.
- `lost.distance: { near, far }` introduces the blend between the
  specified camera distances. All supplied gates multiply together.
  The line's own `distance` range still controls its ink contribution.

The headless renderer samples visible neighbours on the native art grid,
with depth and ownership deciding which edge each neighbour belongs to.
Merge samples use non-emissive surfaces and visible backgrounds.
Reserved palettes retain precedence. Palette pixel inspection reports the
neighbour's colour and blend weight as `lost-silhouette`, `lost-crease`,
or `lost-boundary`.

```sh
node cli/ink-studio.js render examples/edge-hierarchy.js --w 320 --h 168 --px 1 --out last-signal.png
```

The [last signal scene](../examples/edge-hierarchy.js) keeps the face and
lantern hand distinct while letting the cloak and far aqueduct soften.
Author the profile in `finish.look.ink` or override it for a shot with
`--ink file.json`. Use `--ink off` to bypass selective ink.

See [Stable dithering and camera review](stable-dithering.md) for per-object anchors and native-resolution pan and orbit clips. Camera snapping applies to orthographic projection. World-space dithering samples at the visible surface. Object-space dithering maps the sample back to the splat's rest frame, using the rig transform where available. Screen-space dithering follows the art grid. Use `--ortho --snap`, `--dither-space screen|world|object`, and `--resolve native|coverage|clusters`. The coverage and cluster modes render four subpixels per art pixel and can protect named objects, materials, glints and small emissive details.

## Art-pixel effects

Set `finish.look.effects`, or pass `artEffects` to `render`. Each effect accepts `false`. Use `--effects off` to disable the whole stack.

| Effect | Controls |
| --- | --- |
| `emitter`, `reflection` | Separate `colors`, `threshold`, `rate` and `phase` for visible emitters and their planar reflections. |
| `glow` | `radius` in art pixels, one or two `bands`, palette, timing, emission threshold and `depthBias`. |
| `heat` | Emitter threshold, `radius`, upward offset `up`, displacement `pixels`, `rate`, `phase` and `depthBias`. Samples and destinations are both depth checked. |
| `cycle` | `colors`, discrete `rate` and `phase`, with an optional named `material`. Multiple cycle rules can be supplied. |
| `trail`, `smear` | Independent palettes and timing, prior frame count, duration and depth bias. Smears also expose discrete `steps` and maximum `reach`. |

For trails that follow the camera and a moving object or surface, use [motion-aware afterimages](motion-afterimages.md).

Call `studio.load().ArtEffects.history()` and reuse the result as `artHistory` for consecutive frames of the same view. The CLI creates a history for sheets and animation clips. Call `clear()` after a camera cut. Art effects leave the source emission and geometry passes available for inspection.

## Emissive finishes

Set `finish.emissiveFinishes` in diorama data or pass `emissiveFinishes` to `B.finish` in a JavaScript scene. Match named emitting splats by object or material. Set `glow: true` on a diorama material or `em: true` on a JavaScript sculpt material to make it emissive. The first matching profile owns each emitter. Omit individual sections to use the base emissive appearance, no authored spill, or the scene's existing glow, respectively.

```js
emissiveFinishes: [{
  id: 'lantern-light',
  select: { object: 'lantern-flame' },
  core: { color: '#fff0b0', strength: 1.2 },
  spill: { color: '#ff823b', offset: [0, -0.18, 0.24],
    normal: [0, -1, 0], shape: 'disk', size: [0.3, 0.3], radius: 2.8, intensity: 6 },
  glow: { color: '#ffc05f', radius: 4, strength: 0.67,
    small: { belowPixels: 96, radius: 1, strength: 0.45 } }
}]
```

- `core` tints and scales the source emission while keeping its coverage. Strength `0` can darken the core while spill and glow still run.
- `spill` uses an invisible area light. Give it a fixed world-space `at` position or an `offset` from the current center of the selected emitters. Control its shape, direction, falloff, and shadows with the [area light settings](scene-optics.md). For shadow-casting spill in JavaScript sculpts, set `keepRenderSdf: true` before baking. The diorama builder retains the required shadow geometry automatically.
- `glow` uses visible emission coverage and depth to spread light around the core on the native art grid. It supports `falloff`, source `threshold`, and `depthBias`. Below 96 art pixels on the shorter side it defaults to one art pixel of reach and 68% of the regular strength. Override the cutoff, radius, and strength with `small`, or use `small: false` to keep the same appearance at every size. Set `glow: false` to suppress the scene glow for the selected emitter as well.

Use `--emissive-finishes off` to disable the profiles. `--area-lights off` disables the spill, and `--raw` keeps the core and spill while bypassing the screen glow.

```sh
node cli/ink-studio.js render examples/emissive-finishes.js --w 322 --h 152 --px 1 --out night-market.png
```

## Local splat ordering

Set `look.splatOrder = 'surface'` or pass `--splat-order surface` to sort overlapping fragments by an estimated intersection with each splat's surface plane. `center` uses the ordinary global order. The queue has a configurable `fragmentBudget` and replays the original order if the budget is exceeded. The result sets `orderFallback` in that case.

Run `node scripts/experiment-splat-sampling.js <output-directory>` to reproduce the independent footprint and ordering experiments. The four-tap footprint experiment increased short-sequence flicker in the tested scenes. The surface-order test with crossed planar splats corrected all 576 misordered opaque overlap pixels in that fixture.

## Directional sprite atlas

```sh
ink-studio atlas examples/art-pipeline.js --t 1.2 --w 92 --h 76 --directions 8 --cols 4 --maps depth,normal,emission
ink-studio atlas examples/art-effects.js --from 0 --to 1.2 --fps 12 --directions 8 --pivot 0,0,0
```

`color.png` contains straight RGBA. Optional maps share its layout. `atlas.json` includes the registered pivot, camera direction, rectangle, timestamp, duration, file names and map encodings. Depth uses a shared scene-unit range encoded into RGB24. Normals are signed world-space axes mapped into RGB. Emission stores visible premultiplied emissive RGB.

Use [artist-authored cards and impostors](impostor-atlases.md) to place the resulting atlas back into a scene.

In Node, use `spriteAtlas(world, { width, height, directions, times, fps, pivot, view, maps, pose })`. Supply a `pose(world, time)` callback for scenes that need to advance a stateful timeline or pose a rig. A separate effect history is kept for each direction.

For keyed fragmentation and reassembly with stable ownership, see [world-space reveal and reconstruction](world-reconstruction.md).
