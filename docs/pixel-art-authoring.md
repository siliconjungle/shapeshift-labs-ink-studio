# Native pixel-art authoring

An Ink pixel-art design is an editable stack of drawings on a fixed integer
grid. Use it for an AI agent's first draft, an artist's correction, or an exact
pixel asset in an Ink scene. The CLI exports an indexed PNG, a native-grid
review and a stamp that works in the existing material, mask and scene paths.

```sh
node cli/ink-studio.js pixel-art draw examples/pixel-art-tooling/relay.json --out draft
node cli/ink-studio.js pixel-art inspect examples/pixel-art-tooling/relay.json --at 13,22
node cli/ink-studio.js pixel-art edit examples/pixel-art-tooling/relay.json \
  examples/pixel-art-tooling/relay-cleanup.json --out revised.json
node cli/ink-studio.js pixel-art draw revised.json --out revised
node cli/ink-studio.js render examples/pixel-art-tooling/relay-stage.js \
  --w 160 --h 94 --px 1 --px1 --out relay-in-ink.png
```

## Author a drawing

```json
{
  "format": "ink-studio/pixel-art",
  "version": 1,
  "width": 16,
  "height": 12,
  "palette": { "ink": "#161822", "body": "#436477", "rim": "#8caeb0", "glint": "#ffdfa6" },
  "layers": [
    {
      "id": "silhouette",
      "marks": [
        {"swatch":"ink","shape":{"type":"polygon","points":[[1,7],[4,3],[12,2],[15,5],[14,10],[3,11]]}}
      ]
    },
    {
      "id": "light-mass",
      "clip": "silhouette",
      "marks": [
        {"swatch":"body","shape":{"type":"rect","rect":[3,4,11,5]}},
        {"swatch":"rim","steps":{"from":[4,5],"axis":"x","direction":[1,-1],"lengths":[2,3,3]}}
      ]
    },
    {
      "id": "light-pin",
      "clip": "silhouette",
      "protect": true,
      "marks": [{"swatch":"glint","at":[9,6]}]
    }
  ]
}
```

This version 1 design has one implicit frame and square pixels. Its JSON and
existing revision-guarded patches remain compatible with the CLI.

The order is bottom to top. Use `clip` to limit a layer to positive marks
of an earlier layer, such as a lit plane inside its silhouette. `swatch: null`
cuts a transparent hole. Protect a layer's marks to keep focal accents,
narrow gaps and authored details through later edits. Attempts to change
protected pixels fail at their native coordinates.

Top-left coordinates start at zero. A mark can fill a rectangle, polygon or
path using the existing hard-edge stamp rasterizer. Use `at` for exact pixels.
Use `steps` to draw an explicit staircase. Pick a major axis and an X/Y sign,
then specify each run length. Consecutive runs move one cell along the minor
axis and meet diagonally without an extra pixel at the corner.

## Author a version 2 document

Version 2 keeps canvas size, pixel aspect, palette, and the layer stack at the
document level. Each frame holds its own cels and duration.

```json
{
  "format": "ink-studio/pixel-art",
  "version": 2,
  "width": 4,
  "height": 3,
  "pixelAspect": [2, 1],
  "palette": { "ink": "#161822", "glint": "#ffdfa6" },
  "layers": [{ "id": "body" }, { "id": "light", "clip": "body" }],
  "frames": [
    {
      "id": "idle", "durationMs": 120,
      "cels": { "body": { "marks": [{ "swatch": "ink", "at": [1, 1] }] } }
    },
    {
      "id": "flash", "durationMs": 60,
      "cels": {
        "body": { "marks": [{ "swatch": "ink", "at": [1, 1] }] },
        "light": { "marks": [{ "swatch": "glint", "at": [1, 1] }] }
      }
    }
  ],
  "selections": [{ "id": "light-area", "pixels": [[1, 1], [2, 1]] }],
  "protectedDetails": [{ "id": "light-pin", "frame": "flash", "pixels": [[1, 1]] }],
  "sceneBindings": [{
    "id": "light-source", "scene": "relay-stage", "object": "relay",
    "part": "lamp", "frame": "flash", "layer": "light"
  }]
}
```

- `width` and `height` are the native art dimensions (1–512 each).
  `pixelAspect` stores the width-to-height ratio of one pixel as two positive
  integers. Draw exports keep the native pixel dimensions.
- `palette` maps 1–255 stable swatch IDs to six-digit RGB colors, or to
  `{ "color": "#rrggbb", "label": "Display label" }` records. Layers are ordered
  bottom to top, with optional `clip` and `protect` as in version 1. A cel is
  keyed by its layer ID and holds `marks` and optional `slots`. It is blank
  when omitted from a frame. Frame order is the order of the array and
  `durationMs` is a positive integer. Layers, frames, and cels can also have
  a separate display `label`.
- `selections` and `protectedDetails` are optional arrays of named coordinate
  sets. Each list uses unique in-bounds `[x, y]` coordinates. Omit `frame` to
  apply the set across all frames. Selections are saved for reuse. Protected
  details lock the final visible cell for guarded edits, including transparent
  gaps. A protected layer still locks its marks during compositing.
- `sceneBindings` optionally records a `scene` and `object` with an optional
  `part`, source `revision`, and `frame` or `layer` scope. Drawing and editing
  the pixel document operate on the stored art. Named destinations use
  these bindings to target a scene object or part.
- Frame, layer, swatch, selection, protected detail, and binding IDs start
  with a lowercase ASCII letter and contain at most 64 lowercase letters,
  digits, or hyphens. IDs are unique within their own lists. References to
  frames and layers must use existing IDs. An optional cel `id` is unique
  across the document. Without an explicit ID, the cel uses `frame/layer`.
  To move a cel to a different frame or layer while keeping its identity, give
  it an explicit ID before the move. An existing `frame/layer` ID can also be
  saved explicitly.

```sh
node cli/ink-studio.js pixel-art validate document.json
node cli/ink-studio.js pixel-art inspect document.json --frame flash --at 1,1
node cli/ink-studio.js pixel-art draw document.json --frame flash --out flash
```

`validate` checks document references, compiles every frame, and lists layer,
swatch, and cel IDs. `draw` and
`inspect` use the first frame by default. Their reports include the selected
frame ID, duration, and pixel aspect. Pixel inspection also reports the cel
ID when a pixel belongs to one.

## Start from a scene

Capture a named visible object at the target art dimensions. Ink keeps its
native coordinates and exact colors in a layer called `projection`. The
saved design is a useful underdrawing for reshaping silhouettes, drawing new
shadow clusters and placing deliberate details at that view.

```sh
node cli/ink-studio.js pixel-art trace examples/sdf-gatehouse.js \
  --subject gatehouse --w 116 --h 74 --out gatehouse-study
```

Trace writes a version 2 `design.json` alongside the indexed PNG and review.
The document records the input scene and subject in a binding scoped to its
`capture` frame and `projection` layer. A raster cel's `slots` list uses named
swatches and `null` for transparent cells.
These cells are left untouched by that layer. Use a mark with a null swatch when
you want to erase earlier artwork. A trace preserves only the part visible
at capture time. If an object exceeds 255 displayed colors, select a
suitable palette in the source view before tracing.

## Inspect, revise and reuse

`report.json` gives swatch use and coordinates for orphan pixels, doubles,
irregular steps and banding. Findings name the visible drawing layer and
swatch and the drawing directly underneath. The report includes up to 128
coordinates per category. The overlay highlights every editable finding. Protected marks are
counted separately from editable findings. The top-level `metrics` retain
the critic's raw values. These checks flag candidates for inspection. A
single pixel can be exactly right for an eye, glint, texture or animation beat.

A repair is a new layer. Its JSON contains the observed `revision`, a new
layer `id`, and `edits` with `at`, `layer`, `from`, and `to`. A pixel
address is valid only for its expected layer and swatch. Both names can be
`null` for an untouched transparent cell, and `to: null` erases a cell.
Reinspect stale targets before editing. The source design and previous
layers remain available for comparison.

For version 2, the patch also requires the observed `frame` ID. The CLI uses
that frame by default and checks that it matches `--frame` if supplied. The
repair creates a cel in the chosen frame alone. The revision covers the whole
document, including its saved selections, protected details, and scene
bindings.

To edit an existing cel instead, set the patch's `cel` to its ID. Supply the
expected layer and swatch in each pixel edit. The CLI finds the cel's frame,
or checks it against the frame you supply. Ink appends the marks to that cel
and checks that the changes are visible on its layer. Display labels never
serve as edit keys.

## Choose an edit destination

Add an optional `destinations` array to a version 2 document. The raster
destination is always available as `raster`. Scene destinations name entries
in `sceneBindings`. A frame-scoped binding can only be used from that frame.
For example, given a binding called `gate`:

```json
[
  { "id": "touch-up", "kind": "raster" },
  { "id": "shot-paint", "kind": "shot-correction", "binding": "gate" },
  { "id": "patina", "kind": "surface-channel", "binding": "gate", "chart": "front", "channel": "wear" },
  { "id": "edge-splats", "kind": "splat-attributes", "binding": "gate" },
  { "id": "carve", "kind": "sdf-shape", "binding": "gate" },
  { "id": "stone", "kind": "sdf-material", "binding": "gate" }
]
```

Run `pixel-art validate document.json` for the document revision, frame IDs
and declared destinations. The edit JSON has `revision`, `frame`, `id`, and
`destination`. Its remaining fields depend on the destination.

| Kind | Edit fields | Output |
| --- | --- | --- |
| `raster` | `edits` with `at`, `layer`, `from`, and `to` | Revised pixel document, with the new cel on the chosen frame |
| `shot-correction` | Guarded RGB `edits` and `operation` containing `at`, `anchor`, `fps`, and an inclusive `frames` range | Native shot-correction file for `render --shot-corrections` |
| `surface-channel` | `operation.stamp` with a rest-UV brush and value or clear mode | Revised JSON diorama with a stamp appended to the chart |
| `splat-attributes` | `operation.splats` with a stable splat ID or legacy source row and either `footprintScale` or `visible` per splat | Splat-fit asset for `render --splat-fit` |
| `sdf-shape` | `operation.parameters`, a new `operation.modifier`, or `operation.updateModifier` with `id` and `patch` | Revised JSON diorama with edited geometry |
| `sdf-material` | `operation.material` with a palette role or native material object | Revised JSON diorama with the solid's material changed |

Omitting `destination` continues to edit raster pixels. Scene writes take
an explicit `--scene` matching the binding and save their own output file.
The surface and SDF routes use a plain JSON diorama and a named authored
solid. Keep relative scene resources beside the revised diorama.

```sh
node cli/ink-studio.js pixel-art edit document.json cut.json \
  --scene gate.json --out gate-cut.json
node cli/ink-studio.js render gate-cut.json --out gate-cut.png
```

For a cut, use an operation such as
`{"modifier":{"kind":"mask","mode":"cut","shape":{"kind":"box","at":[0,1,0],"half":[0.2,0.3,0.5]}}}`.
The modifier keeps the edit ID. A surface-channel edit can use
`{"stamp":{"value":0.6,"brush":{"kind":"rect","min":[0.2,0.1],"max":[0.7,0.4]}}}`
on a destination bound to `wear`. See the [scene editor](scene-editor.md)
and [rest surface charts](deformation-materials.md) for native parameters.

On a splat destination, `{"splats":[{"splat":12,"footprintScale":0.7},{"splat":26,"visible":false}]}`
scales one eligible opaque splat's footprint and hides another. The splat
asset for numeric rows checks the original bake at render time. Use stable
IDs to carry the edit across row reordering:

```sh
node cli/ink-studio.js pixel-art targets document.json \
  --destination edge-splats --scene gate.json --limit 12
```

`targets` reports stable splat IDs and rest positions for the bound object or
part. Copy the reported `id` into `operation.splats[].splat`. A fit with
stable targets resolves those IDs at render time and rejects missing or
ambiguous matches. Older fits that use row numbers remain tied to their bake.

Authors can assign a persistent ID with `{ splatId: "gate-hinge-chip" }` in
the final options argument to `builder.iso`, `builder.disc`, or
`builder.dab`. Existing `world.splatIds` also work. For a generated sample on
a named object, Ink can derive an ID from the owner, part, and exact rest
position. If resampling moves or retires the sample, inspect the new source
before targeting it again. Coincident samples with an ambiguous derived ID
need authored IDs for individual edits.

For a shot correction, pass the
native anchor's `splat`, optional `offset` and `depthOffset`, and the grid
coordinate where it was pinned as `operation.at`. A host can obtain the pin
with `captureShotCorrectionSurface` and `shotCorrectionSurface.pin(x, y)`.
The correction uses offsets from that pixel and the renderer still checks
ownership and depth when it draws. The shot operation also accepts
`startTime` and `depthTolerance`.

For a scene-source destination, `targets` reports the solid ID, part ID,
modifier IDs, and the surface channel if one is bound. Part IDs are the
keys under `parts`. A channel is addressed by solid ID, chart ID and channel
ID, for example `gate/front/wear`. To toggle a cut after reordering the
modifier stack, use `{"updateModifier":{"id":"vent","patch":{"enabled":false}}}`.

An optional binding `revision` pins the scene to its file SHA-256 for
surface and SDF destinations, or its packed rest-row signature for shot
and splat destinations. The 3D routes take explicit UVs, splat IDs or rows,
and shape coordinates. A raster edit remains in the document unless an edit
explicitly targets one of the scene destinations.

Use the generated `stamp.json` for a [placed stamp, indexed material
projection, or drawing mask](pixel-stamps.md). The relay mounts the
cleaned drawing on a 3D stand using the normal depth-aware pixel stamp path.
The native stage is a static drawing. Directional cels and animation can
use the stamp system's existing frames and placements.

See [the pixel-art craft research map](pixel-art-craft.md) for the decisions
this workflow encodes and the next areas to implement.
