/* Native evaluation of independent, pure graph kernels. The coordinator owns graph values. */
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Worker, MessageChannel, receiveMessageOnPort } = require('node:worker_threads');

const maxBytes = 16 * 1024 * 1024;
const localOps = new Set(['raster.canvas', 'raster.channel', 'raster.crop', 'raster.resize', 'raster.compose', 'raster.stack']);

function pathWork({ source, path, options }) {
  const points = Array.isArray(path) ? path : path?.points;
  const { samples = 13, filter = 'linear' } = options;
  if (!Number.isInteger(samples) || samples < 2 || samples > 128 || points.length > 4096 ||
      !points.some(point => point[0] !== points[0][0] || point[1] !== points[0][1])) return 0;
  return source.width * source.height * samples * (filter === 'linear' ? 4 : 1);
}

function kernelWork({ source, options }) {
  const { radius = 2, kernel } = options;
  let taps = 0;
  if (kernel !== undefined) {
    if (!Array.isArray(kernel) || kernel.length > 31) return 0;
    for (const row of kernel) {
      if (!Array.isArray(row) || row.length > 31) return 0;
      for (const weight of row) if (weight > 0) taps++;
    }
  } else if (Number.isInteger(radius) && radius > 0 && radius <= 64) taps = 2 * (2 * radius + 1);
  return source.width * source.height * taps;
}

const work = { 'fx.pathBlur': pathWork, 'fx.kernelBlur': kernelWork };

function payloadBytes(value) {
  const seen = new Set(), buffers = new Set();
  let bytes = 0;
  function visit(value, depth) {
    if (bytes > maxBytes || depth > 32) return false;
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') bytes += 8;
    else if (typeof value === 'string') bytes += Buffer.byteLength(value);
    else if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) {
      if (!buffers.has(value.buffer)) bytes += value.buffer.byteLength;
      buffers.add(value.buffer);
    } else if (Array.isArray(value) || value && [null, Object.prototype].includes(Object.getPrototypeOf(value))) {
      if (seen.has(value)) return true;
      if (Array.isArray(value) && value.length > (maxBytes - bytes) / 8) return false;
      seen.add(value);
      bytes += 16;
      for (const key of Object.keys(value)) {
        if (!Array.isArray(value)) bytes += Buffer.byteLength(key);
        const entry = Object.getOwnPropertyDescriptor(value, key);
        if (!entry || !Object.hasOwn(entry, 'value') || !visit(entry.value, depth + 1)) return false;
      }
    } else return false;
    return bytes <= maxBytes;
  }
  return visit(value, 0) ? bytes : undefined;
}

function createGraphWorkers(limit, { kit = require('../index.js').load(), timeoutMs = 60000 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new RangeError('Graph worker count must be 1–8');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw new RangeError('Graph worker timeout must be 1–60000 ms');
  const studio = require('../index.js'), bundle = limit > 1 ? studio.nodeBundlePath() : undefined;
  const enabled = Boolean(bundle && require(bundle) === kit), lanes = [];
  let closed = false, metrics;
  function resetStats() {
    metrics = { startedThreads: 0, jobs: 0, peakConcurrent: 0, inputBytesCopied: 0, outputBytesTransferred: 0,
      postMs: 0, waitMs: 0, computeMs: 0, fallbacks: 0 };
  }
  resetStats();
  function stats() {
    return { limit, threads: lanes.length, ...metrics,
      ...(bundle && !enabled && { unavailable: 'custom-toolkit' }) };
  }

  function open() {
    const { port1: port, port2: remote } = new MessageChannel();
    const ready = new Int32Array(new SharedArrayBuffer(4));
    let thread;
    try {
      thread = new Worker(path.join(__dirname, 'graph-worker-thread.js'), {
        workerData: { bundle, port: remote, ready }, transferList: [remote]
      });
    } catch (error) {
      port.close();
      remote.close();
      throw error;
    }
    thread.on('error', () => {});
    thread.unref();
    port.unref();
    const lane = { thread, port, ready };
    lanes.push(lane);
    metrics.startedThreads++;
    return lane;
  }

  function stop() {
    for (const { thread, port } of lanes) {
      port.close();
      thread.terminate().catch(() => {});
    }
    lanes.length = 0;
  }

  function runWave(rows, complete) {
    if (closed) throw new Error('Graph worker pool is closed');
    const cold = lanes.length < 2, candidates = [];
    for (const row of rows) {
      const estimate = row.config.stock && work[row.config.op];
      if (row.reused || !estimate || !(estimate(row.inputs) >= (cold ? 12e6 : 5e6))) continue;
      const bytes = payloadBytes(row.inputs);
      if (bytes !== undefined) candidates.push({ row, bytes });
    }
    if (candidates.length < 2) {
      for (const row of rows) complete(row);
      return;
    }

    const pending = new Map(), workers = Math.min(limit, candidates.length);
    let cursor = 0;
    function start(lane) {
      if (cursor === candidates.length) return;
      const { row, bytes } = candidates[cursor++];
      const { config: { op }, inputs, context: { time, seed, node } } = row;
      Atomics.store(lane.ready, 0, 0);
      const start = performance.now();
      lane.port.postMessage({ op, inputs, context: { time, seed, node } });
      metrics.postMs += performance.now() - start;
      metrics.jobs++;
      metrics.inputBytesCopied += bytes;
      pending.set(row, { lane, deadline: start + timeoutMs });
      metrics.peakConcurrent = Math.max(metrics.peakConcurrent, pending.size);
    }

    for (let i = 0; i < workers; i++) start(lanes[i] ?? open());
    for (const row of rows) {
      const task = pending.get(row);
      if (!task) { complete(row); continue; }
      const { lane, deadline } = task, now = performance.now();
      const waited = Atomics.wait(lane.ready, 0, 0, Math.max(0, deadline - now));
      metrics.waitMs += performance.now() - now;
      if (waited === 'timed-out') throw new Error('Graph worker timed out');
      const reply = receiveMessageOnPort(lane.port)?.message;
      if (reply?.error !== undefined || !reply?.outputs) throw new Error(reply?.error ?? 'Invalid graph worker reply');
      metrics.computeMs += reply.computeMs;
      metrics.outputBytesTransferred += reply.outputBytes;
      pending.delete(row);
      start(lane);
      complete(row, reply.outputs);
    }
  }

  return Object.freeze({ get enabled() { return enabled && !closed; }, matches: other => kit === other,
    permits: row => row.local || row.stock && (localOps.has(row.op) || Object.hasOwn(work, row.op)),
    runWave, resetStats, stats,
    cancel() { metrics.fallbacks++; stop(); },
    close() { closed = true; stop(); } });
}

module.exports = { createGraphWorkers };
