# Live sun lighting

## Relight baked color and detail

Set `finish.relighting` in a JSON diorama or `relighting` in `B.finish()`. Both renderers can change the light on baked swatches, fine detail tiles, per-pixel patterns, and edge sprites while preserving the original geometry and texture data. This mode uses the baked shadow detail as part of the surface color.

| Field | Behavior |
| --- | --- |
| `lights` | Up to 32 named point lights. Each has an XYZ `at`, `range`, hex `color`, `intensity`, optional `enabled`, and optional target `select`. Lights fall off with distance and follow the surface normal. |
| `sun` | Defaults to `"environment"`, which follows the primary celestial sun or sky profile. Supply `direction`, `color`, and `intensity` for a fixed sun. Use `false` for ambient and point lights. |
| `referenceTime` | Time in seconds for the baked daylight look, defaulting to zero. The sun's contribution is relative to that reference. Use `skyTime` to seek the daytime independently of scene motion. |
| `ambient` and `strength` | Ambient light defaults to 0.45. Strength runs from zero to one and controls how much the lighting changes the bake. |
| `select` | Limit the rig to named surfaces with the existing target selectors. |

Pass a `relighting` override to either renderer to move or recolor lights without rebaking. Light changes merge by ID, and a `null` entry removes a light for that frame. Pass `false` to disable the mode. The CLI accepts `--relighting on|off|file.json` and `--sky-time seconds`. Emissive splats keep their authored colors.

## Authored proxy shadows for moving rigs

Use `sun.shadows` with captured lighting to let a moving part cast onto
explicitly named receivers. A proxy follows its owning part's current affine
pose. The CPU stage painter works with Ink's regular draw path. WebGL2 hosts can
run the same test in their own shader using `KIT.light.proxyGLSL`.

Set `S.shSteps = 0` **before baking the proxy receivers**. This turns off the
baked shadow march for sun and point lights on that bake. Ambient occlusion and
the base palette ramp still bake as usual. Set `bake: 'unshadowed'` to declare
that starting point. Ink checks this for rows recorded by `KIT.light.capture`.
Rebake an older receiver with a painted cast shadow
before enabling this option. The live shadow scales direct sunlight. Ambient,
sky fill, lamps, and flash still follow captured lighting.

```js
// Before baking with the sculpt and builder already set up
S.shSteps = 0;
const capture = KIT.light.capture(B, S);
const rig = KIT.rig(B, S);
// Sculpt solids tagged 'fuselage', 'wing', and 'tail', then call S.bake().
const stage = KIT.stage(B.finish({}));
rig.bind(stage);

const sun = {
  dir: S.sun, amb: S.amb, sky: S.sky, k: S.sunK,
  parts: ['fuselage', 'wing', 'tail'],
  keep: Infinity,
  shadows: {
    bake: 'unshadowed',
    bias: 0.02,
    casters: [
      { part: 'wing', type: 'box', center: [0, 0.5, 0], halfSize: [1.7, 0.05, 0.45],
        receivers: ['fuselage', 'tail'] },
      { part: 'fuselage', type: 'capsule', a: [0, 0, -1], b: [0, 0, 1], radius: 0.32,
        feather: 0.05, receivers: ['wing'] }
    ]
  }
};
stage.add(KIT.light.system(stage, capture, [], { sun }));
// Set and apply the rig transforms before stage.update(), or animate
// the rig in a stage system that runs before the light system.
```

Boxes are axis-aligned in the unposed bake. Author their centers and half sizes,
and capsule endpoints and radii, in those same coordinates. The bias offsets the start of the ray along the current receiver
normal in world units. Boxes have a hard edge. Capsule `feather` is an optional
fade inside the radius, in bake units. A capsule with coincident endpoints
acts as a sphere. Each of the one to eight proxies has its own receiver list.
Every receiver must also be in `sun.parts`. A proxy ignores a sample already
inside it, and a collapsed part has no shadow volume. Keep proxy shapes clear
of neighboring surfaces where you want a clean seam.

Use `sun.shadows: false` for an A/B against unoccluded captured sunlight.
Leave this option off to use regular captured lighting. Use the headless
directional shadow map below when you need shadows from the whole scene.

### Host shader wiring

After binding the rig, call `KIT.light.pack(stage, capture, { sun })` as in
[captured lighting](procedural.md#captured-lighting-for-a-host-renderer). Call
`KIT.light.proxyFrame(packed)` after updating the pose. It refreshes a
reusable frame from the bound rig and returns `null` when proxies are off.
A host that keeps its own pose palette can pass it as the second argument.
Use the same layout as `rig.M`: nine row-major matrix elements and three
translation values per part, including slot zero.

- Upload `frame.uniforms` with `gl.uniform4fv` to
  `uCapturedProxies[0]`, and `frame.bias` to `uCapturedProxyBias`.
- For each receiver use `frame.masks[partId]`, with part ID from the second
  `rigRamp` component. Pass that byte to the shader as an attribute or draw
  uniform. It is fixed for the capture and can be uploaded once.
- Include both `KIT.light.glsl` and `KIT.light.proxyGLSL` in a
  high-precision GLSL ES 3.00 shader. In the live-sun branch, call
  `capturedProxyVisibility(worldPosition, worldNormal, sunDirection, uint(mask))`.
  Pass the result as the fourth argument to `capturedSun` before adding lamp
  shares and evaluating `capturedBase`.
- `KIT.light.proxyVisibility(frame, mask, position, normal, direction)`
  returns the same direct-light factor from 0 to 1 on the CPU.
  `KIT.light.step` uses the last refreshed proxy frame.

## Headless directional relighting

The Node renderer and CLI can relight sculpted objects with one directional sun at render time. A light-space depth map is rebuilt from posed opaque splats. Move the light to change illumination and cast shadows while keeping the same sculpt.

```sh
node cli/ink-studio.js render examples/live-sun.js --t 4 --raw --px 1 --out live.png
node cli/ink-studio.js render examples/live-sun.js --t 4 --live-sun off --raw --px 1 --out baked.png
node cli/ink-studio.js render examples/beacon-pool.js --live-sun --sun-direction 0.7,0.55,0.2 --out pool.png
```

For a JavaScript scene, set `S.captureAlbedo = true` before baking. Use a material's `albedo` field to author the unlit colour explicitly. The capture otherwise uses the last colour of the material's primary ramp. Direct builder dabs can supply the same information with `B.describeAlbedo(first, end, color)` and a surface normal. Older pixel-material bakes can use their existing ramps. Rows with missing lighting data keep their baked colour. CLI overrides capture albedo during the scene build.

```js
const light = {
  direction: seconds => [Math.sin(seconds), 0.72, Math.cos(seconds)],
  ambient: 0.32,
  intensity: 0.88,
  shadows: true,
  mapSize: 512,
  bias: 0.02,
  filter: 1
};

const image = ink.render(world, { t: 2, liveSun: light });
```

Set `world.liveSun` in the finished scene for a default. Per-render settings can override individual scene fields. Baked lighting is the default for other scenes. Pass `liveSun: false` or `--live-sun off` to compare the baked result. A direction is a vector from the scene towards the sun, or a function of render time in seconds. It is normalized once per frame.

| Option | CLI | Default |
| --- | --- | --- |
| `direction` | `--sun-direction x,y,z` | `[-0.52, 0.64, 0.57]` |
| `ambient` | `--sun-ambient n` | 0.32 |
| `intensity` | `--sun-intensity n` | 0.88 |
| `shadows` | `--sun-shadows off` | true |
| `mapSize` | `--shadow-map-size n` | 512, with a range of 32–2048 |
| `bias` | `--shadow-bias n` | 0.02 scene units |
| `filter` | Library option | 1 texel, with a range of 0–2 |

The map fits opaque scene splats independently of the viewing camera, so perspective and orthographic views can reuse the same authored light. Glass and outline-free particles do not cast shadows. Emissive colours keep their emission. Pixel-material renders sample their original ramps with the live light level. Raw renders use captured albedo with ambient and direct lighting. Highly specialized baked material effects may look different under live lighting. This version runs in the headless renderer.

[Finite curve strands](curve-splats.md#depth-crossings-and-shadows) can opt into
casting and receiving shadow independently. Their cast follows the posed curve
and can transmit light through translucent sections and authored gaps.

### Strand shadow budgets

Set `strandShadows: { maxSpans: 320, maxLayers: 12 }` inside `liveSun` on a
headless frame or scene. `maxSpans` is a nonnegative target for submitted finite
shadow spans. Ink can substitute [authored shadow guides](curve-splats.md#budget-strand-shadows-separately)
within their light-space error bounds. A target of zero tries all eligible
groups. Omit the target to use the authored physical strands.

`maxLayers` limits the retained translucent depth layers per shadow texel
to 1–64. With a limit, Ink preserves the nearest layers and combines the
deepest layers into one at the front of that tail. A receiver behind the
tail gets the full combined attenuation. A receiver inside it samples the
combined layer. Omit this limit to keep each depth layer.

Use `--shadow-strand-spans 320` and `--shadow-strand-layers 12` for CLI renders.
`strandShadows: false` on a frame clears the scene's limits. Opaque casters
keep using the normal shadow map, and the strand budgets are independent of
camera resolution, strand LOD, and card selection.

```sh
node cli/ink-studio.js strand-shadow-review --motion --out out/strand-shadows
```

## Art-directed shadows

Set `finish.look.shadowArt` in a JSON diorama or pass `shadowArt` in the third argument to `makeBuilder` before sculpting. The same settings guide baked lighting and headless live sun. The CLI accepts `--shadow-art file.json` for JSON bakes and live-sun renders.

| Setting | Behavior |
| --- | --- |
| `ramp` | Select evenly spaced steps of visibility and map each to a direct-light gain. Supply 2 to 16 nondecreasing gains from zero to one, ending at one for clear light. The material's own palette ramp supplies the colours. |
| `cast` | Choose which geometry casts shadows with `include` and `exclude` selector arrays. |
| `receive` | Choose which surfaces respond to those shadows, using the same mask fields. |
| `objects` | Use an object ID as a key and set its `cast` and `receive` flags independently. The object still has to pass the existing masks and be eligible for that light's shadow path. |
| `small` | Choose a `belowPixels` threshold and a `referenceSize` in world units, which defaults to one. When that span projects to fewer pixels on the camera target plane, use an optional simpler `ramp` and `strength` from zero to one. Zero strength suppresses the cast shadow. |

Masks accept object, entity, material, surface, prefab, and tag selectors. A target matches a mask if it passes any supplied include selector and no exclude selector. Include is unrestricted when omitted. Masks leave the visible geometry and ambient occlusion intact.

The CPU and WebGL renderers select the small-size variant for baked surface splats as camera scale changes. Headless live sun evaluates the same rule against its current depth map. Programmable point lights that use a cached visibility map can use the masks and regular ramp through `K.light.shadow`. Set the programmatic render option `shadowArt: false` to use the regular baked variant or the unstyled live sun.

Use `--shadow-bounds minU,minV,maxU,maxV` to pin the live sun's shadow
map to a light-space rectangle for a render. The authored version is
`finish.liveSun.bounds` with `min` and `max` UV pairs. View the axes, bounds,
and effective map dimensions with the [scene editor shadow preview](scene-editor.md#control-shadows-by-object-and-light).

## Sky and ground bounce

Choose extra diffuse fill from above and below in either the Node API or CLI. Each side can use a preset, a hex colour, or `off`.

```sh
node cli/ink-studio.js render examples/bounce-light.js --sky-bounce clear-sky --ground-bounce sand \
  --ground-bounce-intensity 0.55 --raw --px 1 --out sand.png
node cli/ink-studio.js render examples/bounce-light.js --sky-bounce clear-sky --ground-bounce water \
  --ground-bounce-intensity 0.55 --raw --px 1 --out water.png
```

Presets are `clear-sky`, `overcast`, `sand`, `snow`, and `water`. Quote a custom hex colour in the shell, such as `--ground-bounce '#ec885f'`. Either side defaults to intensity 0.4 when enabled, with an adjustable range of 0–4. An intensity-only override keeps the scene colour and uses clear sky or sand if that side has no authored colour. Set either choice to `off` to disable it independently.

```js
ink.render(world, {
  liveSun: {
    ambient: 0.24,
    skyBounce: { color: '#92b6ff', intensity: 0.48 },
    groundBounce: { color: 'sand', intensity: 0.32 }
  }
});
```

The same fields can live in `world.liveSun`. To animate them, supply a function of render seconds for either field. It can return a preset, a settings object, or `false`. Omit both to use the original neutral ambient light. Set `intensity: 0` on the sun to use hemisphere fill without direct sunlight.

Bounce follows each posed world normal. Upward faces receive the upper fill, undersides receive the lower fill, and vertical faces receive a mix. Bounce adds diffuse light in shadows independently of the directional shadow map. Pixel materials read their normal ramp brightness and carry the bounce tint into colour resolution. A fixed export palette limits the available tints, so use `--raw` to preview a new colour choice.


## Baked shadow march

For a new JSON scene, start with `"finish": { "shadowMarch": { "emptySpace": "clear" } }`.
To trace farther across a large set, use
`"shadowMarch": { "steps": 128, "distance": 42, "emptySpace": "clear" }`.
`steps` is the maximum number of samples
per baked directional or point-light shadow ray and defaults to 20.
Use an integer from 0 to 4096. Zero turns off baked shadow marching.
`distance` is the maximum directional ray length in world units and defaults
to 16. A point light's shadow ray ends at the light.

With `emptySpace: "clear"`, the directional march crosses empty space without
dimming direct sun. Nearby samples still determine penumbra, and an occluder
hit still casts a solid shadow. Omitting the setting uses `"legacy"` so
existing bakes keep their look. For unstyled shadows, the legacy march can dim
open surfaces at long distances. Styled shadows already skip capped samples.
Point-light rays use the same behavior in either mode.

When programming a sculpt directly, set `S.shEmptySpace = 'clear'` before
`S.bake()`. Use `S.shSteps` and `S.shLen` to let the directional ray reach
distant casters. Higher step counts can increase bake time.
