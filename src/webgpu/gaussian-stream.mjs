import { captureStreamingCamera } from '../webgl/view.mjs';
import { gaussianChunkData, gaussianRecordBytes, inspectGaussianChunkManifest } from '../gaussian-chunks.mjs';
import { gaussianChunkBytes } from './gaussian-renderer.mjs';

async function readRecords(response, count) {
  const data = new Uint8Array(count * gaussianRecordBytes);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Gaussian chunk response has no binary body');
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > data.length) throw new RangeError('Gaussian chunk exceeds its byte reservation');
      data.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== data.length) throw new RangeError('Gaussian chunk response ended before the reserved byte count');
    return gaussianChunkData(data.buffer, count);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createGaussianChunkStream(renderer, toolkit, manifest, {
  url, fetch: fetchFile = globalThis.fetch, budgetBytes, maxSplats, layers,
  projectedError = {}, guardPixels = 12, startsPerFrame, concurrency
} = {}) {
  inspectGaussianChunkManifest(manifest);
  const createSceneStream = toolkit?.KIT?.procedural?.chunks?.createSceneStream ?? toolkit?.procedural?.chunks?.createSceneStream;
  if (!createSceneStream || typeof fetchFile !== 'function' || !renderer?.uploadChunk)
    throw new TypeError('Gaussian streaming needs the Ink toolkit, WebGPU renderer, and a fetch callback');
  if (!Number.isSafeInteger(maxSplats) || maxSplats < 1 || maxSplats > renderer.maxSplats)
    throw new RangeError('Gaussian stream splat budget exceeds the renderer limit or is invalid');
  const base = new URL('.', url), cameraWorld = manifest.world;
  let uploads = { bytes: 0, cpuMs: 0, chunks: 0 }, loads = 0, evictions = 0;
  const rows = manifest.chunks.map((chunk, order) => ({
    ...chunk,
    levels: chunk.levels.filter(level => level.splats <= maxSplats).map(level => ({
      ...level,
      bytes: gaussianChunkBytes(level.splats),
      input: { url: new URL(level.file, base), order }
    }))
  })).filter(row => row.levels.length);
  const planner = createSceneStream({
    budgetBytes, maxSplats, projectedError, layers, guardPixels, startsPerFrame, concurrency, maxPortals: 0,
    maxCandidates: Math.max(1, rows.length),
    query: () => rows,
    async load({ input, splats }, { signal }) {
      const response = await fetchFile(input.url, { signal });
      if (!response.ok) throw new Error('Gaussian chunk request failed with HTTP ' + response.status);
      const data = await readRecords(response, splats);
      signal.throwIfAborted();
      const handle = renderer.uploadChunk(data, { order: input.order });
      uploads.bytes += handle.bytes;
      uploads.cpuMs += handle.cpuMs;
      uploads.chunks++;
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

  function render(target, { selected, ...frame } = {}) {
    const { snapshot, camera } = captureStreamingCamera(cameraWorld, frame, target.width, target.height);
    const scene = planner.advance({ place: 'cloud', camera, selected });
    const entries = scene.views[0].entries;
    const next = renderer.renderChunks(target, cameraWorld, entries.map(row => row.value),
      { ...frame, cameraSnapshot: snapshot }, uploads);
    uploads = { bytes: 0, cpuMs: 0, chunks: 0 };
    const failures = planner.failures();
    const stream = { ...planner.stats(), loads, evictions, ...scene.budget, failures,
      pending: Math.max(0, scene.budget.admitted - scene.budget.ready - failures.length),
      chunks: entries.map(({ chunk, layer, level, fallback, errorPx }) => ({ chunk, layer, level, fallback, errorPx })) };
    return frame.profile ? next.then(draw => ({ ...draw, stream })) : { ...next, stream };
  }
  return Object.freeze({ render, snapshot: planner.snapshot, stats: planner.stats, retry: planner.retry,
    ready: planner.ready, dispose: planner.dispose });
}
