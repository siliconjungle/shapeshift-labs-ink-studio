# Typed material color corrections

Use these nodes on typed RGB(A) images. The tonal nodes also accept single-channel data, mask, or height images. Existing byte-raster color nodes keep their graph contracts.

| Node | Controls |
| --- | --- |
| `image.levels` | `inputRange` and `outputRange` set black and white. Values outside the input interval reach an endpoint. The normalized curve uses the exponent `1 / gamma`. |
| `image.autoLevels` | `percentiles` and a measurement `channel` fit a linked input range. `gamma` and `outputRange` control the remap. The `report` includes fitted bounds, sample count, and the flat-image flag. |
| `image.histogram` | Select a `channel`, `bins` (2–4096), and `range`. Get counts per bin, below and above range, and observed extrema. |
| `image.histogramAdjust` | Use `equalize`, `range`, `shift`, `scan`, or `select` on decoded RGB or scalar values. |
| `image.hsl` / `image.hsv` | Rotate hue by `degrees` and scale `saturation`. HSL adds a `lightness` offset. HSV multiplies by `valueFactor`. |
| `image.exposure` | Apply `stops` as a factor of `2 ** stops` in linear light for color, or directly for scalar data. |
| `image.contrast` | Multiply the distance from `pivot` by `factor` in the source’s decoded sample space. |
| `image.threshold` | Produce a mask for samples at or above `level` on a chosen `channel`. `softness` feathers the transition below the threshold. |
| `image.invert` | Reflect decoded samples around `pivot`. |
| `image.posterize` | Choose `steps` across a finite `range`, or assign RGB to the nearest swatch in an ordered `palette`. |
| `image.colorSelect` | Produce a typed mask around a target `color`. Adjust the distance `metric`, `tolerance`, and `softness`. |
| `image.colorReplace` | Blend a matching `from` swatch toward `to` with the same selection controls and an `amount` in the unit interval. |

## Working values, precision, and coverage

Tonal operations use decoded samples and preserve the source texture’s precision, space, layout, units, and alignment. Use `options.precision` to choose a different destination precision, such as float64 before a chain of adjustments. Bounded destinations clamp by default. Set `outOfRange: "error"` to surface clipping. Linear floating color keeps signed and over-white values unless the correction sets its own range.

RGB adjustments unassociate premultiplied samples, grade RGB, then store the result with its original alpha association. Unchanged texels keep their original codes when output precision stays the same. Alpha coverage remains unchanged to the chosen output precision. Threshold and color selection deliver a float64 mask by default. They multiply selection by source alpha unless `useAlpha: false`; `invert` complements the selection before that gate.

Hue operations work in the display encoding for the source’s primaries and convert the result back to the original space. When an adjustment is active, out-of-range HSL or HSV input is rejected unless `inputRange: "clamp"` is selected.

Swatches use finite numeric RGB triples in the source’s decoded space, or hex strings and packed integers in display sRGB. Selection can measure decoded RGB distance, OKLab distance (`perceptual`), or distance in the two OKLab chromatic axes (`chroma`). Feathering starts outside the requested tolerance.

## Histogram and auto levels

Use `luminance` for linear Rec. 709 luminance, `r`, `g`, or `b` for an individual decoded color channel, `alpha` for coverage, or `all` to pool color channels. Scalar images can be measured as `value`, `luminance`, or `all`. Histogram and auto levels exclude fully transparent pixels by default. Histograms can opt into counting them with `includeTransparent`.

Auto levels uses the exact sorted values with linear interpolation between percentile ranks. It applies one fitted curve across all color channels. Flat or fully transparent sources retain their values. The exact-percentile budget is 16,777,216 measured samples. Use `percentiles: [0,1]` to fit extrema without sorting larger images.

Equalization uses a linked cumulative histogram over the selected range and interpolates between bin centers. Samples outside that range remain unchanged. Range mode maps the input interval into a band centered at `position` with width `span`. Shift wraps by `offset` inside the input interval. Scan feathers a lower cutoff at `position`. Select feathers the edges of a band centered at `position` with width `span`.

## Prism Study demo

```sh
node examples/typed-color-corrections/demo.cjs /tmp/ink-prism
ink-studio graph run /tmp/ink-prism/prism-study.material.json --out /tmp/ink-prism/replay
```

Open the generated `index.html` for a live before-and-after comparison, histogram, and editable settings. The default material and each selectable correction preset can be reopened in the graph runner.
