# UV debug outputs

Enable **UV outlines** or **Coverage** in a [bake job](bake-jobs.md) to publish UV diagnostics. The files are available in both the live workstation and the saved bake viewer. Diagnostics use the selected receiver, UV set, and tiles, including signed tile coordinates. A map with a different size or gutter gets raster diagnostics at its own settings.

## Inspect charts and tiles

- **Chart outlines** draws the original edges of each UV island, including borders around holes. Triangulation edges shared by two continuous faces are hidden. Tile clipping does not add seams to the outline.
- **Chart ownership** colors the first chart claiming each surface texel. The same chart keeps its ID and color across tiles in that target. Lighter-opacity pixels show gutters grown from the surface. Pink marks texels where two triangle interiors cover the same sample. The legend gives surface and gutter counts for up to 64 charts.
- **Tile bounds** shows the current tile border, label, and U/V range. Use the tile buttons to switch among tiles of the selected map and target.

Chart connectivity uses consistently oriented shared edges with matching position and UV endpoints. Chart numbering follows the first selected triangle in each connected chart. Changing the selected submeshes can renumber charts.

To diagnose overlapping islands, run with Coverage or UV outlines as the enabled maps. A material bake still rejects overlapping interiors. Diagnostics count overlaps at texel centers, so an intersection smaller than a texel may be present in the geometry even if the overlap count is zero.

## Download raster and vector files

| Export | Content |
| --- | --- |
| **Outlines PNG** | Transparent raster with one-texel chart outlines, aligned to the selected map. |
| **Outlines SVG** | Editable chart boundary paths, clipped to the selected tile. Each path identifies its chart. |
| **Coverage PNG** | Binary sampled footprint before padding. White shows covered texel centers. |
| **Coverage SVG** | Filled geometric footprint for the same tile. This vector representation includes subpixel geometry. |
| **Ownership PNG** | Chart swatches, gutters and overlap evidence at the selected map size. |

The bake report's `uvDebug` entries record per-tile file paths, chart, surface, gutter, and overlap counts. Each map's `uvDebug` index identifies its diagnostics. SVG files are shared across resolutions of a tile.

## Azimuth Gate demo

```sh
node examples/bake-uv-debug/demo.cjs azimuth-demo
ink-studio bake-job serve azimuth-demo/atlas.bake.json --out azimuth-demo/live
```

Open `azimuth-demo/index.html`. Toggle the outlines, ownership, and tile bounds independently. The panoramic atlas shows a continuous ring spanning tiles 1001 and 1002. Switch to **Overlap check** to see the texels claimed by an extra plate.
