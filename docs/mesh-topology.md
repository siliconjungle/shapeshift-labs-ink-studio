# Editable mesh topology

An Ink mesh topology document stores positions, shared boundary edges,
polygon faces, and face corners. Each element has an ID. A polygon
keeps its boundary and winding when Ink derives its render triangles.
A face corner refers to a vertex and stores its own UV, so the two faces
sharing an edge can sample different parts of an atlas. Use
[hybrid edit ownership](hybrid-edit-ownership.md) to declare whether a
mesh owns the shape or is derived from another source.

## Author and edit a polygon

Use `KIT.meshTopology.create` in Node or in the browser authoring bundle.
Pass a mesh ID, vertex records, and ordered face rings.

```js
const topology = KIT.meshTopology;
const panel = topology.create({
  id: 'panel',
  vertices: [
    { id: 'lower-left', position: [0, 0, 0] },
    { id: 'lower-right', position: [2, 0, 0] },
    { id: 'upper-right', position: [2, 1, 0] },
    { id: 'upper-left', position: [0, 1, 0] }
  ],
  faces: [{
    id: 'front',
    material: 'enamel',
    corners: [
      { id: 'front/a', vertex: 'lower-left', uv: [0, 1] },
      { id: 'front/b', vertex: 'lower-right', uv: [1, 1] },
      { id: 'front/c', vertex: 'upper-right', uv: [1, 0] },
      { id: 'front/d', vertex: 'upper-left', uv: [0, 0] }
    ]
  }]
});
const revised = topology.edit(panel, {
  vertices: [{ id: 'upper-right', position: [2.25, 1, 0] }]
});
const mesh = topology.toSceneMesh(revised, {
  objectId: 'relay',
  partId: 'cover',
  materials: [{ id: 'enamel', color: 0x529987 }]
});
```

The returned document is immutable and can be saved as JSON with
`format: "ink-studio/mesh-topology"` and `version: 1`. Pass the parsed
file back to `create` to validate and reopen it. `edit` accepts upsert
arrays of complete `vertices` and `faces` and arrays of IDs in
`removeFaces` and `removeVertices`. To change a ring, keep the face
ID and the IDs of its retained corners, and supply the revised corner
order. A patch validates all its changes together. For example, it can
remove a face and its otherwise-referenced vertex in the same edit.

Supply optional `edges` with `{id, vertices: [a, b]}` records to name
specific edges. Remaining IDs derive from their unordered endpoint IDs.
An edit keeps a boundary edge's ID while that pair remains adjacent
anywhere in the mesh. A triangulation diagonal exists only in the
render output. `inspect` lists each authored edge and its incident
faces and directed corner pairs, including open boundaries.

Faces are single rings of 3 to 128 corners. Ink triangulates simple
convex or concave rings on their dominant projection, retaining
collinear boundary corners and authored winding. A repeated vertex,
self-intersection, or collapsed projection is a validation error.

## Select authored components

`KIT.meshTopology.select(document, query, options)` returns stable vertex,
edge, or face IDs. Use `sceneEditor.selectMeshTopology(object, query,
{ part, visibility })` to query the current scene snapshot or an open
draft. `mesh-topology inspect` lists IDs for authored edges, including
edges without a hand-written name.

```json
{
  "domain": "edges",
  "filter": {
    "materials": ["rim-bevel"],
    "seam": true,
    "crease": { "min": 24 },
    "visibility": "visible"
  }
}
```

A query starts with all elements of `domain` or with explicit `ids`.
It applies traversal, then `grow`, `shrink`, `convert`, and the filter.
Supply a saved result as `from` to start the next query from those IDs.
The result carries the mesh ID and topology revision. A saved selection
for a changed revision is rejected so it cannot silently target an edit.

| Operation | Behavior |
| --- | --- |
| `traverse: "loop"` | From an edge seed, follow opposite edges through regular four-valence quad vertices. An open-edge seed follows the rim where the boundary is unbranched. |
| `traverse: "ring"` | From an edge seed, cross each incident quad to its opposite edge. Stops at non-quad faces and nonmanifold branches. |
| `traverse: "boundary"` | In the edge domain, follow open boundaries. In the face domain, return the edge perimeter of the selected faces, including open sides. |
| `traverse: "island"` | Follow connected faces across shared edges, edges across shared vertices, or vertices across shared edges. |
| `grow` / `shrink` | Add or remove up to 128 steps of neighbors. Shrink starts where the selection meets unselected components or an open rim. |
| `convert` | Convert to `vertices`, `edges`, or `faces`. `match: "any"` accepts a target with one selected incident element. `match: "all"` requires all of its incident elements in the original domain. |

Filters use any named material on an incident face. A UV seam compares
the UVs at both shared endpoints. A crease measures the angle in degrees
between the geometric normals of two incident polygons. A face or vertex
matches seam and crease filters when one of its edges meets those tests.

Visibility uses the frontmost geometry at the requested native grid and
camera. An edge or vertex needs a visible sample on one of its authored
triangles within one art pixel of that component. Vertex proximity uses
the surrounding square so diagonal pixel neighbors can support a corner. `"hidden"` selects
components without supporting samples in that view, including ones
outside the view or too small to resolve. Re-capture after changing the
camera, pose, or occluders.

```sh
ink-studio mesh-topology select scene.json rim-query.json --object gatehouse-portal --view view.json --out rim-edges.json
ink-studio mesh-topology select scene.json face-query.json --object gatehouse-portal --from rim-edges.json --view view.json --out rim-faces.json
```

Use `--object` for a scene with editable topology or pass the topology
document itself. `view.json` can set `w`, `h`, `t`, and camera options.
The Node SDK exposes `captureMeshTopologyVisibility(world, object, view)`
with the native frame and a portable `visibility` record. Save that
record and pass it to `--visibility` to reuse the exact selection view.
The toolkit-level `captureVisibility(mesh, frame, camera)` uses an
editable mesh, native `sourceSurface` passes, and the matching raster
camera with its focal length.

Run the gatehouse example for a filtered bevel edit, the sign's island
and boundary, and a quad panel showing the same seed as a loop and ring.

```sh
node examples/mesh-component-selection.cjs component-selection-review
ink-studio mesh-topology select component-selection-review/mesh.json component-selection-review/rim-query.json --visibility component-selection-review/visible.json
```

## Transform and snap a component selection

Use a saved selection for the exact topology revision. A transform writes
vertex positions and preserves the IDs, polygons, materials, and corner UVs.
A collapsed or self-intersecting polygon rejects the preview and the edit.

```json
{
  "operation": { "kind": "move", "offset": [-0.18, 0, 0] },
  "space": "world",
  "pins": { "vertices": ["front/left-foot", "throat/left-foot"] },
  "falloff": { "radius": 0.9, "curve": "smooth" },
  "snap": {
    "kind": "plane",
    "origin": [-0.965, 0, 0],
    "normal": [1, 0, 0],
    "anchor": "front/arch-0",
    "maxDistance": 0.2
  }
}
```

```sh
ink-studio mesh-topology transform gatehouse.json request.json --object gatehouse-portal --selection selection.json
ink-studio mesh-topology transform gatehouse.json request.json --object gatehouse-portal --selection selection.json --out revised.json --report evidence.json
```

Without `--out`, the CLI returns the vertex patch and a preview report.
Supply `selection` in the request or pass a selection file. A standalone
topology document can use the same command without `--object`.

A `move` takes an XYZ offset. A `rotate` takes `axis` and `degrees`,
and a `scale` takes a positive scalar or XYZ `factors`. The pivot uses
stored vertex coordinates and defaults to the selected vertices' centroid.
Local transforms use the mesh's stored axes. World transforms use scene
axes. Standalone meshes can declare a local-to-world affine `frame` using
the scene graph transform format. Retained scene meshes store positions
in scene space. In `normal` space, +Z follows the area-weighted selection
normal and +X follows a tangent. Supply world-space `normal` or `tangent`
guides to control the orientation.

Pin explicit `vertices`, the open `mesh` boundary, the `selection`
boundary, or `both` boundaries. The selection boundary is a face
perimeter, the ends and junctions of selected edge chains, or selected
vertices adjacent to unselected vertices. Optional `falloff.radius` is a
world distance measured along connected mesh edges. `linear`, `smooth`,
and `sharp` curves taper the movement, rotation angle, or scale toward
the radius. Pinned vertices block that path.

Snapping uses the edited position of a selected, unpinned `anchor`
vertex or the transformed pivot. The snap moves the affected vertices
by the resolved offset, weighted by falloff. The target is resolved
against the original snapshot. `maxDistance` limits the snap offset in
world units.

| Snap kind | Required target fields |
| --- | --- |
| `vertex`, `edge`, `face` | Stable component `id`. The optional `object` selects another retained mesh. Edges and faces use the closest point on the target. |
| `plane` | World-space `origin` and `normal` |
| `socket` | Placed asset `instance` and bound socket `binding` |
| `sdf` | Authored SDF solid `object` and positive `maxDistance`. Optional `tolerance` and `iterations` control the bounded surface projection. |

Use `KIT.meshTopology.planTransform(document, request, context)` for the
pure planner. A host can resolve extra targets with `context.mesh(id)`
returning `{ document, frame? }`, `context.socket(instance, binding)`
returning a world point, or `context.sdf(id)` returning a signed distance
function. `sceneEditor.planMeshTransform(object, request, options)`
resolves targets from the scene snapshot and enforces hybrid shape
ownership for a managed mesh. `transformMeshTopology` uses
the same plan and writes through the topology transaction. Scene SDF
targets use a named top-level solid's authored field in its rest pose.

A pixel patch for the `mesh-topology` destination can use
`operation: { transform: request }` in place of its raw topology patch.
Include the observed revisions and any required hybrid shape ownership.
The native preview, receipt, and review export carry the snap point,
pinned vertices, weights, and exact before/after positions. Undo and
replay use the existing journal.

```sh
node examples/mesh-component-transforms.cjs component-transform-review
```

The gatehouse demo shifts the left jamb to a construction plane while
keeping footings and outer corners pinned. Teal marks the additional
opening in the native-grid comparison.

## Inspect and repair local mesh health

```sh
ink-studio mesh-topology health mesh.json
ink-studio mesh-topology health scene.json settings.json --object hatch --out health.json
ink-studio mesh-topology repair scene.json repair.json --object hatch
ink-studio mesh-topology repair scene.json repair.json --object hatch --out revised.json --report repair-report.json
```

Health checks report edges with more than two incident faces, nearby
vertex pairs, inconsistent winding on two-face edges, thin render
triangles, and crossing or coplanar triangle contacts between authored
faces. A shared edge or vertex is a supported contact. The scan reports
overlap or crossing that extends beyond that shared boundary. The scan
works on valid retained polygons. The topology validator names malformed
or self-crossing individual polygons before tessellation.

Pass a saved component `selection` in the settings to focus the report
while checking its possible contacts with the rest of the mesh. Tune
`duplicateDistance` and `intersectionTolerance` in mesh units, and
`sliverQuality` from 0 to 1. The default quality cutoff is 0.02. Equilateral
triangles score 1. `maxPairs` caps the work for each spatial pair scan and
`limit` caps the retained examples per issue. Check `complete` and
`truncated` to see how much of the report was captured.

A repair request pins the mesh `revision` from a health or selection
report and lists ordered `operations`. Choose IDs from that report or
`mesh-topology inspect`.

| Operation | Required inputs and behavior |
| --- | --- |
| `weld` | Supply a vertex `keep` ID, a `remove` list, and `maxDistance` from the keeper. Retains the keeper position and the surviving corner UVs. Set `removeCollapsed` to explicitly remove faces the weld collapses. |
| `dissolve` | Supply an `edge` shared by two faces and optionally the face ID to `keep`. The faces must share a plane, material, affine UV mapping and, where present, affine weight interpolation. Optional `tolerance` sets the plane distance threshold. |
| `winding` | Supply an `anchor` face to orient its manifold neighbors relative to its winding, or a `faces` list to reverse explicitly. |

A vertex can retain a `weights` object with named values in [0, 1].
Ordinary position edits preserve these channels. A weld requires matching
weights by default. Use `weights: "keep"` for the keeper's channels or
`"average"` for the mean of the welded vertices, with absent channels
treated as zero. Repairs preserve the weight data for downstream tools.

With no `--out`, repair prints the patch and evidence. Read `canCommit`
before applying the patch. A repair that would introduce or worsen a
non-manifold edge records a blocker and leaves the source editable. The
report includes exact before and after positions, corners, seam uses,
materials and changed weights. Face, corner and edge lineage can carry
through the existing binding and bake review. Re-run the health scan to
check any remaining geometric contacts in the affected area.

The toolkit exposes `KIT.meshTopology.health(document, settings)` and
`KIT.meshTopology.planRepair(document, request)`. Use
`sceneEditor.meshHealth(object, settings)` for the current scene snapshot.
`sceneEditor.planMeshRepair(object, request)` or
`sceneEditor.repairMeshTopology(object, request)` for a retained scene.
A `mesh-topology` pixel patch can use `operation: { repair: request }`
with the normal revision and hybrid shape-ownership checks. Preview,
undo, and replay use the shared transaction.

```sh
node examples/mesh-health-repair.cjs mesh-repair-review
```

The hatch demo welds a split seam while preserving both charts, fixes
the resulting winding conflict, and dissolves the badge's internal edge.
The middle pane marks the weld in teal, the reversed face in rose, and
the dissolved edge in amber. The folder contains the health scans before,
after welding, and after the full repair.

## Cut with a plane or knife path

```sh
ink-studio mesh-topology cut mesh.json cut.json
ink-studio mesh-topology cut scene.json cut.json --object housing --out revised.json --report evidence.json --pieces pieces
```

A cut request carries an `id` and the topology `revision` from a
selection or health report. Set `plane` to an XYZ `origin` and `normal`
for an infinite section in stored mesh coordinates. This request sections a housing along Z.

```json
{
  "id": "housing-section",
  "revision": "<mesh revision>",
  "plane": { "origin": [0, 0, 0], "normal": [0, 0, 1] },
  "cap": { "kind": "triangles", "material": "cut-metal" }
}
```

For a finite knife stroke, supply `knife` instead of `plane`.

```json
{
  "projection": { "origin": [0, 0, 0], "right": [1, 0, 0], "up": [0, 1, 0] },
  "path": [[-0.67, -0.92], [-0.38, -0.22], [0.29, 0.22], [0.63, 0.94]]
}
```

Path points are in mesh units along the orthogonal projection axes. A
path can bend or close by repeating its first point. The knife projects
through the mesh, or through only the faces indicated by an optional
saved `knife.selection`. Shared edges still get conforming vertex
insertions where a selected face meets an unselected one. A finite path
that stops inside a surface can leave one connected piece with new cut
edges. Use a simple path of up to 65 points and an optional positive
`tolerance` in mesh units for plane and cap checks.

Pieces detach by default. Set `split: false` to insert connected cut
edges. `--pieces` writes separate topology documents alongside the
combined edit. With no `--out`, the CLI prints a preview patch and report
without applying the edit. The report lists section edges, boundary
paths, generated cap faces, and interpolation sources for new vertices.

| Cap | Behavior |
| --- | --- |
| `none` | Leave the new boundaries open. This is the default. |
| `ngon` | Fill each simple closed planar boundary with one polygon. |
| `triangles` | Triangulate closed planar loops, including nested loops around a bore. |

Capped pieces require a cap `material`. Caps follow the directed
boundary, get their own planar UV chart, and use new face IDs. Open or
bent boundaries can be left open. The cutter tessellates altered
polygons to keep the rendered surface and its attributes continuous.
Untouched polygons keep their stable IDs. Cut fragments retain explicit
face, edge, and corner lineage. New vertices interpolate named weights,
and new corners interpolate UVs and any named scalar or vector
`attributes` of the source face. Each face uses a consistent corner
attribute layout. Shared vertices can preserve different values on the
two sides of a UV seam.

`KIT.meshTopology.planCut(document, request)` returns the candidate
document, patch, piece documents, and report. Scene SDK hosts can use
`sceneEditor.planMeshCut(object, request)` and
`sceneEditor.cutMeshTopology(object, request)`. A pixel patch uses
`operation: { cut: request }` on a `mesh-topology` destination.
The scene transaction checks the source revision and hybrid ownership
and carries the cut into binding and bake review, undo, and replay.

Run `node examples/mesh-cut/render.cjs mesh-cut-review` for the native
art-grid comparison. For pointer and slider editing, build with
`npm run build -- development` and open
`examples/mesh-cut/index.html`. The browser example can load a topology
JSON file, place a path or move a plane, preview pieces and caps, apply
or undo the cut, and save the mesh or the replayable request.

## Record correspondence through an edit

`KIT.meshTopology.editWithCorrespondence(before, patch)` returns the
edited `document` and a versioned `correspondence` receipt.
`KIT.meshTopology.correspond(before, after, options)` compares two
independently saved topology documents. The existing `edit` result
still contains the topology document.

```sh
ink-studio mesh-topology edit before.json patch.json --out after.json --report correspondence.json
ink-studio mesh-topology correspond before.json after.json --out correspondence.json
```

The receipt groups faces, corners, and authored boundary edges. Each
group lists its source IDs, target IDs, status, and individual links.
The statuses are `retained`, `replaced`, `split`, `merged`, `reworked`
(many-to-many), `deleted`, `created`, and `unresolved`. Deleted and
created groups have no accepted link under the comparison's settings.

Stable IDs are exact within one logical mesh. Ink can also verify a
complete shared boundary partition, a continuous edge chain between
the original endpoints, and shared vertex IDs within related faces.
An edge split reports each child's interval along the coarse edge.
For a more complex edit, such as remeshing through new interior
vertices, supply lineage from the tool that performed the operation.
Put it in the patch as `lineage`, pass it in the SDK's options, or use
`--lineage links.json` when writing a receipt.

```json
{
  "faces": [
    { "from": "cover", "to": "cover-left" },
    { "from": "cover", "to": "cover-right" }
  ]
}
```

Each lineage link references an existing source and target ID in its
domain. Authored and topology-based links have confidence 1 and give
their evidence method explicitly.

### Project an unmatched revision

Pass `options.projection` or `--projection settings.json` with a
positive `maxDistance` in scene units. Projection proposes one-to-one
matches for elements that lack exact or authored links. Use
`matchIds: false` in the SDK or `--match-ids off` in the CLI if an import
reuses index-derived IDs.

```json
{ "maxDistance": 0.08, "minNormalDot": 0.8, "maxUVDistance": 0.05 }
```

Face matches compare material, winding, and reciprocal surface
samples. The receipt includes the farthest sample in each direction
with the hit triangle's corner IDs and barycentric weights. Edge
matches compare endpoints, orientation, and incident materials.
Corner matches require a related face and compare position and UV.
Each accepted projected link has confidence below 1.

`minConfidence` defaults to 0.5. Competing scores within the
`ambiguity` margin of 0.05 stay unresolved, along with low-confidence
or non-reciprocal candidates. Read the candidate evidence in
`domains.<domain>.unresolved`. When the `maxChecks` budget runs out,
the receipt marks projection incomplete and keeps the exact links.
The default budget is 250,000 checks.

## Run the correspondence demo

The relay comparison highlights a cover split, a merged service
plate, and a removed clip. The shape stays on the same art grid.
A second report follows the revised panel through a reimport that
changes every element ID and shifts the surface slightly.

```sh
node examples/topology-correspondence.cjs topology-correspondence-review
ink-studio mesh-topology correspond topology-correspondence-review/after.json topology-correspondence-review/reimport.json --projection topology-correspondence-review/projection.json
```

## Edit topology in a scene transaction

Put the editable document in the diorama's `topologyMeshes` map. The
key is the scene object ID. The row stores the topology, native
materials, optional named part, and any element bindings or material
bakes that depend on the mesh.

```js
sceneSource.topologyMeshes = {
  relay: {
    document: panel,
    part: 'front',
    materials: [{ id: 'enamel', color: 0x50646f }],
    bindings: [{ id: 'cover-mask', domain: 'faces', element: 'front' }],
    bakes: [{
      id: 'paint-atlas',
      material: 'enamel',
      maps: { texture: { width: 1, height: 1, pixels: [82, 153, 135, 255] } }
    }]
  }
};
```

A binding targets a stable `faces`, `edges`, or `corners` element and
can carry JSON `data` for its consumer. A unique exact correspondence
can rebind it. A split, deletion, or projected match flags it for review
with available candidates. A retained element whose geometry changes
is reported as displaced. Read usable bindings from
`world.topologyMeshes[object].resolvedBindings`.

Each bake registers native material maps against the faces using its
material. The scene uses those maps while the bake is ready. A change to
those faces, including their UVs, invalidates the bake, and the scene
then uses the base material. Invalidation keeps the original map bytes
in the snapshot. Unrelated materials keep their ready bakes.

Use `editor.meshTopology(object, part)` to inspect the source row and
`editor.editMeshTopology(object, patch, options)` to edit it inside the
scene editor journal. To record and replay the operation with other pixel
commands, declare a `mesh-topology` destination bound to the same scene,
object and optional part. Send an `apply` command with the observed
`revision` and `sourceRevision`, the frame, and
`operation: { patch, projection? }`. The patch is the same one used by
`KIT.meshTopology.editWithCorrespondence`.

A normal preview shows target evidence. An exact preview also shows
element-level before and after rows, correspondence, bindings and bake
validity in `diff.topology`, along with matched native renders. Review
bundles include that evidence in `topology.json`. Undo and redo restore
the mesh, bindings, bake validity and any pixel edits in the same
journal entry.

### Run the transaction demo

```sh
node examples/mesh-topology-transaction.cjs mesh-transaction
node cli/ink-studio.js pixel-art session init mesh-session mesh-transaction/pixel.json --scene mesh-transaction/scene.json
node cli/ink-studio.js pixel-art session run mesh-session mesh-transaction/request.json
node cli/ink-studio.js pixel-art session undo mesh-session
node cli/ink-studio.js pixel-art session run mesh-session mesh-transaction/replay-command.json
```

The 1× frames and comparison show the original relay, edited cover,
undo, and replay. The review bundle includes the native pixel annotation,
a binding flagged for review, a displaced fastener, and the invalidated
cover atlas. The separate badge atlas stays active.

## Render, pick, and import indexed geometry

- Put the result of `KIT.meshTopology.toSceneMesh` in the scene's
  `meshes` array, alongside other indexed meshes, splats, and
  SDF-derived surfaces. Material descriptors use the native mesh API.
- Use `KIT.meshTopology.triangulate` for flat positions, UVs, indices,
  material IDs and triangle slots. Render vertices can split at UV
  seams while the document keeps one shared geometric vertex.
- Use `KIT.meshTopology.triangleSource(mesh, hit.triangle)` to map an
  indexed-mesh pick on that render mesh to the authored face and three
  corner IDs, in barycentric order. After an edit, rebuild the render
  mesh and use the new map. Triangle indices belong to one generated
  mesh.
- Use `KIT.meshTopology.fromIndexed` with an ID, flat positions and
  indices, optional UVs, material IDs, and triangle material slots.
  Each input triangle becomes an editable face with deterministic IDs.
  Existing index sharing becomes topology connectivity. Preserve
  original polygon rings by supplying them to `create`.

## Run the relay demo

The demo inserts a new corner into a painted relay housing and adds a
second cut facet. It writes matched native-grid renders, both topology
documents, the edit patch, and a face-and-edge report including the
stable IDs at a shared seam.

```sh
node examples/editable-mesh-topology.cjs mesh-topology-review
node cli/ink-studio.js mesh-topology inspect mesh-topology-review/before.json
node cli/ink-studio.js mesh-topology edit mesh-topology-review/before.json mesh-topology-review/patch.json --out mesh-topology-review/replayed.json
node cli/ink-studio.js mesh-topology triangulate mesh-topology-review/replayed.json --out mesh-topology-review/triangles.json
```

## Extrude, inset, or thicken a face region

Save a face selection with `mesh-topology select`, then give its
revision and IDs to the face-region planner. Neighboring selected faces
are edited together and share the new rim. Each disconnected region is
handled in its own frame.

```sh
ink-studio mesh-topology face-region meter.json inset.json
ink-studio mesh-topology face-region meter.json inset.json --out framed.json --report inset-report.json
ink-studio mesh-topology face-region workshop.json recess.json --object meter --out revised.json --report review.json
```

A request contains an `id`, `revision`, saved `selection` and `operation`.
Use the mesh's stored units for the operation's `distance`.

- `{ "kind": "extrude", "distance": 0.25 }` offsets the selected faces along
  the region's area-weighted normal and joins them to the existing
  boundary. Use a negative distance for a recess or supply a nonzero
  XYZ `direction`. A fully enclosed region needs a selection boundary
  for extrusion.
- `{ "kind": "inset", "distance": 0.2 }` creates a planar border of the
  specified width from the outline and any holes. The selected region
  keeps its polygons and authored UVs by default. A large inset can
  collapse a narrow corner. For a recessed panel, inset first, then use
  a fresh face selection for a negative extrusion.
- `{ "kind": "thicken", "distance": 0.2 }` adds a reverse-facing inner
  skin behind the authored surface, with offset miters at bends. Select
  complete surface islands. Open shells get stitched edge walls and
  closed surfaces get an inward cavity. Use an inward extrusion for a
  patch attached to surrounding faces.

Set `rim.material` and `interior.material` independently. Without
overrides, each new face inherits the material of its source. Rim
`uv: "strip"` (default) maps U along each boundary loop by length and V
across the rim. Choose `"per-edge"` to give each wall quad its own full
UV rectangle. The interior defaults to `uv: "preserve"`, which keeps
authored paint coordinates. Choose `"planar"` for a per-face planar
projection. A thickening edit leaves the original skin and paint intact.

Set `minWall` to the minimum acceptable distance between opposing
surfaces. The default is 5% of the edit distance or four times the
geometric tolerance, whichever is larger. The receipt includes blocking
face IDs, measured separation and witness points when a thin wall is
found. The planner also checks polygon orientation, mesh contacts, and
sampled contact along extrusion and shell movement. A failed or
incomplete check prevents commits through the CLI and scene editor.
`--report` still writes the evidence for a blocked commit. Use the
optional `tolerance` in mesh units to set the contact tolerance.

The SDK's `KIT.meshTopology.planFaceRegion(mesh, request)` returns
`document`, `patch`, and `report`. Inspect `report.canCommit` before
installing the patch on a standalone mesh. A retained scene provides
`editor.planMeshFaceRegion(object, request)` and
`editor.editMeshFaceRegion(object, request)`. Bound pixel transactions
accept `operation.faceRegion` and keep the revised source geometry,
displaced bindings, bake invalidations, and edit receipt in the same
undo and replay history.

Run `node examples/mesh-face-region/render.cjs <directory>` for native
art-grid comparisons and reproducible face selections and requests.

## Edit edge loops and fill openings

Use `mesh-topology select` to save an edge seed, chain, or boundary.
Every edge-edit request carries an `id`, the topology `revision`, and
an `operation` with the saved selection or selections.

```sh
ink-studio mesh-topology edge-edit joint.json insert.json
ink-studio mesh-topology edge-edit joint.json insert.json --out revised.json --report receipt.json
ink-studio mesh-topology edge-edit workshop.json bridge.json --object coupling --out revised.json
```

- **Insert a loop** with `kind: "insert-loop"`, a `selection` holding
  one seed edge, and a `fraction` strictly between 0 and 1. The cut
  follows opposite edges across quads in both directions. Use `start`
  to choose the seed endpoint used for fraction zero. At a non-quad or
  protected edge, the neighboring polygon receives a matching corner
  so the transition stays connected. Every split face keeps its
  material, and new corners sample UVs and other attributes separately
  on each face, including across seams. New vertices blend source
  weights.
- **Slide an edge chain or loop** with `kind: "slide"`, a `selection`,
  and an `amount` strictly between -1 and 1. Positive amounts follow
  the face winding on the forward side of the ordered chain. Negative
  amounts follow the other side. Use `start` to pick a closed loop's
  start or an open chain's endpoint. A movable vertex needs one
  unambiguous rail on the chosen side. The slide keeps all face and
  corner IDs, corner paint coordinates and vertex weights.
- **Bridge rims** with `kind: "bridge"` and `first` and `second` saved
  selections. Each selection must describe an entire exposed loop, and
  both loops must have the same edge count. The default alignment
  minimizes the total squared pairing distance while matching the
  rims' winding. Set `starts` to a vertex ID on each rim and `offset`
  to control the pairing. Use `segments` from 1 to 32 to add rows of
  quads with interpolated weights. Set `material` explicitly or let the
  faces inherit materials from the nearest end. Use `uv: "strip"` for
  a length-based strip chart, or `uv: "inherit"` to match the adjacent
  face's UVs at each rim, including at seams.
- **Fill a grid** with `kind: "grid-fill"` and a `selection` of one
  exposed boundary with an even edge count. Set `start` to the desired
  first corner and `columns` to the number of edges along the first
  side. Rows are inferred from the remaining perimeter. The grid
  follows all four boundary profiles, uses its own normalized UV
  chart, and blends interior weights and corner data from the
  surrounding faces. Set `material` explicitly or inherit the nearest
  rim face's material.

Use `pins.vertices` to hold vertex positions, `pins.edges` to hold
edge endpoints and prevent subdivision, or `pins.boundary: true` to
protect every exposed edge. Bridge and grid fill keep the existing
rims and their face-corner UVs intact. If a new patch samples a named
corner channel with incompatible scalar and vector layouts, the
receipt lists that channel under `attributeConflicts`.

The preview contains the exact patch, affected faces, protected stops,
generated vertex sources, and geometry findings. Invalid polygons,
flipped slides, surface intersections, or incomplete contact checks
block the CLI and retained-scene commit. The command still writes
`--report` when a geometry check blocks a commit. Review
`report.canCommit` before installing a standalone patch from
`KIT.meshTopology.planEdgeEdit(mesh, request)`.

For a retained scene use `editor.planMeshEdgeEdit(object, request)`
and `editor.editMeshEdges(object, request)`. A bound pixel transaction
can use `operation.edgeEdit` to include topology, binding review and
bake invalidations in the same undo and replay history.

Run `node examples/mesh-edge-edit/render.cjs <directory>` for playable
CLI requests and native-grid comparisons.

## Bevel selected edges

Save an edge selection, then submit a bevel with its mesh revision. The
planner cuts real polygons into the source mesh and keeps the adjoining
authored face and surviving corner IDs. Clipped corners sample the source
face's own UV and attributes. New vertices carry interpolated weights.

```sh
ink-studio mesh-topology bevel console.json bevel.json --view view.json --preview art-grid
ink-studio mesh-topology bevel console.json bevel.json --view view.json --out revised.json --report review.json
ink-studio mesh-topology bevel workshop.json bevel.json --object console --out revised-scene.json
```

A request carries an `id`, `revision`, and a `bevel` object with a saved
`selection` and a positive `width`. Width measures setback along
each adjoining face in mesh units. Optional `weights` rows contain
`edge` and `weight` from 0 to 1. The effective width is the width scaled
by the edge weight. An omitted weight is 1 and a zero weight skips the edge.

- `profile: "chamfer"` uses one flat facet. `profile: "round"` uses
  one to 16 facets of a circular profile, with three by default.
  For a custom profile, give `profile.points` as normalized setbacks
  along the two adjoining faces, ordered by their face IDs.
  The points form a convex cross section from `[1,0]` to `[0,1]`.
  Their count determines the number of segments unless it is specified.
- `join: "miter"` (default) intersects the neighboring bevels.
  `join: "patch"` adds a flat corner patch where multiple beveled edges
  meet. New bevel faces use a length-based strip chart. They inherit
  adjacent materials by default or take an explicit `material`.
- The cutter supports convex, consistently wound edges with two planar
  incident faces and a closed local section. It checks contacts and
  rejects widths that consume an authored face or cut beyond the edge
  neighborhood. The rest of the mesh may include separate components.

Use `protect.faces` or `protect.materials` to prevent trimming specified
surfaces. To allow some trimming while keeping a lettering or coating
region, give a `protect.paint` row with `face`, `min`, and `max`
normalized UV coordinates. The retained polygon must still contain the
whole rectangle with the same affine UV-to-mesh mapping. Scene edits
also block invalidation of an active bake on a protected material.
`protect.gaps` accepts bounded clear rays with `id`, `origin`,
`direction`, and `distance`.

`--preview` writes matched `before.png`, `after.png`,
`difference.png`, and the candidate’s `normals.png` at 1×. Amber marks coverage changes and pink marks
color changes. Use `--view` with an optional native `w`, `h`, `t`,
and `camera` to lock the shot. Standalone meshes support JSON
`materials` and default to direct material colors. Scene previews
use the scene's authored look unless `raw: true` is chosen.
Add `protectPixels` rows with `at: [x,y]` and `kind` set to
`color` (same RGB and depth occupancy), `coverage` (same depth
occupancy), or `gap` (unoccupied before and after). Passing this view
with `--out` applies those guards before writing a revised file.

`KIT.meshTopology.planBevel(mesh, request)` returns the exact geometry
patch, the candidate document, and a receipt with `canCommit`, edge
widths, protection findings, facet IDs, and vertex sources. Retained
scenes expose `editor.planMeshBevel(object, request)` and
`editor.bevelMeshTopology(object, request)`. Bound pixel edits can
submit `operation.bevel` for the same topology journal and undo path.
Use the example in `examples/mesh-bevel` for matched native previews
and replayable requests.

## Author corner normals and creases

A retained polygon can store a `normal` on each face corner. Edges can
store a `smooth` override and a subdivision `crease` from 0 to 1.
The edit addresses stable corner and edge IDs. Positions, UVs, skin
weights, material assignments, and registered paint stay on the source
cage.

```sh
ink-studio mesh-topology shading mesh.json
ink-studio mesh-topology shading mesh.json normals.json --out revised.json --report receipt.json
ink-studio mesh-topology shading revised.json --view view.json --preview art-grid
ink-studio mesh-topology shading revised.json --view view.json --preview rounded --subdivision 2
```

An edit request has an `id`, the current topology `revision`, and one or
more of these fields.

- `edges` contains rows with an `id` and `smooth: true` or
  `smooth: false` for smooth or hard shading. Omit a field to leave it
  alone. Set it to `null` to clear the override.
- `corners` contains rows with an `id` and a `normal: [x,y,z]` in
  stored mesh coordinates. The direction is normalized. Use
  `normal: null` to return the corner to generated shading.
- `settings` sets the document-wide `smooth` default and
  `weighting`, which can be `uniform`, `area`, `angle` (default),
  or `area-angle`. Without a smooth default or edge override,
  the mesh keeps its flat rendering. Set `settings: null` to clear
  document-wide settings.

A smooth fan averages the geometric normals of faces connected at a
vertex through smooth, consistently wound manifold edges. UV islands
can share the resulting shading direction while retaining their own UVs.
An explicit corner direction takes precedence over the generated fan.
Headless and WebGL rendering use the interpolated direction for surface
lighting. Geometry still controls depth, coverage, and ray hits.
The native preview writes `beauty.png`, `geometric.png`, and
`shading.png` on the same 1× grid. In `comparison.png`, geometric normals
appear on the left and shading normals on the right. Each normal image
encodes XYZ as RGB.

An edge's `crease` controls subdivision separately from `smooth`.
Zero uses the standard smooth mask, one keeps a sharp ridge, and
fractional values blend the masks. Catmull–Clark preview treats open
boundaries as sharp and carries crease strengths onto their descendant
edges at each level. It keeps material assignments, interpolates skin
weights, and refines UVs separately on each face. Use up to three
`--subdivision` levels with `--preview` to inspect the result and write
`derived.json`. The regular `--out` file remains the editable cage.
Standalone view files support the same `w`, `h`, `camera`, `t`,
`raw`, and `materials` settings as bevel captures.

The SDK exposes `KIT.meshTopology.planShading`, `inspectShading`,
and `subdivide`. Retained scenes expose `editor.planMeshShading`
and `editor.editMeshShading`. A bound pixel transaction can use
`operation.shading` to record the edit in the same undo and replay
journal. Run `node examples/mesh-shading/render.cjs <directory>` for
a worked example.
