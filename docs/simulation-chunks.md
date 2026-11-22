# Persistent simulation chunks

A world can assign named systems to an authored chunk on the same XZ or
XYZ lattice used by the render chunk scheduler. Each system has one owner.
Put the mechanics, habitat state, water and sediment for a valley in one
chunk. Systems can remain global by leaving them out of the chunk table.

Sleeping pauses solver work. The world checkpoint stores the last state
of each system, the chunk level and local solver clock, queued inputs, and
pending spatial invalidations. Dormant state stays queryable for collision,
inspection, and rendering. Render residency is controlled separately. The
host can use the chunk's `address` with its existing render scheduler.

## Set the levels

```json
{
  "grid": { "dimensions": 2, "size": 32 },
  "focus": { "player": { "at": { "entity": "player" } } },
  "hysteresis": 2,
  "levels": [
    { "id": "full", "within": 4, "every": 1, "systems": {
      "mechanics": { "substeps": 2, "tuning": { "contactIterations": 12 } }
    } },
    { "id": "coarse", "within": 80, "every": 8, "systems": {
      "mechanics": { "tuning": { "contactIterations": 3 } },
      "water": { "tuning": { "cfl": 0.46, "maxDt": 0.09 } }
    } },
    { "id": "sleep", "sleep": true }
  ],
  "chunks": {
    "valley": {
      "index": [0, 0],
      "systems": ["valley-rig", "valley-river"],
      "wake": { "commands": true, "events": true, "spatial": true, "holdTicks": 4 }
    }
  }
}
```

Put this object under `simulationChunks` in the world manifest. Active
level radii increase in order and measure distance to the bounds of the
chunk. The closest focus in the same `place` wins. Place defaults to the
world ID. A focus can be a point or a live entity/socket, and multiple
observers can keep different chunks active. `hysteresis` extends the
outgoing radius to prevent rapid demotion at a boundary.

A level can run every several active ticks or take several substeps per
tick. Solver-kind overrides under `systems` can refine that cadence and
supply tuning. A level can also choose an [aggregate representation](aggregate-simulation.md)
per kind or system. When a level leaves cadence unspecified, the solver uses
its normal schedule. Mechanics accepts `contactIterations`. Water
accepts `cfl` and `maxDt` within the solver's stability bounds. Transfer
producers use one substep per due update so the accounting occurs once.

Custom systems can validate a profile with
`checkSimulationLOD(tuning, { every, substeps, dt })`. During a managed
step, `ctx.simulationLOD` supplies the chunk, level, tuning, active tick
count, and local time. `ctx.dt` represents the active time in that step.
The usual `ctx.tick` and `ctx.time` continue to represent the world clock.

An unfinished coarse interval survives sleep. On the first finer substep
it is applied together with that substep's share of the current tick.
Sleeping time never enters the interval. Averaged inputs retain their
active-time weights. A solver with an aggregate representation saves its
selected form in the world checkpoint.
Movable props stay with the system that owns them, even if they cross a
chunk boundary. Existing field reads, signals and transfers define the
interfaces between authored systems.

[Region continuity](region-revisions.md#carry-named-continuity-across-region-views)
keeps named lifetimes, parties, balances, and active stories visible to
receivers as those regions are unloaded and reopened.

## Wake and inspect

- `world/chunk-focus` sets or moves a named focus with
  `{ "id": "player", "at": [12, 0, 4] }`. Use `"at": null` to remove it.
- `world/chunk-level` pins a chunk at a level with
  `{ "chunk": "valley", "level": "full", "ticks": 3 }`. Omit `ticks`
  for a persistent pin. Set `level` to `null` to return to automatic
  selection. Pins take precedence over automatic wake rules.
- `wake.commands` wakes on a command targeting one of the chunk's systems,
  including local input and explicit transfers. `wake.events` wakes for queued
  event inputs. Both default to true. Signals emitted during a tick can wake
  their sleeping recipient from the next tick. `wake.spatial` opts into wakeups
  from declared spatial dependencies written outside the chunk. Dormant readers retain coalesced
  invalidations until their next step.
- `wake.level` selects the active tier for the wake and `holdTicks` leases
  it for a bounded number of ticks. Defaults are the nearest tier and one
  tick. An already higher-detail observer remains higher detail.
- Commands and account transfers can edit durable state while a chunk is
  pinned asleep. Automatic transfer producers run on their due update.
  The existing event buffer budget applies to suspended messages.

`world/chunks` reports entries, pins, focus and clocks. Select a chunk with
`{ "chunk": "valley" }` or report one clock with `{ "system": "ford" }`.
Changes emit `simulation-chunk-level` events. `sim run --profile` reports
solver call counts, and the run's summary lists each chunk's current level.

The [persistent valley](../examples/world-persistent-valley.json) keeps a
moving cart, a reed biomass stock, and deposited sediment. The valley
steps at full and coarse rates, sleeps while the observer visits a lookout,
and resumes on return.

```sh
ink-studio sim run examples/world-persistent-valley.json --ticks 24 --checkpoint valley.checkpoint.json --profile
ink-studio probe valley.checkpoint.json --field world/chunks --args '{"chunk":"valley"}'
ink-studio sim resume valley.checkpoint.json --ticks 41 --record valley.run.json
ink-studio sim replay valley.run.json
node scripts/benchmark-simulation-chunks.js
```
