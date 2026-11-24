# Native-grid 2D lighting

Light indexed sprites and tiles on one art grid. Point lights choose exact swatches from authored ramps, and opaque sprite or tile pixels can cast hard shadows onto the same grid. WebGL2 shades on the GPU and the headless renderer uses the same fixed-point falloff, surface normals, and shadow traversal.

## Run Lantern Crossing

Build the offline browser demo and export its source frame:

```sh
node examples/pixel-lighting/build-demo.cjs lantern-crossing.html
node -e 'console.log(JSON.stringify(require("./examples/pixel-lighting/scene.cjs")()))' > lantern-crossing.json
node cli/ink-studio.js pixel-lighting lantern-crossing.json --out lantern-crossing.png
```

Open the demo, drag the lamp, and toggle cast shadows or surface normals. **Compare with headless** checks every native RGBA pixel for the current lamp position. **Download scene JSON** saves the edited lighting state for the same CLI command. Use `--frame lighting.json` to override `lights`, `ambient`, or `shadows` at export.

## Author an indexed scene

The version 1 JSON document has `format: "ink-studio/pixel-lighting"`, `version: 1`, and `width` and `height` in art pixels. Both dimensions can be 1–512. The origin is at the top left. X points right, Y points down, and Z measures height above the art plane. The center of cell (0, 0) is (0.5, 0.5).

| Field | Meaning |
| --- | --- |
| `ramps` | One palette ramp per indexed slot. Supply 1–256 ramps with the same number of `#rrggbb` swatches, ordered from darkest to lightest. Each ramp has 2–16 swatches. |
| `assets` | Named sources with `width`, `height`, and row-major `slots`. Use a zero-based ramp index for opaque pixels and `null` or `-1` for holes. |
| `assets.*.heightMap` | Optional row-major heights in art pixels, measured from the placement elevation. Heights set receiving and casting elevations and derive local normals when no normal map is supplied. Transparent neighbors leave the local height unchanged. |
| `assets.*.normalMap` | Optional row-major RGB bytes, three channels per art pixel. The channels encode +X right, +Y up, and +Z out of the screen. `[128,128,255]` is flat. An explicit normal overrides the height-derived normal while retaining the height for shadows. |
| `tileSize` and `tiles` | Tile size in art pixels and an ordered list of placements whose `at` coordinates are integer tile cells. Tile assets must be square at that size. |
| `sprites` | Ordered placements whose `at` coordinates are integer art pixels. The renderer places tiles first and sprites second. Each visible pixel receives light using the topmost opaque sample. |
| `lights` | Up to eight point lights. Each has `at: [x,y,z]`, `radius` from 1/16 to 256 art pixels, optional `strength` from 0 to 4 (defaults to 1), and optional `castsShadow` (defaults to true). |
| `ambient` and `shadows` | Ambient energy in [0, 1], default 0.2. Set `shadows: false` to disable light occlusion for the frame. |

Each placement names an `asset` and may set `elevation`, `shadowHeight`, and `castsShadow`. Elevation lifts the receiving surface. Shadow height extends its caster upward. Both default to zero, and each accepts 0–512 art pixels. A blocker occupies the column up to its caster height. Holes stay unpainted and cast nothing. Overlapping opaque casters contribute the tallest blocker at each cell. A lamp at or below a receiving surface contributes no light to that pixel.

Lighting uses a distance falloff and the surface normal to determine each lamp’s contribution. Unblocked contributions accumulate with ambient energy before the renderer selects one swatch. A standalone rendered layer has binary alpha and its authored palette colors. Compositing opacity and later grading can alter the final frame colors.

## Add it to a preview or export

Use a `lighting2d` layer in `look.composite.layers` or a [render graph composite pass](render-graph.md). Both accept the portable JSON scene or a prepared handle. The layer owns its native resolution and scales with nearest sampling. Supply an optional output-space `rect` for placement. Treat a bound scene as immutable and replace the scene object when editing assets or placements.

```js
const prepared = KIT.pixelLighting.prepare(scene);
const frame = KIT.pixelLighting.render(prepared, { shadows: false });
// frame is { w, h, rgba } with top-down RGBA8 pixels.

const layer = {
  lighting2d: prepared,
  lightFrame: ({ sceneTime, time }) => ({
    lights: [{ at: [30 + 8 * Math.sin(sceneTime ?? time), 22, 13], radius: 44 }]
  })
};
const composite = { layers: [layer] };
const renderGraph = { passes: [{ id: 'lanterns', type: 'composite', layer }] };
```

Pass either `composite` or `renderGraph` to the standard renderer. The optional JavaScript `lightFrame` callback provides per-frame overrides while allowing repeated draws to reuse the same prepared art. For JSON-only workflows, supply the serialized scene directly inside the layer, with its light settings embedded.

For a custom WebGL2 host, `createPixelLightingPass(gl, KIT.pixelLighting)` returns a pass with `draw(prepared, options)` and `dispose()`. Draw returns the native `texture`, its `framebuffer`, and dimensions. The pass changes WebGL draw state and reuses its framebuffer on the next draw. Consume or copy the texture before reusing the pass.
