# Multi-channel material ports

Use the `materialChannels` socket type to pass named rasters through a graph or a reusable group. A material may have any subset of the standard channels and named masks. Each map carries its own dimensions and metadata, so a higher-resolution pigment map or a mask in a separate UV set can travel through the same port.

| Channel | Raster components |
| --- | --- |
| `baseColor`, `normal`, `emission` | Three or four |
| `height`, `roughness`, `metalness`, `ao`, `opacity` | One |
| `mask.<name>` | One |

The package keeps sample values as supplied. A signed height raster or float normal can pass beside byte pigment without quantization. Metadata is per-map JSON such as `{ "texCoord": 1, "unit": "world" }` or `{ "encoding": "rgb8", "space": "tangent" }`. Graph operations and carriers use the conventions they already expect. For maps with verified layouts, precision and sampling policies, use [typed images](graph-image-types.md#send-images-through-materials-and-legacy-nodes). Extract a grayscale channel from an RGBA source with `raster.channel` before packing scalar maps.

## Read and edit maps

- `material.pack` accepts a `maps` record of named rasters and an optional `metadata` record keyed by channel. Use `data.record` to collect node outputs into either input.
- `material.channel` exposes a named map as `value` and its metadata as `metadata`. A missing name is an error.
- `material.replace` uses the names supplied in `maps` as its write list. It can add a channel or replace its raster while keeping the old metadata. To also replace metadata, supply an entry for that channel. All other channel entries and sample buffers pass through by reference.

The version 1 value serializes as `{ format: "ink-studio/material-channels", version: 1, channels }`. Each entry of `channels` contains `raster` and `metadata`. Treat shared buffers as read-only and generate a new buffer for any map you edit. A package holds 1–64 maps. The packet can be exported as graph JSON. Use `material.channel` with standard graph exports for individual maps.

In code the corresponding Toolkit functions are `KIT.procedural.materialChannels.pack`, `KIT.procedural.materialChannels.channel`, and `KIT.procedural.materialChannels.replace`.

## Northstar seal demo

```sh
node examples/material-graph-ports/demo.cjs /tmp/ink-northstar
ink-studio graph run /tmp/ink-northstar/northstar.material.json --out /tmp/ink-northstar/rerun
```

The editable material graph changes base color and uses the inlay mask to lower roughness in the painted recess. Normal, height, metalness, AO, emission, opacity, and the mask pass through exactly. The sample script feeds the resulting maps into the existing UV mesh and Gaussian disc APIs and renders both finishes on each carrier. The output also includes the processed pigment PNG and the full package with all nine named maps.

## Publish material output usages

Use `settings.outputUsages` in an editable material graph or `outputUsages` in a native graph project. Each entry has a stable map ID, a usage, a display label, a nonnegative integer order, and a delivery format. Maps sort by order, then ID. The same ID selects the preview and names the delivery artifact. The run report records the delivered file and its hash alongside the map's usage and source. Set `export: false` to keep a map available for preview and packing without writing a separate file.

A `source` selects a typed image graph output. Add `channel` to select a typed map from a `materialChannels` output. Use built-in usages `baseColor`, `normal`, `height`, `roughness`, `metalness`, `ao`, `emission`, `opacity`, and `mask.<name>`. Use `custom.<name>` for another typed image that should keep its own contract. Match built-in map usages to their image intents and component counts. Unitless scalar usages require normalized samples.

Set `format` to `{"format":"png","bitDepth":8}`, `{"format":"png","bitDepth":16}`, or `{"format":"json"}`. PNG color delivery uses straight sRGB. PNG normal delivery encodes signed XYZ into normalized RGB. Data PNGs preserve linear samples. Use typed JSON for physical height, two-channel data, and unbounded values. Deliveries keep the supplied image extent. Use a graph resize or material fitting node to change it. PNG delivery writes pixel density when the typed image supplies physical pitch.

A `packed` usage declares every RGB channel and, optionally, alpha. Assign each channel one scalar map ID or one constant in the range [0, 1]. At least one map must supply the extent. All referenced maps need matching extent, pitch, pivot, tiling and sampling. The packer copies their scalar values directly and quantizes once at the chosen PNG precision. Treat a packed fourth channel as data, such as a mask, when loading it in downstream tools.

```json
{
  "shadow": {
    "usage": "ao", "label": "Ambient occlusion", "order": 10,
    "source": { "output": "surface", "channel": "ao" },
    "format": { "format": "png", "bitDepth": 8 }
  },
  "matte": {
    "usage": "roughness", "label": "Roughness", "order": 20,
    "source": { "output": "surface", "channel": "roughness" },
    "format": { "format": "png", "bitDepth": 16 }
  },
  "delivery": {
    "usage": "packed", "label": "Packed material data", "order": 30,
    "format": { "format": "png", "bitDepth": 16 },
    "packing": { "r": { "map": "shadow" }, "g": { "map": "matte" }, "b": { "value": 0 }, "a": { "value": 1 } }
  }
}
```

Use `graph inspect --map ID` or `project.inspect({ map: ID })` for a visual preview. The preview selects sRGB for color, encoded XYZ for normals, and grayscale for scalar maps. Height previews show the measured range and units. Packed RGB previews display the three channels with full coverage so a fourth data sample stays independent. Pass `--component r|g|b|a` to preview one assigned channel. Node preview watches also accept `{ map, component }`.

```sh
node examples/material-output-usages/demo.cjs /tmp/ink-lantern
ink-studio graph material /tmp/ink-lantern/lantern.material.json --output-usages /tmp/ink-lantern/maps.json --out /tmp/ink-lantern/edited.material.json
ink-studio graph inspect /tmp/ink-lantern/edited.material.json --map delivery --component a --out /tmp/ink-lantern/glass-review
ink-studio graph run /tmp/ink-lantern/edited.material.json --out /tmp/ink-lantern/delivery
```

Open `demo.html` from the demo directory to inspect each map and download the delivered texture. The demo verifies the 16-bit RGBA samples after decoding the actual packed PNG.
