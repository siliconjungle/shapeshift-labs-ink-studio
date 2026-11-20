# Projected splat effects

Projected effects draw animated pixel images and procedural patterns on
splat surfaces. A layer can read a shared field for its color, coverage, or
coordinate warp. Particle emitters can use the same path or read that field
to decide where to spawn. All of the effects render on the scene's art-pixel
grid before the optional text pass in the CPU renderer. Browser hosts can
use the shared fields and material samplers to integrate these layers into
their own pipeline. See the [WebGL renderer coverage](browser-renderer.md#feature-coverage).

Try [Tidal signal](../examples/surface-effects.js) for a moving projected
image, a revealing ribbon, ripples and sparks. [Edge shedding](../examples/edge-shedding.js)
shows particles leaving the lit edges of a solid.

```sh
node cli/ink-studio.js clip examples/surface-effects.js --from 0 --to 4.4 --fps 12
node cli/ink-studio.js clip examples/surface-effects.js --from 0 --to 4.4 --fps 12 --text braille --tg 1
node cli/ink-studio.js clip examples/edge-shedding.js --from 0 --to 3 --fps 16
```

The text pass accepts `ascii`, `symbols`, `braille` and `blocks` in
`render`, `sheet` and `clip`. The still renderer writes a text file beside
the PNG. The clip writes an animated PNG and a text file with form feeds
between frames. In scene-color mode the text pass uses the frame's output
palette, including local effect colors. A layer's `ink: true` marks fine
details for the text pass. Emitter dots are marked automatically. Smaller
`--tg` values give the text more spatial detail.

## Fields

Call `K.splatEffects.field(options)` to create a bounded grid of named scalar
channels in `[u, v]` coordinates. A JSON scene can put the same options under
`finish.surfaceEffects.fields` and include both `stamps` and `strokes`.
In JavaScript, `B.finish({ surfaceEffects: { fields: { wake } } })` accepts
either a constructed field or its definition.

```js
const wake = K.splatEffects.field({
  width: 96,
  height: 48,
  origin: [-2.4, -1.2],
  cell: 0.05,
  channels: {
    reveal: { decay: 0.12 },
    wake: { decay: 1.6 },
    flowU: { combine: 'sum', decay: 2 },
    flowV: { combine: 'sum', decay: 2 }
  }
});
wake.stamp({
  at: [0, 0], time: 0.5, radius: 0.16,
  shape: 'ring', speed: 0.8, width: 0.10, lifetime: 1.5,
  values: { wake: 0.8 }
});
wake.stroke({
  keys: [[0.5, 0, 0], [2.5, 1.8, 0.24]], spacing: 0.04,
  radius: 0.48, velocity: [-0.16, 0.05],
  values: { reveal: 1, wake: 0.6, flowU: -0.1, flowV: 0.04 }
});
```

Stamps have a time, radius, and one or more channel values. A disk covers
its interior. A ring spans a band around its radius. In both cases `speed`
grows the radius and `velocity` moves the center. Channels use exponential
`decay` per second and max or sum blending. Use sum for signed values such
as flow components. A stroke interpolates between timed UV keys and stamps
the result. Give transients a lifetime when they should stop contributing.

`field.frame(time)` is independent of earlier render times. Read a named
channel with `frame.sample(name, u, v)`, or copy its grid with
`frame.data(name)` for a host renderer. Calling `stamp`, `stroke`, or
`clear` invalidates future snapshots. The revision number lets an effect
detect a change even while the scene is paused. Hosts can also provide their
own field with `channels`, `revision` and `frame(time).sample(name, u, v)`,
including a wrapper around an existing fluid solver.

## Surface layers

Set `type: 'projected'` on an ordinary named material layer. The ray sample
supplies its unwarped position on the surface. `space: 'rest'` pins paint
to the object, including rigidly posed parts. `space: 'world'` keeps the
projection in scene coordinates so objects can move through it. A browser
host can supply both `position` and `worldPosition` to `SurfaceLook.shade`.

- **Projection** can be a plane, cylinder, or ribbon. Plane axes default to X
  and Z. A cylinder uses its up axis and returns distance around its
  circumference and height. A ribbon takes 2–64 XYZ centerline points and
  returns station and signed distance across the closest segment. A JS
  projection callback can provide coordinates from any available chart.
- **Field sampling** uses `field` with optional `maskChannel`,
  `revealChannel`, `contourChannel`, or `warpChannels: [u, v]`.
  `maskChannel` fades the paint, while `revealChannel` also fades the
  underlying surface. `range: [low, high]` controls the transition.
  `warp` scales the coordinate distortion and `scroll` adds motion.
  Existing surface finishes can also use
  `mask: { type: 'field', field, channel, projection, range }`.
- **Patterns** include `solid`, `stripes`, `hatch`, `chevrons`, `rings`,
  `dots`, `checker`, and `contour`. Contours read `contourChannel`.
  `scale` sets the repeat in projection units. `width` and the art-pixel
  footprint control line coverage. `colors` maps a field channel through
  an ordered ramp. Use `blend: 'mix'`, `'add'`, or `'multiply'`.
- **Output palette** optionally limits the dominant paint at a pixel to its
  own set of colors after depth compositing. Different layers can have
  different palettes. `--raw` exposes the blended lighting and paint
  before output palette selection. In ordinary color and stipple, dominant
  local palette regions use the same art grid as the rest of the scene.

### Paint before or after lighting

Set a projected color layer's `stage` to `material` to paint the base
before the renderer restores its lighting. This also works for tint and
color transfer layers. The default `lit` paints on the shaded surface.

Material paint layers run in their authored order before lit finish layers.
They keep geometric lighting and use the scene's output resolve. To protect
an emissive graphic across compositing and grading, use a
[scoped final palette rule](pixel-look.md#explicit-render-stages)
with the graphic's swatches. The [harbour signal works](../examples/palette-placement.js)
shows both placements with the same indexed artwork.

### Banded pigment

Use `pattern: 'bands'` and `bandChannel` to turn a sampled field into
distinct areas of color. Stops have increasing thresholds from 0 to 1.
The highest threshold reached by a sample supplies its color. Below the
first stop, the layer leaves the material visible. The optional edge paints
a strip just inside the first threshold. Its width uses field units.

```json
{
  "type": "projected",
  "field": "ink",
  "pattern": "bands",
  "bandChannel": "density",
  "bands": {
    "stops": [
      {"at": 0.04, "color": "#714451"},
      {"at": 0.09, "color": "#a35a56"},
      {"at": 0.16, "color": "#ce7958"},
      {"at": 0.27, "color": "#efac68"}
    ],
    "edge": {"width": 0.016, "color": "#ffe5a3"}
  }
}
```

Use hex colors or scene palette indices. The band colors supply the
layer's output palette unless you provide an explicit one. Existing layer
strength, masks, and blending still apply. The [pigment basin](../examples/banded-pigment.js)
feeds the layer with a stable-fluid grid sampled at the scene time. Its
floating emitter supplies dye while the basin walls and central rock shape
the current.

Use the same `bands` settings on `K.atmosphere.field` for bounded smoke.
Each band uses its threshold as its local density and its swatch for
scattering. The edge keeps the first band's density and uses its own color.
Light and transmittance still accumulate through the volume, so overlapping
smoke can blend across bands. This option takes the place of the volume's
`ramp` in the CPU renderer.

```sh
ink-studio clip examples/banded-pigment.js --w 224 --h 168 --px 1 \
  --from 0 --to 6 --fps 12 --out basin.png
ink-studio clip examples/banded-pigment.js --params '{"study":"smoke"}' \
  --w 224 --h 168 --px 1 --from 0 --to 6 --fps 12 --out censer.png
```

Use `--params '{"banded":false}'` for the basin's smooth comparison.
Add `"study":"smoke"` to compare the censer with continuous density.

### Raster paint

To project animated pixel art, use `pattern: 'raster'` and
`raster: { width, height, frames, fps, channels, repeat, wrap }`. Frames are
RGB or RGBA byte arrays, in row-major order, with the default of four
channels. Each frame maps to one unit tile after applying `scale`. Samples
use nearest texels and honor RGBA transparency. `repeat` loops frame time
and `wrap` repeats the tile in the projection.

### Indexed rasters and palette cycling

Use `pattern: 'indexed'` to paint a projected layer with explicit indices from
the scene palette. The raster is one row-major list of `width × height` slots.
A `null` texel leaves the underlying finish visible. Slot `0` is ordinary paint.
The tile is sampled with nearest texels. `size: [u, v]` sets its dimensions in
projected units before the layer's uniform `scale`. It defaults to `[1, 1]`.
Use `wrap: true` to repeat the tile. A wrapping one-texel tile also works with
an ordinary material mask to cycle a whole region.

```json
{
  "type": "projected",
  "pattern": "indexed",
  "projection": { "origin": [0, 2, 0], "across": [0, -1, 0] },
  "raster": {
    "width": 4, "height": 2, "size": [2, 0.25],
    "slots": [4, 5, 6, 7, null, 4, 5, null]
  },
  "cycles": {
    "copper-glint": { "role": "copper", "period": 1.6, "direction": "forward", "phase": 0.25 }
  }
}
```

- Each named cycle selects an ordered palette role or an explicit `slots`
  list. It needs at least two distinct indices. Within one layer each index
  can belong to one cycle.
- `period` is the time in seconds for a full rotation. Each step lasts
  `period / number of slots`. The default `direction` of `forward` selects
  the next swatch for each painted index. Use `reverse` to select the
  previous one. The apparent direction depends on the order you paint the
  indices into the image.
- `phase` is a fraction of one rotation and defaults to zero. The sampler
  reads the scene clock directly, so scrubbing and rendering frames out of
  order produce the same steps. Omit `cycles` to show the static image.
- Cycle membership is local to the layer. Paint with an unlisted slot, leave
  a hole, mask a region, or use a separate material to hold a color still.
  By default the projected layer contributes its exact swatches to palette
  resolution. As with other projected layers, strength, blending, fog and
  later grading can change the visible color.

Use indexed rasters in the Node renderer and CLI, or through the shared
surface sampler in browser hosts. The default WebGL renderer uses its
existing [surface finish coverage](browser-renderer.md#feature-coverage).

[Fernfall](../examples/palette-cycling.js) uses separate cycles for the
waterfall, the foam at its base and ripples in the pool. Use `--params '{"cycle":false}'` to
render its painted indices at rest.

```sh
ink-studio clip examples/palette-cycling.js --from 0 --to 6 --fps 12 \
  --w 216 --h 144 --px 1 --out fernfall.png
```

### Hue–brightness fields

Set `pattern: 'hue-brightness'` and give the layer a `hueBrightness` definition. The lower-left corner comes from the projection origin. Hue increases along `along` and brightness increases along `across`. Use rest space to keep the field attached to an object.

```json
{
  "type": "projected",
  "pattern": "hue-brightness",
  "projection": { "origin": [0, 1, 0], "along": [1, 0, 0], "across": [0, 1, 0] },
  "hueBrightness": {
    "palette": ["#172930", "#386c75", "#7ab7b3", "#d6d2a5", "#ec8b5e"],
    "saturation": 0.6,
    "brightness": [0.12, 0.92],
    "size": [2, 1]
  }
}
```

`size` defaults to `[1, 1]` in projection units before the layer's scale. The paint covers that rectangle. Set `wrap: true` to tile it. In a material the palette can also contain scene palette indices. Its swatches supply the layer's output palette by default, and the usual mask, strength, blend, and target palette precedence apply. The pattern is available in headless exports and through the shared `SurfaceLook` sampler.

### Polar colour fields

Use `pattern: 'polar-colour'` with a `polar` definition on a projected layer. The disk fits the shorter side of `size` in projection units, centred inside that tile. Hue starts at the right and increases toward the projection's `across` direction. The underlying material shows through outside the disk. Use `wrap: true` in `polar` to repeat the tile, or ordinary layer masks and strength for seals, irises, instrument dials, and light-like surface projections.

```json
{
  "type": "projected",
  "pattern": "polar-colour",
  "polar": {
    "palette": ["#502d55", "#7250a3", "#3799a8", "#ca6b5c", "#ffe9c4"],
    "radial": "saturation",
    "brightness": 0.9,
    "rotation": 0.25,
    "size": [2, 2]
  }
}
```

The layer defaults to its field's swatches as the output palette. As with rectangular palette fields, it is available in headless exports and through the shared `SurfaceLook` sampler. See [library and CLI controls](palette-recipes.md#polar-colour-fields).

### Palette coverage fields

Use `pattern: 'palette-coverage'` and pass the [coverage field definition](palette-recipes.md#palette-coverage-fields) as `coverage`. The defaults apply the nearest-swatch mosaic to a one-unit square. Use `size: [width, height]` inside `coverage` to fit the tile, and `wrap: true` when the pattern should repeat.

```json
{
  "type": "projected",
  "pattern": "palette-coverage",
  "projection": { "origin": [0, 0, 0], "along": [1, 0, 0], "across": [0, 1, 0] },
  "coverage": {
    "space": "oklab",
    "palette": ["#1b324f", "#267f87", "#ecb760", "#b95572"],
    "edge": { "width": 0.004, "color": "#151822" },
    "size": [2, 1.5]
  }
}
```

The layer can also show the error or boundary view. Its output palette defaults to the colours actually used by that view, including leading when present. The normal projection, mask, strength, and blending settings apply. The layer runs in headless exports and through the shared `SurfaceLook` sampler.

### Palette ramps

Use `pattern: 'palette-ramp'` to project a [spectrum or primary ramp](palette-recipes.md#spectrum-and-primary-ramps) or a [grayscale match](palette-recipes.md#grayscale-and-brightness-matches) onto a surface. Put the ramp definition inside `paletteRamp`, use `axis: 'along'` for the first projection axis or `axis: 'across'` for the second, and set `size: [width, height]` in projection units. The layer affects that rectangle unless `wrap: true` repeats it. Finite bands or palette-constrained ramps supply their output swatches to the existing surface finish.

```json
{
  "type": "projected",
  "pattern": "palette-ramp",
  "projection": {"origin": [-1, 0, 0], "along": [1, 0, 0], "across": [0, 1, 0]},
  "paletteRamp": {"type": "primary", "accent": "#28a796", "steps": 12, "axis": "across", "size": [2, 1]}
}
```

A `colorCurve` layer can also apply a `paletteRamp` to the material's lit luminance. Use the usual `source` setting to read height, depth, or a scene field instead. A palette ramp takes the place of the curve's authored `ramp`, `channels`, and colour-space settings.

```json
{
  "type": "colorCurve",
  "source": "luminance",
  "paletteRamp": {
    "type": "grayscale",
    "metric": "lightness",
    "palette": ["#171728", "#294b73", "#24847e", "#f4c46e", "#f7edda"]
  }
}
```

### Projected chroma fields

Use `pattern: 'chroma-field'` with a [complementary or desaturation definition](palette-recipes.md#complementary-and-desaturation-fields) in `chromaField`. The colour path follows the `along` projection axis and the shadow mix follows `across`. Fit it with `size: [width, height]` in projection units or set `wrap: true` to repeat it. Combine the layer with masks, strength, or specular highlights through the existing surface finish.

```json
{
  "type": "projected",
  "pattern": "chroma-field",
  "projection": {"along": [1, 0, 0], "across": [0, 1, 0]},
  "chromaField": {
    "type": "complementary",
    "color": "#f39a57",
    "opposite": "#3998a6",
    "shadow": "#362839",
    "shade": [0.77, 0],
    "size": [2, 3]
  }
}
```

### Indexed palette charts

Make a [palette chart](palette-recipes.md#swatch-and-mix-charts) with `K.palette.chart()` and place its indexed raster on any projected surface. Chart texels have their own palette and top-left row order. Set `size` in projection units to fit the object.

```js
const chart = K.palette.chart({ type: 'closest-pairs', palette, limit: 6 });
const layer = {
  type: 'projected',
  pattern: 'indexed',
  projection: { origin: [-1, 0, 0], along: [1, 0, 0], across: [0, 1, 0] },
  raster: chart.indexed({ size: [2, 1] })
};
```

Use the `raster` object from `palette chart --format data` for the same operation in JSON. An indexed raster can supply its own `palette` of hex colours, normalized RGB triples, or scene palette indices. Its slots then address that list in order. With no local palette, slots address the scene palette directly. Rows default to `origin: 'bottom-left'`. Chart assets set `origin: 'top-left'`. Explicit slot cycles work with an embedded palette, and `null` slots leave the material visible.

### Drive palette fields with scene data

Declare [surface signals](surface-materials.md#drive-finish-properties) on the material, then bind them to a projected palette field with `axes`. Each binding takes a named `signal` and an output `range` that defaults to `[0, 1]`. A signal's own range and interpolation normalize its input before the axis range is applied. Reverse an output range to reverse its effect. Missing sample data uses the first value in the output range.

- `hue`, `brightness`, and `saturation` are available on hue–brightness and polar colour layers. Hue uses turns and wraps. Brightness is HSV value.
- `u` and `v` are normalized coordinates available on projected hue–brightness, polar, coverage, chroma fields, and palette ramps. They replace the corresponding projected sampling coordinate inside the existing rectangle. Polar fields keep their disk coverage.
- Signals can read a world or rest axis, directional light, retained weather, time, a painted texture channel, a projected field, or a world query. A `light` signal reads the clamped surface-facing directional light multiplied by the sample's sun visibility. Weather signals read the retained surface channels, such as wetness, where the sample is shaded.

```json
{
  "signals": {
    "course": {"type": "axis", "axis": "y", "space": "world", "range": [0.4, 3.2]},
    "sun": {"type": "light", "range": [0.03, 0.6]},
    "wet": {"type": "weather", "channel": "wetness", "range": [0.012, 0.29]}
  },
  "layers": {
    "glaze": {
      "type": "projected",
      "pattern": "hue-brightness",
      "projection": {"along": [1, 0, 0], "across": [0, 1, 0]},
      "hueBrightness": {
        "palette": ["#928a7b", "#f1e3c9", "#49a3a0", "#87b6c6"],
        "size": [8.5, 3.1]
      },
      "axes": {
        "hue": {"signal": "course", "range": [0.43, 0.61]},
        "brightness": {"signal": "sun", "range": [0.57, 0.98]},
        "saturation": {"signal": "wet", "range": [0, 0.94]}
      }
    }
  }
}
```

The [rain-glazed terrace](../examples/palette-field-weather.js) uses those three bindings on a tiled wall. A red-channel paint mask drives the hue of the wave sign. Export matched dry and damp frames with the CLI.

```sh
ink-studio render examples/palette-field-weather.js --w 336 --h 160 --px 1 --raw --t 0 --out terrace-dry.png
ink-studio render examples/palette-field-weather.js --w 336 --h 160 --px 1 --raw --t 3.1 --out terrace-damp.png
```

### Author a shader in JavaScript

A layer can name a shader from `surfaceEffects.shaders` or use a function as
`pattern`. The same surface sampler runs in the Node toolkit and in the
browser bundle.

```js
function wakeInk({ x, y, time, field }, out) {
  const stripe = Math.sin((x + y) * 12 - time * 5);
  out[3] = Math.max(0, stripe) * Math.min(1, field('wake'));
}
```

The function receives projected `u`, `v`, scaled and warped `x`, `y`,
`time`, the full surface sample, the color so far as `base`, and
`field(name)` for the unwarped location. It writes
`[r, g, b, amount, coverage, ink]` into a supplied array. The initial RGB
comes from the layer tint or ramp. Return synchronously and leave
components you don't need at their initialized values. For GPU hosts,
field snapshots expose the grid data and dimensions. A host shader can
upload those grids and pass the resulting composited color to the existing
ASCII shader. The JavaScript callback API runs on the CPU.

## Emitters

Create `K.splatEffects.emitter(B, options)` before finishing the builder and
add it to the stage. Its `source(birthTime, serial, random)` supplies a
position, optional surface normal, and optional normalized RGB. It can
return null for a rejected birth. Use an analytic path when the source
itself moves. Size, rate, birth interval, lifetime, outward speed, drift,
gravity, spread and density are configurable. The same seed and birth
time reproduce the same particle on a later render.

Use `K.splatEffects.surfaceSource(world, options)` to select baked splats
with surface bindings. Select by binding ID, material `surface.name`, or
explicit indices. Supply an eye and `grazing` for visible grazing normals,
`minLuma` for bright regions, and `lit: true` to evaluate the finish.
An optional `weight(hit)` callback can also read a field or evaluate a
material mask. The emitter inherits the source RGB unless `color`
supplies a scene palette index or an index callback. The source sampler
can also be used independently of the emitter.

For one-shot debris, `K.deform.burst({pieces, from, speed, gravity, drag,
life, shrink})` already computes analytic motion for authored piece
centers. Sample it directly with `burst.piece(index, seconds)` to get a
`{point, scale}` without a nearest-piece search. Sample times can be in
any order. For packed splats, move the center to `point` and multiply
the covariance by `scale * scale`. The [interactable locks example](../examples/interactable-locks.js)
uses this on an effects frame after publication and keeps the collision
and navigation revision independent of the airborne fragments.
