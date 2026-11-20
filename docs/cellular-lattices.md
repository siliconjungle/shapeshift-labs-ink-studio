# Cellular rules and lattices

`KIT.cellular` runs seeded, editable cellular automata on lines, square and
hex grids, and voxel volumes. It shares `create` and `rules` with
[`KIT.glyphGrid`](glyph-grids.md). Use the existing glyph painter for rows,
grids and slices, or map cell centers into a scene with `grid.position()`.

```js
const { cellular: C, glyphGrid } = K;
const brain = C.create({
  width: 24, height: 24, depth: 12,
  neighborhood: 'edges',
  seed: 41,
  initial: ({ x, y, z, random }) => Number(z === 6 && random() < .17),
  rule: C.rules.briansBrain()
});
brain.step(6);
const ink = glyphGrid.paint({ mode: 'pixel', tiles: [
  null, { color: '#ffdf9b' }, { color: '#338e9d' }
] });
const slice = ink.raster(brain.slice(6), { scale: 2 });
```

For floating-point state, sampled kernels, and coupled channels, use
[continuous cellular automata](continuous-cellular.md).

## Rule library

| Factory | Update |
| --- | --- |
| `rule30()`, `rule90()`, `rule110()`, `elementary(number)` | Binary line rules. The next state is bit `4 * left + 2 * state + right` of the rule number (0–255). Record successive rows to build a space-time image. |
| `cyclic({ states = 8, threshold = 1 })` | Advance to `(state + 1) % states` once at least `threshold` neighbors already have that successor. |
| `briansBrain({ birth = 2 })` | Off cells (`0`) fire when exactly `birth` neighbors are firing. Firing (`1`) becomes refractory (`2`), then off. |
| `life({ birth, survive })` | Existing Life-like rule with configurable neighbor counts. |
| `margolus(table)` | Author a reversible binary 2×2 rule as a permutation of the integers 0–15. |
| `blockRotate(turns = 1)` | Rotate each block clockwise by one to three quarter turns. |
| `blockGas()` | Turn opposite diagonals into each other and rotate odd-population blocks by 180°. Other blocks stay as they are. The occupied count is conserved. |

Built-in rules specify their alphabets where needed. A custom neighborhood
rule receives `{ x, y, state, tick, neighbors, random }` and returns the
cell's next state. On voxel grids the initializer and rule also receive `z`.
All local rules see the grid at the start of the tick. The next grid is
applied together, with locked cells keeping their states.

## Lattice coordinates

| `lattice` | Default neighborhood | Other built-in stencils |
| --- | --- | --- |
| `line` | `line` (left, right) | Elementary rules require those two offsets in order. |
| `square` | `moore` (8) | `cardinal` (4) |
| `hex` | `hex` (6) | Uses axial coordinates with a parallelogram storage footprint. |
| `voxel` | `corners` (26) | `faces` (6), `edges` (18, including faces) |

An elementary rule selects `line` and defaults `height` to `1`. A
`depth` greater than `1` selects `voxel`. Square is the default for other
grids. Hex offsets are `[1,0]`, `[1,-1]`, `[0,-1]`, `[-1,0]`, `[-1,1]`,
`[0,1]`. Their centers are spaced one unit apart using
`[x + y / 2, y * sqrt(3) / 2, 0]`. Voxel offsets run in `z`, `y`, `x`
order with `x` changing fastest. Supply a list of distinct, nonzero
`[dx, dy]` or `[dx, dy, dz]` offsets to choose the stencil and its order.

`boundary: 'wrap'` wraps each storage axis independently. The default
`'empty'` supplies state zero outside the grid for local rules. Packed
cells and locks use `z * width * height + y * width + x`. Edits and
`get(x, y, z)` address the same cells. `snapshot()` stores the whole
grid. `slice(z)` copies one plane into a glyph-paintable frame. A hex frame
paints in storage order with the glyph painter. Use `position()` to lay
out the staggered hex centers for geometry or splats.

## Run a reversible rule

```js
const gas = C.create({ width: 40, height: 24, boundary: 'wrap',
  rule: C.rules.blockGas(), seed: 31,
  initial: ({ random }) => Number(random() < .18) });
gas.step(35);
gas.back(35);
```

The square-lattice grid needs even width and height. Partitions alternate
between anchors on even and odd coordinates, starting on even coordinates.
Block bits from least to most significant are top-left, top-right,
bottom-right, bottom-left. Shifted blocks wrap with `'wrap'`. With
`'empty'`, incomplete blocks stay fixed. Any block containing a locked
cell stays fixed in either direction.

`back()` applies the inverse table at the matching partition and
decrements the grid tick. To recover earlier states, use the same rule
and keep cells and locks unedited during the forward and backward run.
Use snapshots to restore states across edits, recall, or a change of rule.
Each grid supports up to 65,536 cells. Step and rewind batches share a
work budget, so split large updates across calls.

The elementary encoding follows [Wolfram's elementary automaton specification](https://reference.wolfram.com/language/ref/CellularAutomaton).
The alternating blocks follow [Margolus's partitioning method](https://publications.csail.mit.edu/lcs/pubs/pdf/MIT-LCS-TM-317.pdf).

## Render the studies

[Cellular Lattice Studies](../examples/cellular-lattice-studies.js) renders
Rule 30, 90, and 110 as a space-time plate, compares the same cyclic seed on
square and hex grids alongside a voxel Brian's Brain, and runs a reversible
block gas forward and backward.

```sh
node cli/ink-studio.js render examples/cellular-lattice-studies.js --w 1130 --h 554 --out cellular-rules.png
node cli/ink-studio.js clip examples/cellular-lattice-studies.js --params '{"study":"lattices"}' --w 745 --h 520 --to 5 --fps 10 --out cellular-lattices.png
node cli/ink-studio.js clip examples/cellular-lattice-studies.js --params '{"study":"reversible"}' --w 608 --h 540 --to 6 --fps 10 --out reversible-blocks.png
```
