# Recursive curves and unfolding

Koch, Heighway dragon, Hilbert, and Peano curves use the same native
path interface as the other [curve families](curve-families.md).
Each generation is an open polyline. A two-terminal starting line
unfolds while keeping both endpoints fixed.

```js
const recipe = { type: 'hilbert', generation: 4, axis: [0, 0, 1], scale: 3.8 };
const trace = KIT.curve.create(recipe);
S.tube(trace.points, .018, .018, material, { res: .04 });

const model = KIT.curve.recursive(recipe);
const frame = model.morph(3, .6);
const livePath = KIT.curve.path(frame.points, { closed: false });
const brush = livePath.at(livePath.length * .45);
```

Use `KIT.curve.create(definition)` for a fixed generation or
`KIT.curve.recursive(definition)` to reuse a model across generations.
The latter exposes `level(generation)`, `morph(from, progress)`, and
`maxGeneration`. Calling `level()` uses the recipe's `generation` or
the family default. Use `KIT.curve.koch(options)`, `dragon(options)`,
`hilbert(options)`, or `peano(options)` when a consumer takes only points.

Set `origin`, `axis`, `right`, and `scale` using the existing curve
frame. In local coordinates Koch and dragon start on a unit-length
X segment. Hilbert and Peano visit lattice positions across a unit
square centered at the origin.

| Type | Default generation | Max generation | Positive-generation rule |
| --- | ---: | ---: | --- |
| `koch` | 3 | 6 | Replace each directed edge with four edges around an equilateral peak. |
| `dragon` | 8 | 12 | Fold each directed edge into two and alternate the bend side along the traversal. |
| `hilbert` | 4 | 6 | Visit every point on a `2^g × 2^g` lattice through rotated and reflected quarters. |
| `peano` | 3 | 3 | Visit every point on a `3^g × 3^g` lattice through nine reflected blocks in serpentine order. |

Each lattice path visits orthogonally adjacent points. The upper
generation limits keep paths within the shared 4,096-edge budget.
[Peano's paper on space-filling curves](https://geodesic.mathdoc.fr/item/MAN_1890__36_157489/) · [Prusinkiewicz and Lindenmayer's Algorithmic Beauty of Plants](https://www.algorithmicbotany.org/papers/)

## Addresses and path sampling

A level supplies native `points`, arc `length`, `at(distance)`, and
transported frames. It also exposes `generation` and ordered
`segments`. Each segment has `id`, `parentId`, `generation`, and
`from` and `to` indices into `points`.

- Koch and dragon identify a directed edge by its nested address.
  An edge such as `koch/1/3` descends from `koch/1`. Its ID and parent
  are independent of placement or the order in which levels are sampled.
- Hilbert and Peano identify a bridge by its common ancestor block
  and the preceding child position. For example, `hilbert/2/bridge-0`
  connects the first and second subdivisions of `hilbert/2`. The
  bridge ID and its introduction generation persist as its endpoints
  move at finer levels. `parentId` names the owning block.
- A positive lattice level also returns ordered `cells`. Each cell
  has `id`, `parentId`, `generation`, `index` into `points`, and
  integer `grid` coordinates. The cells represent visits. Index and
  grid coordinates describe the current level and may change with depth.

`evaluate(u)` spends equal time on each ordered segment, with `u`
from 0 to 1. Use arc-length `at(distance)` for constant-speed placement
or motion. `snapshot()` records the selected definition and generation.
The native camera rig accepts these in `rail.family`. The existing
`ink-studio curve <definition.json>` command exports generation,
segment lineage, and cells alongside the path.

## Unfold adjacent generations

`morph(g, progress)` moves from level `g` toward level `g + 1`.
`progress` runs from 0 to 1 and can use any easing supplied by the
caller. The result contains `from`, `to`, `progress`, world `points`,
and the finer level's `segments` and `cells`. The run finishes on the
exact canonical geometry for the new level.

For Koch and dragon, child edges have anchors distributed along the
parent edge. For Hilbert and Peano, each child block starts collapsed
to its coarse visit and bridges initially lie on the coarse route.
The first lattice transition distributes anchors along the starting
line. Each intermediate stroke uses a single ordered point list, with
its neighboring segments meeting at the same vertices. At zero
progress the lattice result can contain coincident points. Keep these
when using the lineage indices, or pass the points to `KIT.curve.path`
to collapse repeats for path distance and frames.

## Demos

[Recursive Curve Studies](../examples/recursive-curve-studies.js)
compares all four families and animates a Hilbert circuit from one line
to a 32 by 32 traversal. Its endpoints stay on their terminals, its
pads mark early bridges, and the signal follows the evolving arc length.

```sh
node cli/ink-studio.js render examples/recursive-curve-studies.js --w 1140 --h 850 --out recursive-curves-atlas.png
node cli/ink-studio.js render examples/recursive-curve-studies.js --params '{"study":"circuit"}' --t 4.16 --w 748 --h 705 --out unfolding-circuit.png
node cli/ink-studio.js clip examples/recursive-curve-studies.js --params '{"study":"circuit"}' --w 620 --h 584 --to 6 --fps 10 --out unfolding-circuit-clip.png
```
