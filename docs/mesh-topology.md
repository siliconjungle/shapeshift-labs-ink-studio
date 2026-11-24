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
