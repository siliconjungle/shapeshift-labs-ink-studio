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

## Noise Atlas

```sh
node examples/typed-named-noise/demo.cjs /tmp/ink-noise-atlas
ink-studio graph run /tmp/ink-noise-atlas/noise-atlas.material.json --out /tmp/ink-noise-atlas/replay
```

Open `index.html` in the output folder to compare all twelve families on the same grid. Change the seed, set each wrap axis independently, and compare a two-by-two repeat. The saved material graph contains all twelve scalar and colored previews, with the resolved settings available as graph outputs.
