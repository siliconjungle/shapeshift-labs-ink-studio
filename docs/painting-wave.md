# Painting wave

A retained wave sways selected paint or a named sculpt around a fixed root. Paint direction, phase, and stiffness with soft strokes along the object's growth axis. The same retained recipe drives still renders and clips.

```json
{
  "format": "ink-studio/painting-wave",
  "version": 1,
  "id": "reed-sway",
  "target": { "mode": "geometry", "solid": "reed" },
  "root": { "at": [0, -0.8, 0], "axis": [0, 1, 0], "length": 1.7, "lock": 0.18 },
  "amplitude": 0.28,
  "frequency": 1,
  "base": { "direction": [1, 0, 0], "phase": 0, "stiffness": 0.12 },
  "strokes": [
    { "points": [0.7, 1.15], "radius": 0.45, "feather": 0.6, "phase": 55 },
    { "points": [1.5], "radius": 0.38, "direction": [1, 0, 0.5], "stiffness": 0.5 }
  ]
}
```

- Heights in `points`, `radius`, `length`, and `lock` are scene units along the root axis. A brush covers the span between its first and last axial extents and fades beyond that span. The root and all points at or below `lock` stay fixed. Positive heights ease into full sway by `length`.
- `direction` is an XYZ vector projected across the root axis. Adjacent opposing directions can cancel. `phase` is a signed offset in degrees and `frequency` is in cycles per second. `stiffness` runs from zero for freely swaying to one for immobile. Each stroke blends its supplied channels in list order. Optional `feather` controls the soft edge and `opacity` scales its influence.
- Geometry targets use the named bounded sculpt's recipe coordinates before its outer object transform. The shape and receiver-attached painting travel together.
- To wave existing marks, use `"target": { "mode": "pigment", "painting": "panel", "marks": ["stripe"] }` for flat pigment, surface shading, or finish marks. Use `"raised"` for marks with positive volume relief. Both use painting placement coordinates and keep the receiving solid fixed. Surface-bound marks are snapped with their existing settings after the stroke guide moves. `spacing` controls the resampling interval in scene units for these guide strokes.

```sh
ink-studio painting-wave apply source.json wave.json --out waved.json
ink-studio painting-wave inspect waved.json --at .25
ink-studio render waved.json --t .25 --out quarter.png
ink-studio clip waved.json --from 0 --to 1 --fps 12 --out sway.png
ink-studio painting-wave sample waved.json --at .25 --out held.json
```

`apply` replaces an existing wave with the same ID. `inspect` reports phase, stiffness, direction, and displacement at sampled heights. `sample` writes an editable scene with each wave held at the requested time. Remove the wave's `time` to animate it again. Write scene outputs beside their source so relative asset paths keep working.

Run the [Reed Signal example](../examples/painting-wave-demo.cjs) with `node examples/painting-wave-demo.cjs ./wave-demo`. It renders all three motion targets, exports an animated PNG, and saves the editable quarter-cycle scene.
