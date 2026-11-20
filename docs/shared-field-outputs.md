# Shared field outputs

`KIT.fieldOutputs.create` lets a generator expose named samples on a bounded
2D or 3D domain. Consumers select a channel. The coordinates, units, types,
and missing values stay with the generator.

```js
const field = K.fieldOutputs.create({
  bounds: { min: [0, 0], max: [1, 1] },
  channels: {
    age: { units: 's', range: [0, 2] },
    species: { type: 'category' }
  },
  sample(u, v) {
    const age = 2 * Math.hypot(u - .5, v - .5);
    return { age, species: u < .5 ? 'jade' : 'copper' };
  }
});

const paint = field.pigment('species', {
  colors: { jade: '#45a592', copper: '#f2aa83' }
});
const tile = field.relief('age', {
  carrier: { sample: ([u, v]) => ({ p: [u, 0, v], n: [0, 1, 0] }) },
  segments: [32, 32], scale: .12, flip: true
});
sprites.mesh(tile, 64, 64, (i, j) => paint((i + .5) / 64, (j + .5) / 64));

const lines = field.view('age', { kind: 'contours', options: { levels: [.25, .5, .75] } });
field.splats(B, 'age', { kind: 'contours', options: { levels: [.5] } });

const density = field.density('age', {
  bounds: { min: [0, -.3, 0], max: [1, .3, 1] },
  map: age => Math.max(0, .65 - age)
});
const mist = K.atmosphere.field({ field: density, color: '#45a592' });
```

## Publish channels

- `sample(...point)` returns a record with the named values. Call
  `read(...point)` to get all channels from one evaluation. You can supply
  `sampleChannel(name, ...point)` instead when adapting a generator that
  already samples channels by name. When both functions are supplied,
  `sample(name, ...point)` uses the channel sampler and `read` uses the
  record sampler.
- The default `type` is `'number'` and requires finite values. Optional
  `units` describe the quantity and `range: [low, high]` sets the default
  pigment range. The range is descriptive, so sampling preserves values
  beyond it.
- `'category'` supports string IDs and safe integers. `'rgb'` accepts
  packed RGB, six-digit hex colors, and normalized RGB triples. Samples
  return immutable normalized RGB triples. `'vec2'` and `'vec3'` hold
  finite vectors.
- A missing channel or out-of-bounds point samples as `null`. Zero and
  category ID `0` are valid values. Channel names are in `field.channels`,
  and `field.info(name)` returns the channel descriptor.

## Route a channel

| Method | Output |
| --- | --- |
| `pigment(name, { ramp, colors })` | A native-coordinate paint callback returning packed RGB. Numeric ramps use `{ stops: [[value, color], ...], interpolation }`. Category lookup uses a `colors` object keyed by ID. Missing values and unmapped categories are transparent. An RGB channel supplies color directly. |
| `relief(name, options)` | A textured UV mesh displaced along the carrier normal by `offset + scale * value`. For a 2D field, the default coordinates are the carrier's UVs. For 3D, the default is its original world position. A `project({ uv, position })` callback can place the field. The missing height defaults to zero. |
| `density(name, options)` | A bounded density for `K.atmosphere.field`, `K.procedural.density.scatter`, and density meshing. Missing and negative values have zero density. `scale` multiplies positive samples. A 2D field needs XYZ bounds with thickness to create a volume. |
| `view(name, { kind, source, options })` | A slice, contour paths, an isosurface mesh, vector glyphs, streamlines, or line integral convolution. For geometry, use `kind: 'isosurface'` and read `.mesh` on the result. |
| `splats(B, name, { kind, source, options, id, style, maxSplats })` | Native splats from the selected view, using the same styles and budgets as `K.fieldViews.stamp`. |
| `source(name, options)` | A bounded XYZ scalar or vector source for any `K.fieldViews` method. |
| `scalar(name, { map, missing })` | A native-coordinate scalar callback usable in consumers such as `K.procedural.fabrication.shell` and `stack`. |
| `projected()` | A fixed-frame numeric field for `B.finish({ surfaceEffects: { fields: { name: field.projected() } } })`. Use a projected layer's channel settings to select a value. |

`source`, `density`, and the `source` option on `view` and `splats` accept
`{ bounds, project, map, units, components }`. A 3D field defaults to its
native XYZ box. A 2D field defaults to an XZ slice at Y = 0. To place it
elsewhere, supply XYZ bounds and `project([x,y,z])` returning the native
coordinates or `null`. `components` places a 2D vector in XY, XZ, or YZ.
A scalar `map(value, ...point)` gives numeric meaning to a category or
vector when a method needs a scalar. For instance, map a selected species
to `1` and the others to `0` to extract that species alone.

## Built-in generators

- `K.procedural.complexPlane.compile(...).outputs({ bounds })` exposes
  `escapeTime`, `basinId`, `iterations`, `status`, `phase`, `logMagnitude`,
  `rgb`, and one channel named `trap:<id>` per authored trap.
- A spectral `frame(time).outputs()` exposes signed displacement,
  quadrature, magnitude, phase, and energy at the captured time.
- A competitive-growth `frame(time).outputs()` exposes arrival, age,
  material ID, and seed ID. Unclaimed locations have missing values.
- A phase-change `frame().outputs()` exposes authored state channels and
  the color, roughness, and relief of any authored finish.

[One Field, Six Outputs](../examples/shared-field-outputs.js) renders the
same rosette as paint, raised relief, contours, volumetric density, splats,
and an isosurface. The density panel uses the software volume renderer.
In WebGL scenes, use the same density as a placement mask for volume
splats via `K.procedural.density.scatter`.

```sh
node cli/ink-studio.js render examples/shared-field-outputs.js --w 1120 --h 700 --px 1 --out shared-field-outputs.png
```
