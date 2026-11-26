# Raise, flatten, or recess retained paint

Set `relief` on a [3D painting mark](painting-3d.md) with a surface attachment and `snap.mode: "surface"`. Ink seats the dab at the contact and uses its surface normal. The original poses, pressures, brush, and attachment remain editable. Relief uses the contact itself as its zero height.

| Relief settings | What the stroke does |
| --- | --- |
| `{"mode":"flat"}` | Applies pigment and keeps the receiver's geometry, footprint, and shadow silhouette. |
| `{"mode":"shading","height":0.06}` | Adds a raised shading normal to the painted footprint. Use a negative height for the shading of a recess. Both signs keep the existing surface geometry and cast silhouette. |
| `{"mode":"volume","height":0.18,"castShadow":true}` | Builds a raised solid from the sweep's finite brush profile. It affects depth and can appear past the receiver silhouette. Casting is independent of the visible shape and defaults to off. |
| `{"mode":"volume","height":-0.14}` | Cuts a groove out of the bound receiver and finishes the cut with the mark material. Other objects are unaffected by the cut. The receiver's shadows use its new shape. |

Shading relief turns the surface normal using the slope of a smooth height profile across the mark. `feather` gives the shoulder width inside the brush boundary and defaults to `0.06`. Use `tint: false` to keep the receiver's color. Pressure and profile opacity contribute to the shading strength.

Volume relief fits the brush's depth to a finite span while pressure still controls its width. `seat` gives the portion below the surface for raised paint, or above it for a recessed cutter. It defaults to half the absolute height. Height and seat are expressed in the mark's local units before placement. A raised mark can set `silhouetteAllowance` to cap how far its solid extends beyond its receiver's field, measured in receiver rest units. A positive allowance can still affect the outline at a grazing angle. Use flat or shading relief for an exact silhouette. With a positive [paint looseness](paint-looseness.md) allowance on the same mark, Ink uses the smaller allowance.

Relief combines with [direction fields](mark-direction.md), [grids](mark-grid.md), and brush profiles. Ink carries the seated dabs through an invertible native warp and with the receiver's rig part. A geometry recess is scoped to its receiver. Deep cuts can change the receiver's silhouette or pass through thin stock. Baked light uses the signed field for casting and live light uses the renderer's existing opacity rules.

Use `painting-3d plan` or `inspect` to read the resolved relief settings. A `set` edit replaces `relief`. Set it to `null` to restore the original sweep behavior. Extraction preserves the authored settings and the original stroke.

```sh
node examples/paint-relief-demo.cjs /tmp/ink-paint-relief
```
