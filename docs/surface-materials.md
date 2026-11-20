# Surface materials

For shared roughness, metalness, IOR, transmission and coating controls, see
[consistent material controls](material-controls.md). They compile into these
finish layers and the existing optical system, and can be edited on baked bindings.

A surface finish is an ordered list of effects evaluated as the camera moves. Use it with the same sculpt materials, colour ramps and procedural patterns you already use. The headless renderer evaluates opaque layers at the art-pixel sample in per-pixel scenes. It also shades ordinary splats and composites translucent finishes over opaque surfaces.

## Start with a preset

```js
const steel = K.surface.preset('brushed-steel', { r: [1, 2, 3] }, {
  direction: 'y',
  layers: {
    brush: { roughness: [0.12, 0.55], color: '#dceeff', strength: 0.85 },
    varnish: { type: 'specular', roughness: 0.12, strength: 0.25 }
  }
});
S.ball([0, 1, 0], 0.8, steel, { res: 0.07 });
```

`preset(name, base, overrides)` returns a new material. The base can be a material object or a palette ramp. A base material's existing surface settings and the supplied overrides merge over the recipe in that order. Preset values are isolated from edits to the result. Change a layer by its name, add a new one, or set an existing one to `false` to disable it. Layer names and defaults are listed in [the preset definitions](../src/kit/kq-surface-presets.js).

Use `K.surface.material(base, settings)` to create or extend a finish directly. For example, this waxed surface has a highlight across the grain and a softer warm rim.

```js
const waxed = K.surface.material({ r: [4, 5, 6] }, {
  direction: [0, 1, 0],
  layers: {
    wax: { type: 'specular', roughness: [0.09, 0.35], strength: 0.7 },
    rim: { type: 'sheen', color: '#ffd9a1', power: 2, strength: 0.28 }
  }
});
```

For per-pixel rendering set `S.pixel = true` before baking and set `look: { pixel: true }` on the finished world. The ordinary splat path evaluates simple finishes at splat centres and bevel highlights at the art-pixel sample. An optional surface finish takes over from the material's baked `gloss`.

## Shared settings

- **Direction** accepts `'x'`, `'y'`, `'z'`, an XYZ vector, or a JavaScript function `(position, normal) => direction`. The shader projects it onto the surface. Use `{ type: 'circular', axis: 'z' }` for concentric grooves or `{ type: 'weave', along: 'x', across: 'y', scale: 0.2 }` for alternating directions. A splat can supply a local tangent, such as a strand in combed fur.
- **Origin, scale and seed** set the reference frame for the material pattern. Sample positions are relative to `origin` and divided by `scale`. The seed keeps random-looking details repeatable and attached to the same positions.
- **Normal variation** uses `normal: { type: 'noise' | 'waves', amplitude, scale, axis, cross, speed }`. Wave speed is in radians per second. The shader softens fine variations as they become smaller than an art pixel.
- **Ripple sources** use `normal: { type: 'rings', amplitude, scale, speed, width, damping, drops }`. Each drop has an `at` position in the material's coordinate frame and an optional `start`, `repeat` and `strength`. Rings travel at `speed` units per second, with `scale` controlling wavelength and `width` controlling the wave packet. The same surface layers respond as the rings move. [Beacon pool example](../examples/beacon-pool.js)
- **Opacity** optionally scales the base material's alpha with `opacity: { facing, grazing, power }`. Set `a` on the base material for translucency and use values from zero to one for the two multipliers. Setting `glass: true` also uses the renderer's existing glass distortion.
- **Layer controls** include `strength` from zero to one, `rotation` in radians, and `steps` for stepped highlights. Colours can be palette indices, hex strings or normalized RGB triples. A layer's `shadow: false` lets it use the direct light in baked shadow.
- **Layer masks** include `{ type: 'noise', scale, low, high, seed }`, `{ type: 'stripes', axis, scale, width, phase, feather }` and `{ type: 'checker', axis, cross, scale }`. Use `invert: true` to swap the painted and bare regions. In JavaScript a layer may also use `mask(x, y, z, frame)` returning coverage from zero to one. It receives the unscaled rest-space position and a geometric frame with `normal`, `tangent`, `bitangent`, and `footprint`. This lets a mask share contact fields with sculpt materials or filter subpixel patterns. See [material mapping](./procedural.md#material-mapping-ramps-and-distance-ink).

| Layer type | Controls |
| --- | --- |
| `diffuse` | Map the direct-light response through a material lighting ramp. |
| `detailKit` | Add a rest-space pattern with scale-aware filtering and optional geometry and exposure masks. |
| `tint` | Apply a constant `color` using `blend: 'mix'`, `'add'`, or `'multiply'`. |
| `bevel` | Highlight sculpted ridges and creases within a configurable art-pixel reach. |
| `transmission` | Add tinted backlight through a thin sheet using its thickness and incident light. |
| `specular` | Set `roughness` to one value or to `[along, across]` to shape the reflected highlight. Set `color` for a tinted highlight. |
| `fiber` | Set `roughness`, `shift` and optionally `figure`, `axis` and `scale` for tilted fibres with a moving band. |
| `localReflection` | Sample a named [local reflection probe](scene-optics.md#local-reflection-probes). Set scalar or along/across roughness. |
| `reflection` | Approximate sky, horizon and ground reflection with `sky`, `horizon` and `ground` colours. Use `f0` and `power` to shape the facing-to-grazing response. |
| `sheen` | Choose a grazing `color` and control its width with `power` and its grain bias with `directional`. |
| `film` | Set `thickness` and `variation` in nanometres, `ior`, `scale` and optional `colors`. Set `flash` for an angle-limited flash or `axisBias` to steer the effect toward the grain. |
| `diffraction` | Configure groove `spacing` and `bandwidth` in nanometres, diffraction `order` and the angular `roughness` across the effect. |
| `directionalColor` | Blend between `color` and `crossColor` according to the grain and view. Set `width` and `bias` to tune the shift. |
| `glints` | Set cell `scale`, candidate `density`, inset `radius`, normal `tilt`, angular `roughness` and one `color` or a list of `colors`. A lower `response` makes faint glints more visible. Glints are deterministic, fade at subpixel size, and can survive the pixel cleanup pass. |

These are stylized reflectance models. The CLI resolves them into the scene palette and uses its existing baked direct-light visibility. Subtle tones can share the same palette entry, so include colours for any highlights you want visible in the final render.

## Surface detail kits

Add named `detailKit` layers to a surface finish in JavaScript or diorama JSON. A finish can travel with its material definition or be shared between several solids. Layer order matters. Put plaster above brick to expose brick through chips, or put moss above stone joints to grow it in the mortar. The headless renderer samples the patterns at the visible surface in its rest frame and filters details against the native art-pixel footprint.

```js
const wall = K.surface.material({ r: [3, 4, 5, 6] }, {
  layers: {
    brick: { type: 'detailKit', pattern: { recipe: 'exposed-brick', size: [.48, .23], width: .05 } },
    plaster: { type: 'detailKit', pattern: { recipe: 'chipped-plaster', coverage: .57, seed: 9 } },
    moss: { type: 'detailKit', pattern: { recipe: 'crevice-moss', width: .16,
      exposure: { channel: 'rain', range: [.2, .85], invert: true } } }
  }
});
```

| Recipe | Controls |
| --- | --- |
| `stone-joints` | Staggered blocks with dark joints, lit lips, and variation in the original stone. |
| `exposed-brick` | Set brick dimensions with `size`, mortar width with `width`, and row offset with `stagger`. |
| `chipped-plaster` | Set patch sizes with `size`, intact plaster with `coverage`, and the chipped lip with `width`. |
| `roof-seams` | Set the course and tile spacing with `size`. Align `axes` to the roof slope. |
| `cloth-stitching` | Set stitch pitch with `size[0]` and place the seam with `origin`. Enable `repeat` for rows spaced at `size[1]`. |
| `crevice-moss` | Select `crevices: 'geometry'\|'joints'\|'both'`. `width` sets the reach from a sculpted recess. Geometry mode follows the source SDF. Joint mode uses earlier course layers on the same finish. |

Dimensions are in material units, using the surface's existing `origin` and `scale`. A pattern can add its own `origin` and two perpendicular `axes`. Each axis accepts `x`, `y`, `z`, or an XYZ vector. Stone and brick pick the projection plane from the surface normal by default. Use `normal: { axis, range: [from, to] }` to gate a layer by the normal's alignment. `exposure` uses the current scene's `rain`, `light`, `fog`, or `wind` access. Combine it with the usual layer `mask` and `strength` for local exceptions.

The three optional `colors` supply the seam or chip, the body, and the lit rim. `seed` controls repeatable variation. Set `fade: [start, full]` in art pixels to control when the smallest marks fade. Crevice moss can also use a retained [surface weather mask](retained-weather.md#put-it-on-a-material) to reflect local conditions.

Compare the [courtyard scene](../examples/surface-detail-courtyard.js) with `--surface-detail-kits off` or pass `surfaceDetailKits: false` to `render`.

```sh
node cli/ink-studio.js render examples/surface-detail-courtyard.js --w 372 --h 204 --px 1 --out courtyard.png
```

## Material lighting ramps

Use a `diffuse` finish layer to give a material its own transition from
shadow to direct light. A `lightingRamp` can also tint and shape the response
of a `specular`, `sheen`, `fiber`, `glints`, or `bevel` layer. The effects run in layer
order, so put the diffuse layer before highlights or projected paint it
should sit beneath.

```js
// scene palette role: cloth: [8, 9, 10, 11] (shadow to highlight)
const cloth = K.surface.material({ r: [8, 9, 10, 11] }, {
  layers: {
    diffuse: {
      type: 'diffuse', strength: 0.85,
      lightingRamp: { role: 'cloth', positions: [0, 0.18, 0.46, 1], interpolation: 'smooth' }
    },
    nap: { type: 'sheen', strength: 0.25, color: 10, power: 2 }
  }
});
```

- Reference a scene `role` with two or more swatches. Use the scene's `roles`
  in JSON and pass `paletteRoles` to `B.finish()` in JavaScript. Stops are evenly
  spaced unless you supply one `positions` entry per swatch.
- Use `stops: [[0, 8], [0.4, "#744b43"], [1, 11]]` for explicit palette indices,
  hex swatches, or normalized RGB triples. Stop positions must increase
  within zero to one. Values outside the stop range use the closest endpoint.
- Set `interpolation` to `linear` (the default), `smooth`, or `step`. For
  stepped ramps each stop's color holds until the next stop.
- Optional `weights` supply one blend value from zero to one per stop, using
  the same interpolation. By default a diffuse ramp uses the layer's full
  strength and a highlight uses its original angular response. Explicit
  highlight weights must start at zero so an inactive highlight stays dark.
- Diffuse ramps use the angle to the directional light and the existing
  shadow visibility. Specular ramps keep the layer's `roughness` control.
  Use the layer's mask or strength to blend with the underlying shading.
  Disable a diffuse layer by setting its named slot to `false`, or clear a
  highlight ramp with `lightingRamp: false`. A ramp override replaces its
  configuration as a unit.

Ink resolves the resulting colors through the usual export palette.
For custom hosts, pass `{ paletteRoles }` as the fifth argument to
`SurfaceLook.prepare`. Render the headless example to compare cloth, iron,
and worn stone under a shared key light.

```sh
node cli/ink-studio.js render examples/material-lighting-ramps.js --w 288 --h 128 --px 1 --t 0.75
```

To choose swatches from an existing palette, [generate and approve an editable lighting draft](palette-recipes.md#suggest-editable-lighting-ramps). The approved five-stop role and positions plug into the same diffuse layer, and named bounce and neutralizer swatches can also tint other finishes.

## Bevel highlights

Add a `bevel` finish layer to catch light along features in a native sculpt.
Use a narrow warm tint for copper rims, a broader band for chips in stone,
or a lower bend threshold for soft folds in cloth.

```js
const copper = K.surface.material({ r: [6, 7, 8, 9] }, {
  layers: {
    rim: { type: 'bevel', width: 2, minBend: 0.12, strength: 0.85,
      lightingRamp: { role: 'copper-edge' } }
  }
});
```

- `width` is the search reach in art pixels and defaults to 1.5. The
  supported range is 0.25 to 8. The renderer uses the camera projection
  and sample depth, so changing export scale keeps the reach in art pixels.
- `edge` defaults to `convex` for raised rims and fold ridges. Choose
  `concave` for creases or `both` for raised and recessed detail.
- `minBend` sets the minimum signed-distance departure per unit of reach.
  It defaults to 0.13. Lower values bring out gentler curves.
  `softness` is the falloff interval above that threshold and defaults to 0.42.
- Set `color` or a `lightingRamp`, and use the usual `strength`, `mask`,
  `steps`, and `shadow` controls. Lower `power` softens the falloff away
  from the light. Disable the layer by setting its named slot to `false`.

The sculpt retains its distance source automatically when a material uses
a bevel. Sculpts with grouped solids and cutouts share their combined field.
The headless renderer samples bends from that field and leaves the
original geometry and coverage in place. Custom hosts can supply
`sample.bevelDistance(x, y, z)` in the frame of `sample.position` and
`sample.artFootprint` as the world-space reach of one art pixel before
foreshortening.

The [specimen board](../examples/material-bevel-highlights.js) can be
rendered with the finishes enabled or disabled at the same resolution.

```sh
node cli/ink-studio.js render examples/material-bevel-highlights.js --w 338 --h 132 --px 1
node cli/ink-studio.js render examples/material-bevel-highlights.js --w 338 --h 132 --px 1 --surface off
```

## Thin-material transmission

Add a `transmission` layer to glow where a light reaches the far side of a
sheet. The layer adds colored light in linear space using the sheet's
normal and the direction to the viewer. It works on either side and
preserves the material's opacity and coverage.

```js
const paper = K.surface.material({ r: [15, 16, 17] }, {
  layers: {
    through: { type: 'transmission', source: 'local',
      color: '#ffdda0', strength: 0.75, thickness: 0.16 }
  }
});
const world = B.finish({
  cam,
  lights: [{ p: [0, 1, 0], radius: 2, intensity: 1.7, color: [1, 0.7, 0.35] }]
});
```

- Set `source` to `sun` for the finish light direction, `local` for
  scene point lamps, or `both` to combine them. The default is `both`.
  The directional source follows the live sun when enabled and the
  surface light track otherwise. Point lamps use the existing radius,
  color, and daylight schedule.
- `color` and `strength` control the tint and gain. `thickness` is
  optical depth and defaults to 0.24. Thicker or more oblique paths
  pass less light. `wrap` softens the transition around grazing angles
  and `power` shapes the falloff. Use masks or [finish signals](#drive-finish-properties)
  to vary thickness across a leaf, a paper panel, or a cloth hem.
- Directional backlight uses the live shadow map when present. The
  headless renderer can also test shadows from point lamps and the
  finish light against retained static sculpt fields. Retain them
  with `S.keepRenderSdf = true`. `shadowBias` controls the ray offset in
  world units and defaults to 0.08. Set `shadow: false` on a layer to
  bypass its visibility test.

This layer works in JavaScript and JSON finish definitions in the
headless renderer. In a custom surface host, `sample.transmissionSun`
accepts a direction, intensity, linear RGB color, and an optional
`visibility(bias)` callback. `sample.transmissionLights()` can return a
list of local lights with the same fields. Without a custom sun, the
sampler uses the finish light and the sample's visibility.

```sh
ink-studio render examples/thin-transmission.js --w 356 --h 172 --px 1 --out lantern.png
ink-studio render examples/thin-transmission.js --w 356 --h 172 --px 1 --transmission off --out lantern-unlit.png
```

## Palette matching

Give a material a `paletteConstraint` to select swatches after shading
in headless renders and custom hosts. Set `match` to prioritize hue,
brightness, chroma, or perceptual distance. A
[material-targeted palette policy](pixel-look.md#choose-a-matching-priority)
exposes the same matching choices in the standard WebGL renderer.

```js
const paintedCloth = K.surface.material({ r: [9, 10, 11], materialId: 'cloth' }, {
  paletteConstraint: {
    palette: ['#261e36', '#65384f', '#b2788c', '#f0cba8'],
    match: 'brightness'
  }
});
```

## Drive finish properties

Name a source in `surface.signals` and bind it to one or more layer
properties with `drive`. A signal maps to zero to one. Each binding
interpolates from the layer's authored property to the supplied `to` value.
A layer with a zero base strength can fade in when its signal rises.

```js
const glazedCeramic = K.surface.material(clay, {
  signals: {
    heat: { type: 'weather', channel: 'temperature', range: [5, 28] },
    edge: { type: 'axis', axis: 'y', range: [0.1, 0.5] }
  },
  layers: {
    pigment: {
      type: 'tint', color: '#4b637d', strength: 0.35,
      drive: { color: { signal: 'heat', to: '#c96340' } }
    },
    glaze: {
      type: 'specular', roughness: 0.42, strength: 0.1,
      drive: {
        roughness: { signal: 'heat', to: 0.13 },
        strength: { signal: 'edge', to: 0.6 }
      }
    }
  }
});
```

- Drive `strength` on any finish layer. Drive `roughness` on specular,
  fiber, diffraction, glint, and local reflection layers with a number or an along/across
  pair. Drive `f0` on sky, planar, and local reflections. Drive `color` on tint,
  specular, fiber, sheen, glint, bevel, planar reflection, local reflection, and transmission layers
  using a normal surface color. Drive `thickness` on transmission layers.
- A `weather` source reads `wetness`, `standingWater`, `snow`, `frost`,
  `temperature`, or `exposure` at the world position. A `time` source uses
  scene seconds. Set `range: [low, high]` and optionally choose `linear`,
  `smooth` (the default), or `step` interpolation. In a custom host pass
  the weather frame's `surface` function as `sample.weather(x, z)`.
- A `light` source reads directional visibility multiplied by how directly
  the surface faces the sun. It accepts the same range and interpolation.
- Use the existing `axis`, `query`, `field`, and `texture` mask sources
  as signals with the same settings. JavaScript materials can also
  supply a function that takes the surface sample and returns a value
  in zero to one. Missing values keep the authored property.
- Signals are shared across layer bindings at each sample. Independent
  layer masks, finish order, and the export palette still apply. The same
  signals can [drive the axes of projected palette fields](projected-effects.md#drive-palette-fields-with-scene-data).

The [retained weather example](retained-weather.md#put-it-on-a-material)
uses the same film signal for stone color and highlight width. Standing
water from that grid controls the seam reflection.

## Presets

- **Grain and fibre** include `brushed-steel`, `brushed-brass`, `machined-knob`, `cross-brushed-metal`, `scratched-metal`, `carbon-fibre`, `satin`, `woven-ribbon`, `corduroy`, `hair`, `combed-fur` and `figured-wood`.
- **Grazing reflection and sheen** include `puddle`, `wet-cobblestone`, `waxy-leaf`, `glazed-pottery`, `lacquered-wood`, `clear-ice`, `glass-bottle`, `velvet`, `dust` and `gold-leaf`.
- **Angle-dependent colour** includes `soap-bubble`, `oil-slick`, `beetle-shell`, `peacock-feather`, `butterfly-wing`, `mother-of-pearl`, `pearlescent-paint`, `shot-silk` and `holographic-foil`.
- **Pinned glints and facets** include `snow`, `mica-granite`, `frost-crystals`, `metallic-paint`, `sequins`, `dewy-grass`, `rippling-water`, `fish-scales` and `cut-gem`.

`K.surface.presets` lists the available IDs. Presets describe finishes. Supply a bowl of water, a fur material, a faceted mesh, or other geometry independently. The gallery includes sample geometry for every recipe.

## JSON and host rendering

Headless worlds can bind a [physical material asset](./headless-worlds.md#physical-material-assets)
to a surface or body. Its authored dry and wet color ramps follow the
same material state used by the simulation. Surface finishes can still
add reflectance, masks, and other lighting effects.

In JSON, `mat.surface` accepts a preset ID or a settings object. Add a `preset` field to the object to override that recipe.

```json
{
  "id": "brushed-orb",
  "finish": { "look": { "pixel": true } },
  "solids": [{
    "kind": "ball",
    "at": [0, 1, 0],
    "r": 1,
    "mat": {
      "role": "metal",
      "surface": {
        "preset": "brushed-steel",
        "direction": "x",
        "layers": { "brush": { "roughness": [0.1, 0.5] } }
      }
    }
  }]
}
```

The browser script bundle exposes `SurfaceLook` alongside `PixelLook`. Host renderers can cache `SurfaceLook.prepare(settings, palette, lightDirection)` and call `SurfaceLook.shade(prepared, sample, baseRgb, result)`. A sample takes world-space `position`, `normal` and `view` toward the eye, plus optional `tangent`, `visibility`, `footprint` and `time`. The result contains normalized RGB, a coverage multiplier and a glint weight. The finished world includes `surfaces` with material bindings and `surfaceData` with one row per baked splat. `SurfaceLook.STRIDE` is the row length. Row fields are the one-based binding ID (zero for an ordinary splat), XYZ normal, direct-light visibility and optional XYZ tangent. Hosts with skeletal or procedural transforms should supply the rest-space material position and transform the frame consistently with their geometry and lighting.

Surface layers also accept `axis`, `query`, and `texture` masks.
For spatial masks, pass a rest-space `position` and the current
`worldPosition` when the surface moves. The same samplers drive
[masked look assets](pixel-look.md#spatial-and-field-masks).

These finish layers use CPU rendering or a custom host integration. See the
[WebGL canvas renderer coverage](browser-renderer.md#feature-coverage).

## Project animated paint and patterns

Use a `projected` layer for animated pixel rasters, field-driven patterns,
or a JavaScript shader. Existing finish layers can read the same fields
through a field mask. See the [projected effects guide](projected-effects.md)
for field authoring, local palettes, and emitters.

## Color curves on surfaces

Add a `colorCurve` layer to a material's finish to map a numeric input
to color. This layer reads water depth from a world query.

```json
{
  "type": "colorCurve",
  "source": { "field": "river/water", "path": ["depth"], "fallback": 0 },
  "ramp": {
    "interpolation": "smooth",
    "stops": [[0, "#292a43"], [0.6, "#31949f"], [1.8, "#b8e8d9"]]
  },
  "outputPalette": ["#292a43", "#315366", "#31949f", "#7abebb", "#b8e8d9"]
}
```

The default source is `"luminance"` of the current surface color.
`"height"` reads world Y and `"depth"` reads distance along the view axis
in world units. Use `{ "field": "climate/temperature" }` for a numeric
scene query. Optional `args` are forwarded to `probe`, and a `path` array
selects a number from a record or array. The layer skips a missing or
nonnumeric reading unless a numeric `fallback` is supplied.

A source with `field` and `channel` reads a [projected field](projected-effects.md#fields)
using its usual `space` and `projection`. JavaScript can also provide
`source(sample, color)` to compute a scalar directly. A custom host
using camera depth supplies `sample.depth` to `SurfaceLook.shade`.

Surface colors can reference palette indices, hex swatches, or normalized
RGB. Use `channels` to run independent red, green, and blue curves on the
current color or the ramp output. The layer also accepts the usual
`strength` and `mask`, plus the `mix`, `add`, and `multiply` blends.
An optional `outputPalette` gives the result its own swatches at palette
resolve. Use raw rendering to see the color before quantization.

The Node renderer runs these surface layers. Browser hosts can use
`SurfaceLook` for custom integration. The standard WebGL renderer runs
[scene color curves](pixel-look.md#color-ramps-and-channel-curves).

The [thermal station](../examples/color-curves.js) renders the same
temperature query with smooth and stepped ramps and applies RGB channel
curves to the equipment.

```sh
node cli/ink-studio.js probe examples/color-curves.js --field spring/temperature --at 1,0,0
node cli/ink-studio.js render examples/color-curves.js --ortho --color-curves off --out before.png
node cli/ink-studio.js render examples/color-curves.js --ortho --out after.png
```

## 3D LUTs on surfaces

Add a `colorLut` layer with its imported or native `lut` definition.
The layer samples the current lit RGB before the surface is blended
into the frame. It accepts the usual `strength`, `mask`, and color blend
controls. Use `outputPalette` to preserve the local range of swatches
during quantization.

```js
const finish = KIT.surface.material({ r: [1, 2, 3] }, {
  layers: { patina: { type: 'colorLut', lut: ColorLUT.parseCube(cubeText), strength: 0.7 } }
});
```

Surface LUTs run in the Node renderer and in custom browser integrations
using `SurfaceLook`. The standard WebGL renderer supports
[scene LUTs](pixel-look.md#3d-color-luts). The CLI flag `--lut off`
bypasses both the scene LUT and these material layers.

## Color stacks on surfaces

Add a `colorStack` layer with a named `stack` to process the material's
lit RGB before compositing. The layer accepts the usual `strength`,
`mask`, `blend`, and `outputPalette` settings. Use the RGB operations,
curves, and LUTs described in [named color stacks](pixel-look.md#named-color-stacks).
Indexed remap steps use palette slots at scene resolve.

```js
const oxidized = KIT.surface.material({ r: [1, 2, 3] }, {
  layers: {
    patina: {
      type: 'colorStack',
      strength: 0.7,
      stack: { name: 'Copper patina', steps: [
        { type: 'hue', degrees: 35 },
        { type: 'saturation', factor: 0.75 }
      ] }
    }
  }
});
```

The Node renderer and custom browser renderers using `SurfaceLook`
can evaluate surface stacks. The standard WebGL renderer evaluates
scene stacks during palette resolve.

## Animate the finish light

Set `light.surfaceDirection` in a JSON scene, or pass `surfaceLight` to
`B.finish()` in JavaScript. Each row is `[seconds, x, y, z]`. Times strictly
increase and directions are nonzero vectors pointing toward the light.
The track interpolates smoothly on the unit sphere and holds its first or
last direction outside the keyed interval.

The track changes the direction sampled by diffuse lighting ramps and
angle-dependent highlights. Baked shading and visibility remain as authored.
Browser hosts can prepare the track once with
`SurfaceLook.prepareLightTrack(keys)` and pass the sampled direction to
`SurfaceLook.shade` as `sample.lightDirection`, in the same coordinate
frame as the surface normal. See the [stipple example](../examples/stipple.json)
for a loop with a stationary camera and geometry.

## Render the examples

```sh
node cli/ink-studio.js render examples/surface-gallery.js --w 1236 --h 816 --t 0.6
node cli/ink-studio.js render examples/surface-gallery.js --surface off --w 1236 --h 816
node scripts/render-surface-gallery.js
```

The gallery script writes a still life and two camera angles of all 40 presets to `studio/out/surface-gallery`. It keeps the light and scene state fixed for each pair.
