# Typed material transforms and addressing

These nodes place and resample typed material images. The output keeps the source port type, channel layout, units, sample precision, alpha convention, and color space. Connect the same options to aligned material maps to apply matching spatial edits.

| Node | Geometry options |
| --- | --- |
| `image.transform` | A forward 2 × 3 row-major `matrix`, scalar or XY `scale`, clockwise `rotation` in degrees, `pivot` and XY `offset`. Starting at a source point, subtract the pivot, apply the affine matrix, scale, rotate, then add the pivot and offset. Defaults are identity and the source raster pivot or canvas center. |
| `image.crop` | A source `rect: [x, y, width, height]` measured from texture edges. By default the output dimensions are the rectangle's dimensions in source pixels rounded to the nearest positive integer. The rectangle may extend beyond the source. |
| `image.symmetry` | Fold `axis: "x", "y", "both"` around normalized XY `pivot` (default `[.5,.5]`). Use `side: "low"` to keep the left or top, or `"high"` to keep the right or bottom. |
| `image.polar` | Use `mode: "toPolar"` to unwrap a Cartesian disk to a strip with angle along U and radius along V. `"fromPolar"` maps that strip back to a disk and clears pixels outside it. `center` defaults to `[.5,.5]`, and `radius` defaults to `.5` of the shorter Cartesian axis. Zero angle points right and increases clockwise. `rotation` in degrees sets the start angle. |
| `image.perspective` | Pin the source to four convex destination `corners` in top-left, top-right, bottom-right, bottom-left order. The default fills the canvas. `clip` defaults to true and clears pixels outside the quad. Set it to false to sample the extended projective plane. |

Affine and crop coordinates default to `units: "pixels"` in the source-sized plane. Use `"normalized"` for [0,1] across each axis. Pixel-space rotation preserves distances measured in source texels. Perspective corners default to normalized destination coordinates and also accept pixels. In all cases Y increases downward and texel centers are at half-integers in pixel coordinates.

All five nodes accept `width` and `height`. Changing the extent samples the same canvas at a different resolution. Physical pixel pitch scales with the portion of the canvas represented by each output texel. The output raster pivot stays attached to the canvas and moves with the grid when cropped or resized. Affine option `pivot` is the center of the content transform.

## Filter, mip and border

- `filter: "nearest"` or `"linear"` chooses a single texel or a bilinear read within each level. Omit it to inherit the source sampling policy. Nearest sampling at level zero copies stored sample codes exactly.
- `mip: "none"` (default) uses level zero. Numeric `mip` pins a level and blends adjacent levels at fractional values. `"nearest"` automatically chooses the closest level and `"linear"` blends levels automatically. Automatic modes estimate the local output-pixel footprint in source texels and accept `mipBias` in levels. The chain uses area averaging, includes odd edge texels, and goes down to 1 × 1.
- `border` accepts one mode or a per-axis override such as `{u: "wrap", v: "mirror"}`. Use `clamp` to extend edge texels, `wrap` to repeat, `mirror` for alternating reflected repeats, or `transparent` for zero-valued taps. Unspecified axes inherit source tiling. From-polar conversion defaults to wrapping U so a filtered angular strip has a continuous seam. The angular footprint also crosses that seam continuously.
- Filter and border overrides apply to input reads. The output keeps its source descriptor’s default sampling and tiling. A crop uses the original source boundaries for address and filter taps. Filtered color uses linear light with coverage-weighted color so hidden RGB does not bleed into edges. Zero is transparent for images with alpha and numerical zero for other maps.
- Normal and other vector maps are sampled component by component. The transform changes their placement. Their components remain in the source basis, so a tangent-space normal map rotated with a texture may need a matching vector transform or regeneration from the transformed height.

## Night Transit demo

```sh
node examples/typed-image-transforms/demo.cjs /tmp/ink-night-transit
ink-studio graph run /tmp/ink-night-transit/night-transit.material.json --out /tmp/ink-night-transit/replay
```

Open `index.html` to compare level-zero sampling against mip filtering on a slanted tile panel. Switch to affine, crop, symmetry, or either polar direction and try distinct U and V addressing.
