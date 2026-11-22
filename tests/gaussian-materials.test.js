const assert = require('node:assert/strict');
const test = require('node:test');

test('live imports retain the thin covariance axis in world space and omit ambiguous normals', async () => {
  const { gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
  const q = Math.SQRT1_2;
  const cloud = {
    count: 2, degree: 0, positions: Float32Array.of(-1, 0, 0, 1, 0, 0),
    scales: Float32Array.of(.15, .15, .015, .1, .1, .1),
    rotations: Float32Array.of(-q, 0, 0, q, 0, 0, 0, 1),
    opacity: Float32Array.of(.9, .9), dc: new Float32Array(6), sh: new Float32Array(0)
  };
  const world = gaussianSplatWorld(cloud, { colorMode: 'rgb', up: 'z' });
  assert.deepEqual(Array.from(world.gaussianHarmonics.normals), [0, 0, -127, 0, 0, 0]);
  assert.equal(gaussianSplatWorld(cloud).gaussianHarmonics, undefined);
});

test('material plans validate world identity, masks, swatches and response ranges', async () => {
  const { compileGaussianMaterials, gaussianMaterialPlan } = await import('../src/webgl/gaussian-materials.mjs');
  const world = { count: 3, gaussianHarmonics: { count: 3, normals: Int8Array.of(0, 0, 127, 0, 0, 0, 127, 0, 0) } };
  const mask = indices => Object.freeze({ count: 3, indices: Object.freeze(indices) });
  const shell = { id: 'shell', mask: mask([0]), ramp: [0x1a3833, 0x76cfad] };
  const tissue = { id: 'tissue', mask: mask([2]), ramp: [0x4d2443] };
  const handle = compileGaussianMaterials(world, [shell, tissue]);
  const plan = gaussianMaterialPlan(world, handle);
  assert.deepEqual(handle.materials, ['shell', 'tissue']);
  assert.deepEqual(Array.from(plan.rows), [0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 2]);
  assert.equal(gaussianMaterialPlan(world, compileGaussianMaterials(world, [{ ...shell, captured: 0 }, tissue])).rows, plan.rows);
  assert.equal(gaussianMaterialPlan(world, compileGaussianMaterials(world, [{ ...shell, mask: mask([]) }])), null);
  assert.throws(() => gaussianMaterialPlan({ ...world, gaussianHarmonics: { count: 3 } }, handle), /for this imported world/);
  assert.throws(() => compileGaussianMaterials(world, [shell, { ...tissue, mask: shell.mask }]), /non-overlapping/);
  assert.throws(() => compileGaussianMaterials(world, [{ ...shell, lighting: { diffuse: 2 } }]), /0 to 1/);
});

test('the material brush transfers ownership and undo restores the previous material', async () => {
  const { createGaussianMaterialPainter } = await import('../src/webgl/splat-mask-painter.mjs');
  const world = { data: new Float32Array(48), count: 3, gaussianHarmonics: { count: 3 }, cam: { dist: 4 } };
  const pick = () => {
    const dominant = { index: 0, weight: .8, distance: 4 };
    return { dominant, contributions: [dominant, { index: 2, weight: .1, distance: 5 }] };
  };
  const painter = createGaussianMaterialPainter({ pick }, world, { width: 40, height: 40 },
    { masks: [{ count: 3, indices: [0, 1] }] });
  const snapshot = () => painter.masks.map(m => m.indices);
  const frame = { camera: world.cam };
  assert.deepEqual(snapshot(), [[0, 1], [], []]);
  painter.stroke(1, [[.5, .5]], frame);
  assert.deepEqual(snapshot(), [[1], [0], []]);
  painter.stroke(0, [[.5, .5]], frame, { erase: true });
  assert.deepEqual(snapshot(), [[1], [0], []]);
  painter.undo();
  assert.deepEqual(snapshot(), [[0, 1], [], []]);
  painter.clear(0);
  assert.deepEqual(snapshot(), [[], [], []]);
  painter.undo();
  assert.deepEqual(snapshot(), [[0, 1], [], []]);
});

test('WebGL relights painted parts independently, keeps captured SH and respects palette ownership',
  { skip: !process.env.INK_TEST_CHROME }, () => {
    const result = require('../cli/look-webgl.js')({}, () => {},
      (kit, fixture, backend) => {
        const compile = kit.compileGaussianMaterials;
        const data = new Float32Array(48);
        for (let row = 0; row < 3; row++) {
          const i = row * 16;
          data[i] = (row - 1) * .72;
          data[i + 3] = 1;
          data[i + 4] = data[i + 8] = data[i + 10] = .013;
          data[i + 7] = 0x7f7f7f;
        }
        const sh = new Float32Array(27);
        sh[3] = -.7;
        const world = {
          data, count: 3, radius: 3, pal: [0x101010, 0x808080], dither: 0,
          moving: new Int32Array(), back: new Int32Array(),
          cam: { dist: 4, target: [0, 0, 0], yaw: 0, pitch: 0, ortho: true },
          gaussianHarmonics: { count: 3, degree: 1, dc: new Float32Array(9), sh,
            normals: Int8Array.of(0, 0, 127, 127, 0, 0, 0, 0, 0), up: 'y', colorMode: 'rgb' }
        };
        const layer = (id, index, ramp, diffuse, captured = 0) => ({
          id, mask: { count: 3, indices: [index] }, ramp, captured, detail: 0,
          lighting: { ambient: 0, diffuse, specular: 0, roughness: 1 }
        });
        const shell = layer('shell', 0, [0x124038, 0x70dda5], 1);
        const tissue = layer('tissue', 1, [0xba2555], 0);
        const draw = backend(129, 129, { offscreen: true, colored: false, dither: 0, damp: false });
        function sample(parts, direction, gaussianColor = 'rgb') {
          draw.draw(world, { gaussianColor, gaussianMaterials: parts && compile(world, parts), gaussianLight: { direction } });
          return draw.sample({ shell: [30,64], tissue: [64,64], bare: [98,64] });
        }
        const before = sample(false, [0, 0, 1]);
        const capturedShell = { ...shell, captured: 1 };
        const first = sample([capturedShell, tissue], [1, 0, 0]);
        const repeat = sample([capturedShell, tissue], [1, 0, 0]);
        const lit = sample([shell, tissue], [0, 0, 1]);
        const unlit = sample([shell, tissue], [1, 0, 0]);
        const capture = sample([capturedShell, tissue], [1, 0, 0]);
        const palette = sample([shell, tissue], [0, 0, 1], 'palette');
        const sheet = draw.captureTurntable(world, { angles: [0], width: 129, frame: {
          gaussianMaterials: compile(world, [shell, tissue]), gaussianLight: { direction: [0, 0, 1] }
        } });
        const used = sheet.metadata.palette[sheet.indices[64 * 129 + 30]];
        world.data = data.slice();
        world.data[32] = -.72;
        world.data[34] = .9;
        const occluded = sample([shell, tissue], [0, 0, 1], 'palette');
        draw.close();
        return { before, lit, unlit, capture, palette, occluded, used, first, repeat };
      }, {});
    assert.deepEqual(result.first, result.repeat);
    assert(result.lit.shell[1] > result.unlit.shell[1] + 80);
    assert.deepEqual(result.lit.tissue, result.unlit.tissue);
    assert.deepEqual(result.before.bare, result.lit.bare);
    assert(result.capture.shell[0] > result.unlit.shell[0] + 45);
    assert.deepEqual(result.palette.shell, [112, 221, 165]);
    assert.deepEqual(result.palette.tissue, [186, 37, 85]);
    assert.deepEqual(result.used, result.palette.shell);
    assert.notDeepEqual(result.occluded.shell, result.palette.shell);
  });
