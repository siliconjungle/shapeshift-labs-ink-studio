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
directions.

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

Both views return the same stable component IDs and their related atlas
elements. Use `--preview directory` for linked native views, or add
`--selection selection.json` to a later edit preview on the same revision.
The preview shows the authored cage, which keeps selection attached to
editable corners when a scene uses modifiers.

Use `KIT.meshTopology.uv.inspect`, `KIT.meshTopology.uv.select`,
`KIT.meshTopology.uv.pickModel` and `KIT.meshTopology.uv.plan` for SDK access.
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
