# Smart masks from baked geometry

`material.smartMask` turns registered surface bakes into a grayscale map. Place one node per effect, or reuse it inside a material subgraph. Connect the result to a layer mask or publish it as a standalone map.

## Select a recipe

| Recipe | Needed beyond coverage | How the mask is placed |
| --- | --- | --- |
| `edgeWear` | `convex` | Select outward bends. Optional `exposure` moderates wear on sheltered surfaces. |
| `dirt` | `cavity` or `concave` | Accumulate in recessed bends and cavities. Optional `ao` adds shelter. |
| `dust` | `normal` | Settle on upward-facing surfaces. Optional `exposure` moderates deposition. |
| `rust` | `susceptibility` or `metalness`, plus `moisture` or `cavity` | Weather eligible damp surfaces. Connect a leak mask to `moisture` to form rust trails. An authored susceptibility map can distinguish ferrous metal from other metallic surfaces. |
| `leaks` | `position` and `source` or `cavity` | Trace runoff from the source down the steepest covered neighbor in baked position space. The strength decays with travel distance. Optional `partId` keeps flow within a part. |
| `slope` | `normal` | Select an angle range from the world-space up vector. |
| `waterline` | `position` | Select a band, a submerged region, or an exposed region relative to a plane. |
| `exposure` | `exposure` or `ao` | Select visible surfaces using the supplied exposure bake, or diffuse visibility from AO. |

The `bakes` record always needs a normalized `coverage` image. Supply a normalized `validity` map when a measurement is absent at some covered texels. The output is clipped by both. Raster extent, UV set, tile and registration must match. The node checks dimensions and explicit pivot and pixel-pitch metadata. The author controls UV set and tile selection.

Use `bitmapAsset` to read [bake job outputs](bake-jobs.md) as typed images. Use `world-normal` for `normal`, `position-world` for `position`, and `curvature-convex` and `curvature-concave` for the curvature input slots. Position needs float XYZ in the same coordinate frame as the up vector. Use world-space geometry when using world normals with the same controls. Curvature magnitude accepts normalized values or physical `inverse-shape-units`. For a normalized curvature bake reloaded through its physical-range interpretation, choose `curvatureScale` in surface units to bring those magnitudes into a useful 0–1 range. AO follows Ink’s convention of 1 for open. Part IDs are exact integer codes in a float scalar image with `id` units.

## Adjust placement and inspect stages

- `amount` scales the generated mask. `breakup`, `frequency`, and `seed` add deterministic variation. Frequency is in cells per position unit when position is supplied and cells per UV tile otherwise.
- Signal-based recipes use `threshold` and `softness`. For leaks they select the starting sources. Curvature-based recipes also accept `curvatureScale`.
- Dust, slope, leaks and waterline use `up`, with +Y as the default. Slope uses `minAngle`, `maxAngle`, and `feather` in degrees.
- Waterline uses `level`, `width`, and `side` (`band`, `below`, or `above`). Level and width are in the position map's units. Band width is the distance on each side of the plane.
- Leaks use `length` and `maxGap` in the position map's units. By default the gap is three times the median sampled neighbor distance. Runoff only connects adjacent covered texels within the supplied tile. Disconnected UV charts or tiles need their own source inputs.

Inspect `evidence` to see the driving signal, `raw` to see the generated mask, and `value` to see authored corrections. `report` gives the recipe settings, contributing input names, coverage and affected-texel counts. The leak report also gives its adjacency limit and number of routed texels.

Connect aligned grayscale images to `add` and `remove`. Addition raises the generated mask to at least the painted value. Protection attenuates the result, including any addition under it. Corrections stay on the covered and valid part of the surface. Keep the source images linked or attach editable paint outputs to either socket.

## Lock Nine demo

```sh
node examples/smart-material-masks/demo.cjs /tmp/ink-lock-nine
ink-studio graph run /tmp/ink-lock-nine/lock-nine.material.json --out /tmp/ink-lock-nine/delivery
```

Open `index.html` to move the waterline, compare all eight masks, or paint a correction. The cast-iron gate's bakes and authored corrections are linked in the editable material graph. Set the corresponding Paint or Protect graph inputs to apply your own correction images. Open the linked bake review to inspect the geometry inputs.
