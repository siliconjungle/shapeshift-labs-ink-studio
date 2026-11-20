# Editable simulation inputs

`KIT.simulationInputs` records pins, brushes, obstacles, and injections on
a fixed-tick timeline. Keep the solver recipe and the input record to rerun
a scene from the same seed. New edits can change an earlier tick and
recompute the current frame.

```js
const I = K.simulationInputs;
const D = K.cellular.domain;
const domain = D.image({ width: 9, height: 5 });
const build = seed => I.domain(D.create({
  domain, seed, dt: .1, timeUnit: 's',
  rule: K.cellular.graph.rules.pulse({ refractory: 5 })
}));

const run = I.create({ seed: 40, build, marks: [
  { id: 'source', tick: 0, kind: 'pin', cells: [[1, 2]], value: 1 },
  { id: 'gate', tick: 0, kind: 'obstacle', cells: [[4, 1], [4, 2], [4, 3]] },
  { id: 'open', tick: 12, kind: 'obstacle', cells: [[4, 2]], enabled: false },
  { id: 'pulse', tick: 15, kind: 'inject', cells: [[6, 2]], mode: 'replace', value: 1 }
] });
run.seekTime(1.5);
const frame = run.frame();
const saved = JSON.parse(JSON.stringify(run.record()));
const replay = I.open(saved, { build });
replay.seek(15);
```

## Author the marks

Each mark has a stable `id`, a nonnegative integer `tick`, a `kind`, and one
selection. Tick-zero marks apply after the solver's seeded initialization
and before the first frame. Later marks apply after the solver reaches
their tick. Marks at the same tick apply in list order, and their results
are visible in that tick's frame.

| Kind | Behavior |
| --- | --- |
| `pin` | Holds the cell's current state during solver steps. An optional `value` sets its state at that tick. Pins keep supplying input to neighbors. Set `enabled: false` to release the pin. |
| `brush` | Writes `value` to the selection. Defaults to `mode: 'replace'`. |
| `obstacle` | Closes cells and clears their state. Set `enabled: false` to reopen the same cells. An existing pin stays assigned through a close and reopen. |
| `inject` | Writes `value` at its scheduled tick. Defaults to `mode: 'add'`. Set `mode: 'replace'` for an absolute target. |

A selection can be a `cells` list of addresses or a `stroke` with
`{ points, radius, falloff }`. A single XYZ point makes a round brush.
A list makes a swept brush along the segments. The default `falloff: 'flat'`
applies one value to the footprint. Continuous brush or injection marks
also support `'smooth'`, which blends toward a replacement or scales an
addition with distance. Shape selection uses spatial distance in the
adapter's coordinates. Use exact addresses to select cells across seams
or elsewhere along the graph.

- `I.lattice(grid)` binds the discrete glyph or cellular grid. Address
  cells as `[x,y]` or `[x,y,z]` on a voxel lattice. Strokes follow
  `grid.position()`, including the hex layout. An obstacle contributes
  zero to ordered neighborhood slots and freezes any reversible block
  that contains it.
- `I.domain(run)` binds an image, chart, graph, or volume from
  `K.cellular.domain`. Use its cell addresses or IDs. Strokes use the
  domain's XYZ positions and distance units. Closed cells have no active
  links and discard any signals still in their delay history.
- `I.continuous(grid)` binds a continuous cellular grid. Address cells as
  `[x,y]`. Strokes use cell units with integer centers on Z = 0. Brush
  strength is scaled by the authored coverage mask. Obstacles remove cell
  activity but preserve that mask for reopening. A sampled kernel can
  still reach an open cell across a blocked cell when its stencil spans it.

Discrete marks take integer states and use flat strokes. An addition
saturates to the alphabet. Named-channel marks take a record such as
`{ heat: .5 }` and modify the listed channels. Continuous cellular
state saturates to `[0, 1]`. Pins hold all channels at a cell.

## Edit, scrub, and save

- `put(mark)` inserts or replaces by ID. An omitted tick uses the current
  tick for a new mark or the existing tick for a replacement.
  `remove(id)` removes by ID. `replace(marks)` sets the full list.
- `seek(tick)`, `seekTime(seconds)`, and `step(count)` return the
  committed solver frame. Seeking back rebuilds from the seed state.
  Changing past marks recomputes the current tick. Failed replay leaves
  the prior committed state and input list intact. One seek replays up
  to 10,000 ticks.
- `record()` is JSON-ready and contains the seed, fixed timestep, and
  all marks, including pending injections. `checkpoint()` also includes
  the solver state at the current tick for resuming. Pass either to
  `I.open(saved, { build })` with the same seeded solver recipe.
- A custom binding can return `{ dt, tick, step, frame, checkpoint, restore,
  compile }` from `build(seed)`. Start at tick zero, advance synchronously,
  and have `compile(mark)` validate and return a function that applies
  the mark without advancing the tick. Its checkpoints must be JSON-ready.

## Export from a scene

A JavaScript scene can accept `simulationInputs` in its build options.
Open the supplied named records if present. Register the active sessions
under the same names in the world's `simulationInputs` property. Update a
replayable stage by calling `run.seekTime(t)` at the requested render time.

[Pulse at the Sluice](../examples/editable-simulation-inputs.js) uses a pinned
source and a painted stroke to generate waves. A timed edit opens the gate
and an injection starts a second pulse on the far side.

```sh
node cli/ink-studio.js export-scene examples/editable-simulation-inputs.js --w 890 --h 495 --px 1 --to 6.4 --fps 10 --out sluice
```

Find `simulationInputs` in `export.json` for the editable JSON path.
Scene replay JSON and HTML embeds also carry the records. To render an
edited input file, use the original scene with `--authoring`.

```sh
node cli/ink-studio.js render examples/editable-simulation-inputs.js --authoring sluice/take-XXX/simulation-inputs.json --t 2.7 --out sluice.png
```
