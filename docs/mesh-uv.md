# UV inspection and editing

Inspect the artist's UV layout before baking or reducing a mesh.
Use [registered material baking](registered-material-bake.md) to export
the material channels and approved camera paint on that layout.

```sh
node cli/ink-studio.js mesh-uv inspect relay.glb --atlas 1024,512 \
  --padding 6 --out relay-uv-review
```

The command reads OBJ face-corner `vt` coordinates, glTF or GLB vertex
`TEXCOORD_0`, or indexed geometry JSON with `points`, `triangles` and
one `uvs` row per triangle. For glTF and GLB, select another authored
attribute with `--uv-set N`. The report measures the selected raw layout
in a single atlas domain. For independent texture sheets, inspect each
sheet's faces as a separate input. OBJ V is converted to Ink's top-down
texture coordinates. Use the intended texture dimensions for accurate
measurements. A single `--atlas` value specifies a square and the default
is 1024 × 1024.

- **atlas.svg** shows UV charts, stretch, texel density, overlap, padding,
  and chart-edge positions. The edge view distinguishes UV cuts, open
  boundaries, and explicitly protected edges.
- **seams.svg** shows the same edges on an isometric mesh view.
- **report.json** gives face indices, chart membership, overlap pairs,
  gutters and both UV sides of each positional seam. Missing UVs,
  degenerate triangles and UVs outside the [0, 1] tile have separate
  counts.

Stretch is the ratio of maximum to minimum local UV scale, with texture
width and height accounted for. A ratio of 1 means isotropic scale.
Density is texels per scene unit, computed as the square root of UV area
in texels divided by surface area. Triangles that touch at an edge or
point have zero overlap area. Padding checks the available space from a
chart to the texture border and to other charts. Neighbor distances are
reported when they fall below the requested minimum.

Pair checks have independent work budgets for overlap and padding.
`--max-checks` sets each budget. A report with `complete: false` contains
the checks completed so far. Large previews sample faces and edges.
The JSON retains all face metrics and records up to 4,096 example pairs
per diagnostic.

## Register a tileset image

Import a PNG into an editable scene and give it a stable ID.

```sh
ink-studio tileset import masonry.png --scene gatehouse.json --id masonry --out gatehouse-tiles.json
```

The output scene includes the image in its `tilesets` library. Several mesh
materials can refer to it. On an existing `topologyMeshes` material, set
`texture` to a tileset reference and keep the face's existing UVs.

```json
{"id":"painted-stone","texture":{"tileset":"masonry"}}
```

The reference uses the same top-down UV coordinates and alpha cutoff as an
inline mesh texture. PNGs up to 2048 texels on each side are accepted.
Indexed PNGs retain their palette order, texel indices, and transparency.
Other PNGs are stored as RGBA8. A version 1 entry contains its dimensions,
an encoding, and base64 data in top-down order. An indexed entry also
stores an RGB24 palette and any per-slot alpha bytes. Each mesh's existing
atlas budget applies.

In Node, call `ink.readTilesetImage(file)` and pass the result to
`editor.registerTileset("masonry", image)`. The reader also accepts PNG
bytes. Registration can be undone in the scene editor. Registering the same
image under the same ID is idempotent. A different image under that ID
requires a new ID.

### Create a blank tileset

```sh
ink-studio tileset create --width 48 --height 32 --background '#31728580' \
  --scene gatehouse.json --id window-glass --out gatehouse-tiles.json
```

Set each edge from 1 to 2048 texels. Use `transparent` (the default),
`#rrggbb` for an opaque color, or `#rrggbbaa` for exact RGBA bytes.
The same color covers the whole image. The resulting RGBA8 entry can
serve as a mesh material's texture just like an imported image.

In Node, pass `ink.createBlankTileset({ width:48, height:32, background:'#31728580' })`
to `editor.registerTileset(id, image)` as the image argument.

### Pick an exact texel rectangle

Use zero-based `x` and `y` from the top-left corner and positive integer
dimensions. The entire rectangle must fit in the selected tileset.

```sh
ink-studio tileset pick --scene gatehouse-tiles.json --id masonry \
  --x 48 --y 0 --width 48 --height 16 --out sign-selection.json
ink-studio tileset pick --scene gatehouse-tiles.json --id masonry --out pick-masonry.html
```

Open the HTML file offline. Drag from either corner on the art grid or
enter X, Y, Width, and Height in the fields. A click selects one texel.
The selected bounds are shown on the grid and can be downloaded as the
same version 1 JSON returned by the numeric command. Supply all four
values with HTML output to set the initial selection.

In Node, call `ink.pickTilesetRectangle(scene, "masonry", { x:48, y:0, width:48, height:16 })`.
A selection addresses the source image's texels.

### Place a painted tile as a mesh face

Use a saved exact selection or supply `--id`, `--x`, `--y`, `--width`,
and `--height` to place a painted rectangle. Give the polygon its own
face ID and choose an existing or new editable mesh.

```sh
ink-studio tileset stamp --scene gatehouse-tiles.json --selection sign-selection.json \
  --object entrance --face painted-sign --origin 0,2,0 --out gatehouse-sign.json
```

The origin is the lower-left corner in scene units. The default right
and up directions are +X and +Y. Pass perpendicular XYZ directions with
`--right` and `--up` to change the plane and winding. Face dimensions
are crop dimensions times `--brush-scale` divided by texels per unit.
Density comes from `--texels-per-unit`, the scene, the project, or the
default of 16, in that order.

To use the scene's [construction plane](mesh-topology.md#set-a-construction-plane),
pass `--plane U,V` in place of an explicit origin and axes. The lower-left
corner uses that plane grid coordinate and the face follows its right and up
directions. Use a [camera pick or axis lock](mesh-topology.md#pick-and-lock-a-plane-from-the-camera)
or [hinge it on an existing edge](mesh-topology.md#tilt-a-plane-from-an-existing-edge)
to set that frame before stamping.

Add `--snap-grid` to round a fractional plane address using the saved
[grid increments and rounding mode](mesh-topology.md#set-grid-increments-and-rounding).

The quad has four editable vertices and stable face corners. Its pigment UVs
address the first and last texel centers in the crop, including when an axis
has only one texel. The face uses the sheet through a shared material slot.
The default slot is `tileset/<sheet-id>`. Use `--material` to select or
create another compatible slot. The face binding records the exact source
rectangle and atlas size. Atlas swaps and canvas edits report source
binding migrations, and exact deduplication redirects the source sheet.

Omit `--out` to preview the face, corners, source binding, and any conflicts.
The earlier `tileset place` spelling accepts the same inputs. To move an
existing corner, use [the vertex move command](mesh-topology.md#move-one-vertex)
with its vertex ID from the stamp preview.

In Node, call `editor.planTilesetFace(request)` or `editor.placeTilesetFace(request)`
with `object`, `face`, and a version 1 `selection` from the picker. Optional
fields are `origin`, `right`, `up`, `part`, `material`, `texelsPerUnit`,
and `brushScale`. One undo removes the placement and its source binding.
Run `node examples/tileset-pick/place-face-demo.cjs tile-placement-demo` to
place painted masonry and trim and inspect their retained source references.

### Create a painted face from existing vertices

Use `tileset face` to fill a gap with a triangle or quad. The selected
vertices keep their IDs and positions. Give the face a new ID and supply
the current exact crop or an eyedropped crop with `--selection`.

```json
{
  "object": "entrance",
  "face": "gable",
  "vertices": ["left-eave", "right-eave", "ridge"]
}
```

```sh
ink-studio tileset face gable.json --scene gatehouse.json --selection paint.json
ink-studio tileset face gable.json --scene gatehouse.json --selection paint.json --out roofed.json > gable-receipt.json
ink-studio mesh-topology select roofed.json annex-query.json --object entrance --out annex-vertices.json
ink-studio tileset face annex.json --scene roofed.json --vertices-file annex-vertices.json --selection trim.json --out finished.json
```

An array of vertex IDs gives the corner order directly. With a saved
vertex-domain selection, Ink infers a ring from the dominant projection
and uses compatible winding where it shares a boundary. Supply
`order` as an exact permutation of that selection to choose the starting
corner and winding. A saved selection checks the topology revision. For
an explicit array, the optional `revision` checks the same revision.
The preview reports the ordered IDs, the face normal, shared edges,
pigment UVs, and any conflicts with existing faces.

The quad uses crop corners in lower-left, lower-right, upper-right,
upper-left order. The triangle uses lower-left, lower-right, and
upper-left. `paint` can rotate or reflect the crop and `uvInset` can
adjust its texel edges. The selected vertex positions set the world
shape. The source binding lets you reuse the crop with eyedrop, reskin,
and atlas moves.

In Node, use `editor.planTilesetFaceFromVertices(request)` to preview and
`editor.createTilesetFaceFromVertices(request)` to apply the face and
source binding in one undoable edit. Run
`node examples/tileset-pick/face-from-vertices-demo.cjs painted-closures`
for a triangle and quad built on the same facade.

### Select tiles, edges, vertices, or instances

`tileset select` queries one domain at a time. A tile is an editable
face with a retained tileset source binding. Edge and vertex queries
use the authored topology. Instances are scene placements of prefabs
or asset parts and use keys such as `prefab:gate-post`.

Use `edit` to see which selection domains a tool accepts. Leave out
`domain` to return the enabled list by itself. Set `enabledDomains`
to narrow the tool's list for your current operation.

| Edit | Enabled domains |
| --- | --- |
| `inspect`, `snap-origin` | `tiles`, `edges`, `vertices`, `instances` |
| `eyedrop`, `reskin` | `tiles` |
| `grow`, `tilt-plane` | `edges` |
| `move-vertex` | `vertices` |
| `mesh-transform` | `tiles`, `edges`, `vertices` |
| `stamp`, `place`, `stroke`, `rectangle`, `brush-run`, `primitive` | `[]` |

Save a query such as this one in `trim.json`.

```json
{"edit":"reskin","domain":"tiles","object":"wall","query":{"ids":["trim"]}}
```

```sh
ink-studio tileset select trim.json --scene wall.json --out trim-report.json
ink-studio tileset select corner.json --scene wall.json --topology-out corner-selection.json
ink-studio mesh-topology transform wall.json move.json --object wall --selection corner-selection.json --out moved.json
```

Set `object` and optionally `part` for the mesh domains. Pass a
[topology query](mesh-topology.md#select-authored-components) under
`query` to use ID filters, traversal, visibility, or a previous native
selection as `from`. Use `--view` or `--visibility` for a visible or
hidden filter. Tile reports include the atlas crop and binding ID.
`--topology-out` writes the ordinary revision-checked mesh selection,
with `faces` as the native domain for tiles. Use `mesh-topology select`
for explicit conversions between mesh domains.

For instances, omit the mesh and use `query.kind` to choose `prefab`
or `asset-part`. An ID shared by both kinds requires a kind when
selected by name. Each result includes the resolved world origin
used by the construction plane's instance snap.

In the SDK, use `editor.selectTilesetComponents(request, {visibility})`
or `selectTilesetComponents(scene, request, {visibility})`. Run
`node examples/tileset-pick/component-domains-demo.cjs selection-demo`
to inspect four independent selections on the same scene and replay a
vertex move from the saved selection.

### Select visible or through the view

Tile, edge, and vertex queries support view filtering. Set
`query.filter.visibility` to `"visible"` for components supported by
frontmost pixels on the native art grid. Use `"through"` for components
projected inside the same camera view, including those behind another
surface. Through selection respects the view edges and depth planes.

```json
{
  "domain": "tiles",
  "object": "wall",
  "query": {"filter": {"visibility":"through","backfaces":"exclude"}}
}
```

Set `backfaces` to `"include"` or `"exclude"` in either mode. The
default is `"include"`. Winding is evaluated against the active camera.
An edge or vertex passes the front-facing filter when it has support
from a qualifying front-facing triangle. In visible mode, a rejected
backface can still occlude components behind it.

```sh
ink-studio tileset select through.json --scene wall.json --view view.json --topology-out tiles.json
```

The CLI captures the required evidence when given `--view`. To reuse
one view across several queries, save `visibility` from
`captureMeshTopologyVisibility(world, object, view, {participation:true})`
and pass it with `--visibility` or the SDK's `visibility` option.
The same filter works in `mesh-topology select`. Captures must match
the scene object and topology revision. Recapture after camera, pose,
or occluder changes.

Run `node examples/tileset-pick/through-selection-demo.cjs through-demo`
to compare both modes with backfaces included and excluded.

### Select geometry with a marquee or brush

Set `query.region` to a `marquee` with an integer `[x, y, width, height]`
or a `brush` with a path of `[x, y]` points and a radius. Coordinates
are native view pixels measured from the upper-left edge. Pixel centers
are at half-integers. A brush sweeps a disk continuously between its
points. A single point makes one dab.

```json
{
  "domain": "tiles",
  "object": "wall",
  "query": {
    "operation": "add",
    "region": {"type":"brush","points":[[19.5,31.5],[48.5,31.5]],"radius":3},
    "filter": {"visibility":"through","backfaces":"exclude"}
  }
}
```

The region defaults to visible selection. Through mode tests projected
geometry against the same pixels. A face needs a covered pixel center.
Edges and vertices use the one-pixel support used by view selection.
`--view` captures the region for the current scene. To reuse saved
evidence, pass the same `region` to
`captureMeshTopologyVisibility(world, object, view, {region, participation:true})`.

`replace` is the default. `add` and `subtract` take a saved selection
`from` the same domain and topology revision, plus a region or IDs.
`invert` takes a saved selection and returns its complement in the
current domain and filter. For tiles, this universe is the set of faces
with retained tile bindings. Use `--from` to load a native saved pick.

```sh
ink-studio tileset select marquee.json --scene wall.json --view view.json --topology-out first.json
ink-studio tileset select add.json --scene wall.json --view view.json --from first.json --topology-out combined.json
ink-studio tileset select to-edges.json --scene wall.json --from combined.json --topology-out edges.json
```

For `to-edges.json`, use `{"domain":"tiles","object":"wall","query":{"convert":"edges"}}`.
Use `"convert":"vertices"` for corners. Conversion uses the incident
authored components of the resultant faces. The requested edit must
enable both domains. The native `mesh-topology select` command accepts
the same `region`, `operation`, and `convert` fields directly.

Run `node examples/tileset-pick/region-selection-demo.cjs region-demo`
to replay a marquee, a brush addition and subtraction, inversion,
and both conversions on the same mesh.

### Select faces from a tileset rectangle

Save an exact rectangle with `tileset pick` and pass it to
`tileset select-atlas`. The query reads authored face-corner UVs from
the mesh's pigment layout and checks the sheet assigned by each face's
material. Faces with the same UV numbers on a different sheet are
outside the query. A face can qualify with or without a saved stamp binding.

| Mode | Face qualifies when |
| --- | --- |
| `match` | Its UV footprint is the picked rectangle. Rotated and reflected paint also matches. |
| `inside` | All its UV corners lie within or on the rectangle. |
| `touch` | Any part of its triangulated UV footprint intersects the rectangle. Edge and corner contact count. |

Bounds use the first and last texel centers, like a painted stamp.
A one-texel strip can select along a line. UV insets are read from
the actual corners and can make a face qualify for `inside` without
covering the full rectangle for `match`.

```sh
ink-studio tileset pick --scene wall.json --id enamel --x 6 --y 4 --width 12 --height 8 --out pick.json
ink-studio tileset select-atlas pick.json --scene wall.json --object panel --mode touch --out faces.json
ink-studio mesh-topology select wall.json edges-query.json --object panel --from faces.json --out edges.json
```

Set `edges-query.json` to `{"convert":"edges"}`. The atlas report
includes the UV bounds, pigment set, and face IDs. `--out` saves a native
mesh selection for conversion, transforms, and other topology tools.
Call `editor.selectTilesetAtlas({object, selection, mode})` or
`selectTilesetAtlas(scene, {object, selection, mode})` in the SDK.

Run `node examples/tileset-pick/atlas-face-selection-demo.cjs atlas-demo`
to compare all three modes on one atlas and the faces that use it.

Use a saved atlas pick as the seed for a
[normal-angle patch](mesh-topology.md#select-by-geometric-relationship)
when the painted face should lead a connected geometry selection.

### Create weighted tile collections

Save interchangeable tiles as a version 1 collection. Give each entry
a stable `id`, a `weight`, and the exact `selection` JSON from `tileset
pick`. Selections can use different registered sheets. This draft gives
the common brick three times the weight of the worn one.

```json
{
  "id": "brickwork",
  "entries": [
    {"id":"common","weight":3,"selection":{"format":"ink-studio/tileset-selection","version":1,"tileset":"masonry","x":0,"y":0,"width":16,"height":16}},
    {"id":"worn","weight":1,"selection":{"format":"ink-studio/tileset-selection","version":1,"tileset":"masonry","x":16,"y":0,"width":16,"height":16}}
  ]
}
```

Use finite, nonnegative weights. A zero weight keeps an entry in the
collection while disabling it. At least one weight must be positive.
`inspect` shows the probability for every entry and validates the
rectangles against the current scene sheets. Collections reference exact
coordinates, so update their selections when you move the source art.

```sh
ink-studio tileset collection create draft.json --scene wall.json --out bricks.json
ink-studio tileset collection inspect bricks.json --scene wall.json
ink-studio tileset collection sample bricks.json --scene wall.json --seed 42 --key course-2-brick-3 --out pick.json
ink-studio tileset stamp --scene wall.json --object wall --face brick-2-3 --selection pick.json --out painted.json
```

Sampling uses the collection ID, integer seed, and caller-supplied key.
Stable keys such as grid addresses reproduce the choice regardless of
entry order or where you start sampling. The receipt on stdout records
the chosen entry, weight, probability, and pick. `--out` saves only the
pick for existing stamp and primitive commands.

Use `createTilesetCollection(scene, draft)`,
`inspectTilesetCollection(scene, collection)`, or
`sampleTilesetCollection(scene, collection, {seed, key})` in the SDK.
Run `node examples/tileset-pick/weighted-collection-demo.cjs brick-demo`
to assemble a wall with common, worn, and mossy brick variants.

### Play a tile collection in sequence

Add a `sequence` array of entry IDs to the collection draft and save it
with `tileset collection create`. Repeat an ID anywhere it belongs in
the motif. An entry with weight zero can still play in the sequence.

```json
"sequence": ["plain", "seam", "crest", "seam"]
```

`tileset collection play` resolves one step and can save a pick for the
ordinary `stamp` command. Steps are zero-based and loop after the last
entry. The receipt includes the requested step and its index in the
authored sequence.

```sh
ink-studio tileset collection play facade-tiles.json --scene wall.json --step 6 --out pick.json
```

Use the collection directly in a draw stroke or a rectangle fill. Set
`sequenceStart` in the request to change the first step. The default
is zero. In the SDK, pass the saved document as `collection` in the
request, or call `playTilesetCollection(scene, collection, {step})` to
resolve one pick. The collection takes the place of `selection`.

```json
{"mode":"fill","id":"frieze","object":"wall","from":[0,0],"to":[11,0],"sequenceStart":2}
```

```sh
ink-studio tileset rectangle frieze.json --scene wall.json --collection facade-tiles.json
ink-studio tileset rectangle frieze.json --scene wall.json --collection facade-tiles.json --out frieze-wall.json
```

Rectangles follow increasing U within each row, then increasing V.
Strokes follow the path at the requested interval. Occupied cells and
repeated positions retain their place in the pattern, so they do not
shift later picks. The preview lists each placed variant and its step.
Rectangle tiles fill the grid cell. Stroke tiles use their normal
brush size and scale. Variants from different sheets use their own
material slots. A custom `material` can only cover placements from
one sheet. Each committed run is one undoable edit.

Run `node examples/tileset-pick/sequence-collection-demo.cjs facade-demo`
to render three courses from the same authored pattern at different offsets.

### Randomize permitted brush orientations

Add an `orientations` list to the collection draft to opt in. Include
every paint transform you want the brush to choose, including `{}` if
the original orientation should be eligible. The example permits the
original paint, a quarter turn, and a horizontal reflection. Choices
are equally likely. Equivalent transforms are rejected.

```json
"orientations": [{}, {"rotation":90}, {"flipX":true}]
```

Rotations use 0, 90, 180, or 270 degrees. `flipX` and `flipY` reflect
the paint before rotation. The geometry keeps its original size,
orientation, and position. Pick a smaller set for directional art such
as lettering, bricks, or roof shingles.

`tileset collection sample` uses its existing seed and key to choose a
tile by weight, then picks its paint orientation independently. Supply
`--seed` to `tileset collection play` when the authored sequence also
uses orientations. Both commands save a regular selection with the
resolved paint and choice provenance. A stamp accepts the saved file
and includes that information in its edit receipt.

```sh
ink-studio tileset collection sample leaves.json --scene garden.json --seed 42 --key path-3 --out leaf.json
ink-studio tileset stamp --scene garden.json --object path --face leaf-3 --selection leaf.json --out stamped.json
ink-studio tileset collection play shingles.json --scene roof.json --step 6 --seed 42 --out shingle.json
```

For a stroke or rectangle fill, supply the saved collection and put
`"seed":42` in the request. Placement uses the sequence when present
and weighted sampling otherwise. Set `"collectionMode":"weighted"` to
sample by weight even when the collection has a sequence. Weighted
placements use their zero-based sample or cell index as the key. The
receipt records the run seed and each placed variant and orientation.
Choose either a collection’s orientations or an explicit `paint` in an
edit request. In the SDK use `sampleTilesetCollection` or
`playTilesetCollection` with the same settings, or pass `collection`
and `seed` directly to the existing stroke and rectangle methods.

Run `node examples/tileset-pick/collection-orientation-demo.cjs garden-demo`
to compare the same tile layout with fixed and seeded paint.

### Draw and erase a run of painted faces

Give a stroke a path of construction-plane `[u,v]` addresses and an
`interval` in scene units. Sampling starts at the first address and
continues at fixed distances around bends. The endpoint is sampled
when it lands on the interval. The saved grid increments determine
the physical length of each path segment. Set `snapGrid:true` to
round the sampled positions using the plane's stored rounding mode.
A stroke accepts up to 4,096 waypoints and 4,096 samples.

Save a draw request such as the following in `draw.json`. The selection
is the version 1 JSON from `tileset pick`.

```json
{
  "mode": "draw",
  "id": "course",
  "object": "entrance",
  "interval": 1,
  "path": [[0, 0], [5, 0]],
  "selection": {
    "format": "ink-studio/tileset-selection",
    "version": 1,
    "tileset": "masonry",
    "x": 0, "y": 0, "width": 16, "height": 16
  }
}
```

Each draw sample stamps the lower-left corner of an editable polygon
with its own stable face ID derived from the stroke ID and sample
index. A repeated position within the stroke is skipped. Draw also
accepts the stamp's `material`, `texelsPerUnit`, and `brushScale`
settings. Both modes accept `part` to check the target mesh part.

For erase, use the same path fields with `"mode":"erase"` and omit
the draw brush fields. Each sample checks the authored polygons of the
named mesh for a coplanar tile face under the point. On a rectangular
face the left and lower edges count as hits. Misses, repeated hits, and
ambiguous overlapping faces are reported and skipped. Erase removes
hit polygons, their tile bindings, and vertices that cease to be used.
Erasing the last polygon removes the mesh entry. A stroke that would
remove the construction plane's anchored edge requires review.

```sh
ink-studio tileset stroke draw.json --scene gatehouse-tiles.json
ink-studio tileset stroke draw.json --scene gatehouse-tiles.json --out drawn.json
ink-studio tileset stroke erase.json --scene drawn.json --out opening.json
```

Omit `--out` for a dry run. The report lists sample distances and
positions, chosen faces, conflicts, topology revisions, and the source
changes. A conflicting draw leaves the input untouched. The CLI
writes each applied stroke as a new scene revision. In Node, call
`editor.planTilesetStroke(request)` or `editor.applyTilesetStroke(request)`.
One call to `editor.undo()` reverses the full stroke and its dependent
changes. Run `node examples/tileset-pick/face-stroke-demo.cjs stroke-demo`
to replay a draw, an erase, and a one-step undo.

### Fill or erase a rectangle of faces

Give `tileset rectangle` two inclusive construction grid cell addresses.
The addresses may be reversed or equal. A request with equal addresses
edits one cell. Set `snapGrid:true` to round fractional addresses using
the saved construction-plane rounding mode.

```json
{
  "mode": "fill",
  "id": "wall-course",
  "object": "entrance",
  "from": [-1, 0],
  "to": [4, 3],
  "selection": {
    "format": "ink-studio/tileset-selection",
    "version": 1,
    "tileset": "masonry",
    "x": 0, "y": 0, "width": 16, "height": 8
  }
}
```

Fill fits the selected texel crop to each empty cell. The saved grid
increments determine each face's width and height in scene units.
Existing coplanar surfaces in the named mesh occupy any cells they
overlap and keep their original geometry and paint. The request can
include a `material` slot or a `part` to check the destination.

For erase, set `"mode":"erase"` and omit `selection` and `material`.
Any positive area overlap with the footprint qualifies a coplanar tile
placement, including a placement that crosses the boundary. Erase
removes the whole face. The preview flags these faces with
`extendsOutside`. Shared edges and corner contacts count as zero area.
The preview also lists coplanar faces without a tile binding.
Each rectangle can cover up to 4,096 cells.

```sh
ink-studio tileset rectangle fill.json --scene wall.json
ink-studio tileset rectangle fill.json --scene wall.json --out filled.json
ink-studio tileset rectangle erase.json --scene filled.json --out window.json
```

The report includes the world-space outline, the cell addresses, the
existing faces in each cell, and their planned actions. `footprint.min`
is the inclusive lower corner and `footprint.max` is the exclusive upper
corner. In Node, use `editor.planTilesetRectangle(request)` or
`editor.applyTilesetRectangle(request)`. An applied rectangle is one
undo entry. Run `node examples/tileset-pick/face-rectangle-demo.cjs rectangle-demo`
to review a fill that preserves existing accent tiles and an erase that
opens a window.

### Repeat a multi-tile brush with overlap and alignment

Use `tileset brush-run` to repeat a
[saved multi-tile pick](#pick-a-brush-of-neighboring-tiles) along the
working plane. Each landed tile is its own editable face. The source
cells retain their original order, atlas coordinates, and saved UV
insets. Atlas gutters contribute no world width or height.

Save a request such as this in `run.json`:

```json
{
  "id": "trim-course",
  "object": "entrance",
  "at": [0, 2],
  "count": 3,
  "direction": "right",
  "spacing": "overlap",
  "overlapTiles": 1,
  "align": "anchor",
  "anchor": [8, 4]
}
```

```sh
ink-studio tileset brush-run run.json --scene wall.json --brush-file trim-brush.json
ink-studio tileset brush-run run.json --scene wall.json --brush-file trim-brush.json --out trim-course.json
```

- `at` addresses the starting point in construction grid steps.
  `snapGrid:true` rounds that point once using the retained grid. Every
  repeat uses the resulting origin and the same physical pitch.
- Set `direction` to `right`, `left`, `up`, or `down` along the plane axes.
  The default is `right`. The default `count` is one stamp.
- `spacing:"abut"` advances by the full compact brush extent on the
  travel axis. `spacing:"overlap"` subtracts `overlapTiles` along that axis,
  defaulting to one. The overlap must be smaller than the brush extent.
  When stamps share a cell in a run, the later stamp supplies its tile.
- `align:"edge"` puts the lower-left corner at `at` for right or up,
  the lower-right corner for left, and the upper-left corner for down.
  `align:"anchor"` aligns a point inside the brush. Give `anchor:[x,y]`
  in compact texels from the top-left of the artwork, or omit it to
  use the center.

Omit `--out` for a dry run. The report includes each stamp's reference
point and origin, its replaced cells, and the final face IDs and source
rectangles. The brush can be supplied inline as `brush` in place of the
`--brush-file` file. A request accepts optional `part`, `material`,
`texelsPerUnit`, and `brushScale`. World scale uses the same retained
brush and scene settings as the stamp tools. A run supports up to
4,096 sampled cells, including replacements.

Use `editor.planTilesetBrushRun(request)` and
`editor.applyTilesetBrushRun(request)` in Node with the inline brush.
One undo restores the whole run. Run
`node examples/tileset-pick/brush-run-demo.cjs brush-run-demo`
to compare abut, overlap, and anchor alignment with the same pick.

### Rotate or reflect the paint before placement

Use `--paint-rotate 90` for a clockwise quarter turn as viewed from the
painted side. Valid angles are 0, 90, 180, and 270 degrees. Use
`--paint-flip-x` to reflect left to right and `--paint-flip-y` to reflect
top to bottom. Reflections apply in source texture coordinates before
rotation.

```sh
ink-studio tileset stamp --scene wall.json --selection sign.json \
  --object facade --face sign --plane 0,0 --paint-rotate 90 --out turned-paint.json
ink-studio tileset stamp --scene wall.json --selection sign.json \
  --object facade --face sign --origin 0,1,0 --right 0,-1,0 --up 1,0,0 --out turned-face.json
```

A paint transform changes which source texel lands at each pigment corner.
The world frame, face dimensions, and winding come from the placement.
A quarter turn on a rectangular face fits the turned paint to that face.
The source binding keeps the original atlas rectangle and the paint
transform. Other UV channels keep their own layouts.

Use `paint: { rotation: 90, flipX: true, flipY: false }` in SDK stamp
requests, draw strokes, rectangle fills, and brush runs. The same paint
record works in the JSON requests for the headless CLI. A brush run can
also read `paint` from its saved brush. Its paint transform turns or
reflects the whole compact block, including its source anchor. A quarter
turn exchanges the stamp's paint rows and columns and fits them into the
original world footprint. Abut and overlap use the resulting cell grid.

```sh
ink-studio tileset pick --scene wall.json --id masonry --brush \
  --x 0 --y 0 --width 48 --height 16 --paint-flip-x --out mirrored.json
ink-studio tileset brush-preview mirrored.json --scene wall.json --out mirrored.png
ink-studio tileset brush-run run.json --scene wall.json --brush-file mirrored.json --out mirrored-run.json
```

The PNG preview shows the compact oriented brush in native texels.
Run `node examples/tileset-pick/paint-orientation-demo.cjs paint-demo`
for a matched comparison of paint rotation, reflection, and face rotation.

### Eyedrop a painted mesh face

Select an authored face by mesh and face ID. The result contains its
atlas rectangle, material slot and definition, pigment UV orientation,
and any effective UV insets. A rectangular face also reports its world
axes separately from its paint orientation. Add `--brush-size` to copy
its current world width and height.

```sh
ink-studio tileset eyedrop --scene wall.json --object facade --face sign --brush-size --out sign-pick.json
ink-studio tileset stamp --scene wall.json --object entry --face sign-copy --selection sign-pick.json --plane 2,1 --out copied.json
```

Omit `--out` from eyedrop to inspect the pick on stdout. Stamp uses the
destination plane or explicit frame. Use `--texels-per-unit` or
`--brush-scale` on stamp to size the copy from the crop. Provide
`--material` to choose a different destination slot. With the picked
slot name, a conflicting definition on the destination requires review.

Eyedrop checks the current pigment corners against the retained source
binding. With no usable binding, it infers a texel rectangle from the
UVs and marks it `uv-inferred`. Nonrectangular UV layouts, active
material bakes, and faces without a tileset return a reason in the review
report. A warped quad with rectangular UVs can supply paint and a
material. An unavailable brush size is reported separately.

In Node, call `editor.eyedropTilesetFace({object,face,brushSize:true})`
and spread the returned `stamp` into a placement request with the
destination object and face. Eyedrop leaves the edit journal untouched.
Run `node examples/tileset-pick/face-eyedrop-demo.cjs eyedrop-demo`
to recover an oriented sign and place it on a second frame.

### Reskin a face in place

Pick one authored face by mesh and face ID. Reskin uses the selected
mode to change its pigment mapping and material assignment.

| Mode | Result |
| --- | --- |
| `crop` | Apply the picked atlas rectangle, paint orientation, and insets to the face's corners. |
| `tileset` | Use the brush's atlas or the named sheet with the existing pigment UVs. A sheet of a different size changes which native texels those UVs address. |
| `relative` | Apply the brush's crop and paint orientation through the face's current UV turn and reflection. |

```sh
ink-studio tileset reskin --scene facade.json --object wall --face panel --mode crop --selection trim.json
ink-studio tileset reskin --scene facade.json --object wall --face panel --mode relative --selection trim.json --out trim-applied.json
ink-studio tileset reskin --scene facade.json --object wall --face panel --mode tileset --id dusk --out dusk.json
```

`--selection` accepts an exact crop, an eyedropped face, or a saved
multi-tile brush. Choose `--column` and `--row` to use one brush cell.
For a pick with gutters, crop and relative modes need a cell.
Tileset mode uses the sheet directly and works on polygons with custom
UVs. Crop and relative modes use a quad. Relative mode reports a
conflict if its paint orientation cannot be determined.

The preview lists the corner UVs, material, and source binding before
and after. A sheet change uses a material variant so other faces can
keep using their original slot. Other authored UV channels keep their
existing layouts. Pinned pigment corners that would move require review.
The edit fits the existing face and keeps its vertex and corner IDs.

In Node use `editor.planTilesetReskin(request)` and
`editor.applyTilesetReskin(request)` with `object`, `face`, `mode`, and
`selection`. For tileset mode, a `tileset` ID can replace `selection`.
One undo restores the original mapping and material. Run
`node examples/tileset-pick/face-reskin-demo.cjs reskin-demo` to compare
the modes on one authored face.

### Grow a tile from a mesh edge

Select a boundary edge by its retained ID and give the new face an ID.
The new quad shares both endpoints and traverses the edge in the
opposite direction to its incident face. Its other two vertices grow
from those endpoints and inherit any endpoint skin weights.

```sh
ink-studio tileset grow --scene wall.json --object gate --edge eave --face roof --selection roof-tile.json --angle -60
ink-studio tileset grow --scene wall.json --object gate --edge eave --face roof --selection roof-tile.json --angle -60 --out folded.json
ink-studio tileset grow --scene wall.json --object gate --edge eave --face trim --selection roof-tile.json --angle -60 --depth .55 --out trim.json
```

The angle is in degrees around the shared edge. Zero extends the face
outward in the incident face's plane. Positive angles use the
right-hand rule along the new face's first edge, as reported in
`sharedVertices`. The command uses a temporary placement frame.

- The default `--sizing proportional` fits the crop's width to the
  edge and scales the depth by the same factor.
- `--sizing brush` uses the brush's world height for depth. This
  can come from the crop's density and brush scale or a sized eyedrop.
- `--depth` sets a depth in scene units. The original edge sets width
  in every mode.

The selection, material, and paint orientation use the same inputs as
`tileset stamp`. Omit `--out` to preview the shared endpoint IDs, frame,
size, and new corners. An edge used by more than one face reports its
incident faces for review. Inspect the source mesh's `document.edges`
to get a retained edge ID.

In Node, use `editor.planTilesetGrow(request)` and
`editor.growTilesetFace(request)` with `object`, `edge`, `face`,
`selection`, and optional `angle`, `sizing`, or `depth`. One undo
restores the boundary and its source bindings. Run
`node examples/tileset-pick/face-grow-demo.cjs grow-demo` to compare
two depths at the same fold angle.

### Add and subtract tiled blocks

Save a block request with an edit `id`, target `object`, and a `mode`
of `add` or `subtract`. Use `at:[u,v,n]` for grid placement. The first
two values are construction-plane grid addresses. The third is an
optional signed distance along the plane normal in scene units.
Give `size:[width,height,depth]` in scene units. Use `snapGrid:true`
to round the grid addresses before placing the block.

```json
{
  "id": "opening",
  "object": "wall",
  "mode": "subtract",
  "at": [1, 0.5, -0.1],
  "size": [1, 1, 1.2]
}
```

```sh
ink-studio tileset block opening.json --scene wall.json --selection trim.json
ink-studio tileset block opening.json --scene wall.json --selection trim.json --out opening-scene.json
```

Use `fromFace` in place of `at` to center the block on an authored
face. Set `depth` to fit its footprint or supply `size` for a custom
footprint. Add extends along the face normal. Subtract starts at the
face and cuts inward.

- `orientation:"fixed"` is the default. The block follows the
  construction plane. On a support face, its first usable grid axis
  is projected onto that face.
- `orientation:"edge-relative"` uses the winding of an edge on the
  support face as the block's right axis. Supply `edge` to select the
  retained edge ID, or use the first edge in topology order.

Each exposed block side uses the selected crop. Pass an exact pick
or eyedropped face with `--selection`, or put the exact `selection`
and optional `paint`, `uvInset`, and `material` in the request.
A matching support footprint welds to the source vertices. A
standalone quad becomes the back of a closed block. Other overlaps
and subtractions use the [mesh Boolean solver](mesh-topology.md#combine-closed-mesh-parts)
and require a closed target. Cut faces get their own atlas bindings.

Omit `--out` to inspect the resolved frame, affected faces, and solver
issues. Use `editor.planTilesetBlock(request)` and
`editor.applyTilesetBlock(request)` in Node. One undo restores the
geometry, materials, and source bindings. Run
`node examples/tileset-pick/tiled-block-demo.cjs block-demo` to build
a wall, raise its crown from an edge-oriented face, and cut an opening.

### Stamp and revise textured primitives

Use `tileset primitive` to stamp a box, wedge, cylinder, cone, or sphere.
The mesh retains shared vertices, editable polygons, face-corner UVs,
and an atlas binding for each face. Boxes and wedges map the crop onto
each side. Round shapes wrap the crop once around the body and use a
separate mapping on any flat caps.

Save a stamp request with a primitive `id`, target `object`, shape
`kind`, and `size:[width,depth,height]` along construction-plane right,
up, and normal. `at:[u,v,n]` is optional and defaults to the plane
origin. Its first pair uses grid addresses and the optional normal
offset uses scene units. Use `snapGrid:true` to round the grid addresses.

```json
{
  "id": "reservoir",
  "object": "props",
  "kind": "cylinder",
  "size": [1.4, 1.4, 2],
  "segments": { "radial": 12, "axial": 3 },
  "at": [2, 1]
}
```

```sh
ink-studio tileset primitive reservoir.json --scene workshop.json --selection enamel.json
ink-studio tileset primitive reservoir.json --scene workshop.json --selection enamel.json --out stamped.json
ink-studio tileset primitive revise.json --scene stamped.json --out revised.json
```

For boxes and wedges, `segments.subdivisions` is the number of
divisions per edge, from 1 to 24. Round shapes use
`segments.radial` from 3 to 128 and `segments.axial` up to 64,
with a minimum of 2 for spheres and 1 for cylinders and cones.
The defaults are one division for flat-sided shapes, 16 radial
segments for round shapes, and 8 axial segments for spheres.

The selection can be an exact crop, a saved multi-tile brush, or an
eyedropped face. Choose `cell:{column,row}` for a brush with atlas
gutters. A request can carry `selection`, `paint`, and `uvInset`.
Paint rotation follows the brush independently of the construction
frame.

To edit saved dimensions or segments, give `revise.json` the same
`id` and `object`, set `mode:"revise"`, and provide the new `size`
or `segments`. Unspecified parameters keep their saved values.
Dimensional edits preserve the authored UVs and individual face
materials. Segment edits recover the current atlas chart, including
after atlas swaps. They report a conflict when manual topology,
mixed paint, or authored corner details would be overwritten.

Use `editor.planTilesetPrimitive(request)` to preview and
`editor.applyTilesetPrimitive(request)` to commit in Node. Stamps
and revisions each use one undo entry. Run
`node examples/tileset-pick/primitive-stamp-demo.cjs primitive-demo`
to compare the five shapes and a sphere revision.

### Extract a crop as a reusable tileset

Use an exact texel rectangle or a saved `tileset pick` selection.

```sh
ink-studio tileset extract --scene gatehouse-tiles.json --id masonry \
  --x 24 --y 24 --width 16 --height 8 --new-id brick --out gatehouse-brick.json
ink-studio tileset extract --scene gatehouse-tiles.json --selection brick-selection.json \
  --new-id brick --out gatehouse-brick.json
```

The new scene has a `brick` tileset whose origin is the crop's top-left
texel. Its grid treats the entire crop as one tile, so you can pick it
from `(0, 0)` or use the full UV range on a mesh face with
`"texture": { "tileset": "brick" }`. Multiple faces can share that
single texture. Extraction copies RGBA8 texels or indexed slots with the
palette and alpha entries intact. The receipt records the source sheet
and rectangle. The output scene also carries the source atlas and its
existing mesh references.

In Node, use `editor.extractTileset(sourceId, newId, { x, y, width, height })`
to add the new image in one undoable edit. Use a different ID for a
different crop.

Run `node examples/tileset-pick/extract-demo.cjs tile-extract-demo` to
copy one brick from the gatehouse atlas and render a wall using it.

### Manage tileset revisions

Run `tileset dependencies --scene scene.json` for the inventory, or add
`--id brick` to inspect one sheet. The report lists mesh face IDs,
material and bake bindings, scene timeline clips, and prefab definitions.
A timeline clip can render any active face in its scene. The report lists
authored clip definitions and whether their containing sequence is reachable.
Prefab reports include placement IDs and cover definitions with zero placements.

```sh
ink-studio tileset clone --scene scene.json --id brick --new-id brick-copy --out cloned.json
ink-studio tileset replace new-brick.png --scene cloned.json --id brick --out replaced.json
ink-studio tileset combine --scene replaced.json --ids brick,trim --new-id walls --axis x --out combined.json
ink-studio tileset deduplicate --scene cloned.json --id brick-copy --keep-id brick --out deduplicated.json
ink-studio tileset remove --scene combined.json --id brick-copy --out cleaned.json
```

Omit `--out` to inspect the planned revision and blockers. Commit writes a
new scene beside its source. Each command reports the affected sheets and
their before and after revision fingerprints.

- **Clone** copies the authored image and tile grid under a new ID.
- **Replace** loads a PNG behind the existing ID. Mesh UVs keep their
  normalized coordinates, and the existing grid must fit the replacement.
  The report identifies dependent material bakes marked for refresh.
- **Combine** packs the requested sheets in order along one axis and
  reports their rectangles in the new atlas. The combined sheet has a
  full-image tile grid. A gap in a shorter sheet's row or column becomes
  transparent. Compatible indexed sheets keep their palette slots when
  they fill the strip. Other combinations use RGBA8. Existing references
  continue to use their source sheets.
- **Deduplicate** redirects references from one exact duplicate to the
  requested retained sheet. Dimensions, encoding, pixels or slots,
  palette and alpha, and the effective grid must match. Mesh materials,
  bake textures, and inline prefab requirements follow the redirect.
  A reference in a shared prefab library needs a library edit first.
- **Remove** requires a sheet with no material, bake, or prefab references.

In Node, use `editor.tilesetDependencies(id)`,
`editor.planTilesetRevision(request)`, and
`editor.editTilesetRevision(request)`. A request has a `type` matching the
command and the relevant `id`, `newId`, `keepId`, `ids`, or `axis`.
A replacement takes an image descriptor in `asset`. The editor journals
the atlas and reference changes together.

Run `node examples/tileset-pick/revisions-demo.cjs tile-revisions-demo`
to review a wall revision, its combined atlas, and the retained clip and
prefab dependencies.

### Link a source image

Link a registered sheet to an external PNG. The scene records the relative
path, refresh mode, and last accepted image fingerprint alongside the embedded
sheet. A linked sheet retains its ID, tile grid, face references, and other
dependencies.

```sh
ink-studio tileset link paint/brick.png --scene scene.json --id brick --out linked.json
ink-studio tileset reload --scene linked.json --id brick
ink-studio tileset reload --scene linked.json --id brick --expect "$reviewed_sha" --out updated.json
```

Omit `--out` for a preview. The JSON review includes the incoming fingerprint
(`incoming.sha256`), changed, added, and removed texel counts, bounds, sample
before and after values, and indexed palette and slot changes. Pass the
reviewed fingerprint as `--expect` to catch file changes between review and
acceptance. Write the accepted revision to a new scene beside its source.

The review flags local paint when the embedded raster has changed since
the last accepted image. To overwrite it, pass `--accept-external` after
reviewing the diff. The same flag approves a first link whose PNG differs
from the embedded sheet. Grid and scene validation still apply. Reload
never writes to the source PNG.

Refresh defaults to `manual`. Pass `--refresh on-load` to `tileset link`
for a sheet that should refresh when the CLI loads a local editable scene.
Changing the mode of an existing link can be done separately from reloading
the image. Automatic refresh uses compatible clean updates in memory. It
reports and uses the embedded sheet if the link is unavailable, the image
dimensions or encoding changed, or the embedded raster has local paint.
An explicit reload persists an accepted revision. Packaged scenes use their
embedded images.

Run `node examples/tileset-pick/source-link-demo.cjs tile-link-demo` to
compare manual refresh, automatic refresh, and a protected local paint edit.

### Swap atlas regions

Exchange two equal-sized, disjoint rectangles in one registered tileset.
Coordinates are integer texels measured from the top left. Omit `--out`
to preview the rectangles and each affected face's pigment UVs. A
successful commit writes a new scene beside its source.

```sh
ink-studio tileset swap --scene wall.json --id brick --a 2,1,4,3 --b 10,5,4,3
ink-studio tileset swap --scene wall.json --id brick --a 2,1,4,3 --b 10,5,4,3 --out swapped.json
```

Raw RGBA bytes or exact palette slots move together. Each face whose texel
footprint fits inside a rectangle follows its paint, including on alternate
pigment UV layouts. To address a texel center on a mesh, divide its column
or row by the corresponding atlas dimension minus one. Faces outside the
swapped regions keep their coordinates.

The preview blocks faces whose sampled bounds cross a swapped region,
pinned corners, UVs shared with other texture data, atlas-wide filters, and
active modifiers on affected meshes. Include any needed gutters in both rectangles.
For a linked sheet, the swap counts as local paint against the last accepted
external image. Publish the rearranged paint to the external source before
accepting another revision over it.

In Node, use `editor.planTilesetCanvas(id, {type:'swap', a, b})` and
`editor.transformTilesetCanvas(id, {type:'swap', a, b})`, with rectangles
defined by `x`, `y`, `width`, and `height`. One undo restores the pixels
and the UVs. Run `node examples/tileset-pick/atlas-swap-demo.cjs tile-swap-demo`
for a comparison of the atlas and matched 1× renders.

### Pick a brush of neighboring tiles

Give the picker a tile width and height in texels. The default grid starts
at the top left of the source sheet. The picker selects whole tiles and leaves any
partial tiles along the right and bottom edges outside the brush.

```sh
ink-studio tileset pick --scene gatehouse-tiles.json --id masonry \
  --tile-width 16 --tile-height 8 --x 48 --y 0 --width 48 --height 16 --out sign-brush.json
ink-studio tileset brush-preview sign-brush.json --scene gatehouse-tiles.json --out sign-1x.png
```

The numeric bounds use texels and must align to tile boundaries.
Use `brush-preview` to check the selected block as a 1× PNG.
The `ink-studio/tileset-brush` record stores the tileset ID, source
rectangle, tile size, and row and column counts. On an unpadded sheet,
tile `[column,row]` uses source origin `[x + column * tileWidth, y + row * tileHeight]` and
the same offset from the brush origin without `x` and `y`. This keeps
the whole arrangement in one record, including transparent cells.

In Node, call `ink.pickTilesetBlock(scene, "masonry", { x:48, y:0, width:48, height:16 }, { width:16, height:8 })`.
Omit the fourth argument to use the sheet’s configured grid.
Use `ink.rasterizeTilesetBrush(scene, brush)` to resolve the saved brush
to its exact RGBA bytes.

Run `node examples/tileset-pick/demo.cjs tileset-pick-demo` for a painted
gatehouse, a blank tileset, and the sign selected as a 3×2 tile brush.

### Set tile dimensions per sheet

Set a shared grid for a scene, then give any sheet its own dimensions.
The values describe one tile in texels. A tile must fit on its sheet,
and a sheet can have leftover texels along the right or bottom edge.

```sh
ink-studio tileset grid --scene gatehouse-tiles.json \
  --tile-width 16 --tile-height 8 --out gatehouse-default-grid.json
ink-studio tileset grid --scene gatehouse-default-grid.json \
  --id window-glass --tile-width 8 --tile-height 12 --out gatehouse-grids.json
ink-studio tileset grid --scene gatehouse-grids.json --id window-glass
ink-studio tileset pick --scene gatehouse-grids.json --id masonry --brush \
  --x 48 --y 0 --width 48 --height 16 --out sign-brush.json
```

The scene stores `tilesetDefaults.tileSize` as a `{ "width": 16, "height": 8 }`
record. A sheet’s `tilesets[id].tileSize` takes precedence. Run
`tileset grid` without edit flags to inspect the effective dimensions and
their source (`default`, `override`, or `unset`). Use `--clear --out <new-scene.json>`
to let a sheet inherit the shared default again or to remove the shared
default when no ID is supplied. Add the tile dimensions to `tileset import`
or `tileset create` to register a sheet with its own grid in one step.

`tileset pick --brush` reads the saved dimensions. Supplying both tile
dimension flags to the picker makes a one-off choice. The plain texel
rectangle and the exact dimensions captured in saved brushes remain usable
after grid edits.

In Node, `editor.tilesetGrid(id)` reports the effective grid.
`editor.setTilesetGrid(id, { width, height })` edits it with undo support.
Use `undefined` for the ID to edit the shared default and `null` for the
size to clear the setting.

Run `node examples/tileset-pick/grid-demo.cjs tile-grid-demo` for a headless
comparison of the same TIDE sign picked from two sheets with different
tile sizes.

### Pick across padded tiles

Set `--padding-x` and `--padding-y` to the gaps between adjacent content
rectangles, measured in whole source texels. Use `--offset-x` and
`--offset-y` for the first cell's origin when the sheet has a leading border.
These settings start at zero. Supply them alongside the tile dimensions
when you configure a grid or specify a one-off pick.

```sh
ink-studio tileset grid --scene painted.json --id masonry \
  --tile-width 16 --tile-height 8 --padding-x 3 --padding-y 2 \
  --offset-x 2 --offset-y 3 --out padded.json
ink-studio tileset pick --scene padded.json --id masonry --brush \
  --x 2 --y 3 --width 54 --height 18 --out sign-brush.json
ink-studio tileset brush-preview sign-brush.json --scene padded.json --out sign-1x.png
ink-studio tileset brush-uv sign-brush.json --scene padded.json --column 2 --row 1
```

The rectangle starts at the first tile's content and ends at the last
tile's content edge. A single tile still spans 16×8 texels. A 3×2 block
spans 54×18 texels in the atlas, including its internal gaps. Its native
brush preview is 48×16. World sizing uses those compact art dimensions
and the brush stores the grid it was picked from.

A cell's source origin advances by tile size plus padding. Its local brush
offset advances by tile size alone. `brush-uv` reports the selected cell's
origin, local offset, and UV bounds using zero-based column and row within
the brush. On a brush with gaps, it defaults to the upper-left cell for
inspection and requires an explicit cell when editing a mesh face. This
keeps faces sampling artwork between the gutters. Saved UV insets on these
brushes apply to each cell's sampling rectangle.

In Node, pass `{ width, height, paddingX, paddingY, offsetX, offsetY }` to
`editor.setTilesetGrid` or as the optional size in `ink.pickTilesetBlock`.
Use `ink.tilesetBrushCellUV(scene, brush, { column, row })` to address one cell.

Run `node examples/tileset-pick/padding-demo.cjs tile-padding-demo` to compare
a padded atlas, the assembled sign, and one tile selected on its own.

### Repack an imported atlas

Use `tileset repack` to write a compact PNG from a uniformly spaced sheet.
Supply the four outside margins and both inter-cell gutters in whole texels,
including any zero values. The declared margins, complete cells, and
interior gutters must account for the entire source image.

```sh
ink-studio tileset repack painted-sheet.png --tile-width 16 --tile-height 8 \
  --margin-left 2 --margin-top 3 --margin-right 2 --margin-bottom 2 \
  --gutter-x 3 --gutter-y 2 --out compact.png --report rectangles.json
```

The command copies each cell in row-major order at its original
resolution, preserving Ink’s RGBA8 texels or indexed slots with their
palette and alpha. The report is printed as JSON and can also be written to a file.
It records both image sizes, the grid, and `rectangleMap.x` and
`rectangleMap.y`. To recover the move for column `c` and row `r`,
combine the `source` starts from `x[c]` and `y[r]` for the old origin
and the `destination` starts for the new origin. The tile width and height
apply to both rectangles. This represents every move without repeating
the same column and row origins for each cell.

Re-import `compact.png` with `tileset import` and the same tile dimensions
to use it as a zero-spacing sheet. In Node,
`ink.repackTilesetImage(input, { tileSize, margins, gutters })` accepts
a PNG path, PNG bytes, or an imported tileset image. It returns a reusable
`tileset` and its rectangle-move `report`.

Run `node examples/tileset-pick/repack-demo.cjs tile-repack-demo` for the
padded TIDE sign, its compact atlas, and the rectangle map.

### Resize a canvas or resample a sheet

`tileset resize` keeps existing texels at their original size. It pads
with transparency or crops at the chosen anchor. The nine anchors run from
`top-left` (the default) through `center` to `bottom-right`.
`tileset resample` uses nearest-neighbor sampling across the whole image
and keeps the faces' normalized UVs. It uses the same sampling for indexed
and RGBA art. Indexed canvas padding uses a transparent palette slot,
adding one if possible. A full opaque palette with new transparent padding
promotes to RGBA8.

```sh
ink-studio tileset resize --scene original.json --id sign \
  --width 96 --height 32 --anchor bottom-right
ink-studio tileset resize --scene original.json --id sign \
  --width 96 --height 32 --anchor bottom-right --out resized.json
ink-studio tileset resample --scene original.json --id sign \
  --width 96 --height 32 --out resampled.json
```

Omit `--out` to preview the before and after pigment UVs by object,
face, and corner. Resize updates eligible UVs to follow the original
texel centers. The preview identifies cuts through face references, moved pins,
and registered material maps that need their own migration. The edit
writes a new scene only when the report permits it. The report includes
any bakes marked for refresh. For separately saved brush records, find the
new texel-edge coordinate with `(source - sourceOffset) / sourceScale` on
each axis.

Resize moves the tile grid with the content. Resample scales the grid.
If the resulting grid no longer fits or uses fractional texels, supply
a replacement grid with `--tile-width` and `--tile-height`. In the Node SDK,
`editor.planTilesetCanvas(id, { type, size, anchor })` previews the change.
`editor.transformTilesetCanvas(id, operation)` commits the raster and
face references in one undoable edit. The SDK also accepts `tileSize`
with the usual grid options.

Run `node examples/tileset-pick/canvas-demo.cjs tile-canvas-demo` for two
edits of the same sheet with matching face geometry and before/after UV
receipts.

### Set brush size in world units

Set `texelsPerUnit` once in the project's existing `ink-studio.config.js`.
For example, add `texelsPerUnit: 16` to the exported configuration object.
All scene files picked from that project use the same density by default.
For a portable scene, store an explicit density with `tileset world-scale`.
A scene value takes precedence over the project config. Use `--clear` to
inherit the project value again.

```sh
ink-studio tileset world-scale --scene gatehouse-grids.json \
  --texels-per-unit 16 --out gatehouse-scale.json
ink-studio tileset pick --scene gatehouse-scale.json --id masonry --brush \
  --x 48 --y 0 --width 16 --height 16 --brush-scale 0.5 --out inset-brush.json
ink-studio tileset brush-size inset-brush.json --scene gatehouse-scale.json \
  --brush-scale 2 --out panel-brush.json
```

`brush-size` reports the total width and height and the size of an individual
tile in world units. Each dimension is `art texels × brush scale / texels
per unit`. A 16×16 crop at 16 texels per unit covers 0.5×0.5 world units at
scale 0.5, and 2×2 at scale 2. Both use the same source rectangle and native
PNG bytes. Density and brush scale must be positive finite numbers.

New brushes picked with a density save `texelsPerUnit` and `brushScale`.
The default multiplier is 1. Existing brush files can be measured or saved
with scale metadata using the current scene or project density. Files that
already carry density keep it when a project's convention changes.

In Node, use `editor.setTilesetTexelsPerUnit(value)` to write the scene setting
through the undoable editor. Call `ink.sizeTilesetBrush(scene, brush)` to
get `worldSize` and `tileWorldSize`. Pass `{ brushScale: 2 }` to get an updated
brush record along with its extents. For an old brush from a project with no
scene override, supply its shared density as `projectTexelsPerUnit`.

Run `node examples/tileset-pick/world-scale-demo.cjs tile-world-scale-demo`
to render the two sizes as editable mesh faces using the same atlas coordinates.

### Inset brush UVs on each edge

Use inward distances measured in source texels. The top, bottom, left, and
right can be set separately, including fractional values such as half a
texel. Omitted edges keep their saved values and start at zero. An inset
must leave a positive sampling rectangle. The brush keeps its original
crop, tile arrangement, world size, and native source preview.

```sh
ink-studio tileset brush-uv original-brush.json --scene original.json \
  --inset-top 2.5 --inset-bottom 4.5 --inset-left 3.5 --inset-right 1.5 \
  --out inset-brush.json
ink-studio tileset brush-uv inset-brush.json --scene original.json \
  --object relay --face plate --out inset.json
```

The first command stores `uvInset` on a copy of the brush. Its report
gives the source and inset bounds in top-down normalized UV coordinates
and the inset bounds in texels, ordered left, top, right, bottom. Use
`ink.tilesetBrushUV(scene, brush, { top: 0.5, bottom: 2 })` in Node to inspect
or update the same mapping.

With an object and a face ID, the command remaps the face's pigment UVs
using its existing orientation. The face must reference the same tileset
and its current UVs must lie inside the brush's original crop. Omitting
`--out` previews the changed corners and any conflicts. A commit keeps the
vertices and neighboring face corners in place and invalidates affected
pigment bakes. Pinned corners constrain the edit as in ordinary mesh UV
edits.

Run `node examples/tileset-pick/uv-inset-demo.cjs tile-uv-inset-demo` to see
an asymmetrically inset relay plate next to its original face.

## Edit an authored layout

A [polygon topology document](mesh-topology.md) keeps stable face, edge and
corner IDs through UV edits. Start with an existing topology mesh or import
the corner UVs from a supported inspectable mesh.

```sh
ink-studio mesh-uv import relay.glb --out relay-topology.json
ink-studio mesh-uv layout relay-topology.json --out relay-layout.json
ink-studio mesh-uv edit relay-topology.json uv-edit.json \
  --out relay-edited.json --report uv-receipt.json --preview uv-review
ink-studio mesh-uv inspect relay-edited.json --out relay-inspection
```

Import carries triangle positions, UVs from the selected set, and face
material names. Use the source material assets with the imported layout.
Separate positional indices stay separate by default. For UV-split vertices
on an indexed import, opt into merging exactly coincident points with
`--join-coincident on`. View independent material sheets separately.

The layout lists authored seams and inferred UV discontinuities, both sides
of each edge, pinned corners, and UV islands. A cut sets a seam immediately,
including when the two sides still share the same UV coordinates. It keeps the
3D polygon and its material in place. The island ID is the first face ID
in that connected UV region, ordered by ID. Check the current layout after
cutting or stitching, since island memberships and IDs can change.

### Inspect source texels and normalized UVs together

```sh
ink-studio mesh-uv layout panel-scene.json --object panel --channel pigment --out layout.json
ink-studio mesh-uv layout panel-topology.json --atlas 33,17 --out layout.json
ink-studio tileset eyedrop --scene panel-scene.json --object panel --face sign
```

In a scene, `mesh-uv layout` uses each face's source texture dimensions,
including an active bake's replacement texture. Select `--channel pigment`
to use the paint layout even when the mesh binds it to a set other than
UV 0. Named normal, emission, and metallic-roughness channels can also
report texels when the material has the corresponding map. Use
`--atlas width,height` to supply dimensions explicitly for a standalone
mesh or another inspection layout.

Read the normalized pair in `corners[].uv` and the corresponding
source position in `corners[].texel`. Each `edges[].sides[]` row pairs
`uv` and `texels` in its corner order. Both sides of a seam can use
different atlases. Each face's `atlas` records its source and size.
Coordinates are top-down with the first texel center at `[0,0]`. For
an image of width `W` and height `H`, Ink reports
`[u * (W - 1), v * (H - 1)]` without snapping to a pixel. An unknown
source size leaves the normalized UVs available on their own.

The SDK exposes `editor.inspectMeshUV(object, { uvSet: "pigment" })`
and `KIT.meshTopology.uv.inspect(mesh, uvSet, { atlas: [W,H] })`.
`tileset eyedrop` lists the same pairs for the picked face. Run
`node examples/tileset-pick/uv-texel-inspection-demo.cjs <directory>`
for a panel with two source sheets and fractional insets.

An edit takes one to 32 sequential operations and can include the layout's
`revision`. The editor checks that the requested revision is current before
planning. This example cuts a wing, pins the keeper corner, and moves the
separated island.

```json
{
  "operations": [
    { "op": "cut", "ids": ["wing-seam"] },
    { "op": "pin", "ids": ["faceplate/lower"], "pinned": true },
    { "op": "transform", "ids": ["wing"], "translate": [0.12, 0.09],
      "rotation": 0.22, "scale": 0.8 }
  ]
}
```

- **Cut** takes manifold shared edge IDs within one material sheet.
- **Pin** locks the current UV of named face corners. Welded corners move
  together, which makes a pin constrain its welded group. Set
  `pinned: false` to release the named corners.
- **Transform** takes island IDs and supports translation, rotation in
  radians, and uniform or two-axis scale. Negative scale mirrors the island.
  The default pivot is the center of each island's bounds. Supply `pivot`
  for a specific normalized UV anchor.
- **Remap face** takes one face ID and maps its existing bounds to a new
  normalized rectangle. Use `{ "op": "remap-face", "id": "plate",
  "source": [0, 0, 0.5, 1], "destination": [0.05, 0.1, 0.45, 0.9] }`.
  The source rectangle constrains the allowed original UVs.
- **Stitch** takes shared edge IDs. The default `mode: "weld"` joins
  corresponding endpoint groups, respecting pins and an optional
  `keepFace`. Unanchored endpoints meet at their average. Use
  `mode: "align"` and `keepFace` to rotate, scale and translate one
  other island to the keeper's edge before welding. If a selected chain
  spans multiple edges, they must all agree after that alignment.

Omit `--out` for a dry run. The receipt records corner changes, pin and seam
changes, and island counts. A moved pin, out-of-atlas coordinate, newly
collapsed UV triangle, or inconsistent stitch blocks the entire edit.
Use ordinary UV inspection to review overlap, stretch and padding on the
resulting layout. For a retained scene mesh, add `--object ID` and write the
revised scene beside the source. The scene editor journals the change in
one undo step and invalidates material bakes for faces whose UVs moved.

### Set a dedicated UV pivot

Add a `set-pivot` operation to a UV edit request. It stores one normalized
pivot for the selected UV set. Choose the target in the request.

| Target | Placement |
| --- | --- |
| `{ "kind": "selection-center", "selection": savedSelection }` | Center of the selected corners' UV bounds. The saved selection can address corners, edges, faces, or islands. |
| `{ "kind": "pinned", "corner": "panel/corner-0" }` | Exact coordinates of a corner pinned in the active layout. |
| `{ "kind": "corner", "corner": "panel/corner-1" }` | Snap to an exact corner. Use a saved single-corner pick as `selection` in place of the ID. |
| `{ "kind": "point", "uv": [0.25, 0.75] }` | Store an explicit normalized coordinate. |
| `null` | Clear the dedicated pivot for this layout. |

```json
{
  "uvSet": "pigment",
  "operations": [
    { "op": "set-pivot", "target": { "kind": "pinned", "corner": "panel/corner-0" } }
  ]
}
```

Pick a corner in the [atlas or model](#select-in-the-atlas-or-on-the-model)
and save that selection to use the snapped target. Placement samples the
anchor once. The stored pivot stays at that coordinate until it is set
again or cleared. The layout report and the atlas preview show its
position. Placement leaves the UVs and geometry revision intact, so saved
selections can drive a later transform or a transform in the same request.

An island transform uses its explicit `pivot` first, then the dedicated
pivot. With neither, each island rotates or scales around its own bounds
center. The transform receipt records the pivot applied to every island.
UV pins still constrain the resulting move.

```sh
ink-studio mesh-uv edit field-case.json pivot.json --object box --preview pivot-review
ink-studio mesh-uv edit field-case.json pivot.json --object box --out pivoted.json --report pivot-receipt.json
node examples/tileset-pick/uv-pivot-demo.cjs uv-pivot-review
```

### Move overlapping UV corners

Use `move-corners` with an explicit scope and a normalized UV
translation. Supply stable corner `ids` or a saved corner `selection`
from the atlas or model view.

```json
{
  "operations": [
    { "op": "move-corners", "scope": "together",
      "ids": ["faceplate/frt"], "translate": [-0.065, 0.06] }
  ]
}
```

With `together`, Ink follows existing welds and exact coordinate
overlaps on the same material sheet. This can include a separate
chart stacked at the same position. With `independent`, only the
named corner IDs move. A formerly continuous edge can become an
inferred UV seam as its corner coordinates separate.

Omit `translate` to inspect the scope at its current position. The
operation report lists eligible movers, held overlaps, pins, and
proposed UVs. A valid move also reports changes in UV edge continuity.
The scene and atlas previews mark active corners in mint and held
overlaps with a blue outline. Use `--view` with a material to choose
which sheet appears in the atlas preview. A pin on an active corner,
an out-of-atlas coordinate, or a newly collapsed or flipped triangle
blocks the transaction.

```sh
ink-studio mesh-uv edit field-case.json move.json --object box --preview scope-review
ink-studio mesh-uv edit field-case.json move.json --object box --out moved.json --report receipt.json
node examples/tileset-pick/uv-corner-scope-demo.cjs corner-scope-review
```

### Nudge UVs in source pixels

Use `nudge` to translate UVs by signed integer step counts along the atlas
axes. Positive X moves right and positive Y moves down. The default
increment is `"pixel"`. Use a positive number such as `0.25` for finer
steps, or a pair such as `[0.25, 0.5]` to set each axis separately.

```json
{
  "operations": [
    { "op": "nudge", "ids": ["panel"], "steps": [1, -1], "increment": "pixel" }
  ]
}
```

Use `"increment": "tile"` to step by the declared tileset grid. Each step
spans a tile plus the gutter on that axis. The sheet's grid takes
precedence over the project default. A standalone topology document
needs `"atlas": [width, height]`, and a standalone tile nudge also
needs `"tileSize": { "width": 8, "height": 8, "paddingX": 2 }`. A scene
request can supply either field as an override.

Ink uses each selected material's active source dimensions for the
requested channel. One texel is `1 / (width - 1)` or `1 / (height - 1)`
in normalized UV coordinates. An axis one texel wide only accepts zero
steps. The receipt lists both the source texel displacement and the
normalized translation for every affected material.

IDs address islands by default. To move corners, edges, or faces,
declare `domain` or pass a saved `selection` and set `scope` to
`"together"` or `"independent"`. An edge selection saved from the
atlas can retain a specific side of a seam. Pins, atlas limits, and
triangle checks apply to the preview and commit.

```sh
ink-studio mesh-uv edit panel.json nudge.json --object sign --channel pigment --preview nudge-review
ink-studio mesh-uv edit panel.json nudge.json --object sign --channel pigment --out shifted.json --report nudge-receipt.json
node examples/tileset-pick/uv-nudge-demo.cjs uv-nudge-demo
```

### Snap UV corners and edges

Use `snap` with stable corner IDs or a saved corner or edge selection.
Set `scope` to `"independent"` to move the chosen corners, or
`"together"` to carry their welds and overlapping corners. When an
edge has split UVs, save the specific side from the atlas or mesh view.

```json
{
  "operations": [
    { "op": "snap", "ids": ["faceplate/frt"], "scope": "independent",
      "target": { "kind": "chart", "corner": "lid/frt" } }
  ]
}
```

- A `chart` target takes a `corner` or `edge` ID on another chart of the
  same material. Add `face` to resolve an edge side, or supply a saved
  target `selection`. Corners land exactly on a target corner or project
  onto the target segment. A source edge matches the two endpoints of
  the target edge in the order with the least travel. Ink measures this
  travel in source texels when atlas dimensions are available.
- A `seam` target takes an `edge` and its `face`, or a saved seam-side
  `selection`. Aligning opposite sides of the same edge pairs their
  shared vertex IDs. Use the separate stitch operation to remove an
  authored seam.
- A `grid` target takes `axis: "u"` for a vertical line or `axis: "v"`
  for a horizontal line. Corners find the nearest line independently.
  Each edge uses its midpoint to choose one line for both endpoints.
  The other axis stays fixed. By default the grid uses source texels
  with `step: 1` and `origin: 0`. Use a fractional `step` for subpixel
  alignment, `units: "uv"` for a normalized grid, or `units: "tile"`
  for complete tiles' start lines with their registered offsets and gutters. A standalone
  texel or tile grid needs `atlas: [width, height]`. A standalone
  tile grid also needs `tileSize` as in the nudge operation.

The preview marks snap targets in gold and moving corners in mint.
The receipt names the fixed reference or resolved grid plus the proposed
corner coordinates. Pinned corners, competing targets for one corner,
and newly flipped or collapsed triangles block the edit.

```sh
ink-studio mesh-uv edit field-case.json snap.json --object box --preview snap-review
ink-studio mesh-uv edit field-case.json snap.json --object box --out snapped.json --report snap-receipt.json
node examples/tileset-pick/uv-snap-demo.cjs uv-snap-demo
```

### Flip, mirror, or rotate UVs

Use `orient` to rotate UV coordinates in degrees and to reflect the
source axes with `flipX` or `flipY`. Reflections apply before rotation.
A positive angle turns UV coordinates clockwise in the top-down atlas.
Set `increment` to round the requested angle to the nearest multiple
of that many degrees. Ties round away from zero. The receipt records
the requested and applied angles and whether Ink used exact axis swaps
and sign changes for a quarter turn.

```json
{
  "uvSet": "pigment",
  "operations": [
    { "op": "orient", "mode": "per-face", "ids": ["left", "right"],
      "degrees": 87, "increment": 15, "flipX": true, "space": "texel" }
  ]
}
```

- `mode: "group"` uses one pivot for the whole selection. It takes the
  explicit normalized `pivot`, the dedicated layout pivot, or the center
  of the group's bounds in that order. IDs resolve to islands by default.
  Set `domain` to `"faces"`, `"edges"`, or `"corners"` to use those IDs,
  or pass a saved selection. Set `scope: "together"` to include welded and
  overlapping corners. The default scope is `"independent"`.
- `mode: "per-face"` uses the center of each face's UV bounds. Use face
  IDs or a saved face or island selection. Adjacent faces can acquire an
  inferred seam if their shared UVs separate. The receipt lists these
  edge changes and retains any authored seams.
- `space: "uv"` uses normalized coordinates and is the default. Use
  `space: "texel"` to turn in source texel units on a rectangular atlas.
  A scene resolves source dimensions from the selected layout and
  materials. Each group needs matching dimensions. In per-face mode,
  each face uses its own dimensions. Pass `atlas: [width, height]` in
  the operation for standalone texel edits or an explicit override.
  A texel-space quarter turn swaps the width and height of a rectangular
  crop around its pivot.

The preview shows the applied pivots on the atlas. Pins, atlas bounds,
and triangle checks constrain the operation. A reflection of a whole UV
triangle can reverse its UV winding. The geometry and its winding stay
fixed. Use the existing `transform` operation for translation, scale, or
rotation in radians around each island.

```sh
ink-studio mesh-uv edit signs.json orient.json --object signs --preview orient-review
ink-studio mesh-uv edit signs.json orient.json --object signs --out oriented.json --report orient-receipt.json
node examples/tileset-pick/uv-orientation-demo.cjs uv-orientation-demo
```

### Scale UVs around the pivot

Use `scale` with a positive `factor`. Pass a pair for independent U
and V factors or a scalar for a uniform request. Add `aspectLock: true`
to require the same applied factor on both axes when snapping.

```json
{
  "uvSet": "pigment",
  "operations": [
    { "op": "scale", "domain": "faces", "ids": ["plate"],
      "factor": 1.42, "aspectLock": true, "snapBounds": true }
  ]
}
```

In group mode, scaling uses the explicit normalized `pivot`, the
dedicated layout pivot, or the center of the selected UV bounds.
Group mode accepts islands by default. Set `domain` to choose face,
edge, or corner IDs, or pass a saved selection. Use `scope: "together"`
to carry welded and overlapping corners. Use `mode: "per-face"` to
scale full faces around their individual bounds centers.

Set `snapBounds: true` to put all four bounds on integer source
texel centers. Ink chooses the closest positive factor that fits the
atlas while keeping the pivot fixed. Ties choose the smaller factor.
The solver resolves the axes independently unless aspect lock is on.
The preview flags a conflict when no exact snapped bounds satisfy the
pivot and aspect constraints. Interior UVs follow the resulting scale.

Scene edits use the source dimensions for the selected material layout.
Each group needs matching dimensions from 2 to 4096 texels per axis.
Set `atlas: [width, height]` for standalone topology or an explicit
override. The preview outlines snapped bounds in gold and marks the
pivot. The receipt gives the original, requested, and applied bounds
in texels for a snapped edit and normalized UVs otherwise.

```sh
ink-studio mesh-uv edit sign.json scale.json --object panel --preview scale-review
ink-studio mesh-uv edit sign.json scale.json --object panel --out scaled.json --report scale-receipt.json
node examples/tileset-pick/uv-scale-demo.cjs uv-scale-demo
```

### Normalize the grain on selected faces

Use `normalize-orientation` with face IDs or a saved face selection.
Use `domain: "islands"` or a saved island selection to include every
face in those charts. The operation compares the signed direction of
increasing U in model space. Set `axis: "v"` to compare increasing V.

```json
{
  "uvSet": "pigment",
  "operations": [
    { "op": "normalize-orientation", "ids": ["board-2", "board-3"],
      "reference": { "face": "board-1" }, "maxError": 5 }
  ]
}
```

Give `reference` a face or an edge ID. A face supplies its painted
direction and handedness. Set `matchHandedness: false` to retain the
target faces' existing mirror parity. An edge supplies the direction
from its first retained vertex to its second. Set `from` to the desired
start vertex ID to control the sign. You can also pass a saved
single-face or single-edge `selection` as the reference.

Ink projects the reference direction onto each target's plane. The
default `method: "quarter-turn"` picks the closest directional match
and keeps each face's original atlas rectangle. A selected reference
face stays in place. Use `method: "continuous"` to align oblique grain
by rotating normalized UVs about each face's center. Continuous
alignment can change the footprint on the atlas.

The receipt records each face's turn, mirror, and before/after angular
error. Use `maxError` in degrees to block loose matches. It defaults
to 45 degrees. The same preview marks the reference in gold. A
perpendicular reference, degenerate UV layout, moved pin, or
out-of-atlas result blocks the transaction.

```sh
ink-studio mesh-uv edit boards.json normalize.json --object siding --preview grain-review
ink-studio mesh-uv edit boards.json normalize.json --object siding --out aligned.json --report grain-receipt.json
node examples/tileset-pick/uv-normalization-demo.cjs uv-normalization-demo
```

### Assign a selection to a tile or sheet

Fit selected faces to a saved tile pick with `mode: "tile"`, or to
the whole registered image with `mode: "sheet"` and its `tileset` ID.
Use face `ids`, a saved face or island UV `selection`, or a saved
topology face or tileset component selection.

```json
{
  "object": "siding",
  "ids": ["panel-1", "panel-2"],
  "mode": "sheet",
  "tileset": "enamel",
  "mapping": "group"
}
```

For a tile assignment, put the saved rectangle, brush, or eyedropped
face under `tile`. A padded brush needs a `cell` with zero-based
`column` and `row`. Ink uses the pick’s paint orientation and insets.
Group mapping fits the shared UV bounds to the chosen region.
Use `mapping: "per-face"` to fit the whole region on each face.
When a group has unusable UVs, Ink projects its geometry into the
first face’s plane before fitting. Use per-face mapping for separate
planes.

The report measures per-face stretch and density from the retained
triangles in source texel units. Coverage counts distinct source
texel centers in the proposed footprints, including polygon edges.
It also counts texels shared by multiple faces and classifies source
alpha as transparent, translucent, or opaque. Large assignments can
return partial coverage with `complete: false`. This measures the
source footprint before camera, lighting, or material alpha cutoff.

Preview draws the assigned region in gold beside the native model.
When the assignment changes sheets, the atlas preview follows the
selected material to the new sheet. Commits update the pigment UVs,
material assignments, and source bindings together. Unselected faces
keep their existing material slots and active bakes. Pinned corners
and incompatible material maps can block the commit.

```sh
ink-studio tileset assign assignment.json --scene siding.json --preview assignment-review
ink-studio tileset assign assignment.json --scene siding.json --out assigned.json
node examples/tileset-pick/uv-assignment-demo.cjs uv-assignment-demo
```

### Reassign a sheet at the same texel scale

Use `mapping: "preserve-texels"` with a sheet assignment to carry
existing pigment corners across sheet sizes. Coordinates are measured
from the top-left texel center of each face's current pigment image.
For example, texel `[16, 24]` on a 64×64 sheet remains `[16, 24]`
on a 96×80 sheet. The normalized UV changes to address the same
coordinates, and the face keeps its texel density and paint orientation.

```json
{
  "object": "sign",
  "ids": ["panel", "return"],
  "mode": "sheet",
  "tileset": "alternate-enamel",
  "mapping": "preserve-texels"
}
```

```sh
ink-studio tileset assign reassign.json --scene sign.json --preview sheet-review
ink-studio tileset assign reassign.json --scene sign.json --out reassigned.json
```

If a coordinate is outside the destination, the preview marks the
affected corners in pink and shows where clamping would put them.
The model in a blocked preview stays on its current sheet. Add
`"clamp": true` to authorize the edge clamp and review the resulting
model. Clamped faces can lose texel density or stretch along the affected
axis. Ink blocks clamps that collapse or flip a triangle's existing
UV area. A change to a pinned UV or incompatible material maps also
blocks the commit.

The report gives the old and new sheet dimensions, before and after
texel bounds and density, and each affected corner's source and
candidate coordinates. UV coordinates select paint from the new sheet.
Provide corresponding artwork at those coordinates when the face
should keep the same appearance. Commits update the selected faces'
material variants and source bindings together. One undo restores
the original assignment.

The same request works with `editor.planTilesetAssignment` and
`editor.applyTilesetAssignment`. Run
`node examples/tileset-pick/uv-reassign-texels-demo.cjs out/texel-reassignment`
to compare larger and smaller destination sheets.

### Flatten faces at the project texel density

Use `flatten` with face IDs or a saved face or island selection.
Ink unfolds the triangles of each face into its own flat pattern, using
the first directed face edge as the U axis. This preserves the rendered
triangle edge lengths through bends. Each pattern starts at the minimum
texel coordinate of its current UVs. Supply `origin: [x, y]` in source
texels to set the minimum explicitly. Patterns with the same origin
share atlas space.

```json
{
  "uvSet": "pigment",
  "operations": [
    { "op": "flatten", "ids": ["panel"], "refit": true }
  ]
}
```

The operation uses its explicit `texelsPerUnit`, the scene’s tileset
density, or the CLI project’s density, in that order. Ink defaults to
16 texels per authored mesh unit. Scene edits use the selected material
layout’s source dimensions. Provide `atlas: [width, height]` for a
standalone topology document or an explicit override. The preview
shows the flattened footprint, density and stretch. A collapsed,
self-overlapping, pinned or out-of-atlas fit blocks the flatten.

Set `refit: true` in a scene to retain the density, atlas, edge and
origin for future geometry edits. Moving retained vertices refits the
opted-in faces in the same transaction. Rigid motion preserves the flat
pattern. Pose and animation evaluation use the authored UVs. When pins,
atlas changes, manual UV overrides or topology changes prevent a refit,
the geometry edit can proceed and the receipt marks the binding for
review. Run flatten again to renew the binding or use `refit: false`
to keep a static layout.

```sh
ink-studio mesh-uv edit panels.json flatten.json --object panels --preview flatten-review
ink-studio mesh-uv edit panels.json flatten.json --object panels --out flattened.json --report flatten-receipt.json
node examples/tileset-pick/uv-flatten-demo.cjs uv-flatten-demo
```

## Bind separate material layouts

A retained mesh part can use a different UV set for each material channel.
Set `uvBindings` on the mesh topology document. Keep UV 0 on each face
corner as `uv` and add alternate pairs under `attributes`.

```js
const bindings = { pigment: 0, bake: 1, decal: 2, 'mask/wear': 3 };
const corner = {
  id: 'panel/lower-left',
  vertex: 'lower-left',
  uv: [.15, .3],
  attributes: { 'uv/1': [.35, .25], 'uv/2': [.65, .2], 'uv/3': [.1, .85] }
};
```

Every face corner needs coordinates for each bound set. `normal`,
`metallicRoughness`, and `emission` may override `bake`. A named mask such
as `mask/wear` inherits `masks`, then `bake`, if it has no override.
The default layout is UV 0. Native pigment uses `pigment`, and UV-anchored
decals use `decal` unless the anchor specifies its own `uvSet`. Retained
UV brush stamps default to `pigment`. Coverage and opacity share the
pigment layout.

```sh
node cli/ink-studio.js mesh-uv layout case-topology.json --channel decal
node cli/ink-studio.js mesh-uv inspect case-topology.json --uv-set 3 --out wear
node cli/ink-studio.js mesh-uv edit case-topology.json move-decal.json --out case-edited.json
```

An edit request with `"uvSet": "decal"` scopes its selections, seam cuts,
pins, and transforms to the decal layout. Use a numeric set to address one
directly. To replace assignments in the same transaction, include a
`bindings` object in the request. For scripts, use
`KIT.meshTopology.uv.inspect(document, 'decal')` or sample a mesh hit with
`KIT.sceneMeshes.channelUV(mesh, triangle, barycentricWeights, 'decal')`.

GLB exports carry each authored UV set. Standard material textures reference
their set through glTF texture selectors. Ink keeps decal and named-mask
assignments in the mesh's versioned extras. `mesh-uv import` retains all sets
and their assignments by default. When source parts disagree on a channel,
supply a separate source asset for each retained part. Supply `--channel` or
`--uv-set` to import or reduce a single layout intentionally. The JavaScript
reader exposes the source arrays with `readMesh(file, { allUVSets: true })`.

Run `node examples/material-channel-uvs.cjs <new-directory>` for the field
case demo. Moving the decal island shifts the badge in the native render
while the pigment, normal, and wear bakes keep their original bytes.

## Select in the atlas or on the model

Use `mesh-uv select` with a JSON query. Choose `islands`, `faces`, `edges`,
or `corners` as the domain. For an atlas pick use normalized top-down UVs
and optionally narrow the pick to a material or a face.

```json
{ "domain": "faces", "atlas": { "at": [0.72, 0.42], "material": "enamel" } }
```

To pick from the [source coordinates in a layout report](#inspect-source-texels-and-normalized-uvs-together),
use `atlas.texel` in the same top-left texel-center coordinates. Specify a
face or material to resolve its atlas from the scene. A standalone mesh
can supply `atlas.size: [width, height]`. The optional `radius` is measured
in the units of the pick and defaults to 0.75 texel for a source pick.

```json
{ "domain": "corners", "atlas": { "texel": [4.5, 13], "face": "sign" }, "uvSet": "pigment" }
```

A model pick uses integer art-pixel coordinates in the native capture.
Provide `--view view.json` to set the camera and raster dimensions.

```json
{ "domain": "faces", "model": { "pixel": [145, 86] } }
```

The picker uses the visible authored triangle to resolve the face and its
corner IDs. Edge and corner picks choose the nearest component on that face.
The atlas reports ambiguous overlapping picks with candidate IDs. Name
a face or material to disambiguate. You can also select by `ids`, or pass
a saved selection as `from` with the matching mesh revision and domain.

Both views return stable face corner IDs and the physical vertex IDs they
reference. An edge pick at a seam records its face side in `edgeSides`.
Continuous edges link both incident UV sides. If both sides of a cut sit
on top of each other in the atlas, the report lists the competing sides
until the query specifies a face. Reopening a saved UV selection retains
the picked side.

Use `--topology-out vertices.json --topology-domain match` to save the
matching mesh components. A UV corner maps to a mesh vertex, a UV edge to
a mesh edge, and a face or chart to mesh faces. Choose `vertices`,
`edges`, or `faces` explicitly to export the related components instead.
Without `--topology-domain`, this export defaults to faces.

To go from a saved mesh selection back to UVs, embed that selection in
`topology.selection` with the corresponding UV domain. A saved vertex
selection can match several UV corners. Set `topology.face` to inspect
one face side at a seam.

Use `--preview directory` for linked native views, or add
`--selection selection.json` to a later edit preview on the same revision.
The preview shows the authored cage, which keeps selection attached to
editable corners when a scene uses modifiers.

```sh
node examples/tileset-pick/uv-cross-selection-demo.cjs uv-cross-selection-review
```

### Select by island or vertex tint

```json
{ "domain": "islands", "atlas": { "at": [0.42, 0.4] } }
```

The query expands the hit to the entire connected UV island. You can also
use a model pixel or `ids` from the current UV layout. A declared seam
or a material boundary ends the island.

```json
{ "domain": "faces", "tint": { "color": [0.82, 0.46, 0.18], "tolerance": 0.02, "match": "all" } }
```

A tint query reads normalized RGB or RGBA values from
`face.corners[].attributes.tint`. `mesh-uv import` carries these values
from glTF `COLOR_0` when present. The query checks the stored channels
before lighting or texture sampling and lists the matching corner IDs.
By default it matches any corner with exactly the requested color. Use
`match: "all"` to require every corner and `tolerance` for the maximum
difference per channel. RGB queries ignore alpha. RGBA queries treat
an authored RGB tint as fully opaque. Corners without an RGB or RGBA
tint do not match.

```sh
ink-studio mesh-uv select canopy.json tint.json --object canopy --view view.json \
  --preview tint-review --out uv-selection.json --topology-out faces.json
ink-studio mesh-topology select canopy.json edges.json --object canopy --from faces.json
```

`--topology-out` saves the matching face IDs as a revision-checked mesh
selection, including when the source query selects islands. The preview
highlights the same faces in the atlas and from the scene camera. It uses
the rendered pigment sheet behind the UV lines when viewing the pigment
layout. Matches on additional material sheets get separate atlas images.
The report records visible scene pixel counts per selected face, so
occluded matches remain inspectable through the atlas and saved selection.

```sh
node examples/tileset-pick/island-tint-selection-demo.cjs island-tint-review
```

Use `KIT.meshTopology.uv.inspect`, `KIT.meshTopology.uv.select`,
`KIT.meshTopology.uv.toTopologySelection`, `KIT.meshTopology.uv.pickModel`
and `KIT.meshTopology.uv.plan` for SDK access. Use `editor.selectMeshUV`
to resolve source atlas dimensions from a scene.
A plan returns a topology patch and its report. The scene editor exposes
`editor.planMeshUV` and `editor.editMeshUV` for the same operation.

Run the [field case example](../examples/mesh-uv-workshop.cjs) to reproduce
a cut on two wings, a linked native model and atlas selection, and an aligned
stitch that leaves the keeper's two pins in place.

```sh
node examples/mesh-uv-workshop.cjs out/uv-workshop
```

## Unwrap and relax a local region

Use the same `mesh-uv edit` command to reproject or relax a connected set of
face IDs. Each operation uses one material sheet. To hold named seam
coordinates or a painted span, declare those targets in `protect` at the
request level or on the operation. The solver also retains pinned corners and
any welded corner used by a face outside the selection.

```json
{
  "protect": {
    "seams": ["trim-seam"],
    "painted": [{ "id": "painted-badge", "faces": ["badge"] }]
  },
  "operations": [
    { "op": "unwrap", "ids": ["sign"], "atlas": [128, 128] },
    { "op": "relax", "ids": ["stitch-0", "stitch-1"], "atlas": [128, 128] }
  ]
}
```

- **Unwrap** uses a planar projection oriented towards the existing layout.
  It fits a chart into the selection's current bounds, or into a normalized
  `rect: [u, v, width, height]`. An optional world-space `normal` sets the
  projection plane. The solver spreads the correction from held corners
  into the free region. Use individual regions on strongly curved surfaces.
- **Relax** redistributes free points with weights derived from the geometric
  triangle angles and edge lengths. The rim of the selected region stays
  fixed. `iterations` and `strength` control the solve.
- **Painted spans** can list faces, edges, or both. A protected face retains
  all its corner coordinates. A protected edge retains both UV sides.
  The receipt includes held groups and the change in stretch and density.

These operations reject newly collapsed or flipped triangles and new atlas
overlap. Work through several smaller regions if a proposed change conflicts
with the surrounding layout. UV movement uses the existing scene transaction
and bake invalidation workflow. Use the registered paint inputs when
[rebaking](registered-material-bake.md) a revised atlas.

### Unwrap across connected edges

Add `across: "geometry"` to an `unwrap` operation to connect selected
faces across manifold edges on the same material sheet, including
edges with mismatched UVs. Existing authored seams separate regions.
Add `cuts` as stable edge IDs or a saved UV edge selection. Each cut
must touch a selected face. The unwrap commits cuts and new UVs as
one edit.

```json
{
  "protect": {
    "painted": [{ "id": "enamel-sign", "faces": ["label"] }]
  },
  "operations": [
    { "op": "unwrap", "across": "geometry",
      "ids": ["label", "web", "return"], "cuts": ["return-seam"],
      "atlas": [128, 128], "rects": { "return": [0.70, 0.18, 0.20, 0.20] } }
  ]
}
```

Each region uses the local unwrap solver and fits its existing UV
bounds by default. Use `rect` for a single region or `rects` to place
regions individually. A `rects` key can be any selected face in that
region, with one rectangle per region. Paint, pins, approved seams,
and corners welded to unselected faces keep their exact coordinates.
Conflicting held coordinates block joining an edge. Mark that edge
as a cut if both sides must stay in place.

The atlas and native preview mark cuts in pink and held corners in
gold. The receipt lists the regions, proposed joins, and before and
after stretch. New overlaps and flipped or collapsed triangles block
both the unwrap and its cuts.

```sh
ink-studio mesh-uv edit facade.json connected.json --object facade --preview unwrap-review
ink-studio mesh-uv edit facade.json connected.json --object facade --out unwrapped.json --report unwrap-receipt.json
node examples/tileset-pick/uv-connected-unwrap-demo.cjs uv-connected-unwrap-demo
```

## Project UVs from an approved camera

Use a reviewed native view to register a face selection to a reference image or
painted atlas. Save the exact art grid and shot in the view file. Here
`approved-view.json` samples the authored `inspection` shot at one second.

```json
{
  "w": 240, "h": 160, "t": 1,
  "cameraShot": "inspection",
  "raw": true
}
```

The shot can be orthographic or perspective. To approve an explicit camera,
use a `camera` object in the view file with fields such as `target`, `yaw`,
`pitch`, `dist`, `fov` in radians, and `projection` set to `orthographic`
or `perspective`. You can use `cameraTime` to sample the lens and camera rig
at a different time from the geometry pose. The view file works with an
editable scene or a standalone topology document. Named shots use the
scene's camera rig.

In `project.json`, select retained face IDs or supply a revision-checked UV
selection of faces or islands. By default the view fills the entire UV
layout. Set `rect: [u, v, width, height]` to place the view in a normalized
atlas subregion, as shown here.

```json
{
  "operations": [
    { "op": "project-camera", "ids": ["front", "return"], "rect": [0.25, 0, 0.5, 1] }
  ]
}
```

```sh
ink-studio mesh-uv edit panel.json project.json --object panel --view approved-view.json --preview camera-review
ink-studio mesh-uv edit panel.json project.json --object panel --view approved-view.json --out projected.json --report projected-receipt.json
```

The report records the column-major view matrix, focal scale, native
viewport, depth interval, sampled times and requested shot, and each
selected corner's source position, camera depth, projected pixel, and
proposed UV. Pixel coordinates run from the top-left pixel edge to the
bottom-right edge. The review marks projected corners on the native model
and shows the resulting UV footprint on the atlas. A corner outside the
frame or the depth interval, a collapsed projected triangle, or a changed
pinned UV blocks the edit. Unselected corners, authored seams, material
assignments, and geometry are retained. New inferred seams are listed
under `edgeChanges`.

Projection applies to all selected faces, including hidden ones. The edit
writes ordinary corner UVs. In a perspective view the corners match the
approved camera, and the renderer uses its ordinary texture interpolation
within each triangle. Use additional topology where you need a closer
interior match on a face with substantial depth variation.

In the SDK, pass `{ camera }` to `meshTopology.uv.plan`,
`editor.planMeshUV`, or `editor.editMeshUV`. The `camera` object can be
taken from the operation receipt's `evidence.camera`. Its matrix must use
the same coordinate space as the mesh. When projecting a placed or posed
mesh against a scene camera, also pass `projectionPositions`, a
`Map` from stable vertex IDs to positions in that camera's world space.
The CLI supplies those positions from the captured authored mesh.

## Pack connected UV charts

Run `pack-charts` through `mesh-uv edit` to reposition complete UV islands at
their current texel density and orientation. Use island IDs from
`mesh-uv layout`, or pass a revision-checked UV selection of islands or faces. A
selected face brings along its entire connected UV island. Named groups
move as one, preserving the relative positions of their islands.

```json
{
  "operations": [{
    "op": "pack-charts",
    "ids": ["badge", "sign-panel", "trim", "maker-mark"],
    "groups": [{ "id": "badge-and-sign", "islands": ["badge", "sign-panel"] }],
    "atlas": [128, 96],
    "pool": [0, 0, 96, 80],
    "gutter": 2
  }]
}
```

```sh
ink-studio mesh-uv edit gate.json pack.json --object panel --preview pack-review
ink-studio mesh-uv edit gate.json pack.json --object panel --out packed.json --report pack-receipt.json
```

Pack one material sheet and up to 256 islands per operation. An editable scene
can infer the active material atlas when `atlas` is omitted. `pool` is an
integer texel rectangle `[x,y,width,height]` and defaults to the full atlas.
The packer places axis-aligned chart or group envelopes with a gutter on
each side, with a default gutter of two texels. An unselected chart reserves its
current footprint. A pin or a span marked with `protect.painted` or
`protect.seams` holds its whole island and any group it belongs to.

The receipt lists source and destination bounds as texel edges
`[left,top,right,bottom]`, the integer translation, held charts, and
`unpacked` island IDs. `chart-exceeds-pool` gives the required padded
dimensions when a chart or group is too large. `chart-no-free-rectangle`
means the chart would fit the empty pool and the packer found no placement
among the reserved and already placed footprints. The packer uses a
deterministic, largest-first best-area fit. Any failed placement leaves the
whole edit uncommitted. The failed preview shows proposed placements and
marks unpacked footprints in pink.

The command changes UV coordinates. Use it before painting a new atlas, or
rebake the moved charts against the reported layout. Pinned and protected
paint keeps its exact coordinates. If two separate UV islands meet after a
zero-gutter pack, the receipt records any inferred cut that Ink made
explicit to retain the original chart separation.

The same operation works in `KIT.meshTopology.uv.plan` and the scene
editor's `planMeshUV` and `editMeshUV` methods. The
[packing demo](../examples/tileset-pick/uv-pack-charts-demo.cjs) compares a
successful pack with an undersized pool using the same source layout.

## Allocate texels for a shot

A `texel-budget` operation redistributes space among named features on one
material sheet. Each feature names existing islands and can set a relative
density `weight`. The allocator scales each movable island uniformly in
texel space and packs it into the free `pool`. It reserves islands that
contain a pin, approved seam, or painted span, along with the unselected
charts on the same sheet.

```json
{
  "op": "texel-budget",
  "atlas": [128, 128],
  "maxTexels": 5600,
  "gutter": 2,
  "features": [
    { "id": "sign", "islands": ["sign"], "weight": 4, "minDensity": 28 },
    { "id": "cabinet", "islands": ["cabinet"], "weight": 0.7 }
  ]
}
```

`maxTexels` caps the summed triangle area of the named features in texels.
Omit it to use their current footprint rounded up. `pool` is an optional
integer `[x, y, width, height]` region in the atlas. `gutter` leaves
space around chart bounds. Packing can leave some area unused. An optional
`minDensity` specifies texels per scene unit that each island of a feature
must reach before the operation can commit.

With `--preview`, the edit receipt measures the named features through
the same native camera before and after the edit. The view file can also
set a `readability` object for any preview.

```json
{
  "w": 246, "h": 164,
  "camera": { "yaw": 0.11, "pitch": 0.07, "dist": 5.65, "ortho": true },
  "readability": {
    "atlas": [128, 128],
    "features": [{ "id": "sign", "faces": ["sign"],
      "minPixels": [95, 10], "minTexelsPerPixel": 0.58 }]
  }
}
```

The review reports each visible feature's projected extent and coverage,
plus the 10th percentile and median of its lower-axis texels per native
pixel. Sampling uses neighboring visible pixels on the same authored face.
The thresholds measure coverage and sampling. Check the rendered feature
at 1× for actual legibility. A standalone view can supply `materials` and
`afterMaterials` to compare matching registered textures for each layout.

Use `KIT.meshTopology.uv.plan` to make these edits through the SDK and
`KIT.meshTopology.uv.readability` to measure native mesh source passes.
The [ferry route board demo](../examples/mesh-uv-texel-budget.cjs) bakes the
same rest-space pigment for both allocations. It keeps the approved badge
registered while reallocating a fixed-size atlas to the sign.

```sh
node examples/mesh-uv-texel-budget.cjs out/ferry-route-board
```

## Reduce an authored mesh

Put protected triangle edges in the input's `protectedSeams` field or
pass a JSON array of zero-based vertex pairs with `--protected-seams`.
Pairs can include edges inside a chart, such as a crease under a painted
label.

```sh
node cli/ink-studio.js mesh-uv simplify relay.glb --triangles 4000 \
  --protected-seams pins.json --out relay-reduced.json
node cli/ink-studio.js mesh-uv inspect relay-reduced.json --out reduced-review
```

The reducer uses the existing quadric-error simplifier. It detects UV
discontinuities across matching geometric edges, including edges with
split vertex indices at the same position. It locks both sides of a UV
cut and every explicitly protected edge. Open geometry boundaries are
also locked by default. Use `--boundaries off` to permit open-boundary
reduction while keeping UV cuts and authored pins protected. Collapses
that would reverse or degenerate an affected triangle's UVs are rejected.
A result marked `constrained` can stop above the target when further
collapses would violate a constraint.

The reduced geometry JSON carries triangle UVs, face groups, remapped
protected edges, and original vertex and face indices. Use the original
atlas with the reduced geometry. The triangle counts of an overlap can
change after reduction, since the same region can intersect a different
set of triangles.

Use `KIT.procedural.geometry.inspectUV({ points, triangles, uvs, protectedSeams }, options)`
for in-memory geometry, or `KIT.sceneMeshes.inspectUV(mesh, { material })`
for an indexed scene mesh. The scene-mesh adapter measures resting
positions in the selected material texture's native size.
`KIT.procedural.geometry.simplifyQEM` accepts the same UV mesh and returns
`uvs`, `pointMap`, and `sourceFaces` alongside the reduced geometry.
To use the same path on artist topology in a sculpt bake, opt into
`KIT.model.fromSculpt(sculpt, { topology, simplifyTopology: true, targetTriangles })`.

For stable-ID correspondence and projected evidence through ordinary polygon
edits, use [mesh topology receipts](mesh-topology.md#record-correspondence-through-an-edit).

## Reproduce the demo

```sh
node examples/uv-seam-inspection.cjs tide-relay-review
```

The Tide Relay uses one authored texture for the original and reduced
GLBs. The review includes both meshes, atlas maps, seam locations, and
matching turntable frames. A deliberate overlap and a tight border
clearance make the atlas diagnostics visible.
