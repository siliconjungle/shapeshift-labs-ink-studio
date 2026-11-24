# Native pixel-art authoring

An Ink pixel-art design is an editable stack of drawings on a fixed integer
grid. Use it for an AI agent's first draft, an artist's correction, or an exact
pixel asset in an Ink scene. The CLI exports an indexed PNG, a native-grid
review and a stamp that works in the existing material, mask and scene paths.

```sh
node cli/ink-studio.js pixel-art draw examples/pixel-art-tooling/relay.json --out draft
node cli/ink-studio.js pixel-art canvas examples/pixel-art-tooling/relay.json --out relay-canvas.html
node cli/ink-studio.js pixel-art inspect examples/pixel-art-tooling/relay.json --at 13,22
node cli/ink-studio.js pixel-art edit examples/pixel-art-tooling/relay.json \
  examples/pixel-art-tooling/relay-cleanup.json --out revised.json
node cli/ink-studio.js pixel-art draw revised.json --out revised
node cli/ink-studio.js render examples/pixel-art-tooling/relay-stage.js \
  --w 160 --h 94 --px 1 --px1 --out relay-in-ink.png
```

Open the generated HTML to inspect the document offline. The canvas has
integer zoom, pan, an optional grid, cursor coordinates, and a synchronized
1× view. Version 2 documents include a frame picker when they have several
frames. Use `--frame <id>` to export a single frame. The HTML is a review
artifact. Use the pixel editor API for document edits or the
[Pixel Stamp Workshop](pixel-stamps.md) to draw and resize exported stamps.

## Register frames and align texture pixels

Version 2 documents can carry a top-level `guides` list. Guide IDs are
stable. A guide with `frame` applies to that frame. A guide without
`frame` applies to every frame.

```json
[
  { "id": "tile", "kind": "grid", "at": [2, 3], "step": [8, 6] },
  { "id": "center", "kind": "axis", "axis": "x", "at": 12.5 },
  { "id": "stance", "kind": "pivot", "at": [12.5, 20] },
  { "id": "step-contact", "kind": "registration", "at": [15, 20], "frame": "step" }
]
```

Coordinates start at the upper left. An `"x"` axis is a vertical line at a
fixed column, and a `"y"` axis is horizontal. Axes, pivots, and registration
points accept whole and half pixels. A grid repeats from its integer origin
with an independent step on each axis. Its lines mark the leading edges of
tile cells. Point markers and axes use pixel centers. Guides can extend
beyond the canvas. Snap targets are limited to points on the editable grid.
The 1× preview and rendered artwork stay free of overlays.

```sh
node cli/ink-studio.js pixel-art snap document.json --frame step --at 14.6,19.8 --radius 1
node cli/ink-studio.js pixel-art session snap gate-session --frame step --at 14.6,19.8
```

The SDK equivalent is `pixels.snap([14.6, 19.8], { frame: 'step', radius: 1 })`.
The report gives the precise `position`, raster coordinate `at`, and the IDs
that won in `hits`. Within the radius, the nearest pivot or registration
point takes precedence. Otherwise each axis snaps independently. A fixed
axis wins a distance tie with a grid line, followed by guide ID and lower
coordinate. A half-pixel raster result rounds toward the larger coordinate.
Use `at` and the reported document revision when preparing the pixel patch.

Edit guides with the `guides` destination. An upsert creates a guide or
replaces the guide with the same ID. Removal takes guide IDs. These edits
use the same preview, edit receipt, undo, and recovery paths as pixel edits.

```json
{
  "id": "align-contact",
  "revision": "<current document revision>",
  "destination": "guides",
  "operation": {
    "upsert": [{ "id": "step-contact", "kind": "registration", "at": [14, 20], "frame": "step" }],
    "remove": ["obsolete-contact"]
  }
}
```

The offline canvas shows the active guides as you switch frames. Toggle
**Guides** to hide the overlays and **Snap** to enable pointer snapping.
The cursor readout names a guide when it catches the pointer. Exporting a
stamp copies the selected frame's active guides so it keeps its alignment
references in the Workshop and other stamp tooling.

## Paint and sample pixels

The Workshop has a one-pixel pencil, eraser, eyedropper, and connected
fill for stamp frames. For layered pixel documents, use a raster tool
operation through `pixel-art edit`, `pixel-art session apply`, or
`pixels.apply(patch)`. The patch uses the current document revision.

```json
{
  "id": "fill-the-jacket",
  "revision": "<current document revision>",
  "frame": "front",
  "operation": { "layer": "jacket", "tool": "fill", "at": [20, 14], "swatch": "indigo" }
}
```

Use `cel` on the patch to target an existing cel by ID. Alternatively,
`operation.layer` addresses a layer by ID and creates a cel in the
selected frame when needed. Pencil uses `tool: "pencil"`, a `swatch`,
and an ordered `points` path of native coordinates. Eraser uses
`tool: "eraser"` and `points`. Erasing clears the active layer and reveals
whatever is below it. Fill uses four-way connectivity and exact swatch
identity in the active layer. Protection and clipping stop a fill, and
invalidate a pencil or eraser path that touches them. Preview and receipts
report the changed source pixels even when an upper layer covers them.

Set `pixelPerfect: true` in a pencil operation to clean the freehand path
as it is rasterized. When two one-pixel steps turn a right angle, Ink
omits the middle pixel and joins the neighbors diagonally. Straight lines,
diagonal runs, taps, and stroke endpoints retain their pixels. Cleanup
only filters the current stroke. Use the ordinary pencil operation for an
exact square elbow.

```sh
node cli/ink-studio.js pixel-art sample document.json --frame front --at 20,14
node cli/ink-studio.js pixel-art sample document.json --frame front --at 20,14 --mode layer --layer jacket
node cli/ink-studio.js pixel-art sample document.json --frame front --at 20,14 \
  --mode source --destination patina --scene gate.json
```

The SDK equivalent is `pixels.sample([20, 14], options)`. The visible
composite reports its owning layer and swatch. Layer sampling reads the
selected layer or cel, including paint hidden by upper layers, and flags
clipping and explicit knockouts. Source sampling reads the selected
`surface-channel` destination. The document's top-left art grid maps
pixel centers to the whole rest-UV chart. Pass `--uv u,v` or SDK
`uv: [u, v]` to sample the chart directly. The result includes the source
revision and either a scalar with its units where defined or a color with
coverage. Sample again after changing the bound source.

In an offline canvas review, choose **Eyedropper** and pick the visible
composite or a layer. Export with `--destination patina --scene gate.json`
to include a snapshot of a bound material channel for the source mode.
Painting to a layered pixel document goes through the CLI or SDK.

## Draw precise shapes

Set `tool: "shape"` in a raster operation and supply the geometry in
`operation.shape`. Choose the layer or cel and swatch as you would for
the pencil. Shape edits use the same preview, revision guards, receipts,
and undo history. A shape that touches protected pixels or crosses the
active layer's clipping mask is rejected as a whole.

```json
{
  "id": "window-frame",
  "revision": "<current document revision>",
  "frame": "front",
  "operation": {
    "tool": "shape",
    "layer": "jacket",
    "swatch": "indigo",
    "shape": { "type": "rect", "rect": [20, 14, 9, 6], "fill": false, "width": 1 }
  }
}
```

| Shape | Geometry |
| --- | --- |
| `line` | `from` and `to` are inclusive pixel coordinates. Optional `width` defaults to one pixel. |
| `curve` | `points` contains start, control, and end for a quadratic Bézier, or start, two controls, and end for a cubic. Optional `width` defaults to one pixel. |
| `rect` or `ellipse` | `rect` is `[x, y, width, height]` in art pixels. Set `fill: false` for an inward outline and use `width` for its thickness. |
| `polygon` | `points` contains at least three vertices in order. Ink closes the polygon. Set `fill: false` for an outline and use `width` for its thickness. |
| `text` | Supply `at` for the top-left anchor and `text` for the lettering. Optional bitmap settings include integer `scale`, `tracking`, `leading`, `align`, and `columns`. |
| `staircase` | Supply `from`, `axis` (`"x"` or `"y"`), `direction` as two signs, and ordered run `lengths`. Consecutive runs meet diagonally. |

The receipt keeps the exact shape arguments and the resolved pixel runs.
For reusable staircases in authored layers, the existing `steps` mark
accepts the same start, axis, direction, and lengths.

## Capture and reuse a pixel brush

Capture a named selection or a rectangle from a drawing. The brush keeps
the selected pixels' exact shape and colors. It leaves the artwork under
unselected and transparent cells untouched.

```sh
node cli/ink-studio.js pixel-art brush document.json --selection badge --frame front \
  --anchor 0,1 --angle 90 --size 12,8 --out badge-brush.json
node cli/ink-studio.js pixel-art brush document.json --rect 20,14,6,4 --layer jacket \
  --tint indigo --out jacket-brush.json
```

Capture looks at the visible composite by default. Use `--layer` or
`--cel` for the pixels on an individual layer. For an open working
session, use `pixel-art session brush <directory>` with the same flags.
The SDK accepts `pixels.captureBrush({ selection, anchor, settings })` or
can take a native `rect` or explicit `pixels` instead of a selection ID.

The versioned brush JSON stores a compact indexed shape and its palette.
Its anchor is local to the captured shape, starting at its top-left pixel.
The size describes its dimensions before rotation, and positive angles
turn clockwise about the anchor. Brush transformations use nearest-neighbor
sampling on the native grid. The saved swatch mode keeps captured colors or
applies one tint.

Embed the saved brush JSON in `operation.brush` with `tool: "brush"` in a
raster patch. Use `at: [x, y]` for a dab or `points` for a stroke. The
placement coordinate is where the anchor lands. Ink adds any missing brush
colors to the target palette as part of the same undo step. Supply a target
`swatch` ID on the operation to override the saved colors. Preview and
receipts retain the placement, affected pixels, and palette additions.

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

## Open existing artwork in the editor

Pass a parsed document or JSON text to the Node package's
`createPixelEditor(source)`. A version 1 drawing opens as a version 2
document with square pixels and one 100 ms frame named `artwork`. Each
original layer keeps its ID, position in the stack, clipping link, and
protection. Its cel, named `artwork/<layer-id>`, keeps the original marks
and indexed slots. Staircase runs remain editable as `steps`. Extra fields
from the original document are retained as `legacyMetadata`.

```js
const fs = require('node:fs');
const { createPixelEditor } = require('.');
const editor = createPixelEditor(fs.readFileSync('examples/pixel-art-tooling/relay.json', 'utf8'));
const pixel = editor.inspect([13, 22], { cel: 'artwork/freckles' });
editor.apply({
  revision: pixel.revision,
  id: 'fix-freckle',
  cel: pixel.cel,
  edits: [{ at: pixel.at, layer: pixel.layer, from: pixel.swatch, to: pixel.underneath.swatch }]
});
fs.writeFileSync('relay-edited.json', editor.serialize());
```

`describe()` lists the document revision and stable IDs. `snapshot()` returns
a copy of the editable document, and `stamp({ frame, cel })` exports the
chosen frame as an indexed stamp. `inspect` reports the visible owner of a
pixel. Passing a cel ID selects the frame containing that cel.
`apply(patch)` uses the same guarded edits as the CLI. The original revision
can still be used by a legacy patch when the version 1 source is freshly
opened. After a successful edit, inspect the current revision before applying
another patch.

The CLI can also save the upgraded document.

```sh
node cli/ink-studio.js pixel-art upgrade examples/pixel-art-tooling/relay.json --out relay-v2.json
node cli/ink-studio.js pixel-art validate relay-v2.json
```

The existing `pixel-art edit` command also accepts version 1 documents and
their revision-guarded patches directly.

## Undo pixel and scene edits together

Attach the live scene editor when opening a pixel document. The editors then
share one undo history. Use `transact(label, edit)` to commit a synchronous
gesture, or use `begin`, `preview`, `commit`, and `cancel` for a gesture
that spans multiple calls. The scene editor's history limit applies to the
shared session. A standalone pixel editor also has undo and redo.

```js
const { createPixelEditor, createSceneEditor } = require('.');
const scene = createSceneEditor(sceneSource);
const pixels = createPixelEditor(pixelDocument, { sceneEditor: scene });

pixels.transact('Paint the highlight and change the gate material', () => {
  const pixel = pixels.inspect([20, 16], { frame: 'front' });
  pixels.apply({
    id: 'gate-highlight',
    revision: pixel.revision,
    frame: pixel.frame,
    edits: [{ at: pixel.at, layer: pixel.layer, from: pixel.swatch, to: 'amber' }]
  });
  scene.setMaterial('accent', 'solid:gate');
});

pixels.undo();
scene.redo();
```

Native calls on the attached editor and bound surface, SDF shape, and SDF
material patches can take part in the same gesture. If `apply`, `preview`,
`commit`, or the `transact` callback throws, both drafts are rolled back.
Call undo or redo from either editor to restore the matching scene and pixel
document.

By default the attached diorama's ID matches `sceneBindings[].scene`. Pass
`sceneRef` alongside `sceneEditor` if your bindings use a file path or
another reference. A pinned binding on a live diorama uses the SHA-256 of its
current JSON snapshot. Hosts with a file-backed revision can supply their
existing `scene(binding)` adapter to `apply` and return the attached editor
with that revision.

Shot corrections and splat fits made through the pixel editor share the
same history. Pass `pixels.renderOptions()` along with your normal view
settings when rendering the attached scene. Undo restores the previous
sidecars, and redo restores the revised ones. Use `renderOptions(sceneRef)`
to retrieve options by source reference when the editor is standalone.

## Reopen a working session

Give the editor a `sessionDirectory` to keep committed undo and redo history,
scene bindings, render sidecars, receipts, and the active draft on disk. Open
that directory after a restart to recover the working state and the attached
scene editor. The original pixel document and authored scene JSON are retained
in the session. Linked assets and prefabs stay external. Reopen with the same
dependency data in `env`, or supply a fresh editor for the original scene
through `sceneEditor`. Ink checks the retained dependency revision on open.

```js
const { createPixelEditor, createSceneEditor, openPixelEditorSession } = require('.');
const pixels = createPixelEditor(pixelDocument, {
  sceneEditor: createSceneEditor(sceneSource),
  sceneRef: 'gate.json',
  sessionDirectory: 'gate-session'
});
pixels.begin('Retouch the gate');
pixels.apply(patch);

// In a new process
const resumed = openPixelEditorSession('gate-session');
if (resumed.sessionStatus().pending) {
  const report = resumed.previewChanges();
  if (report.valid) resumed.commit();
}
const scene = resumed.sceneEditor;
```

The editor saves after each finished operation. Within a synchronous
`transact` callback it saves the complete transaction together. Use
`begin` and separate `apply` calls to keep each completed step recoverable
before a gesture commits. Resume a draft with more edits, or cancel it to
restore its prior state and redo history. The history limit still applies.
`sessionStatus()` reports a storage error if a checkpoint could not be
published. Edits stay in memory and `flushSession()` retries the write.
A stale editor cannot replace a newer checkpoint.

The CLI can manage the same session across commands.

```sh
node cli/ink-studio.js pixel-art session init gate-session document.json --scene gate.json
node cli/ink-studio.js pixel-art session begin gate-session --label 'Retouch the gate'
node cli/ink-studio.js pixel-art session apply gate-session patch.json
node cli/ink-studio.js pixel-art session status gate-session
node cli/ink-studio.js pixel-art session preview gate-session
node cli/ink-studio.js pixel-art session commit gate-session
node cli/ink-studio.js pixel-art session export gate-session --artifact scene --out revised-gate.json
```

Use `inspect --at x,y` or `targets --destination id` to read current
revisions while preparing a patch. `undo`, `redo`, and `cancel` update the
stored state. Export the pixel document with `--artifact document` or choose
`scene`, `shot-corrections`, or `splat-fit` for the retained native artifact.
Keep the entire session directory when copying a working session.

## Preview before committing

Use `pixels.previewEdit(patch)` to check a proposed patch against the working
document. It returns a report without staging the patch. An already open
transaction stays available for editing. Preview accepts the same source
adapters as `apply`.

After staging a gesture with `begin()` and `apply()`, call
`pixels.previewChanges()` to compare the whole draft with the start of the
transaction. The report includes these fields.

- `pixelCount` and `pixels` for native-grid changes to visible colors, owners,
  or protection. Each listed pixel has a frame, coordinate, and before and
  after values. The default list shows up to 256 changes. Set `limit` for more
  or fewer details. The count still covers all changes.
- `sources` for changed source objects and their authored fields, including
  changes made by calling the attached scene editor directly.
- `targets` for bound destinations, including the source object, part,
  surface channel, requested shot pixels, or splat IDs as applicable.
- `conflicts` for validation errors such as protected pixels, mismatched
  owners, stale document or source revisions, and invalid scene fields.

Commit a valid draft with `commit()` or restore the original scene and
document with `cancel()`. Preview leaves the undo history untouched. If
validation finds an invalid staged scene, the report includes its conflicts
and the shared draft rolls back. Shot pixels in the report are authored
requests. You can render a valid draft with the scene editor's `build()` and
`pixels.renderOptions()` to see the camera-dependent result.

The CLI reports a single proposed patch as JSON on standard output. Pass
`--scene` for a scene-bound destination and `--limit` to control the pixel
list. Exit status 2 indicates a conflict. Apply the reviewed patch with
`pixel-art edit` when ready.

```sh
node cli/ink-studio.js pixel-art preview examples/pixel-art-tooling/relay.json \
  examples/pixel-art-tooling/relay-cleanup.json
```

## Guard an edit against the inspected revision

For raster edits, copy `revision` from pixel inspection and include the
expected layer and swatch for each coordinate. Ink checks the entire pixel
document, including its bindings, before touching the requested cells.

For a scene edit, use `pixel-art targets` or `pixels.targets(destination)`
to get `documentRevision` and `sourceRevision`. Copy them into the patch as
`revision` and `sourceRevision`. A single-patch preview also returns the
observed `sourceRevision`.

```js
const observed = pixels.targets('carve');
const cut = {
  id: 'gate-cut',
  frame: 'front',
  destination: 'carve',
  revision: observed.documentRevision,
  sourceRevision: observed.sourceRevision,
  operation: { parameters: { half: [0.4, 0.5, 0.23] } }
};
pixels.apply(cut);
```

The source digest covers the destination and binding along with the resolved
scene. For an editable diorama it includes the source JSON and its loaded
mesh and prefab inputs. For shot and splat edits it includes the active
packed geometry, source IDs and ownership, and the existing asset for that
destination. If the digest changes, preview reports `stale-source` with
the expected and current revisions, and `edit` rejects the patch before
changing the source. Reinspect and review the patch before retrying.

Existing scene patches can still use a revision pinned in the binding.
Previews flag patches that omit the per-edit guard as `unverified-source`
and supply the digest to use when reviewing the edit.

## Record and replay edit receipts

`pixel-art edit` writes the native artifact to `--out` and prints a version 1
receipt as JSON. Save the receipt alongside the original inputs to reproduce the edit.

```sh
node cli/ink-studio.js pixel-art edit examples/pixel-art-tooling/relay.json \
  examples/pixel-art-tooling/relay-cleanup.json --out revised.json > receipt.json
node cli/ink-studio.js pixel-art replay examples/pixel-art-tooling/relay.json \
  receipt.json --out replayed.json
```

The receipt records the patch and effective frame, the command flags, the
input document and observed source revisions, the resolved targets, skipped hits,
and the resulting document and artifact revisions. Depending on the destination,
the targets identify the raster cel, the scene binding and resolved splat rows
and IDs, the surface chart and channel, or the solid and modifier.
The artifact revision hashes the
resulting JSON before formatting. Replay uses the embedded patch and checks the
inputs and the reproduced receipt before writing. Repeat the original CLI
flags, such as `--scene`. The output path can change.

Shot corrections resolve visibility at render time. For a reference sample,
add `--shot-hit-frame 12` to both commands. This runs a headless native-grid
render with the input world's current pose and the shot clock at frame 12.
The receipt includes skipped offsets, projected coordinates when available,
and the reason for each skip. A sample outside the correction's frame range
reports that status. Without a sample the receipt marks hits as deferred.
When the CLI rejects a patch during application, it prints a receipt with its
conflicts and any rejected hit coordinates or IDs. It exits with an error and
leaves the artifact unwritten.

With the Node editor, use `pixels.receipts()` to read receipts from the
current working state. Their lifetime follows the edit transaction through
cancel, undo, and redo. An edit rejected during application exposes its
receipt on `error.receipt`. For a shot sample, pass `{ shotHitFrame: 12 }`
as the second argument to `pixels.apply`. To reproduce a successful SDK
receipt, call `pixels.replay(receipt)` on an editor opened on the original
inputs. Attach the original scene to replay surface or SDF edits and supply
any host world callback used by the original edit. Replay multiple receipts in
their recorded order to reproduce a sequence of edits.

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
