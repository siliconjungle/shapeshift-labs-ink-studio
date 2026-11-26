# Comb and ruffle retained surface marks

Set a surface-bound mark's `direction` to comb its brush tips along a preferred direction. Ruffle adds a repeatable signed turn around the surface normal. It leaves the stroke path, pressure, and preferred field editable.

```json
{
  "field": { "kind": "flow-map", "map": "grain", "u": [1, 0, 0], "v": [0, 1, 0] },
  "strength": 0.90,
  "ruffleDegrees": 28,
  "seed": 41
}
```

| Field | Direction on the receiver |
| --- | --- |
| `{ "kind": "axis", "axis": [1, 0, 0] }` | Projects an axis onto the tangent plane. |
| `{ "kind": "contour", "axis": [0, 1, 0] }` | Follows the contour around an axis. |
| `{ "kind": "curvature", "axis": [1, 0, 0] }` | Follows the direction of least bending. The axis guides flat areas. An optional `probe` sets the normal sample distance. |
| `{ "kind": "flow-map", "map": "grain" }` | Samples a native [Ink flow map](flow-maps.md) in a chart. Use an inline asset or a name in `painting.flowMaps`. |

Flow-map axes default to +X and +Y in the receiver's rest space. Optional `origin` and `bounds` place the map there, and `u` and `v` can redirect it using perpendicular unit vectors. The field uses the sampled heading. Calm cells and points outside the map use the projected authored brush heading.

Brush +X points along the resolved tangent and brush +Z follows the surface normal. `strength` ranges from 0 for the projected authored heading to 1 for the field heading. `ruffleDegrees` gives the maximum turn in either direction, from 0 to 180. The seed and rest dab order determine each turn. Use `painting-3d update` to edit the mark's direction or replace shared assets by name under `flowMaps`.

Ink projects and samples directed dabs in the receiver's undeformed space when the receiver has a native warp chain. The warp carries the dab center and tangent to the new surface. The inverse-transpose of its local derivative carries the normal. Ruffling is resolved before this transport, so changing the warp keeps the same random turns on the same rest stations. Affine placement and rig poses carry the result with the receiver. Surface edits that replace the correspondence, such as a boolean operation after a warp, use the resulting surface for projection. A root snap reads the field at its root and leaves the rest of its path free.

Use `painting-3d inspect` for the total evaluated dab count and a sample of the rest and deformed frames. Names and inline assets stay in the extracted painting so it can be reused against another receiver.

```sh
node examples/mark-direction-demo.cjs /tmp/ink-mark-direction
```
