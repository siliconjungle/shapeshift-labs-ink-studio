# Quasiperiodic tilings

`KIT.procedural.tiles.quasiperiodic` generates finite patches of Penrose
P3 and Ammann–Beenker tiling. It returns physical polygons and stable
substitution addresses for floors, prints, material inlays, and placement.

```js
const { quasiperiodic } = KIT.procedural.tiles;
const plaza = quasiperiodic({
  family: 'penrose', depth: 5, radius: 5,
  boundary: [[-3.2, -2.5], [3.2, -2.5], [3.2, 2.5], [-3.2, 2.5]]
});

const tile = plaza.tiles[0];
const lineage = tile.addresses[0];
const parent = plaza.at(lineage.slice(0, -1));
```

## Families

| Family | Finished tiles | Seed | Deflation |
| --- | --- | --- | --- |
| `penrose` | `thinRhomb` and `thickRhomb`, with acute angles of 36° and 72° | Fivefold decagonal fan of oriented Robinson triangles | Child edge lengths divide by the golden ratio `(1 + √5)/2`. |
| `ammannBeenker` | `square` and `rhomb`, with rhomb angles of 45° and 135° | Eight rhombs around a shared point | Child edge lengths divide by the silver ratio `1 + √2`. |

Penrose joins Robinson triangles across their common diagonal.
Ammann–Beenker joins right triangles across their hypotenuse. A piece
without a partner at the outside of the seed patch retains its polygon
and has `partial: true`, with type `halfThinRhomb`, `halfThickRhomb`,
or `halfSquare`. The oriented subdivisions follow the published
half-tile constructions. [Penrose rhomb tiling](https://tilings.math.uni-bielefeld.de/substitution/penrose-rhomb/) · [Ammann–Beenker tiling](https://tilings.math.uni-bielefeld.de/substitution/ammann-beenker/) · [Ammann–Beenker subdivision diagrams](https://www.chiark.greenend.org.uk/~sgtatham/quasiblog/aperiodic-refine/)

## Frames, clipping, and addresses

- Set `center: [x, y]`, `rotation` in radians, and `radius` to the
  distance from the center to the seed's outer tips. The default frame
  is a unit-radius seed centered at the origin.
- `depth` is the number of substitutions, from 0 to 12 with a default
  of 4. `maxPieces` caps the number of finest-level pieces before pairing
  and clipping. It defaults to 65,536. The output reports `work.pieces`
  and `work.visited`.
- Each finished tile has `id`, `type`, `polygon` in counterclockwise order,
  `addresses`, and `partial`. An address starts with a seed-piece index
  and appends one child index per substitution. A paired tile includes
  both addresses and uses them to form its ID.
- `at(address)` looks up the underlying substitution piece at any
  available depth and returns its original polygon. An address prefix
  names an ancestor in deeper layouts. Finished tile IDs stay fixed at a
  given depth across frame changes and crops.
- Supply a convex `boundary` to clip finished polygons to a site. The
  output is the intersection with the finite seed patch. Crops preserve
  IDs, types and addresses. Use [surface cell clipping](procedural.md)
  on `tiles` for additional convex cutouts.

The polygons can feed an SDF extrusion or textured mesh. Use the stable
ID as a material-variation seed, or color by an address prefix to show
the substitution structure.

## Demos

[Penrose Court and Eightfold Exchange](../examples/quasiperiodic-plazas.js)
use the returned polygons as bevel-edged pavement. The Penrose court
pairs teal thick rhombs with copper thin rhombs. The Ammann–Beenker
court alternates lavender squares and copper rhombs with teal accents.

```sh
node cli/ink-studio.js render examples/quasiperiodic-plazas.js --w 980 --h 674 --out penrose-court.png
node cli/ink-studio.js clip examples/quasiperiodic-plazas.js --params '{"family":"ammannBeenker"}' --w 760 --h 542 --to 5 --fps 12 --out eightfold-exchange.png
```
