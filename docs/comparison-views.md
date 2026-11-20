# Comparison views

Comparison views align two sources to one camera and one playback time. A source can be a baked world or a function that receives the current comparison snapshot and returns a world. Source-specific frame settings can supply looks, cutaways, or effects.

## Playback and layout

`KIT.comparison.create(options)` creates a renderer-independent session. Set `range` to a start and end in seconds, and optionally set `time`, `rate`, `loop`, `playing`, `camera`, and `cameraSource`. The reference camera comes from the left source by default. Select `cameraSource: "right"` to use the right source's orbit or authored camera rig. A shared `camera` object overrides its orbit settings.

- `snapshot()` returns the current immutable settings.
- `play()`, `pause()`, `seek(seconds)`, and `advance(elapsed)` drive a shared playhead. A host can choose its own clock. `update(changes)` changes the view or playback settings together, and `subscribe(listener)` listens for revisions.
- `mode` can be `side-by-side`, `swipe`, or `difference`. Swipe takes a `divider` in `[0, 1]` and an `axis` of `x` or `y`, measured from the left or top. The left source occupies the area before the divider.

## Render a pair

Import `createComparisonRenderer` from `webgl.mjs` and pass a canvas and `{ toolkit }`. Call `render({ left, right }, snapshot, { width, height })`. Each source takes `world` and optional `frame`, either values or callbacks. World callbacks get the snapshot, and frame callbacks get the snapshot and world.

The renderer samples the reference camera once at the shared time. Both views use its resolved pose, projection, lens and depth range. Side-by-side uses equal viewports, while swipe and difference use matching full-size images. `capture(sources, snapshot, size)` renders the two textures, and `present(snapshot, size)` can move a divider or change the overlay against those textures. Capture again after changing the time, camera, sources, or per-view dimensions. Call `dispose()` to release resources.

For custom render paths, `captureCamera(world, frame, width, height)` returns an opaque snapshot you can pass as `cameraSnapshot` in other WebGL frames.

## Signed difference

The signed value is right minus left, scaled to `[-1, 1]`. Choose linear-light `luminance` or a `red`, `green`, or `blue` channel. Gain and deadband determine how much color to show, and opacity controls its blend with the dimmed reference. Set `difference: { channel, gain, deadband, opacity, context, negative, positive }`. The final two fields are six-digit hex colors. The defaults use blue for decreases and amber for increases.

`KIT.comparison.measure(left, right, { channel })` reads matching RGB or RGBA frames and returns signed `Float32Array` values in top-down order. `KIT.comparison.compose(left, right, options)` returns a composited RGB image. Transparent inputs are compared over black. The CLI `compare` command accepts `--comparison side-by-side|swipe|difference` with exactly two look cases and `--out`. Swipe accepts `--divider` and `--swipe-axis`. The overlay accepts `--difference-channel` and `--difference-gain`.

## Optional browser controls

`mountComparisonView(host, { toolkit, session, left, right })` provides playback, scrubbing, camera orbit, a keyboard-accessible divider, and a difference legend. Supply `labels` for control and source names and set individual `controls` to false to hide or disable them. Available controls are `play`, `time`, `mode`, `axis`, `camera`, `sourceLabels`, `divider`, and `legend`.

Style the canvas, controls, labels, divider, and legend through CSS parts, `--ink-compare-*` custom properties, or a `stylesheet` string scoped to the mount. Set `defaultStyles: false` to replace the full stylesheet. The mount handle exposes `render()` to refresh sources and `destroy()` to stop playback rendering and release resources.
