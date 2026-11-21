/* Measure complete graph evaluations and isolate raster transfer overhead. */
const { Worker } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const { availableParallelism, cpus } = require('node:os');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const ink = require('..');

const rounds = 3;
const rounded = value => Math.round(value * 100) / 100;
const median = values => rounded(values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]);

function branchGraph(width, op, options) {
  const project = { format: 'ink-studio/graph-project', version: 1, nodes: {}, outputs: {} };
  for (const [name, color] of [['front', [79, 144, 210]], ['back', [222, 147, 61]]]) {
    project.nodes[name] = { op: 'raster.canvas', inputs: { width, height: width, color } };
    project.nodes[name + 'Blur'] = { op, inputs: { source: { node: name }, options,
      ...(op === 'fx.pathBlur' && { path: [[0, 0], [8.25, 17.4], [22.6, 29.2]] }) } };
    project.outputs[name] = { node: name + 'Blur' };
  }
  return project;
}

function graphTimings(spec, count) {
  const workerPool = ink.createGraphWorkers(count);
  const project = ink.createGraphProject(spec, { workerPool });
  const times = [], measurements = [];
  let hashes;
  try {
    for (let seed = 0; seed <= rounds; seed++) {
      const start = performance.now(), result = project.run({ seed });
      times.push(performance.now() - start);
      measurements.push(result.report.workers);
      hashes ??= Object.entries(result.outputs).map(([name, raster]) =>
        ({ name, sha256: createHash('sha256').update(raster.data).digest('hex') }));
    }
  } finally {
    project.clear();
    workerPool.close();
  }
  return { coldMs: rounded(times[0]), warmMedianMs: median(times.slice(1)),
    cold: measurements[0], warm: measurements.at(-1), hashes };
}

async function transferTimings() {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    parentPort.on('message', ({ data, transfer }) =>
      parentPort.postMessage(data, transfer ? [data.buffer] : []));
  `, { eval: true });
  function echo(data, transfer) {
    return new Promise((resolve, reject) => {
      const fail = error => reject(error);
      worker.once('error', fail);
      worker.once('message', result => {
        worker.off('error', fail);
        resolve(result);
      });
      worker.postMessage({ data, transfer });
    });
  }
  const samples = [];
  try {
    await echo(new Uint8Array(1), true);
    for (const bytes of [.25, 1, 4, 16].map(mib => mib * 1024 * 1024)) {
      const source = new Uint8Array(bytes).fill(61), row = { bytes };
      for (const transfer of [false, true]) {
        const times = [];
        for (let i = 0; i < 7; i++) {
          const start = performance.now(), result = await echo(source, transfer);
          times.push(performance.now() - start);
          assert.equal(result.at(-1), 61);
          assert.equal(source.byteLength, bytes);
        }
        row[transfer ? 'cloneInTransferOutMedianMs' : 'cloneBothWaysMedianMs'] = median(times);
      }
      samples.push(row);
    }
  } finally { await worker.terminate(); }
  return samples;
}

async function main() {
  const fixtures = [
    ...[128, 256, 384, 512].map(width => ({ width, op: 'fx.pathBlur', options: { samples: 25 } })),
    { width: 512, op: 'fx.kernelBlur', options: { radius: 16 } }
  ];
  const graphs = fixtures.map(fixture => {
    const spec = branchGraph(fixture.width, fixture.op, fixture.options);
    const serial = graphTimings(spec, 1), workers = graphTimings(spec, 2);
    assert.deepEqual(workers.hashes, serial.hashes);
    return { ...fixture, serial, workers };
  });
  const report = { node: process.version, platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model, availableThreads: availableParallelism?.() ?? cpus().length,
    warmEvaluations: rounds, graphs, rasterRoundTrips: await transferTimings() };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
