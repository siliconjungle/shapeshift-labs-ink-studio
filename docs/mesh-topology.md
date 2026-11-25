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

Use [tile component selection](mesh-uv.md#select-tiles-edges-vertices-or-instances)
to query retained tile bindings, edges, vertices, or scene instances
within the domains enabled by a tile edit.

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

Use `"visibility":"through"` to include projected components behind
other surfaces within the camera view. Set `"backfaces":"exclude"` in
the same filter to require front-facing support in visible or through
mode. The [view selection guide](mesh-uv.md#select-visible-or-through-the-view)
shows both modes and how to save a reusable capture.

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

## Set a construction plane

The construction plane is a scene guide with an origin, perpendicular
right and up directions, and a positive grid interval in scene units.
Its normal follows right cross up. The default is the XY plane at the
origin with a grid interval of one scene unit.

```sh
ink-studio mesh-topology plane draft.json --origin 1,2,3 --right 0,0,-1 --up 0,1,0 --grid .25 --out jig.json
ink-studio mesh-topology plane jig.json
ink-studio tileset stamp --scene jig.json --selection brick.json --object gate --face panel --plane 2,1 --out stamped.json
ink-studio mesh-topology move stamped.json --object gate --vertex panel/v2 --by .1,.1,.2 --space plane --align grid --out aligned.json
```

Query the plane with no changes, or omit `--out` to review a proposed change.
A scene revision can move the origin, turn the axes, or change the interval
independently. A plane edit affects subsequent commands.

For [tile stamping](mesh-uv.md#place-a-painted-tile-as-a-mesh-face), the
`--plane U,V` pair places the lower-left corner in grid steps along right
and up. Fractional steps allow deliberate offsets. Brush density determines
the face dimensions.

In a component transform request, `"space":"plane"` interprets move,
rotation, and scale axes as right, up, and normal, with offsets in scene
units. The pivot defaults to the plane origin. Set `"planePivot":[2,1]`
to choose a different point in grid steps. The report includes the plane
and resolved world pivot.

Set `"snap":{"kind":"construction-plane","mode":"plane"}` to project a
transformed anchor onto the plane, or set `"mode":"grid"` to reach its
nearest grid intersection. The existing `anchor` and `maxDistance`
settings apply. With `mesh-topology move`, pass `--align plane` or
`--align grid` to align the named vertex. A zero offset performs alignment
alone.

In Node, use `editor.constructionPlane()` and
`editor.setConstructionPlane(changes)`. Changing the plane uses the scene
editor's undo journal. Stamp requests take `planeAt:[u,v]`. A standalone
`KIT.meshTopology.planTransform` can take a plane as
`context.constructionPlane`.

Run `node examples/tileset-pick/construction-plane-demo.cjs plane-demo`
to replay a relocated plane, two stamps, a pivot rotation, and grid alignment.

### Set grid increments and rounding

Use `--grid N` for equal intervals along right and up, or `--grid U,V`
for independent intervals in scene units. The stored rounding mode
applies to `--align grid` and to a tile stamp with `--snap-grid`.

```sh
ink-studio mesh-topology plane wall.json --grid .5,.25 --rounding floor --out course.json
ink-studio mesh-topology plane wall.json --grid-preset texel --out texel-guide.json
ink-studio mesh-topology plane wall.json --grid-preset brick --grid-tileset masonry --rounding ceiling --out brick-guide.json
ink-studio mesh-topology plane wall.json --grid-preset module --module-size 2,1 --out module-guide.json
ink-studio tileset stamp --scene brick-guide.json --selection brick.json --object wall --face next --plane 1.7,-.2 --snap-grid --out next.json
```

- `nearest` uses the closest intersection, with exact ties toward the
  positive axis. It is the default.
- `floor` rounds toward the negative end of each plane axis.
- `ceiling` rounds toward the positive end of each plane axis.

The `texel` preset uses one texel at the scene or project density, with
16 texels per unit as the default. `brick` uses the selected sheet's
configured tile width and height without gutters. With no sheet, it
uses the scene default tile dimensions or a 16×8 texel brick. `module`
uses the supplied scene-unit dimensions or one unit on each axis.
The preview reports the resolved preset. The saved guide stores the
numeric increments for repeatable placement.

A fractional `--plane U,V` address gives an exact position. Add
`--snap-grid` to round it and see the chosen `gridAt` in the preview.
In Node, pass `snapGrid:true` with `planeAt` when stamping. Use
`KIT.authoring.constructionPlane.gridPreset(scene,{kind,tileset,moduleSize})`
to resolve presets and `editor.setConstructionPlane({grid,rounding})`
to save the settings.

Run `node examples/tileset-pick/construction-grid-demo.cjs grid-demo`
to compare the same address under all three rounding modes.

### Pick and lock a plane from the camera

Use `--from-camera` to choose the most face-on world plane from the
authored view. A yaw or pitch override also requests a pick. Angles
are in radians, as for `render`. Use `--at` and `--camera-shot` to sample
a rigged camera. The pick preserves the plane origin and grid interval.
Its normal faces the camera and its grid axes follow the screen as
closely as the cardinal axes allow. Equal scores prefer Z, then X, then Y.

```sh
ink-studio mesh-topology plane draft.json --from-camera --out auto.json
ink-studio mesh-topology plane auto.json --lock x --out locked.json
ink-studio mesh-topology plane locked.json --from-camera --yaw 3.14 --out orbited.json
ink-studio mesh-topology plane orbited.json --from-camera --lock off --out repicked.json
```

X, Y, and Z locks name the plane's normal axis. Once saved, a lock
holds the exact right and up vectors through later camera picks,
including an orbit to the opposite side. `--lock off` clears the lock.
Combine it with `--from-camera` to pick a new orientation immediately.
Read the preview's `camera.axis` and `camera.kept` to see the choice.
Stamps, pivots, and alignment use the saved plane.

Hosts with a live camera pose can call
`KIT.authoring.constructionPlane.pick(plane, pose, {lock})` with a
`CameraLens` pose. Omit `lock` to honor the stored setting or pass `null`
for automatic picking. Save the returned plane with
`editor.setConstructionPlane({...picked.plane,lock:picked.plane.lock ?? null})`.

Run `node examples/tileset-pick/camera-plane-demo.cjs orbit-demo`
to compare automatic and locked placement through the same orbit.

### Snap the construction origin

Preview a new origin from a scene vertex, an instance, or a saved mesh
selection. The preview gives the resolved scene-space target. Add
`--out` to publish the new plane with its current axes and grid.

```sh
ink-studio mesh-topology plane wall.json --snap-origin vertex --object wall --vertex eave-left
ink-studio mesh-topology plane wall.json --snap-origin instance --instance doorway --out door-guide.json
ink-studio mesh-topology select wall.json trim-query.json --object wall --out trim-selection.json
ink-studio mesh-topology plane wall.json --snap-origin bounds --object wall --selection trim-selection.json --out centered.json
ink-studio mesh-topology plane wall.json --snap-origin average --object wall --selection trim-selection.json --out averaged.json
```

- `vertex` uses the authored vertex position on a retained scene mesh.
- `instance` uses the transformed local origin of a prefab or asset-part
  placement. Use `--instance-kind prefab|asset-part` to disambiguate a
  shared ID.
- `bounds` uses the midpoint between the minimum and maximum coordinates
  of the selected geometry along the scene axes.
- `average` gives each selected element equal weight. It averages vertex
  positions, edge midpoints, or face corner averages for the selection's
  domain.

Selection files must match the current mesh revision. Origin snaps save
the computed position. An edge-anchored plane can snap along its current
edge and retain the hinge. Use `--detach-edge` to snap to a point away
from the edge and keep the resolved orientation.

In Node, use `editor.planConstructionOrigin(request)` to get the target
and plane, or `editor.snapConstructionOrigin(request)` for an undoable
edit. A request names `kind` and supplies `object` and `vertex`,
`instance` and optional `instanceKind`, or `object` and `selection`.
Pass `{detachEdge:true}` as the second argument to clear a hinge.

Run `node examples/tileset-pick/origin-snap-demo.cjs origin-snap-demo`
to stamp at each target and compare the four placements.

### Tilt a plane from an existing edge

Hinge the construction plane on an authored mesh edge. The preview
includes the mesh and edge IDs, directed endpoint IDs, fraction along
the edge, tilt in degrees, and the reference up vector. The plane uses
the edge direction as right and keeps the working grid interval.

```sh
ink-studio mesh-topology plane wall.json --edge-object wall --edge eave --edge-from left-top --tilt 30 --reference-up 0,0,-1 --out roof-guide.json
ink-studio tileset stamp --scene roof-guide.json --selection roof-tile.json --object roof --face first-panel --plane 0,0 --out roof.json
ink-studio mesh-topology plane roof-guide.json --tilt 45 --out steep-roof-guide.json
```

Positive angles follow the right-hand rule around the directed edge.
`--edge-from` chooses its starting vertex and defaults to the first
retained endpoint. `--edge-at` chooses a fraction from 0 at that vertex
to 1 at the far end. Without `--reference-up`, a new hinge starts from the
working plane's up direction projected perpendicular to the edge. Its
normal supplies the fallback for a parallel edge. A later `--tilt`
measures from that retained reference.

Subsequent stamps, plane pivots, and alignment follow the live authored
edge. Previously placed geometry keeps its own positions. If the edge
is removed or its endpoint IDs change, the next plane-dependent edit
reports the missing or changed anchor. Re-select an edge, or use
`--detach-edge` to keep the current frame as a free plane. If the edge
is unavailable, detaching keeps the last saved frame. A camera pick or
an explicit origin or orientation edit requires detaching the hinge.
Selecting a hinge replaces an axis lock.

In Node, use `KIT.authoring.constructionPlane.tilt(scene, options)` and
save the returned `plane` with `editor.setConstructionPlane(plane)`.
Use `editor.constructionPlane()` to resolve it after an edge edit.
Run `node examples/tileset-pick/edge-plane-demo.cjs roof-demo` to compare
two roof pitches and stamp again after moving a hinge endpoint.

## Move one vertex

Run `mesh-topology move` with an existing vertex ID and an XYZ offset in
mesh coordinates. A retained scene mesh also needs its object ID.

```sh
ink-studio mesh-topology move gatehouse-sign.json --object entrance --vertex painted-sign/v2 --by .25,.125,0
ink-studio mesh-topology move gatehouse-sign.json --object entrance --vertex painted-sign/v2 --by .25,.125,0 --out revised.json
```

The preview records the vertex ID, exact positions before and after the
move, and topology revisions. To commit against the reviewed input, pass
the preview's `beforeRevision` as `--expect`. The move uses the component
transform planner and the scene's topology transaction. A standalone
topology document also works without `--object`.

Use [tileset stamp](mesh-uv.md#place-a-painted-tile-as-a-mesh-face) when
adding a face. Its preview records the source rectangle and new face,
vertices, and UVs. Use a [component selection](#transform-and-snap-a-component-selection)
for moving several vertices, snapping, or applying proportional falloff.

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
| `construction-plane` | Scene guide and optional `mode` of `plane` or `grid` |
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

## Combine closed mesh parts

Use `KIT.meshTopology.planBoolean(document, request)` for union,
difference, or intersection. Each operand is a closed, consistently
oriented set of faces in the same coordinate system. Omit selections to
use two full documents. For two parts in one document, give disjoint
target and tool selections and omit the tool document. A selection can
be a saved component selection or a query such as
`{ domain: 'faces', ids: faceIds }`. This form replaces both selected
shells with the result and keeps the rest of the document.

```js
const mesh = KIT.meshTopology;
const plan = mesh.planBoolean(gauge, {
  id: 'open-window',
  revision: mesh.revision(gauge),
  operation: 'difference',
  operand: { document: cutter, revision: mesh.revision(cutter) },
  cutMaterial: 'fresh-copper'
});
console.log(plan.report.canCommit, plan.report.faces);
```

The mesh solver is the default. It splits polygons where the solids
intersect and stitches compatible boundaries. Where possible, it
preserves uncut authored polygons, UVs, IDs, and edge records. New
corners interpolate UVs and compatible attributes from their source
face. New vertices interpolate weights. A difference uses the tool's
surface materials on new interior walls unless you supply
`cutMaterial`. Each result face reports the operand and original face
that supplied it.

### Request the SDF fallback

Specify `solver: { kind: 'sdf', cell: 0.12 }` in the request to use Ink’s
[mesh-to-field conversion](headless-authoring.md#textured-sdf-reconstruction)
and then reconstruct the signed Boolean. The cell size is specified in
mesh coordinates. The report includes the actual sampling pitch of
both conversion grids and of the reconstructed surface. A blocked mesh
solve returns its issues so you can decide whether to request the field
solver. Both paths require closed, oriented input and check the
topology of the resulting solid.

The field solver projects UVs and source attributes to the reconstructed
faces and issues new topology IDs for the sampled region. Its report
records where sampling changed the result.

| Diagnostic | Evidence |
| --- | --- |
| Edge shape | Points along hard polygon edges, their nearest reconstructed positions, distances, and normal agreement. When the mesh solve is unavailable, the report samples eligible input edges |
| Shell thickness | Reference intervals obtained from polygon intersections along each ray, reconstructed intervals, thickness deltas, and any lost or new walls |
| Material ownership | Before and after operand, source face, and material at matched ray boundaries |

Set `edgeTolerance` and `thicknessTolerance` on the SDF solver to tune
when a measured difference is flagged. Add up to 64 named probes with
`id`, `origin`, `direction`, and `distance` to check a particular
clearance, opening, or thin panel. Start and end those rays outside the
solids. The automatic probes cover three axes. Measurements remain
samples of the result and depend on the selected pitch.

### Preview and apply a scene Boolean

Use `editor.planMeshBoolean(object, request)` to preview an edit to
an authored scene mesh and `editor.booleanMeshTopology(object, request)`
to apply it. Set `operand: { object, part, revision }` to use another
editable scene mesh. The tool mesh stays editable in the scene and
its used material definitions travel with the result where compatible.
Disambiguate conflicting material IDs before applying. Apply as
`operation.boolean` on a bound `mesh-topology` destination to get
the ordinary preview, correspondence, receipt, bake invalidation, and
undo behavior. A standalone mesh can contain an empty Boolean result.
Scene edits require a retained polygon mesh.

The [gauge demo](../examples/mesh-boolean/README.md) shows all three
operations and a sampled difference. The matched native-grid captures
isolate the edited mesh. The difference image records visible coverage,
depth and material changes. The JSON report carries individual probes
and face ownership.

```sh
node cli/ink-studio.js mesh-topology boolean gauge.json fallback-request.json \
  --operand cutter.json --view view.json --preview review \
  --out edited.json --report report.json
```

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

## Transfer material data to a replacement mesh

Use a correspondence map produced from the painted source and the exact
replacement revision. The receipt includes both topology revisions. Generate
a new map after changing either mesh. Add face or corner lineage where the
replacement tool knows the correspondence.

```sh
ink-studio mesh-topology correspond painted.json replacement.json \
  --lineage links.json --out revision-map.json
ink-studio mesh-topology transfer-materials painted.json replacement.json revision-map.json \
  --materials painted-materials.json --out transferred.json \
  --out-materials transferred-materials.json --report transfer-report.json
```

`KIT.meshTopology.transferMaterials(source, replacement, map, options)`
returns the proposed `document`, retained `materials`, undoable topology
`patch`, and `report`. Use the document and material array in a
`topologyMeshes` scene entry. Keep the replacement's existing material
definitions for faces left open for review.

Transfer keeps the replacement's geometry and copies each accepted source
material slot. Exact links copy per-corner UVs, authored normals, and named
numeric attributes. New corners use bounded barycentric sampling of the
linked source triangles. Checks inside each changed triangle catch UV or
corner channels that the replacement's interpolation would distort. On a
protected target UV corner, a change requires review. Authored source seams
follow exact links on accepted edges.

The transferred UVs point to the original material atlas. Supply material
definitions with the normal topology scene fields and optional `masks`,
an object mapping mask names to matching one-byte-per-texel arrays.
For indexed pigment, use `texture: { width, height, palette, indices,
coverage }`, with optional coverage. The palette entries are RGB24
integers. Indices, coverage, and mask bytes are copied unchanged, including
distinct indices with identical RGB colors. Use a subsequent [registered
rebake](registered-material-bake.md#rebake-a-topology-or-uv-revision) when
the replacement also needs a new atlas layout.

Projection checks competing samples on weak links, including nearby
opposing walls and overlapping sheets. When one replacement face crosses
a source UV seam or material boundary, split it into corresponding regions
before retrying. The report lists unresolved faces with the reason and
available source triangle, distance, and barycentric evidence. Use
`--settings` for `maxDistance` in model units, `minNormalDot`,
`ambiguityDistance`, `maxUVError` in normalized UVs, or `maxChecks`.
The meshes need a common rest-space coordinate system for projection.
Use explicit lineage to identify overlapping parts when their identity
is known.

Omit `--out` to preview the full plan. If issues remain, the CLI writes
the report and leaves the output mesh and material files unwritten.
`--partial on` writes accepted faces and leaves unresolved faces at their
replacement values.

```sh
node examples/mesh-material-transfer.cjs tide-case-review
```

Open `comparison.png` to see the Tide Survey Case with its replacement
front panel, rejected badge seam, and repaired badge. The bundle includes
the indexed PNG, seal mask, topology revisions, maps, and receipts.

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

## Draw surface-snapped retopology patches

Use `KIT.meshTopology.planRetopology(document, request)` to propose an
editable quad strip or local grid. Draw the bottom and top rails in
the reference surface’s coordinates. Space the patch columns along
those paths and add rows for the strip’s width. The left and right rails
are optional. When omitted, they join the ends of the authored row guides.

```js
const plan = KIT.meshTopology.planRetopology(cage, {
  id: 'shoulder-strip',
  revision: KIT.meshTopology.revision(cage),
  size: [6, 4],
  material: 'shell',
  surface: { kind: 'mesh', document: denseForm },
  rims: { bottom: ['rim-0', 'rim-1', 'rim-2', 'rim-3', 'rim-4', 'rim-5', 'rim-6'] },
  rails: { top: { points: topStroke } },
  guides: [
    { id: 'joint', axis: 'row', index: 2, kind: 'joint', points: jointStroke },
    { id: 'stitch', axis: 'column', index: 2, kind: 'seam', points: seamStroke }
  ],
  projection: { direction: [0, 0, -1], maxDistance: 0.25, maxDeviation: 0.04 }
});
console.log(plan.report.canCommit, plan.report.issues, plan.report.pins);
```

Use a `rim` on any side to stitch into open edges by existing vertex
ID. Supply one ID per grid position. List bottom and top from left to
right and left and right from bottom to top. The planner reuses each
rim vertex and derives patch winding from the adjacent faces. Shared
rim corners must address the same vertex. The adjacent faces keep
their original geometry, attributes, and UVs. The patch gets its own
normalized UV grid.

A flow or joint guide aligns a named grid row or column to a drawn
path before projection. A seam or silhouette guide pins the sampled
positions along its entire row or column. Explicit `pins` pin a single
`[column, row]` to a world-space `position`. Path samples use arc length
by default. Set `sampling: 'knots'` to use one authored point per grid
position. Crossing guides are reconciled within `guideTolerance`.
Pinned positions stay exact and take precedence through the snap.
Keep the reported pin vertex IDs for later component transforms.

Use `surface.kind` to choose a reference.

| Kind | Reference |
| --- | --- |
| `mesh` | An inline topology `document`, a named scene `object` with optional `part`, or the target document itself |
| `sdf` | A named scene solid, an SDK field resolved by `context.sdf(id)`, or an inline box or sphere `volume` |
| `scan-proxy` | A registered capture mesh supplied as a topology document, a named mesh, or a GLB from [scan to mesh](scan-to-mesh.md) |

Specify `maxDistance` in scene units. A projection `direction` casts
through a bounded segment around each guide position and accepts
the front-facing surface. Omit it for nearest-surface projection.
`pinTolerance` bounds proximity checks for fixed vertices. The preview
checks the center and each edge midpoint of every quad against the
reference. Set `maxDeviation` to enforce a fit tolerance on those
probes. The report records hit positions, mesh face and barycentric
addresses, fixed seams, and blocked areas such as missed projections,
folded quads, or unsupported spans.

Use `editor.planMeshRetopology(object, request)` and
`editor.retopologizeMeshTopology(object, request)` on retained scene
meshes. Apply as `operation.retopology` on a bound `mesh-topology`
destination to get the regular preview, receipt, undo, and replay.
The result is authored polygon topology with stable vertex, face,
and corner IDs.

Run the [shoulder-cap demo](../examples/mesh-retopology/README.md) to
compare sculpt, mesh, and scan references. The CLI previews without
`--out` and writes a revised document when the surface checks pass.

```sh
node cli/ink-studio.js mesh-topology retopology scan-proxy-before.json scan-proxy-request.json \
  --surface scan-reference.glb --view scan-proxy-view.json \
  --preview review --out shoulder.json --report report.json
```

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

## Run a non-destructive mesh modifier stack

An editable scene mesh under `topologyMeshes` can store a `modifiers`
array beside its `document`. The document stays the authored cage.
A normal scene build draws the enabled stack in order and resolves
bindings against that evaluated mesh. Each stage has a stable `id`,
a `kind`, and an optional `enabled: false` to bypass it. Reorder
stages by saving the same entries in a new order.

| Kind | Parameters and behavior |
| --- | --- |
| `mirror` | Set a plane `normal` and optional `origin`. The default `weld: true` shares seam vertices and removes faces lying on the plane. Use a cage on one side of the plane or explicitly choose `weld: false`. Optional `tolerance` controls the weld and `flipU` flips mirrored UVs. |
| `array` | Set `count` from 1 to 32 and a translation `step` in mesh units. Copies retain skin weights, materials, and face-corner data. Original IDs remain on the first copy. |
| `bevel` | Set `width` and optionally `edges` by current stage IDs. It uses convex, non-flat hinges by default and accepts the same profile, weights, join, material, and protection controls as a [checked bevel](#bevel-selected-edges). |
| `shell` | Set `thickness` and optional `faces`, `rim`, `interior`, or `minWall`. Complete open islands get stitched edges and closed islands get an inner skin, using the same checks as [face-region thickening](#extrude-inset-or-thicken-a-face-region). |
| `subdivision` | Set `levels` from 1 to 3. It uses the existing [crease-aware Catmull–Clark subdivision](#author-corner-normals-and-creases). |
| `projection` | Set a retained mesh `target` by object ID, a ray `direction`, and a maximum `distance`. It projects all vertices or named `vertices`. Use `bidirectional: true` for the nearest hit along either direction and `offset` for clearance along the hit normal. Set `miss: "error"` to require every ray to hit. |

Projection uses the target mesh's evaluated geometry in the same
coordinate frame. The scene checks dependency cycles. Bypassing a stage
also bypasses its target lookup. If explicit element IDs come from an
earlier stage, inspect those IDs again after reordering or replacing
that stage.

```sh
ink-studio mesh-topology modifiers set scene.json stack.json --object housing --out staged.json
ink-studio mesh-topology modifiers update staged.json bypass.json --object housing --out revised.json
ink-studio mesh-topology modifiers inspect staged.json --object housing --through trim --preview trim-view
ink-studio mesh-topology modifiers apply staged.json --object housing --through trim --report apply-review.json
ink-studio mesh-topology modifiers apply staged.json --object housing --out applied.json
```

### Inspect modeling stages

```sh
ink-studio mesh-topology modifiers inspect staged.json --object housing \
  --diagnostics --preview stage-images --report stage-report.json
```

The stage report shows topology findings on each side of the operation,
affected source IDs, changed attribute values, and elapsed evaluation time.
Each stage gets a before and after PNG from the same native camera and pixel
grid. Bypassed stages keep their inputs. A blocked stage preserves its
input and reports the operation error. For scene meshes with registered
bakes, the diagnostic lists the bake and affected faces as required work.
A separately measured rebake records the sampled charts and texels.

In the SDK, pass `{ diagnostics: true }` to
`evaluateModifiers()` or `sceneEditor.inspectMeshModifiers()`. The result
includes the retained stage documents in `captures` and their diagnostics
in `report.stages`. Copy lineage used for inspection preserves the existing
binding remap behavior of the apply operation.

An update file is shaped like `{ "id": "trim", "patch": { "enabled": false } }`.
Without `--out`, applying writes a dry run with topology, binding and bake
effects. With `--through`, applying consumes the prefix through that
stage and retains the remaining stack. A binding on a retained element
can stay in place. Splits and removed elements report candidates or
request review. Copies from array and mirror keep bindings on the
original surface. Scene changes share the undo journal.

Standalone meshes accept a stack JSON array as the second input to
`inspect` and `apply`. The `set` command saves the cage and stack as one
versioned JSON document. When using standalone projection, pass a
`--targets` JSON map from target IDs to mesh documents. Use `--through`
to export the topology at a particular stage and `--preview` to save its
native-grid image. `--view` accepts the same camera and material settings
as the bevel preview.

The toolkit exposes `KIT.meshTopology.evaluateModifiers`, which returns
the requested stage's document, the remaining stages, element lineage,
and a report. Scene editor methods are `setMeshModifiers`,
`updateMeshModifier`, `inspectMeshModifiers`,
`planApplyMeshModifiers`, and `applyMeshModifiers`.
Bound pixel transactions accept `operation.modifiers` with
`action: "set"`, `"update"`, or `"apply"`.

## Edit and pose mesh skin weights

A mesh topology document can carry a `skin` declaration. Use the same
stable joint IDs for the skin and the vertex `weights` fields.

```json
{
  "joints": ["root", "rest", "hinge.L", "hinge.R"],
  "fallback": "root",
  "locked": ["root"],
  "mirrors": [["hinge.L", "hinge.R"]]
}
```

The declared joint order is the order of the runtime matrices. Weights for
channels outside the joint list are retained as vertex data. Every rendered
copy of an authored vertex, including copies across UV seams or corner
normal splits, uses its source vertex's weights.

Run the switchyard kite example for a posed before and after comparison.

```sh
node examples/mesh-skin-weights/demo.cjs skin-review
```

The example writes the authored topology, the saved selection and brush
request, the pose, the edited topology, and a report. The PNGs show the
same camera and pose before and after editing. The weight view interpolates
the selected joint's effective weight across visible triangles. The
dark-blue end of the ramp represents zero. Pale gold represents one.

Inspect a topology or preview and optionally commit an edit through the CLI.

```sh
node cli/ink-studio.js mesh-topology skin skin-review/kite.json
node cli/ink-studio.js mesh-topology skin skin-review/kite.json skin-review/paint.json \
  --view skin-review/pose.json --preview preview --report review.json
```

Use `--out` to write the revision to a separate file. Supply `--object` to
work on a topology mesh inside a scene. The optional view accepts `w`, `h`,
`t`, `camera`, `joint`, and `pose`. A standalone view may also supply
`materials`. A pose is a map from joint ID to a twelve-value Ink matrix,
or one flat array in joint order. The first nine values are the
row-major linear transform and the last three are the translation.
Matrices take points from mesh rest space to the preview pose.

### Request fields

An edit request takes `operations`, with an optional `revision` to reject a
stale source. For an unbound mesh, include `skin` to attach the declaration.
An operation's `selection` accepts stable vertex IDs or a saved
`mesh-topology select` result from this revision. Selected edges and
faces resolve to their vertices.

- `assign` sets a `joint` to the requested `weight` on the selection.
- `paint` approaches that weight around `at` within a positive
  `radius`, in rest-space units. Set `strength` between zero and one
  and use `smooth`, `linear`, or `hard` falloff. Omit the selection to
  paint every vertex inside the brush.
- `mirror` copies the selected source vertices' influences across the
  rest-space plane. Set `axis`, `origin`, or `tolerance` to override the
  default X plane through zero with a 0.001-unit tolerance. Ink swaps
  declared mirror joints, holds destination locks, and reports centerline,
  unmatched, or ambiguous vertices.
- `lock` fixes the current influence for the named `joint` with
  `locked: true`. Use `locked: false` to release it.
- `normalize` writes the effective weights to the selection or the
  entire mesh.

Normalization holds the locked values, keeps up to four positive
influences, and distributes the remaining weight proportionally among
editable joints. Equal influences use the declared joint order. If no
editable weight remains, Ink uses the fallback joint or the first eligible
editable joint. The report shows authored and effective values, totals,
trimmed influences, clamped edits, skipped operations, and posed
displacements. Conflicting locks that exceed the available weight or
influence slots block commit.

### Connect a mesh to the rig

```js
const { skin } = KIT.meshTopology;
const review = skin.plan(document, request);
const mesh = KIT.meshTopology.toSceneMesh(review.document, { materials });
const binding = skin.bind(mesh);
binding.pose(namedMatrices);
```

Inspect with `KIT.meshTopology.skin.inspect(document, selection)`. Scene
editors expose `planMeshSkin(object, request)` and
`editMeshSkin(object, request)` through the existing transaction history.
A built scene exposes the mesh binding as
`world.topologyMeshes[object].skin`. Include that binding in
`KIT.bones.bind`'s `meshBindings` array when the rig matrices use its
declared joint order. Unposed topology meshes still render in rest space.

## Transfer skin weights and attachments after editing

Transfer a weighted mesh, prop sockets, surface-grown curve roots, and
static splat groups through a pinned
[topology correspondence](#record-correspondence-through-an-edit).
Ink uses stable vertices and exact mapped corners first. New vertices and
anchors on split faces sample only the linked surfaces. Coincident
competing surfaces, lost bindings, and exceeded error budgets require
review. A candidate and its evidence are available before commit.

```sh
node examples/mesh-attachment-transfer/demo.cjs semaphore-review

node cli/ink-studio.js mesh-topology transfer-attachments \
  semaphore-review/source.json semaphore-review/replacement.json semaphore-review/map.json \
  --attachments semaphore-review/attachments.json --settings semaphore-review/settings.json \
  --view semaphore-review/view.json --preview preview --report review.json
```

Add `--out accepted.json` to save the document and its rebound attachment
manifest when the checks pass. A rejected transfer still writes its report
and available preview frames. The demo includes a semaphore panel split
with a retained lamp socket, a two-root braid, and a glass-bead splat group.
It tests the result at rest and in raised and lowered poses. A second
review uses a tighter posed budget and shows the measurements that block it.

### Author a mesh attachment manifest

Use `KIT.meshTopology.attachments.create(document, rows)` to create a
revision-pinned manifest. An attachment has a stable `id`, `kind`, and
an `anchor` with an authored face ID, the three corner IDs of one derived
triangle, and three matching barycentric `weights`. Read valid corner
triples from `triangulate(document).triangleSources`. You can supply a
rest-space `tangent` and a local `offset` in tangent, bitangent, normal
order.

- A `socket` names an existing scene graph `node` and `socket`.
- A `curve-root` resolves to a retained surface frame. Both ends of a
  stitch can use independent attachment IDs.
- A `splat-group` names the `group` and its stable splat `members`.
  Members are static packed splats. The accepted manifest keeps the
  original frame as a reference for applying the transfer to the source
  group. Position, covariance, and footprint frames follow the new
  attachment frame. The report measures the group's anchor and angle.

### Review and accept

The settings accept named `poses` of the form `{id, matrices}`.
Use the same ordered, named skin joints on both meshes. Matrices take
points from rest space into each approved pose. Ink compares the candidate
against the corresponding point on the posed source mesh. It records
position error for weights and attachment anchors, orientation error
for attachments, and total absolute weight error per vertex. Replacement
weights on explicitly locked joints take precedence. The skin normalizer
applies Ink's four-influence limit and records dropped values.

`maxRestError`, `maxPoseError`, and `maxProjectDistance` use mesh
units. Defaults are 2%, 2.5%, and 7.5% of the source bounding-box diagonal.
`maxAngle` defaults to 15 degrees and `maxWeightError` to 0.1.
`minConfidence`, `minNormalDot`, `ambiguityDistance`, and `maxChecks`
bound the mapped-surface search. A skinned transfer needs at least one
approved pose before acceptance. Static transfers can use rest checks.
The report lists every evaluated pose and uses a null peak pose error
when there is no pose measurement.

In JavaScript, call
`KIT.meshTopology.transferAttachments(before, replacement, map, settings)`.
The plan contains a candidate `document`, rebound `attachments`, and
`report.canCommit`. Scene editors provide
`planMeshAttachmentTransfer(object, patch, settings)` and
`transferMeshAttachments(object, patch, settings)`. A successful scene
transfer writes the mesh and manifest together in the undo journal.
Built topology meshes expose an `attachmentStatus` and an `attachments`
binding when the manifest matches the rendered topology revision.

### Use the rebound attachments

```js
const binding = KIT.meshTopology.attachments.bind(mesh, accepted.attachments);
const group = binding.bindSplats(world);
const braid = KIT.curveSplats.grow(builder, { kind: 'mesh', binding }, {
  roots: [{ id: 'braid-end', attachment: 'thread-root', length: 0.14 }]
}, { width: 0.02, color: '#e7b46b' });

// Update attachment consumers after posing the host mesh.
skin.pose(jointMatrices);
binding.poseSockets(graph);
braid.pose(world);
group.pose();
```

Build the curves into `builder` before finishing the world. Bind the splat
group while its rows are still in the original rest pose. Subsequent updates
reuse that captured rest data. The mesh attachment host also accepts
`stitches` whose endpoints have an `attachment` ID.

## Drive a mesh shape key from a named pose

Use `mesh-topology shape-keys` to preview a rest edit or capture a pose
correction on stable vertex IDs. A pose edit stores a separate shape key
set tied to the rest revision. Its activation uses the local joint rotation
falloff from [pose-space correctives](pose-correctives.md). Vertex
trajectories use the [geometry morph sampler](geometry-morphs.md).

```sh
node examples/mesh-shape-keys/demo.cjs hoist-review

node cli/ink-studio.js mesh-topology shape-keys hoist-review/mesh.json \
  hoist-review/shape-request.json --view hoist-review/view.json \
  --preview preview --report review.json
```

The Faraday Hoist demo adjusts the outside of a folding mesh collar and its
splat rivets using the same elbow rotation. The native review shows
the rest model, an inactive pose, a transition, and the captured pose.
The output includes a second request that explicitly changes the rest
model.

### Choose the edit destination

- `destination: "rest"` changes the authored mesh positions. Use
  `moves` with stable vertex IDs and offsets in rest coordinates, or
  `strokes` with the same center, radius and move fields as the pose
  sculpt brush. Existing keys keep their original revision pin and show
  `needs-recapture` when the rest revision changes.
- `destination: "pose"` needs a key `id` and a named capture `pose`.
  Supply the skin `matrices` in named or joint order and the driver's
  local 3 × 3 `rotations` by name. Use `drivers` with `part` and an
  angular `radius` in degrees, or supply a captured splat
  `corrective` and its matching capture pose. A pose named `rest` is
  reserved for the undeformed comparison lane.
- Vertex `moves` and brush `strokes` on a pose edit use the captured
  pose's coordinates. Ink converts the offsets through the blended skin
  transform and applies them before skinning. A saved topology
  `selection` or a list of vertex IDs scopes the edit. A vertex move
  can carry intermediate `keys` with `at`, `move`, and optional
  `ease` for that trajectory. These waypoints use the capture pose's
  vector basis.
- Recapture with the same key ID to revise it. Use
  `{ "destination": "pose", "id": "outer-fold", "remove": true }`
  to remove it. A recapture on a changed rest revision starts a new key
  set and lists the previous stale keys in the receipt.

The receipt names the destination, compares the rest revisions, lists
affected vertices, and reports key activation and changed pixels for each
preview view. Give the review file a `poses` array for additional named
samples. Ink always captures the canonical rest model and uses the exact
capture pose from the edit request.

Add `--out` to save the revision bundle. Pass that bundle back to
`mesh-topology shape-keys` to inspect, recapture, or make a rest edit.
Use `--object` to edit the retained mesh inside a scene. The scene editor
provides `planMeshShapeKeys(object, request)` and
`editMeshShapeKeys(object, request)` with undo and redo.

### Connect to a rig

```js
const { shapeKeys } = KIT.meshTopology;
const binding = shapeKeys.bind(mesh, revision.shapeKeys);
const disconnect = puppet.correctives.attachMesh(binding);
```

The puppet updates the mesh and splat corrections on the same rig tick.
Named mesh joints select the first bone of the matching puppet part.
Pass `{bones: { elbow: 7 }}` when a mesh joint uses another rig bone
slot. Use `puppet.correctives.meshPose(binding.joints)` after posing to
capture inputs from the live rig. A built scene exposes the ready binding
as `world.topologyMeshes[object].shapeKeys`.

For a manual frame, call `binding.pose(matrices, {rotations})`. For
authored animation curves, use `binding.morph({ "outer-fold": 0.5 },
matrices)`. Read the current blend weights with `binding.state()`.
`binding.rest()` returns the mesh to its stored geometry. Overlapping
keys normalize their contributions per vertex when their weights sum
above one.
