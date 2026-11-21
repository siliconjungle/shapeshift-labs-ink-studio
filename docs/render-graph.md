# Editable render graph

Set `look.renderGraph` on a scene or pass `renderGraph` to either renderer. The graph starts from the resolved scene image, including any world and screen-layer composition already configured on the frame. To place a screen layer anywhere in the graph, give it its own composite pass. The CPU and WebGL use the same pass definitions.

The graph contains an ordered `passes` list of up to 32 entries and an optional `output` image ID. Each pass has a unique `id` and a `type`. The built-in image ID `scene` names the starting image. An image pass takes its `input` from the preceding image by default. Named inputs, sources and masks must refer to earlier outputs of the right type. The last image is the default output. Branches that do not contribute to the chosen output are skipped.

| Pass | Controls |
| --- | --- |
| `mask` | Outputs coverage for downstream passes. An optional `rect` uses `[x, y, width, height]` and `feather` softens its edges inward. A `volume` masks visible world surfaces in a feathered ellipsoid. `invert` flips the combined coverage. |
| `grade` | Applies an RGB `stack` to the input. CPU and WebGL use the same sampled color cube. `cubeSize` defaults to 33 and accepts 2–65. |
| `reflection` | Mirrors the current image or a named `source` along `axis` (`x` or `y`). `line` sets the reflection line in output pixels and defaults to the midpoint. |
| `distortion` | Samples the input or a named `source` using an XY `offset`, wave `amplitude`, or [scanline controls](#scanline-distortion). `period` is in pixels, and `phase` and `rate` are in cycles and cycles per second. |
| `composite` | Blends a named `source` image using `over` or `add`, or draws a single [mixed-resolution layer](mixed-resolution.md) from `layer` using its own resolution, filtering and blend settings. Use `isolated: true` to start this pass on transparent pixels. |
| `history` | Captures the visible pixels of a required target selector. Choose `hold` or `persistence`. An optional mask controls capture coverage. The current depth owner scopes the history overlay. |
| `feedback` | Warps and decays the previous signal and composites new emission into it. Accepts an earlier image or a mixed-resolution emission layer. |
| `frameAge` | Replaces regions of an image from a shared frame history. Each region can delay, hold, or replay captured frames. |
| `motionSmear` | Moves pixels from the retained frame through a motion field and blends in the clean input. A refresh mask can restore specific regions. |

Screen coordinates are in final output pixels from the top left. Reflected and distorted samples outside the image leave the input pixel unchanged. Graph reflection and distortion work on screen images. Scene-space planar capture, glass refraction and depth-dependent media use the scene renderer.

Passes can set `select` to a named object, entity, material, surface, prefab or tag selector. The selection follows the visible depth-writing splat at each pixel of the world grid. A `mask` reference can narrow the selection further. `opacity` scales the effect from zero to one. A pass with `enabled: false` keeps its image input or supplies zero mask coverage. Requested diagnostic buffers remain on the native world grid.

## Connect procedural rasters

Bind a named raster to a composite or feedback layer with
`layer.source: { slot: "ink" }`. Bind a raster to a mask pass with
`raster: { slot: "puddle" }`. The CPU and WebGL renderer accept the same
`renderGraphInputs` record.

```js
const renderGraph = { passes: [
  { id: 'wet', type: 'mask', raster: {
    slot: 'puddle', channel: 0, range: [0, 1], rect: [48, 92, 120, 24], filter: 'linear'
  } },
  { id: 'ink', type: 'composite', mask: 'wet', layer: {
    source: { slot: 'ink' }, rect: [48, 92, 120, 24]
  } }
] };
const renderGraphInputs = { ink: preparedImage, puddle: proceduralMask };
```

Each slot takes a procedural raster with `width`, `height`, `data`, and
an optional `channels` count. An image uses its own dimensions and straight
alpha. Use the layer's `rect` and `filter` for destination placement and
resampling. A mask defaults to alpha for two- or four-channel rasters and
to luma for RGB or the sole channel of a scalar raster. Select a numerical
channel index or `alpha`, `luma`, `r`, `g`, or `b` explicitly. The default
range is `[0, 255]`. Samples are normalized and clamped to the specified
range, then multiplied by any rectangle, earlier mask, or depth selection
on the pass. Inversion applies to the combined coverage. Layers stretch to
the frame when no destination rectangle is set. Disabled or unused passes
do not read their slots.

In an ordinary procedural graph, connect raster outputs to a `data.record`
node with one key per slot and connect the record to
`scene.render.renderGraphInputs`. Set `scene.render.options.renderGraph`
to the graph definition. The two graphs sample the scene at the same take
time. Screen-space layers composite after scene optics. Use
`warp.surface` to place a procedural texture on a depth-tested world
surface when glass or rain should cover it.

## Read screen and scene passes

In the headless renderer, pass a list of IDs in `renderGraphCapture` to
keep the selected passes on `frame.renderGraphPasses`. This also works
with the `scene.render.renderGraphCapture` input. Read a captured pass
with `scene.pass` and a channel such as `graph:wet`. Its `data` port returns
one byte channel for a mask or straight RGBA for an image, both at the
render graph grid. The `value` port is an RGBA preview. You can capture
the original `scene` image or a branch outside the final image. The chosen
final output remains the same.

For WebGL, pass the same `renderGraphCapture` list to
`renderer.render(world, settings)`. The call returns a record keyed by
the requested pass IDs with top-down straight RGBA or single-channel
mask bytes. Only the requested passes are read back. A regular render
returns as usual. Use [visual span capture](graph-clips.md#capture-a-reusable-visual-span)
to retain multiple frames for independent playback.

Native scene channels such as `depth` and `precipitation` use the existing
`scene.render.channels` and `scene.pass` ports. They retain their native
art grid and units. A procedural node can consume either kind of pass.

```sh
node examples/render-graph-bridge.cjs graph-bridge-review
```

The example places a procedural ferry sign behind a blue glass pane and
world-space rain. The sign also supplies an image slot for its reflection
on wet paving. A second procedural raster supplies the puddle mask. The
example exports the final scene, the native rain pass, and the puddle mask
captured from the render graph and resized by an ordinary raster node.

## Scanline distortion

Give a distortion pass `rows` to change its source sampling one output row
at a time. JSON accepts keys with increasing `at` values from 0 at the top
to 1 at the bottom. Ink interpolates the keys and holds the nearest value
outside their span.

```json
{
  "id": "water-ripple",
  "type": "distortion",
  "select": {"material": "water"},
  "amplitude": [2, 0],
  "period": 9,
  "rate": 0.5,
  "depthThreshold": 0.25,
  "rows": [
    {"at": 0.4},
    {"at": 1, "offset": [3, 0], "scale": [0.92, 1], "tint": [-8, 5, 16]}
  ]
}
```

- `scale` scales the XY sample around the center of the output image.
  `offset` adds XY output pixels. The pass’s offset and sine wave then
  contribute their usual shifts.
- `tint` adds or subtracts RGB channel values in the range −255 to 255,
  with the result clamped to the color range. Source alpha is preserved.
  Each omitted field defaults to identity.
- In JavaScript, `rows` can also be a callback. It receives
  `{ y, v, width, height, time }` once per output row. `y` is the zero-based
  row and `v` is its position from 0 to 1. Return the row fields or
  `undefined` for identity.
- `depthThreshold` compares the destination and sampled pixel on the
  native scene depth grid. Their axial depths must be within this distance
  in world units. A scene surface and the backdrop never match. Rejected
  samples leave the destination alone. Use this with the scene or a
  screen-aligned branch derived from it. WebGL uses its quantized depth buffer.
- Use a preceding `composite` pass with `isolated: true` to make a named
  image with transparency. Reference it as the distortion's `source` and
  set `blend: "over"` to keep the destination visible through empty pixels.
  The default blend is `"replace"`. Use `wrap: true` to repeat the image
  at both edges.

[Evening at the Millrace](../examples/raster-millrace.js) uses a water
selector and depth rejection to ripple a bridge reflection.
[Low Flight Over the Tidal Flats](../examples/raster-tidal-flats.js) maps
rows of a repeating aerial tile into the foreground and composites a distant
skyline above it.

```sh
ink-studio clip examples/raster-millrace.js --from 0 --to 6 --fps 12 \
  --w 240 --h 160 --px 1 --out millrace.png
ink-studio clip examples/raster-tidal-flats.js --from 0 --to 6 --fps 12 \
  --w 240 --h 144 --px 1 --out tidal-flats.png
```

### Repeat, skip, and blank rows

Use `rowEdits` on a distortion pass to apply whole-row edits before its
continuous `rows`, offset, or wave transforms. Row numbers count from
zero at the top of the final output image.

```json
{
  "id": "signal-fault",
  "type": "distortion",
  "rowEdits": [
    {"mode": "skip", "start": 8, "count": 3},
    {"mode": "repeat", "start": 24, "count": 5, "source": 23},
    {"mode": "blank", "start": 40, "count": 2}
  ]
}
```

The pass shares the [standalone scanline rules](headless-authoring.md#repeat-skip-and-blank-scanlines).
The visible selection, mask, and opacity still control where it writes.
In the default `"replace"` blend a blank clears the covered pixel.
In `"over"`, blank rows leave the current image visible. A JavaScript
`rowEdits({ width, height, time })` callback can return a new array each
frame or return `undefined` to leave the rows alone.

## Moving world reveals

For a `mask` pass, set `volume: { at, extent, feather }`. The first two fields
are XYZ center and positive radii in world units. Feather is the fractional
width of the soft inner edge, from zero to one, and defaults to .25. The
mask checks the resolved scene depth on the native world grid. It can be
combined with the usual target selector, rectangle, and earlier mask.

Use an inverted copy of that mask to place a dimming layer over the rest of
the scene. Animate the volume with
[a presentation track](scene-timeline.md#presentation-tracks), and reference
the original mask from a history pass to capture the signal as it crosses
the selected subject.

## Target-scoped screen history

```json
{
  "id": "relay-persistence",
  "type": "history",
  "select": { "object": "relay" },
  "mask": "reveal",
  "mode": "persistence",
  "halfLife": 0.7,
  "cameraMotion": "keep"
}
```

`hold` keeps the first captured color and coverage at a pixel until the pass
resets. Previously empty pixels can capture as the mask moves. `persistence`
keeps fading prior color under new samples, with `halfLife` in scene
seconds. Default half-life is .45 seconds. Both modes capture their image
input with the optional mask and use `opacity` for display. The current
visible target owns the overlay pixel, so a nearer object suppresses the
held image. History is stored at output resolution in premultiplied 8-bit
color. Graphs may retain up to four live histories with a combined budget
of 8,388,608 output pixels.

WebGL keeps the history on the GPU per renderer. For CPU playback, create
one `KIT.renderGraph.history()` and pass it as `renderHistory` on each
`render` call. CLI sheets and clips keep one history for their rendered
sequence. A graph pass can be compiled without a session for a still.

Disabling or removing a history pass clears it. Backward time jumps,
dimension changes, source changes, and `resetRenderHistory: true` reset
history. The default `cameraMotion: "reset"` also clears it on camera
movement. Use `"keep"` for deliberate screen-space persistence through
camera moves. Supply a stable `renderHistoryKey` when consecutive world
snapshots in a shot use different object identities.

## Feedback

A feedback pass keeps a premultiplied signal at output resolution. At each
new time it samples its previous signal through the warp, decays it, then
composites the current emission over it. The resulting signal is stored for
the next step and drawn over the pass's `input`. Compositing over the input
keeps the background in its current position.

```js
const feedback = {
  id: 'phosphor',
  type: 'feedback',
  input: 'scene',
  layer: { resolution: [256, 144], source: ({ w, h, time }) => paintEmission(w, h, time) },
  halfLife: .7,
  blend: 'add',
  cameraMotion: 'keep',
  warp: {
    velocity: [20, -9], rotation: .55, zoom: 1.15,
    wave: [14, 18], period: 80, rate: .3
  }
};
```

- Use `source` for an earlier image, `layer` for a mixed-resolution
  emission layer, or omit both to inject the image `input`. A layer can
  provide a transparent raster, drawing commands or a camera atlas feed.
- `gain` multiplies emission strength from zero to one. An optional
  `threshold: [low, high]` ramps it by the maximum straight RGB component
  from zero to one. An input mask and a visible target selector limit where
  new emission enters. Trails can then travel beyond that selection. Mask a
  later composite pass to clip the displayed trails to a region.
- `halfLife` is in scene seconds. `opacity` fades the displayed signal,
  while the retained signal continues to evolve. Choose `blend: "add"`
  (the default) for light buildup or `"over"` for ink-like layering.
- `warp.velocity` is XY pixels per second, with positive Y moving down.
  `rotation` is clockwise radians per second and `zoom` is the scale
  multiplier per second. `center` is a normalized XY pivot and defaults to
  the center of the frame.
- `warp.wave` gives XY displacement in pixels per second. Its `period` is
  in pixels, `rate` is in cycles per second, and `phase` is in cycles.
  Set `blockSize` to a positive pixel size to sample the displacement
  field per block. Choose `filter: "linear"` for smooth resampling or
  `"nearest"` for stepped pixels. Samples beyond the frame are empty.

Feedback shares the screen-history limits and reset rules above. A repeated
timestamp draws the retained signal without injecting or warping it again.
Pass `resetRenderHistory: true` on a cut. Use `cameraMotion: "keep"` when
camera movement should carry the screen-space trails through the shot.
Live graph edits and presentation tracks can animate warp, gain and decay.

## Frame-age masks

Each `frameAge` pass captures its image input at up to `fps` (default 12).
Give it one to eight regions and connect each region's `mask` to an
earlier mask pass. A region without a mask uses the whole pass coverage.
The pass-level `mask`, `select`, `depth`, and `opacity` apply to all regions.
Where the regions overlap, Ink applies them in declaration order.

```js
const graph = { passes: [
  { id: 'camera', type: 'composite', isolated: true,
    layer: atlas.layer('drone', { rect: [24, 24, 144, 96] }) },
  { id: 'upper', type: 'mask', rect: [24, 24, 144, 32] },
  { id: 'middle', type: 'mask', rect: [24, 56, 144, 32] },
  { id: 'lower', type: 'mask', rect: [24, 88, 144, 32] },
  { id: 'corrupt', type: 'frameAge', input: 'camera', fps: 12,
    cameraMotion: 'keep', regions: [
      { mask: 'upper', mode: 'delay', frames: 6 },
      { mask: 'middle', mode: 'hold', start: 8 },
      { mask: 'lower', mode: 'replay', start: 9, frames: 9 }
    ] },
  { id: 'screen', type: 'composite', input: 'scene', source: 'corrupt' }
] };
```

Tick zero is the first rendered frame after a reset. `delay` reads
`frames` ticks back. `hold` pins the frame at `start`. `replay` captures
`frames` consecutive ticks starting at `start`, then loops forward through
that interval. The region stays live while it waits for its samples.
`start` defaults to zero and `frames` to one. Lengths are whole ticks
from 1 to 64. If the host skips ticks, the last observed image fills the
gap. Rendering twice at the same tick preserves its original capture.

Use a named image as `source` to capture it separately from the destination
`input`. Isolate a sprite, screen layer, or camera-atlas feed to retain its
transparency through the effect. For scene objects, set `select` on the
pass. The current selected surface gates the display, and empty historical
samples leave it live. A nearer occluder stays visible.

Frame age shares the screen-history resets and uses the same CPU
`renderHistory` session. WebGL retains the frames on the GPU. The default
`cameraMotion: "reset"` starts a fresh history on a camera move. Choose
`"keep"` for a monitor or a deliberate screen-space glitch. The history
budget includes the delay buffer, pinned ticks and a reusable capture
target. Each pass can reserve up to 128 frame slots. The default capture
budget is 262,144 pixels per slot with nearest sampling. Use
`budget.scale`, `budget.maxPixels`, or `budget.filter: "linear"` to tune
history resolution and filtering. Coverage masks still resolve at output
resolution.

[Tideline Repeater](../examples/frame-age-mask.js) applies all three modes
to a live camera-atlas tile next to the clean feed.

```sh
node cli/ink-studio.js clip examples/frame-age-mask.js --w 452 --h 215 \
  --to 5 --fps 12 --feedback-fps 12 --out tideline-repeater.png
```

## Motion-smeared frame history

`motionSmear` starts with the clean image. Each following step samples
the retained image upstream along the local motion vector, mixes that
sample with the current clean pixel, and retains the result for the next
step. A longer `halfLife` keeps old fragments visible through more steps.
Stop the motion while leaving the field active to let displaced pixels
recover in place.

```js
const smear = {
  id: 'signal-breakup',
  type: 'motionSmear',
  input: 'camera',
  field: 'block-vectors',
  fieldScale: [180, 90],
  blockSize: [12, 6],
  halfLife: .45,
  refresh: 'telemetry',
  cameraMotion: 'keep'
};
```

- Set `field` to an earlier image pass such as an isolated raster layer.
  Its red and green bytes encode signed X and Y motion, with 128 neutral,
  1 or 0 fully negative, and 255 fully positive. Multiply by
  `fieldScale` (default `[120, 120]`) for screen pixels per second.
  Positive Y moves down. The blue byte and alpha control the fraction
  of history retained at that pixel. For example, `[255, 128, 255, 255]`
  applies full positive X motion and allows the normal half-life.
- `blockSize` sets the width and height in output pixels. Each block
  samples the field at its center. Use `[1, 1]` (the default) for
  per-pixel vectors. Set `velocity` to a uniform XY bias in pixels per
  second. A pass with just `velocity` uses that vector everywhere.
- Use `refresh` to reference an earlier mask. Full coverage replaces
  the retained pixel with the clean pixel immediately, including its
  alpha. Outside-image samples also use the clean pixel. The regular
  `mask`, `select`, `depth`, and `opacity` control where the smear appears.
- The history budget controls the retained resolution. Full-resolution
  nearest sampling is the default within the budget. Set
  `budget.filter: "linear"` for interpolated history samples.
  Captures use the existing CPU `renderHistory` session or the WebGL
  renderer's GPU history. A cut or rewind restores the clean input.
  Camera motion resets the pass by default. Use `"keep"` to carry the
  screen-space history through a camera move.

[Packet Drift](../examples/motion-smear.js) runs the same animated feed
through clean and motion-smeared image branches. The motion field follows
the probe's movement with different offsets in neighboring blocks.

```sh
node cli/ink-studio.js clip examples/motion-smear.js --w 420 --h 204 \
  --to 6.5 --fps 12 --feedback-fps 12 --out packet-drift.png
```

## Fixed-step playback and exports

The CLI runs `clip` and `sheet` exports containing feedback, frame age, or
motion smear at 24 history steps per second by default. `--feedback-fps` sets that rate
independently of output `--fps`. Choose a history step rate that matches
or is a multiple of the frame-age capture rate to sample every tick.
The CLI replays history from scene time zero before a trimmed export.
An output between history steps holds the latest completed frame.
Use `--feedback-cuts 2.5,4` to clear history at the first step at or after
each scene time.

```sh
node cli/ink-studio.js clip examples/render-feedback.js --w 408 --h 216 --to 7.2 --fps 16 --feedback-fps 24 --out phosphor-relay.png
```

To drive either renderer yourself, create a fixed-step replay clock and pose
and render each tick. Keep the render session between calls.

```js
const replay = K.renderGraph.replay({ fps: 24, cuts: [2.5] });
const renderHistory = K.renderGraph.history();
const frame = replay.sample(seconds, (t, resetRenderHistory) => {
  poseWorld(t);
  return studio.render(world, { t, renderHistory, resetRenderHistory });
});
```

For WebGL, pass the tick as `time` and keep the same renderer. The clock
requests a restart from its origin after a backward seek, and sets
`resetRenderHistory` on the first tick. Reset any stateful world pose that
needs to restart independently of the render history.

## Editing a live graph

Call `K.renderGraph.create(definition)` and give the returned editor to the renderer as its graph. Edit the same instance between frames, without rebuilding the world.

| Method | Effect |
| --- | --- |
| `move(id, index)` | Moves a pass to a zero-based position. |
| `update(id, changes)` | Applies a shallow update to a pass. |
| `insert(pass, index?)` | Inserts a pass or appends it. |
| `remove(id)` | Removes a pass. |
| `replace(definition)` | Replaces the graph, including its output. |
| `snapshot()` | Returns the current read-only definition. |

Edits validate the entire dependency order before they take effect. A rejected edit leaves the previous definition active. JSON graphs can be authored with the scene or passed to the CLI using `--render-graph file.json`. Use `--render-graph off` or `renderGraph: false` for an unmodified comparison.

## Bounded film and signal effects

`bloom`, `halation`, `outline`, `chromatic`, `blocks`, and `pixelSort` are normal ordered graph passes. They work in the software and WebGL renderers, use the existing native owner/depth buffers, and require no packages or external assets. See `examples/render-effects.html` for a live SDF scene with switches, camera controls, and an inspectable resource plan.

```js
const graph = K.renderGraph.create({
  budget: { maxTransientPixels: 12000000, maxHistoryPixels: 1000000, maxWork: 80000000 },
  passes: [
    { id: 'light', type: 'bloom', select: { material: 'neon' },
      radius: 22, threshold: .6, intensity: .85,
      budget: { scale: .5, maxPixels: 65536, maxSamples: 24 } },
    { id: 'film', type: 'halation', select: { material: 'neon' },
      tint: [255, 94, 38], radius: 9, inner: .4, intensity: .45 },
    { id: 'edge', type: 'outline', width: 1, side: 'inner', color: [10, 20, 31] },
    { id: 'lens', type: 'chromatic', offset: [.65, 0], radial: .4 },
    { id: 'signal', type: 'blocks', select: { object: 'screen' },
      blockSize: [40, 12], offset: [18, 0], probability: .08, rate: 5, seed: 12,
      depth: { near: 2, far: 30, feather: 1 } },
    { id: 'sort', type: 'pixelSort', select: { object: 'screen' },
      axis: 'y', span: 12, threshold: [.25, .95], opacity: .35,
      budget: { maxPixels: 32768, maxSamples: 12, filter: 'nearest' } }
  ]
});
const report = K.renderGraph.resources(K.renderGraph.prepare(graph), 1280, 720);
```

The scene and each named image remain full resolution. A small RGBA work packet carries only the effect contribution; reconstruction composites it onto the untouched full-resolution input. Unselected pixels under `maskMode:'both'` remain byte-exact. Effects preserve input alpha. Bloom/halation add linear-light radiance inside the existing frame coverage; they do not manufacture alpha outside a transparent frame.

### Effect controls

| Pass | Controls | Behavior |
| --- | --- | --- |
| `bloom` | `radius:16`, `threshold:.65`, `intensity:.6`, `tint:[255,255,255]` | Bounded golden-angle Gaussian gather of selected bright sources; linear-light addition. |
| `halation` | same, `radius:9`, `tint:[255,88,35]`, `inner:.35` | Annular warm scatter; `inner` excludes the center of the kernel. |
| `outline` | `width:1`, `color:[18,28,39]`, `side:'inner'`, `relativeDepth:.01` | Native depth discontinuities and logical object boundaries. Side is `inner`, `outer`, or `both`. |
| `chromatic` | `offset:[.7,0]`, `radial:0`, `center:[.5,.5]` | Red/blue separation, bounded to eight pixels per offset component; green stays fixed. |
| `blocks` | `blockSize:[48,16]`, `offset:[16,0]`, `probability:.08`, `rate:5`, `seed:1` | Coherent rectangular displacement with a deterministic unsigned hash; holds each pattern until the next time tick. |
| `pixelSort` | `span:12`, `axis:'x'`, `threshold:[.15,1]`, `descending:false` | Stable luminance sorting in bounded buckets. Gaps in mask/threshold, depth, and object boundaries split contiguous runs. |

Distances, radii, and block dimensions are **final output pixels**, independent of work resolution. Pixel-sort `span` is deliberately measured in **working-grid cells** (2–32). The effective span is the smaller of `span` and `budget.maxSamples`. Sorting is an insertion kernel bounded to 32 cells; its quadratic comparisons are charged in the work report. It is intended for scoped signal corruption, with reduced resolution, rather than unbounded whole-row sorting.

### Masks and depth protection

Every pass accepts `select`, an earlier named `mask`, and `depth:{near,far,feather,invert,background}`. Finite axial distances use scene world units. Depth feather fades **inside** the interval. Sky/background is excluded even from inverted intervals unless `background:true` is explicit. Masks multiply; `opacity` controls the final contribution.

New spatial effects also accept:

- `maskMode:'source'|'output'|'both'`. Bloom/halation/outlines default to source masking, allowing a selected sign to cast a halo or an outer silhouette. Chromatic/blocks/sorting default to both, keeping the destination and sampled source inside their scope.
- `depthThreshold:.25` (world units). Spatial transforms reject depth discontinuities and sky/surface crossings. Glow accepts only emitters at or in front of the destination depth: a hidden sign cannot glow over a nearer foreground object. Reconstruction repeats this test at full resolution. WebGL reuses the ownership draw to write a packed 24-bit axial depth attachment for splats and atlas surfaces; soft lighting-depth blending does not determine foreground visibility.
- `protectObjects:true` for transforms/outlines, false for glow. Uses logical entity/object identity, falling back to material and then the unnamed group. Neighboring splats in one object are not mistaken for separate objects. Set false to permit displacement across different objects at compatible depths.

The mask belongs to the resolved **frontmost scene owner**; it does not reconstruct hidden contributors or generate ownership for later 2D composite layers. Use a screen rectangle or a named graph mask for those layers. Atlas surfaces also carry precise graph depth; a world-volume mask scopes a textured monitor without claiming it is a named splat object. This is a screen-space system, not volumetric transport.

### Resolution and allocation budgets

Each new effect and optional `history`/`feedback` budget accepts:

- `scale` in `(0,1]`, default 1.
- `maxPixels`, default 65,536 for glow/blocks/sort and 1,048,576 for outline/chromatic. The aspect-preserving working size is limited by both scale and this cap.
- `maxSamples` (1–64), default 24. Limits glow taps and sort span. Outline uses eight directional taps (or fewer if budgeted).
- `filter:'linear'|'nearest'`, controlling work reconstruction. Blocks/sort default nearest; others linear. Reconstruction rejects incompatible full-resolution depth/object neighborhoods.

`K.renderGraph.resources(plan,w,h)` reports each pass's actual working size, samples, and conservative work units; peak simultaneously-live image/work pixels; and retained-history demand. `transientBytes` estimates RGBA8 graph image/packet storage; `historyBytes` includes double buffering. These are graph working-set estimates, excluding scene renderer buffers, ownership/selector textures, driver overhead, and cached high-water allocations. They are not GPU time predictions.

The graph's `budget` can cap `maxTransientPixels` (default 67,108,864), `maxHistoryPixels` (8,388,608), and `maxWork` (268,435,456). Plans over these limits fail before graph target allocation; the software render entry also validates before rendering the scene. Dead branches cost nothing. No silent removal of requested passes occurs. Inspect the same plan from the CLI:

```sh
ink-studio render-graph graph.json --w 1280 --h 720 --out budget.json
```

Existing feedback keeps its warp, threshold, half-life, camera policies, and deterministic replay. Adding `budget` reduces **retained signal** resolution while keeping final output crisp. `displayMask:true` clips retained trails by the current combined object/mask/depth scope; default false lets trails advect away. Editing a retained signal's working dimensions clears that signal; repeated timestamps, rewind, cuts, and camera resets retain their existing semantics. Radius/intensity, block probability/rate/offset, and chromatic offsets are available through presentation timeline channels.
