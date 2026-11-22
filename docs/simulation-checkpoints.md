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

[Shared beat inspection links](inspection-links.md) can point to a causal trace or a still rendered at the beat’s recorded tick.

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

The store also accepts `ink-studio/raster-checkpoint` documents from the
[headless raster simulation graph](headless-authoring.md#animation-and-raster-simulation).
Pass the loaded document to `KIT.procedural.rasterSimulation.session` to
resume the recipe. The graph CLI can also load its standalone JSON as
a named asset and pass it to `sim.run`.

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

For sample-rate kernels, see [fast state checkpoints and take transport](simulation-fast-checkpoints.md).
The world and its nested kernel states save together, including pending signal events.

## Committed event envelopes

`run.committedEvents()` returns the envelopes for the last committed tick. Query `world/events` for the same envelopes and add `retained: true` to include history with the latest batch. Filter by `kind`, `branch`, qualified `story`, or a `subject` ID. The latest batch is available with history disabled.

```sh
ink-studio sim fork decision.json --branch night --ticks 36 --record night.run.json
ink-studio story events night.run.json --format envelopes --out night.events.json
ink-studio probe night.run.json --field world/events --args '{"retained":true,"branch":"night"}'
```

| Envelope field | Meaning |
| --- | --- |
| `id`, `tick`, `world`, `branch` | The local `tick.sequence` ID, absolute commit tick, manifest ID, and branch ID. Use `world`, `branch`, and `id` together when comparing events across branches. |
| `kind`, `system`, `payload` | The event kind, emitting system, and event-specific fields. |
| `story`, `stage`, `visit` | The qualified story ID, stage ID, and visit number when present. Unavailable fields are null. |
| `subjects` | Typed references with `role`, `kind`, and `id`. The envelope carries authored subject references, typed fact subjects, known native references, and transfer accounts. |
| `causes` | Links to earlier `event` IDs, the originating `command` at its tick and index, and `trace` nodes when native causality is enabled. Story evidence and routed actions carry event links even with history disabled. A linked record may have aged out of retention. |

Named branches start emitting under their new ID on the next committed tick. Inherited events and links keep the branch that emitted them. Use `run.fork({ branch: "night" })` or the CLI `--branch` option to name a fork. An unnamed runtime fork inherits the current branch for replay and rollback. Branch sessions and story fork comparisons use their authored branch IDs.

The existing event rows keep their flat payload fields for filters, bindings, and receipts. They persist envelope metadata in `eventContext` so a checkpoint stores the payload once. Older runs and fixtures retain their original replay behavior. When read as envelopes, older rows use the same field layout with available payload information. A legacy checkpoint resumed into a new run starts producing committed metadata.

```sh
node examples/committed-events/demo.cjs ./studio/out/committed-events
```

The demo exports sibling branches with the same local event ID and a shared parent cause. A quay fixture shows the story stage and the event that triggered it.

## Portable test fixtures

`sim fixture` packages a simulation interval as one versioned JSON file. It includes the native checkpoint and its embedded scene, queued commands, later submissions at their original ticks, the committed event trace, and a checksum for the final checkpoint. The CLI verifies the fixture after serialization before writing it. Block-backed sources produce standalone fixtures. Reviewers need the same Ink runtime and any registered custom systems or kernels used by the scene.

```sh
ink-studio sim fixture original.run.json --from 20 --ticks 36 --out review.fixture.json
ink-studio sim verify review.fixture.json
ink-studio sim replay review.fixture.json --checkpoint ending.json --record replay.run.json
ink-studio story events review.fixture.json --format markdown
```

`--from` is the starting committed tick. It defaults to the source's starting tick. `--ticks` is the absolute last tick to attempt and defaults to the ending tick for a run recording. With a world or checkpoint source, you can supply `--actions` to queue commands before advancing. A source recording keeps its original submissions, including the order between event-routed commands and user submissions at the same boundary. The trace starts after the checkpoint and includes every committed event in the interval, even with world history disabled. Capture and source recording verification can advance up to 100,000 ticks from the source start. The trace can hold up to 100,000 events.

Use `--event KIND` to stop on the first matching committed tick. An optional `--event-where` query condition narrows the match to a particular story, failure reason, or other event detail. Use `--fault` to package the first thrown simulation error and verify its tick, class, message, and last successful checkpoint.

```sh
ink-studio sim fixture examples/story-documents/quay-candidates.world.json \
  --actions examples/story-documents/quay-candidates.actions.json \
  --from 1 --ticks 6 --event story-candidate-rejected \
  --event-where '{"path":"/reason","value":"candidate-blocked"}' \
  --minimize --out quay.fixture.json
```

`--minimize` requires an event or fault. It attempts to remove groups of authored scene entries and commands, then individual entries within its trial budget. Each accepted removal must reproduce the full selected event or fault at the same tick. For checkpoint and run sources, minimization tries removing pending commands and later submissions while preserving the checkpoint's scene and state. Other results can change. The fixture records the reduced run's complete trace and ending checksum along with the number of trials and removals. For an exact interval review, omit `--minimize`.

`sim verify` exits with status 2 on divergence and reports the first event, fault, or checkpoint mismatch. `sim replay` can export the last verified checkpoint and a normal run recording. For timing and scheduler limits, use a separate [simulation performance budget](simulation-performance-budgets.md).

```sh
node examples/simulation-fixtures/demo.cjs ./studio/out/simulation-fixtures
```

The demo reproduces a blocked story dispatch, checks late command ordering from a block-backed recording, and captures a fault on an attempted metadata edit.

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
| `forecast(options, {branch})`, `forecastAsync(options, {branch})` | Preview pending commands from a branch head with [in-scene forecast overlays](simulation-forecasts.md). |
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
