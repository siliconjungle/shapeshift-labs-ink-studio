# Mixed-resolution compositing

Set `look.composite` on a world, or pass `composite` to the CPU or WebGL renderer for a frame override. Use `false` to bypass the authored setting. The compositor draws the world at its own resolution and fits it to the output frame before drawing layers in list order. Coordinates for screen drawing use final output pixels, with the origin at the top left.

The output dimensions come from `w` and `h` in Node and the CLI, or `width` and `height` in WebGL. A WebGL framebuffer target can also supply those dimensions.

| Setting | Effect |
| --- | --- |
| `world.resolution` | A positive integer for output pixels per world pixel, or a fixed `[width, height]` raster size. Defaults to the scene's `look.pixelSize` or 1. The CPU also accepts its existing `px` option as a fallback. |
| `world.filter` | `nearest` preserves the world pixel edges. `linear` interpolates. The default is `nearest`. |
| `layers` | An ordered list. A layer supplies drawing commands, annotations, or a raster `source`. |
| Layer `resolution` | Uses the same units as the world. It defaults to a supplied raster's native dimensions or to one sample per output pixel for commands and generated sources. |
| Layer `filter` | `nearest` or `linear`. Filtering takes alpha into account. Defaults to `nearest`. |
| Layer `depthTest` | Tests the raster against the world grid's opaque depth before mixing its color and alpha. |
| Layer `opacity` and `blend` | Opacity ranges from 0 to 1. `over` composites in list order and `add` adds the visible color of a layer. |
| Raster layer `rect` | Optional `[left, top, width, height]` in output pixels. The source scales into this rectangle and clips at the frame edge. |

A positive integer resolution rounds the native width and height up independently. Fixed resolutions fit the full frame, so choose a matching aspect ratio to preserve proportions.

A [native-grid 2D lighting layer](pixel-lighting.md) composites lit indexed tiles and sprites using its own art grid.

## Typography and technical overlays

A `draw` list renders at the layer's native resolution. Command sizes and positions stay in output pixels as that resolution changes. Colors accept `#rrggbb` and `#rrggbbaa` hex strings.

| Command `type` | Fields |
| --- | --- |
| `text` | `text`, center `at` as `[x, y]`, cap height `size`, optional stroke `width`, and `color`. Uses Ink Studio's single-stroke alphabet, numerals and punctuation. |
| `path` | `points` as XY pairs, stroke `width`, optional `closed`, and `color`. |
| `rect` | `rect` as `[x, y, width, height]` and `color`. |

World paths and additional commands support projected arrows, polygon fills, grids, axes, and calibrated scale bars. [Precise drawing primitives](drawing-primitives.md)

Fixed legends and world-anchored labels can share a layer with drawing commands. [View-adaptive legends and labels](view-annotations.md)

## Rasters and screen effects

A raster `source` supplies `{ w, h, rgba }` or `{ w, h, rgb, alpha? }` with top-down byte arrays and straight alpha. The JavaScript API also accepts a synchronous source function. It receives `w`, `h`, `outputWidth`, `outputHeight`, `world`, presentation `time`, and animation `sceneTime` when supplied by the renderer. It returns a raster matching its native dimensions. This lets animated screen effects draw directly on their own grids. The WebGL renderer uploads each layer at its native size and blends it on the GPU. Scene shading and depth-dependent media use the world grid.

Set `needsCamera: true` on a function-backed layer to receive the current
renderer camera in the source function's `camera` argument. Use it to
project world anchors into the source grid at the current view. Camera-aware
sources still draw in the compositor's layer order.

The CPU returns the composed color at output resolution with `px: 1`. `worldSize` records the size of the world raster, and requested diagnostic passes retain their native world dimensions. Existing CPU transparent exports preserve alpha through composition.

The CLI accepts scene-authored composite settings and `--composite file.json` for an override. JSON supports drawing commands. Use `--composite off` to render the scene with its regular world settings.

Use a composite pass in the [editable render graph](render-graph.md) to place a layer before or after other screen effects.

## Depth-tested coarse layers

Set `depthTest: true` on an independently rendered scenery plate, fog
card, or background glow. Give a raster source a top-down
`depth: Float32Array` with one camera-axis depth in scene units per
texel. Use the same camera and framing for the layer and the main world,
and use `Infinity` for sky or pixels without a surface. For a fixed-depth
layer, use `depthTest: { depth: 9.5 }`. This also works for JSON drawing
commands and graph-bound rasters.

```js
world.look.composite = {
  world: { resolution: 1 },
  layers: [
    {
      resolution: 4, filter: 'linear', depthTest: { bias: .04 },
      source({ w, h }) {
        const plate = studio.render(distantWorld, {
          w, h, px: 1, transparent: true, passes: ['depth']
        });
        return { w, h, rgb: plate.rgb, alpha: plate.alpha, depth: plate.passes.depth };
      }
    },
    { resolution: 1, draw: nativeLettering }
  ]
};
```

The default `mode: 'occlude'` rejects samples behind a nearer scene
surface. Use `mode: 'match'` for an effect registered to an existing
surface that should only appear at the same depth. The `bias` is a
nonnegative scene-unit tolerance and defaults to `.03`. Linear
filtering checks each contributing texel against the current visible
world depth. Rejected samples contribute zero premultiplied color and
alpha, so a soft coarse sample cannot tint a foreground silhouette.
The guide uses the world raster's depth-writing geometry. Keep the world
on the native art grid if a one-pixel detail must occlude the layer.

Both headless and WebGL compositors support depth-tested layers. In a
render graph, set `depthTest` on the `layer` definition. A raster supplied
through a named slot can carry its depth array alongside its color data.
Depth-tested overlays keep their authored layer order, so a later
lettering layer can stay at full output resolution.

For volumetric fog and emissive glow generated by the headless renderer,
set their scales independently and keep the world resolution at 1.
[Coarse fog reconstruction](scene-optics.md#reconstruct-coarse-fog-on-the-art-grid)
and [emissive glow](art-passes.md#emissive-finishes) use the visible
native depth when reconstructing their effects.

[Last shift at Glassbank](../examples/depth-aware-layers.js) combines a
quarter-resolution skyline, fog and relay halo with a full-resolution
inspector, foreground gantry and station lettering.

```sh
node cli/ink-studio.js render examples/depth-aware-layers.js \
  --w 288 --h 160 --px 1 --t 1.45 --out glassbank.png
```
