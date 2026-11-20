const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const graph = require('../src/render-graph');
const runGraph = require('../cli/render-graph');
const runWebGL = require('../cli/look-webgl');
const E = graph.effects;
const kit = ink.load();

function fixture({ makeBuilder, KIT }) {
  const world = makeBuilder(42, [0]).finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  const layer = {
    source({ w, h }) {
      const rgba = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          rgba.set([(x * 73 + y * 17) % 255, (x * 21 + y * 31) % 255, (x * 91 + y * 11) % 255, 255], (y * w + x) * 4);
      return { w, h, rgba };
    }
  };
  const passes = [{ id: 'paint', type: 'composite', layer }];
  return { world, passes, graph: KIT.renderGraph.create({ passes }) };
}
function synthetic(pass, { width = 32, height = 16, occluder = false } = {}) {
  const w = width,
    h = height,
    rgb = new Uint8Array(w * h * 3),
    z = new Float32Array(w * h).fill(8),
    owner = new Uint32Array(w * h).fill(1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      rgb.set(x > w * 0.45 && x < w * 0.7 ? [255, 210, 100] : [8, 14, 22], p * 3);
      if (occluder && x < w * 0.4) {
        z[p] = 2;
        owner[p] = 2;
        rgb.set([30, 42, 55], p * 3);
      }
    }
  const world = {
    count: 2,
    data: new Float32Array(32),
    renderMetadata: { objectIds: new Uint32Array([1, 2]), objects: [null, 'lamp', 'foreground'] }
  };
  const frame = { w, h, rgb, passes: { w, h, depth: z, splatId: owner } };
  const plan = graph.prepare({ passes: [{ id: 'fx', ...pass }] });
  return { frame, world, plan, render: () => runGraph(plan, frame, world, 1, null, null, null, {}) };
}

test('effects expose validated budgets, masks, and no unbounded knobs', () => {
  for (const type of E.types) assert(graph.prepare({ passes: [{ id: 'fx', type }] }).needsDepth);
  for (const change of [
    { budget: { scale: 0 } },
    { budget: { maxPixels: 0 } },
    { budget: { maxSamples: 65 } },
    { maskMode: 'oops' },
    { depth: { near: 5, far: 1 } },
    { depth: { far: NaN } },
    { surprise: 1 }
  ])
    assert.throws(() => graph.prepare({ passes: [{ id: 'fx', type: 'bloom', ...change }] }));
  const p = graph.prepare({
    passes: [
      { id: 'g', type: 'bloom', budget: { maxPixels: 4096 } },
      { id: 'f', type: 'feedback', budget: { maxPixels: 1024 } }
    ]
  });
  const r = graph.resources(p, 1920, 1080);
  assert(r.passes[0].pixels <= 4096);
  assert(r.passes[1].pixels <= 1024);
  assert.equal(r.historyBytes, r.historyPixels * 8);
  assert.throws(
    () => graph.resources(graph.prepare({ budget: { maxWork: 1 }, passes: [{ id: 'g', type: 'bloom' }] }), 100, 100),
    /work budget/
  );
  assert.throws(
    () =>
      graph.resources(
        graph.prepare({ budget: { maxTransientPixels: 1 }, passes: [{ id: 'g', type: 'bloom' }] }),
        100,
        100
      ),
    /transient/
  );
  assert.throws(
    () =>
      graph.resources(
        graph.prepare({ budget: { maxHistoryPixels: 1 }, passes: [{ id: 'f', type: 'feedback' }] }),
        10,
        10
      ),
    /history/
  );
});

test('selective low-resolution glow preserves foreground pixels exactly', () => {
  for (const type of ['bloom', 'halation']) {
    const f = synthetic(
      { type, select: { object: 'lamp' }, radius: 14, intensity: 3, budget: { maxPixels: 32 } },
      { occluder: true }
    );
    const out = f.render();
    for (let y = 0; y < f.frame.h; y++)
      for (let x = 0; x < f.frame.w * 0.4; x++) {
        const q = (y * f.frame.w + x) * 3;
        assert.deepEqual(out.rgb.subarray(q, q + 3), f.frame.rgb.subarray(q, q + 3));
      }
    assert(out.rgb.some((v, i) => v > f.frame.rgb[i] + 3));
  }
});

test('depth and output masks keep unrelated pixels byte-exact at reduced budgets', () => {
  for (const type of ['chromatic', 'blocks', 'pixelSort', 'outline']) {
    const f = synthetic(
      {
        type,
        select: { object: 'lamp' },
        maskMode: 'both',
        depth: { near: 6, far: 12 },
        budget: { scale: 0.5 },
        ...(type === 'blocks' ? { probability: 1, offset: [3, 0] } : {})
      },
      { occluder: true }
    );
    const out = f.render();
    for (let y = 0; y < f.frame.h; y++)
      for (let x = 0; x < f.frame.w * 0.4; x++) {
        const q = (y * f.frame.w + x) * 3;
        assert.deepEqual(out.rgb.subarray(q, q + 3), f.frame.rgb.subarray(q, q + 3));
      }
  }
  assert.equal(E.depthWeight(E.depth({ near: 1, far: 4, invert: true }), Infinity), 0);
  assert.equal(E.depthWeight(E.depth({ near: 1, far: 4, background: true }), Infinity), 1);
});

test('pixel sorting is stable and bounded by contiguous masks and depth boundaries', () => {
  const W = 8,
    input = new Uint8Array(W * 4);
  [90, 30, 60, 0, 180, 120, 150, 0].forEach((c, i) => input.set([c, c, c, 255], i * 4));
  const node = {
    ...graph.prepare({
      passes: [{ id: 'sort', type: 'pixelSort', span: 8, threshold: [0.05, 1], budget: { filter: 'nearest' } }]
    }).passes[0]
  };
  const output = E.render(
    node,
    input,
    W,
    1,
    { width: W, height: 1, samples: 8 },
    { weight: () => 1, depth: () => 3, group: () => 1 }
  );
  const values = Array.from({ length: W }, (_, i) => output[i * 4]);
  assert.deepEqual(values, [30, 60, 90, 0, 120, 150, 180, 0]);
  assert.deepEqual(
    E.render(
      node,
      input,
      W,
      1,
      { width: W, height: 1, samples: 8 },
      { weight: () => 0, depth: () => 3, group: () => 1 }
    ),
    input
  );
});

test('effect packet compositing preserves alpha and exact disabled pixels', () => {
  const input = new Uint8Array([40, 20, 10, 80, 0, 0, 0, 0, 180, 50, 5, 200, 10, 10, 10, 255]);
  for (const type of E.types) {
    const node = graph.prepare({ passes: [{ id: 'f', type, maskMode: 'both' }] }).passes[0];
    const out = E.render(
      node,
      input,
      4,
      1,
      { width: 4, height: 1, samples: 8 },
      { weight: x => (x < 1 ? 0 : 1), depth: () => 2, group: () => 1, time: 0.3 }
    );
    assert.deepEqual(out.subarray(0, 4), input.subarray(0, 4));
    for (let i = 0; i < 4; i++) assert.equal(out[i * 4 + 3], input[i * 4 + 3]);
  }
});

test('budgeted feedback keeps timestamp, reset and resolution edits deterministic', () => {
  const { world, graph: g } = fixture(kit),
    session = kit.KIT.renderGraph.history();
  const base = fixture(kit).passes;
  g.replace({
    passes: [
      ...base,
      { id: 'echo', type: 'feedback', source: 'paint', cameraMotion: 'keep', budget: { scale: 0.5, filter: 'nearest' } }
    ]
  });
  const render = t => ink.render(world, { w: 16, h: 8, px: 1, raw: true, t, renderGraph: g, renderHistory: session });
  const first = render(0),
    again = render(0);
  assert.deepEqual(first.rgb, again.rgb);
  render(1);
  g.update('echo', { budget: { scale: 0.25, filter: 'nearest' } });
  const changed = render(1),
    fresh = ink.render(world, { w: 16, h: 8, px: 1, raw: true, t: 1, renderGraph: g });
  assert.deepEqual(changed.rgb, fresh.rgb);
  assert.deepEqual(render(0).rgb, ink.render(world, { w: 16, h: 8, px: 1, raw: true, t: 0, renderGraph: g }).rgb);
});

test(
  'native WebGL effects match the software graph at bounded resolutions',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const cases = [
      { type: 'bloom', radius: 5, intensity: 1 },
      { type: 'halation', radius: 4 },
      { type: 'outline', width: 1 },
      { type: 'chromatic', offset: [2, 0] },
      { type: 'blocks', probability: 1, offset: [3, 0] },
      { type: 'pixelSort', span: 8, threshold: [0, 1] },
      { type: 'feedback', halfLife: 1, cameraMotion: 'keep' }
    ];
    for (const effect of cases) {
      const declaration = { id: 'fx', ...effect, budget: { scale: 0.5, maxSamples: 16, filter: 'nearest' } };
      const f = fixture(kit),
        g = kit.KIT.renderGraph.create({ passes: [...f.passes, declaration] });
      const cpu = ink.render(f.world, { w: 24, h: 16, px: 1, raw: true, t: 0.4, renderGraph: g });
      const native = runWebGL(
        { hardware: true },
        fixture,
        (kit, build, backend, inputs) => {
          const f = build(kit),
            gpu = backend(24, 16, { raw: true, offscreen: true });
          try {
            f.graph.insert(inputs);
            gpu.draw(f.world, { time: 0.4, renderGraph: f.graph });
            return Array.from(atob(gpu.image()), c => c.charCodeAt(0));
          } finally {
            gpu.close();
          }
        },
        declaration
      );
      let max = 0,
        sum = 0;
      for (let i = 0; i < cpu.rgb.length; i++) {
        let d = Math.abs(cpu.rgb[i] - native[i]);
        max = Math.max(max, d);
        sum += d;
      }
      assert(max <= 5, JSON.stringify({ type: effect.type, max, mean: sum / cpu.rgb.length }));
    }
  }
);

function ownedFixture({ makeBuilder, KIT }) {
  const B = makeBuilder(9, [0x06101c, 0xffe8a0, 0x306579]);
  B.disc(-0.25, 0, -0.4, [0, 0, 1], 0.85, 0.03, B.P[1], 3);
  B.describeSplats(0, 1, { object: 'lamp' });
  B.disc(-0.55, 0, 0.5, [0, 0, 1], 0.32, 0.03, B.P[2], 3);
  B.describeSplats(1, 2, { object: 'foreground' });
  B.disc(0.95, 0, 0, [0, 0, 1], 0.35, 0.03, B.P[2], 3);
  B.describeSplats(2, 3, { object: 'foreground' });
  const world = B.finish({
    cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 },
    radius: 4,
    look: { composite: { world: { resolution: [32, 24] } } }
  });
  return {
    world,
    graph: KIT.renderGraph.create({
      passes: [
        {
          id: 'glow',
          type: 'bloom',
          select: { object: 'lamp' },
          radius: 14,
          intensity: 3,
          threshold: 0.4,
          budget: { maxPixels: 192 }
        }
      ]
    })
  };
}

test(
  'native owner/depth masks protect nearer objects during low-resolution glow',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = runWebGL({ hardware: true }, ownedFixture, (kit, build, backend) => {
      const { world, graph } = build(kit),
        gpu = backend(64, 48, { raw: true, offscreen: true });
      const points = { near: [23, 24], other: [45, 24], halo: [42, 14] };
      try {
        gpu.draw(world, { renderGraph: false });
        const before = gpu.sample(points);
        gpu.draw(world, { renderGraph: graph });
        const after = gpu.sample(points);
        // Replacing rather than patching removes the bloom-only controls.
        graph.replace({
          passes: [
            {
              id: 'blocks',
              type: 'blocks',
              select: { object: 'lamp' },
              probability: 1,
              offset: [9, 0],
              depth: { near: 0, far: 10 },
              budget: { scale: 0.5 }
            }
          ]
        });
        gpu.draw(world, { renderGraph: graph });
        const blocks = gpu.sample(points);
        return { before, after, blocks };
      } finally {
        gpu.close();
      }
    });
    assert.deepEqual(result.after.near, result.before.near);
    assert.deepEqual(result.after.other, result.before.other);
    assert.deepEqual(result.blocks.near, result.before.near);
    assert.deepEqual(result.blocks.other, result.before.other);
  }
);

test('logical groups combine splats, never conflate material fallback with entity names', () => {
  const world = {
    count: 3,
    data: new Float32Array(48),
    renderMetadata: {
      objectIds: new Uint32Array([1, 1, 0]),
      objects: [null, 'same'],
      materialIds: new Uint32Array([0, 0, 1]),
      materials: [null, 'same']
    }
  };
  const groups = graph.ownerGroups(world);
  assert.equal(groups[1], groups[2]);
  assert.notEqual(groups[1], groups[3]);
  assert.equal(groups[0], 0);
});

test('CLI planner and pre-render admission use the same working-set limits', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-effect-plan-'));
  try {
    const file = path.join(dir, 'graph.json'),
      definition = { passes: [{ id: 'glow', type: 'bloom', budget: { maxPixels: 128 } }] };
    fs.writeFileSync(file, JSON.stringify(definition));
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, '../cli/ink-studio.js'), 'render-graph', file, '--w', '64', '--h', '48'],
      { encoding: 'utf8' }
    );
    assert.deepEqual(JSON.parse(output), graph.resources(graph.prepare(definition), 64, 48));
    let invoked = false;
    const { world } = fixture(kit);
    assert.throws(
      () =>
        ink.render(world, {
          w: 32,
          h: 24,
          renderGraph: {
            budget: { maxWork: 1 },
            passes: [
              {
                id: 'layer',
                type: 'composite',
                layer: {
                  source() {
                    invoked = true;
                    throw Error('should not draw');
                  }
                }
              }
            ]
          }
        }),
      /work budget/
    );
    assert.equal(invoked, false);
    const thin = graph.resources(
      graph.prepare({ passes: [{ id: 'glow', type: 'bloom', budget: { maxPixels: 1 } }] }),
      100,
      1
    );
    assert.equal(thin.passes[0].pixels, 1);
    const dead = graph.resources(graph.prepare({ output: 'scene', passes: [{ id: 'glow', type: 'bloom' }] }), 100, 100);
    assert.equal(dead.work, 0);
    assert.equal(dead.transientPixels, 10000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function atlasFixture({ makeBuilder, KIT }) {
  const world = makeBuilder(1, [0x071322]).finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }, radius: 4 });
  const points = [
      [-0.6, -0.6, 0.5],
      [0.6, -0.6, 0.5],
      [-0.6, 0.6, 0.5],
      [0.6, 0.6, 0.5]
    ],
    vertices = [];
  for (const i of [0, 1, 2, 2, 1, 3]) vertices.push(...points[i], 0, 0);
  world.spriteSurfaces = {
    width: 1,
    height: 1,
    pixels: new Uint8Array([35, 80, 110, 255]),
    vertices: new Float32Array(vertices)
  };
  const graph = KIT.renderGraph.create({
    passes: [
      { id: 'scope', type: 'mask', depth: { near: 3.4, far: 3.6 } },
      {
        id: 'highlight',
        type: 'composite',
        mask: 'scope',
        layer: { draw: [{ type: 'rect', rect: [0, 0, 32, 24], color: '#ffd080' }] }
      }
    ]
  });
  return { world, graph };
}

test(
  'native depth masks include atlas surfaces with precise axial distances',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = runWebGL({ hardware: true }, atlasFixture, (kit, build, backend) => {
      const { world, graph } = build(kit),
        gpu = backend(32, 24, { raw: true, offscreen: true });
      try {
        gpu.draw(world, { renderGraph: graph });
        return gpu.sample({ face: [16, 12], sky: [1, 1] });
      } finally {
        gpu.close();
      }
    });
    assert.deepEqual(result.face, [255, 208, 128]);
    assert.notDeepEqual(result.sky, [255, 208, 128]);
  }
);
