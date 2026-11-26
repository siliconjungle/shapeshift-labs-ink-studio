# Normal and height bakes

Add `normal`, `world-normal`, and `height` to a [bake preset](bake-jobs.md). Enable their map rows and open the per-map overrides in the bake workstation. Tangent and world maps can run together so a single target can deliver both conventions.

```json
{
  "format": "ink-studio/bake-preset",
  "version": 1,
  "label": "Physical relief",
  "defaults": {"size": 256, "padding": 3},
  "maps": [
    {"id": "normal", "overrides": {"encoding": "png16", "orientation": "opengl"}},
    {"id": "world-normal", "overrides": {"encoding": "exr"}},
    {"id": "height", "overrides": {"encoding": "exr"}},
    {"id": "cage-hit"}
  ]
}
```

## Normal conventions

| Setting | Behavior |
| --- | --- |
| Tangent space | Ink normalizes the source vector and projects it into the orthonormalized receiver frame. The frame follows each triangle's UV derivatives and shading normals. Mirrored islands retain their handedness. |
| OpenGL or DirectX | The DirectX convention reverses the tangent map's Y component. The X and Z components stay in the same convention. |
| World space | Use `world-normal` or set `space: "world"` on `normal`. The X, Y and Z components follow the transformed glTF scene axes. Authored mesh transforms are applied to both direct bakes and projection. |
| Encoding | Choose `png8`, `png16`, or `exr`. PNG stores RGB components as `(vector + 1) / 2` with no color conversion. EXR stores signed, 32-bit floating samples in named X, Y and Z channels. |

The existing `normal` default remains an OpenGL tangent map in 8-bit PNG. The independent `world-normal` map defaults to 16-bit PNG. Set `orientation` only for tangent space. The normal file can be reloaded as a typed world or tangent normal when it refreshes a graph resource.

## Signed height and normalization

Height is the accepted [projection](bake-projection.md) hit's signed distance from the low surface along the cast axis. Frontal hits are positive and rear hits are negative. The raw value for a direct bake, self-bake, missing hit or blocked hit is zero. Padding extends the nearest sampled value into the gutter. Coverage and hit maps distinguish sampled surfaces from gutters and identify accepted hits.

| Normalization | Behavior |
| --- | --- |
| `none` | Store signed scene-unit values directly in a 32-bit OpenEXR Y plane. Default for EXR. |
| `symmetric` | Use the largest measured magnitude in either direction to set a range centered on zero. Default for PNG. |
| `minmax` | Fit the measured extrema and include zero. |
| `manual` | Set `range: [min,max]`, with `min < max` and zero inside or at an endpoint. Values outside the range saturate. |

Automatic modes measure accepted texels across all selected tiles of one target and use the same range on every tile. They use `[-1,1]` for an entirely flat or empty result. The report records measured extrema, the encoding range, and the number of clipped surface samples per tile. Normalized files encode `clamp((height - min) / (max - min), 0, 1)` as grayscale 8-bit or 16-bit PNG or as float EXR. Linked and embedded bitmap refreshes retain the decoding range, so graph consumers receive height in scene units within the chosen format's precision. OpenEXR exports also include a PNG preview for the workstation. Download the map to get the original EXR.

## Demo and analytic fixture

```sh
node examples/bake-normal-height/demo.cjs nacre-signal
ink-studio bake-job serve nacre-signal/nacre.bake.json --out nacre-signal/physical
```

Open `nacre-signal/index.html` to compare shaded relief, tangent normals, world normals and height on both UV tiles. The known-plane fixture has a 90° scene rotation, one U-mirrored tile, a shared authored normal, a frontal plane at +0.125 and a rear plane at −0.0625. Its expected vectors and offsets are saved in `reference/expected.json`.
