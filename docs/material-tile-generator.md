# Material Tile Generator

`image.tileGenerator` places a signed stamp on an editable grid and bakes color, coverage and stable identifiers. The default stamp is a rectangle. Connect a `shape.define` or `shape.pick` result to use a disc, polygon, star, symbol or soft profile. Placement stays in texture coordinates, so the same graph can bake different resolutions and crops.

## Controls

| Control | Behavior |
| --- | --- |
| `columns`, `rows` | One to 128 on each axis, with at most 4,096 cells in total. Default 4 × 6. |
| `pattern` | `grid` (default), `brick`, `column-stagger` or `checker`. Checker omits alternating cells and needs an even count on each wrapped axis. |
| `size`, `gutter` | Independent U/V values in cell fractions. Full stamp size is `size × (1 - gutter)` before jitter. The defaults are `[1,1]` and `[.08,.08]`. The stamp is clipped to its local unit square. |
| `rotation`, `aspect` | Clockwise degrees in the pattern plane and the width-to-height ratio of that plane. Default 0° and 1. Use the intended texture aspect to make the design plane match square display pixels. |
| `rowOffset`, `columnOffset` | Cumulative horizontal step per row and vertical step per column, in cells. Brick defaults to a half-cell row step. Column stagger defaults to a half-cell column step. |
| `color`, `palette`, `colorMode` | Use one color or a palette of 1–64 colors. Palette modes are seeded `tile` (default), `course`, `column`, and row-major `cycle`. Accepts CSS-style six-digit hex, packed RGB, or normalized RGB/RGBA arrays. |
| `background` | Color between stamps. Defaults to transparent. |
| `jitter` | Independent seeded variations for `position` in cell fractions, `size` as fractions of the stamp, `rotation` in degrees and `color` as the maximum tint toward black or white. All default to zero. |
| `wrap`, `crop` | Repeats on both axes by default. Set each wrap axis independently with a Boolean pair. Crop is `[left,top,right,bottom]` in texture coordinates, where `[0,0,1,1]` covers one tile. Coordinates outside that range sample neighboring periods on wrapped axes and background on open axes. |
| `samples`, `precision`, `seed` | Use 1, 2 or 4 samples per axis. Color defaults to `unorm8` and also supports `unorm16`, `float32`, and `float64`. A signed safe integer locks all random variation. Omit it to use the graph's contextual seed. |

On a repeated axis, the stagger must close over the perpendicular grid count. Ink chooses the closest step that closes and returns the requested step, effective step, and course phases in `layout`. A five-course brick tile with a requested half-cell stagger uses an effective step of 3/5 of a cell. Every course advances by that amount, including the last-to-first transition. Phases wrap within one cell, with the same IDs assigned to each course. Open axes keep the authored step.

The control categories follow familiar tile authoring workflows such as the size, interstice, position and color groups in Adobe's generator. [Adobe Tile Generator reference](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/texture-generators/patterns/tile-generator)

## Outputs

- `value` is straight-alpha sRGB. Overlaps and subpixel color samples are composited in linear light. Higher row-major IDs have paint priority. When a wide stamp overlaps a periodic copy of itself, the copies share opacity.
- `coverage` is a shape mask independent of palette opacity, suitable for grout and bevels. Scalar stamp profiles contribute their analytic falloff.
- `tileId` and `course` are aligned, nearest-sampled labels at the texel center. A tile uses its one-based row-major grid index and a course uses its one-based row. Zero means no stamp. A checker gap leaves the omitted tile's ID unused.
- `layout` reports canonical positions, sizes, rotations and colors independently of crop and output resolution. Cropping a partial period clamps that output axis, even when the source placement repeats. Crops covering complete periods retain wrap addressing on those axes.

An image bake is limited to four million texels and a bounded amount of work proportional to stamp complexity, overlaps and coverage sampling. In JavaScript, use `KIT.procedural.graphImages.tileGenerator(width, height, columns, rows, stamp, options, seed)`.

## Kiln & Course demo

```sh
node examples/material-tile-generator/demo.cjs /tmp/ink-kiln-and-course
ink-studio graph run /tmp/ink-kiln-and-course/kiln-and-course.material.json --out /tmp/ink-kiln-replay
```

Open `index.html` to edit a seven-course terracotta bond. Switch to the course view to see where the same IDs cross the seams. Choose the seam crop to sample a small window centered on the corner where four periods meet.
