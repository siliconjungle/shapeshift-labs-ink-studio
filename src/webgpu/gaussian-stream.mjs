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
  projectedError = {}, guardPixels = 12, startsPerFrame, concurrency
} = {}) {
  const createSceneStream = toolkit?.KIT?.procedural?.chunks?.createSceneStream ?? toolkit?.procedural?.chunks?.createSceneStream;
  if (!createSceneStream || typeof fetchFile !== 'function' || !renderer?.uploadChunk)
    throw new TypeError('Gaussian streaming needs the Ink toolkit, WebGPU renderer, and a fetch callback');
  if (!Number.isSafeInteger(maxSplats) || maxSplats < 1 || maxSplats > renderer.maxSplats)
    throw new RangeError('Gaussian stream splat budget exceeds the renderer limit or is invalid');
  const base = new URL('.', url);
  const footprintAPI = toolkit?.KIT?.splatFootprints ?? toolkit?.splatFootprints;
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

  const planner = createSceneStream({
    budgetBytes, maxSplats, projectedError, layers, guardPixels, startsPerFrame, concurrency, maxPortals: 0,
    maxCandidates: 65536,
    query: () => rows,
    async load({ input, splats }, { signal }) {
      const response = await fetchFile(input.url, { signal });
      if (!response.ok) throw new Error('Gaussian chunk request failed with HTTP ' + response.status);
      const payload = await readPayload(response, input.size, signal);
      signal.throwIfAborted();
      const decodeStart = performance.now();
      const data = decodeGaussianChunkPayload(payload, splats, input.encoding);
      const decodeTime = performance.now() - decodeStart;
      if (input.slots) for (let i = 0; i < data.length; i += gaussianRecordFloats) {
        const slot = data[i + 11];
        if (slot !== 0 && (!input.slots[slot - 1] || !Number.isFinite(data[i + 12]) || data[i + 12] <= 0))
          throw new TypeError('Gaussian chunk references an invalid footprint profile');
      }
      const handle = renderer.uploadChunk(data, { order: input.order, ...(input.slots && { footprints: true }) });
      uploads.bytes += handle.bytes;
      uploads.cpuMs += handle.cpuMs;
      uploads.chunks++;
      payloadBytes += payload.byteLength;
      decodeCpuMs += decodeTime;
      loads++;
      return handle;
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
    const entries = scene.views[0].entries;
    const next = renderer.renderChunks(target, cameraWorld, entries.map(row => row.value),
      { ...frame, cameraSnapshot: snapshot, ...(atlas && { footprintAtlas: atlas }) }, uploads);
    uploads = { bytes: 0, cpuMs: 0, chunks: 0 };
    const failures = planner.failures();
    const stream = { ...planner.stats(), loads, evictions, ...scene.budget, failures, payloadBytes, decodeCpuMs,
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
      atlas?.dispose();
    }
  });
}
