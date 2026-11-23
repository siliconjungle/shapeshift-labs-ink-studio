# Motional pixel coverage

Thin opaque Gaussian splats can gain or lose a row of pixels as the camera or an object moves between pixel centers. Motional coverage integrates each eligible splat over a pixel before shading and palette resolve. During a small move, the footprint sampler adjusts across the short axis of the splat using its previous projected position, orientation, and camera-space depth. It keeps part of the centered core for a sharper line.

Each fragment is shaded and composited at its current position and depth. The history stores projected splat geometry. The first frame, a cut, and movement outside the configured limits use the stationary footprint. Use the existing `splatOrder: 'surface'` if overlapping splats require per-pixel depth sorting.

## Authoring

Set `look.motionalCoverage` in a JavaScript world or `finish.look.motionalCoverage` in a JSON diorama. `true` enables the defaults and `false` disables the resolve. A settings object can target individual parts of a scene:

```json
{
  "strength": 1,
  "maxWidth": 1.4,
  "maxMotion": 1.5,
  "depthTolerance": 0.04,
  "rules": [
    { "select": { "object": "machinery-glyphs" }, "strength": 0 },
    { "select": { "material": "rigging" } }
  ]
}
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `strength` | 1 | Blend from native coverage to the filtered footprint, from 0 to 1. |
| `maxWidth` | 1.4 | Maximum projected half-maximum width across a splat in art pixels, from 0.25 to 3. The resolve fades toward this limit. |
| `maxMotion` | 1.5 | Maximum projected displacement per rendered frame in art pixels, from 0.25 to 4. The motion adjustment fades toward this limit. |
| `depthTolerance` | 0.04 | Maximum fractional change in eye depth for the motion adjustment, from 0 to 0.5. |
| `rules` | All eligible splats | With rules, the first matching object, material, surface, or other splat selector sets a strength multiplier. Unmatched splats use native coverage. |

The resolve is available in the headless renderer for elongated opaque Gaussian splats in both projections. Ink's existing coverage settings still govern translucent silhouettes, soft dabs, shaped footprints, sprites, and pixel-painted splats.

## Matched sequence review

```sh
ink-studio clip examples/motional-coverage.js --w 96 --h 56 --px 1 --px1 --fps 24 --from 0 --to 1 --camera-pan .22,.35,0 --camera-orbit 3.7 --out cable-house-motional.png
ink-studio clip examples/motional-coverage.js --w 96 --h 56 --px 1 --px1 --fps 24 --from 0 --to 1 --camera-pan .22,.35,0 --camera-orbit 3.7 --motional-coverage off --out cable-house-native.png
```

The CLI maintains a history through a clip, sheet, or `shimmer` review. `--motional-coverage on|off|file.json` overrides the authored setting. `--feedback-cuts` resets motion history at authored cuts in clips and sheets.

For the Node API, use a history per playback stream and render in playback order:

```js
const ink = require('@shapeshift-labs/ink-studio');
const motionalCoverageHistory = ink.createMotionalCoverageHistory();
for (const { world, time, camera, cut } of frames) {
  const art = ink.render(world, {
    ...camera, t: time, w: 96, h: 56, px: 1,
    motionalCoverageHistory, resetMotionalCoverage: cut
  });
  consume(art);
}
```

If the host supplies new world buffers each frame, pass a stable `motionalCoverageSource` token for that stream while splat indices still refer to the same geometry. Use `resetMotionalCoverage`, `resetRenderHistory`, or `motionalCoverageHistory.clear()` for a seek or cut. Without a history, rendering uses the stationary footprint.

Use [surface-checked motion history](surface-history.md) to blend actual shaded color and coverage on matching native surface owners.
