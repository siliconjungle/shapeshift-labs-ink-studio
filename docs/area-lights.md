# Shaped area lights

Add `areaLights` to a finished world or `finish.areaLights` to a JSON diorama.
Each emitter has a rectangle or disk shape. Its width and height affect the
lit surface, the shadow penumbra, the visible silhouette, and its image in a
planar reflection. A small disk can serve as a candle. A wide rectangle can
serve as a window.

```json
[
  {
    "id": "window",
    "at": [-1.92, 0.965, -1.497],
    "normal": [0, -0.36, 1],
    "shape": "rectangle",
    "size": [1.77, 0.82],
    "color": "#d4e9ff",
    "intensity": 7,
    "radius": 6.3,
    "sampleGrid": 5,
    "shadowSteps": 4
  }
]
```

The size is the full width and height in world units. A disk with different
width and height produces an ellipse. `normal` points toward the illuminated
side and `up` can rotate the shape around that normal. `twoSided` allows
emission in both directions. `visible` and `reflection` control camera and
planar capture visibility independently. Both default to true.

The headless renderer averages deterministic samples across the emitter.
Increase `sampleGrid` from 1 to 8 to take more samples per side. The default
takes 4 × 4 samples. Brightness uses `intensity`, and `radius` sets the light's
maximum reach. Set `shadowSteps` to 2–16 to quantize visibility into that
number of bands. Omit it for the sampled visibility. `shadows: false` skips
occlusion and keeps the light and its shape. `bias` offsets shadow rays from
the receiving surface and defaults to 0.025 world units.

Shadow casters use retained static sculpts. JSON dioramas retain these
automatically. In JavaScript, set `S.keepRenderSdf = true` before baking the
static casters. Bake moving geometry separately. Scenes without a retained
static caster still receive the shaped light. A pool uses its existing
planar reflection binding to capture the visible emitter.

```sh
node cli/ink-studio.js render examples/shaped-lights.js \
  --w 208 --h 140 --px 1 --raw --out lantern-court.png
node cli/ink-studio.js render examples/shaped-lights.js \
  --w 208 --h 140 --px 1 --raw --area-lights off --out lantern-court-off.png
```

Pass `--area-lights file.json` to replace the emitters for a shot, or pass
`areaLights: false` or an emitter array to Node's `render` options. A CLI
settings array also requests caster retention when building a JSON diorama. The
Node renderer and CLI use area sampling for direct light and actual emitter
geometry for reflections. For the analytical polygonal-light technique that
informed the feature, see [Real-Time Polygonal-Light Shading](https://eheitzresearch.wordpress.com/415-2/).

See [additional light emitters](light-emitters.md) for line lights, colored cookies, animated settings and native browser rendering.
