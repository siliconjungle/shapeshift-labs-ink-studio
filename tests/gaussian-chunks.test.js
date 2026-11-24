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
});
