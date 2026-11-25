# Editable material shape library

Store a signed 2D shape once and sample it at different art resolutions. `shape.library` opens a versioned library, `shape.pick` selects a shape by ID, and `image.shape` bakes it. `shape.define` validates an individual recipe. `shape.field` exposes signed distance, the clipped scalar profile and bevel height directly for procedural sampling.

## Shape definitions

Coordinates use planar shape units. Positive X points right and positive Y points down. Defaults fit the unit square. Rectangle angles rotate clockwise from the unrotated rectangle. Regular polygon and star angles rotate clockwise from a tip at the top.

| Type | Editable fields and defaults |
| --- | --- |
| `rectangle` | `center: [.5,.5]`, `size: [.68,.46]`, corner `radius: 0`, `angle: 0` degrees |
| `disc` | `center: [.5,.5]`, `radius: .32` |
| `polygon` | 3–128 custom `points`, or a regular ring with `sides: 6`, `center: [.5,.5]`, `radius: .36` and `angle: 0` degrees. Rings use even-odd fill. |
| `star` | `tips: 5`, `center: [.5,.5]`, outer `radius: .38`, `innerRadius` half the outer radius, `angle: 0` degrees |
| `stroke` | 2–128 editable polyline `points`, full `width: .075`, `closed: false`. Stroke caps and joins are round. A closed stroke needs at least three points. |
| `linear` | Ramp endpoints `from: [.15,.5]` and `to: [.85,.5]`, `address: "clamp"`, optional shape `clip` (unit square by default) |
| `radial` | Outward ramp with `center: [.5,.5]`, `innerRadius: 0`, outer `radius: .38`, `address: "clamp"`, optional shape `clip` (outer disc by default) |
| `spot` | A bright center fading to zero with `center: [.5,.5]`, `radius: .36`, `core` at 18% of the radius and `falloff: "smooth"` or `"linear"` |
| `gradient` | A scalar `source` profile and an editable `curve` with 2–256 stops in the 0–1 domain. Supports the existing step, linear, smooth and Bézier interpolation. Use `image.gradientMap` to add a color ramp. |
| `symbol` | Up to 32 `parts`, each holding a child `shape` and an `op` of `"union"`, `"subtract"` or `"intersect"`. The first part is a union. |
| `bevel` | A child `shape`, edge `width: .04`, signed relief `height: .11`, `profile: "round"` with linear and smooth variants, and `side: "inside"` with outside and both variants |

Linear and radial addressing also support `"repeat"` and `"mirror"`. Symbols combine the signed fields of their parts. The contour and inside/outside test remain consistent across resolutions. In overlapping Boolean parts, field magnitude can differ from the Euclidean distance to the final contour. Apply a bevel to the complete symbol to get one relief profile.

## Share shapes across bakes

A version 1 library is ordinary JSON.

```json
{
  "format": "ink-studio/shape-library",
  "version": 1,
  "entries": {
    "dock-stamp": {
      "label": "Dock stamp",
      "definition": {"type":"star","tips":4,"radius":0.38,"innerRadius":0.14}
    }
  }
}
```

Link `shape.pick` to any number of `image.shape` nodes. The default bake is 64×64 across `bounds: [0,0,1,1]`, ordered left, top, right, bottom. Matching bounds preserve the shape when the grid changes. For square pixels on a rectangular bake, choose bounds with the same aspect ratio as the grid. Coordinates and bevel widths remain in the same shape units. `info.spacing` gives the actual coordinate step per texel for relief normals.

- `mask` records coverage. Use 1 sample per axis for hard native pixels, 2 for four-sample coverage or 4 for sixteen-sample coverage.
- `value` returns the mask for solid shapes. For a profile or gradient, it returns the average of the scalar profile inside the shape, with uncovered samples contributing zero.
- `distance` stores the signed center sample. Negative is inside. `height` stores the center-sampled bevel, or zero for shapes without a bevel. Outside bevels can extend beyond the original coverage.
- Choose `float32` storage (default) or `float64`. Shape bakes have a four-million-texel ceiling and a sample budget that accounts for the number of edges and coverage samples.

In JavaScript, use `KIT.procedural.shapeLibrary.open`, `.pick`, and `.compile`. The compiled result provides analytic `field(x,y)`, `scalar(x,y)` and `height(x,y)` functions. `KIT.procedural.graphImages.shape(definition, width, height, options)` bakes a recipe directly.

## Mark & Die demo

```sh
node examples/editable-shape-library/demo.cjs /tmp/ink-mark-and-die
ink-studio graph run /tmp/ink-mark-and-die/mark-and-die.material.json --out /tmp/ink-mark-replay
```

Open `index.html` to browse the shapes. Edit a definition and apply it to the 40×40 and 120×120 views. Switch among material, coverage, distance, and bevel height to inspect the separate outputs.
