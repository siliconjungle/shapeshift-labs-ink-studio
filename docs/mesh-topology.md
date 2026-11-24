# Editable mesh topology

An Ink mesh topology document stores positions, shared boundary edges,
polygon faces, and face corners. Each element has an ID. A polygon
keeps its boundary and winding when Ink derives its render triangles.
A face corner refers to a vertex and stores its own UV, so the two faces
sharing an edge can sample different parts of an atlas.

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
