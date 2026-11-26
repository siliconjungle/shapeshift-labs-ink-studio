# Flow retained paint along a painted field

Advect existing [3D painting marks](painting-3d.md) through an [editable flow map](flow-maps.md). Select marks by ID, then seek to a time or bake a sequence of editable cels. The operation moves the stroke guides, interpolating their original pressure and orientation at seams and cuts. Native brushes, materials, and attachments still render the resulting poses.

```sh
ink-studio painting-flow sample scene.json flow-plan.json --at 0.375 --out flowed.json
ink-studio painting-flow bake scene.json flow-plan.json --fps 12 --frames 24 --out clip.json
ink-studio painting-cels preview scene.json clip.json --frame flow-005 --view view.json --out review
ink-studio painting-cels export scene.json clip.json --view view.json --out flipbook
```

A sample writes an ordinary scene and keeps the source scene editable. Save it beside the source to preserve relative assets. A bake uses the same sampler at each tick. The output is a normal [painting cel clip](painting-cels.md), with one held tick per frame. Use `--from` to start at a later flow time. Select `--playback loop` when the planned finish can cut cleanly back to the start.

## Set the field and chart

```json
{
  "format": "ink-studio/painting-flow",
  "version": 1,
  "painting": "marks",
  "marks": ["tide", "thread", "foam"],
  "field": {"file": "tide-field.json"},
  "chart": {"origin": [0, 0, 0], "u": [1, 0, 0], "v": [0, 1, 0]},
  "wrap": [true, false],
  "seam": "split",
  "edge": "lose",
  "obstructions": [{"id": "shoal", "rect": [-0.31, 0.08, 0.14, 0.43], "mode": "slide"}]
}
```

Use the name of a flow map in the retained painting's `flowMaps` or a field JSON path relative to the plan. Paint or edit that file with `flow-map new` and `flow-map paint`.

The chart defaults to local XY. U and V must be perpendicular unit vectors. Ink projects each guide after its individual mark transform and before the painting placement transform. Each point keeps its distance from the chart plane. Surface-attached guides use the existing surface snap after flowing. The flow plan governs guide positions, so brush footprints can extend past a seam or an obstacle face.

`speed` scales the field's velocities. `step` sets the maximum integration step in seconds and defaults to 1/60. Ink takes smaller steps for fast fields. `spacing` is the maximum chart-space distance between guide stations and defaults to half the smaller map cell. Use a shorter spacing to capture more of a sharp flow bend. Sampling uses fixed time steps and the exact final remainder so direct seeks and baked frames agree.

## Choose what happens at boundaries

| Setting | Behavior |
| --- | --- |
| `wrap` | Set U and V independently. A wrapped axis interpolates across the opposite edge's cells. |
| `seam: "split"` | A wrapped pose continues from the opposite edge. A stroke spanning the seam becomes separate fragments. |
| `seam: "stop"` | Hold a pose where it reaches a wrapped seam. |
| `edge: "stop"` | Hold a pose at an unwrapped chart edge. |
| `edge: "lose"` | Lose a pose when it exits an unwrapped edge. The remaining guide can end at the contact. |
| Obstruction `mode: "stop"` | Hold the pose at the first face it hits. |
| Obstruction `mode: "slide"` | Continue along the hit face with the remaining tangential motion. |
| Obstruction `mode: "lose"` | Remove the pose at contact. |

Obstructions use named in-chart rectangles `[minU, minV, maxU, maxV]`. Ink sweeps the motion segments against the rectangles and clips connecting guides at their boundaries. A station authored inside an obstruction starts held for stop or slide and starts lost for lose. A free dab wholly inside the obstruction is omitted from the result.

The first surviving fragment keeps the original mark ID. Additional fragments receive deterministic IDs for their originating segment and chart tile. Reports include per-mark station losses, wraps, seam stops, edge contacts, obstacle hits, and surviving fragment IDs.

## Run the demo

```sh
node examples/painting-flow-demo.cjs /tmp/ink-painting-flow
```

The demo paints the velocity field with Ink's own flow brush. An amber stroke wraps across U, a cyan stroke slides along the shoal, and rose foam exits the unwrapped V edge. The output includes an editable sampled scene, the cel clip, an animated PNG, and a report of the boundary events.
