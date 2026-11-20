# Spectral and standing-wave fields

`KIT.procedural.fields.spectral` builds analytic Fourier fields and
ideal membrane modes. Read signed displacement, phase, gradients, or
nodal paths from a fixed-time frame. The same field can drive a projected
material, a height map, a contour, and the movement of splats.

```js
const F = K.procedural.fields.spectral;
const plate = F.membrane({ edge: 'free', modes: [
  { id: 'across', m: 3, n: 5, frequency: .5 },
  { id: 'along', m: 5, n: 3, amplitude: -1, frequency: .5 }
] });
const frame = plate.frame(.2, { drive: { across: .77, along: .92 } });
const { signed, phase } = frame.details(.3, .6);
const paths = frame.nodalLines({ cell: .012 });
const drift = frame.towardNodes([.3, .6], { limit: .03 });
```

## Build the field

- `fourier({ bounds, terms })` supports 2D and 3D bounds. A term's
  `cycles` counts the complete spatial oscillations across each chart
  axis. Its spatial angle is the sum of `2π × cycles × normalized
  coordinate`, plus `spatialPhase`. `kind: 'traveling'` (default) adds
  this angle to the time phase. `'standing'` uses its cosine as a signed
  spatial multiplier. A negative frequency reverses travel direction.
- `membrane({ bounds, edge, speed, modes })` builds rectangular modes
  with `m` and `n` half-wave indices. Fixed edges use sine products
  and indices 1–64. Free membrane edges use cosine products and allow
  indices 0–64. The natural frequency is proportional to
  `speed × hypot(m / width, n / height)`.
- `membrane({ shape: 'disk', center, radius, speed, modes })` builds
  fixed-rim circular modes. `m` is angular order (0–12). `n` is the
  positive Bessel root index (1–8). `angle` rotates the mode. The radial
  shape is `J_m(root × distance / radius)`. Its natural frequency is
  `speed × root / (2π × radius)`. The compiled mode exposes `root` and
  `naturalFrequency`. [NIST DLMF, Bessel function zeros](https://dlmf.nist.gov/10.21)

These are ideal membrane equations. The foundry uses a Chladni-inspired
superposition of free square membrane modes and a separate fixed disk.
[Rectangular and disk wave equations](https://math.libretexts.org/Bookshelves/Differential_Equations/Partial_Differential_Equations_%28Miersemann%29/4%3A_Hyperbolic_Equations/4.5.2%3A_Oscillation_of_a_Membrane)
[Particle accumulation near plate nodes](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/B834E2C39426B19BA7D9257772D94CB1/S0013091515000139a.pdf/stochastic_models_for_chladni_figures.pdf)

Each term or mode accepts `id`, `amplitude`, `frequency` in Hz, and
initial `phase` in radians. Membrane modes default to their natural
frequency. Fourier terms default to zero temporal frequency. Fields
support up to 24 modes. `frame(time, { drive })` applies a drive map keyed
by ID. A number multiplies amplitudes, and `{ gain, phase }` can also
shift phase. Omitted modes keep their authored settings. A retained
frame samples independently of later frames and drives.

## Sample, contour, and emit

The modes sum coherently into a complex field. `details(...point)`
returns its `signed` real displacement, `quadrature` imaginary component,
`magnitude`, wrapped `phase` in radians, and `energy` as squared magnitude.
When the sum's magnitude vanishes, `phaseDefined` is false and the phase
channel is zero. `sample(channel, ...point)` reads one output and
`gradient(channel, ...point)` returns its spatial derivative. Points
outside the field return `null`.

`nodalLines({ channel, cell, maxCells })` runs shared marching squares
on the signed component of a 2D frame, or on `channel: 'quadrature'`.
It returns chart-space polylines. A standing mode keeps the same nodal
pattern as its amplitude reverses sign. The exact zero-displacement phase
has no signed contour, so use a reference phase for persistent particles.
A driven mix can move the nodes even with a fixed reference phase.

`towardNodes(point, { channel, limit })` returns a bounded Newton step
along the gradient toward zero. The point and limit use chart units.
Add a fraction of that step per tick to make dust settle along the nodes.
The field gives zero displacement at a zero-gradient point. The foundry
uses a small amount of seeded jitter in those updates.

Register a field in `B.finish({ surfaceEffects: { fields: { wave } } })`
and name any channel in a projected layer. To supply an animated drive,
wrap it as `{ channels: wave.channels, frame: t => wave.frame(t, { drive:
settingsAt(t) }) }`. `frame.source('signed', { bounds, project })`
projects a chart into an XYZ source for [`KIT.fieldViews`](field-visualization.md).
A 3D Fourier field's `source` uses its own bounds.

## Drive a field from audio

`analyze(samples, { sampleRate, frequencies, window })` reads a real
mono PCM window at selected frequencies. It reports each bin's one-sided
`amplitude`, `phase` at the first sample, `real` and `quadrature`. Use the
periodic Hann window by default or choose `window: 'rect'`. Bins can fall
between discrete FFT frequencies. A window of up to 65,536 samples and
256 chosen frequencies is subject to a combined work limit.

```js
const bins = F.analyze(pcmWindow, { sampleRate: 48000, frequencies: [110, 165] });
const driven = plate.frame(time, { drive: {
  across: 5 * bins[0].amplitude,
  along: 5 * bins[1].amplitude
} });
```

## Render the studies

[Nodal Foundry and Harmonic Portico](../examples/spectral-wave-studies.js)
shows bronze dust following moving zeros on two plates. The portico reads
four frequency bands from its own soundtrack and maps them to Fourier
modes. Signed displacement moves the curtain in depth and phase colors it.
The example exports `soundtrack(seconds)` and `duration` for a matching
PCM track.

```sh
node cli/ink-studio.js clip examples/spectral-wave-studies.js --w 850 --h 520 --to 6.4 --fps 10 --out nodal-foundry.png
node cli/ink-studio.js clip examples/spectral-wave-studies.js --params '{"study":"portico"}' --w 850 --h 520 --to 6.4 --fps 10 --out harmonic-portico.png
```
