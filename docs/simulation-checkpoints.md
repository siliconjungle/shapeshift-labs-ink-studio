# Shared simulation checkpoints

`run.checkpoint()` returns the run's immutable snapshot. Repeated reads
at the same revision reuse it. `run.fork()` and `run.reset()` reuse
unchanged state and world data while keeping independent command queues and
solver instances. A saved snapshot stays readable after a branch advances.
Plain shallow-water steps reuse the terrain array until it is edited.
Sediment and thermal transport can replace it.

[Simulation scrubbing and takes](simulation-scrubbing.md) uses these snapshots for backward and forward seeks and recording editable motion.

[Interactive checkpoint branching](#interactive-checkpoint-branching) keeps
multiple named outcomes and their starting points in one session.

The default checkpoint and recording are still standalone version 1 JSON.
For experiments with several saved runs, use a shared block directory.

```sh
ink-studio sim run examples/world-checkpoint-branch.js --ticks 0 --checkpoint start.json --checkpoint-store ./blocks
printf '%s\n' '[{"tick":1,"action":"canal/gate","args":{"gate":"sluice","opening":1}}]' > open.json
ink-studio sim fork start.json --ticks 4 --checkpoint closed.json
ink-studio sim fork start.json --ticks 4 --actions open.json --checkpoint opened.json --record opened.run.json
ink-studio probe opened.json --field canal/depth --at 28.13,0,5
ink-studio sim replay opened.run.json --checkpoint portable.json --checkpoint-store off
```

A checkpoint reference records a root checksum and a path from the
reference file to its store. The same directory is reused for branch and
replay output. Use `--checkpoint-store DIR` to write to another directory or
`--checkpoint-store off` to export standalone JSON.
The CLI summary reports newly written and reused block counts and bytes.

Numeric arrays of at least 1,024 samples are saved in 1,024-value pages
using little-endian float64. Large keyed tables use stable buckets, with
authored key order stored separately. A row edit reuses the other
buckets. Recordings reuse the start and end checkpoint roots. SHA-256
identifies each block. Readers verify the checksum and
report missing blocks. Writers publish each complete block before its
reference. Keep the store with its references when moving an experiment.
The store is append-only.

Loading restores ordinary JavaScript arrays and records so existing
solvers, queries, replay, diff, and rendering can use the result. Large
fields are materialized when loaded. Identical fields and unchanged table
pages within a recording reuse immutable data.

## Node integration

```js
const studio = require('@shapeshift-labs/ink-studio');
const { KIT } = studio.load();
const store = studio.openCheckpointStore('./blocks');
const { reference } = store.save(run.checkpoint());
const snapshot = store.load(reference);
const branch = KIT.world.runtime.create(snapshot.world, { checkpoint: snapshot });
```

`save` also accepts a recording. `load` verifies the block representation.
The runtime validates the restored state against the world before advancing.

## Reproducible run records

`sim run`, `sim resume`, and `sim fork` retain execution evidence when
you pass `--record FILE`. Add `--observations PLAN.json` to sample named
query fields at scheduled ticks. The plan uses the same `ticks` and
`observations` as [scheduled observations](headless-worlds.md#scheduled-observations-and-parameter-sweeps).
Both standalone run JSON and block-backed recording references carry the
evidence.

| Recorded evidence | Contents |
| --- | --- |
| Scene | World ID, random seed, and the content fingerprint of each committed manifest revision with its tick and time. The checkpoints keep the full starting and ending manifests. |
| Submissions | The committed tick at which each batch of user commands was queued. Replay submits it at the same boundary to preserve ordering with event-routed commands. |
| Applied actions | The commands that ran at each tick and their order, including authored, timeline, and event-routed commands. Future commands remain in the ending checkpoint. |
| Simulation timing | Fixed timestep, tick and time range, system schedules, actual solver call counts and simulated durations, and a fingerprint of the ordered solver phases. |
| Observations | Sampled field values, statuses, units, and tick times. A run records the samples that fall within its captured tick range. |

`ink-studio sim verify RUN.json` replays the recording and reports the
first discrepancy in the evidence or ending checkpoint. It exits with
status 2 when replay diverges. Use `--workers N` to verify on Node
workers. `sim replay` also checks the evidence before returning a run.
Older records continue to verify against their ending checkpoint.

In JavaScript, pass `{ recordRun: true }` to `KIT.world.runtime.create`,
or pass the observation plan as `recordRun`. Save `run.recording()`.
Use `KIT.world.runtime.verify(log, options)` for a structured report
or `verifyAsync(log, options)` with browser workers. Custom systems use
the same implementation factories during capture and verification.

## Interactive checkpoint branching

`KIT.world.branches.create(source, options)` accepts a world manifest,
checkpoint, recording, live runtime, or saved branch session. A live
runtime is forked at its current tick. A recording opens at its verified
end and keeps the earlier commands. Pass custom implementations or a
worker pool as `options.runtime` when opening portable data.

| Session method | Behavior |
| --- | --- |
| `play()`, `pause()`, `update(seconds)` | Drive the active run using fixed ticks. While paused, elapsed time has no effect. `maxStepsPerFrame` limits catch-up work and defaults to 12. |
| `step()`, `advance(tick)` | Pause playback and commit one tick or advance to an absolute tick. |
| `mark(id, {branch})` | Retain a named checkpoint with the branch's current state and pending commands. |
| `fork(id, {mark, label})`, `fork(id, {from, label})` | Start from a mark, another branch's current head, or the active head by default. The new branch is selected and paused. |
| `select(id)` | Switch the active branch and pause playback. Other branches keep their own tick and command queue. |
| `queue({inputs, edits, actions}, {branch, tick})` | Queue typed input changes, live entity or metadata patches, and system actions as one validated batch. The default boundary is the selected branch's next tick. |
| `view(id)`, `query(id)`, `checkpoint(id)`, `recording(id)` | Read any branch without switching or advancing it. Omitting the ID reads the active branch. |
| `diff(left, right)` | Compare two branch heads at the same tick. |
| `status()`, `subscribe(callback)` | Read current playback state, branch lineage, ticks, pending command counts, and available marks. |
| `save()` | Export the whole session as portable JSON. Reopen it with `KIT.world.branches.create(saved)`. Playback opens paused. |

Input edits use the world's existing unconnected typed ports. For other
live changes, use a system action or the existing entity and metadata
patch operations. Save or export a branch's regular checkpoint or run
recording to use it with the existing CLI, checkpoint store, and scrub
session.

### Optional browser controls

`mountSimulationBranches(host, {session, inputs, actions})` is exported
from `webgl.mjs`. Configure the exposed inputs with
`{port, label, min, max, step}` and action buttons with
`{action, args, label}`. The host's light DOM is assigned to the preview
slot, so any canvas, comparison view, or custom readout can sit alongside
the controls. The mount uses its own animation-frame clock by default.
Set `clock: false` to drive `session.update(seconds)` from your app.

`labels` overrides the control copy. Use `controls` to hide groups,
`--ink-branch-*` custom properties and CSS parts to theme them, or set
`defaultStyles: false` and supply a `stylesheet`. The mount returns
`destroy()` to remove the controls and release its clock.

```sh
node scripts/benchmark-shared-checkpoints.js
```
