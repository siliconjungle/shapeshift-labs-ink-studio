# Guides for sculpt operations

Drive an editable sweep or compound stamp with a mirror, a radial
pattern, placement snapping, or an upright constraint. Ink expands the
retained operation when it builds the scene. The copies follow guide
and construction-plane edits.

```sh
ink-studio sculpt-guide plan base.json operation.json
ink-studio sculpt-guide apply base.json operation.json --out guided.json
ink-studio sculpt-guide update guided.json count-edit.json --out refined.json
ink-studio sculpt-guide inspect refined.json
```

A stroke operation takes an existing target solid and sweep controls.

```json
{
  "id": "trim",
  "type": "stroke",
  "target": "plate",
  "guides": {
    "space": "construction-plane",
    "mirror": { "axis": "x", "side": "positive", "clip": true }
  },
  "stroke": {
    "op": "add",
    "brush": { "kind": "sphere", "radius": 0.08 },
    "poses": [{ "point": [-0.2, 0.2, 0] }, { "point": [0.6, 0.3, 0] }],
    "mat": "metal"
  }
}
```

A stamp operation uses `type: "stamp"`, an inline [compound stamp](sculpt-stamps.md)
under `stamp`, and optional `placement: { "transform": {} }`. A target is
optional for a stamp. Each copy carries both the positive pieces and
their cut masks.

| Guide | Behavior |
| --- | --- |
| `space` | `world` uses scene rest axes. `local` uses the target's placed orientation and pivot. A standalone stamp uses scene axes. `construction-plane` uses the saved right, up, and normal as X, Y, and Z. |
| `origin` | Offsets the guide origin along those axes. |
| `mirror` | Set an XYZ `axis` and choose the `positive` or `negative` source `side`. Clipping defaults to true and trims the field at the mirror plane before reflection. Set `clip: false` to keep the complete source. A microscopic overlap joins the two clipped halves. |
| `radial` | Set an XYZ `axis`, `count` from 1 to 32, and optional `stepDegrees`. The default step divides one turn evenly. With a mirror, each sector carries a mirrored pair. |
| `angleIncrement` | Quantizes sector angles and placement headings in degrees. A request that places two sectors at the same angle is reported as invalid. |
| `upright` | Aligns the source and each radial copy's local Y with the guide's up axis while keeping its placement. Reflection preserves the mirrored geometry, including when the mirror flips up. |
| `grid` | A number snaps the placement pivot along all three guide axes. Use `true` with the construction plane to use its saved grid and keep the pivot's depth. |

Strokes also accept a sweep `transform` and optional `snap` settings.
Each copy of a [snapped stroke](sculpt-snaps.md) projects against the
same surface from before the operation joins or cuts its copies.

The scene stores guided operations in order. They build after the
carrier's ordinary modifier stack. Use the operation's ID to revise
its source or guides. For example, `{"id":"stud","guides":{"radial":{"count":8}}}`
changes the count while preserving the other radial settings.
Set `mirror` or `radial` to `null` in an update to clear it.
Save beside the source scene so relative assets still resolve.

The headless scene editor exposes `planSculptGuide`, `applySculptGuide`,
and `inspectSculptGuides`. Apply and update are undoable.

```sh
node examples/sculpt-guide-demo.cjs /tmp/ink-sculpt-guide
```

The demo mirrors a raised stroke across a construction plane, stamps
four bored collars, and edits that one stamp operation to make eight.
