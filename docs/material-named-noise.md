# Named noise in material graphs

Use `image.noise` to generate a typed scalar map. Feed its `value` into a color ramp, a mask operation, or an explicit height conversion. The `info` port reports the resolved family settings, seed, dimensions, periods, addressing, and raster sampling window. Use `proc.noiseFamily` when another node needs a coordinate field, or use `KIT.procedural.namedNoise.create(family, options).value(...coordinates)` to sample it directly.

| Family | Dimensions | Native output and controls | Explicit tiling |
| --- | --- | --- | --- |
| `perlin` | 2D, 3D, 4D | Signed, smoothly interpolated gradients with a quintic fade | Integer cell period per axis |
| `simplex` | 2D, 3D, 4D | Signed simplex gradient field | Circular embedding if the resulting field fits in four dimensions. Smooth periodic blending otherwise |
| `gaussian` | 2D, 3D, 4D | Independent normally distributed cells. `mean: 0`, `deviation: 1` | Integer cell period per axis |
| `white` | 2D, 3D, 4D | Independent uniform values in 0–1, held across each cell | Integer cell period per axis |
| `blue` | 2D | Toroidal void-and-cluster ranks in 0–1. Field `rankSize: [32,32]`, `sigma: 1.4` texels, `density: 0.13` | Always repeats at the rank tile size. Explicit periods must be integer multiples of that size |
| `worley` | 2D, 3D | Distance to the nearest site (F1), in cells. `metric: "euclidean"`, `jitter: 1` | Integer cell period per axis |
| `voronoi` | 2D, 3D | One stable 0–1 value per nearest-site region. Same metric and jitter defaults as Worley | Integer cell period per axis |
| `cellular` | 2D, 3D | Difference between second and first site distances (F2 − F1), in cells. Low values follow cell boundaries | Integer cell period per axis |
| `fractal` | 2D, 3D, 4D | Signed weighted octave sum. `carrier: "perlin"`, `octaves: 4`, `gain: 0.5`, `lacunarity: 2` | Perlin requires integer periods at each active octave. Use the simplex carrier for fractional periods |
| `ridged` | 2D, 3D, 4D | Merges squared inverted octave magnitudes into 0–1 ridges. Same octave defaults as Fractal | Same rules as Fractal |
| `anisotropic` | 2D | Signed directional stretch. `angle: 0` degrees clockwise from X, `aspect: 4` | Smooth periodic blending over the requested rectangle |
| `directional` | 2D | Signed bands along `angle: 0` degrees clockwise from X, with `wander: 0.26` cell of modulation scale. Zero wander gives straight bands in an open field | Smooth periodic blending over the requested rectangle |

All three cell families accept `metric: "euclidean"`, `"manhattan"` or `"chebyshev"` and `jitter` from 0 (centered sites) to 1 (full-cell jitter). `blue` supports rank tiles from 4 to 96 texels on either axis within the rank generator’s work budget. Periodic blending guarantees repeatability at the requested offsets. It can change the pattern inside the tile compared with open sampling.

## Seeds, ranges, and sampling

- A standalone field defaults to two dimensions, seed zero and one `null` period per axis. Set each `periods` entry in cell units, or use `null` for an open axis. The same settings and integer seed reproduce the same field. Both graph nodes use their contextual seed when `options.seed` is omitted. Supply a signed safe integer to lock the pattern to a specific seed.
- `output: "unit"` is the default and returns 0–1. Signed fields map from −1–1 to 0–1. Gaussian maps `0.5 + sample / 6` and clips. Worley and Cellular clip in unit mode. Use `output: "native"` to keep the signed samples, normal distribution or distances in cells. Native image output requires `float32` or `float64`.
- `image.noise` defaults to 128 × 128 and `float32`. It also supports `float64`, `unorm8` and `unorm16`. Samples land at texel centers. White, Gaussian, Blue and Voronoi use nearest sampling in the image descriptor. The other families default to linear sampling.
- `extent` specifies the XY field size of the image as one number or a pair. The default is eight cells for Perlin, Simplex and the oriented families, seven for the cell families, four for the octave families, and one cell per texel for White and Gaussian. Blue defaults each rank dimension to the corresponding image size if it is 4–64 texels and to 32 otherwise, then fits the nearest whole number of rank-tile repeats. Match the image size to a whole multiple of the rank dimensions for one rank sample per texel. Other sampling densities can change the apparent spectrum.
- `tiling` defaults to `"wrap"` on both axes. Use a shared mode or provide independent `u` and `v` modes. Wrap makes the corresponding `extent` the XY field period. Clamp, mirror and transparent leave the field open on that axis and describe how downstream image sampling addresses it. Blue retains its intrinsic period.
- `offset` shifts the sampling window and defaults to zero in every field dimension. Extra coordinates select a slice. For example, `dimension: 4, offset: [0,0,1.5,2], slicePeriods: [null,6]` selects Z at 1.5 and an independently looping fourth coordinate at phase 2 of 6.
- Image generation has a four-million-texel ceiling and a family work budget. For large, expensive fields, render smaller tiles or sample the procedural field at the points you need.

## Shape a noise tile

| Image option | Default | Effect |
| --- | --- | --- |
| `scale` | `1` | Multiply the XY extent by 1/16–64. Higher values pack more features into the same image. |
| `tileOffset` | `[0,0]` | Move the sample window by the given fractions of its effective width and height. On a wrapped axis, adding a whole tile returns the same pattern. The offset combines with the existing cell-space `offset`. |
| `nonSquareExpansion` | `false` | Treat the short image dimension as the starting scale and expand the long axis in proportion to its pixel count. Discrete defaults that already follow image dimensions keep their existing proportions. |

Wrapped lattice generators choose the nearest whole-cell period when scale or expansion changes the span. Blue noise instead snaps to whole rank tiles. Continuous tilers accept fractional spans, as do open axes. The `info` output shows `baseExtent`, `requestedExtent`, and the effective `extent`. When exact per-axis extents matter, set `extent` directly at scale 1 with expansion off. Blue rank sampling still benefits from matching the number of texels to a whole number of rank tiles.

For Fractal and Ridged, set `octaveRange: [first,last]` with inclusive, zero-based bounds from 0 to 7. This replaces `octaves`, which still selects a count starting at octave zero. Later bands use `lacunarity^index` for frequency, with lacunarity from 1 to 4. Gain ranges from 0 to 1 and weights each octave relative to the lowest selected octave, so a gain of zero isolates that band. Tiled Perlin still requires an integer period at each active octave. The simplex carrier supports fractional lacunarity with arbitrary wrapped periods. The same octave controls apply to `proc.noiseFamily`.

## Animate disorder

`disorder` sets a reproducible phase in a one-cycle range. Whole cycles repeat. `animationSpeed` moves through that range in cycles per second. Zero holds the selected phase, positive speed moves forward, and negative speed reverses. Set `time` on either noise node to sample a particular instant, or link an `anim.clock` output whose range covers your clip to play it on the graph timeline. The direct helpers take an optional final time argument in seconds. `info` reports the resulting phase and the loop duration when speed is active.

Perlin, Simplex, Anisotropic and Directional blend independent seeded states. Fractal and Ridged evolve each octave before combining them. Worley, Voronoi and Cellular move sites inside their original jitter bounds and keep each site's identity. Voronoi still changes its value abruptly when an edge crosses a texel. White, Gaussian and Blue expose spatial controls and omit disorder and speed. They can still animate via a keyed sampling window.

Every phase preserves the spatial periods. Phase zero with default controls reproduces the original static sample values. For examples of the authoring controls that informed this design, see [Adobe's Fractal Sum Base](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/texture-generators/noises/fractal-sum-base) and [Clouds 1](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/texture-generators/noises/clouds-1).

## Noise Workshop

```sh
node examples/procedural-noise-controls/demo.cjs /tmp/ink-noise-workshop
ink-studio graph clip /tmp/ink-noise-workshop/noise-workshop.material.json --output live --from 0 --to 48 --out /tmp/ink-noise-motion
```

Open `index.html` from the output folder. Compare the original recipe with a rectangular tile that uses expansion, offset, animated disorder, and a selected octave band. Play or scrub the loop, and switch families to see the controls each one supports.

## Noise Atlas

```sh
node examples/typed-named-noise/demo.cjs /tmp/ink-noise-atlas
ink-studio graph run /tmp/ink-noise-atlas/noise-atlas.material.json --out /tmp/ink-noise-atlas/replay
```

Open `index.html` in the output folder to compare all twelve families on the same grid. Change the seed, set each wrap axis independently, and compare a two-by-two repeat. The saved material graph contains all twelve scalar and colored previews, with the resolved settings available as graph outputs.
