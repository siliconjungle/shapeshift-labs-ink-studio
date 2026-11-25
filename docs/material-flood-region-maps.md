# Typed Flood Fill region maps

Use `image.floodRegions` once to build a reusable region field, an ID image, and a table of regions. Connect the field to `image.regionMap` to bake individual properties, or to `image.regionLookup` to sample a pattern or registered material map.

## Labeling and tile seams

The fill thresholds decoded samples at `threshold` (default 0.5) with optional `invert`. It selects alpha on RGBA, linear luminance on RGB, and the scalar on height, data, and mask images. Set `channel` to choose a specific color or scalar component. Choose four- or eight-neighbor connectivity and `minArea` in texels.

Each region's ID is one plus the row-major index of its first selected texel. Zero means background. IDs stay the same when a region keeps its anchor and extent on the same raster. Adding or removing another island does not renumber it. Moving, splitting, merging, or changing the anchor can change the ID. Use a tracking workflow for identity across changing frames.

Borders inherit from the source image and accept an override such as `{u: "wrap", v: "clamp"}`. A wrapped axis joins actual neighbors across the seam, including corner connections with eight neighbors. Clamp, mirror, and transparent do not join opposite edges. Each region is measured in an unwrapped coordinate chart, so its bounds, orientation, UVs, and gradients stay coherent as a compact region crosses a seam.

The region table includes area, seed, canonical centroid, chart centroid, edge-coordinate bounds, major-axis angle, and per-axis `crosses` and `winding` flags. Bounds may extend past the tile edge. A component with a closed path that winds around the whole tile has no single continuous chart along that axis. It keeps one ID and uses the canonical tile cut on the winding axis. The other axis can still unwrap.

## Derived maps

| `kind` | Samples |
| --- | --- |
| `id` | Stable region key as an exact float32 integer. |
| `center` | Canonical XY centroid, constant per region. |
| `bounds` | Unwrapped X, Y, width and height in four numeric channels. |
| `area` | Count of occupied texels, constant per region. |
| `orientation` | Major-axis angle in radians, clockwise from +X. Near-isotropic regions use zero. The chart retains cardinal angles directly and rounds other angles to map precision. |
| `position` | Each texel center in the unwrapped chart. |
| `localUV` | Position divided by its own region's chart width and height, after subtracting the chart origin. |
| `gradient` | A directional ramp from zero to one across the actual occupied texel centers. Set clockwise `angle` in degrees. Use `align: "orientation"` to add the region's major axis. A zero-span gradient is 0.5. |
| `randomValue` | Deterministic scalar in [0, 1) keyed by region ID and seed. |
| `randomColor` | Deterministic RGBA8 pigments per region. An optional palette accepts hex RGB or RGBA swatches. |

Center, bounds, and position use pixel-edge coordinates by default. `units: "normalized"` divides each axis by the corresponding tile dimension, so unwrapped values can exceed one. Background is zero or transparent. Random maps share the flood seed and can override it. The flood takes its explicit `seed`, image material seed, or graph node seed in that order. Changing the random seed leaves segmentation and UVs intact.

For `image.regionLookup`, choose `coordinates: "localUV"` to fit a pattern in every region, `"center"` or `"seed"` to get a constant texture sample per region, or `"position"` to sample unwrapped tile coordinates. The lookup preserves the source image's channel and precision contract and uses the region grid for alignment. Texture `filter` and `border` control input taps. Background is zero, including zero coverage for RGBA.

Ink's split between one segmentation and derived maps covers workflows such as the [Flood Fill gradient](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/filters/effects/flood-fill-to-gradient) and [per-cell texture mapper](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/filters/effects/flood-fill-mapper).

## Harbor Mosaic demo

```sh
node examples/typed-flood-regions/demo.cjs /tmp/ink-harbor-mosaic
ink-studio graph run /tmp/ink-harbor-mosaic/harbor-mosaic.material.json --out /tmp/ink-harbor-mosaic/replay
```

Open `index.html` to inspect the continuous region at the middle of the repeat. Toggle either wrapped axis or select Local UV, Gradient, or Texture Lookup to see the same chart drive several maps.
