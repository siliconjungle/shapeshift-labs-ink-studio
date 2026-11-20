# Budgeted walking route requests

Set `routeQueue` on an `agents` system that uses [tiled navigation](navigation-tiles.md).
The queue serves up to `maxRequestsPerTick` route requests across all
substeps in each world tick. The default is 16 and the allowed range is 1
to 256. Each admitted request uses the configured navigation planner and
its own search limits. New requests can be served from the following tick.

Set an agent's `routePriority` in its starting record or spawn arguments.
A `seek` command can update it with `priority`. Priority ranges from
−1,024 to 1,024 and defaults to zero. Each waiting tick adds one priority
point. Ties go to the older request, then to the lowest agent ID in lexical
order. Changing a destination or removing an agent clears the superseded
request. Route status and pending work are saved in checkpoints.

| Route status | Meaning |
| --- | --- |
| `waiting` | A request is queued and there is no verified segment left to follow. |
| `safe-segment` | A request is queued and the agent can continue along the verified part of its previous route. |
| `ready` | The agent has a traversable route. |
| `blocked` | The planner found no route or movement encountered a physical obstruction. |
| `limited` | The planner reached its search limit. A subsequent attempt can run after the retry interval. |
| `idle` | The agent has no current routing work. |

Safe segments use the current tile snapshot and the normal movement sweep.
An activity policy waits for the queued result before choosing a
destination or rejecting a candidate. Cohorts retain the request across
LOD transitions and resume detailed route work on wake.

## Inspect the ford example

The [route queue example](../examples/world-route-queue.json) floods the
crossing at tick 10. The high-priority walker receives the first replanning
slot on tick 11. Walkers still on dry ground can follow the safe portions
of their old routes while they wait.

```sh
ink-studio probe examples/world-route-queue.json --ticks 10 --field crew/route-queue --json
ink-studio probe examples/world-route-queue.json --ticks 11 --field crew/route-status --args '{"agent":"lead"}' --json
ink-studio sim render examples/world-route-queue.json --ticks 10 --colored --out queued-ford.png
```

The queue report includes requests in service order and attempts made in
the most recent solver tick. A served entry records the planner's
outcome. Use the per-agent status to see whether that outcome was applied
to its current destination.
