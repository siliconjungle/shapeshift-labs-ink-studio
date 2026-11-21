const { workerData } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');

const { bundle, port, ready } = workerData;
let operations;
port.on('message', ({ op, inputs, context }) => {
  try {
    operations ??= require(bundle).KIT.procedural.graph.operations;
    const start = performance.now(), outputs = operations[op].run(inputs, context);
    const computeMs = performance.now() - start;
    const buffers = new Set();
    function collect(value) {
      if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
      else if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item);
    }
    collect(outputs);
    const transfer = [...buffers], outputBytes = transfer.reduce((size, buffer) => size + buffer.byteLength, 0);
    port.postMessage({ outputs, computeMs, outputBytes }, transfer);
  } catch (error) {
    port.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    Atomics.store(ready, 0, 1);
    Atomics.notify(ready, 0);
  }
});
