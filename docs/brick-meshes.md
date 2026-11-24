# Local SDF-to-mesh updates

Use `KIT.procedural.brickMeshes` to turn a signed field into indexed
scene meshes and keep those meshes current as the field changes.
The field uses the [sparse brick snapshot API](procedural.md#sparse-bricks).
Union, subtraction, and material paint all go through the same update path.

```js
const P = KIT.procedural;
const slab = sculpt.box([0, 1, 0], [2, 1, .35], null, { hold: true });
const bricks = P.sparseBricks.create({ cell: .1, brickSize: 8, base: slab.sd });
const gate = P.brickMeshes.create({
  bricks,
  bounds: { min: [-2.3, -.3, -.65], max: [2.3, 2.3, .65] },
  objectId: 'gate',
  materials: [
    { id: 'sandstone', color: 0xad7860 },
    { id: 'cut-stone', color: 0xe3b789 }
  ]
});
const world = builder.finish({ cam, brickMeshes: [gate] });

const tool = sculpt.box([0, 1, 0], [.55, .8, .8], null, { hold: true });
const edited = gate.edit({
  operation: 'subtract',
  bounds: { min: [-.85, -.1, -.65], max: [.85, 2.1, .65] },
  sdf: tool.sd,
  material: 'cut-stone'
});
console.log(edited.work);
```

The authored domain rounds outward to the signed lattice. Leave padding
around solids you want closed. Each brick owns the faces incident to the
zero-crossing edges in its range. The mesher uses neighboring samples
for the fit at a shared boundary. Adjacent bricks agree on vertex
positions and publish each seam face once. The dual-contour fit retains
hard corners when the lattice resolves them. Openings and thin details
must span enough samples to register in the field.

The optional `materialAt(x,y,z)` returns a declared material ID for the
base surface. Sparse material paint takes precedence near the
zero crossing. Each face keeps a discrete material ID. The sampling
resolution sets the accuracy of the boundary between materials.

## Commit an edit

`gate.current()` returns an immutable revision. `gate.edit(brush)`
edits the live revision. `gate.update(snapshot)` accepts another snapshot
from the original sparse field and supports restoring an earlier state.
The brush bounds need to cover the full change, including any blend
distance. World simulation or editor code can pass the resulting
snapshot through the same API.

The controller compares actual lattice samples between snapshots. An
offset change extracts the bricks that read those samples, including
neighbors whose padded lattice reaches them across a seam. Distant
edits within one storage brick are tracked separately for overlap checks.
Material-only edits reuse the saved surface crossings and triangle
positions and update the affected face assignments. Medium-only changes
reuse all mesh buffers.

Untouched chunks keep their mesh handles. Publications are atomic,
including when a feature guard, material, or triangle budget fails.
A revision has the following work fields.

| Field | Meaning |
| --- | --- |
| `dirty` | Exact changed-sample count and world-space bounds per source brick and channel |
| `rebuilt` | Brick IDs that ran geometry extraction |
| `recolored` | Brick IDs that reassigned materials using cached crossings |
| `seamNeighbors` | Bricks processed because they read changed samples owned outside their range |
| `changed` | Brick IDs whose mesh data changed, including empty bricks |
| `reused` | Brick IDs that kept their previous mesh data |
| `cells`, `samples` | Lattice cells and field calls used by the update |
| `triangles` | Triangle count for the published revision |

The initial build runs extraction across the mesh domain. Subsequent
`dirty` bounds describe the changed sample positions before interpolation
or seam padding, so a one-sample box can have equal min and max. With
`renderStats: true`, headless renders include the object, revision, and
work report in `renderStats.brickMeshes`.

Node and WebGL 2 draw these meshes in the scene and expose their
object and material IDs. Mesh picking follows the current revision.
Use [surface-grown strands](surface-grown-strands.md#grow-from-an-editable-sdf)
to attach editable curves to the signed field through cuts and undo.
Set `brickMeshes: false` on a frame or use `--brick-meshes off`
to hide the editable fields.

## Refresh derived assets together

Each live brick revision publishes its meshes, paint atlases, triangle picker,
and bounded signed collision field under `revision.assets`. Pass `derived`
options to `brickMeshes.create` to also publish depth-only proxies, signed
shadow casters, or a native splat representation.

```js
const gate = P.brickMeshes.create({
  bricks, bounds, objectId: 'gate', materials,
  derived: { depthProxy: true, shadow: true, splats: { maxSplats: 100000 } }
});
const before = gate.current();
const cut = gate.edit(brush);
const hit = cut.assets.pick({ origin: [0, 1, 4], direction: [0, 0, -1] });
const clearance = P.brickMeshes.clearance([cut]);
const splatView = P.brickMeshes.splatWorld(cut, { cam });
```

Use `world.brickMeshes = [gate]` for the editable mesh scene. Its depth proxies
and emitter shadow sources follow the captured revision in CPU and WebGL
renders. `brickMeshes.splatWorld` assembles a standalone packed splat asset
with the same revision's depth proxies and shadow source. Each triangle
uses a native polygon footprint with a small overlap at shared edges and
samples its baked pigment at the centroid. Use the mesh for full texture and material detail.

The optional `derived.bakePaint(source)` runs synchronously for affected
nonempty chunks. It receives the candidate brick snapshot, chunk bounds,
indexed positions, face material slots, and the proposed revision. Return
`{ uvs, materials }` using normalized UVs and the same ordered material IDs.
The materials can supply opaque textures and compatible mesh shading maps.
Return `undefined` to use the built-in indexed pigment bake. Sample paint
from the chunk and its local surface neighborhood so other chunks can keep
their handles. Registered file exports are separate from the live atlas.

Mesh and paint changes reuse untouched chunks. Paint-only edits also keep
the depth proxy and signed shadow and collision fields. If any derived bake
fails, the old revision stays published. Previously captured revisions
continue to answer picking and clearance queries for their own geometry.
The collision output is a static signed field for clearance queries and
hosts that accept distance fields.

## Protect features across remeshing

Pass a `protection` list with named feature bounds to `brickMeshes.create`.
Use the same `{ id, kind, bounds: { min, max } }` format as
[SDF brush volumes](pixel-art-authoring.md#protect-sdf-corners-seams-walls-and-openings).
The bounds are in the mesh field's coordinates.

- Place a `wall` volume inside the solid core you need to keep.
- Place an `opening` volume in the air that must stay clear.
- Wrap a `corner` around the faces you want to hold in place.
- Wrap a `seam` around the faces whose positions and material assignments
  should stay fixed.

The controller samples the signed field at 27 points per wall or opening
volume and checks the reserved volume against the extracted triangles. If a
feature does not resolve on the current lattice, use a finer `cell`.
Corners and seams compare protected faces across the old and new mesh.
Chunks around a brick boundary participate in the same check. Protected
corners and seams need at least one resolved face in the initial mesh.

The checks also run on `update(snapshot)`. A failure identifies the feature
and leaves the published snapshot intact. Successful revisions list the
feature IDs checked in `work.checkedFeatures`. Sparse edits outside the
protected regions still rebuild only their affected bricks.

## Retained sculpt masks and face sets

Use the same sculpt mask document for successive strokes on a live SDF
brick mesh. Give the document to `brickMeshes.create({ sculptMasks })` or
publish it later with `controller.setSculptMasks(document)`. Use `null`
to clear it.

```js
const masks = KIT.procedural.sculptMasks.prepare({
  format: 'ink-studio/sculpt-masks',
  version: 1,
  masks: [
    { id: 'trim', volumes: [{ kind: 'box', min: [-1.4, 0, -.5], max: [-1, 3, .7] }] },
    { id: 'panel', feather: .24, volumes: [{ kind: 'sphere', center: [0, 1.5, .3], radius: .8 }] }
  ],
  faceSets: [{ id: 'bronze-trim', mask: 'trim' }, { id: 'front-panel', mask: 'panel' }],
  controls: { locked: ['bronze-trim'], isolate: [], hidden: [] }
});
gate.setSculptMasks(masks);
const edited = gate.edit({ ...brush, masks: ['panel'] });
console.log(edited.sculpt.faceSets, edited.work.sculpt);
```

A mask joins one or more rest-space boxes and spheres in the signed field's
coordinates. Feathering ramps from zero at the volume boundary inward over
the specified model-space distance. Optional `strength` scales influence
from zero to one. Overlapping named brush masks use their strongest weight.
Separate face-set IDs hold the named assignments even when the feather
or strength changes. Material and medium labels switch at half weight.

- **Isolate** shows the chosen sets and limits brush influence to their union.
- **Hide** removes the sets from the displayed mesh, depth proxies, derived
  splats, and picking. Brush samples in those sets are skipped. The signed
  collision and signed shadow sources continue to describe the full shape.
- **Lock** skips samples in the selected volumes and a two-cell halo for
  the dual-contour fit. The existing protected-feature check rejects a
  publication that changes a locked face's geometry or material, including
  direct snapshot swaps. Failures report the face set ID.

A face gets its set memberships from its owned lattice crossing. Existing
crossings keep a local `faceId` across remeshing. Newly exposed faces take
their memberships from the same authored volumes. Untouched bricks retain
their mesh handles and labels. Control changes publish a revision with no
geometry extraction. Lock and hide override brush selection and isolation.

Inspect a revision with `sculpt.sample([x, y, z], { masks })`,
`sculpt.face(brickKey, sourceTriangle)`, or `assets.pick(ray)`. Pick hits
carry the face ID, contributing set IDs, brick ID and source triangle.
`work.sculpt` reports relabeled bricks, changed display chunks, verified
locks, and visible triangle count. Use `brickMeshes.fullView(revision)` for
a read-only view of the complete shape. Direct SDF assist uses the
displayed mesh while hide or isolate is active. Shape reviews use the
full view for matched direct and mesh captures.

Replay the [ceramic panel demo](../examples/sculpt-masks/README.md) or inspect
your own scene. A version 1 plan accepts `capture`, `masks`, `controls`, and
`stroke` actions. Supply a retained `document` for `masks`, a replacement
`controls` object for `controls`, and a bounded `brush` for `stroke`.
A stroke's optional `volume` uses the same box or sphere format. The CLI
writes native PNGs, a comparison sheet, the final mask document and a JSON
report with point weights and remesh work.

```sh
node cli/ink-studio.js sculpt-masks examples/sculpt-masks/workshop.js \
  --plan examples/sculpt-masks/plan.json --out studio/out/sculpt-mask-review
```

## Freeform strokes on brick meshes

Use `controller.sculpt(stroke, options)` for grab, flatten, scrape,
crease, and pinch on a live brick mesh. Give each stamp an origin in the
signed field, an oriented tangent, bitangent, and outward normal in the
`axes` tuple, and a resolved radius. `drag` on a grab is expressed along
those axes. Use `freeformSculpt.radius(size, worldPerPixel)` to resolve a
native pixel radius from a capture.

```js
const P = KIT.procedural;
const stamp = {
  origin: [0.7, 1.1, 0.2],
  axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  radius: 0.38
};
const edited = gate.sculpt({
  mode: 'crease',
  depth: 0.1,
  strength: 0.8,
  stamps: [stamp, P.freeformSculpt.reflect(stamp, { axis: 'x' })]
}, { masks: ['panel'] });
```

Omit `masks` to use the live controls alone. The stroke samples the source
snapshot, applies the retained isolation, visibility, and lock controls,
then publishes one revision through dirty-brick extraction. The field
keeps its existing material assignments. Separate mirrored regions keep
separate work bounds when they do not overlap.

## Reproject sculpt detail after a coarse edit

Keep a coarse brick snapshot for the form and edit a separate fine pass
with `edit` or `sculpt`. Capture signed relief as a portable, versioned
surface chart. The chart stores the height and normal of the reference
surface and the distance to the sculpted surface at each sample. Keep the
original layer for subsequent reprojections so resolution errors do not
accumulate.

```js
const base = panel.current().bricks;
panel.sculpt(fineStroke);
const layer = panel.captureDetail(base, {
  chart: {
    origin: [0, 1.2, 0.25],
    normal: [0, 0, 1],
    tangent: [1, 0, 0],
    size: [45, 25],
    spacing: base.cell
  },
  depth: 0.35,
  maxRelief: 0.15
});

// Build the new form from the coarse reference.
const newForm = base.edit(coarseBrush);
const preview = panel.previewDetail(layer, newForm, { reach: 0.4, minWall: 0.14 });
console.log(preview.report.counts, preview.report.dirty);
const revised = panel.commitDetail(preview);
```

Select one chart per locally continuous patch. The normal points out of
the surface. The tangent sets the chart's horizontal axis. Chart spacing
defaults to the fine cell size. Capture `depth` is the half-range on either
side of the chart origin. `maxRelief` limits the signed distance from the
coarse reference to a fine surface. Both use model-space units. The transfer
searches within `reach` of the previous surface. Supply a `targetFrame`
with `origin`, `normal`, and `tangent` to register a chart that moved or
turned with the broad edit.

Each destination sample reports one of these outcomes.

| Status | Meaning |
| --- | --- |
| `applied` | The nonzero relief passed the transfer checks at this chart sample |
| `flat` | A valid correspondence has zero signed relief |
| `edge` | The outer chart row fades to zero |
| `fold` | The trace encountered multiple surface sheets or the normals disagreed |
| `thin-wall` | The measured wall cannot retain the minimum thickness after the relief is applied |
| `lost-correspondence` | No reliable outward surface was found within the capture or transfer range |
| `masked` | A retained mask or lock excluded the sample |

The report includes source coordinates, matched target coordinates when
available, and exact lattice changes. Transfer fades the outer texel and
leaves samples alone where interpolation touches a rejected chart point.
Wall and fold checks operate at capture resolution. Use smaller charts
around tight folds or narrow features. The stored layer can be loaded
again with `KIT.procedural.sculptDetail.prepare(layer)`.

The preview leaves the controller as it was. Commit checks that the
preview belongs to the current revision, then publishes through the
usual dirty-brick, protection, and derived asset paths. The fine
transfer changes shape and keeps the new form's material and medium
assignments. `previewDetail` accepts the optional `masks` filter from
the other sculpt tools.

The lower-level `sculptDetail.capture(coarse, detailed, settings)`
also accepts different coarse and fine brick pitches.
`sculptDetail.project(layer, target, options)` returns a candidate
snapshot and a report. The target must be at least as fine as the captured
detail. To project onto an independently edited coarser field, sample it
as the base of a new fine lattice with
`sparseBricks.create({ cell: layer.cell, base: coarse.distance })`.

Run the [tide gauge demo](../examples/multires-sculpt-detail/README.md)
to author fine and coarse strokes independently with a version 1
`ink-studio/sculpt-detail-plan`. Each plan stroke supplies union or
subtract, a bounded box or sphere, and optional smoothing. The CLI
writes matched native-grid renders, a chart diagnostics PNG, a native
depth-change PNG, the retained layer, and a JSON report.

```sh
node cli/ink-studio.js sculpt-detail examples/multires-sculpt-detail/tide-panel.js \
  --plan examples/multires-sculpt-detail/plan.json --out studio/out/tide-detail
```

## Validate the shape from several angles

Run the review at the edit time you want to inspect.

```sh
node cli/ink-studio.js sdf-shape-review examples/brick-mesh-gate.js \
  --t 1.2 --w 160 --h 112 --out studio/out/gate-shape-review
```

The review captures one brick revision and isolates its object. It renders
the direct signed field and the indexed mesh with the same camera for each
view. The default views cover the front, back, side, obliques and a high
angle. Use `--object` when the input scene has more than one brick field.

`comparison.png` shows a row per view with mesh, SDF, silhouette, coverage,
depth and material seam columns. `report.json` records the revision, dirty
work, cameras, per-view measurements and paths to the individual images.

- **Silhouette** counts the native center hits that one path lost or added.
  Its error fraction uses the union of both silhouettes.
- **Coverage** averages a matched 3 × 3 sample grid per art pixel. It reports
  mean and maximum absolute differences and how many pixels exceed
  `coverageTolerance`.
- **Depth** compares only native centers hit by both paths. Differences
  are in world units along the camera's forward axis. Positive signed error
  means the mesh surface is farther away. The report includes mean, RMS,
  95th percentile, maximum and the count above `depthTolerance`.
- **Material seams** compare material names and horizontal or vertical edges
  between different labels. Both endpoints must hit the object in both
  images. A one-pixel seam shift counts as a missing edge and an extra edge.
  The report also counts edges where the adjacent pair of names changed.

Use `--profile plan.json` for different views or limits. Angles are in
radians. Each view can override `target`, `dist`, `ortho` and `fov`.
Use `coverageSamples: 1` for a faster center-only pass.

```json
{
  "views": [
    { "id": "left", "yaw": -0.8, "pitch": 0.28 },
    { "id": "rear", "yaw": 2.8, "pitch": 0.12, "ortho": false }
  ],
  "limits": { "silhouetteError": 0.02, "coverageMAE": 0.01, "depthP95": 0.035 }
}
```

Limits can also include `materialError` and `seamError`. With
`--fail-on-flags`, exceeded limits exit with status 2 after writing the
review. Empty views and measurements with no comparable samples are
reported separately.

In Node, call `ink.reviewSdfShape(world, directory, { views, limits })`
to inspect the current state. Set `world.brickMeshes` to a captured
snapshot such as `[gate.current()]` to review that exact revision after
the live controller advances.

## Choose direct tracing for a close-up

Headless rendering can trace the current signed field with
[`sdfAssist`](sdf-assist.md). Set an object, material, or world-space
box in the existing rules to use tracing locally while the rest of the
asset uses cached triangles. For a matched comparison on one revision, use
the same camera and render settings with `sdfAssist: false` for a mesh render
and `sdfAssist: true` for a direct field render. Compare `depth`,
`surfaceCoverage`, and `surfaceKind` from the opaque surface passes.
WebGL 2 uses the triangle meshes.

```js
ink.render(world, {
  w: 240, h: 144, px: 1, passes: ['opaque-surface'],
  sdfAssist: {
    rules: [{
      select: { object: 'gate' },
      bounds: { min: [-.9, -.02, -.55], max: [.9, 2, .55] }
    }]
  }
});
```

The [Verdigris sluice demo](../examples/brick-mesh-gate.js) cuts a
passage through a wall and chips the edge of one pier. Use `--t 0`
for the sealed wall, `--t 1.2` for the passage, and `--t 2.3` for
both edits.
