# Native hero rendering

The headless renderer can use the retained sculpt for opaque silhouette, openings, normals and depth on the native art grid. The sculpt's paint splats still provide pigment and detail. Use this on a foreground prop or a tagged puppet whose visible sculpt primitives share the same bone transform within each part.

```sh
node cli/ink-studio.js render examples/hero-render/warden-relay.js \
  --w 176 --h 136 --px 1 --sdf-assist posed --out warden.png
```

Set `S.keepRenderSdf = true` before the sculpt bake and `look.sdfAssist = { posed: true }` on its world. The current bone table, including camera-specific pose corrections, moves the retained fields and their subtractors. Tag a hidden subtractor with the same tag as the part it cuts. For primitives whose rows have different skin weights or separate corrective bones, the renderer uses the original splat path. Transparent, emitting and unsupported moving materials also use their original path. Use `rules` to limit tracing to selected objects, materials or world-space regions. [SDF assist settings](sdf-assist.md)

[Pixel boundaries across a shot](pixel-boundaries.md) carry the posed surface evidence into a shared native-grid decision across frames.

## Bake traced fill

```sh
node cli/ink-studio.js traced-lighting examples/hero-render/warden-relay.js \
  --plan light-plan.json --t 0.8 --yaw -0.29 --samples 96 --out fill.json
node cli/ink-studio.js render examples/hero-render/warden-relay.js \
  --w 176 --h 136 --px 1 --sdf-assist posed --traced-lighting fill.json --out warden-lit.png
```

A traced lighting plan is optional. Its fields are `posed`, `select` (a target selector or an array of alternatives), `samples`, `bounces`, `spacing` (in scene units) and `seed`. For the example, use `{"posed":true,"select":[{"object":"head"},{"object":"chest"},{"object":"staff"}]}`.

The baker uses the [SDF reference transport](sdf-reference.md) to trace scene-bounced RGB radiance at opaque receiver samples. Geometry shadowing, tinted materials, emitters and transmission can contribute on the secondary path. The asset attaches the result to scene rows at the sampled pose and lighting state. The renderer adds it in linear light before resolving the authored ramps, with live control of the key, shadows and exposure. Changes to the bounce sources or arrangement may call for another bake. Use `{ asset, strength: 0.65 }` as the Node `tracedLighting` option or `look.tracedLighting` to scale the contribution. A file supplied to the CLI can also contain this wrapper.

## Fit the pigment splats across views

```sh
node cli/ink-studio.js splat-fit examples/hero-render/warden-relay.js \
  --plan approvals.json --fragment-budget 1500000 --out fit.json
node cli/ink-studio.js render examples/hero-render/warden-relay.js \
  --w 176 --h 136 --px 1 --splat-fit fit.json --out warden-fitted.png
```

Each reference is an approved native-grid PNG. Its alpha is the desired coverage, and its RGB supplies color targets where the optional mask is white. Gray reduces the weight. If the reference alpha describes specific objects within a complete shot, list their IDs in `objects` (up to eight) to compare the same rendered mattes. Without `objects`, alpha describes the entire transparent frame. Paths are relative to the plan.

```json
{
  "width": 176,
  "height": 136,
  "objects": ["head", "chest", "hand-L", "hand-R", "staff"],
  "select": [{"object": "head"}, {"object": "staff"}],
  "rounds": 4,
  "prune": 0.08,
  "views": [
    {"time": 0, "camera": {"yaw": -0.43}, "reference": "a.png", "mask": "a-mask.png"},
    {"time": 0.8, "camera": {"yaw": -0.29}, "reference": "b.png"},
    {"time": 1.2, "camera": {"yaw": -0.12}, "reference": "check.png", "holdout": true}
  ]
}
```

The solver compares real native renders. It proposes footprint changes around boundaries, gaps and protected details, scores them across the fitting views, and tries omitting rows with low impact. Holdout views serve as acceptance checks. The JSON includes per-view coverage and protected-color errors, the number of modified and omitted splats, and the source bake signature. Keep the asset with the scene and seed that produced it. The edits preserve row identities and can be bypassed with `--splat-fit off`. Use `--sdf-assist posed` to use solid geometry and the fitted pigment together.

Use [independent pigment and coverage edits](pixel-art-authoring.md#edit-splat-pigment-and-coverage-independently)
to make targeted changes after a fit.

### Fit the edge and interior independently

Set `search` in the plan to enable the channel-based fitter. The edge pass
tries coverage, footprint shape, and rotation changes around boundaries and
outside pixels. The interior pass tries geometry changes and samples pigment
from the visible interior. Each trial renders the whole native grid to
account for depth, occlusion and compositing.

```json
{
  "width": 148,
  "height": 136,
  "rounds": 4,
  "prune": 0,
  "select": [{"object": "shield"}],
  "pins": [{"object": "shield", "part": "emblem"}],
  "search": {
    "footprints": ["square", "wedge", "circle"],
    "rotations": [0, 0.7853981633974483, -0.7853981633974483],
    "swatches": [4156517, 14001238],
    "trials": 72
  },
  "views": [
    {
      "time": 0, "camera": {"yaw": -0.28},
      "reference": "front/approved.png", "depth": "front/depth.f32le",
      "normal": "front/normal.png", "pigment": "front/pigment.png",
      "pins": "front/pins.png"
    },
    {
      "time": 1.18, "camera": {"yaw": 0.34}, "holdout": true,
      "reference": "orbit/approved.png", "depth": "orbit/depth.f32le",
      "normal": "orbit/normal.png", "pigment": "orbit/pigment.png"
    }
  ]
}
```

- **Approvals.** Supply the native RGBA coverage plate as `reference`.
  Keep the camera, pose, and render settings aligned with the approved
  channels. `depth` is top-down little-endian Float32 camera-axis depth
  with positive infinity for empty pixels. `normal` is a signed world
  XYZ RGB PNG. `pigment` is an RGBA PNG of source pigment before lighting,
  with transparent pixels where a sample is unavailable. The three
  maps are optional. Generate native examples with
  `passes --channels opaque-surface,normal,pigment --px1`. Node callers
  can pass the corresponding native typed arrays directly.
- **Pins.** Top-level `pins` use normal target selectors and remove
  matching rows from the search. Approve editable pixels with the
  existing `mask` weight, or freeze the baseline appearance and sampled
  geometry under white pixels in each view's `pins` PNG. A training
  candidate that changes a pinned sample is rejected. The report lists
  pin changes in validation views separately.
- **Search.** `footprints` accepts names and ordinary footprint definitions.
  Include `false` to try Gaussian coverage on a splat without retained
  plane depth. `rotations` are offsets in radians. `swatches` optionally
  limits proposed pigment to RGB24 colors, otherwise the fitter proposes
  a color from the visible approved samples of that row. Set
  `search.pigment` to `false` to disable repainting. `trials` bounds the
  candidate renders and `maxRows` bounds the ranked rows per search phase.
- **Review.** The receipt reports edge and interior loss, silhouette,
  depth, normal and pigment errors with sample counts, and the number of
  pinned pixels that changed. Use `search.weights` to tune `silhouette`,
  `interior`, `depth`, `normal`, `pigment` or `protected`.
  `search.depthTolerance` is the distance in scene units for a full
  depth error. Validate different angles or poses with `holdout: true`.
  These views render only before and after the fit. They have no
  influence on candidate selection. Check `report.validation.passed`
  before adopting a fit.

The asset uses the existing headless `--splat-fit` path. Its optional
`attributes` table carries the resulting footprint definitions and RGB24
pigment changes. Scale-only assets and stable-ID pixel-editor assets can
still be applied. The fitted sample changes base pigment. Material shader
settings and the light are authored independently.

The **Mothglass Seal** example writes two fitting views, one held-out
angle and pose, a reusable fit, and a before/fitted/approved orbit. It uses
authored native splat renders as its approval plates.

```sh
node examples/hero-render/fit-seal.js mothglass-fit
node cli/ink-studio.js splat-fit examples/hero-render/fit-seal.js --raw \
  --plan mothglass-fit/approvals.json --out mothglass-fit/cli-fit.json
```

## Reproduce the Warden comparison

```sh
node examples/hero-render/review.js warden-review
```

The example builds native target plates, bakes the bounced fill, solves the splat fit, and writes the original, surface-only, fit-only and combined frames. The pose-dependent grip keeps the staff in the hand as the camera moves. The sample targets come from the staged scene.
