# Faction perception

A `perception` system gives a faction a shared record of what its observers
have seen, heard, or detected nearby. Use the same queries for a scout report,
fog-of-war coverage, or a villager deciding which shelter it knows about.
The system reads the completed world tick, including movement, doors, and
sound cues emitted during that tick. Records and active cues survive
checkpoint, fork, and replay.

## Configure observers and targets

- Each named `profiles` entry enables one or more sensing channels. Set
  `sight.range`, an optional `sight.fov` in degrees (default 360), and the
  qualified `sight.rays` that can block it, such as `rig/ray` and
  `building/ray` for mechanics and published construction bodies. With no
  ray providers, sight uses range and field of view. `eyeHeight` offsets
  the listener and sight origin along world Y.
- `proximity.range` detects nearby subjects by world distance.
  `hearing.range` and `hearing.thresholdDb` define audibility. Bind
  `hearing.field` to a qualified acoustic query such as `acoustics/audible`
  to use rooms and portals. Without a field, hearing uses distance attenuation.
- Each entry in `factions.<name>.observers` names an `at` and a `profile`.
  An observer can be a world point, an entity or socket, or an agent handle
  with a system, ID, and generation. An optional `facing` vector overrides
  the forward direction from the entity or live agent.
- Use `factions.<name>.rosters` with `system`, `profile`, and an optional
  query condition in `where` to sense through a live group of agents. New
  roster members join automatically and dormant agents stop sensing.
- Limit observed subjects with `targets.kinds`, `targets.systems`, and
  `targets.where`. Kinds include `agent`, `entity`, `body`, and `socket`.
  Tag objectives, shelters, or scouting landmarks so they can be selected
  with the same query conditions.
- To materialize sounds, map world event kinds in `sounds` to a
  `levelDb`, band (`low`, `mid`, or `high`), and `duration` in ticks.
  A matching event supplies its position as `at` and can override loudness
  with `soundLevelDb`. A sound is its own contact with a heard direction
  and, when the acoustic path crosses rooms, a portal's apparent source.

## Read sight, proximity, and memory

The examples use `intel` as the system ID. A scoped export can bind that provider to one faction's view. [World views and intervention permissions](world-access.md)

| Field | Result |
| --- | --- |
| `intel/batch` | Reads a list of `{profile, from, to}` pairs against one snapshot. Each pair can specify `facing` and `sound: {levelDb, band}`. Returns individual outcomes including sight occluders when available. |
| `intel/faction` | Reads all contacts for a `faction`, optionally filtered by `where`. |
| `intel/contact` | Looks up one observation by `key`, entity, or remembered point. Point queries can set a `radius`. |
| `intel/visible` | Tests whether the last faction scan saw a matching contact. |
| `intel/coverage` | Tests live line of sight to a world point from any active observer in a faction. Sample it on a grid for current visibility. Author persistent terrain landmarks as targets to track when the faction last saw each landmark. |

Every contact has `lastObservedTick` and `ageTicks`. Sight observations
also include `lastSeen.position`, `lastSeen.tick`, and `seenAgeTicks`. A
proximity observation can refresh the contact age. The last seen position
and seen age follow only positive sight observations. Recycled agent IDs
get separate memory keys by generation.

The `currentlyVisible`, `currentlyNear`, and `currentlyAudible` flags
describe the last completed scan. Set `sampleEvery` to reduce scan frequency
and read `sampledAt` or `sampleAgeTicks` for freshness. `rememberTicks`
controls expiry after the last positive observation. When an authored
limit (`maxObservers`, `maxTargets`, `maxContacts`, or `maxSounds`)
truncates a scan, `stats.limited` is true. Increase the relevant limit or
narrow the target filter before interpreting absence as a negative finding.

## Run the lookout example

In [the example scene](../examples/world-lookout-memory.json), a shutter cuts
off the west faction's sight of the courier. The bell remains audible
through the acoustic layout. At tick 24 the west faction's last sighting
is 11 ticks old, while the east faction still sees the courier. The shutter
reopens at tick 45.

```sh
ink-studio sim run examples/world-lookout-memory.json --ticks 55 --record lookout.run.json
ink-studio probe lookout.run.json --ticks 24 --field intel/faction --args '{"faction":"west"}' --json
ink-studio probe lookout.run.json --ticks 24 --field intel/faction --args '{"faction":"east"}' --json
ink-studio probe lookout.run.json --ticks 24 --field intel/coverage --at 3,0.7,0 --args '{"faction":"west"}' --json
ink-studio sim replay lookout.run.json
```

Use `ink-studio inspect examples/world-lookout-memory.json` to discover the
fields and trace providers. A batch probe can mix points and named objects.

```sh
ink-studio probe lookout.run.json --ticks 24 --field intel/batch --args '{"queries":[{"id":"crossing","profile":"watch","from":[-3,0.1,0],"to":[3,0.8,0]},{"id":"bell","profile":"watch","from":[-3,0.1,0],"to":[3,0.8,0],"sound":{"levelDb":98,"band":"low"}}]}' --json
```
