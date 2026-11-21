# Halftone and layered screen printing

`K.screenPrint` renders native surfaces as individually registered ink plates. Circles, diamonds and line screens vary their occupied area with shading. Colored plates can overprint multiplicatively or knock out earlier inks. The implementation is dependency-free and uses analytic screens rather than rebuilding textures each frame.

Explore [The Moonflower Press](../examples/screen-print.html): an animated botanical specimen and a retro spacecraft. Compare surface-attached and screen-space marks, switch between mono, duotone and CMYK recipes, proof individual inks, vary registration and dot gain, and orbit freely.

```js
const print = {
  ...K.screenPrint.preset('duotone'),
  spacing: 0.18,
  grain: 0.04,
  chart: { projection: 'triplanar' }
};
S.ball([0, 1, 0], 0.9, { r: [2, 3, 4], screenPrint: print });
S.bake();
const world = B.finish({ cam, look: { pixelSize: 1 } });
```

Set `look.screenPrint` for the native geometry in a whole world, `S.screenPrint` for a sculpt default, or `material.screenPrint` for selected surfaces. A material's `false` overrides the world default. Native particles and reserved glass marks retain the engraving system's exclusions. The background and independent sprite-atlas pass keep their own rendering; this is a native contribution representation, not a final-frame filter.

For an already baked scene:

```js
K.screenPrint.bind(world, 'all', print);
K.screenPrint.bind(world, selectedSplatIds, print);
K.screenPrint.update(world, 1, { dotGain: 0.08, spacing: 0.22 });
// Edits preserve native geometry, retained chart buffers and bone bindings.
```

Bindings share engraving's retained coordinates and 16-style budget. Engraving and printing can coexist on different surfaces. Assigning another representation to the same rows replaces the previous one. Deformation, rigs, native bones, copied chunks, instances, reconstruction, bake caches and afterimages retain the same existing chart infrastructure.

Use `screenPrint: false` in renderer options to bypass printing while preserving other engraving. `engraving: false` bypasses the shared retained-print pass altogether. Neither option changes the world.

## Ink recipes

`ScreenPrint` is also exported as a pure helper module. `prepare(settings)` validates and snapshots a recipe; `preset(name, overrides)` supplies `mono`, `duotone`, or `cmyk` settings. All ink colors and paper colors accept `#rrggbb` or normalized RGB triples.

| Setting | Default | Meaning |
| --- | --- | --- |
| `paper` | `#f6e9cc` | Substrate reflectance, also the unprinted part of each contribution. |
| `space` | `surface` | `surface` follows retained object coordinates; `screen` uses art pixels. |
| `spacing` | `0.22` | Cell pitch in surface chart units, or art pixels in screen space. |
| `strength` | `1` | Blend between native color and the completed print. |
| `contrast` | `1` | Separation contrast, `0.1–4`. |
| `exposure` | `0` | Exposure in stops, `-2–2`, before separation. |
| `dotGain` | `0` | Expand or shrink intermediate coverage, `-0.25–0.25`; white and full ink stay fixed. |
| `blackGeneration` | `0.82` | Fraction of neutral CMY density transferred to the black plate, `0–1`. |
| `lighting` | `0` | Contribution of the existing retained-chart live light, `0–1`. Baked color already contains its authored lighting. |
| `grain` | `0.035` | Seeded substrate variation, `0–0.3`, filtered away when too small to resolve. |
| `grainScale` | `16` | Grain frequency relative to the cell grid, `1–64`. |
| `seed` | `1` | An independent uint32 paper-grain seed. |
| `plates` | one blue key plate | One to six ink plates. |

`chart` is accepted by the toolkit binding and authoring APIs, rather than the pure recipe helpers. It uses the existing `plane`, `cylinder`, `sphere` and `triplanar` mappings, with `origin`, `along`, `across`, `radius` and optional `ambient`. Default mapping is triplanar. A partial chart edit preserves the other mapping settings.

In screen space the grid starts at the lower-left art-pixel origin, before final display scaling. Surface mode measures pitch in the chosen rest-space chart; zooming does not change its physical size. Both modes keep the original contribution coverage, visibility, ownership and depth.

## Plate authoring and inspection

```js
const recipe = K.screenPrint.prepare({
  paper: '#f6e9cc',
  spacing: 0.2,
  plates: [
    { id: 'blue', ink: '#14607e', channel: 'luma', shape: 'circle',
      angle: Math.PI / 12, order: 0 },
    { id: 'warm', ink: '#ed6744', channel: 'midtone', shape: 'diamond',
      angle: Math.PI / 3, offset: [0.04, -0.02], order: 1 }
  ]
});
const proof = K.screenPrint.separate(recipe, [0.45, 0.6, 0.65]);
// Ordered [{id, area, plate}, ...] records make each separation inspectable.
```

Each plate has:

- A unique `id`, an `ink` color, a `shape` (`circle`, `diamond`, `line`) and a `channel` (`luma`, `cyan`, `magenta`, `yellow`, `black`, `midtone`, `red`, `green`, `blue`). RGB channels mean the corresponding channel's darkness; `midtone` peaks halfway between paper and black.
- `angle` in radians, `frequency` from `0.125–8` relative to the base pitch, and `offset: [u,v]` measured in rotated screen cells. Registration moves the pattern, keeping the surface geometry fixed.
- A `range: [low,high]` within `0–1`, optional `invert`, `gamma` from `0.25–4`, and `gain` from `0–2`. They shape separation coverage before dot gain.
- `opacity` from `0–1` for ink strength, `enabled` for plate proofs, `order` from `-1024–1024`, and `blend: 'overprint' | 'knockout'`. Equal orders preserve input order.

Overprinting multiplies the substrate by each ink's reflectance; it is commutative for these simple ink layers. Knockout blends the current result toward that ink on the substrate, so stack order matters. These are stylized RGB separations, not a spectral press-calibration or pigment simulation. Neutral removal is relative to the chosen paper, so a neutral swatch is `paper * brightness`.

For CPU tools, `mark(shape,u,v,area,footprint)` samples an individual screen. `shade(recipe,uv,rgb,{footprint,screen,light})` evaluates the full stack. Screen-space recipes require `screen: [x,y]`; `footprint` is the surface-coordinate width of an art pixel. `pack(recipe)` returns a cached GPU buffer for inspection; treat it as read-only.

## Filtering and performance

The circular and diamond threshold fields are calibrated to covered area even in dense shadows, where dots meet neighboring cells. Analytic edge filtering softens subpixel transitions, and unresolved cells approach their exact separation area. This avoids a checkerboard of oversized dots at a distance.

All styles reuse existing retained charts, geometry attachments and the geometry sampler. Printing adds no texture units and generates no per-frame tone-map atlas. Plate edits update compact settings; native bone motion updates existing bone matrices. The unused path creates no print or chart buffers. Pure sampling, browser rendering and the software renderer use the same packed recipe and screen formulas.
