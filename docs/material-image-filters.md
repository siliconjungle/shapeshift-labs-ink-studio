# Typed material blur, sharpen, and antialias

Use these operations on typed color images or unassociated data, mask, or height maps. Existing byte-raster `fx.kernelBlur` and `fx.pathBlur` keep their established behavior. The Gaussian kernel construction is shared.

| Node | Footprint and controls |
| --- | --- |
| `image.gaussianBlur` | Separable Gaussian with integer `radius` from 0 to 64 and optional positive `sigma`. |
| `image.directionalBlur` | Centered straight-line average, with subpixel samples at a clockwise `angle` in image degrees. `radius` is the half-length in texels. Choose 2–65 `samples`. |
| `image.radialBlur` | `spin` rotates around `center` and `zoom` samples toward or away from it. The center is normalized image UV. Radius sets the maximum half-travel at the farthest corner. Spin uses arc length and zoom stops at the center on its inward half. |
| `image.anisotropicBlur` | Rotated separable Gaussian with along/across `radii`, optional along/across `sigma`, and clockwise `angle`. |
| `image.variableBlur` | Scale the Gaussian sample offsets per destination texel using `radiusMap`, a same-sized unitless scalar mask or data map with values from zero to one. Integer maximum radius is 0–16. Fractional local offsets use bilinear sampling. Constant zero preserves the input and constant one uses the separable Gaussian. |
| `image.highPass` | Source minus Gaussian, with optional `bias` and `threshold`. Delivers signed float64 by default. Signed mask detail becomes data, and color detail stays in linear light. |
| `image.unsharpMask` | Add scaled Gaussian detail to the original. Pixels whose largest channel difference is at or below `threshold` are left unsharpened. |
| `image.sharpen` | Add detail from a four-neighbor cross. Radius is the cross arm length and `intensity: 4` gives the classic five-center coefficient at radius one. |
| `image.antialias` | Use a local Sobel gradient to smooth diagonal color or coverage edges along their normal. Set a subpixel `radius` from 0 to 2 and a contrast `threshold`. This is a raster reconstruction filter. |

## Samples and borders

Set `options.border` to `clamp`, `wrap`, `mirror`, or `transparent`, or supply independent `{u, v}` policies. An omitted axis inherits its source policy. Transparent border samples are zero. RGB fills that border with black, while RGBA mixes through zero coverage. A border override affects the filter’s reads and leaves the image descriptor’s tiling unchanged.

Color uses linear-light float64 working samples and premultiplies them for filtering. Choose `space: "native"` for an authored sample-space effect. High pass works in linear light. Blur and antialias mix the result against the source with an `intensity` from 0 to 1. Detail filters accept an intensity from 0 to 16 and retain original alpha coverage.

The result carries the source extent, pivot, alpha convention and physical metadata. Filters default to the source storage precision except for signed high pass. Supply `precision` to choose a different output. Bounded outputs clamp by default. High pass defaults to `outOfRange: "error"` when a bounded precision is requested. Floating linear color retains negative and over-white values. An operation is bounded to 128 million sample visits and 192 MiB of output plus working sample buffers. Variable-radius passes scale their tap budget to the region with a nonzero map.

## Beacon Optics demo

```sh
node examples/typed-material-filters/demo.cjs /tmp/ink-optics
ink-studio graph run /tmp/ink-optics/beacon-optics.material.json --out /tmp/ink-optics/replay
```

Open `index.html` to compare all nine filters, inspect the same diagonal edge at higher magnification, and read native RGB and coverage while changing the precision.
