# Snap a sculpt stroke

Project a complete stroke onto a sculpt for a raised seam or engraved
groove. Use a root attachment to plant a stroke on the surface and let
its remaining path extend freely.

```sh
ink-studio sculpt-snap plan base.json stroke.json
ink-studio sculpt-snap apply base.json stroke.json --out snapped.json
ink-studio sculpt-snap inspect snapped.json --target vessel --id seam
```

The request uses a named, editable exterior solid and the same brush
and pose controls as a [sculpt sweep](sculpt-sweeps.md).

```json
{
  "target": "vessel",
  "id": "seam",
  "op": "cut",
  "brush": { "kind": "sphere", "radius": 0.08 },
  "poses": [
    { "point": [-0.5, 1.05, 0.2], "pressure": 0.7 },
    { "point": [0.5, 1.05, 0.2] }
  ],
  "snap": {
    "mode": "surface",
    "maxDistance": 0.4,
    "direction": [0, 1, 0],
    "spacing": 0.04
  }
}
```

- **Surface.** Snap intermediate guides as well as authored poses.
  `spacing` sets the initial guide interval in target-rest units and
  defaults to the sweep's sampling step. Ink refines chords that
  deviate from the surface and reports a miss if the path cannot
  follow the carrier continuously.
- **Root.** Snap the first pose and translate the entire path by the
  root's displacement. Relative positions, orientations, and pressure
  stay intact. The remaining poses can extend away from the surface.
- **Projection.** `maxDistance` limits the search. With an outward
  `direction`, Ink searches along that line for a facing surface.
  Without a direction it projects toward a nearby surface using the
  local distance field. `minFacing` sets the cosine threshold for
  directional projection and changes in normal along a surface stroke.
  It defaults to 0.25. `offset` moves centers along the resolved outward
  normal. Negative values embed the stroke in the carrier.

Use `op: "add"` for raised strokes and free shapes. Supply an optional
`mat` for an addition. Cuts use the receiving solid's material.

The scene retains the guides, snap settings, and brush as one modifier.
Ink re-resolves against the carrier as it exists immediately before
that modifier at build time. Edits earlier in the stack can move the
attachment. Later cuts are applied afterward. If the surface moves
out of reach, revise the guides or the search distance. Plan and inspect
report the contacts in target-rest coordinates and the resolved poses
in operand-local coordinates.

Use `editor.planSculptSnap(request)`, `editor.applySculptSnap(request)`,
or `editor.inspectSculptSnap(target, id)` in the headless scene editor.
Apply is undoable. Existing sweep and contribution operations can edit
the retained guides or reorder the modifier.

```sh
node examples/sculpt-snap-demo.cjs /tmp/ink-sculpt-snap
```

The demo saves an engraving following a curved ceramic shell and a
free curved stroke attached at the root. It includes the scene and both
contact reports.
