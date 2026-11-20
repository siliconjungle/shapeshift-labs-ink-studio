# Target inspection effects

`KIT.inspection` gives a named target one definition for its brackets, crosshair, leader, two-line label, animated glyph ring, depth visibility and optional magnified view. It is an optional frame layer over SDF/splat scenes and textured surfaces. It does not change geometry, simulation state or the camera. See the [interactive relay observatory](../examples/target-inspection.html).

Set `world.look.inspection` or pass an `inspection` frame override to either renderer. Use `false` to bypass the authored definition. Keep definition objects immutable: preparation, glyph atlases and static label rasters are cached. Functions are evaluated each frame for live state.

```js
const inspection = {
  style: { color: '#89e2d4', scale: 1 },
  maxTargets: 8,
  maxMagnifiers: 1,
  targets: [{
    id: 'relay',
    at: ({ time }) => [2, 1.5 + Math.sin(time) * .2, 0],
    halfSize: [.4, .6, .3],
    label: '01 / RELAY',
    detail: ({ time }) => 'T+' + time.toFixed(1),
    active: ({ world }) => world.scannerEnabled !== false,
    coverage: ({ time }) => Math.min(1, time / 2),
    ripple: { chars: '0123479:+', period: 4, speed: 60, radius: 90, width: 16, cell: 8 },
    magnify: { rect: [.73, .06, .23, .25], zoom: 2.5 }
  }]
};
renderer.render(world, { width: 1056, height: 600, time, camera, inspection });
// CPU: require('@shapeshift-labs/ink-studio').render(world, { w: 1056, h: 600, t: time, inspection });
```

## Anchors and activation

`at` accepts a finite XYZ world point, a function receiving the frame context, or one of these bindings:

| Anchor | Meaning |
| --- | --- |
| `{ splat: 123 }` | Current sampled splat position, including shader motion and rig/bone transforms. |
| `{ part: 2, point: [0, .3, 0] }` | Local point transformed by the CPU rig part's current matrix. |
| `{ bone: 2, point: [0, .3, 0] }` | Local point transformed by the current GPU bone matrix. |
| `{ selector: { object: 'terminal' } }` | Center and half-size of the current named splat selection. Uses the shared target selectors, including tags and materials. |

Selectors cache membership by geometry layout and metadata identity, and sample the selected splats each frame. Replace metadata when changing membership. Use a point, rig anchor or a host callback for large moving populations and individual instances. `halfSize` is a world-axis-aligned XYZ extent, defaulting to the selector extent or `[.12, .12, .12]` for a point anchor. Set it to include the inspected feature; it controls framing and the default visibility probes. Rig and bone bindings transform the point; their explicit half-size remains world-aligned.

`active`, `coverage`, `label` and `detail` accept functions of `{ world, time, camera, width, height, focus, project }`. `coverage` is a number from zero to one and attenuates **all** of that target's effects. Connect it to the same field or animation controlling a scene reveal. A fully hidden, inactive, offscreen, back-facing or near-plane-clipped target produces no inspection elements. `normal` optionally supplies a world-space facing normal. Bounds crossing the near plane are omitted rather than stretched across the screen.

Targets are evaluated in descending `priority`, preserving declaration order for ties. `inspectionFocus: 'relay'` raises a target ahead of that ordering without changing the camera or enabling an inactive target. `maxTargets` defaults to 12 and is limited to 32; excess candidates report `budget`. Definitions may declare up to 256 targets. `maxMagnifiers` defaults to one and may be zero through four. Both annotation and magnification remain active for the chosen target; `magnify: false` disables only its inset.

Callbacks can consume a simulation state, parameter sample, timeline state or event envelope. Inspection owns no second simulation clock. Use [presentation tracks](scene-timeline.md#presentation-tracks) to key activation, coverage, labels, and the magnifier from a scene timeline. JavaScript callbacks can sample host state or shared parameter bindings.

## Shared visibility

The default `occlusion: 'depth'` compares five probes against scene depth. Probes cover the center and four interior points of the projected bound, using its nearest depth to avoid hiding the target behind its own surface. `depthBias` is in world units and defaults to `.08`. This bound-based test is deliberately conservative; a large bound can remain visible while its center is hidden.

For precise features, supply `probes: [[x,y,z], ...]` or a function returning one to five world-space surface points. These points use their actual depth, and the visible fraction drives every effect together. They are useful for broad buildings, irregular shapes, and targets behind thin structures. `occlusion: 'none'` explicitly enables an X-ray style while retaining frustum, activation and coverage checks.

Native WebGL copies the existing linear scene-depth attachment and resolves visibility in a texture with one texel per target. It does not read pixels back to the CPU, cast CPU rays per target or render a second scene for the inset. It reuses the scene's splat/atlas depth conventions; translucent splat contributions give an approximate visibility result, rather than a separate physically exact transparency calculation. The CPU uses the existing surface-ownership depth pass. Opaque textured surfaces occlude targets in both renderers. Magnification always samples the unannotated resolved image, so it cannot recursively enlarge its own panel.

## Appearance and glyphs

Style fields are `color` (`#rrggbb`), integer bitmap-font `scale` (1–4), `corner` (default 8), `width` (1) and `padding` (4), in frame pixels. Target styles override definition styles. Labels contain at most 80 Unicode characters per line; the second line is optional. Layout keeps label rasters within the frame and attempts to place them beside the bracket. It does not solve collisions among arbitrarily dense target sets: use priorities, activation or a smaller budget for readable scenes.

Rings are optional with `ripple: false`. Otherwise, `period` is seconds between waves, `speed` is pixels per second, `radius` and `width` are pixels, and `cell` is the square glyph-cell size. `chars` accepts up to 64 characters from the existing `KIT.ascii` atlas or the definition's `glyphs`. A missing ring glyph is an explicit error; unsupported label characters use `?`. Custom glyphs contain at most eight rows of six pixels, with `#` marking ink:

```js
const glyphs = { 日: ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####'] };
// { glyphs, targets: [{ ...target, ripple: { chars: '日0123:+' } }] }
```

The magnifier's `rect` uses normalized top-left `[x, y, width, height]` coordinates and must fit within the frame. Its default is `[.72, .08, .24, .24]`. Set `enabled: false` to leave the authored inset in place for later activation. `zoom` is 1–32. The crop keeps the target near its center and clamps to the source frame. The inset receives the resolved scene's grading and effects. Inspection itself runs after grading, render-graph passes and mixed-resolution layers, keeping its annotation palette crisp. A screen-space render-graph warp does not remap target projection coordinates; put a warp around the final output in a host if it should distort the HUD too.

Without mixed-resolution composition the CPU works in returned art-pixel coordinates, and its existing `px` controls display upscaling. To keep world art coarse and labels fine, set `composite.world.resolution` and render with final output dimensions. Native inspection is always at the requested frame resolution. Requested CPU art passes retain their original world dimensions, and transparent CPU exports gain annotation alpha coverage.

## Hosts and diagnostics

`KIT.inspection.prepare(definition)` returns immutable settings. `plan(settings, context)` returns projected targets plus `{ id, reason }` diagnostics (`candidate`, `inactive`, `hidden`, `unresolved`, `clipped`, `offscreen`, `back-facing`, `budget`). Supply the actual renderer camera with `view`, `eye`, `tangent`, `aspect`, `ortho`, `clipNear`, `clipFar` and `depthRange`, or override `project` and `resolve` for another host. `projector(camera)` returns normalized top-left UV, normalized linear depth and axial world depth.

`visibility(item, depthAt)` returns the coverage-weighted visible fraction; `depthAt(u,v)` supplies normalized linear depth. `font(settings)` reuses the ASCII atlas and custom glyphs. `labels(item, glyphs)` gives a small RGBA bitmap. `compose(frame, plan, settings, depthAt)` provides a software adapter and returns `inspection.targets` with final visibility values. These pieces let a host reuse the target definition without adopting the native frame layer. Native visibility remains GPU-only; planner diagnostics describe projection and activation, not a CPU copy of GPU occlusion.

CLI stills, sheets and clips accept `--inspection file.json|off` and `--inspection-focus id`. JSON definitions support static fields and anchors; use the JavaScript API for callbacks.

Live hierarchy anchors use `at:{node:"lantern",socket:"label"}` and inherit parent visibility. See [live scene hierarchy](live-scene-hierarchy.md).
