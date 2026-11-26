const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');

test('Gaussian packing preserves full records and reports a conservative center error for each tier', async () => {
  const { packGaussianChunks, inspectGaussianChunkManifest } = await import('../webgpu.mjs');
  const world = { count: 5, data: new Float32Array(5 * 16), bg: [6, 15, 26], radius: 8,
    cam: { target: [0, 0, 0], dist: 16, yaw: 0, pitch: 0 } };
  for (const [i, x] of [.02, .08, .13, .18, 2.1].entries()) {
    world.data.set([x, .01, .03, .6, .01, 0, 0, 0x1020f0, .01, 0, .01], i * 16);
  }
  const packed = packGaussianChunks(world, { cellSize: 1, voxelSizes: [.2, .1, 0] });
  const chunks = [...packed.chunks()];
  assert.equal(chunks.length, 2);
  const first = chunks[0], [coarse, middle, fine] = first.levels;
  assert.deepEqual(first.levels.map(l => l.splats), [1, 2, 4]);
  assert(first.levels.every(l => l.encoding === 'raw' && l.payloadBytes === 64 * l.splats));
  assert.deepEqual(fine.data, world.data.slice(0, 64));
  assert(coarse.error >= .08 - 1e-6);
  assert(middle.error > .02 && middle.error < coarse.error);
  assert(coarse.data[4] > fine.data[4]);
  assert(first.bounds.min[0] <= fine.data[0] - .2999);
  assert(first.bounds.max[0] >= fine.data[48] + .2999);
  const manifest = { schema: packed.schema, world: packed.world,
    chunks: chunks.map(c => ({ ...c, levels: c.levels.map(({ data, ...level }) => level) })) };
  assert.strictEqual(inspectGaussianChunkManifest(manifest), manifest);
  manifest.chunks[0].levels[0].file = '../escaped.bin';
  assert.throws(() => inspectGaussianChunkManifest(manifest), /invalid/i);
});

test('IRC1 level bounds and projected errors cover the decoded geometry', async () => {
  const { packGaussianChunks, inspectGaussianChunkManifest } = await import('../webgpu.mjs');
  const { splatCodec: codec } = ink.load().KIT.procedural;
  const world = { count: 96, data: new Float32Array(96 * 16), bg: [6, 15, 26], radius: 8,
    cam: { target: [.56, .4, .48], dist: 8, yaw: 0, pitch: 0 } };
  for (let i = 0; i < world.count; i++) {
    const x = .013 + (i % 12) * .09731, z = .017 + Math.floor(i / 12) * .11713;
    world.data.set([x, .32 + .11 * Math.sin(i), z, .65, .01, 0, 0, 0x1020f0, .002 + i * .00001, 0, .01], 16 * i);
  }
  const options = { cellSize: 2, voxelSizes: [.4, .2, 0] };
  const [raw] = packGaussianChunks(world, options).chunks();
  const packed = packGaussianChunks(world, { ...options, encoding: 'irc1' });
  const [quantized] = packed.chunks();
  const [exact] = packGaussianChunks(world, { ...options, encoding: 'irc1', lossless: true }).chunks();
  assert.equal(quantized.levels.length, 3);
  for (const [i, level] of quantized.levels.entries()) {
    const original = raw.levels[i], lossless = exact.levels[i];
    assert.equal(level.encoding, 'irc1');
    assert.match(level.file, /\.irc$/);
    assert.equal(level.payloadBytes, level.payload.byteLength);
    assert(level.payloadBytes <= codec.maxEncodedBytes(level.splats));
    const { data } = codec.decode(level.payload, { expectedCount: level.splats });
    assert.deepEqual(new Uint8Array(codec.decode(lossless.payload).data.buffer), new Uint8Array(original.data.buffer));
    assert.equal(lossless.error, original.error);
    for (let at = 0; at < data.length; at += 16) {
      const delta = Math.hypot(...[0, 1, 2].map(axis => data[at + axis] - original.data[at + axis]));
      assert(delta <= Math.sqrt(3) * .0001);
      assert(level.error >= original.error + delta);
      for (const [axis, field] of [4, 8, 10].entries()) {
        const radius = 3 * Math.sqrt(data[at + field]), center = data[at + axis];
        assert(quantized.bounds.min[axis] <= center - radius);
        assert(quantized.bounds.max[axis] >= center + radius);
      }
    }
  }
  assert(quantized.levels.at(-1).error > 0);
  assert.deepEqual(exact.bounds, raw.bounds);
  const manifest = { schema: packed.schema, world: packed.world,
    chunks: [{ ...quantized, levels: quantized.levels.map(({ data, payload, ...level }) => level) }] };
  assert.strictEqual(inspectGaussianChunkManifest(manifest), manifest);
  const first = manifest.chunks[0].levels[0];
  for (const patch of [{ encoding: 'rgb' }, { encoding: undefined }, { payloadBytes: undefined },
    { payloadBytes: codec.maxEncodedBytes(first.splats) + 1 }, { payloadBytes: 8 }, { file: 'wrong.bin' },
    { file: '../escape.irc' }]) {
    manifest.chunks[0].levels[0] = { ...first, ...patch };
    assert.throws(() => inspectGaussianChunkManifest(manifest), /invalid/i);
  }
  for (const flags of [{ encoding: 'rgb' }, { lossless: true }, { encoding: 'irc1', lossless: 'yes' }])
    assert.throws(() => packGaussianChunks(world, flags), /encoding/);
});

test('the Gaussian loader fetches on demand, shares GPU handles, and bounds the binary response', async () => {
  const { createGaussianChunkStream } = await import('../webgpu.mjs');
  const row = (id, left) => ({ id, layer: 'set', bounds: { min: [left, -.3, -.3], max: [left + .6, .3, .3] },
    levels: [{ id: 'base', file: id + '.bin', revision: 1, splats: 1, error: 0 }] });
  const manifest = { schema: 'ink.gaussian-chunks.v1',
    world: { bg: [6, 15, 26], radius: 8, cam: { target: [0, 0, 0], dist: 8, yaw: 0, pitch: 0 } },
    chunks: [row('near', -.3), row('away', 20)] };
  const fetched = [], released = [];
  let uploads = 0;
  const renderer = { maxSplats: 200,
    uploadChunk(data, { order }) {
      uploads++;
      assert.equal(data.byteLength, 64);
      return { order, bytes: 80, count: 1, cpuMs: 0, dispose() { released.push(order); } };
    },
    renderChunks(_target, _world, handles, _frame, cloudUpload) { return { input: handles.length, cloudUpload }; }
  };
  const stream = createGaussianChunkStream(renderer, ink.load().KIT, manifest, {
    url: 'https://example.invalid/test/manifest.json', budgetBytes: 80, maxSplats: 1, guardPixels: 0,
    fetch(url) {
      fetched.push(url.pathname);
      return new Response(new Uint8Array(url.pathname.includes('away') ? 65 : 64));
    }
  });
  try {
    const target = { width: 100, height: 100 };
    stream.render(target);
    await stream.ready();
    const stable = stream.render(target);
    assert.equal(stable.input, 1);
    assert.equal(stable.stream.bytes, 80);
    assert.equal(stable.cloudUpload.bytes, 80);
    stream.render(target, { yaw: .03 });
    assert.equal(uploads, 1);
    stream.render(target, { target: [20, 0, 0] });
    await assert.rejects(stream.ready(), /byte reservation/);
    const after = stream.render(target, { target: [20, 0, 0] });
    assert.equal(after.input, 0);
    assert.equal(after.stream.pending, 0);
    assert.equal(after.stream.failures[0].chunk, 'away');
    assert.deepEqual(fetched, ['/test/near.bin', '/test/away.bin']);
    assert.deepEqual(released, [0]);
  } finally {
    stream.dispose();
  }
});

test('Gaussian streaming spreads uploads, cancels stale work and reuses decoded revisions', async t => {
  const { createGaussianChunkStream } = await import('../webgpu.mjs');
  const { setImmediate: turn } = require('node:timers/promises');
  const row = (id, x) => ({ id, layer: 'set', bounds: { min: [x, -.3, -.3], max: [x + .3, .3, .3] },
    levels: [{ id: 'base', file: id + '.bin', revision: 1, splats: 1, error: 0 }] });
  const manifest = { schema: 'ink.gaussian-chunks.v1',
    world: { bg: [0, 0, 0], radius: 8, cam: { target: [0, 0, 0], dist: 8, yaw: 0, pitch: 0 } },
    chunks: [row('near-a', -.7), row('near-b', 0), row('near-c', .4), row('away', 20)] };
  const fetched = [], uploads = [];
  const renderer = { maxSplats: 3, uploadChunk(data, { order }) {
    uploads.push(order);
    return { order, bytes: 80, count: 1, cpuMs: 0, dispose() {} };
  }, renderChunks(_target, _world, handles) { return { input: handles.length }; } };
  const stream = createGaussianChunkStream(renderer, ink.load().KIT, manifest, {
    url: 'https://example.invalid/manifest.json', budgetBytes: 240, maxSplats: 3,
    uploadBytesPerFrame: 64, decodedCacheBytes: 4096, startsPerFrame: 3, concurrency: 3, guardPixels: 0,
    fetch(url) {
      fetched.push(url.pathname);
      return new Response(new Uint8Array(64));
    }
  });
  t.after(() => stream.dispose());
  const target = { width: 120, height: 100 }, away = { target: [20, 0, 0] };
  stream.render(target);
  await turn();
  assert.equal(uploads.length, 0);
  for (let i = 0; i < 3; i++) {
    assert.equal(stream.render(target).stream.queuedUploads, 3 - i);
    await turn();
    assert.equal(uploads.length, i + 1);
  }
  assert.equal(stream.render(target).input, 3);
  stream.render(target, away);
  await turn();
  assert(fetched.includes('/away.bin'));
  stream.render(target);
  await turn();
  assert.equal(uploads.length, 3);
  const returning = stream.render(target);
  assert.equal(returning.stream.decodedCache.byKind.gaussianChunk.hits, 3);
  assert.equal(returning.stream.queuedUploads, 3);
  for (let i = 0; i < 3; i++) {
    stream.render(target);
    await turn();
  }
  assert.equal(uploads.length, 6);
  assert.equal(fetched.length, 4);
  const edited = structuredClone(manifest);
  edited.chunks[0].levels[0].revision++;
  stream.updateManifest(edited);
  stream.render(target);
  await turn();
  assert.equal(fetched.filter(file => file === '/near-a.bin').length, 2);
  stream.render(target);
  await turn();
  assert.equal(stream.render(target).input, 3);
  assert.equal(uploads.length, 7);
});

test('edited Gaussian rows survive repacking and live LOD changes while untouched chunks stay resident', async t => {
  const { mkdtemp, readFile, rm, stat } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const path = require('node:path');
  const { writeGaussianPack } = await import('../scripts/pack-gaussian-chunks.mjs');
  const { createGaussianChunkStream } = await import('../webgpu.mjs');
  const { gaussianChunkData } = await import('../src/gaussian-chunks.mjs');
  const output = await mkdtemp(path.join(tmpdir(), 'ink-edited-chunks-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const KIT = ink.load().KIT;
  const world = {
    id: 'test-scan', count: 5, data: new Float32Array(80), bg: [6, 15, 26], radius: 8,
    cam: { target: [0, 0, 0], dist: 8, yaw: 0, pitch: 0 }, gaussianCloud: true,
    renderMetadata: { objects: [null, 'cloud'], objectIds: new Uint32Array(5).fill(1) }
  };
  for (const [i, x] of [.02, .08, .13, .18, 1.1].entries()) {
    world.data.set([x, .01, .03, .75, .01, 0, 0, 0x1020f0, .01, 0, .01], i * 16);
  }
  const identities = KIT.procedural.splatProvenance.identities;
  const [painted, hidden] = [0, 3].map(i => identities(world).idAt(i));
  const edit = alpha => ({
    format: 'ink-studio/splat-fit', version: 2, scene: world.id, target: { object: 'cloud' }, edits: [],
    attributes: [[painted, { pigment: 0x10e040, coverage: .5,
      footprint: { shape: 'mask', mask: { width: 3, height: 2, alpha: [...alpha, ...alpha] }, softness: 0 } }], [hidden, { coverage: 0 }]]
  });
  const fit = edit([255, 0, 255]), config = { cellSize: 1, voxelSizes: [.2, 0] };
  const initial = await writeGaussianPack(world, output, config);
  const [before, untouched] = initial.chunks;
  const untouchedFile = path.join(output, untouched.levels[0].file);
  const beforeStat = await stat(untouchedFile);
  const next = await writeGaussianPack(world, output, { ...config, splatFit: fit });
  const [changed, reused] = next.chunks;
  assert.equal(changed.id, before.id);
  assert.deepEqual(reused, untouched);
  assert.equal((await stat(untouchedFile)).mtimeMs, beforeStat.mtimeMs);
  assert.deepEqual(changed.levels.map(level => level.splats), [2, 3]);
  assert(changed.levels.every(level => level.revision === next.epoch));
  const baked = ink.bakeSplatFit(world, fit);
  assert.equal(world.count, 5);
  assert.equal(world.data[7], 0x1020f0);
  assert.equal(baked.count, 4);
  assert.equal(identities(baked).idAt(0), painted);
  assert.deepEqual(Array.from(baked.splatLodProtected), [1, 0, 0, 0]);
  for (const level of changed.levels) {
    const bytes = await readFile(path.join(output, level.file));
    const row = gaussianChunkData(Uint8Array.from(bytes).buffer, level.splats).subarray(0, 16);
    assert.equal(row[7], 0x40e010);
    assert.equal(row[3], .375);
    assert.equal(row[11], 1);
  }

  const files = [], freed = [], atlases = [];
  const renderer = {
    maxSplats: 32,
    createFootprintAtlas(profiles, api) {
      const atlas = { profiles, bytes: 256, dispose() { freed.push(this); } };
      assert.equal(api.prepare(profiles[0]).shape, 'mask');
      atlases.push(atlas);
      return atlas;
    },
    uploadChunk(data, { order, footprints }) {
      return { order, footprints, color: data[7], bytes: data.byteLength + 16, count: data.length / 16,
        cpuMs: 0, dispose() {} };
    },
    renderChunks(_target, _world, handles, frame) { return { handles, atlas: frame.footprintAtlas }; }
  };
  const stream = createGaussianChunkStream(renderer, KIT, initial, {
    url: 'https://example.invalid/pack/manifest.json', maxSplats: 32, budgetBytes: 2048, guardPixels: 0,
    async fetch(url) {
      const file = path.basename(url.pathname);
      files.push(file);
      return new Response(await readFile(path.join(output, file)));
    }
  });
  t.after(() => stream.dispose());
  const target = { width: 100, height: 100 }, close = { selected: [before.id] };
  stream.render(target, close);
  await stream.ready();
  const old = stream.render(target, close);
  const resident = old.handles.find(handle => handle.order === 1);
  assert(resident);
  stream.updateManifest(next);
  assert.deepEqual(stream.render(target, close).handles, [resident]);
  await stream.ready();
  const near = stream.render(target, close);
  assert.equal(near.atlas, atlases[0]);
  assert(near.handles.includes(resident));
  assert.equal(near.handles.find(handle => handle.footprints).color, 0x40e010);
  assert.equal(near.stream.chunks.find(chunk => chunk.chunk === changed.id).level, changed.levels[1].id);
  const far = { dist: 60 };
  stream.render(target, far);
  await stream.ready();
  const distant = stream.render(target, far);
  assert.equal(distant.handles.find(handle => handle.footprints).color, 0x40e010);
  assert.equal(distant.stream.chunks.find(chunk => chunk.chunk === changed.id).level, changed.levels[0].id);

  const revisedMask = await writeGaussianPack(world, output, { ...config, splatFit: edit([0, 255, 0]) });
  assert.equal(revisedMask.chunks[0].levels[0].file, changed.levels[0].file);
  assert.notEqual(revisedMask.chunks[0].footprintRevision, changed.footprintRevision);
  assert.equal(revisedMask.chunks[0].levels[0].revision, revisedMask.epoch);
  assert.deepEqual(revisedMask.chunks[1], reused);
  stream.updateManifest(revisedMask);
  assert.deepEqual(freed, [atlases[0]]);
  assert.deepEqual(stream.render(target, far).handles, [resident]);
  await stream.ready();
  assert.equal(stream.render(target, far).atlas, atlases[1]);
  assert.equal(files.filter(file => file === untouched.levels[0].file).length, 1);

  const encoded = await writeGaussianPack(world, output, {
    ...config, splatFit: edit([0, 255, 0]), encoding: 'irc1', lossless: true
  });
  const [compressed] = encoded.chunks;
  for (const [i, level] of compressed.levels.entries()) {
    const bytes = await readFile(path.join(output, level.file));
    assert.equal(level.payloadBytes, bytes.length);
    const decoded = KIT.procedural.splatCodec.decode(bytes, { expectedCount: level.splats }).data;
    const raw = await readFile(path.join(output, revisedMask.chunks[0].levels[i].file));
    assert.deepEqual(Buffer.from(decoded.buffer), raw);
  }
  stream.updateManifest({ ...encoded, chunks: [compressed, residentChunkAsLegacy(reused)] });
  assert.deepEqual(stream.render(target, far).handles, [resident]);
  await stream.ready();
  const mixed = stream.render(target, far), compressedHandle = mixed.handles.find(handle => handle.footprints);
  assert(mixed.handles.includes(resident));
  assert.equal(compressedHandle.color, 0x40e010);
  assert.equal(mixed.stream.bytes, resident.bytes + compressedHandle.bytes);
  assert.equal(mixed.stream.payloadBytes, compressed.levels[0].payloadBytes);
  assert(mixed.stream.decodeCpuMs >= 0);
  assert.equal(stream.render(target, far).stream.payloadBytes, 0);
  assert.equal(files.filter(file => file === untouched.levels[0].file).length, 1);

  function residentChunkAsLegacy(chunk) {
    return { ...chunk, levels: chunk.levels.map(({ encoding, payloadBytes, ...level }) => level) };
  }
});

test('invalid IRC1 stream payloads never reach the GPU and decoded bytes still limit residency', async () => {
  const { createGaussianChunkStream } = await import('../webgpu.mjs');
  const KIT = ink.load().KIT;
  const bytes = KIT.procedural.splatCodec.encode(new Float32Array(64));
  assert(bytes.length < 4 * 64);
  const badHeader = bytes.slice();
  badHeader[0] = 0;
  const cases = [
    [bytes.subarray(0, bytes.length - 1), 4, /ended before/],
    [new Uint8Array(bytes.length + 1), 4, /byte reservation/],
    [badHeader, 4, /Unsupported splat codec format/],
    [bytes, 5, /Expected 5 splat rows, got 4/]
  ];
  const renderer = { maxSplats: 32,
    uploadChunk() { assert.fail('An invalid or overbudget level reached the GPU'); },
    renderChunks() { return {}; }
  };
  for (const [payload, splats, error] of [...cases, [bytes, 4, null]]) {
    const manifest = { schema: 'ink.gaussian-chunks.v1',
      world: { bg: [6, 15, 26], radius: 8, cam: { target: [0, 0, 0], dist: 8, yaw: 0, pitch: 0 } },
      chunks: [{ id: 'near', layer: 'set', bounds: { min: [-.3, -.3, -.3], max: [.3, .3, .3] },
        levels: [{ id: 'base', file: 'near.irc', revision: 1, splats, error: 0, encoding: 'irc1', payloadBytes: bytes.length }] }]
    };
    const stream = createGaussianChunkStream(renderer, KIT, manifest, {
      url: 'https://example.invalid/manifest.json', budgetBytes: error ? 512 : 255, maxSplats: 32, guardPixels: 0,
      fetch() {
        assert(error, 'Payload size must never determine GPU admission');
        return new Response(payload);
      }
    });
    try {
      const target = { width: 100, height: 100 };
      stream.render(target);
      if (error) await assert.rejects(stream.ready(), error);
      else await stream.ready();
      assert.equal(stream.render(target).stream.loads, 0);
    } finally {
      stream.dispose();
    }
  }
});

test('disposing an IRC1 stream cancels an in-flight response body', async () => {
  const { createGaussianChunkStream } = await import('../webgpu.mjs');
  const { KIT } = ink.load();
  const manifest = { schema: 'ink.gaussian-chunks.v1',
    world: { bg: [0, 0, 0], radius: 2, cam: { target: [0, 0, 0], dist: 6, yaw: 0, pitch: 0 } },
    chunks: [{ id: 'near', layer: 'set', bounds: { min: [-.3, -.3, -.3], max: [.3, .3, .3] },
      levels: [{ id: 'base', file: 'near.irc', revision: 1, splats: 1, error: 0, encoding: 'irc1', payloadBytes: 88 }] }]
  };
  let onRead, onCancel, fetchSignal;
  const reading = new Promise(resolve => { onRead = resolve; });
  const cancelled = new Promise(resolve => { onCancel = resolve; });
  const renderer = { maxSplats: 1, renderChunks() { return {}; },
    uploadChunk() { assert.fail('A cancelled response reached the GPU'); }
  };
  const stream = createGaussianChunkStream(renderer, KIT, manifest, {
    url: 'https://example.invalid/manifest.json', budgetBytes: 128, maxSplats: 1,
    fetch(_url, { signal }) {
      fetchSignal = signal;
      return new Response(new ReadableStream({ pull: onRead, cancel: onCancel }, { highWaterMark: 0 }));
    }
  });
  try {
    stream.render({ width: 100, height: 100 });
    await reading;
    stream.dispose();
    await cancelled;
    assert(fetchSignal.aborted);
  } finally {
    stream.dispose();
  }
});
