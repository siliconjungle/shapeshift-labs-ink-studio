# Stable dithering and camera review

Choose how the headless renderer places its dither pattern. Screen space follows the native art grid. World space fixes the pattern to scene coordinates, which works well for terrain during a camera pan. Object space uses rest coordinates so the pattern moves with a rigged prop. Camera-facing atlas cards use their image-plane coordinates. Pixels without a visible surface position use the screen grid.

Set `look.stable` on a built world, `finish.look.stable` in a diorama, or `visual.look.stable` in a simulation world. In the library, use `render(world, { stable: settings })` to override individual scene settings, or `stable: false` to turn stability options off.

```json
{
  "dither": "world",
  "spacing": 0.12,
  "origin": [0, 0, 0],
  "targets": [
    { "material": "foam", "dither": "screen" },
    { "object": "survey-lantern", "dither": "object", "spacing": 0.08 }
  ]
}
```

`spacing` is the size of a pattern cell in world or rest units. `origin` shifts the pattern grid independently of the camera snap `anchor`. A target can specify an object, a material, or both. The last matching target wins. Omitted target settings inherit from the scene. An empty `targets` array clears scene target rules when overriding them.

Anchors are used for the scene dither, tone maps, local palette constraints, the palette render stage, and effect ramp dithering where there is a surface hit. The same spaces work with native, coverage, and cluster resolve. The settings place the pattern. Set the dither strength on the scene, palette, or effect to decide how much of it appears.

The CLI accepts `--stable on|off|file.json`, `--dither-space screen|world|object`, `--dither-spacing n`, and `--dither-origin x,y,z`. Put per-target rules in the scene or JSON file. Orthographic camera snapping is a separate `--snap` option.

## Choose the space per palette policy

Set `space` inside a palette policy's `dither` settings. Screen space
places the pattern on the final art-pixel grid. World space places it
on the scene surface. Object space uses the rig's rest coordinates as
it moves. These settings work with [authorized pairs](pixel-look.md#authorize-dither-pairs).

```json
{
  "targets": [
    {
      "material": "cloak",
      "palette": ["#492f58", "#9b648e"],
      "dither": {
        "pattern": "bayer",
        "strength": 1,
        "space": "object",
        "spacing": 0.078,
        "origin": [0.017, 0.034, 0],
        "pairs": [{"colors": ["#492f58", "#9b648e"]}]
      }
    }
  ]
}
```

The same fields work on a scene target or default, a material's
`paletteConstraint`, a native look asset, and a palette policy at the
frame or palette stage. A policy with a space takes precedence over
`look.stable`, including when it explicitly chooses `screen`. Omit
the space to inherit the existing target or scene anchor. World and
object policies default to cells of 0.08 scene units and origin
`[0, 0, 0]`. Pixels without a surface hit use screen coordinates.

The headless library and CLI resolve all three spaces. WebGL uses
screen space for palette dither. Use `look inspect --renderer webgl`
to identify authored palette policies that request a spatial anchor.

The [print and cloth workshop](../examples/palette-dither-spaces.js)
shows screen-space print dots, a cloak with a rest-space weave, and
a world-space stone stipple on the same move.

```sh
ink-studio clip examples/palette-dither-spaces.js --ortho --w 288 --h 152 --px 1 --target -.45,1.47,-.05 --camera-pan .9,0,0 --from 0 --to 4 --fps 12 --out workshop.png
```

## Tune dither by region and scale

Set `dither.scale` to change the size of each pattern cell. A value of
`2` makes screen cells two art pixels wide, or doubles `spacing` in
world or rest space. A value of `0.5` uses half-size cells. A scale of
`1` preserves the original pattern.

```json
{
  "pattern": "bayer",
  "strength": 1,
  "space": "object",
  "spacing": 0.08,
  "scale": 0.7,
  "fade": [0.75, 1.5],
  "regions": [
    {
      "mask": { "type": "axis", "space": "rest", "axis": "y", "range": [0.4, 0.6] },
      "scale": 1.6
    }
  ]
}
```

`regions` accepts the same axis, texture, projected field and scene query
masks as [look policies](pixel-look.md#spatial-and-field-masks). Each region sets a cell scale,
a relative dither strength in `[0, 1]`, or both. Mask weights feather
those settings. Regions apply in authoring order, so a fully weighted
later region can override an earlier one. Set a region's strength to
zero to keep an eye or a printed mark solid while preserving its nearest
palette swatch. The policy's authorized pairs and reserved swatches
still apply. `--look-masks off` skips the region masks.

`fade: [low, high]` measures cell width in native art pixels. At or
below `low`, Ink uses the nearest solid swatch. Between the bounds, the
ordered pattern gains dots until it reaches full density at `high`.
World and object cells use the surface footprint of one art pixel,
including perspective, surface angle and the object's pose. Screen
cells have a fixed size at a given art resolution. Omit `fade` to keep
the authored pattern density at every distance.

The headless renderer uses all these settings. WebGL scene targets use
the base scale and fade on the screen grid. `look inspect --renderer webgl`
identifies policies with regional or spatial settings outside that path.

```sh
ink-studio render examples/palette-dither-scale.js --w 300 --h 162 --px 1 --t 0.35 --out near.png
ink-studio clip examples/palette-dither-scale.js --w 300 --h 162 --px 1 --fps 12 --out dither-scale.png
```

## Check a slow camera move

The [tidal observatory example](../examples/stable-dithering.js) uses world space on its stonework and object space on the turning lantern. Render at `--px 1` to examine the actual output pixels.

```sh
ink-studio clip examples/stable-dithering.js --ortho --camera-pan 0.9,0,0 --from 0 --to 5 --fps 12 --px 1 --out pan.png
ink-studio clip examples/stable-dithering.js --camera-orbit 28 --from 0 --to 6 --fps 12 --px 1 --out orbit.png
ink-studio clip examples/stable-dithering.js --camera-orbit 28 --from 0 --to 6 --fps 12 --px 1 --stable off --out orbit-screen.png
```

A pan shifts the camera target by the given XYZ world offset across the clip. An orbit turns the camera heading by the given degrees around the target. These moves can be combined. The scene's animation still advances at the clip’s chosen times. Compare the pattern on the same patch of stone or the same face of the lantern as it travels through the frame.

## Review palette shimmer across a shot

```sh
ink-studio palette shimmer examples/stable-dithering.js --ortho --camera-pan .65,0,0 \
  --camera-orbit 9 --from 0 --to 2 --fps 10 --w 230 --h 138 --px 1 \
  --animate --out palette-shimmer
```

The review renders each time and camera pose with screen, world, and
object dither. It overrides the anchor space in scene, target, material,
and stage palette settings while keeping the authored spacing, origin,
strength, pattern and pair rules. A fixed camera can review animated
lighting or palette changes on the same surfaces.

Ink follows visible surface pixels with the motion and rest-position
passes. Object and material IDs constrain the match, and a match must
fall within the local surface sample spacing. The review counts a swatch
reversal when a tracked surface changes from A to B and returns to A
within `--window` frames on B (default 3). The swatches must differ by
at least `--min-delta` in OKLab (default 0.025). Use `--min-coverage`
(default 0.8) to limit tracking to better-covered pixels. Unowned and
unmatched pixels are excluded from reversal counts. The report gives
eligible and tracked counts so you can check the coverage of the review.

`comparison.png` shows all three renders at the same peak frame, with
amber marking flips next to another swatch on the same surface in either
of the matched frames. Pink marks flips inside a swatch region.
`review.json` contains per-frame counts and pixel bounds, the swatch
pairs that flip most, and the reversal rate over tracked pixel steps.
`--animate` adds an animated PNG of the comparison across the shot.
The review measures the scene at native art resolution before
screen overlays.

In Node, use `ink.reviewPaletteShimmer(world, options)` for the image
and report. Pass `camera(phase, time)` to sample a camera path.
`pose(world, time)` can drive animated lighting or simulate the scene
once per sample. It is required for stateful worlds. An optional
`onFrame(image, { index, time })` receives the comparison for playback
or further review.
