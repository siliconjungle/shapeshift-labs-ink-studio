# Surface-checked motion history

Enable `look.surfaceHistory` to reuse shaded color and coverage from the
previous frame before palette and tone lookup. Set it in a JavaScript
world, `finish.look` in a diorama, or the renderer’s frame options.

```json
{
  "surfaceHistory": {
    "weight": 0.55,
    "depthPixels": 0.75,
    "maxGap": 0.2
  }
}
```

Ink projects the current native pixel at its owned depth into the previous
camera. The nearest previous sample must carry the same splat row, finite
span, or mesh triangle, and its depth must agree with the projected depth.
Samples revealed by a passing foreground object use their current values
even when the old and new surfaces share a material. The gate is also used
by the browser’s automatic one-frame palette damping.

- `weight` is the amount of eligible history to blend, from 0 to 0.95.
- `depthPixels` is the depth tolerance in scene units per projected art
  pixel at the previous sample, from 0.05 to 4.
- `maxGap` is the longest time between reusable frames, in seconds.
- Use `true` for the defaults or `false` to bypass the blend.

This resolve follows opaque native owners, with camera reprojection and
conservative overlap checks on moving geometry. Transparent layers,
background pixels, and reconstructed impostor owners have no separate
history samples. The browser’s pre-palette pass runs on ordinary native
views. Contribution-aware and portable-stage resolves, masked palette
targets, and water, glass, and portal views use their specialized paths.

## Playback, cuts, and inspection

Start a new history when the shot cuts, using `resetRenderHistory: true` or
`resetSurfaceHistory: true` on the first frame of the new shot. Changes in
source, geometry row count, projection type, settings, or art dimensions
also start a new history, as do rewinds and time gaps beyond `maxGap`.
A host that supplies new buffers with stable owner slots can pass a shared
`surfaceHistorySource` token for one playback stream.

WebGL manages its own history. Pass `surfaceHistoryFrame(report)` for a
top-down byte mask and per-reason counts. Report codes are 0 for a reset,
1 for reuse, 2 for no supported owner, 3 for a projection outside the old
view, 4 for a different owner, and 5 for a depth mismatch.

Use one state per playback stream in Node. A trace is available as
`frame.surfaceHistory` when `captureSurfaceHistory` is enabled.

```js
const surfaceHistoryState = ink.createSurfaceHistory();
const frame = ink.render(world, {
  t, w: 192, h: 112, px: 1,
  surfaceHistory: true, surfaceHistoryState, captureSurfaceHistory: true,
  resetRenderHistory: cut
});
```

The CLI accepts `--surface-history on|off|file.json`. Clip playback creates
a separate state for the sequence and applies `--feedback-cuts` to it.

## Pressure Deck comparison

[Pressure Deck](../examples/surface-history.js) moves a shutter across
lit machinery, changes its axial depth, and cuts to another framing.
The demo shows the current render, the validated history render, and the
reuse and rejection mask at the same native resolution.

```sh
node examples/surface-history-review.js pressure-deck-review --hardware
```
