# Material texture file formats

Use a native texture delivery when another application will edit or consume the material. Ink can reopen the file and report its stored bit depth, alpha association, color metadata, and available layers or channels.

| Format | Supported delivery | Preserved information |
| --- | --- | --- |
| PNG | 8- or 16-bit unsigned samples, grayscale or RGB with optional alpha | Straight alpha, ICC profile, standard sRGB or gamma and chromaticity tags |
| TIFF | Classic TIFF, grayscale or RGB with an optional extra sample. 8- or 16-bit unsigned or 32-bit float. Raw or ZIP strips on write | ICC profile or chromaticities, straight or associated alpha, or an independent data lane |
| OpenEXR | Flat, single-part scanline images, half or float. Raw, ZIPS, or ZIP | Linear RGB chromaticities, signed or HDR samples, named data planes and alpha |
| PSD | 8- or 16-bit RGB raster layers. Raw or ZIP | Unicode layer names, layer alpha, layer masks, named document masks, ICC, layer order, visibility, opacity, and normal, multiply or screen blending |
| PFM | Single grayscale or RGB image, 32-bit float | Signed and HDR samples |

PNG and PSD use straight layer or image samples. EXR stores its alpha association in the `inkAlphaAssociation` attribute. External compositors conventionally expect associated EXR RGB. Convert to premultiplied in the graph for those deliveries. PSD layers retain their straight RGB and alpha planes. Photoshop's flattened compatibility image uses white-matted RGB with a separate transparency plane. [PNG specification](https://www.w3.org/TR/png-3/) · [OpenEXR file layout](https://openexr.com/en/latest/OpenEXRFileLayout.html) · [Photoshop file formats](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)

TIFF input also accepts endian variants, planar or interleaved strips and tiles, and LZW, PackBits, or Deflate for the supported sample layouts. For a multi-page TIFF choose a zero-based `page`. PSD reopen checks the supported raster subset. Use PNG, TIFF, EXR or PFM for graph bitmap resources. [LibTIFF format coverage](https://libtiff.gitlab.io/libtiff/specification/coverage.html)

## Write an export

Add a named export to the graph. The destination extension follows `encoding`.

```json
{
  "pigment": {
    "output": "profiledColor",
    "format": "texture",
    "options": { "encoding": "png", "bitDepth": 16 }
  },
  "master": {
    "output": "surfaceMaps",
    "format": "texture",
    "options": { "encoding": "exr", "bitDepth": 32, "compression": "zip" }
  }
}
```

A texture accepts a [typed image](graph-image-types.md) or a record with `image` and `profile`. Integer deliveries require normalized samples. Use floating-point TIFF, EXR, or PFM for physical height. Store material units in the graph and set them again on reimport. Half EXR rounds to the file's 16-bit floating-point representation.

A material packet can go directly to EXR if its typed maps share the same extent. Base color becomes `R`, `G`, `B`, and optionally `A`. Scalar maps use their stable map names. Normal and flow planes use names such as `normal.X` and `flow.U`. To deliver individual maps by usage, select TIFF, EXR, or PFM in [material output usages](material-graph-ports.md#publish-material-output-usages).

A linked or embedded [bitmap resource](bitmap-resources.md) exposes a present color profile in `info.profile`. Use `data.get` followed by `data.record` to attach it to an image that still uses that encoding. Ink carries ICC bytes in PNG, TIFF, and PSD. Assign the source color interpretation and use `image.convert` to convert between Ink's supported color spaces before attaching the matching profile. EXR output uses known linear primaries or explicitly supplied chromaticities.

To write a PSD, supply a record with `width`, `height`, and a top-to-bottom `layers` array. Each row has `name`, a typed RGB(A) `image`, and optional `x`, `y`, `opacity`, `visible`, `blend`, and scalar `mask`. Keep layers inside the canvas and their masks at the layer extent. Optional `masks` is a record of named canvas-sized grayscale maps. Optional `profile` specifies the ICC profile for the full stack. Supply `composite` for an approved flattened preview or let Ink composite the raster stack.

## Reopen a delivery

```sh
ink-studio graph texture-info out/artifacts/pigment.png
ink-studio graph texture-info out/artifacts/master.exr --channels height,mask.glaze
ink-studio graph texture-info plate.tiff --page 1
node examples/texture-formats/demo.cjs /tmp/ink-glaze
```

In Node, `readTexture(fileOrBytes, options)` returns the decoded native samples. `reportTexture(fileOrBytes, options)` returns a compact report with an ICC hash where present. `encodeTexture(value, options)` takes the same inputs and settings as the graph export.

Open Glaze Archive's generated `index.html` to inspect the reopened pigment, PSD layers, named masks, and signed relief. The demo includes the editable material and its exported files.
