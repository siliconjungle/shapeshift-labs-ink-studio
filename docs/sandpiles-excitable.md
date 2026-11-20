# Sandpiles and excitable media

Ink Studio supports local toppling with `KIT.cellular.sandpile` and a
shared `KIT.cellular.rules.excitable` rule for lattices and graphs. Use
sandpile grains and toppling histories for relief, pigment, or splats.
Use charge, firing, refractory states, and recovery to give materials
moving fronts and trails.

## Run a sandpile

```js
const C = K.cellular;
const pile = C.sandpile.create({
  width: 81, height: 81, initial: 1,
  mask: ({ x, y }) => Math.abs(x - 40) + Math.abs(y - 40) <= 65
});
pile.add([{ x: 40, y: 40, grains: 4200 }]);
const wave = pile.step();
const earlier = pile.frame();
const saved = pile.checkpoint();
pile.stabilize();
const engraving = pile.frame().data('topplings');
```

A cell topples at its lattice degree and passes one grain along each
neighbor direction. A square lattice uses four sides. An axial hex
lattice uses six directions. A voxel grid uses its six faces and is the
default when `depth` is greater than one. `position(x,y,z)` returns the
same unit-pitch cell centers as the corresponding glyph grid.

Each wave topples every cell that was already unstable exactly once. A
neighbor made unstable by the wave joins the next one. `step(waves)` and
`stabilize({ maxWaves })` return the number of waves committed, the number
of topplings and grains lost during the call, and a status of `'stable'`,
`'limit'`, or `'budget'`. `stabilize` defaults to at most 10,000 waves.
Another call can resume an unfinished avalanche. A wrapped system without
sinks can remain unstable indefinitely.

`boundary: 'open'` drains transfers that leave the lattice. `'wrap'`
wraps storage coordinates on each axis. `mask({ x,y,z })` defines active
cells. Masked cells are sinks under both boundary modes. An `initial`
value, packed array, or cell callback sets grains in active cells. A drop
has `{ x,y,z,grains }`, with `z` defaulting to zero. Depositing into a sink
records the grains as added and immediately lost. `add()` returns the
number retained by the lattice.

`frame()` retains an independent view. `data()` copies unsigned grains.
`data('topplings')` copies the cumulative toppling count per cell, called
the *odometer*. `data('lastToppled')` copies each cell's most recent
wave, with zero indicating that it has never toppled. All planes have `x`
varying fastest, then `y`, then `z`. The frame exposes the total topplings
and a `mass` ledger. `initial + added - lost` equals `retained`.

`checkpoint()` includes the grain counts, odometer, latest toppling waves,
and mass ledger. Restore on a matching lattice and mask. `reset()` restores
the authored initial grains. The solver supports up to 65,536 cells, a
32-bit unsigned total grain count, and a configurable `maxWork` cap for
one batch. [D. Dhar, Self-organized critical state of sandpile automaton models](https://doi.org/10.1103/PhysRevLett.64.1613)

## Run an excitable field

```js
const rule = C.rules.excitable({ threshold: 2, refractory: 7, recovery: 4 });
const sheet = C.create({ width: 57, height: 49, rule });
sheet.edit([{ x: 15, y: 24, state: rule.firing }, { x: 41, y: 24, state: rule.firing }]);
sheet.step(12);
const material = rule.describe(sheet.get(20, 24));
```

The rule packs its stages into a discrete alphabet exposed as `rule.states`.
`rule.firing` gives the firing state for initialization or edits. Use
`rule.describe(state)` for `phase`, `charge`, `required` input to fire,
and `remaining` ticks in that phase. During recovery `remaining` counts
how many ticks would pass before rest in the absence of new input.

- A resting or charging cell accumulates integer input from firing
  neighbors. The input is `floor(gain × sum of firing weights)`.
  Lattice neighbors have unit weight. Graph rules use edge weight and
  delay. The defaults are `threshold: 1`, `gain: 1`, and `leak: 1`.
  A tick with zero input drains up to `leak` stored charge.
- Crossing the threshold fires for a single tick. The cell then ignores
  new input for `refractory` ticks, eight by default.
- `recovery` optionally adds partially excitable ticks, zero by default.
  A recovering cell can fire if its input reaches the current elevated
  threshold. The recovery threshold is `threshold +
  ceil(threshold * remaining / (recovery + 1))`. The cell returns to rest
  when recovery runs out. Charge resumes accumulating after rest. The alphabet can hold up to 256 states across all stages.

With one unit of input sufficient to fire and with recovery disabled,
this is the basic excitable state cycle. Broken wavefronts curl into
spirals. Opposing fronts can extinguish where they meet because each
leaves a refractory wake. [J. M. Greenberg and S. P. Hastings, Spatial Patterns for Discrete Models of Diffusion in Excitable Media](https://epubs.siam.org/doi/10.1137/0134040)

## Render the studies

[Avalanche Seal and Excitable Slate](../examples/sandpiles-excitable-studies.js)
uses grains and the odometer to engrave bronze, with recent topplings
lighting its surface. The Excitable Slate shows hex-lattice spirals beside
a separate collision test that uses charge and recovery.

```sh
node cli/ink-studio.js clip examples/sandpiles-excitable-studies.js --w 690 --h 600 --to 6.4 --fps 10 --out avalanche-seal.png
node cli/ink-studio.js clip examples/sandpiles-excitable-studies.js --params '{"study":"waves"}' --w 870 --h 520 --to 6.4 --fps 10 --out excitable-slate.png
```
