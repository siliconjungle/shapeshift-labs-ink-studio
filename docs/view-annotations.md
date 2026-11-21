# View-adaptive legends and labels

Set `annotations` on a mixed-resolution composite layer or on a render graph composite pass. A layer can also carry ordinary `draw` commands. Both renderers lay out the annotations in final output pixels, so a full-resolution annotation layer stays legible over coarse world art. [Mixed-resolution compositing](mixed-resolution.md)

## Fixed legends

Define a `legends` list with unique IDs. Each legend has an optional `title` and an `items` list. Items have `text`, `color`, and a `symbol` of `box`, `line`, or `dot`. Set a top-left pixel `at` position or one of the four viewport `corner` values with a two-component `offset`. Legends stay in screen space as the camera moves, and reserve their rectangles before labels are placed.

## Labels and leaders

Each label has an `id`, `text`, and an `at` anchor. World labels use XYZ or an anchor descriptor. A descriptor can name a simulation `entity` with optional `socket`, a data `mark`, a named or indexed `part`, a `bone`, a `splat` index, or a render `selector`. Rig parts and bones accept a rest `point`. Descriptors can add a world-space `offset`. Set a label's `space` to `screen` to use an XY pixel anchor.

A label-level `offset` sets its preferred displacement in pixels. `leader` defaults to `straight`, with `elbow` and `false` also available. The layout tries nearby positions in a repeatable order. It keeps panels clear of each other, reserved rectangles, and earlier leaders. Leader routes avoid other panels. A label is hidden when the layout runs out of space. Higher `priority` wins first, then nearer anchors, then IDs.

The layer's `avoid` list reserves pixel rectangles as `[x,y,width,height]`. Use `margin` for viewport padding and `gap` for label separation. Layer and item `style` settings control pixel text `size`, `padding`, `color`, `background`, `border`, `leaderColor`, and `leaderWidth`. Backgrounds and borders can be set to false. Labels and legends use the compositor's stroke font. Annotations draw over the scene.

## Distance and inspection

A `density` list starts at distance zero and supplies increasing `distance` thresholds with a `maxLabels` and optional `gap` for each band. It uses the camera's nominal distance, including zoom. The defaults allow 32 world labels at distance 0, 16 at distance 14, and 8 at distance 28. Legends and screen labels are outside the world-label budget. Set `minDistance` or `maxDistance` on individual world labels to limit their visible view depth.

Use `KIT.annotations.prepare(definition)` with `KIT.annotations.layout(settings, { world, time, camera, width, height })` to inspect the chosen boxes, leader routes, effective budget, and reasons for suppressed labels. The normal CLI `--composite` override works with annotation layers.

For labels and artwork that follow features measured in raster frames, use [tracked drawing anchors](headless-authoring.md#tracked-drawing-anchors).
