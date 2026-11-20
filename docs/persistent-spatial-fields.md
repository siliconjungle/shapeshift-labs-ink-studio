# Persistent spatial fields

Use `KIT.deposition.create` to accumulate scalar values in a **UV surface chart**
or an **XYZ volume**. A timed stamp deposits an impulse, and a timed stroke
deposits continuously along a moving source. Read the field in a material,
extract level sets, or place splats in proportion to its value.

The [Trace Harbor scene](../examples/persistent-spatial-fields.js) tracks a
scanner across a façade. Revisiting an area builds brighter contour bands.
Earlier passes spread and fade, and a second field positions sparks in the
air in front of the wall.

```sh
node cli/ink-studio.js clip examples/persistent-spatial-fields.js --from 0 --to 9 --fps 16 --out trace-harbor.png
```

## Define a field and deposit values

```js
const trace = K.deposition.create({
  bounds: { min: [-3, 0], max: [3, 4] },
  counts: [120, 80],
  channels: { intensity: { decay: .5, diffusion: .025 } }
});

trace.stamp({ time: .5, at: [-2, 1], sigma: .18, values: { intensity: 1 } });
trace.stroke({
  keys: [[1, -2, 1], [2, 0, 2.2], [3, 2, 1.5]],
  interval: .04, sigma: .18, values: { intensity: 2.5 }
});

const sample = trace.frame(2.5);
sample.sample('intensity', 0, 2.2);
```

- Two counts and UV bounds define a chart. Three counts and XYZ bounds define
  a volume. Axes can have different grid spacings.
- Stamps add signed channel values at the given time. With `sigma` measured in
  grid coordinate units, the deposited Gaussian peaks at the given value before
  grid sampling. Use a `sigma` of at least a quarter of the largest cell spacing.
- Stroke keys have the form `[seconds, ...coordinates]` and interpolate linearly.
  Stroke values are **rates per second**. Midpoint samples cover each key
  interval, subdivided by both `interval` and travel distance. Lowering
  `interval` refines deposition without multiplying the total dose.
- `decay` is a per-second exponential rate. `diffusion` is in squared
  coordinate units per second. Both default to zero. Diffusion increases the
  variance by `2 * diffusion * age` and reduces the peak to preserve the mass of
  the Gaussian in free space. The grid clips the result at its bounds. Kernels
  are evaluated up to four standard deviations per axis.
- `lifetime` is optional and removes a contribution when its age reaches the
  given number of seconds. A stationary maintained source can use a stroke
  with the same coordinates on both end keys.

`frame(time)` samples independently of previously rendered frames. A retained
frame never changes, even after another deposit. `data(channel)` copies its
cell-centred values with the first axis varying fastest. `sample` interpolates
between cell centres and returns zero outside the field or for an unknown
channel. `revision` changes when edits invalidate frames.

`maxDeposits` caps the retained events at 16,384 by default. `maxWork` caps
the cell updates in one frame at 32 million by default. The field allows up
to 1,048,576 total samples across its channels. For long-running sources with
finite lifetimes, use `prune(time)` to remove deposits that expired by that
time. Earlier frames and edits are thereafter unavailable from the field.
`clear()` resets the history and retention cutoff.

## Render the field

**Surface color and contours.** Register `trace` in
`B.finish({ surfaceEffects: { fields: { trace } } })`. Use
`field: 'trace'`, `maskChannel: 'intensity'` and `pattern: 'solid'` for a
color wash. Use `pattern: 'contour'` with `contourChannel: 'intensity'` for
bands. A UV field reads the material's projection coordinates. An XYZ field
reads the surface sample's world or rest position, as selected by `space`.
JSON dioramas can put the same field settings in
`finish.surfaceEffects.fields.trace` with `type: 'deposition'` and initial
`stamps` and `strokes`. [Projected material settings](projected-effects.md)

**World contours and volumes.** An XYZ frame exposes
`frame.source('intensity')` for `K.fieldViews.slice`, `contours`, and
`isosurface`. For a UV chart, pass `{ bounds, project }` to `source`.
`bounds` is the XYZ box to examine, and `project([x, y, z])` maps that point
to UV. `K.fieldViews.stamp` can draw the extracted geometry as splats.
[Field visualization](field-visualization.md)

**Splat emission.** `frame.pick('intensity', random, { threshold: .08 })`
returns `{ at, value }` for a weighted cell centre, or `null` when the
channel is empty above the threshold. Pass a seeded random function for
repeatable results. Use the point in `K.frameSplats` or as the birth position
in a `K.splatEffects.emitter` source. For a chart, map the sampled UV back
onto its surface first.
