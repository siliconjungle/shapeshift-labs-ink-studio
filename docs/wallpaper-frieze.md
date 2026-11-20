# Wallpaper and frieze patterns

`KIT.procedural.ornament` repeats a hand-drawn vector motif under
translations, reflections, rotations, and glide reflections. The same
compiled pattern gives you pigment, a signed relief field, and keyed
tiles with physical corners.

```js
const pattern = KIT.procedural.ornament.compile({
  group: 'p4g', cell: [1.2, 1.2],
  motif: [
    { type: 'polygon', points: [[.13, .1], [.31, .06], [.28, .20]], color: '#42ad9d' },
    { type: 'path', points: [[.13, .10], [.26, .14], [.35, .27]], width: .023, color: '#f4cb87' }
  ]
});

const pigment = pattern.raster({ w: 256, h: 256, samples: 2 });
const relief = pattern.raster({ w: 256, h: 256, mode: 'relief', bevel: .018 });
const tiles = pattern.tiles({ min: [-2, 0], max: [2, 3] });
```

## Groups and geometry

Set `kind: 'wallpaper'` (the default) or `kind: 'frieze'`. Both default
to `group: 'p1'`. Available group symbols are listed in
`KIT.procedural.ornament.groups`.

| Lattice | Group symbols | Basis |
| --- | --- | --- |
| Oblique | `p1`, `p2` | Supply two lengths and an optional `angle` between 30° and 150° in radians. |
| Rectangular | `pm`, `pg`, `cm`, `pmm`, `pmg`, `pgg`, `cmm` | Supply independent lengths. `cm` and `cmm` use centered rectangular cells. |
| Square | `p4`, `p4m`, `p4g` | Supply equal lengths. |
| Hexagonal | `p3`, `p3m1`, `p31m`, `p6`, `p6m` | Supply equal lengths. The second basis vector is at 120°. |
| Frieze | `p1`, `p211`, `p1m1`, `p11m`, `p11g`, `p2mm`, `p2mg` | Supply the horizontal period and vertical band height. The pattern repeats along U. |

Cell lengths default to `[1, 1]`. The oblique angle defaults to 90°.
The frieze groups use V = .5 as the center of the band for longitudinal
mirrors and glides. The short wallpaper symbols `p4m`, `p4g`, and
`p6m` correspond to `p4mm`, `p4gm`, and `p6mm` in the tables.
[IUCr plane-group tables](https://it.iucr.org/Ac/contents/) · [IUCr frieze-group comparison](https://journals.iucr.org/j/issues/2023/01/00/in5067/index.html)

`operations` exposes one representative per symmetry in the cell.
Each record has a row-major 2×2 `matrix` and UV `offset`. The regular
basis translations extend these transformations across the plane.
`basis` contains the U and V vectors in physical XY coordinates.

## Draw and sample

- A motif has 1–64 shapes with up to 128 points per shape. `polygon`
  fills an even-odd ring. A `path` is a round-ended stroke with
  optional `closed: true`, and one point draws a disc.
- Points use fractional cell coordinates. They may straddle cell edges.
  Stroke `width` is a diameter in physical units. Shapes accept opaque
  `#rrggbb` colors, with later motif shapes laid over earlier ones.
  Every copy of a shape contributes to the same layer.
- `position([u, v])` converts fractional coordinates to physical XY.
  `ink(x, y)` returns the topmost RGBA color or `null`.
  `distance(x, y)` is the signed union of the transformed motif shapes.
  It is negative inside the motif and clamped to `±reach`, which
  defaults to 16% of the shorter cell length.
- `tiles({min, max})` returns up to 4,096 cells from a half-open integer
  window, with `id`, `cell`, and four XY `corners` in winding order.
  For friezes, use the row from V = 0 to V = 1. Use the corners to
  create separate SDF extrusions or relief meshes. Adjacent tiles share
  complete edges before any authored grout or bevel.

## Export

`raster()` returns top-down straight-alpha `{ w, h, rgba }`. Its default
bounds are one UV cell. Tune the `bounds`, sample 1–4 points per axis per
pixel, and set an optional `background`. In `space: 'uv'` the bitmap
maps to the parallelogram spanned by the basis. Use `space: 'plane'`
for an XY crop that preserves angles on screen. For a rectangular
hexagonal repeat, use width equal to the U length and height twice the
Y component of the V vector.

Relief mode outputs an opaque height map with dark recesses and a white
ground. `bevel` controls the transition distance on either side of the
pattern edge. Use the signed field directly to cut a custom shelf,
panel, or tile in scene units. The ceramic example uses that field to
position actual surface mesh vertices.

The CLI reads a JSON object with the same pattern properties, plus
optional `raster` and `tiles` settings. It writes RGBA pigment and
relief PNGs or a JSON tile layout with the basis and symmetry operations.

```sh
node cli/ink-studio.js ornament examples/ornament-pattern.json --out pigment.png
node cli/ink-studio.js ornament examples/ornament-pattern.json --format relief --out relief.png
node cli/ink-studio.js ornament examples/ornament-pattern.json --format tiles --out tiles.json
```

## Demos

The [gallery](../examples/wallpaper-frieze.js) prints the same leaf motif
in pgg, p4g, p6m, and a p11g frieze. The ceramic view cuts the p4g motif
into twelve beveled tiles and follows a curved camera rail.

```sh
node cli/ink-studio.js render examples/wallpaper-frieze.js --w 1000 --h 586 --out gallery.png
node cli/ink-studio.js clip examples/wallpaper-frieze.js --params '{"study":"ceramics"}' --w 760 --h 500 --fps 12 --to 5 --out ceramics.png
```
