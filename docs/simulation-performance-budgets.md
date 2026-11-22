# Measured simulation performance budgets

`sim budget` runs a named set of world-step and block-playback cases. It writes wall-clock timing distributions alongside scheduler bounds, prepared work and memory, queue usage, and missed deadlines.

```sh
ink-studio sim budget plan.json --out report.json --require-budget
```

```json
{
  "format": "ink-studio/simulation-performance-plan",
  "version": 1,
  "id": "playback-budget",
  "cases": {
    "host": {
      "mode": "world", "source": "scene.world.json", "steps": 90,
      "limits": { "maxMissedDeadlines": 0, "maxTypedStateBytes": 16000 }
    },
    "audio": {
      "mode": "blocks", "source": "vent.model.json", "path": "live",
      "samples": 4096, "requests": [64, 128, 192],
      "limits": { "maxWorkPerBlock": 1152, "maxPreparedBytes": 8192 },
      "detail": true
    }
  }
}
```

Source paths are relative to the plan. Pin kernel revisions in the source model and register creator kernels through the project's ordinary `ink-studio.config.js`. World cases use the in-process native runner. Block cases call the [block playback host](simulation-block-independence.md) with the repeating request pattern and trim the last request to the sample count. Select `path: "live"` for a prepared processor or `path: "offline"` for the ordinary block executor.

## Read timings and deadlines

- `steps` measures complete world steps. `requests` measures complete playback requests, including internal block splits and queue bookkeeping. `blocks` measures each internal block and its retention work. Prepared processor reports also include the processor's own elapsed times, excluding its outer host.
- Timing summaries include count, total, mean, p50, p95, p99, and maximum. The first invocation is measured after preparation. With `detail: true`, the first 4,096 operations retain their positions and timings. The summary and first-miss location cover all measured operations.
- The nominal release period is one world tick or a playback request's sample duration. The deadline defaults to that period. Use positive `deadlineMs` to set another completion allowance while keeping the same release cadence.
- `operationOverruns` counts operations whose measured duration alone exceeds the deadline. `missed` carries unfinished time into the next nominal release. A short operation can miss if it starts late. The report includes first miss and peak carried debt. This is a cadence replay of measured service times. Node runs the operations in order without sleeping.
- `native.kernels` retains processor-local deadline misses and faults. A native deadline miss records committed work, while a rejected request retains the previous committed state. Rejections remain separate from the simulated host deadline counter.

## Work, memory, and queues

World work lists [planned scheduled visits](simulation-execution-plan.md), declared units by system, and observed per-system calls. Timed split inputs expand the declared visit bound by their maximum segment count. Prepared processors publish their effective block size, base work at that size, hard work cap, and observed peak. Author-defined work units belong to their kernel. The top-level work gate is available when a world has one prepared processor, or when a block case uses a prepared processor.

Memory separates tracked prepared allocations, including rollback storage, from portable typed state and declared workspace or serialized payload sizes at the ending state. The tracked prepared allocation already includes its own typed state. The Node report also samples process-wide RSS, heap, external memory, and array buffers before and after the measured operations and every 64 operations. `sampledPeak` covers those observations.

In a world, queue depths are sampled at committed tick boundaries for scheduled commands, buffered inputs, delays, and model bridge inputs. Delayed queues report aggregate capacity across their slots. In block playback, event queues record actual committed high-water, attempted high-water, and overflow counts. Set `events.capacity` per port up to the native limit of 10,000. Set `events.drainEvery` to the number of playback requests between reads, with 1 as the default and 0 to hold events unread. Overflow rejects the block and reports its attempted range and retained cursor.

Available limits are `maxStepMs`, `maxRequestMs`, `maxBlockMs`, `maxMissedDeadlines`, `maxNativeMisses`, `maxPendingCommands`, `maxQueuedEvents`, `maxQueueOverflows`, `maxPreparedBytes`, `maxTypedStateBytes`, `maxWorkPerBlock`, and `maxRssBytes`. Limits require the selected mode to have the corresponding measurement. `--require-budget` writes the report, then exits with code 2 for a failed limit or an execution fault. This lets CI gate stable capacities separately from wall time measured on the target host.

## Long-running stories

Add `stories: {}` to a world case to measure native story work over up to 10,000 ticks. A world can reference linked story documents and templates as usual. The report samples before the first tick, every `sampleEvery` ticks (64 by default), and at the last committed tick. It retains up to 4,096 points and always includes the last one. High-water marks and deadline counts cover every committed tick.

```json
{
  "mode": "world",
  "source": "bounded.world.json",
  "steps": 3600,
  "stories": {
    "sampleEvery": 100,
    "baseline": "quiet.world.json",
    "systems": ["workshop"],
    "probes": {
      "completed-crates": {"field": "world/account", "args": {"account": "workshop/output"}, "select": "/balance"}
    }
  },
  "limits": {
    "maxPendingStoryCandidates": 2,
    "maxRetainedStoryRecords": 480,
    "maxRetainedHistoryEvents": 64,
    "maxStoryDeadlineMisses": 60,
    "maxCandidateExpirations": 60,
    "maxUnrelatedCallLoss": 0,
    "maxUnrelatedChangedProbes": 0
  }
}
```

| Report section | Measurements and limits |
| --- | --- |
| `stories.queues` | Initial and ending depth, high-water tick, and net growth for ready or blocked candidates, pending admissions, open offers, deferred commitments and handoffs, and pending cleanup. Gate the candidates with `maxPendingStoryCandidates` and the sum of the other queues with `maxPendingStoryRequests`. |
| `stories.retention` | Kept world events, lifecycle transitions, closed stage visits, candidate records, accepted handoffs, and trigger window entries. Dropped counters cover world events, transitions, and closed visits. Use `maxRetainedHistoryEvents` for world events and `maxRetainedStoryRecords` for the sum of the story counters. These are record counts. Host memory remains in the case's memory report. |
| `stories.evaluation` | Milliseconds per committed tick across story maintenance, live references, triggers, scheduler evaluation, lifecycle work, and cooldown publication. Includes phase totals, maximums, and call counts. The report collector and the paired run execute outside the primary step timer. Use `maxStoryEvaluationMs` for the worst tick and `detail: true` for individual timings. |
| `stories.deadlines.stories` | Authored world, offer, and work clock expirations, with counts by clock and first and last receipts. Use `maxStoryDeadlineMisses`. |
| `stories.deadlines.candidates` | Candidate expirations, with counts by reason and first and last occurrences. Use `maxCandidateExpirations`. Each deadline counter has its own scope. Host cadence misses appear in `steps.deadlines` and use `maxMissedDeadlines`. |
| `stories.unrelated` | Paired baseline timing, solver call and time differences, and output probe differences. Use `maxUnrelatedCallLoss` to cap the sum of call shortfalls across selected systems. Use `maxUnrelatedChangedProbes` to cap the number of probes that diverged in any sample. |

An optional baseline runs the same number of ticks alongside the measured world. Use a quiet world with the same seed, timestep, and configuration for each listed system. Keep the workload and inputs for those systems equivalent across the pair. For a probe, provide its query `field` and any `at` or `args` it requires. An optional `select` points into its value. `tolerance` allows a difference in numeric values. The comparison includes the initial and final samples and records the first difference. Use `sampleEvery: 1` to catch differences that disappear before the next scheduled sample. The changed-probe limit needs at least one observed value for each probe. Baseline execution faults fail the case.

```sh
node examples/simulation-performance-budgets/stories.cjs ./studio/out/story-budgets
```

The demo benchmarks 120 incidents over 3,600 ticks in two worlds. The bounded run keeps the candidate queue at a peak of two and completes all 120 workshop transfers. A second run diverts stock through a story settlement and completes 60 transfers. Both workshops still receive the same number of solver calls. The failed budget identifies the changed output and keeps its full report.

## Run benchmarks from JavaScript

The library entry is `KIT.world.performanceBudgets.run(plan, {resolve, now, memory})`. Pass a resolver that returns a loaded native world or model. The optional clock supplies monotonic milliseconds. The optional memory sampler returns byte counts.

## Simulation and audio demo

```sh
node examples/simulation-performance-budgets/demo.cjs ./studio/out/simulation-budgets
```

The demo profiles a 60 Hz world with a 48 kHz prepared vent, then replays the vent through variable audio requests. It also runs a deliberately tight deadline and shows what happens when a one-event playback queue is drained or left unread.

To replay an exported bench outside the checkout, run the CLI from its `bench` directory. Set `INK_STUDIO_BENCH_PACKAGE` to the Ink Studio checkout or installed package if its example kernels are elsewhere.
