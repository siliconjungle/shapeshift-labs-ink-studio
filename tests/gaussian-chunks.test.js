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
