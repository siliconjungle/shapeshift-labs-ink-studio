# Shared material base settings

Save one `settings.base` record on an editable material graph. It configures the graph's raster generators and material image exports through the same resolver.

| Setting | Meaning |
| --- | --- |
| `size.width`, `size.height`, `size.lock` | Independent integer dimensions in pixels. Lock makes the resolved height match width. The saved independent height is available again when unlocked. |
| `output.format`, `output.bitDepth` | PNG at 8 or 16 bits per channel, or typed image JSON. JSON carries the original sample precision and contract. |
| `pixelSizeMm` | The physical width of one pixel in millimeters. |
| `pixelRatio` | The physical width-to-height ratio of one pixel, given as positive integer `[x, y]`. |
| `tiling.u`, `tiling.v` | Independent address modes `wrap`, `mirror`, `clamp`, or `transparent`. |
| `seed` | The shared random seed. A run can override it with `--seed`. |

The default is 256 × 256 pixels, unlocked, PNG8, 1 mm per pixel, square pixels, wrap on both axes, and seed 0. If the document already has a graph seed, that value supplies the default. Physical height per pixel is `pixelSizeMm × y / x`. PNGs write both axes as pixels per meter in the `pHYs` chunk.

```json
{
  "size": { "width": 124, "height": 84, "lock": false },
  "output": { "format": "png", "bitDepth": 16 },
  "pixelSizeMm": 0.7,
  "pixelRatio": [5, 4],
  "tiling": { "u": "wrap", "v": "mirror" },
  "seed": 17
}
```

## Use the settings in a graph

Declaring `settings.base` exposes the read-only root graph input `materialBase`. Connect it to `material.base.settings`. Its width and height ports drive dimensional nodes such as `raster.canvas`. Its `samples` output configures `proc.sample` with the physical extent of the image, in millimeters. The resolved record can also be passed into reusable groups through ordinary links.

Connect the record to `material.imageOutput.settings` to fit a typed image to the shared dimensions and address modes, and to attach its physical pixel pitch. The node preserves the source sampling filter. Declare an export with `"format": "material-image"` to apply the same fitting and use the shared delivery format. Explicit PNG and JSON exports continue to use their own rules.

PNG delivers straight-alpha sRGB for color, normalized scalar or data samples, and encoded normals. Use material JSON for signed physical height, non-color HDR data, two-channel layouts, and the full typed contract. PNG bit depth controls storage precision. Existing quantized source data keeps its original detail.

## Ferry glaze demo

```sh
node examples/material-base-settings/demo.cjs /tmp/ink-ferry
ink-studio graph plan /tmp/ink-ferry/locked.material.json
ink-studio graph run /tmp/ink-ferry/locked.material.json --out /tmp/ink-ferry/roundtrip
```

Open `demo.html` in the demo directory to use the live controls. The preview evaluates the same recipe in the browser. Save the chosen settings with **Download settings**, then apply that JSON to the editable project to deliver files with the chosen precision.

```sh
ink-studio graph material /tmp/ink-ferry/wide.material.json --base ferry-glaze-settings.json --out /tmp/ink-ferry/custom.material.json
ink-studio graph run /tmp/ink-ferry/custom.material.json --out /tmp/ink-ferry/custom
```

Use `ink.resolveMaterialBaseSettings` to normalize these values in Node. The browser toolkit exposes the same resolver as `KIT.procedural.materialBase.resolve`.
