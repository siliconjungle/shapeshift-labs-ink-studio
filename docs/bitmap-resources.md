# Bitmap resources

Use a material resource with `format: "bitmap"` to keep an image's source, encoding, interpretation and sampling behavior in the material. Graph projects can declare the same resources in `assets`. A `bitmapAsset` node samples by resource name. It returns a typed image and an `info` record with the requested and resolved frame or tile and a `ready`, `held`, or `blank` status. A literal resource name provides its specific color, unitless grayscale, height, or normal port type. A varying resource name provides `typedImage`.

## Choose the source and interpretation

A linked member uses `{ "file": "textures/plate.png" }`. Paths resolve relative to the project or material. An embedded member uses `{ "encoding": "png", "base64": "…" }` and can carry an `origin` path for later reimport. Saving the material elsewhere rebases linked paths and reimport origins. An embedded image renders on its stored bytes and opens offline. Live graph runners keep the file snapshot they opened. Reopen or rebuild the runner after a reimport. The graph identity includes the ordered member digests and missing states.

```json
{
  "format": "bitmap",
  "source": { "file": "textures/enamel.png" },
  "interpretation": {
    "intent": "color",
    "colorSpace": "display-p3",
    "alpha": "straight",
    "sampling": "linear",
    "tiling": { "u": "wrap", "v": "clamp" }
  }
}
```

Color inputs use RGBA. Set `colorSpace` to sRGB, linear sRGB, Display P3, or linear Display P3 with the tags `srgb`, `srgb-linear`, `display-p3`, and `display-p3-linear`. The assignment describes the original samples. Use `image.convert` for a conversion, or `image.toDisplay` for an 8-bit sRGB preview. PNG defaults to sRGB and the explicit tag takes precedence over the input file's profile metadata. For `data`, `mask`, or `height`, select `r`, `g`, `b`, or `a` with `channel` (default `r`). Scalar resources use no color space. Use `intent: "data", layout: "xyz"` for signed direction vectors. Ink decodes integer RGB into signed XYZ floats and preserves float XYZ values. The midpoint integer code decodes to zero. Height has floating samples and optional physical `units`. An optional `heightRange: [min, max]` decodes normalized samples as `min + sample * (max - min)` before pixel edits or graph evaluation. A scalar `data` resource supports the same decoding through `valueRange: [min, max]` and can declare its own `units`. Set `intent: "normal"` for an RGB normal map. Set `normalSpace` to `tangent` (default) or `world`. Tangent maps accept `normalOrientation` of `opengl` (default) or `directx`. Ink keeps its XYZ lanes and precision without applying a color profile.

Ink keeps 8-bit and 16-bit PNG samples, reads classic TIFF and flat scanline OpenEXR, and reads 32-bit grayscale or RGB Portable FloatMaps. Set a TIFF source's zero-based `page` for multi-page files, or an EXR source's `channels` to select one to four named planes in the requested order. The selected member exposes supported file color metadata as `info.profile`. See [material texture file formats](material-texture-formats.md) for the native layouts and deliveries. PFM defaults to linear sRGB, applies the file's scale, reads either endianness, and preserves signed HDR samples. Set `rowOrder: "top-down"` on the source for files authored in that order. [Portable FloatMap specification](https://www.pauldebevec.com/Research/HDR/PFM/)

## Define a sequence or tile set

Use one of `source`, `sequence`, or `tiles`. A resource can contain up to 512 members. Members in a resource share dimensions and interpreted image contract.

| Layout | Fields and selection |
| --- | --- |
| Single | `source` is a linked or embedded member. |
| Sequence | `sequence` takes `frames`, `fps`, an optional first frame number `first` (default 0), and `playback` of `clamp` (default), `loop`, or `pingpong`. Put `null` in an authored gap. The node samples by graph time when `frame` is `-1`, or maps the requested frame number through playback. |
| Tiles | `tiles` contains rows such as `{ "udim": 1002, "source": { "file": "stone.1002.png" } }`. Use signed integer `uv` pairs for explicitly addressed tiles. UDIM 1001 maps to `[0,0]`, 1002 maps to `[1,0]`, and 1011 maps to `[0,1]`. The node's `tile` input chooses one tile. The interpretation's U/V addressing applies inside that texture. |

Set `missing.policy` to `error` (default), `blank`, or `hold`. Error fails at the missing selection. Blank returns transparent RGBA, a neutral tangent normal, or a zero-filled scalar image at the shared extent and precision. For fully offline resources use `{ "policy": "blank", "width": 64, "height": 64, "precision": "unorm16" }` to supply the blank contract. Hold applies to sequences and resolves to the nearest earlier numbered available frame or the first available frame for a gap at the start. Corrupt files produce an error.

## Edit without rewiring

`ink.describeMaterialBitmap(document, id, { baseDir })` reports native dimensions, interpretation, linked and embedded status, availability and source hashes. `ink.editMaterialBitmap(document, request, { baseDir })` returns a fresh `document` and a `bitmap` report. Resource IDs and graph link IDs survive edits. Save the returned document with `ink.writeMaterialGraph`.

| Request `kind` | Fields in addition to `id` |
| --- | --- |
| `link` | Provide the whole bitmap `definition` and optional `label` under a new ID. |
| `embed` | Copy the selected linked bytes into the document and record their origin. |
| `reimport` | Reload a link from its path or refresh embedded bytes from their saved origin. Keep pixel edits. |
| `edit` | Set interpretation, missing policy, playback, or label. Supply `pixels` to replace one member's pixel overlay. |
| `replace` | Supply a new `member` for the selected entry under the same ID. Add pixel edits to the new member if needed. |

For a sequence specify its exact `frame`. For a tile set specify its exact `tile` coordinates. The pixel overlay uses top-left integer `x` and `y` and a `value` array of four RGBA lanes, three normal lanes, or one scalar. Specify UNORM edits in [0,1] and floating edits in the interpreted units. Use `pixels: []` to clear the overlay. Source files retain their original bytes.

```sh
ink-studio graph material-bitmap glass.material.json lantern
ink-studio graph material-bitmap glass.material.json edit.json --out edited.material.json
ink-studio graph run edited.material.json
node examples/bitmap-resources/demo.cjs
```

The Switchyard Glass demo lets you scrub a 16-bit PNG sequence, select UDIM tiles, inspect floating-point radiance, paint a texel, reimport or replace a file, and download the edited material with its available sources embedded.
