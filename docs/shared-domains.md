# Shared cellular domains

`KIT.cellular.domain` runs a neighborhood rule on an image grid, across joined
UV charts, on an authored graph, or in a small voxel volume. The adapter supplies
each cell's incoming links and measurement units. The rule decides how to
combine their states. An excitable pulse can follow grid neighbors, cross a
surface seam, or wait on a delayed graph edge with the same rule function.

```js
const D = K.cellular.domain;
const grid = D.image({
  width: 24, height: 12, spacing: [.12, .12], units: 'm',
  boundary: ['wrap', 'closed']
});
const pulse = K.cellular.rules.excitable({ refractory: 6 });
const run = D.create({
  domain: grid, rule: pulse, seed: 41,
  initial: ({ cell }) => Number(cell.id === '8,5')
});
run.step(6);
const wave = run.frame().data(); // Uint8Array, one value per grid.cells entry

const heat = D.create({
  domain: grid, channels: ['heat'], dt: .2, timeUnit: 's',
  rule: D.rules.diffusion({ channel: 'heat', rate: .8 })
});
heat.edit([{ at: [8, 5], state: { heat: 1 }, locked: true }]);
heat.step(6);
const values = heat.frame().data('heat'); // Float64Array
```

## Choose a domain

| Constructor | Cell addresses | Connectivity and distance |
| --- | --- | --- |
| `D.image({width,height,...})` | `[x,y]` | Spacing defaults to one pixel. Four face neighbors or eight with `neighborhood: 'full'`. |
| `D.volume({width,height,depth,...})` | `[x,y,z]` | Spacing defaults to one world unit. Six face neighbors or 26 with `neighborhood: 'full'`. |
| `D.charts({charts,seams,units})` | `[chartId,x,y]` | Four face neighbors, plus explicit seams along chart boundaries. Distances are in world units by default. |
| `D.graph({nodes,edges,units})` | node ID | Edges are directed unless marked `bidirectional: true`. Length defaults to one in `'edge'` units. For physical units, supply `length` or 3D endpoint positions. |

Image and volume `origin` is the low corner and `spacing` is the per-axis
cell size. Cell positions are at the centers. `boundary` accepts `'closed'`
(the default), `'wrap'`, or one value per axis in X, Y, Z order.
A closed boundary drops the missing neighbor. A wrapped link keeps the
local sampling distance and carries `edge.data.periodic`. Wrapped axes
of size one or two keep distinct links for distinct neighbor offsets.

Each chart has `{ id, width, height, carrier }`. Its carrier implements
`sample([u,v])` and returns a world position as `p: [x,y,z]`. The adapter
samples normalized UV cell centers. Within a chart, link length is the
straight-line distance between centers. Join sides with a seam such as
`{ a: ['left','u1'], b: ['right','v0'], reverse: true }`. Both sides need
the same number of samples. An unjoined side is closed. Across a seam,
the default length adds each center's distance to its own boundary.
Supply a positive `length` for a different distance or a `weight`
to change the link's contribution to a rule.

Image, volume, and individual chart specs accept a `mask(cell)` predicate.
Masked cells and their links are omitted. A graph's nodes can carry
`{ id, position, type, data, state, locked }`. Its edges can carry
`{ id, from, to, bidirectional, length, weight, delay, type, data }`.
Distinct edge IDs allow parallel links. Delay is in ticks and defaults to
one. All adapters expose `domain.cells`, `domain.edges`, and
`domain.cell(addressOrId)`. An inactive address returns `null`.

## Write a portable rule

A rule receives `{ cell, state, neighbors, inputs, tick, time, dt, timeUnit,
random }`, plus the graph-compatible `id` and `node`. Each input
contains its source `id`, `cell`, and `node`, sampled `state`, `sampledTick`, and
`edge`. The edge exposes `weight`, `delay`, `length`, `units`, a `seam`
ID or `null`, and any authored `data`. All cells advance synchronously.
An input with delay `d` reads the source at `tick - d`, with zero state
before tick zero. The fixed clock defaults to `dt: 1` and `timeUnit: 'tick'`.

- A discrete rule returns an integer. Set `states` to the alphabet size
  (2–256). Built-in neighborhood rules such as excitable, cyclic, and
  Brian’s Brain provide their own alphabet. Use the dedicated lattice
  API for ordered line and reversible block rules.
- A continuous rule returns a record with the declared `channels` and a
  finite number for each. An initializer can be a shared state value or
  a callback receiving `{ cell, random }`. A graph node's authored state
  takes precedence.
- `D.rules.diffusion({channel,rate})` blends one channel toward the weighted
  average of its inputs by `min(1, rate * dt)`. Isolated cells retain their
  values. A custom rule can use `edge.length` to account for differences in
  sample spacing.

`step(count)` advances the retained state. `edit([{ at, state, locked }])`
can change or pin a cell at the current tick. You can use `id` in place of
`at`. Locked cells keep supplying input. `frame()` retains a read-only
view with `get(addressOrId, age)`, `isLocked(addressOrId)`, and
`data(channel)` in domain cell order. It reports `historySize`, the
largest link delay or one if there are no links. `data()` returns
integer values for discrete state or one record per cell for named
channels. `checkpoint()` is JSON-ready. Restore it on a matching domain,
clock, state model, and seed, then use the same rule and edits to replay.
`reset()` restores the authored initial state.

## Render the study

[One Rule, Four Domains](../examples/shared-domain-studies.js) runs the same
pulse through a wrapped image with a mask, two joined UV charts, a graph with
a six-tick bridge delay, and a face-connected voxel volume.

```sh
node cli/ink-studio.js clip examples/shared-domain-studies.js --w 940 --h 620 --px 1 --to 6.4 --fps 10 --out shared-domains.png
```
