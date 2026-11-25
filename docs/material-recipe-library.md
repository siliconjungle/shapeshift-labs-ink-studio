# Material recipe library

Ink ships twelve original materials as editable graphs. The stock textures bake from geometry, noise, image operations, color ramps, and masks. Each recipe includes a catalog thumbnail, clearly named graph stages, and exposed controls.

| Recipe | Controls specific to the material |
| --- | --- |
| Kiln Brick | Course count, mortar width, and firing variation |
| Harbor Tile | Tile count, joint width, and copper inlay strength |
| Juniper Grain | Grain frequency, knot distortion, and grain cut |
| Indigo Cloth | Fold frequency and height, and yarn contrast |
| Sedge Weave | Thread count and width, and fibrous variation |
| Fox Pile | Lock density, nap direction, and variation in guard hair scale |
| Lime Cracks | Crack frequency, fissure width, and wandering edges |
| Chipped Enamel | Chip density and scale, and exposed primer width |
| Scored Steel | Scratch density and length, and brush direction |
| Rain Streaks | Trail density, runoff angle, and deposit strength |
| Copper Patina | Oxidation threshold, bloom frequency, and pitting depth |
| Forest Floor | Litter density and scale. The signed shapes, volumes, and local surface maps remain editable in the graph. |

All recipes share a seed, texture size, and relief depth control. They export tileable base color, signed relief height in art pixels, tangent normals, roughness, and a feature mask specific to the recipe. Scored Steel and Copper Patina also export metalness. The lit preview is an additional output with a fixed inspection light.

## Browse and adapt

The default registry is available through the existing material library command and the Node API. Pass a registry path to browse any other catalog.

```sh
ink-studio graph material-library
ink-studio graph material-library --tag Textiles
ink-studio graph material-parameters materials/recipes/graphs/wood.material.json
ink-studio graph run materials/recipes/graphs/wood.material.json --out /tmp/ink-juniper
```

The library lists each graph's source path. Open or copy the graph to edit the palette stops, shape definitions, and individual layers. To supply different control values at bake time, pass a JSON object keyed by root input ID with `graph run --inputs values.json`.

## Interactive preview

```sh
node examples/material-recipe-library/demo.cjs /tmp/ink-material-recipes
```

Open the generated `index.html`, select a swatch, and edit its controls. Switch map tabs or enable the 2 × 2 preview to check the repeat. **Original graph** opens the stock material file. **Save edited graph** exports a graph with your current control defaults for the selected material.

Recipe authors can edit `materials/recipes/source.cjs` and run `node materials/recipes/build.cjs` to regenerate the graph files, thumbnails, and locked registry. The script accepts an alternate output directory for review.
