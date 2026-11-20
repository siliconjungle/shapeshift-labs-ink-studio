# Procedural glyph grids

`KIT.glyphGrid` evolves a seeded, editable grid of discrete cell states.
Render each state as an existing atlas glyph or a custom glyph. A grid can
also treat its cells as individual pixels, allowing new letterforms to
emerge from local rules or pattern recall.

The same engine provides [built-in cellular rules, line and hex grids, and
voxel lattices](cellular-lattices.md) through `KIT.cellular`.

The [Palimpsest Terminal](../examples/glyph-grid.js) recalls a damaged
inscription around locked fragments from a second memory. The bottom strip
runs a seeded neighborhood rule through the glyph atlas. The main display
uses the same painted pixels for a sprite surface and emissive splats.

```sh
node cli/ink-studio.js clip examples/glyph-grid.js --w 720 --h 414 --to 7 --fps 16 --out palimpsest.png
```

## Create and edit a grid

```js
const grid = K.glyphGrid.create({
  width: 12, height: 4, states: 2, seed: 53,
  initial: ({ random }) => Number(random() < .30),
  neighborhood: 'moore',
  boundary: 'wrap',
  rule: K.glyphGrid.rules.life()
});

grid.edit([{ x: 4, y: 1, state: 1, locked: true }]);
grid.step(8);
const frame = grid.snapshot();
```

- States are integers from zero to `states - 1`. The alphabet supports
  2–256 states. `initial` accepts a single state, row-major state values,
  or a function of `{ x, y, random }`.
- `step(count, rule)` evaluates the rule against the preceding snapshot,
  then applies all cell updates together. A rule returns one state from
  `{ x, y, state, tick, neighbors, random }`. The random function is seeded
  independently for each cell and tick. An optional rule argument overrides
  the rule used at construction for that call.
- `neighborhood` accepts `'moore'`, `'cardinal'`, or distinct XY offsets.
  Custom offsets keep their declared order. Cardinal order starts at the
  top and runs clockwise. Moore order reads the surrounding three-by-three
  area top to bottom, left to right, skipping the center. `boundary` is
  `'empty'` (state zero outside the grid) or `'wrap'`.
- Edits can set a state, a lock, or both. A locked cell still contributes to
  the neighborhood and to memory recall. Its state can be changed by an
  explicit edit.
- `snapshot()` owns copies of cell states, locks and the tick. Use
  `restore(frame)` to branch or seek with the same rules and memories.
  `reset()` restores the initial cells, clears locks and returns to tick zero.
  Both retain the learned patterns. `revision` changes on edits and advances.

## Recall a pattern

Pass `patterns` at construction or replace them with `grid.learn(patterns)`.
Each pattern is a row-major array of states matching the grid or a
`{ cells, weight }` record. Weights range from zero to one.

```js
grid.learn([original, { cells: alternate, weight: .35 }]);
grid.recall(1, { fraction: .2, temperature: .025 });
```

Recall scores each candidate state using its agreement with remembered
states elsewhere on the grid. It visits cells in seeded shuffled order so
each repair can influence the next one. `fraction` selects how much of the
unlocked grid updates per sweep. `temperature` adds seeded noise to the
scores and defaults to zero. Surviving fragments act as evidence and stay
fixed. Conflicting fragments can produce a hybrid inscription. Recall
shares the grid's tick and snapshot API with neighborhood steps.

## Paint or emit the grid

```js
const ink = K.glyphGrid.paint({
  tiles: [
    null,
    { glyph: 'A', color: '#ffbf79', background: '#102633' }
  ]
});
const raster = ink.raster(frame, { scale: 2 });

// Inside a K.frameSplats draw callback:
ink.emit(frame, draw, {
  origin: [-1, 2, .1], across: [.06, 0, 0], down: [0, -.06, 0],
  density: .7, depth: true
});
```

Each tile maps one state to ink. Use `null` for transparent cells. Glyph
mode uses the existing 6×8 atlas. Supply custom glyphs as a map from single
characters to up to eight strings of six pixels each, with `#` for ink.
In `mode: 'pixel'`, set tile colors and omit glyph names. Colors support
`#rrggbb` and `#rrggbbaa`.

`raster` returns top-down `{ w, h, rgba }` for a mixed-resolution layer,
a render-graph input or [a sprite surface region](textured-surfaces.md).
`emit` maps the center of each art pixel into XYZ. The two basis vectors
are world-space steps per art pixel. It emits foreground ink by default.
Enable `background` to emit tile backgrounds as well. The return value
reports `emitted` and whether the splat budget or draw capacity
`truncated` the result.

The grid supports up to 65,536 cells. Recall supports up to 32 patterns
subject to a combined memory budget of 1,048,576 cells. Step batches,
rasters and splat emission also have bounded work or output sizes.
