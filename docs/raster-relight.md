# Relight a raster from an emission pass

`fx.relight` transfers colored light from one raster to another surface on
the same art grid. Use an arc fringe, a painted emission texture, or a
procedural field as the source. Shape the receiver with a height map, an
explicit normal map, a mask, or a combination.

```js
const {pixelEffects} = require('@shapeshift-labs/ink-studio').load().KIT.procedural;
const {value, irradiance, intensity} = pixelEffects.relight(emission, {
  height: relief, mask: ceramicOnly, radius: 36, emitterHeight: 12, strength: 0.08
});
```

In a graph, connect `emission`, `height`, `normals`, and `mask` as separate
inputs and place the remaining controls in `options`. Height, normals, and
mask are optional. With both geometry inputs omitted, the surface is flat
at Z = 0 and faces the viewer.

| Input | Interpretation |
| --- | --- |
| `emission` | Grayscale, grayscale-alpha, RGB, or straight RGBA. Untagged input defaults to sRGB bytes with byte alpha. Rasters tagged as linear sRGB use linear RGB and unit alpha. Transparent pixels emit nothing. |
| `height` | One channel. `heightScale` converts the samples to art pixels above the receiver plane. Finite differences derive normals when the normal input is absent. Use `heightScale: 9/255` for a byte map representing nine pixels of elevation. |
| `normals` | Three signed XYZ channels with X right, Y up, and +Z toward the viewer, matching `proc.sphereMap.normal`. Set `normalEncoding: 'rgb8'` for atlas-style RGB normals. If alpha is supplied, zero marks a missing normal. Missing and zero-length normals receive no light. With both inputs connected, height still sets elevation. |
| `mask` | Single-channel coverage, color luminance, or image alpha. Values are divided by `maskScale` and clamped to [0, 1]. A zero receiver remains dark even if an emitter is directly over it. |

`radius` is the maximum 3D reach in art pixels and defaults to 32.
`emitterHeight` sets the Z plane of the emission grid and defaults to 8.
Every emitting sample contributes its color and alpha times
`strength × max(0, normal · direction) × (1 − distance/radius)²` inside the
radius. Coincident samples contribute zero. `strength` defaults to 1 and
scales the contribution per source pixel. This is direct diffuse transfer
in screen space. Cast shadows and reflections can be supplied by separate passes.

Use `emissionEncoding: 'linear', emissionScale: 1` for normalized linear
fields and HDR RGB or straight RGBA with unit alpha. The same scale is used
for emission colors and alpha. sRGB components and alpha clamp to the unit
interval after scaling. Linear components allow up to 4,096 after scaling.
`maskScale` defaults to 255. `emissionScale` defaults to 255 for untagged
or display rasters and 1 for rasters tagged as linear sRGB.

| Output | Use |
| --- | --- |
| `value` | Display-ready straight RGBA light layer. Over black, it shows clipped and sRGB-encoded irradiance. Blend it over a painted receiver or use it to inspect the pass. |
| `irradiance` | Unclipped three-channel linear RGB light. Add or mix multiple light passes before a display transform. |
| `intensity` | One-channel, unclipped linear luminance. Connect it directly to `color.gradient` with `channel: 0`, an authored `range`, and a ramp with `interpolation: 'step'` for crisp lighting bands. A black first stop gives a neutral result at zero when the ramp is composited with screen or add. |

A grid can contain up to 1,048,576 pixels. Sparse emission works at native
resolution with the default `sampleStep: 1`. For dense emitters or wide
radii, increase `sampleStep` up to 32. Each square block then conserves its
summed emission color and approximates its position by the energy-weighted
centroid. Clipped source footprints are limited to 64 million receiver visits.

```sh
ink-studio graph describe fx.relight --example > lamp.json
ink-studio graph run lamp.json --out lamp
node examples/raster-relight.cjs ./midnight-relay
```

Open `midnight-relay/index.html` to see the lit ceramic and the isolated light
pass together. Two `proc.discharge.fringe` rasters supply the light, the
tile height and mask shape it, and two stepped ramps grade the intensity.
