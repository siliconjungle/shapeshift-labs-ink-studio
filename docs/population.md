# Households and population

Add a `population` system when a world needs a census, households,
employment, or demand. A household can represent many anonymous residents
with a count for each demographic group. Named residents have a durable ID,
age, and employment record. A named resident can also be represented by a
live agent on an opted-in roster. Citizen lifepaths and household demand
are design references. [Cities: Skylines II citizen simulation](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/citizen-simulation-lifepath)

The [estuary example](../examples/world-estuary-households.json) follows a
birth, a household's relocation from a flooded riverbank, an employment
expansion, a named death, and a group of people arriving and later leaving.
An [event action](event-actions.md) sends two named residents walking
across the bridge after their household moves.

## Author the census

Use a system config like this one.

```json
{
  "interval": 60,
  "resources": {"food": "serving", "fuel": "bundle"},
  "groups": {
    "child": {"demand": {"food": 1}, "after": 1200, "next": "adult"},
    "adult": {"work": true, "demand": {"food": 2}}
  },
  "householdDemand": {"fuel": 1},
  "districts": {
    "ridge": {"at": {"entity": "ridge"}, "capacity": 24, "supply": {"food": "stores/ridge"}}
  },
  "workplaces": {
    "mill": {"district": "ridge", "at": {"entity": "mill"}, "capacity": 8}
  },
  "households": {
    "reed": {
      "district": "ridge",
      "groups": {"adult": 2, "child": 1},
      "residents": {"mara": {"group": "adult", "name": "Mara", "age": 45}}
    }
  }
}
```

- District capacity is measured in residents. Moving a whole household,
  a birth, or an arrival uses free capacity. Reducing capacity reports
  overcrowding and keeps existing households present.
- Each workplace has a capacity, an anchor, and an optional list of
  eligible working `groups`. Set `from` to allow workers from specific
  districts. It defaults to the workplace's own district. Incumbents
  keep eligible slots where possible. Remaining slots are filled by
  workplace priority and stable IDs, with named workers assigned before
  new cohort allocations. Queries expose the workplace anchor for commute
  and work policies.
- Demand adds group quantities per resident, common `householdDemand`, and
  a household's optional `demand` surcharge. These quantities are for
  one census interval. A district's optional `supply` names compatible
  qualified accounts. The report compares requested demand to the current
  available balance. Use the resource ledger or logistics to model
  actual consumption. Signals expose `population`, `employed`, and a
  `demand` record for other solvers.

## Use slower rules and scheduled changes

The population clock evaluates `rules` every `interval` world ticks.
An optional `when` list samples existing fields at the district or
specified anchor. An optional `where` filters the household record, or
the receiving district record for immigration.

| Rule kind | Options and result |
| --- | --- |
| `birth` | `from` is the source group, `group` receives children, and `rate` is the fractional birth rate per interval. Named and anonymous residents contribute to the source count. Births add to anonymous cohorts and respect housing capacity. |
| `death` | `from` and `rate` remove anonymous residents from a group. |
| `transition` | `from`, `group`, and `rate` move anonymous residents between groups. |
| `immigrate` | `district`, `group`, and `count` admit a new anonymous household when capacity is available. Its ID is the rule ID or `prefix` plus the tick. |
| `move` | `district`, `to`, and `count` move up to that many households to another district. |
| `emigrate` | `district` and `count` mark up to that many households as away. |

Demographic rates carry fractional remainders between pulses. Named
residents follow explicit actions or a group's optional `after` timing.
On the first eligible pulse, a resident advances to the group's `next`
stage or dies when that stage is terminal. `age` and `stageAge` are in
world ticks.

Actions run at their scheduled ticks. With a system named `county`, use
`county/immigrate` with `household`, `district`, and optional `groups`,
`residents`, or `demand`. To return a previously emigrated household,
send its existing household ID and the destination district. Members and
lifepaths come from the saved household. Other actions include
`move-household`, `emigrate`, `birth`, `death`, `set-group`, and
`set-capacity`.

```json
{"tick":5,"action":"county/birth","args":{"household":"reed","group":"child","resident":"nia","name":"Nia"}}
```

Use `count` in place of `resident` for an anonymous birth or death. A
named death takes `resident` alone. A capacity edit takes `district`
or `workplace` plus `capacity`.

## Bind and inspect individuals

List compatible agent systems in `rosters`. Include an initial
`actor: {"system":"crew","agent":"mara"}` or use `county/bind` to link
a resident to a live actor. `county/materialize` takes `resident`,
`system`, and `species`, plus optional `at` and `agent` overrides.
It spawns the actor at the household's district anchor by default.
The saved binding pins the actor's generation. Dematerialization
retains the resident. Named death and emigration release bound actors
and their pending orders, including on cohort rosters.

```sh
ink-studio sim run examples/world-estuary-households.json --ticks 44 --record estuary.run.json
ink-studio probe estuary.run.json --field county/residents --args '{"resident":"nia"}' --json
ink-studio probe estuary.run.json --ticks 24 --field county/demand --args '{"district":"ridge"}' --json
ink-studio probe estuary.run.json --field county/workplaces --json
ink-studio sim replay estuary.run.json
```

`totals`, `households`, `districts`, `residents`, `workplaces`, and
`demand` expose the census and previous pulse tick. Named milestones
emit world events, and each aggregate rule execution emits a summary.
Checkpoints retain cohort counts, stages, actor bindings, employment,
and rate remainders for independent forks and replay.
