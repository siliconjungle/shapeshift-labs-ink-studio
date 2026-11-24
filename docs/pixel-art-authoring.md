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

### Brush dynamics

Save pressure and speed size mappings and a stabilizer with the brush.

```sh
node cli/ink-studio.js pixel-art brush document.json --selection badge --size 12,8 \
  --stabilization 40 --pressure .25,1 --velocity 120,1,.6 --out dynamic-brush.json
```

The corresponding optional `brush.settings.dynamics` is

```json
{
  "stabilization": 40,
  "pressure": [0.25, 1],
  "velocity": { "speed": 120, "size": [1, 0.6] }
}
```

Stabilization is a follow time from 0 to 500 milliseconds. Zero follows
the input immediately. Pressure maps light to full, and velocity maps
stationary to the specified fast speed in native pixels per second.
The two linear size factors multiply. Omitted mappings use a factor of
one, and each authored factor can be 0–4. Each dab rounds the scaled
width and height to integer pixels and clamps them to 1–512. Brush angle,
anchor, indexed colors, and transparency apply as usual.

For a document edit, embed the brush and supply `operation.samples` in
place of `at` or `points`. Each sample specifies a native pixel-center
coordinate, pressure in 0–1, and elapsed milliseconds from the start of
the stroke. The top-left pixel center is `[0, 0]`, and positions may extend
up to half a pixel beyond the first and last centers. Use pressure `1`
for a device without pressure data.

```json
[
  { "at": [3.25, 5], "pressure": 0.2, "time": 0 },
  { "at": [8.5, 5.25], "pressure": 0.7, "time": 55 },
  { "at": [12, 8], "pressure": 1, "time": 115 }
]
```

Use 1–4096 samples with nondecreasing times. A move at the same timestamp
reaches the fast size immediately. Ink stabilizes the positions before
rounding to the nearest art pixel, with half-pixel ties rounding up.
It connects the resulting anchors on the grid, interpolates size across
each span, and brings the stroke to the last sampled anchor on release.
Preview, edit, replay, and working sessions use the same rules. Receipts
retain the samples and saved mappings. The `at` and `points` forms
continue to use the brush's fixed size.

### Coverage lock and shading

A raster brush operation can carry an optional `shading` object. The same
tip, placement and dynamics apply, including to strokes with recorded samples.

| Shading | Effect |
| --- | --- |
| `{"mode":"recolor"}` | Paint with the brush colors or an operation-level `swatch`. The color changes only where the target layer has visible paint. Its alpha stays fixed. |
| `{"mode":"ramp","ramp":["shadow","mid","highlight"],"step":1}` | Shift existing colors by one step per stroke. List distinct target swatch IDs in order. Use a negative step to darken. The endpoints hold and colors outside the ramp are skipped. |
| `{"mode":"alpha","value":128}` | Set alpha to a byte from 0 to 255. Swatch IDs stay fixed. The brush can reveal a pixel previously set to zero. It skips pixels that have never been painted or have been erased. |

The footprint applies to the selected raster layer or cel. Hits on another
layer do not count, even if its paint is visible underneath. The brush still
honors clipping and protected details. A continuous stroke applies a ramp
step at most once per pixel, even when the tip overlaps itself.

Alpha defaults to 255 on painted pixels. The document keeps authored alpha
in native runs such as `{"alpha":128,"runs":[[5,3,4]]}`, where a run lists
row, column and length. Ordinary color edits preserve that alpha. The eraser
clears both paint and stored alpha. Preview and composite eyedropper results
include the visible color after layer blending, and layer sampling shows the
original swatch and its own alpha.

### Edit and exchange exact RGBA pixels

The indexed and RGBA paths use the same editable pixels. Each pixel has
a swatch ID and its own alpha byte. Swatches with the same RGB remain
distinct. An RGBA edit keeps the current swatch ID when its RGB is
unchanged. An optional `swatch` names an exact match or creates a new ID
with the supplied RGB. New unnamed colors receive an ID based on their RGB.

```json
{
  "tool": "rgba",
  "layer": "ink",
  "pixels": [
    { "at": [5, 3], "rgba": [231, 185, 97, 96] },
    { "at": [6, 3], "rgba": [231, 185, 97, 0], "swatch": "hidden-glaze" },
    { "at": [7, 3], "rgba": null }
  ]
}
```

Use this as `operation` in a raster patch. You can target a cel by putting
`cel` on the patch and omitting `layer`. Zero alpha retains the pigment.
`rgba: null` clears the pixel. Edits honor clipping and protection, and
support preview, receipts, replay, and undo. Ink can edit up to 255 exact
RGB swatches per document. Alpha values share their RGB swatch.

```sh
node cli/ink-studio.js pixel-art draw design.json --color-mode rgba --out export
node cli/ink-studio.js pixel-art import export/art.png --out imported.json
node cli/ink-studio.js pixel-art draw imported.json --layer image --color-mode indexed --out indexed
```

`--color-mode auto` chooses indexed PNG if the swatches, alpha variants,
and empty slot fit within PNG's 256 entries. It uses RGBA otherwise.
`indexed` reports when an exact indexed export cannot fit. Both modes
carry a compressed Ink metadata chunk with the palette order, swatch IDs,
and editable index plane. An external PNG without Ink metadata keeps its
indexed palette and slot numbers, or gets exact swatches from its RGB
samples. Import accepts still images up to 512 × 512 with 8-bit or smaller
channels and up to 255 RGB swatches. Tools that strip metadata can remove
authored swatch IDs and knockout information from a PNG.

The default export flattens the visible composite. A blended color gets
a separate swatch ID. Use `--layer ink` to export the raw layer including
zero-alpha pigment and knockouts. PNG import opens a single editable layer
named `image`. Keep the source document for its full layer stack, animation,
and scene bindings.

### Edit palettes and ramps

A version 2 document accepts a hex string or an object such as
`{"color":"#415364","label":"Steel shadow","locked":true}` for each
swatch. The key is its stable ID. `ramps` holds named, ordered lists of two
or more distinct swatch IDs, separate from the palette's display order.
For a shading brush, use `{"mode":"ramp","ramp":"steel","step":1}` to
reference a named ramp. An inline swatch list also works.

Send a revision-checked patch to the `palette` destination. Omit `frame`
and `cel` because the edit applies to all frames.

```json
{
  "id": "update-steel",
  "revision": "<document revision>",
  "destination": "palette",
  "operation": {
    "type": "ramp",
    "ramp": { "id": "steel", "label": "Brushed steel", "swatches": ["shadow", "mid", "light"] }
  }
}
```

| Operation | Fields and behavior |
| --- | --- |
| `swatch` | `swatch: {id, color?, label?, locked?}`. New IDs require RGB. Use `label: null` to clear a name. |
| `ramp` | `ramp: {id, label?, swatches}`. Save or replace a ramp in the specified order. |
| `remove-ramp` | `id`. Remove a named ramp. |
| `reorder` | `order`. List every current swatch ID once. Pixels and named ramps follow their IDs. |
| `remap` | `map: {source: target}` and optional `removeSources: true`. Replace the source IDs simultaneously across slots and marks, including hidden paint. Removing a source also updates ramp references. A ramp must still have at least two distinct swatches. |
| `remap-indices` | `map: {"0": 2, "2": 0}`. Reassign the referenced indices in all cels using the palette order at the observed revision. Palette definitions, order, and ramps stay intact. |
| `import` | `palette`. Merge a palette asset by ID. An existing ID with a different RGB or ramp order is a conflict. |

A locked swatch can be named, reordered, painted with, and used as a
remap target. Unlock it before changing its RGB or remapping it away.
Preview, replay, and undo use the normal pixel document transaction.
Use `document:palette` if the document already defines a destination
named `palette`.

```sh
node cli/ink-studio.js pixel-art palette export design.json --out palette.json
node cli/ink-studio.js pixel-art palette extract reference.png --size 16 --alpha visible --out extracted.json
node cli/ink-studio.js pixel-art palette import design.json extracted.json --out expanded.json
```

Palette files use `ink-studio/pixel-palette` version 1, with ordered
`swatches` and named `ramps`. Extraction also accepts a pixel document
with optional `--frame` and `--layer`. RGB extraction reduces to
the requested size when needed. Indexed PNG extraction preserves the
order and distinct indices of swatches that pass the alpha filter.
`editor.palette()` returns the same portable asset. Ink stamp JSON and
Ink PNG metadata also carry swatch names, locks, and ramps.

### Choose a recoloring scope

- Change a swatch's RGB with `destination: "palette"` and `type: "swatch"`.
  Every pixel using that ID takes the new color. Its palette index and
  assignment stay the same.
- Replace a swatch only in a saved selection with the raster operation
  below. Specify a layer and frame, or pass a cel ID on the patch and
  omit `layer`.
- Change which palette indices the art uses with `destination: "palette"`
  and `type: "remap-indices"`. Indices start at zero. The map is applied
  once to the original indices, so a swap such as `{"0": 2, "2": 0}` works
  across the document without cascading.

```json
{
  "tool": "replace-swatch",
  "layer": "ink",
  "selection": "badge",
  "from": "steel-shadow",
  "to": "bronze-shadow"
}
```

Selection replacement checks the source swatch ID. Same-RGB aliases
stay distinct. It carries alpha, including zero-alpha pigment, and
reports the matching runs in preview and receipts. It honors clipping
and protected pixels. Color locks guard definition changes and global
remaps. Painting over a locked swatch locally remains available.

### Edit a layer stack

Version 2 layer definitions are listed from bottom to top. A definition
with just an ID is a paint layer. All layer kinds can have a name,
visibility, a lock, opacity in 0–1, a parent group, and a clipping source.
Visible paint and surface cels can blend with `normal`, `multiply`,
`screen`, `overlay`, or `add`.

| Kind | Behavior |
| --- | --- |
| `paint` | Editable indexed cels. |
| `mask` | Non-color cels that clip later siblings by alpha. |
| `reference` | A read-only raster in working views. Set its cel explicitly or load a reference PNG in the Workshop. Clean artwork exports omit references. |
| `group` | An isolated stack of children. The group applies its opacity and blend once to the combined result. |
| `surface` | An editable local cel linked to a named surface-channel destination. Use `layer:<id>` to sample or edit its underlying chart. |

`parent` refers to an earlier group. `clip` refers to an earlier sibling
under the same parent. Clipping to a mask or group uses its alpha. A paint
clipping source uses its covered pixels. A group lock also locks its
descendants. Locks guard paint edits, palette remaps that affect the layer,
source writes, deletion, and merge. Visibility and opacity remain editable
properties. The legacy `protect` flag guards painted pixel locations.

Send a revision-checked `layers` edit to create, position, or merge layers.
The patch uses its own operation fields for the layer and frame scope.

```json
{
  "id": "glaze-opacity",
  "revision": "<document revision>",
  "destination": "layers",
  "operation": {
    "type": "update",
    "layer": "glaze",
    "changes": { "opacity": 0.45, "blend": "multiply", "clip": "coat-mask" }
  }
}
```

| Operation | Fields |
| --- | --- |
| `add` | Complete `layer` definition and optional `before` layer ID. |
| `update` | Layer ID and `changes`. Use `null` to clear an optional property. |
| `reorder` | Complete `order` of layer IDs with parents and clip sources before their users. |
| `set-cel` | `layer`, `frame`, and `cel` using native named slots and marks. Use this to set a reference's artwork. |
| `remove` | `layer`. Removing a group also removes its descendants. |
| `merge-down` | `layer`. Merge into the paint sibling below, retaining that sibling's ID and cel IDs. |
| `flatten-group` | Group `layer`. Bake the children into a paint layer and keep the group's outer properties and ID. |
| `flatten` | New `layer` ID. Bake the visible artwork into one paint layer across every frame. |

Merges verify the rendered RGBA bytes of every frame. They reject locked,
protected or bound content, and dependencies that would be broken.
Use `flatten` to bake effects that depend on a broader backdrop.
Preview, undo, and replay use the ordinary pixel document transaction.

For a surface layer, set its `destination` to a documented
`surface-channel` destination. A source edit with
`destination: "layer:glaze"`, `frame: "front"`, and
`operation: { "pixel": [12, 7], "value": 0.65 }` writes one native pixel's
registered footprint to that chart. It accepts the same source revision
and scene options as a UV stamp. Sample it with
`pixel-art sample document.json --mode source --destination layer:glaze --at 12,7 --scene scene.json`.
The layer's local cel supplies Workshop paint. Source edits work through
the CLI or a Scene Editor attached to the SDK.

```sh
node cli/ink-studio.js pixel-art stack export design.json --out deck.json
node cli/ink-studio.js pixel-art stack import deck.json --out edited.json
```

Layer decks preserve layer and frame identities, indexed pixels, alpha,
knockouts, guides, and bindings. They rasterize each cel's drawing commands.
Use the native document when you need to preserve authored commands.
The SDK exposes `editor.layerDeck()` and `pixelDocumentFromLayerDeck(deck)`.

### Apply scoped adjustments

Use the `adjustments` destination to change indexed paint on a version 2
document. Set `scope.frame` to one frame ID or `scope.frames` to the first
and last frame IDs in document order, both inclusive. Add `layer` to target
one layer, or omit it to adjust each existing cel independently. A saved
`selection` can narrow either scope. A frame-specific selection applies
only to its own frame. Use `document:adjustments` if you already have a
destination named `adjustments`.

```json
{
  "id": "cool-shadows",
  "revision": "<document revision>",
  "destination": "adjustments",
  "operation": {
    "scope": { "frames": ["approach", "turn"], "layer": "coat", "selection": "folds" },
    "adjustment": { "type": "hue-saturation", "degrees": 25, "saturation": 0.8 }
  }
}
```

| Type | Controls |
| --- | --- |
| `curves` | A master `curve` and/or `channels` keyed by `red`, `green`, or `blue`. Curves take `stops: [[input, output], ...]` in 0–1 and optional `interpolation: "linear", "step", "smooth"`. The master runs first. |
| `hue-saturation` | Hue `degrees` and a `saturation` factor from 0 to 4. A factor of 1 retains saturation. |
| `gradient` | Ordered `stops: [[position, swatchIdOrHex], ...]` in 0–1 and optional interpolation. Use `axis: "x"` or `"y"` to span the selection bounds or whole grid. Supply native `from: [x,y]` and `to: [x,y]` points for a custom direction. |
| `replace` | `map: {sourceId: targetId}`. Matches original swatch IDs and applies mappings simultaneously. |
| `dither` | `dark` and `light` swatch IDs. Uses brightness to distribute paint on a native-grid `"bayer"` or `"checker"` pattern. |
| `outline` | A `swatch`, pixel `radius`, and `side: "inside", "outside", "both"`. Traces each cel's painted silhouette and limits the result to the scope. Outer outlines fill empty cells with opaque paint. |

Curves, hue adjustments, and gradients accept `match: "exact"` (the
default) or `"palette"`. Exact mode reuses matching swatches and adds
new ones within the 255-swatch limit. Palette mode uses the nearest
existing color. The adjustments keep original swatch definitions and
alpha bytes. Outlines leave knockouts and zero-alpha pigment intact.

Preview reports changed runs per cel and any new swatches. If an edit
would write to a protected or clipped pixel, the entire adjustment is
rejected. Applying an adjustment across a range is one undoable edit
with one replay receipt.

### Symmetry and wraparound

Add `operation.drawing` to any raster-tool patch to mirror or wrap its stroke.

```json
{
  "tool": "pencil",
  "layer": "ink",
  "swatch": "light",
  "points": [[7, 2], [8, 2], [9, 3]],
  "drawing": { "mirrorY": 2.5, "wrapX": true }
}
```

In an eight-pixel-wide document this stroke crosses the right seam into
columns 0 and 1. On a wrapped axis, integer input can extend from
`-size` through `2*size-1` to address either neighboring tile. Keep these
input coordinates unwrapped so the path, pixel-perfect cleanup, and brush
dynamics follow the actual stroke across the seam. Coordinates inside one
tile still describe an ordinary path within that tile.

Use `mirrorX` for a vertical axis and `mirrorY` for a horizontal axis.
Zero is the first pixel center. Whole positions reflect through a row or
column of pixels, and half-pixels reflect between them. Each enabled axis
can move from the first edge (−0.5) to the last edge (size − 0.5).
Enable `wrapX` or `wrapY` independently. Ink reflects the footprint and
wraps each copy back to the native tile. Fill crosses enabled seams and
uses each mirrored seed's own starting swatch. Overlapping copies count
once in the edit and apply a shading step at most once per pixel.

Preview and replay use the same placement settings and enforce clipping and
protected details on the resulting pixels.

## Select pixels

Resolve a mask against the native grid with `pixels.select(query, options)`
or `pixel-art select`. The result includes the document revision, frame,
grid size and exact coordinates in row order.

| Query | Selection |
| --- | --- |
| `{"type":"rectangle","rect":[2,3,8,6]}` | Rectangle marquee with an inclusive origin, width and height. |
| `{"type":"ellipse","rect":[2,3,8,6]}` | Ellipse marquee using the same bounds. |
| `{"type":"lasso","points":[[2,3],[9,3],[5,8]]}` | Freehand path of up to 4096 native pixel centers. |
| `{"type":"polygon","points":[[2,3],[9,3],[5,8]]}` | Polygon lasso with 3–128 vertices. Ink closes the boundary and uses an even-odd fill. |
| `{"type":"wand","at":[2,3],"tolerance":12}` | Matching pixels connected by their four edges. Add `"connected":false` to select every match in the frame. |

The wand reads the visible composite by default. Use `--layer` or `--cel`
to read the chosen layer's color and alpha. Knockouts and clipped pixels
on that layer read as transparent. The tolerance is the maximum allowed
difference in each RGBA byte. At zero it matches exact visible colors,
including RGB aliases in the palette. A transparent seed matches transparent
pixels, and any painted seed matches only pixels with positive alpha.

```sh
node cli/ink-studio.js pixel-art select document.json query.json --frame front --layer ink
node cli/ink-studio.js pixel-art session select ./session query.json --frame front
```

To retain a named selection in a version 2 document, apply an edit with
`destination: "selections"` and the selected frame and revision. For example,
use this operation in the patch with `frame: "front"`.

```json
{
  "id": "glaze-islands",
  "layer": "ink",
  "query": { "type": "wand", "at": [2,3], "connected": false, "tolerance": 12 }
}
```

Applying the edit saves the resolved mask under its stable ID. Using the
same ID replaces it. Preview and receipts report the native runs, and the
edit participates in undo and replay. Reference the ID in a later raster
patch as `operation.selection` to limit painting and fill to those pixels,
or pass it to `pixel-art brush --selection` to capture its exact footprint.

### Select by meaning

Use the same selection queries to address artwork and visible render
owners by identity.

| Query | Selection |
| --- | --- |
| `{"type":"swatch","id":"oxide"}` | Exact indexed swatch ID. Use `at` in place of `id` to pick a visible swatch from a pixel. RGB aliases remain distinct. |
| `{"type":"cluster","at":[12,8],"connectivity":8}` | The seed's connected swatch cluster. The default is four neighbors sharing an edge. Eight also follows corners. Supply a `source` query to find a component of any mask. |
| `{"type":"binding","id":"gate"}` | Visible hits on the object or part named by the document binding. |
| `{"type":"object","id":"gatehouse"}` | Pixels owned by that visible render object. |
| `{"type":"part","id":"tide-needle","object":"tide-needle"}` | Visible pixels of the part. Optional `object` and `entity` scope reused part names. |
| `{"type":"material","id":"brushed-copper"}` | Pixels owned by that render material. |
| `{"type":"depth","range":[2,6]}` | Finite visible camera-axis depths in the inclusive range, in scene units. |
| `{"type":"channel","channel":"coverage","range":[0.5,1]}` | Values in an [art pass](art-passes.md). Add a zero-based `component` for vectors, such as `1` for the second coordinate of `surfaceUV`. Pixels with a reported invalid sample are skipped. |
| `{"type":"channel","destination":"wear","range":[0.25,1]}` | Values from a bound surface-channel destination on its native UV chart. Color channels select by coverage. |

Swatches and clusters can read the composite or a specific layer or cel.
Fully transparent pixels are excluded from a swatch selection. Objects,
parts and materials also accept a native seed `at` in place of `id`.
The render owner passes resolve occlusion before selection. The depth range
excludes empty pixels. Diagnostic channel ranges can include background
values, such as zero coverage.

For render queries, use the document's native grid and supply `--scene`
with the same camera and time settings as the shot. Select a bound material
channel with the scene declared by its destination.

```sh
node cli/ink-studio.js pixel-art select document.json query.json \
  --scene examples/part-motion.js --t .25
```

The SDK accepts the render result as `editor.select(query, { renderFrame })`.
Request the art passes used by the query when calling `ink.render()`.
Owner queries use `objectId`, `partId`, and `materialId`. A part filter with
`object` also uses `objectId`. Depth queries use `depth`. Use the same
`renderFrame` option with `previewEdit`, `apply`, and `replay` when saving
a scene-backed mask. Receipts fingerprint the inspected passes and bound
material channels before saving their resolved pixels. Copy the selection
report's `sources` into the save operation to guard it against changes
since inspection. Recall the saved mask in the Workshop to use it as a paint boundary or brush footprint.

### Choose a scene selection scope

Use a `binding` query to select against the object and optional part in
`sceneBindings`. The binding's registered source grid, document frame,
and layer apply. Pass the bound scene with `--scene`.

```json
{ "type":"binding", "id":"gate", "scope":"visible" }
```

- **Visible** is the default. It follows the camera raster and includes
  the selected target's contributions through soft edges and translucent
  layers. A foreground depth-writing core blocks covered hits.
- **Isolated part** (`isolated-part`) requires a named part on the binding.
  Ink rasterizes that part alone at the same camera and frame. Other parts
  of the object are excluded.
- **Through layers** (`through-layers`) projects the bound object or part
  through scene occluders. The selection report gives the number of
  `occludedPixels` added relative to the visible mask. An isolated part and
  a through-layer query on that same part can share a screen footprint.

Scope and source coverage are fingerprinted in `sources`. Use the same
query and copy its `sources` when saving the selection to guard the chosen
scope. Once saved, use the mask with the regular painting and selection tools.

In the SDK, pass `captureSelection` to `editor.select` or the edit
operation. Forward the callback's native `w`, `h`, `passes`, and
`pixelSelection` options to `ink.render(world, { ...settings, px:1 })`.
A through-layer query requests both the isolated and scene views. A
pre-rendered `renderFrame` carrying the matching `pixelSelection` result
can supply a single visible or isolated-part query. Supply `sceneRef`
when the binding names a file and the world uses a logical scene ID.

### Edit and recall masks

The same selection query can read saved masks and combine them with fresh
selections. Use `base` and `with` for **combine** (union), **subtract**, and
**intersect**. Use `source` for **invert**, **grow**, **shrink**, and
**outline**. A literal mask is `{"type":"pixels","pixels":[[4,5],[5,5]]}`.

```json
{
  "type": "outline",
  "amount": 2,
  "side": "outside",
  "source": {
    "type": "subtract",
    "base": { "type": "recall", "id": "glaze-islands" },
    "with": { "type": "ellipse", "rect": [3,2,6,5] }
  }
}
```

Grow, shrink, and outline default to one pixel and accept whole-pixel
radii from 1 to 512. Distance follows four-neighbor steps. Grow stops at
the canvas edge. Shrink and inside outlines treat locations beyond the
edge as unselected. Outline returns a band on the chosen side, which can
be `inside` (the default), `outside`, or `both`. Holes contribute their
own boundaries. Invert flips every pixel in the native grid.

Use a standalone `{"type":"recall","id":"glaze-islands"}` query to inspect
a saved mask. When no frame or cel is supplied, a standalone recall uses
the mask's saved frame. For composed queries, set the shared frame with
`--frame` or the SDK's `frame` option. Queries may contain up to 32
operations. Applying a composed query in the `selections` destination
saves its resolved pixels without changing the artwork. Exports from
`pixel-art draw` or `pixels.stamp()` carry the frame's saved masks in
stamp JSON for recall in the Workshop.

### Transform and paste selections

A raster edit can transform the pixels of a saved selection on a layer or
cel. The move mode clears the original pixels and places the result as
one edit. Use `"mode":"copy"` to leave the source in place. Set an optional
`resultSelection` ID to save the transformed mask in the same edit.

```json
{
  "tool": "transform",
  "layer": "ink",
  "selection": "badge",
  "mode": "move",
  "transform": { "offset": [1, -2], "flipX": true, "angle": 90 },
  "resultSelection": "badge-moved"
}
```

Use `offset` to nudge relative to the source bounding box, or `at` for the
top-left of the transformed bounds. Placement stays on integer coordinates.
Set `size: [width, height]` to scale to whole pixels before rotation.
`flipX` and `flipY` mirror the selection before a clockwise `angle` in
degrees. Quarter turns place exact texels. For angled turns, choose
`rotation: "nearest"` or `"pixel-aware"`. The latter uses Scale2x-style
neighbor rules to help diagonals and corners hold together without
blending the palette.

Blank selected cells and holes in the mask leave the underlying destination
alone. The transform carries swatches, alpha, and explicit knockout marks.
The canvas clips the floated footprint. Preview reports its bounds,
changed runs, clipped pixel count, and saved result mask if requested.
Protected pixels and the target layer's clipping mask still guard writes.

Use `pixels.copySelection({ selection, layer, frame })` or the CLI to
export the indexed clipboard. You can use `cel` in place of `layer`.

```sh
node cli/ink-studio.js pixel-art copy document.json --selection badge --layer ink > badge-clip.json
```

Paste by embedding the clipboard JSON in `operation.clipboard` with
`tool: "paste"`, a target layer or cel, and optional transform and result
selection. Paste maps colors into the destination palette, adding missing
swatches and keeping named RGB aliases separate. A conflicting ID receives
a color-specific suffix. Preview, edit, replay and persistent sessions use
the same placement.

### Transform the whole canvas

Use the `canvas` edit destination to change the native art grid of every
frame in one transaction. Omit `frame` and `cel` from the patch. Use
`document:canvas` if you already have a destination named `canvas`.

```json
{
  "id": "crop-gate",
  "revision": "<revision from pixel-art inspect>",
  "destination": "canvas",
  "operation": { "type": "crop", "rect": [8, 4, 32, 24], "bindingPolicy": "preserve" }
}
```

| Operation | Fields | Result |
| --- | --- | --- |
| `crop` | `rect: [x, y, width, height]` | Keep an in-bounds rectangle. |
| `trim` | None | Keep the bounds of visible paint and protected pixels across all frames. A fully empty canvas keeps its size. |
| `pad` | `margins: [left, top, right, bottom]` | Add transparent space in whole pixels. |
| `resize` | `size: [width, height]`, optional `anchor` | Crop or add space without scaling the art. Anchors are `top-left` (default), `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, and `bottom-right`. |
| `resample` | `size: [width, height]`, optional `filter` | Scale the artwork using `nearest` (default) or `area`. Area filtering chooses the swatch with the most opaque coverage and carries the area-weighted alpha. |

All dimensions are 1–512 px. Grid-changing edits bake each cel's drawing
commands to indexed pixels and alpha or knockout runs. Frame timing, cel
IDs, clipping links, and pixel aspect remain part of the document. Pivots
and registration guides move with the art at half-pixel precision. Grid
origins and steps stay in whole pixels. Saved selections and protected
masks follow the nearest-pixel mapping.

Choose a binding policy when the document has scene bindings:

- `preserve` carries forward the original source grid, offset, and scale.
  A painted location keeps its chart UV or shot pixel after a crop or
  pad. Padding beyond the source has no chart sample. Shot corrections
  reject pixels outside the source grid and pairs that map to the same
  source pixel.
- `reframe` maps the whole new grid to the chart or camera. If a scene
  already has shot corrections, its correction grid must match the
  reframed canvas before applying another correction.

Use `pixel-art preview` or `editor.previewEdit()` to inspect changed
pixels, guide positions, binding mappings, and protected locations the
transform drops. Commit through `pixel-art edit` or `editor.apply()`.
Canvas edits support receipts, replay, and persistent sessions. Undo
restores the original grid and authored cel commands.

## Protect authored details

In the Workshop, select the native pixels and open **Protect details**.
Name the detail and choose a pixel lock, transparent gap, contour span or
focal accent. Select the cells beside a contour too if they need to stay
empty. Protect the current frame, all frames, or an inclusive range in
animation order. A gap must be transparent in every frame it covers. Use
**Select detail** to recall the mask or **Unlock detail** to remove it.

A lock follows its authored swatch, composite color and coverage. Paint,
palette edits, layer-stack changes, and adjustments that would alter the
detail report a conflict. Draw review keeps protected findings out of the
editable cleanup overlay. The cursor inspector lists the lock IDs, kinds
and frame scopes at the hovered pixel.

Use the `document:protection` destination with the usual revision,
preview, edit and replay commands. This edit protects an opening in two
or more frames, from `closed` through `opening`.

```json
{
  "id": "protect-vent",
  "revision": "<revision from pixel-art validate>",
  "destination": "document:protection",
  "operation": {
    "type": "set",
    "id": "vent-opening",
    "kind": "gap",
    "frames": ["closed", "opening"],
    "pixels": [[14, 10], [15, 10]]
  }
}
```

Use `selection` in place of `pixels` to take coordinates from a saved mask.
A frame-scoped selection needs the same `frame` on the operation.
Use an operation such as `{"type":"remove","id":"vent-opening"}` to unlock
the group. Setting an existing ID replaces its scope and coordinates.

Whole-canvas transforms carry named locks and copy their exact pixel
samples, including gaps during area resampling. If downsampling would
combine different protected samples, preview reports a conflict. Remove
or reposition a named lock before cropping out any of its protected
cells. Existing untyped protection lists keep their original crop
behavior and the receipt reports any lost coordinates.

For a single-frame move, select the entire frame-scoped detail and enable
**Carry frame locks**. Use `"carryProtection": true` on the SDK or CLI
raster transform operation. The destination needs to preserve the exact
color and coverage, and a carried gap needs an empty destination. A
selection move applies to one frame. Use whole-canvas operations to
transform shared or ranged protection.

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
a copy of the editable document, and `stamp({ frame, cel, layer })` exports the
chosen frame as an indexed stamp with `swatchIds` in palette order. Supply
`layer` for the raw indexed cel. `png({ frame, cel, layer, colorMode })`
returns PNG bytes. Pass PNG bytes or a file path to the package's
`pixelDocumentFromPNG()` to obtain an editable document. `inspect` reports
the visible owner of a pixel. Passing a cel ID selects the frame containing that cel.
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
  apply a set across all frames. Protected details also accept a `kind`
  and an inclusive `frames: [first, last]` scope. Selections are saved for
  reuse. Details lock visible pixels and transparent gaps. A protected
  layer still locks its marks during compositing.
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

Trace writes a version 2 `design.json`, the indexed PNG and review, and a
`source-view.json` from the same render.
The document records the input scene and subject in a binding scoped to its
`capture` frame and `projection` layer. A raster cel's `slots` list uses named
swatches and `null` for transparent cells.
These cells are left untouched by that layer. Use a mark with a null swatch when
you want to erase earlier artwork. A trace preserves only the part visible
at capture time. If an object exceeds 255 displayed colors, select a
suitable palette in the source view before tracing.

## Inspect pixel contributors

Open **Inspect pixel** below the native canvas and move the pointer over the
artwork. Pin the pixel to compare the same location across edits or frames.
The inspector gives the resolved color and alpha, lists the layers in front
to back order, and shows which swatch, mask, opacity, and blend contributed.
Hidden, clipped, and covered layers stay in the trace. A pixel with a named
swatch keeps its authored index even if other swatches share that color.

```sh
node cli/ink-studio.js pixel-art inspect design.json --at 18,23 --frame front \
  --scene scene.json --destination glaze,wear --out pixel.json
node cli/ink-studio.js pixel-art canvas design.json --scene scene.json \
  --at 18,23 --out review.html
```

Coordinates start at the top-left native pixel. `inspect` includes editable
reference layers when you pass `--references`. The offline canvas shows them
with the working composite. With `--scene`, Ink samples compatible bound
surface channels automatically. Use `--destination` with comma-separated IDs
to choose specific channels. The chart values are authored material samples
at the registered UV. The captured render channels show values such as
coverage, depth, and emission on the native scene grid.

A scene-backed canvas shows the opaque surface and front strand at each
cursor pixel where those hits exist. Use `--at` to also record the detailed
palette decisions and surviving native raster fragments for one coordinate.
The hover panel shows those details at that coordinate. The scene capture
uses a single camera time (`--t` in seconds), shared across the review's
document frames.

The SDK uses `editor.inspect([x, y], { frame, destinations, references,
renderFrame })` for an existing aligned render. A caller can also supply
`captureSelection` to render the requested native passes and pixel traces.

## Save and reopen a native source view

```sh
node cli/ink-studio.js pixel-art capture examples/opaque-surface-gate.js \
  --view-id gate-orbit --w 120 --h 80 --t 0.45 --out gate-view.json
node cli/ink-studio.js pixel-art inspect gate-design.json \
  --source-view gate-view.json --at 60,40
node cli/ink-studio.js pixel-art canvas gate-design.json \
  --source-view gate-view.json --out gate-review.html
```

Canvas reviews use the same native dimensions as the source view. An inspection
of a named binding can use its registered source grid. A source view can be reopened without the scene or its assets. Keep using
`--scene` to sample the live material channels of a bound destination.
Pass `--at` during capture to retain detailed palette and fragment traces
for one pixel. Scene-backed canvas reviews embed their capture. Each sample in
a scene motion review embeds its own capture and inspection follows the selected
sample and camera. When a motion review isolates a subject, the source passes
still describe the full scene at that pixel.

The version 1 `ink-studio/pixel-view-source` file records the scene reference,
view ID, frame index, picture time, sampled pose, camera and sky times, and
the exact art-grid camera. Its column-major world-to-view matrix includes
art-grid camera snapping. The focal scale is in native pixels, with
world-to-view projection divided by depth for perspective cameras.

The top-down planes preserve rendered color and coverage, depth, object,
part, material and splat IDs, surface kind, geometric and shading normals,
world and rest positions, and surface UVs. The object, part and material
tables resolve the numeric slots to scene identities. The UV validity mask
distinguishes a valid `[0, 0]` from an unavailable coordinate. Rest positions
use the renderer's object-position pass, which uses world coordinates for
static surfaces with no separate rest geometry. Empty pixels have infinite
depth. Ordinary coverage can still be present at a pixel with no opaque hit.

Each plane stores a typed array name and base64-encoded little-endian bytes.
Float32 depth, normal and coordinate values are preserved at render precision.
In Node, pass the parsed file to `unpackPixelSourceView(record)` and use the
returned frame with `editor.inspect([x, y], { renderFrame })` or
`pickSurface(renderFrame.passes, x, y)`.

## Resolve a pixel to its scene source

Use the binding ID from `sceneBindings`. On a traced document, it is
`projection`.

```sh
node cli/ink-studio.js pixel-art inspect gatehouse-study/design.json \
  --source-view gatehouse-study/source-view.json --binding projection --at 57,30
```

Pass `--scene` to resolve against a fresh view. For the SDK, supply
`editor.inspect([x, y], { binding, renderFrame })`. The report keeps the document
coordinate and gives the corresponding `sourceAt` in the binding's registered
grid. Ink checks the scene, object or entity, part, and document frame. It
also checks a layer-scoped binding when inspecting an explicit cel.
The offline canvas shows the bindings for the current frame under the cursor.

- Mesh hits identify the asset or captured mesh slot, chart, and triangle.
  Barycentrics refer to the three vertices of the captured chart triangle
  before near-plane clipping. The authored UV is included when the mesh supplies one.
- SDF hits identify the owning field. The point is expressed in that field's
  local coordinates after removing the pose and authored solid transform.
  The report also retains the hit in rest space. Use `--sdf-assist on`
  when the scene should render the field directly for inspection.
- Splat hits give the stable source ID, depth, fragment alpha, and the
  coverage that survived compositing at the pixel. The inspector marks
  the frontmost surviving splat by raster depth and the strongest by
  visible coverage. Four fragments are kept by coverage, with an extra
  slot when the frontmost splat falls outside those four. The report gives
  the remaining omitted coverage. An unidentified splat
  has no stable edit ID. A source marked `editable` can supply its ID to a
  `splat-attributes` destination.

At a translucent crossing, `scene.sources.frontSplat` gives the nearest
surviving splat and `scene.sources.splats` gives the retained contributors.
A nearer splat can have the smaller visible weight. An opaque cover removes
the splats it hides. A binding reports the frontmost splat when it belongs
to the selected scene object or part.

The report distinguishes a miss, an unmatched scope, unavailable data, and
a pixel where omitted contributions may contain a match. Earlier source
views can still provide saved mesh UVs and any saved pinned splat trace.
New captures store the representation data as optional typed planes and
source tables in the same version 1 format.

## Highlight occlusion and ambiguous hits

For a bound target, compare the scene and its isolated projection from the
same camera. Ink reports a foreground blocker when that projection reaches
the pixel and the scene shows a closer depth owner cutting into the target's
visible coverage. The report includes the blocker, both depths, and the
visible and projected coverage. A missing target hit by itself is a miss.

```sh
node cli/ink-studio.js pixel-art inspect design.json --scene scene.json \
  --binding gate --at 18,23
node cli/ink-studio.js pixel-art canvas design.json --scene scene.json \
  --binding gate --out hit-review.html
```

In the offline canvas, choose **Highlight scene hits**. **Foreground
blockers** marks confirmed occlusion for the chosen binding. **Overlapping
sources** marks pixels with multiple retained contributors. **Unreliable
bindings** marks missing addresses, omitted contributors, and occlusion
without a confirmed foreground blocker. Hover or pin a pixel to read its
**Hit diagnostics**. The 1× preview keeps showing the original artwork.

A bound canvas keeps the paired evidence so the blocker overlay works
offline. An ordinary saved source view still supports overlap and address
diagnostics. Inspecting it requires paired evidence to confirm a blocker.

## Track a scene-bound selection

Save a named selection on the frame registered to a scene binding. Use that
camera and pose for the first sample of a version 1 scene view plan. The
remaining samples may change the camera, scene time, or both.

```json
{
  "version": 1,
  "samples": [
    { "id": "reference", "time": 0 },
    { "id": "orbit", "time": 0, "camera": { "yaw": 0.35, "pitch": 0.12 } },
    { "id": "posed", "time": 0.8, "camera": { "yaw": 0.35, "pitch": 0.12 } }
  ]
}
```

```sh
node cli/ink-studio.js pixel-art track design.json --selection latch --binding gate \
  --views views.json --out tracking.json --review tracking.html
```

Ink follows mesh triangle barycentrics, traced SDF rest positions, and stable
splat IDs with local offsets. It projects the original anchors into every
sample, so a selection can reappear after leaving the view. A closer depth
owner confirms occlusion. Missing addresses, ambiguous reference hits,
unverified correspondence, and off-grid projections are reported as lost.
Tracking starts with visible source hits and leaves the document intact.

The JSON includes native-grid row runs in `[row, startColumn, length]` order
and example source and blocker details. Moved marks are the subset of visible
correspondences that changed native cells. Lost marks use reference
coordinates. If several selected document pixels land in one native cell,
the counts still include each selected pixel, while the runs mark the cell
once. The standalone HTML switches between sampled views and overlays each
status, with lost marks displayed on the reference image.

### Follow a part across representation changes

A binding can carry an explicit registration for a named object and part.
Each representation maps its captured surface coordinates into the same
part space. In this binding, the lantern shell's mesh already uses that
space. The baked atlas uses coordinates relative to its pivot, so its
registration adds the pivot's height.

```json
{
  "id": "shell",
  "scene": "examples/part-representations.js",
  "object": "brine-lantern",
  "part": "shell",
  "mapping": {
    "version": 1,
    "id": "shell-space",
    "tolerance": 0.18,
    "sources": {
      "mesh": true,
      "sprite": [1, 0, 0, 0, 0, 1, 0, 1.43, 0, 0, 1, 0]
    }
  }
}
```

Use `true` for a shared coordinate frame or supply a row-major 3 × 4
affine transform `[a,b,c,tx,d,e,f,ty,g,h,i,tz]`. Include at least two
representation entries. The tolerance is a maximum distance in the
registered part's units. Set it small enough to distinguish neighboring
details, while allowing for sampling at the authored native resolution.

| Source | Coordinates used in the registration |
| --- | --- |
| `mesh` | The rest position interpolated on the captured triangle. |
| `sdf` | The rest position of the field hit before its live pose, in the field's build space. |
| `splat` | The rest position of the sampled contributor, including its local hit offset. |
| `sprite` | The baked texel center and recorded depth, in atlas space relative to the bake pivot. This covers directional impostors and placed depth cards with a named `objectId` and `partId`. |

`pixel-art track` first tries the original source address. When a
registered representation takes over, Ink finds the nearest sampled
counterpart in that part within the authored tolerance. The full scene
and isolated part render distinguish visible pixels from foreground
blockers. A source can recover when its original representation returns.
The report includes the representation pairs, match distances, and
affected pixels. `pixel-art inspect` and the offline canvas show mapped
coordinates available in native captures and saved source views.

A match requires surface evidence. Color-only atlas pixels, synthesized
or filtered atlas samples without direct texel provenance, and points
with no sampled counterpart stay unresolved. Native edits to the
original representation still require a valid source address.

## Reprobe bindings after source edits

Capture the reference view before changing the mesh, field, bake, or splat
chunk. Select the affected area with a named selection or a rectangle in
document coordinates. The reprobe uses that binding's canvas registration
to find the corresponding native pixels.

```sh
node cli/ink-studio.js pixel-art capture gate.json --w 160 --h 96 --out before.json
node cli/ink-studio.js pixel-art reprobe gate-ink.json --binding gate \
  --before before.json --selection hinge --out reprobe.json --invalidate gate-checked.json
```

The live reprobe captures the current scene at the reference scene time.
Repeat any render options used for the original capture. To compare two
saved captures, add `--after current.json`. The captures must use the same
native camera, grid, and frame clocks. A live reprobe captures the scene
and the isolated binding once, and the comparison checks the requested
region. Use `--rect x,y,width,height` to specify coordinates directly.

The report lists verified, empty, and review pixels with native document
row runs and examples of changed addresses. It checks the visible
triangles and their rest geometry and UVs, traced SDF hits, retained splat
contributions and row revisions, and sampled pigment and normals. Unproven
hits and missing local source evidence are flagged for review. A nearer
occluder is reported separately from a missing hit.

`--invalidate` writes a separate pixel document with the affected pixels
marked stale on that binding. Inspecting those pixels shows the stale
status. Tracking skips them, and pixel-addressed shot and surface edits
require review before using them. Other pixels remain usable. Review the
current hits, save the new baseline, and clear only the verified portion
by comparing the reviewed capture with the current source.

```sh
node cli/ink-studio.js pixel-art reprobe gate-checked.json --binding gate \
  --before reviewed.json --selection hinge --accept --invalidate gate-approved.json
```

Acceptance clears verified stale pixels inside the requested area.
Unresolved pixels stay pending until the source can be verified.

## Assemble and verify an edit from several cameras

Use a bound `surface-channel` destination on an editable JSON diorama.
A multiview plan lists the cameras you want to inspect and the native
pixels you have approved for painting. The tool projects visible source
hits onto one authored rest chart and combines the results into one
guarded pixel edit.

```json
{
  "format": "ink-studio/pixel-multiview",
  "version": 1,
  "id": "paint-hinge",
  "destination": "hinge-paint",
  "frame": "front",
  "size": [32, 24],
  "views": [
    {
      "id": "front",
      "approved": true,
      "camera": { "yaw": 0 },
      "marks": [{ "at": [78, 52], "swatch": "warm-brass" }]
    },
    {
      "id": "quarter",
      "approved": true,
      "camera": { "yaw": 0.45 },
      "marks": [{ "at": [73, 51], "swatch": "warm-brass" }]
    },
    { "id": "check", "camera": { "yaw": -0.4 } }
  ]
}
```

The plan's `size` is the destination chart grid, up to 256 × 128.
The mark coordinates use the pixel document's grid and its binding
registration. The legacy `paint` channel takes an exact swatch or a
`value` of `#rrggbb`. The material channels below also accept numeric
and vector values.
Unapproved cameras can verify the proposal from an angle that
contributed no paint. Set `time` per camera when an authored pose is
needed. The report provides `documentRevision` and `sourceRevision`
to pin the approvals in a subsequent plan.

```sh
node cli/ink-studio.js pixel-art multiview gate-ink.json views.json \
  --out multiview.json --review multiview.html --patch hinge-edit.json
```

Equal values share the chart cell. Different values at the same
`[column,row]` need a choice. Add an override such as
`{"cell":[12,10],"view":"quarter","pixel":[73,51]}` to `overrides`.
To choose by measured camera facing instead, set `"resolve": "facing"`
and use the optional view `weight` to favor one camera. Rejected marks
also require review. The tool flags protected and stale pixels, missing
source addresses, and hits outside the visible chart. It writes a patch
when every approved mark has a verified destination and every conflict
has a choice.

The HTML review switches between the actual before and proposed native
renders for each camera. View seam overlays show neighboring pixels that
received different values from different cameras. Chart edge overlays
identify approaches to the neighboring rest chart. Possible bleed marks
changes to the selected signal outside the resolved chart cells, including
where a splat footprint carries a change beyond its intended boundary. These
are review signals and can include intentional boundaries.

Apply the reviewed patch through the standard edit path. It writes the
updated scene to a separate file and records one receipt for all the
stamps. The same patch can be applied through the pixel editor API in
one undoable transaction.

```sh
node cli/ink-studio.js pixel-art edit gate-ink.json hinge-edit.json \
  --scene gate.json --out gate-painted.json
```

## Paint individual material channels

Give each `surface-channel` destination a channel on the bound solid's
rest chart. For example, a named mask on the gate's front chart uses this
destination.

```json
{"id":"gate-serial","kind":"surface-channel","binding":"gate","chart":"front","channel":"mask:serial"}
```

Declare the available names on the solid with `surfaceState.masks`, for
example `["serial", "seal"]`. Paint those masks independently of the
material's visible color.

| Channel | Brush value | Where it is used |
| --- | --- | --- |
| `pigment` | A palette swatch ID such as `"mint"` | Exact indexed pigment with the swatch ID and its color recorded together |
| `roughness` | A number from 0 to 1 | Specular roughness. Native splat shading uses 17 steps. Registered bakes sample the authored value |
| `emission` | Linear RGB such as `[0, 1.6, 0]`, with components from 0 to 64 | Emission signal and visible glow |
| `normal` | A tangent-space vector such as `[0.35, 0, 1]`, with a nonnegative Z component | Shading normals |
| `opacity` | A number from 0 to 1 | Native visibility and exported base-color alpha |
| `mask:<name>` | A number from 0 to 1 | Source sampling and a separate grayscale map in the registered bake |

Use `operation.stamp.value` in an edit or `marks[].value` in a
multiview plan. Indexed pigment also accepts `marks[].swatch`. Ink
resolves the swatch against the pixel document and records the exact
color in the applied stamp. `mode: "clear"` removes that channel's
override over the brush footprint. The scalar and vector overrides blend
by brush coverage. Indexed pigment applies at half coverage or higher.

Sample the committed chart with `pixel-art sample --mode source`. A
pigment sample returns its swatch and color. A roughness, emission,
normal, or opacity override returns its value and coverage, or `null`
where the base material is in use. Unpainted named masks return zero.
For texture and glTF export, see [Registered material baking](registered-material-bake.md).

## Navigate craft diagnostics

Open **Craft diagnostics** below the canvas in the Pixel Stamp Workshop or
an exported offline review. Filter by finding, then use **Jump to finding**,
**Previous**, or **Next** to center the region and open its pixel inspection.
The amber mark shows which native cells triggered the check. The 1× preview
keeps showing the artwork. In the Workshop, **Select unprotected pixels**
turns those cells into an ordinary editing selection.

The linter groups isolated pixels, doubles in thin stepping lines, uneven
staircase runs, banding, one-point tangent contacts, and small enclosed
transparent holes. It checks the committed frame. Use the active layer view
in the Workshop to lint a cel by itself. Reference layers are ignored in the
composite analysis. Each finding is a candidate for review. A one-pixel
highlight, a tangent, or a small hole can be deliberate. **Include protected**
brings fully protected findings into view for inspection.

```sh
node cli/ink-studio.js pixel-art lint design.json --frame front --kind hole
node cli/ink-studio.js pixel-art lint design.json --cel front/ink \
  --finding double-12-8 --out finding.json
```

Use `editor.lint({ frame, layer, kind, finding })` for the same report in the
SDK. The `diagnostics` list provides IDs, native bounds, affected layers,
and complete `[row, column, length]` runs. A finding that touches a protected
detail also provides the runs available for selection. IDs refer to the
current frame and revision. Run the linter again after changing the art.

## Clean up a selected area

In the Workshop, select an area in the active layer and open
**Clean up selected pixels** under **Adjustments**. Use **Preview cleanup**
to see the repaired art and a table of every changed coordinate with its
before and after swatch, RGB, and alpha. Apply the preview as one undoable
edit, or cancel it to return to the original art.

| Operation | Selection and result |
| --- | --- |
| Stair | Select one thin, monotone staircase in a single swatch. Include the nearby empty cells that the repair can use. Ink evens the steps between the original endpoints and carries each pixel's coverage to its new position. |
| Fragment | Select a single isolated painted pixel. Ink recolors it to join a neighboring cluster and preserves its alpha. Choose a neighboring swatch explicitly if two clusters have equal support. |
| Outline | Select the inside corners flagged as doubles. Ink removes extra pixels where the thin stroke stays connected. |
| Cluster | Include part of one four-connected swatch cluster. Grow into selected empty neighbors or shrink selected edge pixels by one step. Shrink preserves connectivity and grow preserves the gap between separate clusters of the same swatch. |

The selection is the write boundary. Cleanup can read the surrounding
art to judge continuity. Each repair targets one cel. A protected or
clipped write or an exceeded pixel budget rejects the whole repair.
The default budget is 64 changed pixels. Choose a budget from 1 to 256
and select up to 2,048 pixels.

Send a raster cleanup operation through the normal `pixel-art preview`,
`edit`, and `replay` commands, or use the same operation with the SDK.

```json
{
  "id": "thin-visor",
  "revision": "<revision from pixel-art validate>",
  "frame": "front",
  "operation": {
    "tool": "cleanup",
    "kind": "outline",
    "layer": "ink",
    "selection": "visor-edge",
    "maxChanges": 4
  }
}
```

Use `pixels: [[x,y],...]` in place of a saved `selection`. Use a top-level
`cel` ID in place of the operation's `layer` to address a specific cel.
A cluster operation also needs `mode: "grow"` or `mode: "shrink"`.
For fragment or cluster cleanup, `at: [x,y]` picks the seed inside the
selection. Fragment cleanup accepts an optional destination `swatch`.

The preview and receipt include the complete authored diff in the target's
`changes` array, including changes beneath other layers. Each side carries
its swatch ID, RGBA bytes, and cell state. The regular preview also shows
the resulting composite changes.

## Author asset-specific art rules

Keep art rules in the version 2 pixel document. Define profiles for
characters, props or shots, then bind each to a layer, frame, named shot,
or scene target. A layer binding also covers its child layers. Rules and
their named exception masks travel with the exported layer deck.

The example uses existing palette ramps named `suit` and `dusk`, swatches
named `navy`, `steel` and `ink`, and a saved selection named `visor-glint`.

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "courier",
      "ramps": ["suit"],
      "outline": { "mode": "silhouette", "swatch": "ink" },
      "dither": { "pattern": "bayer", "pairs": [["navy", "steel"]] },
      "edge": { "mode": "hard" },
      "exceptions": [{
        "id": "visor-highlight",
        "check": "orphan",
        "selection": "visor-glint",
        "reason": "One specular pixel keeps the visor readable at 1×."
      }]
    },
    {
      "id": "evening",
      "ramps": ["dusk"],
      "outline": { "mode": "off" },
      "edge": { "mode": "area", "strength": 0.65 }
    }
  ],
  "bindings": [
    { "profile": "courier", "layer": "courier", "select": { "object": "courier" } },
    { "profile": "evening", "layer": "courier", "select": { "object": "courier" }, "shot": "night-arrival" }
  ]
}
```

Put this object in `artRules` or commit it with the
`document:art-rules` destination and an operation of the form
`{"artRules":{...}}`. Use `{"artRules":null}` to remove the rules.
The normal preview, undo, and receipt replay commands track the change.

The last matching declaration for each of palette, outline, and edge wins
within a scope. Layer or scene targets take precedence over general
defaults. A shot-specific binding follows base bindings in the same
scope. Add both `layer` and `select` to share one binding between document
review and the scene renderer. A binding with only `select` applies to the
scene. A binding with only `layer` applies to the document. A `frame` or
`shot` restricts either binding to that context.

- **Ramps** list permitted indexed swatches. Outline paint may use its
  declared line swatch alongside those ramps.
- **Outline** supports `off`, `silhouette`, and `selective`. Selective
  outlines can enable or disable `crease` and `boundary`. Name an outline
  swatch so the raster linter can identify authored line pixels.
- **Dither** lists symmetric pairs chosen from the permitted ramps. An
  empty list keeps every swatch solid. The scene renderer supports its native
  patterns, including Bayer and blue noise. The raster linter checks
  visible alternating 2×2 patches where the indexed pair is identifiable.
- **Edge** uses `hard` for center-sampled edges or `area` for coverage
  filtering where the renderer supports it. The raster check looks for
  partial coverage on hard boundaries.
- **Exceptions** name a craft check and give a reason. Omit the mask to
  accept that check across the matching profile. Accepted findings stay
  inspectable under **Include accepted** in Craft diagnostics.

Use the Workshop's **Art shot** selector or inspect rules and violations
through the CLI. `pixel-art rules` also reports the native scene look
settings. `render` can use the same rules for the named scene geometry.

```sh
node cli/ink-studio.js pixel-art rules design.json --frame front --layer courier --art-shot night-arrival
node cli/ink-studio.js pixel-art lint design.json --frame front --art-shot night-arrival
node cli/ink-studio.js pixel-art canvas design.json --art-shot night-arrival --out review.html
node cli/ink-studio.js render scene.json --art-rules design.json --art-frame front --art-shot night-arrival --out night.png
```

The headless scene adapter uses Ink's existing palette constraints, line
styles, and selective edge filter. Edge supersampling applies to eligible
splats and finite curves. Existing explicit render overrides still take
precedence. Render recipes record the source document and selected scope.

## Check motion at native art resolution

Open **Motion checks** in the Workshop to review committed animation frames.
**Show finding** jumps to the flagged frame and outlines the affected art
pixels. Use **Compare sample** to jump to the same evidence in the surrounding
frames and read its RGBA. The 1× view shows the source artwork.

The checks group evidence on the native grid.

- **Highlight drift** pairs nearby small clusters of the same color, size,
  and owner. By default it looks for bright accents beside darker pixels.
  Supply `highlights` as hex colors to name the highlights to track.
- **Unstable clusters** flag splits or merges of overlapping,
  four-connected clusters with the same color and owner.
- **Lost gaps** flags small enclosed openings of up to nine pixels and
  named protected gaps when their previous transparent cells fill.
  A plan can also name open gaps with `gaps: [[x,y],...]` on a sample.
- **Flicker** flags a pixel that changes abruptly and returns to its
  previous RGBA over three comparable samples. Cuts break that chain.

```sh
node cli/ink-studio.js pixel-art motion walk.json --out motion.json --review motion.html
node cli/ink-studio.js pixel-art motion walk.json --plan walk-check.json --layer ink
node cli/ink-studio.js pixel-art motion scene.json --views cameras.json --subject courier --w 160 --h 96 --review camera-review.html
```

Without a plan, the document path checks its frames in order. The Workshop
and CLI use a single registration guide, or a single pivot if no
registration guide exists. Registration shifts must be whole art pixels.
If a frame needs a specific guide, choose it by ID in a version 1 plan.

```json
{
  "version": 1,
  "samples": [
    { "frame": "plant", "guide": "foot-a" },
    { "frame": "rise", "guide": "foot-b" },
    { "frame": "land", "guide": "foot-c" }
  ],
  "settings": {
    "highlights": ["#ffe2a0"],
    "drift": 0.5,
    "ignore": [
      { "sample": "rise", "kind": "flicker", "rect": [11, 7, 2, 1], "reason": "The visor blinks on this pose." }
    ]
  }
}
```

For rendered views, each sample instead needs `id`, `time`, and optional
`camera` fields such as `yaw`, `pitch`, `dist`, `target` and `ortho`.
Provide explicit `anchor: [x,y]` coordinates to register moving views,
or use `settings.alignment: "surface"` to follow the renderer's valid
mesh, traced surface, and splat part motion. Surface alignment tracks
visible paint. Use registered alignment for transparent gaps. Use
`"screen"` to compare fixed screen positions. Mark the first sample after
a cut with `"cut": true`. The report records skipped transitions, accepted
observations with reasons, and any capped findings. One review accepts up
to 128 samples and eight million total art pixels.

The SDK exposes `editor.motion({ plan, layer })` for an animation document.
Use `KIT.pixelMotionChecks.audit(samples, settings)` with aligned RGBA
buffers from other capture tools.

## Inspect, revise and reuse

`pixel-art draw` writes the same diagnostics in `report.json`, along with
swatch use and up to 128 annotated example coordinates per category.
Examples name the visible drawing layer and swatch and the drawing
directly underneath. The overlay highlights every editable finding.
Protected marks are counted separately. The top-level `metrics` retain
the critic's raw values.

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
