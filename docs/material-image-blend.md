# Material image blend modes

Use `image.blend` on typed color or scalar images. The byte-oriented `raster.blend` remains available for existing sprite and compositing graphs.

The table compares the 12 modes in the [Adobe Designer Blend mode reference](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/atomic-nodes/blend/blending-modes-description). The Ink expressions use decoded samples, with `B` for background and `F` for foreground. The fixtures verify Ink’s outputs against the documented operations. Adobe’s rendered pixels were not used as reference captures.

| Designer mode | Ink image mode | Ink byte mode | Ink mode operation before alpha, opacity, and range handling |
| --- | --- | --- | --- |
| Copy | `copy` | `normal` | `F`. |
| Add (Linear dodge) | `add` | `add` | `B + F`. The byte operation caps the sum at one. |
| Subtract | `subtract` | `subtract` | `B - F`. The byte operation floors the difference at zero. |
| Multiply | `multiply` | `multiply` | `B × F`. |
| Add Sub | `addSub` | — | `B + (F - 0.5)`. Ink uses half as the neutral point. |
| Max (Lighten) | `max` | `lighten` | The higher of the samples. |
| Min (Darken) | `min` | `darken` | The lower of the samples. |
| Switch | `switch` | — | The same texel result as Copy, including its opacity endpoints. Designer can skip computing an upstream branch at an endpoint. Ink’s graph evaluates both dependencies. |
| Divide | `divide` | — | `B / F`. With a bounded mode, nonzero divided by zero saturates and zero divided by zero is zero. With no clamp, nonzero divided by zero is an error. |
| Overlay | `overlay` | `overlay` | Doubled Multiply below the half-background threshold, doubled inverted Multiply above it. |
| Screen | `screen` | `screen` | `1 - (1 - B) × (1 - F)`. |
| Soft Light | `softLight` | `softLight` | The [W3C Soft Light curve](https://www.w3.org/TR/compositing-1/#blendingsoftlight), which uses a polynomial branch near black. Adobe describes the lightening and darkening behavior. |

Ink also offers `hardLight`, `difference`, and `exclusion` on both paths. The typed and byte compositors share their channel formulas.

## Inputs and output

- **Background and foreground.** Supply equally sized RGB(A) images in the same declared color space, or scalar images with the same intent and units. The result retains the background’s precision, pivot, color space, sampling, tiling, and physical metadata. RGB and RGBA can be combined, with an RGBA result when either input carries alpha. Use `image.resize` and `image.convert` for deliberate alignment and encoding changes.
- **Mask and opacity.** The optional mask is an aligned typed image with the `mask` intent. Its decoded grayscale value multiplies the separate opacity value from zero to one. Zero coverage leaves the background sample unchanged in the resulting encoding.
- **Crop.** `{left, right, top, bottom}` uses normalized top-left coordinates, with left and top included and right and bottom excluded at texel centers. The crop gates the blend while keeping the original extent. Outside the crop, the background comes through.
- **Alpha.** `source` reads each input’s declared association. The blend applies to the overlap and the layers composite using [source-over](https://www.w3.org/TR/compositing-1/#simplealphacompositing). Output uses the background’s association if it has alpha, otherwise straight. `straight` and `premultiplied` require matching input encodings where alpha is present and use that output encoding. `ignore` computes RGB without alpha coverage and retains background alpha in straight encoding.

These controls correspond to the [Adobe Designer Blend node inputs and controls](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/atomic-nodes/blend/blend). The help lists the four alpha settings. The formulas and output encodings above define Ink’s behavior.

## Clamp and precision

| Setting | Behavior |
| --- | --- |
| `auto` | For a bounded output, limit the overlap’s mode value to zero through one. For float HDR and signed scalar output, preserve the full finite result. |
| `mode` | Limit the overlap’s mode value before mixing. The incoming samples in nonoverlapping regions retain the range allowed by the output. |
| `output` | Mix first and limit the resulting straight sample on affected texels. Alpha always stays in the unit range. |
| `none` | Preserve the finite result. A sample outside a bounded destination’s domain produces an error. |

For Add with background and foreground both at `0.75` and opacity `0.5`, a floating target yields `1.125` with no clamp, `0.875` with mode clipping, or `1.0` with output clipping. UNORM outputs round once at delivery.

## Breakwater demo

```sh
node examples/material-image-blend/demo.cjs /tmp/ink-breakwater
ink-studio graph run /tmp/ink-breakwater/breakwater.material.json --out /tmp/ink-breakwater/replay
```

Open the generated `index.html` to change blend modes, alpha, opacity, crop, mask, and clamp. The demo runs Ink’s browser graph against the two painted source plates. The editable material graph exports the default plate composite and the numeric HDR fixture.
