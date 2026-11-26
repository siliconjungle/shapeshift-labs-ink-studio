# Paint looseness inside a protected edge

Give a 3D painting mark a `looseness` record to vary the paint while keeping the receiving sculpt editable and its field unchanged. Spacing, size, scatter, and outline variation can be edited independently of the recorded path, pressure, and orientation.

```json
{
  "size": 1.9,
  "spacing": 1.6,
  "displacement": 0.08,
  "irregularity": 0.75,
  "seed": 137,
  "interior": {
    "center": [0, 1.39, 0.55],
    "radii": [1.48, 0.91, 0.60],
    "feather": 0.35
  },
  "silhouetteAllowance": 0
}
```

| Control | Behavior |
| --- | --- |
| `size` | Multiplies the dab size after the pressure response. The neutral value is 1. |
| `spacing` | Multiplies the step along the unscattered path. Use 1 for the original dab spacing. Custom profiles supply their own spacing. Standard brushes use the sweep `step` or its automatic value. |
| `displacement` | Maximum scatter in the dab's local XY plane, in scene units before mark placement. |
| `irregularity` | Amount of seeded outline distortion, from 0 to 1. A separate random channel controls it independently of scatter. |
| `seed` | Repeats the same scatter and irregularity when the painting is reopened. |
| `interior` | Optional ellipsoid in mark-local coordinates, evaluated at each dab center after surface projection. The neutral settings apply outside it. The values gradually reach full strength across the inner fraction given by `feather`. Omit the mask to use the settings along the whole stroke. |
| `silhouetteAllowance` | Required for a surface-bound mark with looseness. The explicit budget is measured in the receiver's rest field units. Free marks and rig-only attachments have no receiving surface to bound. |

A zero allowance places pigment directly on the receiver using the mark's palette color and coverage. It uses contact points at the receiver surface, so the splat positions, footprints, and silhouette remain exact. A positive allowance keeps the mark as a separate relief layer and clips it to the receiving field expanded by the stated amount. This is a 3D field limit. Raster antialiasing still applies to the sampled edge.

Use `painting-3d update` with a mark `set` edit to replace its looseness settings. `plan` and `inspect` show the settings and silhouette allowance. Extraction preserves the authored settings and poses along with the rest of the painting.

```sh
node examples/paint-looseness-demo.cjs /tmp/ink-paint-looseness
```
