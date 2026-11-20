# Agent needs and schedules

An agent's activity policy can grow needs over time, prefer activities that
address them, and restrict work to recurring shifts. A commitment keeps
eligible work going through ordinary priority changes. A higher-ranked
urgent activity can interrupt it.

In the [ford shift example](../examples/world-ford-shift.json), a hauler
delivers grain, eats after finishing, and starts an inspection in its
scheduled window. Meanwhile, the river rises above the ranger's wading
limit. The ranger abandons the delivery, keeps the bag already picked up,
and moves to a dry ledge.

## Define needs and activity windows

Extend `config.decisions` on an `agents` system.

```json
{
  "interval": 2,
  "cycle": 96,
  "needs": {
    "hunger": {"initial": 4, "min": 0, "max": 70, "perTick": 0.85}
  },
  "members": {
    "hauler": {"activities": ["sort", "eat"], "needs": {"hunger": 10}}
  },
  "activities": {
    "sort": {
      "priority": 8,
      "schedule": [{"start": 0, "end": 56}],
      "duration": 12,
      "commitment": "finish",
      "destinations": {"store": {"at": {"entity": "store"}}}
    },
    "eat": {
      "priority": 1,
      "needWhen": {"path": "/hunger", "op": "gte", "value": 12},
      "needPriority": {"hunger": 1.4},
      "needEffects": {"hunger": -70},
      "duration": 6,
      "destinations": {"seat": {"at": {"entity": "table", "socket": "seat"}}}
    }
  }
}
```

- A meter defaults to a range from 0 to 100, starts at its minimum, and
  changes by `perTick` every world tick. Values clamp to the declared
  bounds. Members can override initial values or keep the existing
  shorthand activity array.
- `needWhen` is a query condition on the member's meter values.
  `needPriority` adds each listed meter value times its weight to the
  activity's base `priority`. Ties follow the member's activity list.
- A `schedule` is a list of windows on the common `cycle` clock. Each
  window includes its start and excludes its end. A window such as
  `{"start":80,"end":10}` wraps through tick zero. Window and need
  eligibility changes trigger a fresh choice on the next solver visit.
- `needRates` adds a per-tick change while an agent is observed performing
  the activity at its destination. Base need rates account for elapsed
  world ticks when the agent wakes, while activity rates require a
  continuous detailed visit.
- `needEffects` applies a one-time change on completion, after the
  activity's duration and any `completeWhen` conditions. An activity
  can complete again after the agent leaves it and selects it again.

## Commit, interrupt, and abandon

Add `commitment: "finish"` to an activity with a duration. The planner
keeps that activity while its conditions and destination remain valid.
A higher-scoring eligible activity marked `urgent: true` can interrupt it.
Existing activity and destination field conditions still apply, so a
flood can also invalidate the commitment itself.

An assigned [order](agent-orders.md) controls the agent's movement until
the order yields control. Needs keep changing during that time. On return
to autonomous movement, the policy evaluates current needs and the
current shift. Use the existing order interruption action for explicit
overrides.

Set `blockedTimeout` on a task or order to abandon sustained confirmed
route failures. The clock counts once per active world tick with a
blocked move. Progress or a route-request wait resets the streak. A
failure preserves posted transfers and completed steps. The order report
includes `route-blocked`, `lastBlocker`, and the count of blocked ticks.

## Inspect the simulation

```sh
ink-studio sim run examples/world-ford-shift.json --ticks 58 --record shift.run.json
ink-studio probe shift.run.json --ticks 14 --field crew/needs --args '{"agent":"hauler"}' --json
ink-studio probe shift.run.json --field crew/orders --args '{"agent":"ranger"}' --json
ink-studio trace shift.run.json crew/why --args '{"agent":"hauler"}' --json
ink-studio sim replay shift.run.json
```

`crew/needs` gives the latest sampled values and their tick. The
`crew/why` trace includes last-evaluated priority scores, commitment, and
rejected choices. `activity-interrupted` records the old activity and its
replacement when present. The world checkpoints contain meters, activity
progress, and order blocking state.

Use `crew/set-need` with `agent`, `need`, and `value` to set a meter at a
scheduled tick. An optional `generation` pins the edit to a lifetime.
