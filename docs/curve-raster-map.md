# Curve-to-raster coordinate maps

`warp.curveMap` turns a path into a native-pixel strip. The result
includes a UV field for `warp.sample` and separate numeric planes for
painting, masking, lighting, or motion. Keep the source image in strip
space and move the path to bend that image in art space.

```js
const { rasterWarp } = require('@shapeshift-labs/ink-studio').load().KIT.procedural;
const path = [[12, 68], [39, 48], [71, 53], [104, 21]];
const mapping = rasterWarp.curveMap(path, {
  width: 120, height: 80,
  strokeWidth: [3, 14, 10, 0], feather: 1, overlap: 'last'
});
const painted = rasterWarp.sample(texture, mapping.value, { filter: 'nearest' });
```

Pass the same `path`, `width`, `height`, and optional `options` to the
graph node. Connect its `value` directly to `warp.sample.field`. The
[graph catalog](headless-authoring.md#raster-warps-and-3d-projection)
also supplies a runnable example.

```sh
ink-studio graph describe warp.curveMap --example > curve.json
ink-studio graph run curve.json --out curve-preview
```

## Coordinates

The path takes XY vertices or a typed `{points, closed}` from
`proc.path` or `draw.path`. It samples each span as a straight segment.
Project 3D curves into art space before using their XY coordinates.
If a path record includes Z values, the raster uses its XY projection.
Art pixel centers are at `(x + 0.5, y + 0.5)`. XY uses the top-left
origin and positive Y points down.

| Port | Value |
| --- | --- |
| `value` | Three channels containing **U, V, coverage**. U runs from 0 to 1 along the projected path. V is 0.5 at its centerline and reaches 0 or 1 at the side of the strip. |
| `along` | Arc length in art pixels from the first vertex to the clamped station on the winning span. |
| `across` | Signed normal offset in art pixels from the span. Positive is to the right of travel. A line pointing right has positive across values below it. |
| `tangent` | Unit XY direction of the winning span. Use it to light opposite sides of a ribbon or orient a secondary effect. |
| `coverage` | One channel in 0–1, also available as the third channel in `value`. Set a mask's scale to 1 when consuming this plane. |
| `segment` | Zero-based index of the winning span's starting vertex in the supplied path. Uncovered pixels use −1. All other numeric planes contain zero there. |
| `length` | Total projected arc length in pixels, including the closing span for closed paths. |

To keep a repeat a fixed number of pixels long as the curve grows,
divide `along` by that repeat length to make your own U. Read V with
`raster.channel` on `value` at channel index 1. Join U, V and coverage
using `raster.channels`, then set `edgeU: 'wrap'`
on the sampler. For a closed path's normalized UV seam, make the
source texture repeat at U = 0 and U = 1 and use the same wrap setting.

## Width, ends, and crossings

- `strokeWidth` is the full strip width in art pixels. The default is 8.
  Use one number or one width per supplied path point. Widths interpolate
  between vertices. Zero-width endpoints make a taper.
- `caps` is `'round'` or `'butt'`. It defaults to round. Closed paths
  have rounded joins. At a rounded cap, U holds the endpoint, while V
  still comes from the signed normal offset. Coverage follows radial
  distance in the cap and at joins.
- `feather` is a 0–16 pixel coverage transition centered on the strip
  boundary. The default of 0 gives hard coverage at art pixel centers.
- `overlap: 'nearest'` uses the covered span whose clamped centerline
  point is closest to the pixel. Distance ties choose the earlier arc
  position. `'first'` or `'last'` uses the earliest or latest covering
  span in path order, which determines which branch appears on top.
  Interior samples take priority over fringe samples at crossings.
  All coordinate planes use the same winning span. Coverage takes
  the maximum across spans so the feathered edge of a foreground
  branch does not cut a hole through the strip behind it.

Coincident adjacent points may share a width. Their zero-length span
is skipped, and surrounding spans keep their source indices. The map
allows up to 4,096 nonzero spans, 1,048,576 art pixels, and 48 million
pixel/span candidates after clipping span bounds to the viewport.

## See the difference

```sh
node examples/curve-raster-map.cjs ./curve-raster-demo
```

Open `curve-raster-demo/index.html`. **Switchback** compares two
crossing policies on the same moving strip. **Ember stroke** uses a
tapered width profile and an animated texture. The coordinate sheet
shows the along, across, tangent and coverage planes that drive the
raster effects.
