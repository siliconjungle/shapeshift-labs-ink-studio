# Move raster regions by ID

`fx.moveRegions` moves independently painted fragments on the same canvas.
Feed it the source image, a matching one-channel raster of IDs, and a list of
transforms. Use authored labels, `fx.trackRegions.labels` for tracked objects,
or `proc.cellEdges.index` to move Voronoi cells.

```js
const {pixelEffects} = require('@shapeshift-labs/ink-studio').load().KIT.procedural;
const {value, labels: visibleIds, gaps} = pixelEffects.moveRegions(paint, labels, [
  {id: 7, offset: [12, -3], pivot: [34, 20], angle: 0.18, depth: -2},
  {id: 41, offset: [-5, 0], scale: [0.9, 1], depth: 1}
], {filter: 'nearest'});
```

Use the same `source`, `labels`, `transforms`, and `options` inputs on the
graph node. Feed a changing transforms array for animation. IDs can be sparse
and can apply to multiple disconnected islands. They stay stable when the list
is reordered. Omitted IDs stay in place. A transform for an ID absent in the
current frame can be kept in the list.

| Transform field | Meaning |
| --- | --- |
| `id` | A unique integer key from −1 to 4,294,967,295, distinct from the background ID. |
| `offset` | X and Y translation in art pixels. Defaults to `[0, 0]`. |
| `pivot` | Source-art coordinates with a top-left origin and Y increasing down. Defaults to the center of the ID's painted bounds. Pixel centers have half-integer coordinates. |
| `angle` | Radians, clockwise on screen. Defaults to 0. |
| `scale` | A uniform factor or `[x, y]` applied before rotation around the pivot. Negative values reflect an axis. Defaults to 1. Magnitudes range from 0.001 to 256. |
| `depth` | Lower values are in front. At equal depth the higher ID is in front. Defaults to 0. |
| `opacity` | Strength from 0 to 1. Defaults to 1. |

`options.background` reserves a label for unassigned pixels. It defaults to 0
and can be set to −1 to make 0 a movable ID. Unassigned pixels stay fixed behind
all regions by default. Set `keepUnlabeled: false` to omit that paint.
`filter: 'nearest'` is the default. `filter: 'linear'` filters premultiplied
paint, sampling only the current ID so neighboring regions cannot bleed into
it. Integer translations use exact pixel copies with either filter. All outputs
are clipped to the original canvas. Pad the source and labels together when
a piece needs room to travel past the original image.

| Output | Meaning |
| --- | --- |
| `value` | The composited RGBA canvas, preserving its source pivot. |
| `labels` | The frontmost contributing region ID per pixel. Unassigned and empty pixels have the background ID. |
| `gaps` | A byte mask of lost alpha at originally painted, labeled pixels. A neighboring fragment can fill a gap. Preexisting transparency does not count. |

Feed `gaps` to `raster.mask` to expose paper, substrate, or light under a
moving piece. Use the output `labels` for selection or as the label input to
a later pass.

The node accepts at most 1,048,576 canvas pixels, 65,536 painted regions or
transform records, and 48 million resampling visits. Each linear sample counts
as four visits. Work is counted after clipping transformed bounds to the canvas.

```sh
ink-studio graph describe fx.moveRegions --example > regions.json
ink-studio graph run regions.json --out example
node examples/raster-region-move.cjs ./faultglass
```

Open `faultglass/index.html` for the looping enamel dial study and a synchronized
view of the gap mask.
