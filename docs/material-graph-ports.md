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
