# Deterministic simulation workers

The same fixed-tick world can run in process, on Node worker threads,
or with [browser workers](#browser-integration). Each solver uses its
manifest schedule. Set `schedule.every` to run once per specified
number of world ticks, or `schedule.substeps` to divide each world tick
into faster solver updates. A slower call receives the elapsed time
since its previous update.

Use `--workers N` to step eligible systems on 1–32 Node worker threads.
The count is a run option. The world manifest, checkpoint, and recording
can be used with any count or with the default in-process runner.

```sh
ink-studio sim run examples/world-worker-estate.js --ticks 28 --workers 1 --checkpoint one.json
ink-studio sim run examples/world-worker-estate.js --ticks 28 --workers 8 --checkpoint eight.json --record estate.run.json
ink-studio sim diff one.json eight.json
ink-studio sim replay estate.run.json --workers 1
```

The example has eight pond chunks, a same-phase pump signal, delayed and
averaged controls, and a conservative exchange from one pond to the next.
It includes substeps, slow updates, and a sleep and wake cycle.
The run summary reports the requested workers, the peak active worker
count, worker batches, and completed worker steps by system.

## Partition boundaries

A worker job advances one eligible system from the current phase
snapshot. Chunk ownership and residency determine which jobs are due.
Independent systems within a chunk can also run in parallel.
Settled resource transfers and typed signal inputs form the cross-system
exchange. The runner waits for same-phase combinational signals before
dispatching their consumers. Delayed, sampled, and buffered inputs keep
their existing meanings.

[System contracts](headless-worlds.md#compose-system-contracts) can also
declare an `after` dependency. Dispatch waits for its source when both
systems are due in the phase. Solvers with named peer state reads run on
the host.

Commands, transfer planning and settlement, query-dependent steps,
output publication, and scenario evaluation run on the host. The host
applies returned states, events, and spatial invalidations in the same
order as the in-process runner. Worker completion order has no effect on
checkpoint contents or event IDs. A failed job leaves the tick,
checkpoint, and pending commands at their previous committed values.

Bundled jobs include shallow water with local forcing, pipes, enclosed
water with signal-controlled doors, ventilation with local inputs, and
logistics with local routes. A solver step that directly queries other
systems stays on the host. For example, water using a live obstacle
field or logistics tracing a route continue to use the host query context.
Worker messages copy the owned state, so small jobs and worlds with few
independent solvers can be faster in process.

## Node integration

```js
const studio = require('@shapeshift-labs/ink-studio');
const { KIT } = studio.load();
const workerPool = studio.createSimulationWorkers(8);
try {
  const run = KIT.world.runtime.create(manifest, { workerPool });
  run.advance(120);
  console.log(run.partitions());
} finally {
  workerPool.close();
}
```

A Node host can pass `{ modules: [filePath] }` as the second argument to
`createSimulationWorkers`. Each CommonJS module exports a table from
system kind to factory. The host and the workers load the same factories.
Module paths come from the application calling this API.

A factory opts a provider into worker execution with `partitionStep: true`.
Its `step` is deterministic from the provided state, `ctx.input`, clock
and LOD values, and `ctx.random(key)`. Keep durable data in the returned
state. A step can use `ctx.emit` and declared spatial write or rebuild
methods. Express dependencies as input ports and account exchanges.
Actions, queries, and outputs still use the normal provider hooks.
Application factories passed as host-only implementations continue to
run in process.

```sh
node scripts/benchmark-simulation-workers.js
```

## Browser integration

Generate a browser module bundle with the Node package and serve it
over HTTP alongside the application. Keep the worker entry and its
module imports available at their package URLs.

```js
const fs = require('node:fs');
const studio = require('@shapeshift-labs/ink-studio');
fs.writeFileSync('ink-studio.mjs', studio.bundle({ format: 'module' }));
```

Import `createBrowserSimulationWorkers` from `webgl.mjs`. Provide the
generated bundle URL and any application solver modules as URLs.
Each application module default-exports its system factory table.
The browser host and every worker load the same modules. Factories
use the same `partitionStep: true` contract as Node.

```js
import { KIT } from './ink-studio.mjs';
import { createBrowserSimulationWorkers } from './webgl.mjs';

const workerPool = await createBrowserSimulationWorkers(4, {
  bundle: new URL('./ink-studio.mjs', import.meta.url),
  modules: [new URL('./solvers.mjs', import.meta.url)]
});
const run = KIT.world.runtime.create(manifest, { workerPool });
await run.advanceAsync(120);
workerPool.close();
```

`stepAsync()` and `advanceAsync(tick, options)` use the same phase order
and publish each tick after its workers finish. The renderer can read
`run.view()` or `run.query()` while it waits. A run accepts one active
advance at a time. Schedule commands for ticks beyond the one currently
being computed. `advanceAsync` supports `stopOnOutcome` and an optional
`onTick(view, query)` callback after each commit.

Use `KIT.world.runtime.replayAsync(recording, { workerPool })` to replay
with browser workers. Checkpoints, recordings and the `partitions()`
report use the same formats as Node. A pool can be shared across runs.
Close it when done to terminate its workers and reject outstanding work.
A worker fault leaves the last committed world readable.
