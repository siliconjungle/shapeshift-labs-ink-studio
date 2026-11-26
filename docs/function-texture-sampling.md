# Texture sampling inside functions

Declare each texture as a named function input. Use `colorImage` for RGB or RGBA. Use `grayImage` for a single-channel, unitless data or mask image. Give each reader its own `vec2` UV. A function can read several textures and can sample one texture at several coordinates. The function returns a declared value, such as a number or linear color.

| Node | Source | Result |
| --- | --- | --- |
| `fn.sampleColor` | `colorImage` | Straight linear sRGB `[r,g,b,a]`. RGB sources have full coverage inside their extents. Filtering and mip blending weight linear color by coverage. |
| `fn.sampleGray` | `grayImage` | A number. Unsigned normalized samples decode to zero through one. Floating-point data keeps signed and over-one values. |

Build these images with the [typed material image nodes](graph-image-types.md). A general typed image link can feed a grayscale port when its actual contract is a unitless single channel. Convert RGB explicitly if the intended input is luminance.

## Sampling controls

| Socket | Default | Behavior |
| --- | --- | --- |
| `uv` | Required | Normalized top-left texture coordinates. U increases to the right and V increases down. Texel centers are at `[(x + 0.5) / width, (y + 0.5) / height]`. UVs can extend beyond the texture. |
| `wrapU`, `wrapV` | `image` | Inherit each axis from the image or choose `clamp`, `wrap`, `mirror`, or `transparent` independently. Transparent taps supply zero and zero coverage. |
| `filter` | `image` | Inherit the texel filter or choose `nearest` or `linear` within a mip level. |
| `mip` | `0` | Read the base texture or choose a higher level explicitly. Positive values clamp to the highest available level. |
| `mipFilter` | `linear` | Blend adjacent levels at fractional LOD. Choose `nearest` to round to one level. |

Point reads use the [same area-averaged mip levels](material-image-transforms.md#filter-mip-and-border) as the image transforms, including odd edge texels. A point read uses its numeric LOD because it has no pixel footprint. Ink builds only the levels needed and shares them across reads and repeated function calls within an evaluation, subject to the sampler's working memory budget.

## Call a sampling function

A small grayscale reader can be published with the existing [function graph workflow](reusable-function-graphs.md).

```json
{
  "result": "number",
  "inputs": { "item": "vec2", "mask": "grayImage", "lod": "number" },
  "nodes": {
    "read": {
      "op": "fn.sampleGray",
      "inputs": {
        "source": { "input": "mask" },
        "uv": { "input": "item" },
        "wrapU": "wrap",
        "wrapV": "mirror",
        "filter": "linear",
        "mip": { "input": "lod" }
      }
    }
  },
  "outputs": { "result": { "node": "read" } }
}
```

Use the function as a graph node for one sample. To repeat it over an array of UVs, pass the declared function to `array.map` and supply the UVs through `items`. The function's `item` receives each UV and its `result` becomes the corresponding output element. Texture inputs stay shared.

## Tideglass demo

```sh
node examples/function-texture-sampling/demo.cjs /tmp/ink-tideglass
ink-studio graph run /tmp/ink-tideglass/tideglass.material.json --out /tmp/ink-tideglass-run
ink-studio graph inspect /tmp/ink-tideglass/tideglass.material.json --node probe/stencilRead
```

Open `index.html` to inspect the two texture inputs and the sampled chart. Click the chart or type U and V. Offset the stencil independently, change an address mode, or move through fractional mip levels with both mip filters. Save your settings as an editable material graph.
