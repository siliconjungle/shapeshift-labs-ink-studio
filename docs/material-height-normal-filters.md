# Typed height and normal filters

Typed normal maps use XYZ or XYZA. Float channels hold signed direction components in [−1, 1]. Integer direction channels use the biased mapping `2 × code / max − 1`. An alpha channel is coverage and stays in [0, 1]. Legacy normal descriptors without explicit tags are interpreted as tangent-space OpenGL by these filters. New maps can carry `normalSpace: "tangent" | "world"` and a tangent-only `normalOrientation: "opengl" | "directx"`.

| Node | Behavior |
| --- | --- |
| `image.heightToNormal` | Produce tangent normals from typed heights. Choose `method: "central" \| "sobel" \| "scharr"`, signed `strength`, explicit XY `spacing` in the height's units, and per-axis `border`. Heights in `mm` use the source pixel pitch when available. Otherwise spacing defaults to [1, 1]. Output defaults to float32 and OpenGL. |
| `image.normalDecode` | Import raw RGB(A) channels, including a PNG decoded with a display color tag. Treat codes as vector data and attach their `normalSpace` and optional tangent `orientation`. The default precision follows the raster buffer; use `precision` to describe serialized input codes. |
| `image.normalNormalize` | Normalize each vector. The optional `fallback` determines the direction of zero-length vectors and defaults to [0, 0, 1]. |
| `image.normalInvert` | Flip any selected `axes` from XYZ. The default `"xy"` reverses slopes without flipping Z. |
| `image.normalRotate` | Normalize and rotate vectors about an `axis` by `degrees` using the right-hand rule. The default axis is +Z. |
| `image.normalOrientation` | Change the tangent Y convention and preserve the interpreted direction. OpenGL uses positive green toward the top of the image. DirectX uses the opposite convention. |
| `image.normalCombine` | Layer `detail` over `base` with `method: "rnm" \| "whiteout" \| "lerp"`. RNM follows the base direction, and whiteout combines XY slopes and multiplies Z. These two methods use tangent maps. Normalized linear interpolation also works on world maps. Degree of contribution is `amount × mask × detail coverage`. Output uses the base coverage, convention, and alignment. |
| `image.normalSpace` | Project normalized directions through a uniform or per-texel tangent frame. Select `to: "world" \| "tangent"` and optionally a tangent output `orientation`. |
| `image.heightBlend` | Blend physical heights in the same units and return `weight`, the effective transition mask. `offset` raises the layer height. `bias` shifts the selection threshold. `softness` is the half-width of the smooth transition in height units. `opacity` and the optional mask multiply the weight. Use `mode: "mix"` for an unconditional masked interpolation. |

For height gradients, +X points right and tangent +Y points up. Wrap crosses the tile seam, mirror reflects samples, clamp repeats the edge, and transparent supplies zero height. Normal operations retain the source storage precision unless specified otherwise. Use float precision for intermediate edits and a normal usage with 8-bit or 16-bit PNG for delivery. The PNG contains raw channels. Keep the orientation with the material metadata or filename.

## Tangent frames and alignment

The uniform `frame` record contains world `normal`, world `tangent`, and `handedness`. Its defaults are +Z, +X, and +1. Alternatively connect matching `surface` and `tangent` maps to supply per-texel axes. They accept world normal images and signed float XYZ data. The tangent is orthogonalized against the surface normal. Bitangent is `handedness × cross(normal, tangent)`. The optional `handedness` map supplies signed data values −1 or +1. Mask input values below 0.5 select −1.

Multi-image filters match extents and any pivot and pixel-pitch metadata present on both inputs. An optional blend mask accepts an unassociated, unitless scalar in [0, 1]. Use `weight` from the height blend to align pigment, roughness, or mask transitions with the physical relief.

The normal encoding and tangent-frame convention follow the [glTF specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#additional-textures). For the Y convention and the layer algorithms, see [Adobe’s orientation guide](https://experienceleague.adobe.com/en/docs/substance-3d/bakers/common-questions/what-is-the-difference-between-the-opengl-and-directx-normal-format) and [Blending in Detail](https://blog.selfshadow.com/publications/blending-in-detail/).

## Kiln Relief demo

```sh
node examples/typed-height-normal/demo.cjs /tmp/ink-kiln-relief
ink-studio graph run /tmp/ink-kiln-relief/kiln-relief.material.json --out /tmp/ink-kiln-relief/replay
```

Sweep the light across the ceramic panel, change the relief blend, stack or invert the detail normals, and inspect the packed OpenGL and DirectX maps. The exported graph also includes the height and contribution mask.
