# Moiré and gratings

`KIT.procedural.materials.gratings` composes animated line, dot, and polar
patterns into one scalar coverage field. Filter the composite at the size
of an art pixel. Broad interference bands survive as fine repetitive
detail fades away.

```js
const { gratings, tangent } = KIT.procedural.materials;
const pattern = gratings({
  mode: 'product',
  layers: [
    { kind: 'line', frequency: 34 },
    { kind: 'line', frequency: 35.5, angle: .08, rate: .2 }
  ]
});

const phase = pattern.frame(timeInSeconds);
const coverage = phase.sample(u, v, { footprint: [duPerPixel, dvPerPixel] });
const surfaceMask = tangent(phase.sample, { scale: [2, 2] });
```

`frame(time)` retains the pose at that time and returns a planar
`sample(u, v, options)` function. It works directly with
`materials.tangent` and `materials.triplanar`. For standalone samples
use `pattern.sample(u, v, { time, footprint, detail })`. The result is
coverage from 0 to 1. Use it as a mask, blend pigment or emission,
or sample it into a sprite surface.

## Grating layers

| Option | Meaning |
| --- | --- |
| `kind: 'line'` | Parallel bands. `frequency` is the number of cycles per chart unit across the bands. The phase normal points along U at `angle: 0`. |
| `kind: 'dot'` | Two perpendicular gratings multiplied into a dot lattice. `frequency`, `phase`, and `rate` accept individual values for the two axes. A scalar uses the same value on both axes. |
| `kind: 'polar'` | The phase adds `frequency * radius` to `spokes * angle / (2π)` around `origin`. Use only radial frequency for rings, only a signed integer spoke count for spokes, or both for spirals. If a spoke count is supplied, frequency defaults to zero. |
| `origin`, `drift` | Chart position and velocity, each given as `[u, v]`. |
| `angle`, `spin` | Orientation in radians and angular speed in radians per second. Polar orientation rotates the angular component. |
| `phase`, `rate` | Phase in cycles and phase change in cycles per second. |
| `sharpness`, `opacity` | Each axis uses `cos(π * phase)^(2 * sharpness)`. Use an integer from 1 to 4 for progressively narrower lines and dots. Opacity runs from 0 to 1. |

The default kind is `'line'`. The default frequency is 1 except for polar
spokes. Origin, drift, angles, and phase controls default to zero. Sharpness
and opacity default to 1. With `mode: 'ink'`, layers accumulate coverage as
`1 - product(1 - opacity * layer)`. With `mode: 'product'`, layers multiply
as `product(1 - opacity + opacity * layer)`. One to eight declared layers
may share a budget of 4,096 terms before conjugate pairs are combined.
A dot at high sharpness takes more of that budget than a line.

## Pixel footprints and shimmer

Pass a width for square pixels or `[du, dv]` for axis-aligned chart
footprints. With screen-space derivatives, pass
`[[du/dx, dv/dx], [du/dy, dv/dy]]` to account for skew and foreshortening.
For baked textures, give the size of a texel in chart units. Omit the
footprint for point sampling.

The compositor expands products into sum and difference harmonics and
filters those frequencies against an anisotropic Gaussian footprint.
Affine line and dot phases support analytic attenuation. Polar phases use
local derivatives, with deterministic subdivision near a polar center.
A footprint projected onto the chart should describe the area sampled
by this call. For a baked texture, the renderer's later sampling of that
texture still determines how it looks at other camera distances.

`detail` blends point-sampled coverage into the filtered result. Its
default of 0 gives full filtering. Set a fraction to deliberately bring
back high-frequency shimmer. Values through 1 can be set on the compiled
pattern and overridden per sample. Animation depends only on time and
the authored layer controls.

See [Moiré patterns in scanned halftone pictures](https://opg.optica.org/josa/abstract.cfm?uri=josa-72-9-1190)
for the role of screen frequencies and angles, and
[Procedural Noise using Sparse Gabor Convolution, §5.2](https://www-sop.inria.fr/reves/Basilic/2009/LLDD09/LLDD09PNSGC_paper.pdf)
for frequency-domain Gaussian filtering with a texture-coordinate Jacobian.

## Render the studies

[Registration Press and Interference Beacon](../examples/moire-grating-studies.js)
show drifting dot-screen overprints, a polar sign, and matching line
gratings with two different shimmer settings.

```sh
node cli/ink-studio.js clip examples/moire-grating-studies.js --w 850 --h 520 --to 6.4 --fps 10 --out registration-press.png
node cli/ink-studio.js clip examples/moire-grating-studies.js --params '{"study":"beacon"}' --w 850 --h 520 --to 6.4 --fps 10 --out interference-beacon.png
```
