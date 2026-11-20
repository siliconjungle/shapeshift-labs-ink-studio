# Silhouette protection

Give a named actor or landmark its own fog and contrast treatment in the headless renderer. Protection follows the selected surface through the render, including motion and changes in camera direction. Fog adjustment scales the optical depth between the view and a protected surface. It also scales the legacy distance haze on that surface. Background fog, cloud coverage, water absorption, and geometry occlusion keep their original behavior.

Set `look.silhouetteProtection` on a world, `finish.look.silhouetteProtection` in a diorama, or `visual.look.silhouetteProtection` in a simulation world. The first matching target applies. Use Ink’s object, entity, material, surface, prefab, or tag selectors. Rich atlas placements can supply an `objectId` or `materialId` to join the same targeting system.

```json
{
  "targets": [
    {
      "id": "courier",
      "select": { "object": "courier" },
      "fogScale": 0.2,
      "contrast": 1.35,
      "pivot": 0.5
    },
    {
      "id": "beacon",
      "select": { "object": "mist-beacon" },
      "fogScale": 0.5
    }
  ]
}
```

- `fogScale` runs from 0 to 2. Use 0 for a clear silhouette, 1 for the scene’s normal fog, and values above 1 for stronger fog.
- `contrast` runs from 0 to 4 and defaults to 1. Values above 1 deepen shadows and brighten highlights around the `pivot` luminance. Emissive details keep their own contrast.
- Use `--silhouette-protection on|off|file.json` or `render(world, { silhouetteProtection })` to use the authored configuration, disable it, or replace it. Both raw and stylized rendering support protection.

## Give a shot a focal subject

Add `focus` beside `targets` to treat the area around the visible subjects. Select target IDs with `subjects` or omit the list to use every target. Existing subject fog and contrast rules still apply to their named objects.

```json
{
  "targets": [
    { "id": "produce", "select": { "object": "west-produce" }, "fogScale": 0.32, "contrast": 1.6, "pivot": 0.31 },
    { "id": "lanterns", "select": { "object": "west-lanterns" }, "fogScale": 0.28 }
  ],
  "focus": {
    "subjects": ["produce", "lanterns"],
    "radius": 57,
    "depthBias": 0.24,
    "background": { "contrast": 0.52, "pivot": 0.5, "saturation": 0.42, "detail": 0.32 },
    "rain": { "subject": 0.1, "surroundings": 0.78 }
  }
}
```

- `radius` sets the feather's reach in native art pixels. `depthBias` allows a small depth overlap, measured in scene units along the view axis. Nearer obstructions and fully hidden subjects respect the visibility pass.
- `background.contrast` and `background.saturation` range from 0 to 2, with 1 giving the usual treatment. `pivot` is the luminance that contrast compresses toward. `detail` ranges from 0 for maximum smoothing to 1 for the usual detail. The filter uses neighboring pixels on the same object and material and preserves visible precipitation, subject edges, and emissive cores.
- `rain.subject` controls falling rain over the subject. `rain.surroundings` controls the nearby rain. Both range from 0 to 1 and feather back to full rain at the edge of the region. This control changes rendered opacity and the precipitation pass. Rain impacts, wetness, and snow use their authored simulation settings.

Focus uses an additional visibility raster in the headless renderer. Set `focus: false` to compare with ordinary subject protection, or use `--silhouette-protection off` for a scene-wide baseline. It can travel in an environment pack as part of `settings.look.silhouetteProtection`.

```sh
node cli/ink-studio.js render examples/market-shot-focus.js --t 2.3 --w 340 --h 188 --px 1 --out market.png
```

## Check the export views

```sh
ink-studio silhouette-review examples/silhouette-protection.js --w 112 --h 96 --directions 8 --cols 4 --raw --out review.png
```

Each pair shows the baseline on the left and the protected render on the right. Both use one art pixel per output pixel at the requested width and height. The heading and pitch match the sprite atlas export. Use `--yaw`, `--pitch`, `--pitches`, `--pivot`, or `--t` to inspect a particular pose or camera setup. Use `--scale` for integer enlargement of the sheet.

The companion JSON reports visible subject pixels, border contact, and mean edge luminance contrast before and after protection for each view. Contrast is the mean absolute change in luminance across the subject’s boundary on the native grid, in 0–1. Fully occluded targets have zero pixels and no score.

From code, `silhouetteReview(world, options)` returns the sheet and report using the world’s current pose. Renderers can also request `captureSilhouetteProtection: true` to get a top-down `silhouetteMask`. Zero represents unprotected pixels. Other values are one-based indices into the authored target list.
