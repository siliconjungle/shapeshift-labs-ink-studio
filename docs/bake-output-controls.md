# Bake output controls

Use a bake map's overrides to choose its output dimensions, precision, edge treatment, and mip chain. Existing presets can keep their square `size`, `padding`, and map-specific `encoding`. The settings below opt a map into the rectangular output workflow.

| Field | Values |
| --- | --- |
| `width`, `height` | 8–1024 texels independently. An omitted axis uses the square `size`. |
| `format` | `png`, `tiff`, or `exr`. |
| `precision` | PNG supports `unorm8` and `unorm16`. TIFF also supports `float32`. OpenEXR supports `float16` and `float32`. |
| `antialiasing` | `1`, `2`, or `4` samples per axis. The default is one sample. |
| `padding` | Reserve 0–32 texels outside the sampled charts, below half the shorter axis. |
| `dilation` | Fill up to this many reserved texels from the chart, at most the padding. |
| `diffusion` | Apply 0–16 smoothing passes to filled gutters of continuous maps. |
| `gutters` | `copy` fills the assigned gutter. `transparent` preserves extended RGB with zero alpha and leaves opacity gutters at zero. `empty` reserves the gutter without writing values. |
| `mipmaps` | Number of additional levels, 0–10, or `full` through 1 × 1. |

Disk precision and sample precision are separate. Material color, opacity, normals, thickness, and other float-capable passes use float intermediates. Legacy geometry masks and projection diagnostics retain their native 8-bit samples when written to a wider format. The report records intermediate precision. Signed world and object positions need a float output. ID maps need float32 for exact integers. UV outlines use native PNG8 strokes and editable SVG paths. Coverage can be exported at other precisions with antialiased area values.

## Keep charts separate at seams

At a sample boundary, the chart with the most area supplies the output texel. Ties select the lower chart ID. Coverage records the occupied area even if that area comes from two different charts. Pigment and opacity alpha use the winning chart's area on supersampled output and mips. Color averages in linear light with alpha weighting. Normal vectors are renormalized. Roughness uses a root mean square. IDs choose a representative value from the winning chart. Thickness ignores invalid distance samples and retains a separate validity mask.

Dilation copies samples only into each chart's allotted padding. Diffusion smooths only its filled gutter with neighbors of the same owner. Sampled interior values and the geometric coverage mask stay intact. In a narrow gap the first chart to reach a free texel claims it. Guard regions stop at the UV tile boundary.

Mipmaps reduce each axis to half, rounded down with a minimum of one. Odd trailing texels participate in the reduction. Every level selects chart ownership before it filters, then rebuilds its own gutter. Each tile has an independent chain. The workstation can preview and download individual levels, and the report lists their dimensions and file hashes. Your material graph refresh uses the base map.

```json
{
  "id": "pigment",
  "overrides": {
    "width": 129,
    "height": 83,
    "format": "tiff",
    "precision": "unorm16",
    "antialiasing": 4,
    "padding": 6,
    "dilation": 5,
    "diffusion": 5,
    "gutters": "transparent",
    "mipmaps": "full"
  }
}
```

## Kiln & Tide demo

```sh
node examples/bake-output-controls/demo.cjs kiln-demo
ink-studio bake-job serve kiln-demo/finished.bake.json --out kiln-demo/live
```

Open `kiln-demo/index.html` to compare single-sample and supersampled enamel maps at the same dimensions. Toggle **Stored RGB and gutters** to see pigment beneath zero alpha. Change **Level** to inspect the seam at reduced resolutions. The normal map uses a separate grid and half-float OpenEXR encoding.
