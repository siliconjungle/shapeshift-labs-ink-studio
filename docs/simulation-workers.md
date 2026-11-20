# Deterministic simulation workers

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
run in process. The browser runtime retains its synchronous in-process API.

```sh
node scripts/benchmark-simulation-workers.js
```
