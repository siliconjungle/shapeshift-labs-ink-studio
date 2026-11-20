# Precise drawing primitives

Use drawing commands in a `look.composite.layers[].draw` list or in a render graph composite pass. The Node renderer, WebGL renderer, and CLI use the same rasterizer. Commands are composited over the scene in layer order, and can run at full output resolution while the world uses a coarser art grid.

## Coordinates and sizing

Set `space` to `screen` for output-pixel XY with the origin at the top left, or `world` for XYZ projected through the rendered camera. World paths and polygons clip to the camera's near and far planes. World primitives follow framing, lens, and projection changes.

Stroke widths default to output pixels. Set `widthUnits: "world"` on a world primitive to project its stroke width at the local depth. `headUnits` and `tickUnits` independently control arrowhead and tick sizes. For horizontal and vertical one-pixel lines, place the center on a half-pixel coordinate at native output resolution. Colors accept six- or eight-digit hex strings with optional alpha.

| Command | Geometry |
| --- | --- |
| `path` | `points`, stroke `width`, and optional `closed`. Segments join with round caps and share coverage at their intersections. |
| `arrow` | `from` and `to`. Set `headLength` and `headWidth` for the filled arrowhead. When a world arrow's tip is clipped, its shaft remains visible up to the depth plane. |
| `polygon` | `points` for one ring, or `rings` for multiple contours. Uses even-odd fill so nested rings make holes regardless of winding. Set `fill` and optional `stroke` independently. A false fill leaves the outline. |
| `grid` | `origin`, perpendicular `u` and `v` directions, `step` per axis, and two cell `counts`. The default directions are X and Y. Set `majorEvery`, `majorColor`, and `majorWidth` for major lines. |
| `axes` | `origin` and an `axes` array of `direction`, `length`, optional `tickEvery`, `color`, and `label`. Shared arrowhead, `tickLength`, and `labelSize` settings style each axis. Labels use output-pixel type. |
| `scaleBar` | `origin`, optional `direction`, `length`, `divisions`, `tickLength`, and `label`. A screen bar measures pixels by default. A world bar measures along its world direction. |

A calibrated screen scale bar uses `lengthUnits: "world"` and a world XYZ `reference`. Its anchor stays in screen pixels and its length reports world units at the reference depth. In perspective views, this measurement applies at that depth. With an orthographic camera, it applies across the view.

Use `--composite <file.json>` with the CLI render commands or `sim render` to supply a drawing definition. Scene-authored settings use `finish.look.composite` in dioramas and `visual.look.composite` in simulation worlds. [Mixed-resolution compositing](mixed-resolution.md) · [Editable render graph](render-graph.md)
