# Groups and formations

Enable `formations` on an `agents` system to give a roster named groups.
A group holds stable agent handles and shares a destination. Members
still use their own movement, [route request budget](budgeted-route-requests.md),
and [crowd admission](crowds-and-bottlenecks.md). Groups can be used for
squads, herds, caravans, or workers moving to a rally point.

The [expedition example](../examples/world-expedition-formation.json)
puts six agents in two rows. The group sets out for the far bank, a
surveyor detaches for a separate order, and the remaining five reform
in three columns after crossing. The move and facing controls draw on
formation orders as a design reference. [Beyond All Reason’s commands](https://www.beyondallreason.info/commands-2-0-grid)

## Define a group and give it a destination

```json
{
  "formations": {
    "groups": {
      "expedition": {
        "members": ["guide", "porter", {"agent": "surveyor", "generation": 3}],
        "layout": {"columns": 3, "spacing": 0.8}
      }
    }
  }
}
```

Each member belongs to one group within its roster. A group uses one
locomotion mode, with any mixture of species and movement speeds in
that mode. `columns: 1` gives a file. With more columns, members are
assigned to rows around the destination. A short rear row is centered.
The solver increases spacing where member radii and crowd separation
require it.

```json
{
  "tick": 2,
  "action": "crew/group-move",
  "args": {"group": "expedition", "to": [10.7, 0, 0], "facing": [1, 0, 0]}
}
```

`facing` is an optional horizontal direction for the final formation.
The last route segment supplies the default. A move can also supply a
new `layout` for the group. Groups share the pace of the slowest
participating member. A personal [order](agent-orders.md) temporarily
takes control of that member, which can then return to its slot.

| Action | Arguments |
| --- | --- |
| `crew/form-group` | `group`, `members`, optional `layout` |
| `crew/group-join` | `group`, `members` |
| `crew/group-detach` | `group`, `agent`, optional `generation` |
| `crew/group-stop` | `group` |
| `crew/group-disband` | `group` |

Issue a personal order or `seek` after detaching to give the member a
separate destination. A walker already admitted to a passage clears it
before taking the new route. Despawning removes the old handle from
the formation and an empty group is removed.

## Passes, rally points, and checkpoints

The walking planner samples the shared route for narrow terrain and
authored bottlenecks. It places a rally point beyond a passage where
the group has room to regroup. Individual walkers funnel through the
live route and respect any configured capacity and right of way. The
next leg starts once participating members reach their rally slots.
When a destination itself is narrow, the planner tries fewer columns
and can widen again when the clearance opens. Swimming and flying
groups use the same destination slots and shared pace.

`maxPlansPerTick` defaults to 8 group routes per roster. `retryTicks`
defaults to 24. `sampleStep` defaults to 0.3 world units for walking
corridor sampling. Group destinations, stage assignments, and
membership survive checkpoints and replay. Formation movement pauses
during cohort LOD and continues in detailed simulation.

## Inspect a run

```sh
ink-studio sim run examples/world-expedition-formation.json --ticks 130 --record expedition.run.json
ink-studio probe expedition.run.json --ticks 40 --field crew/formations --args '{"group":"expedition"}' --json
ink-studio probe expedition.run.json --field crew/formations --args '{"group":"expedition"}' --json
ink-studio sim replay expedition.run.json
```

The query reports membership, the shared destination, active travel
stage and assigned slots, observed lateral span and pace, and how many
members are at their slots or suspended by a personal order. The event
log records membership changes, regrouping, and arrival.
