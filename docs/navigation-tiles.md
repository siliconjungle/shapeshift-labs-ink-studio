# Incremental navigation tiles

Add `tiles` to a `navigation` system's configuration to share sampled
walking routes and boundary crossings. Tiles populate on demand as routes
visit them. A search can cross multiple tiles through any edges that pass
the local slope, water, and clearance tests. Bounds and the `cell` spacing
define the XZ lattice. Each column uses the support or bed height selected
by the navigation system.

| Tile setting | Default | Purpose |
| --- | --- | --- |
| `size` | 16 | Lattice nodes per tile side, from 4 to 64 |
| `maxTiles` | 512 | Cached tiles per travel profile, from 4 to 4,096 |
| `maxProfiles` | 16 | Cached combinations of radius, wading depth, slope, and clearance exclusion |
| `maxVisits` | 100,000 | A* expansion budget per route |

Walking agents can set `config.navigation` to the navigation system ID.
They inherit its bounds and world fields, and use their own physical
radius, slope limit, and wading depth for routing. Walkers validate the
remaining route against the live crossings and reuse valid routes beyond
their normal retry interval. Agents with a blocked route retry after a
short interval. Flight and swimming use their existing spatial planner.

Use [shared destination fields](navigation-flow.md) when several walkers
head for the same destination.

Use [budgeted route requests](budgeted-route-requests.md) to spread
replanning after a local obstruction across multiple ticks.

## Trace a changing crossing

The [ford example](../examples/world-tiled-ford.json) transfers water into
the crossing at tick 2. The local walker takes a detour and the distant
walker keeps its route.

```sh
ink-studio trace examples/world-tiled-ford.json nav/route --at 1,0,1.5 --args '{"to":[12,0,1.5],"radius":0.15,"maxWade":0.14}'
ink-studio trace examples/world-tiled-ford.json nav/route --ticks 2 --at 1,0,1.5 --args '{"to":[12,0,1.5],"radius":0.15,"maxWade":0.14}'
ink-studio probe examples/world-tiled-ford.json --ticks 2 --field nav/tiles --json
```

Route traces include the tile sequence, crossing endpoints, and cache
work for the search. `nav/tiles` reports the cached tile count and the
latest invalidated tiles. Cache diagnostics reflect which searches have
run. Routes and simulation checkpoints replay from the world data.

Editable volumes, shallow water, construction layouts, mechanics bodies,
world-space field regions, and traffic wear can report regional changes.
A voluntary `navigationSource(field, state)` hook lets another solver
return a source `key` and `changes(previousKey)`. Return finite world
bounds with coordinate axes for the changed area, or `null` when the
affected region is unknown. Sources without regional information refresh
the affected navigation cache from the current snapshot.
