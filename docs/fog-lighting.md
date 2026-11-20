# Local lights in fog

Add `spots` to a scene’s `volumeLighting` to aim a beam through bounded mist. Add `points` for omnidirectional sources such as pier lanterns. Both arrays can contribute to the same volume along with the existing `point` and `sun` settings.

```js
const volumeLighting = {
  ambient: .25,
  spots: [{
    at: [-5, 5, 0],
    direction: t => [1, -.07, .2 * Math.sin(t)],
    innerAngle: 6,
    outerAngle: 12,
    radius: 20,
    color: '#ffe0a3',
    intensity: 7
  }],
  points: [
    { at: [0, 1.6, 1], radius: 2.5, color: '#ffae63', intensity: 4 },
    { at: [2, 1.6, 1], radius: 2.5, color: '#ffae63', intensity: 4 }
  ],
  shadow: K.atmosphere.occluder(S.modelSource().field.sdf, { steps: 48 })
};
```

`at` is a world-space XYZ position and `direction` points from the source into the scene. Both can be functions of scene time, as can `intensity`. Ink evaluates them when it prepares the lighting for a frame. Cone angles are measured from the axis in degrees. The core keeps full angular intensity through `innerAngle`, then fades to zero at `outerAngle`. Set the angles equal for a hard edge. Point lights and spots fade with distance up to their world-space `radius`.

Put one or more lit [bounded density fields](scene-optics.md#bounded-density-and-lit-volumes) in the scene’s `atmosphere`. The CPU renderer adds local scattering while keeping fog density and transmittance independent. It skips temporal accumulation for animated local lights to keep a moving beam sharp.

Capture the sculpt’s field before baking to use its geometry as an occluder, as shown above. The shared `shadow` query checks the segment from each fog sample toward the light and stops at the emitter. Set `castsShadow: false` on an individual lamp to let that light pass through blockers. Place emitters in open space or use a ghost for the glowing mesh.

## Project a light cookie

A spotlight can use the same stencil in fog and on nearby surfaces. Add
`cookie` to the spot and give it a positive `surfaceIntensity` to cast light
onto surfaces. `intensity` still controls scattering in fog. Both intensities
can be functions of scene time in JavaScript. In a JSON diorama, put the spot
under `finish.volumeLighting.spots`.

```js
const spot = {
  at: [-2, 2, 1],
  direction: [1, -.1, -1],
  innerAngle: 22,
  outerAngle: 28,
  radius: 8,
  color: '#ffbb77',
  intensity: 5,
  surfaceIntensity: 18,
  cookie: {
    width: 3,
    height: 3,
    mask: [0, 255, 0, 255, 128, 255, 0, 255, 0],
    angle: 24,
    roll: t => 45 * t
  }
};
```

Paint one byte per texel, row by row from the top left. Zero blocks the light,
255 passes it, and gray attenuates it. To use a grayscale PNG in a JavaScript
scene, read it with `cli/png.js` and multiply each grayscale channel by its
alpha before converting to a byte.

```js
const { w, h, data, max } = require('./cli/png.js').raster('stencil.png');
const mask = Array.from({ length: w * h }, (_, i) =>
  Math.round(255 * data[i * 4] * data[i * 4 + 3] / (max * max)));
spot.cookie = { width: w, height: h, mask };
```

`angle` is the stencil’s vertical half-angle in degrees and defaults to the
spot’s outer angle, capped at 89.9°. Width follows the image aspect ratio.
The spotlight cone still clips the projection. `up` is an optional world-space
vector that orients the top of the image at zero `roll`. `roll` uses degrees
and can vary with time. Use the default `filter: 'nearest'` for hard texels
or `filter: 'linear'` for a smoother pattern. The mask affects illumination
only. Camera visibility, light through the fog, and fog density remain
separately controlled.

The CPU renderer and CLI apply the cookie to diffuse surfaces and bounded
lit fog. A supplied `shadow` query serves both paths. Surface lighting can
also use retained static sculpt casters, as in [shaped area lights](area-lights.md#shaped-area-lights).
The `volumeLocalLights` and `volumeLocalShadows` options affect the fog path.
For the visible lamp, set the bulb’s `core` and screen-space `glow` with
an `emissiveFinishes` profile. The [Lantern Archive](../examples/light-cookies.js)
has controls for each part of the light.

```sh
ink-studio clip examples/light-cookies.js --from 0 --to 6 --fps 12 \
  --w 224 --h 160 --px 1 --out lantern-rosette.png
ink-studio render examples/light-cookies.js --params '{"design":"tide"}' \
  --t 3.1 --w 224 --h 160 --px 1 --out lantern-ripples.png
```

## Compare a render

```sh
ink-studio render examples/lighthouse-mist.js --t 2.8 --raw --out lighthouse.png
ink-studio render examples/lighthouse-mist.js --t 2.8 --raw --volume-local-shadows off --out unoccluded.png
ink-studio render examples/lighthouse-mist.js --t 2.8 --raw --volume-local-lights off --out ambient.png
```

In the [lighthouse scene](../examples/lighthouse-mist.js), the pilot hut cuts through the rotating beam and three warm lanterns light the low mist over the pier. Both CLI options accept `on` or `off`. In `ink.render`, use `volumeLocalLights` and `volumeLocalShadows` as booleans. The toggles leave directional lighting and its shadow query available.

See [additional light emitters](light-emitters.md) for RGB/procedural cookies and shared lighting of native analytic fog volumes.
