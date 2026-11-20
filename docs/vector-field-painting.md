# Vector-field painting

`KIT.fieldViews.lic` uses line integral convolution (LIC) to turn a
velocity field into an aligned grain. It samples a bounded planar
slice, projects velocities into that plane, and filters seed texture
in both directions along the local streamlines. Change the color ramp
to paint fog, silk, timber, or ink from the same field.

```js
const F = KIT.fieldViews;
const flow = F.fromQuery(query, 'river/velocity', { bounds });
const paint = F.lic(flow, {
  plane: { axis: 'y', at: waterHeight },
  counts: [192, 128],
  length: .6,
  grain: .04,
  seed: 42,
  motion: { wavelength: .7, phase: time / 3 }
});
const grain = paint.sample(u, v);
const speed = paint.sample(u, v, 'speed');
```

Use any vector source accepted by `fieldViews`, including retained world
queries, analytic wakes, and fluid snapshots. For example, wrap a retained
XZ fluid with `source({ type: 'vec2', components: 'xz', bounds, sample:
(x, y, z) => snapshot.sample(x, z)?.velocity ?? null })`. The source box
uses world XYZ coordinates.

## Controls

| Option | Meaning |
| --- | --- |
| `plane`, `counts` | Standard axis-aligned or oblique [field-view plane](field-visualization.md). The default is an XZ slice at the middle Y of the source with `[128, 96]` samples. |
| `length`, `step` | World distance in each direction and maximum integration step. The defaults are 12 texels of the shorter spacing and half that spacing. Steps stay at or below half a texel to respect the sampled mask. |
| `grain`, `seed`, `texture` | Seeded noise uses cells of width `grain` in chart units, defaulting to the shorter texel spacing. Supply `texture(u, v)` to use authored pigment or another scalar texture in `[0, 1]`. Chart coordinates measure distance from the plane origin. |
| `kernel` | Use a flat `'box'`, linear `'tent'`, or rounded `'hann'` window. The default is `'hann'`. |
| `motion: { wavelength, phase }` | Add a traveling cosine to the kernel with the given wavelength in world units. Phase is in cycles and wraps every turn. Changing it moves the grain along the positive field direction. |
| `mask`, `minSpeed` | Mask with a world-space callback `(x, y, z) => open` or have the source return `null` in missing cells. Integration stops at closed cells and where projected speed falls to `minSpeed` (default `1e-8`). |
| `maxWork` | Upper bound on raster lookups, defaulting to 12 million. Limits also cap the grid at 65,536 texels and each half-trace at 1,024 steps. |

The scene field is read once per open texel center in each call. The
filter traces the resulting bilinear field with normalized midpoint
steps. Its length defines the grain independently of vector magnitude.
A symmetric window shows orientation. Animate the optional traveling
window to show direction or rebuild from a later field revision to show
a changing flow. The filter averages only the accessible portion when
a trace stops. Stationary cells keep their original grain. Resolve
walls and other narrow obstacles in the authored raster.

## Use the result

`values` and `speeds` are retained row-major arrays with U varying
fastest, and missing texels use `null`. `sample(u,v,channel)` interpolates
either `'grain'` (default) or tangent-plane `'speed'`. Use `source(channel)`
for world-space field views such as contours. To map the same texture to
another surface, pass `source(channel, { bounds, project })` with a world
XYZ box and a callback from XYZ to chart coordinates. The speed channel
retains source units. It can drive emission or pigment intensity
independently of the grain.

Map the raster to a `SpriteSurface`, feed its sampler into a material, or
emit it as native splats with `fieldViews.stamp`. Simulation manifests
accept `kind: 'lic'` under `visual.fieldViews`. Use the usual `field`,
`bounds`, `options`, and `style` fields. JavaScript texture and mask
callbacks are available in the procedural API.

The filter follows the method in [Cabral and Leedom, *Imaging Vector Fields Using Line Integral Convolution*](https://cgl.ethz.ch/teaching/scivis_common/Literature/CabralLeedom93.pdf).

## Render the studies

[Harbor Wake and Silk Current](../examples/vector-field-painting-studies.js)
paint the existing obstacle-wake field as drifting mist and map a planar
LIC texture onto a folded cloth mesh. The silk study shows the input
grain beside the woven-looking result.

```sh
node cli/ink-studio.js clip examples/vector-field-painting-studies.js --w 850 --h 520 --to 6.4 --fps 10 --out harbor-wake.png
node cli/ink-studio.js clip examples/vector-field-painting-studies.js --params '{"study":"silk"}' --w 850 --h 520 --to 6.4 --fps 10 --out silk-current.png
```
