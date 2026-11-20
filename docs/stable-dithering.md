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

## Check a slow camera move

The [tidal observatory example](../examples/stable-dithering.js) uses world space on its stonework and object space on the turning lantern. Render at `--px 1` to examine the actual output pixels.

```sh
ink-studio clip examples/stable-dithering.js --ortho --camera-pan 0.9,0,0 --from 0 --to 5 --fps 12 --px 1 --out pan.png
ink-studio clip examples/stable-dithering.js --camera-orbit 28 --from 0 --to 6 --fps 12 --px 1 --out orbit.png
ink-studio clip examples/stable-dithering.js --camera-orbit 28 --from 0 --to 6 --fps 12 --px 1 --stable off --out orbit-screen.png
```

A pan shifts the camera target by the given XYZ world offset across the clip. An orbit turns the camera heading by the given degrees around the target. These moves can be combined. The scene's animation still advances at the clip’s chosen times. Compare the pattern on the same patch of stone or the same face of the lantern as it travels through the frame.
