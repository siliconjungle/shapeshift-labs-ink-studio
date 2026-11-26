# Opacity and texture transfer

Bake color, opacity, or scalar data from one UV layout into another. Set the destination with the target's `uvSet` and tiles. A map override can read a linked image through a different `sourceUV`. Ink samples the original triangle's UVs at each destination texel, including faces clipped at destination tile boundaries.

## Choose the input

Use the receiver's authored glTF material or name a linked texture in the job. An authored material follows its original texture bindings. With a high-to-low projection, the existing cage supplies the hit material and keeps its projection diagnostics. Named textures use the receiver's source UVs.

```json
{
  "textureInputs": {
    "design": {"file": "acetate.png"},
    "edge-distance": {"tiles": [{"tile": 1001, "file": "edge-distance.1001.exr"}]}
  },
  "targets": [{"id": "panel", "mesh": "Acetate panels", "uvSet": 1}],
  "preset": "soft.preset.json"
}
```

Linked inputs accept still PNG, TIFF, or flat OpenEXR with up to four million texels per file. Paths are relative to the job file. A single image uses its selected address mode over the whole source UV range. For a tile set, the integer part of each source UV selects a UDIM or signed tile. Filtering and addressing apply within that tile. A missing sampled tile fails the job and leaves the previous bake revision available.

| Map | Data taken from a linked texture |
| --- | --- |
| `pigment`, `emission` | Color with straight output alpha. Grayscale sources expand to RGB. |
| `opacity` | A scalar in [0,1], from alpha by default. Set `sourceChannel: "r"` for a grayscale opacity map. |
| `roughness`, `metalness` | A scalar in [0,1], from red by default. Choose a packed channel with `sourceChannel`. |
| `texture-transfer` | A scalar from a required linked texture. Use float OpenEXR to preserve signed or HDR values such as relief or an edge distance. |

Scalar channels accept `r`, `g`, `b`, or `a`. Grayscale values serve the RGB channels and a source without alpha supplies an opaque alpha value. For color, `sourceColorSpace` can assign `srgb` or `srgb-linear`. Auto mode uses recognized tags, with untagged integer images treated as sRGB and untagged float images as linear sRGB. Convert sources with other primaries before transfer. Assign their interpretation explicitly when the file leaves it ambiguous.

## Set alpha, sampling, and precision

Use these fields in a map's overrides in the bake workstation or the preset JSON.

| Setting | Behavior |
| --- | --- |
| `sourceUV` | Source `TEXCOORD_n` for a linked texture, default 0. |
| `filter` | `linear` (default) or `nearest`. Color filtering uses linear associated RGB and delivers straight RGB. |
| `address` | `clamp` (default), `wrap`, or `mirror`. |
| `sourceAlpha` | Color input association, `auto` (file convention), `straight`, or `premultiplied`. |
| `alphaPolicy` | `preserve` (default), `ignore` to make the sampled surface opaque, or `cutout` to threshold it. |
| `alphaCutoff` | Threshold in [0,1], default 0.5. Applies to filtered alpha before output quantization. |
| `sourcePrecision` | `native` (detect without reducing precision), or require `unorm8`, `unorm16`, `float16`, or `float32`. |
| `encoding` | `png8`, `png16`, or `exr` (float32). Linked inputs default to PNG16. Existing authored-material presets with no overrides keep their original bake behavior. |

Alpha filtering keeps transparent source colors from bleeding into visible edges. An ignored straight alpha channel allows the stored RGB to show. A fully transparent premultiplied sample carries no recoverable RGB. Use `coverage` to see the geometric footprint separately from authored opacity. Active transfer maps leave empty areas at zero and extend existing values into the configured padding.

PNG color is sRGB. OpenEXR color is linear sRGB with straight alpha. Scalar data stays linear. PNG encodes [0,1] and reports clipped samples for out-of-range data. OpenEXR preserves float samples and includes a separate preview. A raw scalar whose range exceeds [0,1] is fitted for preview. Material-graph refresh binds the original output with its color or scalar interpretation.

```json
{
  "id": "opacity",
  "overrides": {
    "textureInput": "design",
    "sourceUV": 0,
    "sourceChannel": "a",
    "sourcePrecision": "unorm16",
    "alphaPolicy": "cutout",
    "alphaCutoff": 0.56,
    "encoding": "png16"
  }
}
```

## Mothlight Screen

```sh
node examples/bake-texture-transfer/demo.cjs mothlight-demo
ink-studio bake-job serve mothlight-demo/screen.bake.json --out mothlight-demo/live
```

Open `mothlight-demo/index.html` to compare the source artwork with its rotated UV islands and switch between soft opacity, thresholded opacity, geometric coverage, and the signed distance map. The demo links to the original output files.
