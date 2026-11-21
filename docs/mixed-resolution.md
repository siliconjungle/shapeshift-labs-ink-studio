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
| Layer `opacity` and `blend` | Opacity ranges from 0 to 1. `over` composites in list order and `add` adds the visible color of a layer. |
| Raster layer `rect` | Optional `[left, top, width, height]` in output pixels. The source scales into this rectangle and clips at the frame edge. |

A positive integer resolution rounds the native width and height up independently. Fixed resolutions fit the full frame, so choose a matching aspect ratio to preserve proportions.

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

A raster `source` supplies `{ w, h, rgba }` or `{ w, h, rgb, alpha? }` with top-down byte arrays and straight alpha. The JavaScript API also accepts a synchronous source function. It receives `w`, `h`, `outputWidth`, `outputHeight`, `world`, and `time` and returns a raster matching its native dimensions. This lets animated screen effects draw directly on their own grids. The WebGL renderer uploads each layer at its native size and blends it on the GPU. Scene shading and depth-dependent media use the world grid.

Set `needsCamera: true` on a function-backed layer to receive the current
renderer camera in the source function's `camera` argument. Use it to
project world anchors into the source grid at the current view. Camera-aware
sources still draw in the compositor's layer order.

The CPU returns the composed color at output resolution with `px: 1`. `worldSize` records the size of the world raster, and requested diagnostic passes retain their native world dimensions. Existing CPU transparent exports preserve alpha through composition.

The CLI accepts scene-authored composite settings and `--composite file.json` for an override. JSON supports drawing commands. Use `--composite off` to render the scene with its regular world settings.

Use a composite pass in the [editable render graph](render-graph.md) to place a layer before or after other screen effects.
