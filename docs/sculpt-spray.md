# Volume spray for sculpt surfaces

Tint selected native sculpt solids with an oriented 3D brush. Apply it
from the headless editor or the CLI, then render or export the scene as
usual. Paint stays in the receiver's rest space when it moves.

```sh
ink-studio sculpt-spray plan base.json brush.json
ink-studio sculpt-spray apply base.json brush.json --out painted.json
ink-studio sculpt-spray inspect painted.json
```

```json
{
  "id": "coral-glaze",
  "targets": ["vessel"],
  "brush": {
    "shape": "ellipsoid",
    "center": [0, 1, 0],
    "direction": [0, 0, -1],
    "half": [1.5, 1.2, 2]
  },
  "color": "#ef643d",
  "opacity": 0.9,
  "softness": 0.28,
  "falloff": 1.3,
  "facing": { "minDot": 0, "feather": 0.35 },
  "occlusion": "visible",
  "resolution": 96
}
```

| Control | Behavior |
| --- | --- |
| `brush` | Position and aim in scene rest space. Shape is `ellipsoid`, `box` or `cone`. Half sizes describe local right, up and depth. An optional `up` vector controls roll. A cone widens from its near face in the spray direction. Its optional `tip` gives the near radius as a fraction of the far radius, default 0.12. |
| `color`, `opacity` | Use a hex pigment and an opacity from 0 to 1. Tint retains light and dark variation and leaves the surface's material identity and geometry intact. |
| `softness`, `falloff` | Softness is the fraction of the volume used to fade at its edge. Set it to 0 for a hard edge. Falloff raises the feathered weight to a power from 0.1 to 8. |
| `facing` | `minDot` is the cutoff for the surface normal dotted with the direction toward the spray. A `feather` above zero fades in above the cutoff. Set facing to `"all"` for equal treatment at every angle. |
| `occlusion` | `"visible"` captures the first surface hit by parallel rays starting at the near face of the brush. Other native sculpt bodies can block a receiver. `"wrap"` uses the whole volume and can paint behind edges and onto the back. Facing applies independently. |
| `resolution`, `bias` | For visible spray, set the ray grid's longer side from 16 to 160. Bias is an optional distance tolerance in scene units. Use a finer grid on thin or closely spaced forms. |

The request accepts up to 16 named, top-level native sculpt receivers,
with up to 32 sprays per receiver. Imported meshes authored as native
sculpt fields participate in visibility. Separately rendered overlays,
meshes and splat layers are outside the sculpt field capture.

Apply bakes the visible receiver depths in the current rest pose. Later
edits to the blocker or camera leave that capture intact. Wrap mode
instead evaluates its retained shape against the receiver's surface.
For a new visibility capture, reapply to the source with the revised
brush settings. The CLI saves beside the source to keep relative assets
resolvable.

The headless editor provides `planSculptSpray`, `applySculptSpray`, and
`inspectSculptSprays`. Apply is undoable. The receipt reports the ray
grid and count of first hits for each receiver before facing or falloff.
The scene keeps the brush, receiver-local frame and depths so it can
be reloaded without another visibility pass.

Run the example with `node examples/sculpt-spray-demo.cjs /tmp/ink-sculpt-spray`.
