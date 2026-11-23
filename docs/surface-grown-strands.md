# Surface-grown strands

`KIT.curveSplats.grow(builder, host, growth, appearance)` grows finite curves
from surface coordinates. The handle keeps strand IDs, root coordinates,
and native curve rows across poses, edits, and undo. Pass the usual
[curve appearance settings](curve-splats.md) for width, taper, light,
material, shadow, and selection.

## Grow from UVs

```js
const C = KIT.curveSplats;
const grown = C.grow(builder, { kind: 'uv', mesh: fabric }, {
  seed: 42,
  roots: [{ id: 'loose-end', uv: [.28, .04], heading: -1.4, length: .16 }],
  scatter: { cells: [26, 6], min: [.1, .25], max: [.9, .58], jitter: .8 },
  stitches: [{ id: 'hem-1', from: [.18, .12], to: [.23, .16], lift: .045 }],
  length: [.07, .15], lean: .9, bend: .35, segments: 7
}, { object: 'sewing', edge: 'hard', width: .02, color: '#f1cc8a' });
```

- An indexed mesh root retains an authored triangle and barycentric weights.
  Moving the vertices moves the root and its UV frame. Use
  `{ uv: [u, v], triangle: index }` at overlapping islands to choose a face.
  A UV that lands on multiple triangles defaults to the first authored one.
- Scatter places one seeded root per grid cell. Its ID and appearance come
  from its cell and seed. Cells outside the UV surface are skipped on creation.
- Explicit roots accept optional `id`, `length`, and `heading` in radians.
  `length` is the rise along the normal. `lean` sets the ratio of lateral
  displacement to rise, and `bend` turns that displacement over the length.
  An optional `offset` lifts or insets the first point along the normal.
- A stitch has two retained roots. Its span arches between the *current*
  root positions using their normals. Use `lift: 0` for a straight stitch.
  Losing either root hides the stitch until both resolve again.

For arbitrary deformation, pose the host with `KIT.sceneMeshes.pose(mesh, xyz)`
and then call `grown.pose(world, { time })`. Keep the mesh's indexed topology and
UVs for the life of its attachments. A temporarily collapsed triangle hides its
roots, and restoring the triangle reactivates them in the same native rows.

For linear skinning with Ink's twelve-value bone matrices, prepare a mesh
binding with one bone index or one to four `[bone, weight]` pairs per vertex.
Register the mesh and curves in Ink's native bone update.

```js
const skin = KIT.sceneMeshes.skin(fabric, vertexInfluences);
KIT.bones.bind(world, {
  ids, bid, M: boneMatrices, pose: updateBoneMatrices,
  meshBindings: [skin], curveBindings: [grown]
});
```

Use `{ kind: 'uv', chart }` for a custom chart or a native procedural surface.
A chart or a `chart(context)` provider returns `sample(uv)` or
`samplePointNormal(uv)` results with `p` and `n`. Include `tangent` and
`bitangent` to control the local growth frame. A chart can return a missing
sample or use `intact(uv)` to hide a root or stitch after damage. You can
also pass `intact(uv, context)` on the host as a UV mask. For Ink cloth,
`cloth.bindGrowth(growth, appearance)` samples the current cloth pose and
uses the cloth's tear mask.

## Grow from an editable SDF

```js
const grass = KIT.curveSplats.grow(builder, {
  kind: 'sdf', field: brickMeshController, reach: .28, steps: 32
}, {
  seed: 7,
  roots: [{ id: 'fern-1', point: [1.2, .74, -.4], normal: [0, 1, 0] }],
  length: .23
}, { object: 'fern-bed', width: .025, color: '#8fbb76', edge: 'hard' });
```

Use a sparse brick snapshot, a [live brick mesh](brick-meshes.md), or an
object with `distance(x, y, z)`. A `field(context)` provider can supply a
current snapshot or distance object. Each root searches along its authored
outward normal for the closest inside-to-outside zero crossing within
`reach` world units on either side. `minFacing` controls how closely the
hit normal must align with the authored normal. Provide `tangent` to
orient growth along a surface feature. Supply explicit XYZ seeds for SDF
growth or stitches.

Call `grass.pose(world)` after an edit, or add the handle to a stage with
`stage.add(grass)` to refresh it after scene updates. Sparse brick edits only
resample roots whose search region intersects a changed distance brick.
An out-of-range surface or a removed root hides the corresponding strand.
Undo can restore it at the same coordinates and with the same selection ID.
Explicit roots and stitch endpoints must land on a surface when authored.

`grown.snapshot()` includes stable strand IDs, attachment state, root
positions and normals, mesh triangle weights, and sample, reuse, detach, and
reattach counts from the last pose. Headless and WebGL use the same native
curves for rendering.

```sh
node scripts/build.js node
node cli/ink-studio.js surface-growth-review --hardware --motion --out out/surface-growth
```

The review pairs stitching, fabric pile, and frayed edges on skinned canvas
with shoots on a clay bed. It captures shallow and deep cuts and restores
the original surface. Each view includes a root receipt and matched renders.
