# Edit a sculpt contribution

Choose a solid and a contribution ID from its retained modifier stack.
Each edit changes one entry or inserts a clone. The scene editor stores
the edit as one undo step.

```sh
ink-studio sculpt-contribution list original.json --solid plate
ink-studio sculpt-contribution inspect original.json --solid plate --id rail
ink-studio sculpt-contribution edit original.json move.json --out moved.json > moved-report.json
```

Use the ID of a named top-level exterior sculpt solid. The list includes
shape operands, native-pixel brushes, and entries that are muted. Inspect
compares the saved stack with the selected contribution muted.

```json
{
  "solid": "plate",
  "contribution": "rail",
  "op": "move",
  "delta": [0, 0, 0.8]
}
```

| Operation | Request fields |
| --- | --- |
| `move` | `delta` is an XYZ offset in the owner's rest space. |
| `stretch` | `factors` are XYZ scale factors from 0.02 to 20. `pivot` defaults to the origin. For a shape operand, the stretch is a retained warp before its existing transform. For a grid brush, it scales the resolved geometry in the owner's rest space. |
| `clone` | `id` names the new entry. Optional `index` chooses its position and defaults to immediately after the source. Named child operands get IDs under the clone's ID. |
| `replace` | `replacement` supplies a complete modifier, including its `kind`. Ink keeps the selected entry's ID and carries its enabled state unless supplied. |
| `mute` | `muted` defaults to `true`. Set it to `false` to enable the contribution. |
| `reorder` | `index` is the entry's zero-based position in the final stack. |

Move and stretch apply to shape operands and retained grid brushes. The
resolved grid-brush geometry moves with these edits, and the original
capture stays available as provenance. Write the edited scene beside the
source to preserve relative assets.

## Read the dependency report

The JSON report compares the two rest-pose fields for the selected solid.

- `cuts` lists subsequent subtraction or trim operations in either
  stack order. `observed-change` means a sample went from removed to
  retained, or the reverse. The report includes both counts and a
  witness point. `stack-dependency` means the cut consumes the changed
  stack prefix and the sampled removal stayed the same. Muted cuts are
  marked separately.
- `materials.regions` lists material roles, registered charts, named
  SDF paint strokes, and styled cut faces where the surface location or
  appearance differed at sampled contacts. The report gives before-only
  and after-only counts with a witness point.

Both reports sample bounded grids in solid-rest XYZ. Material sampling
also checks a subset of authored paint contacts. Thin or unsampled
changes may be absent from the report. The report covers this sculpt's
own stack and material regions.

Use `editor.sculptContributions(solid)`,
`editor.inspectSculptContribution(solid, id)`, and
`editor.editSculptContribution(request)` in the
[headless scene editor](scene-editor.md).

```sh
node examples/sculpt-contribution-demo.cjs /tmp/ink-contribution-demo
```

The demo shows a cast rail with a cross-slot and a painted stripe. Move
the rail to see which cut and paint region change. Reorder it after the
cut to bridge the slot. The script writes the editable scenes, reports,
and comparison PNG.
