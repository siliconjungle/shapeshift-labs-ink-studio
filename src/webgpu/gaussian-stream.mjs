import { captureStreamingCamera } from '../webgl/view.mjs';
import { decodeGaussianChunkPayload, gaussianRecordBytes, gaussianRecordFloats, inspectGaussianChunkManifest } from '../gaussian-chunks.mjs';
import { gaussianChunkBytes } from './gaussian-renderer.mjs';

async function readPayload(response, size, signal) {
  signal.throwIfAborted();
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Gaussian chunk response has no binary body');
  const cancel = () => reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  let offset = 0;
  try {
    const data = new Uint8Array(size);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > data.length) throw new RangeError('Gaussian chunk exceeds its byte reservation');
      data.set(value, offset);
      offset += value.byteLength;
    }
    signal.throwIfAborted();
    if (offset !== data.length) throw new RangeError('Gaussian chunk response ended before the reserved byte count');
    return data;
  } finally {
    signal.removeEventListener('abort', cancel);
    await cancel();
    reader.releaseLock();
  }
}

export function createGaussianChunkStream(renderer, toolkit, manifest, {
  url, fetch: fetchFile = globalThis.fetch, budgetBytes, maxSplats, layers,
  projectedError = {}, guardPixels = 12, startsPerFrame, concurrency, uploadBytesPerFrame, decodedCacheBytes = 0
} = {}) {
  const kit = toolkit?.KIT ?? toolkit;
  const createSceneStream = kit?.procedural?.chunks?.createSceneStream ?? toolkit?.procedural?.chunks?.createSceneStream;
  if (!createSceneStream || typeof fetchFile !== 'function' || !renderer?.uploadChunk)
    throw new TypeError('Gaussian streaming needs the Ink toolkit, WebGPU renderer, and a fetch callback');
  if (!Number.isSafeInteger(maxSplats) || maxSplats < 1 || maxSplats > renderer.maxSplats)
    throw new RangeError('Gaussian stream splat budget exceeds the renderer limit or is invalid');
  if (!Number.isSafeInteger(decodedCacheBytes) || decodedCacheBytes < 0 ||
      uploadBytesPerFrame !== undefined && (!Number.isSafeInteger(uploadBytesPerFrame) || uploadBytesPerFrame < 1))
    throw new RangeError('Gaussian streaming needs valid decoded cache and per-frame upload byte budgets');
  const base = new URL('.', url);
  const footprintAPI = kit?.splatFootprints ?? toolkit?.splatFootprints;
  const bakeCache = kit?.authoring?.bakeCache ?? toolkit?.authoring?.bakeCache;
  if (decodedCacheBytes && !bakeCache) throw new TypeError('Decoded chunk caching needs the Ink Studio bake cache');
  const cache = decodedCacheBytes ? bakeCache.create({ maxBytes: decodedCacheBytes }) : undefined;
  const waiting = new Set();
  let uploadScheduled = false;
  let rows, cameraWorld, atlas, atlasKey, orders = new Map(), nextOrder = 0, disposed = false;
  let uploads = { bytes: 0, cpuMs: 0, chunks: 0 }, loads = 0, evictions = 0;
  let payloadBytes = 0, decodeCpuMs = 0;

  function updateManifest(next) {
    if (disposed) throw new Error('Gaussian stream is disposed');
    inspectGaussianChunkManifest(next);
    const styles = next.footprints ?? [];
    const key = JSON.stringify(styles);
    const slots = styles.map(Boolean);
    const currentOrders = new Map();
    let orderCursor = nextOrder;
    const currentRows = next.chunks.map(chunk => {
      const order = orders.get(chunk.id) ?? orderCursor++;
      currentOrders.set(chunk.id, order);
      return {
        ...chunk,
        levels: chunk.levels.filter(level => level.splats <= maxSplats).map(level => {
          const encoding = level.encoding ?? 'raw', size = level.payloadBytes ?? level.splats * gaussianRecordBytes;
          return {
            ...level,
            revision: JSON.stringify([level.revision, level.file, size, chunk.footprints ? (chunk.footprintRevision ?? key) : null]),
            bytes: gaussianChunkBytes(level.splats),
            input: { url: new URL(level.file, base), order, slots: chunk.footprints ? slots : undefined, encoding, size }
          };
        })
      };
    }).filter(row => row.levels.length);
    if (key !== atlasKey) {
      const currentAtlas = slots.some(Boolean) ? renderer.createFootprintAtlas(styles, footprintAPI) : undefined;
      atlas?.dispose();
      atlas = currentAtlas;
      atlasKey = key;
    }
    orders = currentOrders;
    nextOrder = orderCursor;
    rows = currentRows;
    cameraWorld = next.world;
  }

  function upload(input, data, fetchedBytes, decodeTime) {
    const handle = renderer.uploadChunk(data, { order: input.order, ...(input.slots && { footprints: true }) });
    uploads.bytes += handle.bytes;
    uploads.cpuMs += handle.cpuMs;
    uploads.chunks++;
    payloadBytes += fetchedBytes;
    decodeCpuMs += decodeTime;
    loads++;
    return handle;
  }

  function queueUpload(bytes, publish, signal) {
    if (uploadBytesPerFrame === undefined) return publish();
    return new Promise((resolve, reject) => {
      const abort = () => {
        waiting.delete(job);
        reject(signal.reason);
      };
      const job = { bytes, flush() {
        signal.removeEventListener('abort', abort);
        try { resolve(publish()); }
        catch (error) { reject(error); }
      } };
      signal.addEventListener('abort', abort, { once: true });
      waiting.add(job);
    });
  }

  function scheduleUploads() {
    if (!waiting.size || uploadScheduled) return;
    uploadScheduled = true;
    // Let the residency scheduler withdraw stale loads after this frame's
    // camera update before any queued upload writes to the GPU.
    queueMicrotask(() => {
      uploadScheduled = false;
      if (disposed) return;
      let used = 0;
      for (const job of waiting) {
        if (used && job.bytes > uploadBytesPerFrame - used) break;
        waiting.delete(job);
        job.flush();
        used += job.bytes;
      }
    });
  }

  const planner = createSceneStream({
    budgetBytes, maxSplats, projectedError, layers, guardPixels, startsPerFrame, concurrency, maxPortals: 0,
    maxCandidates: 65536,
    query: () => rows,
    async load({ input, splats, revision }, { signal }) {
      const key = cache && JSON.stringify([input.url.href, revision, splats, input.encoding]);
      let data = cache?.read('gaussianChunk', key);
      let fetchedBytes = 0, decodeTime = 0;
      if (!data) {
        const response = await fetchFile(input.url, { signal });
        if (!response.ok) throw new Error('Gaussian chunk request failed with HTTP ' + response.status);
        const payload = await readPayload(response, input.size, signal);
        signal.throwIfAborted();
        const decodeStart = performance.now();
        data = decodeGaussianChunkPayload(payload, splats, input.encoding);
        decodeTime = performance.now() - decodeStart;
        fetchedBytes = payload.byteLength;
        if (input.slots) for (let i = 0; i < data.length; i += gaussianRecordFloats) {
          const slot = data[i + 11];
          if (slot !== 0 && (!input.slots[slot - 1] || !Number.isFinite(data[i + 12]) || data[i + 12] <= 0))
            throw new TypeError('Gaussian chunk references an invalid footprint profile');
        }
        cache?.write('gaussianChunk', key, data);
      }
      signal.throwIfAborted();
      return queueUpload(gaussianChunkBytes(splats), () => upload(input, data, fetchedBytes, decodeTime), signal);
    },
    sizeOf: handle => handle.bytes,
    splatsOf: handle => handle.count,
    release(handle) {
      handle.dispose();
      evictions++;
    }
  });

  try {
    updateManifest(manifest);
  } catch (error) {
    planner.dispose();
    throw error;
  }

  function render(target, { selected, ...frame } = {}) {
    const viewTarget = frame.nativeColor ?? target;
    const { snapshot, camera } = captureStreamingCamera(cameraWorld, frame, viewTarget.width, viewTarget.height);
    const scene = planner.advance({ place: 'cloud', camera, selected });
    scheduleUploads();
    const entries = scene.views[0].entries;
    const next = renderer.renderChunks(target, cameraWorld, entries.map(row => row.value),
      { ...frame, cameraSnapshot: snapshot, ...(atlas && { footprintAtlas: atlas }) }, uploads);
    uploads = { bytes: 0, cpuMs: 0, chunks: 0 };
    const failures = planner.failures();
    const stream = { ...planner.stats(), loads, evictions, ...scene.budget, failures, payloadBytes, decodeCpuMs,
      ...(cache && { decodedCache: cache.stats() }),
      ...(uploadBytesPerFrame !== undefined && { uploadBytesPerFrame, queuedUploads: waiting.size }),
      ...(atlas && { footprintBytes: atlas.bytes }),
      pending: Math.max(0, scene.budget.admitted - scene.budget.ready - failures.length),
      chunks: entries.map(({ chunk, layer, level, fallback, errorPx }) => ({ chunk, layer, level, fallback, errorPx })) };
    payloadBytes = decodeCpuMs = 0;
    return frame.profile ? next.then(draw => ({ ...draw, stream })) : { ...next, stream };
  }
  return Object.freeze({ render, updateManifest, snapshot: planner.snapshot, stats: planner.stats, retry: planner.retry,
    ready: planner.ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      planner.dispose();
      cache?.clear();
      atlas?.dispose();
    }
  });
}
