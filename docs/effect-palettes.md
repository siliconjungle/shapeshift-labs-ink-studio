# Effect palette ramps

Give fog, clouds, sky, and visible emissive details their own palettes at Ink’s native art resolution. Each ramp uses the rendered coverage of its effect. Fog uses bounded and height fog, aerial perspective, and distance haze on surfaces. Clouds use their visible coverage, including card, impostor, and volume representations. Sky uses the unobscured backdrop, including celestial tracks. Emissive details use the existing emission pass for splats and sprite atlases.

Ramp swatches are available to pixels selected for that effect. Colors already in the scene palette remain available to its materials. Scene geometry, material bindings, and local palette constraints continue to color all other pixels.

The [Saltgate night watch](../examples/effect-palettes-night-watch.js) uses a blue night palette, mauve cloud steps, cool sea fog, warm beacon highlights, and protected navigation markers.

```sh
ink-studio render examples/effect-palettes-night-watch.js --t 2 --effect-palettes on --out saltgate.png
ink-studio render examples/effect-palettes-night-watch.js --t 2 --effect-palettes off --out saltgate-standard.png
```

Set `look.effectPalettes` on the world, `finish.look.effectPalettes` in a diorama, or `visual.look.effectPalettes` in a simulation world. Use `--effect-palettes on|off|file.json` to use the scene setting, disable it, or replace it with a JSON file. The headless library accepts `render(world, { effectPalettes })` with the same choices. Raw rendering bypasses the ramps.

```json
{
  "protect": { "objects": ["courier"], "materials": ["waypoint"] },
  "fog": {
    "colors": ["#233b4c", "#417b89", "#9fbab0"],
    "geometry": true,
    "threshold": 0.58,
    "range": [0.25, 0.72]
  },
  "clouds": ["#251e44", "#514062", "#9d7694"],
  "sky": {
    "colors": ["#0b122e", "#25386b", "#aab8e3"],
    "when": { "channel": "daylight", "max": 0.35 }
  },
  "emission": {
    "colors": ["#a43b30", "#f3884e", "#fff1c2"],
    "threshold": 0.27
  }
}
```

- Give a ramp up to 64 swatches using hex colours, scene palette indices, or named scene roles and stops. Whole roles expand in shade order. The array shorthand uses the default settings.
- The default `luma` mode interprets `colors` from dark to light. `range: [low, high]` fits the steps to the effect’s measured tones in 0–1. Set `dither` from 0 to 1 for ordered transitions between steps. The `nearest` mode selects the closest swatch by RGB distance.
- `threshold` controls the minimum visible coverage or emission intensity required. Defaults are 0.58 for fog, 0.46 for clouds, 0.48 for sky, and 0.24 for emission. Overlaps resolve in the order emission, fog, clouds, sky.
- Fog and clouds default to backdrop pixels. Set `geometry: true` on either ramp to include opaque surfaces they cover. Add object or material names to `protect` so those visible surfaces keep the scene’s original colors. Selective ink outlines are preserved.
- A `when` gate reads a numeric sky profile channel at the active sky time. Supply `min`, `max`, or both. A missing channel leaves the ramp inactive.

The ramps run after scene palette and art styling. Set `captureEffectPalettes: true` when rendering from the library to receive an `effectPaletteMask` for an active set. Its top-down pixel values are 0 for unassigned, 1 fog, 2 clouds, 3 sky, 4 emission, 5 bounce, and 6 shadow. The returned palette and usage counts include the selected swatches.

## Share scene swatches with materials

Set `combine: "material"` on an effect ramp to let its approved scene
colours compete with the visible material palette. The nearest effect
swatch competes with the material's own match. Ties use the material
swatch. An exact reserved material swatch keeps its colour. Effects can
also exclude whole objects or materials using `protect`.

```js
world.look.effectPalettes = {
  fog: { colors: ['shared-fog'], combine: 'material', threshold: .29 },
  bounce: { colors: ['shared-bounce'], combine: 'material', threshold: .10 },
  shadow: { colors: ['shared-shadow'], combine: 'material', threshold: .34 }
};
```

The names above refer to `world.paletteRoles`. A surface's
`paletteConstraint` or a matching scene target supplies the material
swatches. Projected layers with an output palette can participate too.
Composition enables geometry and defaults to nearest matching. Set
`mode: "luma"` to propose the effect swatch from its ordered ramp.
Pixels without a local palette use the active effect ramp.

Fog uses visible atmospheric coverage. Bounce uses the strongest
channel of the live sky, ground, or local probe irradiance. Shadow
uses the loss of direct light or local contact shade. Defaults for
bounce and shadow are .12 and .30 respectively. The headless renderer
checks emission, fog, clouds, shadow, bounce, and sky in that order.
An explicit frame or palette render stage can still override that
selection.

Render [Mist at the dye house](../examples/palette-composition.js) and
its palette ownership map at the native art size.

```sh
ink-studio passes examples/palette-composition.js --w 368 --h 188 --px 1 \
  --channels paletteOwner,materialId --out dye-house
```

`paletteOwner.png` uses false colours for the palette choices.
`passes.json` lists the legend with the effect, material or target,
available swatches, and whether a material or shared swatch won. In
the library, request `passes: ['paletteOwner']` and look up the
top-down pixel ID in `frame.passes.paletteOwners`. The pass follows
the visible surface and reports the palette selection independently
of subsequent RGB-only processing.

## Drive palette fields from atmosphere samples

Author a `paletteField` where the atmosphere is sampled. Each field maps
one physical input through a `domain` to a palette. Use explicit
`bands` with normalized stops, or reuse a [palette ramp](palette-recipes.md#spectrum-and-primary-ramps).
`strength` blends the field with the authored colour from 0 to 1.
The fields change colour while the existing density, transmittance and
shadow settings still govern how much of it reaches the camera.

| Binding | Sources |
| --- | --- |
| `skyEnvironment.sky.paletteField` | `elevation` and `azimuth` in radians, or `sunlight` from 0 to 1 |
| `cloudField.paletteField` | World `altitude`, `density`, or local `light` |
| `atmosphere[n].paletteField` | `depth` along the viewing ray from the camera, or world `altitude` |
| `volumeLighting.point.paletteField`, `points[n]`, or `spots[n]` | Local `intensity` after cone, cookie, falloff and scattering phase |

For example, put this field on a fog volume. It samples cool blue near
the camera, then lilac and rose farther along the ray.

```json
{
  "source": "depth",
  "domain": [4, 30],
  "field": {
    "type": "bands",
    "stops": [
      {"at": 0, "color": "#7399ac"},
      {"at": 0.4, "color": "#998da8"},
      {"at": 0.75, "color": "#e1a5aa"}
    ]
  }
}
```

Clouds take their tint at the sampled height and then apply cloud
lighting. A lit fog volume receives the colour sampled by each local
beam. The light still falls off and geometry can cut it. Fog field
samples use the volume's `step` and the existing volume quality budget.

Sky fields can bind `gain` to a numeric sky profile channel. Scene sky
reflections use the same directional field by default. Set
`reflections: false` inside the sky field to keep the base sky in the
reflection. Surface finishes can also choose their own reflection source.

[Animate the field's ramp or bands](palette-recipes.md#animate-a-palette-field-or-ramp)
to change the pigment over time. Sky, fog and clouds use the environment
clock. Local volume lights use the scene clock.

The headless renderer supports all bindings. WebGL samples sky fields
and supports fields on analytic fog volumes and its supported cloud
representations. Its cloud cards sample the visible span's midpoint.
Local point and spot palette fields use the headless volume light path.

The [pigment lighthouse](../examples/atmosphere-palette-fields.js) uses
all four bindings. Compare its shared reflection with the same field
restricted to the visible sky.

```sh
ink-studio render examples/atmosphere-palette-fields.js --w 354 --h 190 --px 1 --t .22 --out shared.png
ink-studio render examples/atmosphere-palette-fields.js --w 354 --h 190 --px 1 --t .22 --params '{"mode":"separate-reflection"}' --out separate.png
```
