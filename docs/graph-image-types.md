# Image types in graphs

A typed image carries a versioned contract beside its sample buffer. Declare it at a legacy raster or asset boundary with `image.declare`. Use `image.inspect` or `ink-studio graph inspect` to read the contract. Exposing an input or group port as `typedImage`, `colorImage`, `heightImage`, or `normalImage` keeps its contract on subsequent links.

| Field | Contract |
| --- | --- |
| Extent | Width and height in pixels with top-left origin. The optional pivot is in pixel-edge coordinates. |
| Intent and layout | Color `rgb` or `rgba`, normal `xyz` or `xyza`, single-channel height and masks, or one to four data channels. Samples are interleaved. |
| Precision | `unorm8`, `unorm16`, `float32`, or `float64`. Unsigned normalized storage holds integer code values. Height holds physical sample values in floating point. |
| Units and domain | Color and default data use `unitless`. A height declaration names its units explicitly. The contract records a unit, signed-unit, or finite sample domain. |
| Color space | `srgb`, `srgb-linear`, `display-p3`, or `display-p3-linear` for color. Non-color data uses `none`. |
| Alpha | `none`, `straight`, or `premultiplied`. Alpha uses the normalized unit domain. |
| Tiling and sampling | Independent U and V modes of `clamp`, `wrap`, `mirror`, or `transparent`. `image.resize` applies the declared `nearest` or `linear` filter. Linear filtering handles alpha in the declared sample space. |

`image.declare` takes a literal `descriptor` record with `intent` and any applicable settings from the table. Numeric arrays default to float64. Native buffer types infer their precision. Declaring a different color-space tag for a raster that already has one is an error. A JSON array can state an explicit storage precision. The declaration validates samples and packs them into that precision. Set `precision: "native"` on a PNG asset to retain 16-bit codes through `pngAsset` and declare the decoded channels. Export a typed image as graph JSON to preserve its contract and values for reopening.

## Make and convert uniform images

`image.uniform` fills the chosen width and height from a scalar or a tuple. Connect a `number` socket directly to the node to promote it to a one-channel image. The literal descriptor selects the result:

| Use | Value example | Descriptor |
| --- | --- | --- |
| Signed scalar in physical units | `-2.75` | `{"intent":"height","units":"art-px"}` |
| Grayscale with 16-bit codes | `0.375` | `{"intent":"data","precision":"unorm16"}` |
| Bounded grayscale mask | `0.375` | `{"intent":"mask","precision":"unorm8"}` |
| RGB | `[1,0.5,0.25]` | `{"intent":"color","precision":"unorm8"}` |
| RGBA | `[0.5,0.25,0.125,0.5]` | `{"intent":"color","layout":"rgba","precision":"unorm8"}` |
| HDR linear color | `[3.5,0.5,-0.125,0.75]` | `{"intent":"color","layout":"rgba","precision":"float32","colorSpace":"srgb-linear"}` |

Unsigned normalized (`unorm8` and `unorm16`) values are authored in `[0,1]` and rounded to the closest integer storage code. For example, `0.375` becomes `24576` at 16 bits. Float values keep their physical or linear-light magnitude to the precision requested. Choose a linear color space and float precision for HDR and negative RGB samples. Alpha stays within `[0,1]`. With a premultiplied descriptor, supply already associated RGB samples.

`image.convert` reads a typed image and takes a literal target `descriptor` with `intent` and any of `layout`, `precision`, `colorSpace`, or `alpha`. The converter keeps extent, pivot, units, addressing, sampling, pixel pitch, and material seed. Within the same intent, omitted layout and precision stay as they were. Color conversions also retain the source color space unless you choose another.

- Adding alpha supplies full coverage. Dropping partial coverage, including when extracting grayscale, requires `dropAlpha: true`. Color conversions can unassociate or premultiply RGB as requested.
- Turning RGB(A) into grayscale data or a mask uses linear sRGB luminance. Turning unitless grayscale into color replicates its linear value into all three channels. Use `image.toHeight` to make relief or change relief units.
- `outOfRange` defaults to `error` for a target that cannot hold the source range. Choose `clamp` to explicitly limit samples to the destination's bounded range. Float conversions in an unbounded domain keep signed and over-white values within the chosen float precision. Overflow is an error.

Run the Lantern Glass demo to make five image types from graph inputs, inspect their sample values, and compare HDR storage with an explicitly clamped preview.

```sh
node examples/uniform-graph-images/demo.cjs /tmp/ink-lantern-glass
ink-studio graph run /tmp/ink-lantern-glass/lantern-glass.material.json --out /tmp/ink-lantern-glass/replay
```

For compositing typed maps, see [Material image blend modes](material-image-blend.md). For routing channels and retaining sub-code math, see [Split, shuffle, and pack typed image channels](material-image-channels.md).

For levels, histograms, tonal edits and alpha-aware swatch masks, see [Typed material color corrections](material-color-corrections.md).

For editable handles, ramp pins and image-driven transfers, see [Material curves and gradients](material-curves-gradients.md).

For spatial filtering, signed detail and edge reconstruction, see [Typed material blur, sharpen, and antialias](material-image-filters.md).

For nearest seeds, tile seams and mask shapes, see [Typed material distance, edges, and morphology](material-image-morphology.md).

For matrix placement, crops, perspective and sampler controls, see [Typed material transforms and addressing](material-image-transforms.md).

For map-driven distortion, see [Typed material displacement filters](material-image-displacement.md).

For physical relief, tangent frames, and normal orientation, see [Typed height and normal filters](material-height-normal-filters.md).

For reusable region labels and seam-continuous UVs, see [Typed Flood Fill region maps](material-flood-region-maps.md).

For slope trails, seam repair, scan cleanup and height analysis, see [Advanced typed texture filters](material-advanced-texture-filters.md).

For seeded scalar image generation, per-axis periods and higher-dimensional slices, see [Named noise in material graphs](material-named-noise.md).

For reusable signed geometry, profiles, symbols and bevel bakes, see [Editable material shape library](material-shape-library.md).

For repeatable stamp grids, brick bonds, crops and course labels, see [Material Tile Generator](material-tile-generator.md).

For per-cell map controls, independent seeds and overlap ordering, see [Map-driven Tile Sampler](material-tile-sampler.md).

## Convert color to relief

The `fx.relight` height socket accepts typed height in `art-px` and existing uncolored scalar rasters. A connection from a known RGB source fails graph validation. For dynamically sourced images, the socket validates their value before relighting. Convert deliberately with `image.toHeight`.

```json
{
  "colored": {
    "op": "image.declare",
    "inputs": {
      "source": { "node": "paint" },
      "descriptor": { "intent": "color", "precision": "unorm8", "colorSpace": "srgb" }
    }
  },
  "relief": {
    "op": "image.toHeight",
    "inputs": { "source": { "node": "colored" }, "scale": 8, "offset": -1, "units": "art-px" }
  }
}
```

The converter uses linear-light luminance by default, with `r`, `g`, `b`, or `alpha` available as explicit choices. It converts the color to linear sRGB before looking up a color channel. Premultiplied inputs are unassociated first. The height result is `sample * scale + offset`. You can also use this node to convert an already typed scalar map to different units with an explicit scale. Typed relief is already in art pixels when it reaches `fx.relight`. Use the converter for height scaling in that workflow.

## Send images through materials and legacy nodes

`material.pack` and `material.replace` accept contracted maps with matching intents. Use `material.image` to recover a contracted map and its independent material metadata. `material.channel` still extracts maps stored in the original raster format.

Use `image.toDisplay` for straight-alpha sRGB8 export. Use `image.toRaster` to hand raw samples explicitly to legacy raster operations. Those operations interpret the samples according to their own settings. Existing untyped graphs and raster operations keep their established layouts.

## Tideglass Gate demo

```sh
node examples/graph-image-types/demo.cjs /tmp/ink-tideglass
ink-studio graph run /tmp/ink-tideglass/tideglass.material.json --out /tmp/ink-tideglass/replay
```

The demo validates the rejected RGB connection, explicitly converts the RGB plate into a height map, and relights the panel. It exports the original image, height preview, lit panel, and full height contract.
