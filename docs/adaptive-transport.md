# Adaptive transport networks

`KIT.procedural.routes.adaptiveTransport(options)` solves flow across
an authored graph and updates each edge's capacity in response to use.
Feed the same frame into tube widths, color, or moving splats. Cutting
an edge redistributes flow through the surviving links, which can then
grow wider over subsequent ticks.

```js
const network = KIT.procedural.routes.adaptiveTransport({
  dt: .1, reinforce: 4, decay: .75, flowScale: .08,
  nodes: [
    { id: 'intake', at: [-2, 0, 0], pressure: 1 },
    { id: 'elbow', at: [0, 0, 1.4] },
    { id: 'outlet', at: [2, 0, 0], pressure: 0 }
  ],
  edges: [
    { id: 'trunk', from: 'intake', to: 'outlet', capacity: .65 },
    { id: 'supply', from: 'intake', to: 'elbow', capacity: .15 },
    { id: 'return', from: 'elbow', to: 'outlet', capacity: .15 }
  ]
});
const intact = network.step(20);
network.edit({ integrity: { trunk: 0 } });
const rerouted = network.step(25);
const bypass = rerouted.edge('supply');
const halfway = bypass.route.sample(.5);
```

## Author the graph

- Nodes have stable string IDs and optional XYZ `at` positions.
  Set a node's `pressure` in `[0,1]` to pin it. A node without a pin
  balances its incoming and outgoing flow. A component without
  a pin has no flow and reports `null` pressure.
- Each edge has an ID and distinct `from` and `to` node IDs. If both
  nodes have positions, the edge exposes an arc-length `route`.
  Supply optional `points` beginning and ending at those nodes for
  a bent conduit or a root following a surface. This accepts the
  point lists from existing route tools. Abstract links can omit
  geometry.
- `minCapacity`, `maxCapacity`, and initial `capacity` bound the
  width of each link. Defaults are .02, 1, and .18, with the default
  initial value clamped to the authored range. The positive minimum
  leaves a dormant link usable.
- Edge conductance is `capacity * integrity / (1 + resistance)`.
  Resistance defaults to the route length, or zero for an abstract
  link. Flow is conductance times the pressure drop. A positive
  flow runs from `from` to `to` and a negative flow runs in reverse.
  With normalized pressures, the flow magnitude is bounded by
  the edge's capacity times integrity.

## Grow, cut, and replay

Every fixed tick first adapts the capacity to the last solved flow,
then solves flow for the updated graph. `reinforce` sets the
strengthening rate toward the maximum, scaled by
`min(1, abs(flow) / flowScale) ** exponent`. `decay` is the
continuous rate toward the minimum. Set `reinforce`, `decay`, and
`flowScale` globally or override them for an edge. `exponent`
is global and controls how strongly small flows compete with
the busiest paths.

`edit({ pressures, integrity })` applies named edits and immediately
solves the graph at its current tick. Set an edge's integrity to zero
to sever it, a fraction to restrict it, or one to repair it.
Set a pressure to `null` to unpin that node. Edits preserve adapted
capacity. `checkpoint()`, `restore(token)`, and `reset()` preserve
the tick, pressures, integrity, and capacities. Replay the same
edit schedule to reproduce the sequence. A failed or over-budget solve
leaves the retained state intact.

## Compose the outputs

`frame()`, `step(count)`, and `edit()` return immutable snapshots.
`edge(id)` returns `route`, `capacity`, signed `flow`, `conductance`,
`integrity`, and `utilization`. `node(id)` returns pressure and
`net`, the positive amount supplied or negative amount drawn
per second. The arrays `edges` and `nodes` preserve authored order.
`stats` includes total supply and delivery, maximum flow imbalance
at unpinned nodes, normalized head residual, and solver iterations.

Use capacity for the cross-section, signed flow to steer a pulse along
`route.sample(u)`, and magnitude for its brightness or speed. The
[Night Relay and Root Graft studies](../examples/adaptive-transport-studies.js)
show the width response and direction of flow through a severed trunk
and its surviving bypasses.

```sh
node cli/ink-studio.js clip examples/adaptive-transport-studies.js --w 900 --h 560 --px 2 --to 6.4 --fps 10 --out night-relay.png
node cli/ink-studio.js clip examples/adaptive-transport-studies.js --params '{"study":"roots"}' --w 900 --h 560 --px 2 --to 6.4 --fps 10 --out root-graft.png
```
