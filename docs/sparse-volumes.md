# Sparse volume exchange

An Ink sparse volume stores sampled density, temperature, velocity, and signed
distance on one world-aligned lattice. Use it to move fields between bounded
headless workflows, combine aligned assets, or bake results at a new spacing.
[Ember Vent](../examples/sparse-volume-ember-vent.cjs) shows the same data as a
lit volume, a signed-distance surface, and diagnostic slices.

## Sparse format version 1

UTF-8 JSON documents have the format `ink-studio/sparse-volume` and version
`1`. This example declares a two-by-two-by-two density volume with one active
voxel and a constant outside signed distance.

```json
{
  "format": "ink-studio/sparse-volume",
  "version": 1,
  "grid": { "origin": [-1, 0, 0], "spacing": [0.5, 0.5, 1], "size": [2, 2, 2] },
  "brickSize": 2,
  "fields": {
    "density": { "background": 0 },
    "signedDistance": { "background": 2, "units": "world" }
  },
  "bricks": [
    { "at": [0, 0, 0], "fields": { "density": [{ "start": 1, "values": [0.75] }] } }
  ]
}
```

- The grid origin is the lower cell corner. Cell `[i,j,k]` is sampled at
  `origin + spacing * ([i,j,k] + 0.5)` component by component. Spacing can
  differ by axis. Grid sizes are positive and each axis permits up to 100,000
  cells.
- Supported field keys are `density` (nonnegative scalar), `temperature`
  (scalar), `velocity` (XYZ vector in world axes), and `signedDistance`
  (scalar, negative inside). Each field can declare a `background` and a
  `units` string. Omitted backgrounds are zero for density and temperature,
  `[0,0,0]` for velocity, and `1` for signed distance. Signed distance must
  have a strictly positive background. Units are preserved verbatim.
- Bricks are identified by nonnegative XYZ coordinates in brick units. The
  shared `brickSize` is from 2 to 16. The local sample index is
  `x + brickSize * (y + brickSize * z)`. Bricks on a far grid edge may be
  partial. Runs cannot store samples in their padding.
- Each named brick field is an ordered list of disjoint runs. `start` is
  the first local sample index and `values` stores consecutive samples.
  Values are finite Float32 components. Scalar samples use one component.
  Velocity stores consecutive XYZ triples with no padding.
- Missing bricks, fields within a brick, and gaps between runs read the
  channel background. Samples beyond the grid also use the background.
  Trilinear sampling interpolates across brick boundaries and can extend
  a half cell outside the grid. Nearest sampling uses the containing cell
  and its background if that cell is absent.
- On write, bricks are sorted by Z, Y, then X. Consecutive active samples
  are joined into runs. Background values and empty bricks are dropped.
  A document can contain up to 131,072 bricks and 2 million stored scalar
  components.

## Headless operations

```sh
node examples/sparse-volume-ember-vent.cjs ember-vent
node cli/ink-studio.js volume inspect ember-vent/combined.json
node cli/ink-studio.js volume sample ember-vent/resampled.json ember-vent/flow-samples.json
node cli/ink-studio.js volume combine ember-vent/west.json ember-vent/east.json ember-vent/combine.json --out combined.json
node cli/ink-studio.js volume resample ember-vent/combined.json ember-vent/resample.json --out resampled.json
node cli/ink-studio.js volume export ember-vent/resampled.json ember-vent/shell-export.json --out shell.json
```

`inspect` reports logical cells, stored components, field ranges including
background where present, and inclusive active index bounds. The bounds
are null for a completely empty field. `sample` takes a request with
`points` in world space and optional `channels` and `filter`
(`linear` by default, or `nearest`).

`combine` expects aligned grids with the same origin, spacing, size,
and brick size. Shared fields must have matching units. A field present
in one input carries over. Supply an optional `operations` map with
one operator per shared field, a `mix` fraction for lerp (default 0.5),
and `maxSamples` to cap visits to the union of stored sites per field.
Each operator also combines the two background values.

| Field | Operators | Default |
| --- | --- | --- |
| Density | `min`, `max`, `add`, `multiply`, `lerp` | `max` |
| Temperature | `min`, `max`, `add`, `lerp` | `lerp` |
| Velocity | `add`, `lerp` per component | `lerp` |
| Signed distance | `union` (min), `intersect` (max), `subtract` (max of left and negated right) | `union` |

`resample` takes a target `grid`, optional `channels`, `brickSize`,
`filter`, and `maxCells`. To crop or rebrick, keep the same spacing and
choose a new origin, size, or brick size. Velocity components retain their
world units. Signed-distance Boolean and interpolated samples are usable
as level sets. Their magnitudes need reinitialization before use as exact
distance estimates. Lower-resolution sampling can miss detail smaller
than a target cell.

Export requests choose a `kind` and field options.

- `sparse` writes a native volume, optionally limited to `channels`.
- `dense` writes the `ink-studio/dense-volume` version 1 format.
  It uses the same `grid`, `brickSize`, and `fields`, with a
  `values` object containing one flat, X-fastest array per field in
  place of `bricks`. Velocity is interleaved XYZ. Optionally set
  `channels` and `maxCells`. Use `volume pack` to load this data
  back into the sparse format.
- `slice` writes sample values and the associated world-space frame
  and range. Supply a `channel`, optional `filter`, `plane` (for
  example `{"axis":"z","at":0}`), and `counts` of columns and rows.
  Select the velocity `component` as `x`, `y`, `z`, or `magnitude`.
- `isosurface` writes indexed triangle geometry for a field level.
  Supply `channel`, optional `filter`, velocity `component`,
  `level`, `inside`, `resolution`, `maxCells`, `maxTriangles`,
  or `edgeRefinements`. Signed distance defaults to zero with inside
  below the level. Density defaults to 0.5 with inside above the level.
  The receipt records the actual sampling grid and triangle count.

Packing, baking, resampling, and dense export default to 250,000 cells
and allow up to 1 million. Dense exchange also caps scalar components at
4 million. Slice and isosurface generation use Ink's bounded field-view
sampling. The CLI accepts `--out` for results and `--report` for operation
receipts on `pack`, `combine`, `resample`, and `export`.

## Native field adapters

`KIT.procedural.sparseVolume.bake(options, sample)` samples an existing
bounded field. The callback receives the channel name, world-space
cell center, and dense cell index. Return the field background for
unoccupied cells. `sampler(volume).field(name)` adapts an exported field
for Ink's slices, streamlines, or isosurfaces. Use `sampler(volume).density()`
to attach density with a zero background to native atmosphere rendering.
The adapter frames occupied bricks with enough padding for interpolation.

```js
const { KIT: K } = require('..').load();
const V = K.procedural.sparseVolume;
const { document } = V.bake({
  grid: { origin: [-2, -2, -2], spacing: [.125, .125, .125], size: [32, 32, 32] },
  fields: { signedDistance: { background: .5, units: 'world' } }
}, (_, point) => Math.min(.5, Math.hypot(...point) - 1));
const field = V.sampler(document).field('signedDistance');
const slice = K.fieldViews.slice(field, { plane: { axis: 'z', at: 0 } });
```
