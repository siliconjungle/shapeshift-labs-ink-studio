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
