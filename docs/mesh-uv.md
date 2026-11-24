# UV and seam inspection

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
