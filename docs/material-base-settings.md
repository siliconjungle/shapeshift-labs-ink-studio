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

## Inherit individual settings

Save rules in `settings.inheritance` next to `settings.base`. Every setting can use its own mode. A setting without a rule uses `absolute`.

| Mode | Source |
| --- | --- |
| `absolute` | The value in `settings.base`, or its ordinary default. |
| `parent` | A named parent provider supplied by the host at execution time. Pass the parent material's effective `base` settings to inherit through multiple levels. |
| `primary` | The typed image on the named `settings.primaryInput` graph socket, including an instance's default or a run's input value. Hosts can instead supply a named primary settings provider. |

Inherited `size` accepts an optional positive `scale: [x, y]` and a boolean `lock` override. Width and height round to the nearest pixel with a minimum of one. The lock follows the source unless overridden. An active lock makes height equal width after scaling. `pixelSizeMm` accepts a positive scalar scale. `pixelRatio` accepts a positive integer scale pair. `seed` accepts an integer offset. `output` and `tiling` copy as complete settings.

A typed image supplies its extent, tiling, and precision. The output setting maps 8- and 16-bit unorm images to the corresponding PNG depth and floating-point images to typed JSON. Physical pixel size and ratio require pixel pitch metadata. A seed comes from the image's optional `materialSeed` descriptor field, which fitted material images preserve in the graph and typed JSON. A selected setting without a source value raises an error. As with absolute settings, `--seed` supplies an explicit override for the current run.

For example, these editable settings halve the chosen image's resolution while doubling its pixel pitch and taking delivery format from its parent.

```json
{
  "base": {},
  "primaryInput": "artwork",
  "inheritance": {
    "size": { "mode": "primary", "scale": [0.5, 0.5] },
    "pixelSizeMm": { "mode": "primary", "scale": 2 },
    "pixelRatio": { "mode": "primary" },
    "output": { "mode": "parent" }
  }
}
```

Use `{ "parent": { "id": "ceramics", "settings": { "output": { "format": "png", "bitDepth": 16 } } } }` as the context JSON. Supply it with `--base-context context.json` or the `baseContext` option of `ink.createGraphProject` and `ink.readGraphProject`. JSON graph inputs can be supplied separately with `--inputs inputs.json`. The plan, inspect, and run reports show `base` and `baseProvenance` with the effective setting, source, and any adjustment. Snapshots include these fields under `settings`.

Use `material.inherit` inside a graph to resolve settings for a branch or a reusable group. Connect an upstream typed image to its `primary` input, or pass provider records to `context`. Its `value` and `provenance` outputs carry the effective settings and their sources. For non-graph use, call `ink.resolveMaterialInheritance(base, rules, context)` or `KIT.procedural.materialBase.inherit`.

```sh
node examples/material-setting-inheritance/demo.cjs /tmp/ink-waypoint
ink-studio graph plan /tmp/ink-waypoint/waypoint.material.json --base-context /tmp/ink-waypoint/context.json --inputs /tmp/ink-waypoint/field.inputs.json
ink-studio graph run /tmp/ink-waypoint/waypoint.material.json --base-context /tmp/ink-waypoint/context.json --inputs /tmp/ink-waypoint/archive.inputs.json --out /tmp/ink-waypoint/roundtrip
```

Open `demo.html` from that directory to compare the two renders and inspect their effective settings.

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
