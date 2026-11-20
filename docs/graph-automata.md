# Graph automata

`KIT.cellular.graph` evolves discrete state on named objects connected by
explicit edges. Use façade panels, glyph strokes, voxels, or branch junctions
as nodes. A rule sees connections even when the objects are on different UV
charts or far apart in world space. Node and edge metadata can carry the
references needed to render the current state.

```js
const G = K.cellular.graph;
const relays = G.create({
  nodes: [
    { id: 'west-panel', type: 'panel', state: 1, data: { at: [-3, 4, 0] } },
    { id: 'east-panel', type: 'panel', data: { at: [3, 4, 0] } },
    { id: 'nearby-spare', type: 'panel', data: { at: [-2.4, 4, 0] } }
  ],
  edges: [{ from: 'west-panel', to: 'east-panel', type: 'skybridge', delay: 5 }],
  rule: G.rules.pulse({ refractory: 4 })
});
relays.step(5);
relays.get('east-panel');   // 1
relays.get('nearby-spare'); // 0
```

## Author the graph

- A node can be an ID string or a record with `id`, `type`, `data`, `state`,
  and `locked`. `type` defaults to `'cell'`. `data` holds JSON metadata and
  is copied and frozen. The initializer can be a shared `initial` state or a
  function of `{ id, node, random }`. A node's own `state` overrides it.
- An edge has `from` and `to` IDs. Set `bidirectional: true` to carry state
  in both directions. `weight` defaults to `1`, `type` to `'link'`, and
  `delay` to one tick. Use an explicit edge `id` for parallel links of the
  same type. Edges can carry immutable JSON `data`. Labeled `{ nodes,
  edges }` records from `K.procedural.grammar.rewriteGraph` can be supplied
  directly along with a rule.
- Nodes and inputs are evaluated in ID order. Initializer and rule random
  streams are keyed by node ID and seed, and rules receive a new stream each
  tick. Reordering the supplied nodes or edges preserves replay. The graph
  supports up to 65,536 nodes, 262,144 edge records, and a delay of up to 64
  ticks. Large step batches are subject to a work budget.

## Step and edit

`step(count)` evaluates every unlocked node against earlier states, then
commits the tick together. The rule receives
`{ id, node, state, tick, neighbors, inputs, random }`. `state` is the
node's previous value. `neighbors` contains one integer per incoming edge.
Each matching `inputs` entry has `{ id, node, edge, state, sampledTick }`,
where `id` and `node` identify the source. A delay of `d` samples source
state at `tick - d`. Before tick zero, source state is zero. A custom rule
returns an integer in `[0, states - 1]`. `states` defaults to two or is
inferred from a library rule. The alphabet supports up to 256 states.

`G.rules.pulse({ threshold = 1, refractory = 4 })` fires a quiet node when
the combined weight of firing inputs reaches the threshold at that tick.
State `0` is quiet, `1` is firing, and successive higher states count
through the refractory period before returning to quiet. Threshold and
edge delay can require two signals to arrive together. Existing `life`,
`cyclic`, and `briansBrain` rules also read the graph's neighborhood.
[J. M. Greenberg and S. P. Hastings, Spatial Patterns for Discrete Models of Diffusion in Excitable Media](https://epubs.siam.org/doi/10.1137/0134040)

Use `edit([{ id, state, locked }])` to inject a signal or pin a node.
Edits replace the node's value or lock at the current tick. A pinned node
still supplies input to its neighbors. A failed step batch or edit leaves
the graph at its previous committed state.

## Read and replay

`frame()` retains an independent view with `get(id, age = 0)`,
`isLocked(id)`, and `data()`. `data()` copies the current values in the
same order as `frame.nodes`. `get(id, age)` reads the current or a retained
prior state. `historySize` is the largest edge delay, or one for a graph
with no edges. A link with delay `d` can render a pulse for each firing
source sample of age `0` through `d - 1`. Use `(age + fraction) / d` as
progress along its authored curve, where `fraction` is the fraction of
one tick elapsed in the render.

`checkpoint()` returns a JSON-ready copy of the tick, locks, and retained
edge history. Restore it on the same topology, alphabet, and seed. Use
the same rule and future edits for deterministic replay. `reset()` returns
the graph to its authored initial state and locks.

## Render the studies

[Skybridge Relay and Glyph Loom](../examples/graph-automata-studies.js) shows
a pulse traveling between two façades through a delayed bridge link and a
glyph that lights its middle strokes when two branches arrive together.

```sh
node cli/ink-studio.js clip examples/graph-automata-studies.js --w 850 --h 540 --to 6.4 --fps 10 --out skybridge-relay.png
node cli/ink-studio.js clip examples/graph-automata-studies.js --params '{"study":"glyphs"}' --w 850 --h 540 --to 6.4 --fps 10 --out glyph-loom.png
```
