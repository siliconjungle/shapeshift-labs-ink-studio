# Align retained marks to a surface grid

Set `grid` on a surface-bound [3D painting mark](painting-3d.md). Ink evaluates the dabs from the saved poses and applies the grid as it places them. The painting keeps its original path, rotations, and pressures. Use `painting-3d update` with a `set` edit to change the grid or with `"grid": null` to remove it.

```json
{
  "kind": "tangent",
  "origin": [0, 0, 0],
  "u": [1, 0, 0],
  "v": [0, 1, 0],
  "spacing": [0.32, 0.24],
  "phase": [0, 0.04],
  "stagger": 0.5,
  "heading": "u"
}
```

| Kind | What the grid aligns |
| --- | --- |
| `tangent` | Snaps dab centers to a plane defined by `origin` and perpendicular `u` and `v` axes in the receiver's rest space. The default plane is XY. |
| `uv` | Snaps centers in a named receiver [surface chart](deformation-materials.md), for example `{"kind":"uv","chart":"fabric","spacing":[0.125,0.125]}`. These are the charts defined under the receiver's `surfaceState.charts`. |
| `direction` | Snaps headings to angular steps relative to an axis, contour, curvature direction, or [flow map](mark-direction.md) sampled at each dab. The dab centers stay in place. |

For a tangent or UV grid, `spacing` and `phase` are in receiver units or chart UVs respectively. Ink rounds the V coordinate first, then adds `stagger` times the U spacing to odd rows before rounding U. Choose `heading: "u"` (the default), `"v"`, or `"keep"` to preserve the projected brush heading. Brush +Z follows the surface and +X follows the chosen heading. `strength` controls how far centers move toward the grid from 0 to 1. `turnStrength` controls heading alignment independently and defaults to `strength`.

The positional grids use `snap.mode: "surface"`. They project moved centers back onto the facing surface along the grid's projection axis, within the attachment's snap reach and facing limits. On a native warp, the grid uses the undeformed receiver and the warp carries the grid result. A UV grid can also use a chart authored directly on the final warped receiver, where its projection is evaluated. A missed or out-of-bounds dab keeps its center and skips grid heading alignment.

```json
{
  "kind": "direction",
  "field": { "kind": "flow-map", "map": "grain" },
  "angleStep": 90,
  "angleOffset": 15
}
```

The angular step must divide 360. The default `360` aligns to the field's signed direction. Use `180` for two parallel headings or `90` for parallel and perpendicular headings. `angleOffset` rotates those headings in degrees. `strength` controls how far the brush turns toward the nearest one. A direction grid also supports a root snap. An optional [comb and ruffle](mark-direction.md) runs after the grid, so a seeded ruffle can soften the regular spacing of the headings without shifting their centers.

`painting-3d plan` and `inspect` count each outcome in `orientation.gridResults`. The sampled frames include incoming and final rest centers, the grid target or angle, and the result. An unknown named chart rejects the edit. Dabs outside a chart, beyond its grid, missing the receiver, or sampling a calm field are counted individually.

```sh
node examples/mark-grid-demo.cjs /tmp/ink-mark-grid
```
