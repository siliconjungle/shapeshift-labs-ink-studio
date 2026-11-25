# Image types in graphs

A typed image carries a versioned contract beside its sample buffer. Declare it at a legacy raster or asset boundary with `image.declare`. Use `image.inspect` or `ink-studio graph inspect` to read the contract. Exposing an input or group port as `typedImage`, `colorImage`, or `heightImage` keeps its contract on subsequent links.

| Field | Contract |
| --- | --- |
| Extent | Width and height in pixels with top-left origin. The optional pivot is in pixel-edge coordinates. |
| Intent and layout | Color `rgb` or `rgba`, normal `xyz` or `xyza`, single-channel height and masks, or one to four data channels. Samples are interleaved. |
| Precision | `unorm8`, `unorm16`, `float32`, or `float64`. Unsigned normalized storage holds integer code values. Height holds physical sample values in floating point. |
| Units and domain | Color and default data use `unitless`. A height declaration names its units explicitly. The contract records a unit, signed-unit, or finite sample domain. |
| Color space | `srgb`, `srgb-linear`, `display-p3`, or `display-p3-linear` for color. Non-color data uses `none`. |
| Alpha | `none`, `straight`, or `premultiplied`. Alpha uses the normalized unit domain. |
| Tiling and sampling | Independent U and V modes of `clamp`, `wrap`, `mirror`, or `transparent`. `image.resize` applies the declared `nearest` or `linear` filter. Linear filtering handles alpha in the declared sample space. |

`image.declare` takes a literal `descriptor` record with `intent` and any applicable settings from the table. Numeric arrays default to float64. Native buffer types infer their precision. Declaring a different color-space tag for a raster that already has one is an error. A JSON array can state an explicit storage precision. The declaration validates samples and packs them into that precision. Export a typed image as graph JSON to preserve its contract and values for reopening.

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
