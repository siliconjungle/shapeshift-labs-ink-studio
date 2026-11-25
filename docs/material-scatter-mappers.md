# Scatter mappers

Connect the `surface` output of `image.shapeSplatter` to the mappers to select stamps, place new material on their visible surfaces, or rebake their geometry. The surface can also be rebuilt with `image.scatterSurface` from independently saved instance IDs, shape IDs, UVs, and coverage. Include the optional height, normal, and layout maps for richer inspection. All inputs must share a grid, pivot, pixel pitch, and addressing.

| Node | Operation | Outputs |
| --- | --- | --- |
| `image.scatterMask` | Select visible instances, with fractional coverage at their edges | Mask and reusable selection |
| `image.scatterColor` | Replace or tint selected texels with a solid color or stamp-space textures | Typed color and selection mask |
| `image.scatterGrayscale` | Replace or multiply selected scalar data with a solid value or stamp-space textures | Typed grayscale data and selection mask |
| `image.scatterInspect` | Read a texel or look up an instance by ID | Inspection record and single-stamp mask |
| `image.scatterEdit` | Create hide or shape substitution instructions from the selected IDs | Record for Shape Splatter's `edits` input |

## Select and map

`instanceIds`, `shapeIds`, `instanceRange`, and `shapeRange` intersect when combined. IDs start at one and range endpoints are inclusive. `fraction` selects a stable seeded subset of whole stamps. `invert` complements the selection among visible stamps. Connect the mask node's `selection` output to multiple mappers and edits to keep their subset identical.

Both mappers accept up to 32 textures, which cycle by one-based shape ID or instance ID. `textureBy: "random"` picks one texture per instance using the mapper's `seed`. Rotation in degrees is about the center of the stamp UVs, followed by per-axis scaling and a UV offset. Filter and border settings default to those of the texture. With an optional aligned base image, unselected samples pass through byte for byte. Recoloring uses linear-light compositing, stamp coverage, texture alpha, and mapper opacity. Tint requires a base, multiplies the selected samples, and preserves base alpha. With no base, color yields a transparent RGBA layer and grayscale yields a zero-filled scalar map.

Grayscale textures and the optional grayscale base must be single-channel unitless data or masks. The solid and texture weights lie between zero and one. Color textures must be typed color images, and solid color accepts a hex string or sRGB tuple. In a graph project, write a literal mapper options record with the graph's value binding, for example `"options": { "value": { "value": "#2cb8a1", "opacity": 0.8 } }`.

## Inspect and rebake

Use `{ "pixel": [x, y] }` to see which stamp the bake resolved at that native texel. Use `{ "instanceId": 12 }` to inspect that stamp and sample its first visible texel in row order. The record gives visible texel count, coverage sum, half-open bounds, placement transform when available, and local UV, height, normal and coverage at the sampled texel. A retained layout distinguishes fully occluded instances from missing ones.

Color and grayscale mapping act on the top resolved layer. To reveal geometry behind a stamp or substitute a different library shape, branch from the source bake through `scatterMask.selection → scatterEdit → secondShapeSplatter.edits`. Reuse the first bake's library, maps, dimensions, and options, with an explicit shared seed. The new bake recomputes overlap, height, normals, UVs and coverage. Replacement keeps the selected stamp's ID, anchor, scale and rotation. If an ID is both hidden and replaced in a manual edit record, hiding takes precedence.

## Demo

```sh
node examples/material-scatter-mappers/demo.cjs /tmp/ink-scatter-mappers
```

Open the generated `index.html` to click a stamp in the original relief, apply changes to one stamp or its shape family, and compare color, grayscale, selection mask, hide and replace. The same command exports the editable material graph and example maps. Replay the saved graph with the CLI.

```sh
ink-studio graph run /tmp/ink-scatter-mappers/riverbed-restorer.material.json --out /tmp/ink-scatter-replay
```

The selection and texture-mapping workflow draws on [Designer’s grayscale mapper](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/texture-generators/patterns/shape-splatter-v2-mapper-grayscale), [color mapper](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/texture-generators/patterns/shape-splatter-v2-mapper-color), and [stamp mask](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/texture-generators/patterns/shape-splatter-v2-to-mask).
