# Agent storage and lifecycle

The `agents` system supports authored rosters and runtime births and removals.
Each agent has a string ID and an assigned generation. Together with the
system name they identify one lifetime in a simulation branch. Spawning a
retired ID assigns a new generation. Compaction can move an agent to another
component page while its handle stays the same.

## Author and schedule

Use the existing species movement profiles. An initial agent or a spawn can
set `position`, `goal`, `entity`, `name`, `metadata`, and `task` alongside
its `species`. Position and species are required. The optional entity
defaults to the agent ID for pose queries. Use distinct entity IDs when
instances need independent scene poses.

The following commands use a system named `flock`.

| Action | Arguments |
| --- | --- |
| `flock/spawn` | `agent` (ID), `species`, `position`, and optional agent properties |
| `flock/despawn` | `agent`, optional `generation` |
| `flock/seek` | `agent`, `to` (XYZ), optional `generation` |
| `flock/set-task` | `agent`, `task` (ID or `null`), optional `generation` |

Commands on the same tick run in schedule order. Provide the generation
when a command must target a specific lifetime. Duplicate live IDs,
stale handles, and capacity errors reject the tick atomically. Spawn and
removal emit `agent-spawned` and `agent-despawned` with the handle and
position. Set `config.maxAgents` to configure per-system capacity. The
default is 16,384 live agents and the maximum configurable capacity is 65,536.

A task is an application-defined label. [Activity policies](agent-decisions.md)
drive the task of managed agents from their current choice. A managed ID
that respawns starts with a fresh activity decision.

## Query live state and recordings

```sh
ink-studio sim run examples/world-agent-roster.json --ticks 4 --record roster.run.json
ink-studio probe roster.run.json --field flock/agent --args '{"agent":"scout"}' --json
ink-studio probe roster.run.json --field flock/velocity --args '{"agent":"scout"}' --json
ink-studio probe roster.run.json --field flock/components --args '{"page":0}' --json
ink-studio sim replay roster.run.json
```

- `agent`, `position`, `velocity`, and `task` resolve a live agent. Pass
  `args.agent` or a selector such as `{"agent":"scout"}`. An entity selector
  also works while a pose is available. Pass `args.generation` to resolve a
  specific lifetime. Missing agents return `missing`. Agents without a task
  return `ok` with `null`.
- `agents` returns the keyed roster for renderers and consumers that need
  full records. `population` counts live agents by species.
- `components` returns the packed pages or a single page with `args.page`.
  In each page, `ids`, `generations`, and `tasks` share a slot index.
  `positions` and `velocities` use three consecutive values per slot in XYZ
  order. Indices in `tasks` start at 1 in the result's `taskNames` table.
  Zero means no task. Resolve handles again after lifecycle edits because
  page indices and slots can change.

Velocity is measured over the most recent solver step in world units per
second. During [cohort simulation](aggregate-simulation.md), it reflects
the cohort's average displacement. Sleeping chunks retain their last state.

The solver shares unchanged immutable component pages and cold records
between checkpoints and forks. Use the query fields or
`run.view().states.flock.agents` for keyed records. Raw checkpoints store
the packed roster. Existing row-based checkpoints and run recordings
remain readable.
