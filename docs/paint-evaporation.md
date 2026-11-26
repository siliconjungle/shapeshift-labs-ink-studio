# Paint evaporation

Release a region of retained 3D paint into a seekable particle layer. The source is sampled from Ink's sculpt bake, including surface-snapped pigment, finish paint, and raised or freestanding strokes. Each particle stores the sample's color, emission, source mark, position, and birth time.

```json
{
  "format": "ink-studio/paint-evaporation",
  "version": 1,
  "id": "signal-release",
  "painting": "signal",
  "marks": ["amber", "light"],
  "region": {
    "points": [[-0.8, 0.3, 0.18], [0.8, 0.3, 0.18]],
    "radius": 0.32,
    "direction": [1, 0, 0]
  },
  "start": 0.25,
  "end": 0.9,
  "life": 1.2,
  "spacing": 0.06,
  "size": 0.028,
  "velocity": [0.15, 0.95, 0.19],
  "spread": 0.25,
  "fade": 0.45,
  "seed": 14
}
```

- `painting` names the scene placement. `marks` lists enabled marks in that placement. Each source mark belongs to one evaporation layer.
- The brush path sweeps a sphere along consecutive `region.points` in the scene's rest coordinates. One point paints a spherical region. `direction` sweeps the release from the lowest to highest projected point over `start`–`end`. Matching times release the entire region together.
- `spacing` sets the sampling cell size and `size` sets particle radius. Larger spacing gives fewer particles. A scene supports up to 4,096 particles across its baked layers.
- Velocity is in scene units per second. `spread` adds seeded velocity variation. `life` and release times are in seconds, and `fade` is the fraction of each lifetime spent fading out.
- Release clips selected paint where the sweep has arrived. Surface paint exposes its receiver, and positive volume paint loses the selected geometry. Samples carry the visible baked color and authored emission in separate channels. Emission stays on the particles as a visible glow, while light spill authored on the receiver fades with the paint coverage.
- Birth positions are baked in scene rest space at the chosen parameter time. Reapply the plan after editing source marks, materials, or placement. Applying the same ID replaces that layer. The saved scene retains its source painting for editing.

```sh
ink-studio paint-evaporation apply source.json release.json --out released.json
ink-studio paint-evaporation inspect released.json --at .75 --layer signal-release
ink-studio render released.json --t .75 --out release.png
ink-studio clip released.json --from 0 --to 2.1 --fps 12 --out release-loop.png
```

Pass `--at seconds` to `apply` to capture a parameterized pose. The default is the release start. Write the updated scene beside the source to keep relative asset paths. `inspect` reports stable particle IDs and whether each birth is pending, airborne, or expired at the requested time.

Run the [Signal Kiln example](../examples/paint-evaporation-demo.cjs) with `node examples/paint-evaporation-demo.cjs ./kiln-demo`. It exports the stills, clip, editable scene, plan, and particle report.
