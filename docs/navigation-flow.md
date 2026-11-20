# Shared destination fields

Set `tiles.flowFields: {}` on a [tiled navigation system](navigation-tiles.md)
to share routing work among walking agents. Agents bound to that system
use the field automatically. Each field starts at the destination and
propagates cost backward across the same edges that tiled A* uses. The
field grows as agents query it from new origins, and route traces follow
its descent through tile crossings. [Elijah Emerson's flow-field chapter](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf)

The cache keys fields by the destination's XZ position, the movement profile,
and the live navigation revision. Radius, maximum slope, wading depth, and
clearance exclusion distinguish profiles. Edits that touch the sampled
region invalidate the field. A field whose sampled region is disjoint from
the edits can carry forward to the new revision. Agents with a route that
still passes their traversal checks keep it.

| Flow setting | Default | Purpose |
| --- | --- | --- |
| `maxFields` | 8 | Cached destinations per movement profile, from 1 to 64 |
| `maxCells` | 50,000 | Maximum settled lattice cells per field, from 1 to 250,000 |

After the field reaches its cell budget, the default route planner can
fall back to tiled A*. Pass `strategy:"flow"` to a route trace to see the
field's budget outcome. Pass `strategy:"astar"` to trace with A* directly.
Cache warmup affects work counters. The route and checkpoint remain
reproducible from the scene and scheduled inputs.

## Inspect a shared field

In the [shared ford example](../examples/world-flow-ford.json), three walkers
approach the same destination from different origins. Tick 2 floods the
crossing.

```sh
ink-studio probe examples/world-flow-ford.json --ticks 1 --field nav/tiles --json
ink-studio probe examples/world-flow-ford.json --ticks 2 --field nav/flow --at 1,0,1.5 --args '{"to":[12,0,1.5],"radius":0.15,"maxWade":0.14}' --json
ink-studio trace examples/world-flow-ford.json nav/route --ticks 2 --at 1,0,1.5 --args '{"to":[12,0,1.5],"radius":0.15,"maxWade":0.14,"strategy":"flow"}' --json
```

`nav/flow` gives the cost to the supplied destination, the next world
point, and a unit direction toward it. Costs use the walking graph's
weighted world distance. The destination sample has zero cost and a
zero direction. The sample reports `outside`, `blocked-pin`,
`unreachable`, or `budget` when no direction is available.

`nav/tiles` reports the active navigation revision, cached field count,
and cumulative builds, hits, and invalidations. A successful flow trace
also reports the field revision, total settled cells, and how many cells
that request added.
