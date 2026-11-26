# Choose paint fallbacks at sprite size

Group retained [3D painting marks](painting-3d.md) into regions and give each region a priority, a feature-width measurement, and a fallback. Ink projects the feature width with the same native camera used for the image. A region keeps its detailed marks when the feature reaches its pixel threshold. Below that threshold, Ink can replace the marks with flat pigment, a simpler line, or a protected silhouette mark.

```sh
ink-studio paint-survival review scene.json plan.json --out review
ink-studio paint-survival apply scene.json plan.json review/report.json --case front/sprite --out sprite-scene.json
```

`review` renders the original and candidate for every angle and resolution. Open `review.png` for the comparison and the individual PNGs for inspection at the native grid. The report records the measured width, threshold, priority, selected fallback, and the protected-pixel receipt where applicable. A span outside the view leaves its region untouched.

`apply` accepts one reviewed case. It checks the scene, plan, and matrix images and rerenders the chosen case before saving an ordinary editable scene. Original marks in substituted or budgeted-out regions are retained as disabled marks. Drawn fallbacks have stable IDs like `lod-seal` in the painting. Save the revised scene beside the source to retain relative assets. The selection is baked for that reviewed view. Keep the source and plan to apply another case.

## Describe the review

The plan sets a shared camera target, distance, and projection, then supplies distinct yaw and pitch angles in radians. The renderer samples the scene once per view at the plan's `time` in seconds and uses `px: 1` at each supplied resolution. `raw: true` requests Ink's raw render path. Each plan needs at least two native resolutions and two angles.

```json
{
  "format": "ink-studio/paint-survival",
  "version": 1,
  "camera": {"target": [0, 0, 0.2], "dist": 3.7, "projection": "orthographic"},
  "resolutions": [{"id": "close", "w": 148, "h": 100}, {"id": "sprite", "w": 42, "h": 28}],
  "angles": [{"id": "front", "yaw": 0, "pitch": 0}, {"id": "oblique", "yaw": 0.85, "pitch": 0.1}],
  "fallbackBudget": 3,
  "pixelBudget": 4,
  "regions": [{
    "id": "seal",
    "placement": "panel-ink",
    "marks": ["seal-left", "seal-right"],
    "priority": 70,
    "measure": {"span": [[-0.23, 0.1, 0.2], [-0.18, 0.1, 0.2]]},
    "minPixels": 1.6,
    "fallback": {
      "kind": "line",
      "points": [[-0.42, 0.1, 0.35], [0.18, 0.21, 0.35]],
      "radius": 0.06,
      "mat": "amber",
      "attachment": {"kind": "surface", "slot": "face", "snap": {"mode": "surface", "direction": [0, 0, 1], "maxDistance": 0.31}}
    }
  }]
}
```

Locate `measure.span` across the smallest detail you want to keep, such as the width of a hatch or the space between dots. Use two world-space XYZ points at the reviewed pose. To place the span in an unrigged mark's local rest coordinates, also set `measure.mark` to one of the region's mark IDs. The mark and placement transforms are included. For a rigged or warped region, use a posed world span along the feature itself. The default threshold is 1.5 art pixels.

| Fallback | Authoring |
| --- | --- |
| `pigment` | Supply `mark` with a native brush, poses, palette material, and surface attachment. Ink renders the replacement as flat pigment. One broader shape can carry the color of several fine strokes. |
| `line` | Supply `points`, `radius`, and `mat`. Ink builds one simple sweep. With a surface attachment, the line is flat pigment. |
| `silhouette` | Supply `color` and an `at` anchor or `path`. `stamp` and `bias` use the [protected-pixel rules](protected-pixels.md). Ink tests the result against the scene depth. |
| `omit` | Hide those marks below the threshold. |

Drawn fallbacks use the region's painting placement and can reuse its attachment slots. A mark can belong to one region. Below threshold, the highest-priority regions get the available `fallbackBudget` slots. Ties use the region ID. An omitted region costs no slot. Protected silhouette pixels also compete in the existing native pixel budget, which `pixelBudget` can override for the candidate. Watch the receipt for marks that are occluded, overlap, or exceed that budget.

Ink's [stable detail](stable-detail.md) fades still apply within each render. This workflow changes the authored representation of selected regions for a particular shot.

## Run the demo

```sh
node examples/paint-survival-demo.cjs /tmp/ink-paint-survival
```

The example compares three native sizes at three angles. At the smallest size, the iris becomes a solid pigment shape, the hatch becomes a single line, and the crown keeps three protected pixels. The lowest-priority tick marks give up their fallback slot. The example also saves the accepted front sprite scene.
