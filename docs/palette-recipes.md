# Palette recipes and color paths

`KIT.palette` authors named material palettes using the library's existing OKLab/OKLCh conversion and gamut-mapping math. It adds independent hue/chroma/lightness curves, two-color recipes, reference-ramp transfer, and seekable animation. It has no external runtime dependencies, network requests, packages or assets. The older `KIT.procedural.materials.ramp` API remains compatible.

Try the [Chromatic garden](../examples/palette-recipes.html): the same SDF geometry under three two-color recipes, with channel controls, a reference transfer and a continuous animated palette path. Drag to orbit and scroll to zoom.

## Start with two colors and named roles

```js
const palette = KIT.palette.duotone('#58aeb7', '#efad72', {
  roles: {
    stone: { anchor: 'primary', steps: 7 },
    foliage: {
      anchor: 'primary', steps: 7,
      lightness: [.16, .87],
      hueShift: [-29, 13],
      chromaScale: [.3, 1.2, .2]
    },
    glow: { anchor: 'accent', steps: 4, lightness: [.62, .98] }
  }
});
const B = makeBuilder(37, palette.palette);
const S = KIT.sculpt(makeSculpt(B));
S.box([0, 0, 0], [1, 1, 1], { r: palette.roles.stone });
S.bake();
const world = B.finish({ paletteRoles: palette.roles });
```

`duotone(primary, accent, options)` supplies two named anchors, `primary` and `accent`. Without custom roles, each gets a seven-shade ramp. `recipe({ anchors, roles, background? })` supports arbitrary named anchors using the same role definitions. Colors accept six-digit hex strings, packed RGB integers or normalized sRGB triples.

Every recipe reserves slot zero for `background`. Its default is a dark, subdued version of the first anchor; set `background` to an explicit color to control it. `roles` cannot redeclare this reserved name. Recipes contain at most 48 palette slots including the background, matching the JSON diorama palette budget. Each role has 1–32 shades. Slots stay separate even when their current colors match, so role layouts do not change with color choices.

Outputs are immutable:

| Member | Meaning |
| --- | --- |
| `palette` | Packed RGB colors, ready for `makeBuilder`. |
| `rgb` | The same palette as normalized RGB triples. Recipe palettes are quantized to eight-bit colors. |
| `roles` | Named lists of palette indices, ready for material `r` fields and `paletteRoles`. |
| `ramps` | Named lists of packed colors. |
| `sampleRole(name, shade)` | Continuous role-path sampling; shade is clamped to 0–1. |
| `inspectRole(name, shade)` | Requested and gamut-mapped OKLCh, RGB, packed color and `gamutMapped`. Hue values are equivalent modulo 360 degrees. |
| `snapshot()` | A fresh JSON-compatible definition that can be edited, saved and compiled again. |

Each role has exactly one of these sources:

- `anchor: 'name'`: derive a shade ramp from a named color. Defaults: `lightness: [.14, .94]`, `chromaScale: [.3, 1, .12]`, `hueShift: [-16, 10]`, and `steps: 7`. Lightness gives the absolute low/high endpoints, with the anchor's lightness as the midpoint, constrained to that range. The default profile preserves the anchor color at its midpoint. Chroma scales the anchor's chroma at the dark end, midpoint and light end. Hue shift gives dark/light endpoint offsets in degrees around an unshifted midpoint. Profiles use smooth segment interpolation. Optional absolute `curves` override individual generated channels.
- `color: '#rrggbb'`: one constant color. Only `steps: 1` may be supplied.
- `path: pathDefinition`: sample any color path into the role's shade slots. Set `steps` on the role; the path's preview sample count is independent.

## Independent channel curves

```js
const path = KIT.palette.path({
  curves: {
    hue: { stops: [[0, 205], [.5, 225], [1, 275]], interpolation: 'smooth' },
    chroma: { stops: [[0, .025], [.5, .14], [1, .025]], interpolation: 'smooth' },
    lightness: { stops: [[0, .12], [.4, .42], [1, .95]], interpolation: 'smooth' }
  },
  steps: 12
});
const color = path.sample(.65);
const explanation = path.inspect(.65);
```

A channel may be a constant or `{ stops: [[position, value], ...], interpolation? }`. Use `step`, `linear` or `smooth` interpolation. Positions strictly increase from zero to one, with 2–256 stops. Lightness and chroma values are 0–1. Hue is in degrees and may be unwrapped across the seam: `350 → 370` passes through red; `0 → 720` makes two turns. Hue values are bounded to ±36,000 degrees.

`path({ colors, curves?, steps?, interpolation?, hue? })` also accepts 2–64 RGB color anchors, including explicit `{ at, color }` stops. These must cover 0–1. The anchors define an OKLCh path, and `curves` replace only the channels supplied. Without RGB anchors, all three channels are required. The `hue` route is `short` by default, or `long`, `increasing`, `decreasing`. Neutral anchors borrow neighboring chromatic hues. Explicit absolute hue curves use their authored winding.

`sample(t)` returns normalized sRGB. `lch(t)` returns the requested `[lightness, chroma, hueDegrees]` before gamut mapping. `inspect(t)` returns both requested and mapped values. Out-of-gamut colors reduce chroma while retaining lightness and hue. RGB anchors are preserved exactly when no channel overrides apply. Sampling clamps finite coordinates to 0–1; nonfinite coordinates fail explicitly.

`rgb` and `hex` contain 2–4,096 evenly spaced preview samples. They do not limit continuous sampling. Very dark or nearly neutral colors can have numerically unstable measured hue; hue is visually immaterial when chroma is zero.

## Transfer a reference ramp

```js
const transferred = KIT.palette.transfer(
  ['#10202b', '#284653', '#42717c', '#86a9a6', '#d9d9b9'],
  '#ab82d7',
  { pivot: .5, strength: 1, hueStrength: 1, steps: 9 }
);

const recipe = KIT.palette.recipe({
  anchors: { primary: '#ab82d7', accent: '#c7d67a' },
  roles: {
    stone: {
      anchor: 'primary', steps: 9,
      reference: ['#10202b', '#284653', '#42717c', '#86a9a6', '#d9d9b9'],
      pivot: .5
    },
    glow: { anchor: 'accent', steps: 4, lightness: [.65, .98] }
  }
});
```

The reference may be a color array, path definition or compiled path. The reference at `pivot` aligns to the target anchor. Relative lightness below and above the pivot maps into the available shadow/highlight range; chroma follows the reference's relative profile, and hue follows its unwrapped offsets. A neutral reference pivot uses chroma differences instead of dividing by zero. Output gamut mapping keeps colors displayable.

`strength` and `hueStrength` range from zero to one. Strength zero returns the target anchor throughout. The target color is exact at the pivot. Defaults are pivot `.5`, strength `1`, hue strength `1`, and seven samples. Transfer is a mathematical profile operation; it does not reconstruct lighting or simulate pigments. Compiled transfers can be assigned as role paths. Their snapshots use a serializable `{ transfer: { reference, anchor, options } }` path definition.

## Animate recipes along a palette path

```js
const dusk = KIT.palette.duotone('#58aeb7', '#efad72');
const midnight = KIT.palette.duotone('#ab82d7', '#c7d67a');
const animation = KIT.palette.animate({
  keys: [
    { time: 0, recipe: dusk },
    { time: 5, recipe: midnight },
    { time: 10, recipe: dusk }
  ],
  playback: 'loop',
  space: 'lch',
  hue: 'short',
  interpolation: 'smooth'
});
const frame = animation.sample(3.25);
```

Keys are 2–128 strictly increasing seconds, starting at zero. Every recipe must have the same role names and shade counts. Role declaration order may differ: animation aligns by name and retains the first key's slot layout. The last key defines the duration. Colors interpolate in OKLCh (`lch`) or OKLab (`lab`), with `step`, `linear` or `smooth` progress. Exact key times select the exact keyed recipe, including with step interpolation.

Playback is `clamp`, `loop` or `pingpong`. Loop endpoints must match; include a closing key for a seamless loop. Pingpong reverses without needing a duplicate endpoint. Negative finite times clamp or wrap according to playback. Sampling is stateless and independent of delta time, render rate or seek order.

The sampled result contains `time`, wrapped `phase`, normalized `rgb`, packed `palette`, `roles` and `ramps`. `duration`, `keyTimes`, `roles` and `snapshot()` are available on the compiled animation. Snapshot definitions accept recipes or paths compiled in the same toolkit, and export plain JSON data.

## Bind to a live world without rebaking

```js
const live = KIT.palette.bind(world, animation);

function render(time) {
  // Advance the world's own simulation first, if it has one.
  live.update(time);
  renderer.render(live.world, {
    time, width: 1056, height: 650,
    changedRows: [] // use the simulation's actual dirty rows if geometry moved
  });
}
// CPU: studio.render(live.update(time), { t: time, w: 1056, h: 650 });
```

The default binding requires the world palette to match the first recipe. `live.world` has stable identity and shares the source world's geometry; `live.grade` is a reused normalized RGB buffer. `update(seconds)` returns the same view object after updating its existing animation grade. The original world's palette, geometry and animation object are kept intact. Ordinary source-world changes are synchronized into the view, including replaced data arrays and removed properties. A palette layout change requires rebinding.

The binding uses the existing palette-grade path in both renderers. Subsequent color curves, LUTs and color stacks retain their ordinary order. Render paths that intentionally bypass animation grades, including applicable tone or local-palette modes, retain their existing behavior. The binding does not rewrite literal effect colors outside the palette. `changedRows: []` tells the native renderer that no geometry changed; supply actual changed rows when the simulation moves splats. With a stable view, palette-only updates need no geometry texture upload.

For an existing scene, map its named roles to recipe roles:

```js
const live = KIT.palette.bind(existingWorld, animation, {
  roles: { masonry: 'primary', neon: 'accent' }
});
```

Mapped ramps are resampled to the existing role's shade count. Unmapped slots preserve the source world's current animation grade, or their original palette colors when there is no grade. Mapped slots replace their prior color. Mapping `background` is explicit in this mode. Changes to mapped source-role layouts require rebinding. The binding is an explicit seconds-based sampler, not a `stage.add` simulation system.

Ordinary splats encode RGB rather than a unique palette-slot identity. Consequently, two identical source colors cannot map to different animated colors. Bindings validate aliases and overlapping role assignments at every key, then validate interpolated updates before committing the grade. Invalid updates leave the previous grade intact. Keep independently animated roles distinguishable in the source palette or use existing scoped look tools when per-object ownership is required.

## CLI export

```sh
node cli/ink-studio.js palette examples/palette-recipe.json --out palette.json
node cli/ink-studio.js palette animation.json --t 3.25 --out frame-palette.json
```

The command accepts a recipe, path or palette-animation JSON definition and exports sampled colors. Recipes and animation also export named role indices and ramps. `--t` selects animation seconds; path definitions export their configured preview samples. Output can be written to a file or printed as JSON. Use the exported `palette` and `roles` when authoring a diorama.
