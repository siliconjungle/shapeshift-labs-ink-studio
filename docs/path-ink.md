# Ink through reflection and refraction

Render retained signed-distance sculpts as a native-grid still or clip. Specify a palette and optional ink line for each view of a subject. A keeper can have a muted blue reflection in a pool and a green drawing seen through a curved porthole while its direct view uses the regular SDF lighting.

```sh
node cli/ink-studio.js path-ink examples/path-ink/relay-pool.js \
  --w 160 --h 128 --samples 24 --t 0.6 --out keeper.png
node cli/ink-studio.js path-ink examples/path-ink/relay-pool.js \
  --w 160 --h 128 --samples 16 --from 0 --to 1.2 --fps 10 \
  --camera-orbit 18 --out keeper-clip.png
```

The command writes a PNG or animated PNG and a `.path-ink.json` report. Use `--plan look.json` to replace the scene's `look.pathInk`. The Node entry point is `renderPathInk(world, options, traceSettings)`. Pass a look as `options.pathInk`, and pass `width`, `height`, `samples`, `bounces`, `seed`, `exposure`, or `posed` to the trace settings as needed. For animation, pose the world before evaluating each frame. When building a JavaScript scene for Node, set `S.keepReferenceSdf = true` before baking the sculpt.

## Route styles and reflectors

```json
{
  "reflectors": [
    {"select":{"object":"flood-pool"},"reflectance":0.99,"roughness":0.008,"tint":"#d9ecfa"}
  ],
  "rules": [
    {
      "id":"pool-keeper",
      "via":"reflection",
      "interface":{"object":"flood-pool"},
      "select":{"object":"keeper"},
      "palette":["#24305a","#436889","#82afb5","#e8d19a"],
      "stops":[0.12,0.27,0.49],
      "ambient":0.28,
      "ink":{"color":"#151b39","width":0.61,"features":["silhouette","seam","crease"],"crease":60}
    }
  ]
}
```

- `via` matches `reflection` or `transmission` anywhere along the camera-connected path. `camera` matches a direct view. `interface` can name the reflector or glass involved and `select` can name the receiver, its material, or another target selector. The first matching rule owns the sample, so rule order controls paths that both reflect and refract.
- `palette` lists swatches in tone order. `stops` gives increasing linear luminance thresholds between swatches. The band is evaluated from local direct light, the material's emission, and the rule's `ambient` term. `depth` limits the number of optical events. The default is eight.
- `ink` optionally marks silhouettes, material seams, and creases. `width` specifies the neighbor-ray offset in native pixels, and `crease` specifies the normal-angle threshold in degrees. The neighbor rays replay the same optical events and roughness sample. When a neighboring ray crosses a different optical interface, it cannot contribute an ink line to that sample.
- `reflectors` gives named opaque sculpts a specular component. `reflectance` controls the specular share. `roughness` spreads the outgoing reflected ray in a cone, and `tint` sets its color. Use closed sculpt glass for refraction. Glass keeps its existing Fresnel, absorption and refraction behavior.

The selected swatch or ink color is returned as radiance along that ray, through the material tint and absorption and into the sample average. Palette decisions happen per camera path, so the same output pixel can mix ordinary, reflected and refracted radiance. The rule shades the first styleable surface on a camera-connected optical path. Diffuse bounces retain the physical reference transport.

The path-ink renderer uses retained finite SDF geometry and includes eligible affine-rigged sculpts. It is a headless render path. The Node result includes per-pixel coverage for camera, reflection, transmission and line rules, plus separate reflected and transmitted radiance buffers for review.

## Reproduce the comparison

```sh
node examples/path-ink/review.js relay-path-ink
```

This compares identical cameras, lights, glass and reflector geometry with the route rules enabled and disabled. The report records each route's coverage and checks whether any pixel changed outside pixels reached by a style rule. The experiment draws on West, Mukherjee and Yue's work on carrying lines and tone through light transport. [Lifting Lines and Tone, SIGGRAPH 2026](https://s2026.conference-schedule.org/presentation/?id=papers_981&sess=sess155)
