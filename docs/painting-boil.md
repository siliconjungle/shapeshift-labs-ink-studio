# Boil retained painting marks

Add `boil` to a [3D painting mark](painting-3d.md) or its brush preset to give it a small, seeded redraw. The field shifts coherently over nearby points in the mark's local coordinates. The authored brush, poses, pressure, and mark ID remain editable.

```json
{
  "id": "ink",
  "edits": [{
    "op": "set",
    "id": "lantern-frame",
    "patch": {
      "boil": {
        "seed": 40,
        "amplitude": 0.085,
        "scale": 0.44,
        "axes": [1, 1, 0],
        "cadence": {"fps": 12, "holds": [2, 3, 2, 3], "loop": true},
        "protect": [{
          "points": [[-0.46, 0.64, 0.2], [0.47, 0.64, 0.2]],
          "radius": 0.16,
          "feather": 0.3
        }]
      }
    }
  }]
}
```

```sh
ink-studio painting-3d update scene.json boil-edit.json --out boiled.json
ink-studio render boiled.json --t 0.25 --out frame.png
ink-studio clip boiled.json --from 0 --to 1 --fps 12 --out boil.png
```

`amplitude` is the maximum displacement per weighted axis in mark-local units. It defaults to 0.02. `scale` sets the size of neighborhoods whose lines tend to move together and defaults to 0.28. XYZ `axes` weights default to `[1, 1, 0]`, which suits a stroke drawn in the local XY plane. Give Z a weight for a stroke that should also move in depth.

## Hold drawings and protect contours

The cadence uses an integer `fps` and a list of `holds` measured in ticks at that rate. It defaults to 12 fps and a two-tick exposure. Each drawing stays fixed for its entire exposure. By default, a repeated hold pattern generates fresh seeded drawings. Set `loop: true` to repeat that same set of drawings. Use `phase` to advance an individual mark's cadence by whole ticks.

Put protection points along a contour that should stay put. A single point protects a round neighborhood. Multiple points protect a path. Use coordinates on the seated stroke, in the mark's local space. A free stroke uses its authored coordinates before its placement transform. `radius` gives the width of the neighborhood and `feather` softens the outer fraction, 0.35 by default. Inside the fully protected band, the original field and opacity are sampled exactly. Give the path enough radius to cover both edges of a thick stroke. Surface relief and finish are sampled through the same local field.

Use `drawing` to pin a mark to a particular seeded drawing for review or still export. Remove that field to return to the cadence. Use `boil: null` in a mark edit to remove a mark's own setting. Set `amplitude: 0` to override boil inherited from a preset.

## Preview or export a painting clip

Use a [painting cel clip](painting-cels.md) to set authored poses and drawing holds on the same timeline. With the default scene clock, boil can redraw inside a held cel. Set `cadence.clock: "cel"` on a mark to keep the drawing selected at the cel's start for the whole cel. In ordinary stills and clips without authored cels, both clocks use scene time.

```sh
ink-studio painting-cels preview scene.json clip.json --at 0.25 --view view.json --out review
ink-studio painting-cels sample scene.json clip.json --at 0.25 --out exposure.json
ink-studio painting-cels export scene.json clip.json --view view.json --out flipbook
```

For a boiled clip, preview and sample resolve the same exposure on the clip's native tick grid, independent of scrub order. They use that exposure's start time for the scene pose. The preview and export use the same locked camera from the start of the clip. A sampled editable scene pins each selected boil drawing, and the receipt records the time to use for other scene animation. Export keeps cel boundaries and subdivides longer holds when a seeded drawing changes. The animated PNG preserves the exposure lengths. The `frames` list in `export.json` records each rendered exposure, its cel ID, start time, hold, and active drawings.

```sh
node examples/painting-boil-demo.cjs /tmp/ink-painting-boil
```

The lantern demo renders a held tick and the next drawing side by side, pins the lantern's top and lower contours, and exports a loop with alternating two- and three-tick exposures.
