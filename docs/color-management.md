# Color management

Add `colorManagement` to a headless graph project or a physical reference render plan. An editable material graph stores the same settings under `settings.colorManagement`. Ink opens the named OCIO config with its CPU processor and records the resolved working space, display, view, processor IDs, and hashes of the config and LUT files. [OpenColorIO display processing](https://opencolorio.readthedocs.io/en/v2.5.0/guides/developing/developing.html)

Managed processing uses Python with OpenColorIO and NumPy. Little CMS 2 is used for embedded ICC profiles. For the ACES example, install OpenColorIO 2.5 or later and set the executable if it differs from `python3`.

```sh
python3 -m venv .venv-color
.venv-color/bin/python -m pip install "opencolorio>=2.5,<3" numpy
export INK_OCIO_PYTHON="$PWD/.venv-color/bin/python"
```

Set `INK_LCMS_LIBRARY` to the library’s path if the OS cannot locate it. The offline HTML review opens directly in a browser without these dependencies.

## Set the project view

```json
{
  "config": "looks/config.ocio",
  "working": "ACEScg",
  "inkLinear": "Linear Rec.709 (sRGB)",
  "display": "sRGB - Display",
  "view": "ACES 2.0 - SDR 100 nits (Rec.709)",
  "displayEncoding": "srgb",
  "sources": {
    "srgb": "sRGB Encoded Rec.709 (sRGB)",
    "srgb-linear": "Linear Rec.709 (sRGB)",
    "display-p3": "sRGB Encoded P3-D65",
    "rec2100-pq": "Rec.2100-PQ - Display",
    "acescg": "ACEScg"
  },
  "defaultInput": "sRGB Encoded Rec.709 (sRGB)",
  "whiteNits": 100
}
```

Config paths resolve relative to the project. Named `context` values can select OCIO LUT directories or shot looks. Omit `working` to use the config’s `scene_linear` role. Omit `display` and `view` to use config defaults. Declare what the selected display processor actually produces in `displayEncoding`. Supported delivery encodings are `srgb`, `display-p3`, `rec2100-pq`, and `rec2100-hlg`. `inkLinear` identifies the config’s linear Rec.709 space so Ink can bridge between material operations and the designated working space.

The working EXR is full-float and retains values outside [0, 1]. It records chromaticities, the named OCIO working space, and optional `whiteNits` as OpenEXR `whiteLuminance`. Ink recognizes canonical ACES and common linear RGB primaries. Supply `workingChromaticities` for a custom working space as eight numbers in red, green, blue, white x/y order. `whiteNits` describes the linear exposure reference independently of peak display luminance. [OpenEXR standard attributes](https://openexr.com/en/latest/StandardAttributes.html)

## Interpret a resource

In a managed graph, a color bitmap can use one of these policies through `interpretation.ocio`.

| Mode | Behavior |
|---|---|
| `auto` | Uses PNG cICP, embedded ICC, known primaries and transfer, or an EXR working-space tag. Uses explicit `defaultInput` for files without color tags. |
| `space` | Assigns the given `space` from the config to the existing sample values. |
| `icc` | Requires the resource’s embedded ICC and converts with Little CMS. |

Use `intent` in the OCIO interpretation to choose an ICC rendering intent numbered 0–3. The default is relative colorimetric. ICC pixels are converted through float linear Rec.709, then through the OCIO working space. Source tags and profile hashes remain available in the bitmap report. RGB is converted separately from alpha, and premultiplied inputs are unassociated first. Height, mask, data and normal resources follow their raw numeric contracts.

Map known input encoding IDs to config colorspaces in `sources`. The supported IDs include `srgb`, `srgb-linear`, `display-p3`, `display-p3-linear`, `rec2020-linear`, `rec2100-pq`, `rec2100-hlg`, `acescg`, and `aces2065`. Use a direct assignment for an unrecognized encoding. Untagged EXR and PFM use the linear Rec.709 source mapping. Managed graph assets are handed to existing Ink material nodes as straight, floating-point linear Rec.709. The review and physical-reference outputs can also export the designated working space directly.

## Resolve the palette after viewing

1. Feed a typed scene-linear color image into `color.paletteInput`. It converts from the Ink carrier to the configured working space and applies exposure and the view.
2. Feed the node’s `value` into `palette.resolve`. The input is straight sRGB bytes on the same art grid. A P3 proof is converted to sRGB at this boundary and the report counts components outside the palette input gamut.
3. For an HDR display, add `paletteView: { "display": "...", "view": "...", "encoding": "srgb" }`. The preview and palette use that SDR proof. The HDR delivery keeps its HDR transfer and PNG cICP tags. A review plan can add authored `mastering` and `lightLevels` values in nits for mDCV and cLLI. [PNG color and HDR metadata](https://www.w3.org/TR/png-3/)

In a managed physical reference, the progress, raw and denoised PNG previews use the selected proof. Separate files hold the managed display encoding, unclipped working EXR and native linear EXR. Change the proof with zero additional samples and the same accumulation file. Managed processing runs in the headless graph and offline reference paths. Chrome or another browser can review the rendered output without running OCIO.

## After the tide demo

```sh
node examples/color-management/demo.cjs /tmp/ink-color
ink-studio color-management /tmp/ink-color/color-review.json --out /tmp/ink-color-proof
```

Review the original art grid with ACES SDR, a direct SDR view, P3, and ACES HDR PQ. Use the split to compare the continuous proof and the palette render. Probe the beacon core to see the working value versus display, proof, and final swatch. The editable enamel graph shows the same tagged PNG interpreted by its embedded ICC and by an explicit source assignment.
