const test = require('node:test'),
  assert = require('node:assert/strict');
const ink = require('..'),
  kit = ink.load(),
  { KIT: K, MaterialControls: M, SurfaceLook: S, makeBuilder, makeSculpt } = kit;
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
test('material controls are immutable portable descriptors with strict ranges', () => {
  const a = M.describe({ roughness: [0.1, 0.7], metalness: 0.6, ior: 1.7, coating: { weight: 0.8, color: '#ffcc88' } });
  assert.equal(M.describe(a), a);
  assert(Object.isFrozen(a.coating.color));
  assert(Object.isFrozen(a.roughness));
  assert.deepEqual(M.describe(JSON.parse(JSON.stringify(a))), a);
  for (const input of [
    { metallic: 1 },
    { roughness: -1 },
    { roughness: [0.1] },
    { roughness: [0, NaN] },
    { metalness: 2 },
    { ior: 0.9 },
    { transmission: Infinity },
    { thickness: 0 },
    { absorption: -1 },
    { coating: { weight: 2 } },
    { color: [1, 0, 2] }
  ])
    assert.throws(() => M.describe(input));
  near(M.f0(1.5), 0.04);
  near(M.f0(1), 0);
});
test('one descriptor maps to stylized layers, palette conductor color and export channels', () => {
  const resolved = M.resolve(
    M.apply(
      { r: [0], surface: { layers: { silk: { type: 'sheen', color: '#ffffff', strength: 0.2 } } } },
      { metalness: 1, roughness: [0.12, 0.64], transmission: 1 }
    ),
    { palette: [0xc0772a] }
  );
  assert.equal(resolved.optical, undefined);
  assert.equal(M.inspect(resolved).effectiveTransmission, 0);
  assert(resolved.surface.layers.silk);
  resolved.surface.layers['control-specular'].color.forEach((v, i) => near(v, [192 / 255, 119 / 255, 42 / 255][i]));
  near(resolved.model.roughness, 0.38);
  assert.equal(resolved.model.metallic, 1);
  const replaced = M.resolve({ ...resolved, controls: { roughness: 0.8, metalness: 0 } });
  assert.deepEqual(replaced.surface.layers['control-specular'].roughness, [0.8, 0.8]);
  assert(replaced.surface.layers.silk);
});
test('transmission uses intrinsic slab coverage without enormous extinction coefficients', () => {
  const { optical } = M.resolve({ controls: { transmission: 0.7, ior: 1.5, thickness: 0.0001 } }),
    rows = K.optical.frame(
      {
        count: 1,
        data: new Float32Array(16),
        opticalSplats: Float32Array.from(require('../src/optical-materials.js').pack(optical))
      },
      { eye: [0, 0, 4], view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], ortho: false },
      () => ({ normal: [0, 0, 1], position: () => [0, 0, 0] })
    );
  near(optical.coverage, 0.3);
  near(optical.absorption, 0);
  near(rows[0], 0.04 + 0.96 * 0.3);
  near(rows[1] + rows[2], 1);
});
function sculptScene(controls = { roughness: 0.3 }) {
  const B = makeBuilder(4, [0x10151c, 0x254e67, 0x4794b5, 0xadd4df, 0xb86c33, 0xf8cc86, 0xffffff]),
    s = K.sculpt(makeSculpt(B));
  s.sun = K.V.norm([0.3, 0.7, 1]);
  s.ball([-0.8, 0, 0], 0.6, { r: [1, 2, 3], controls }, { res: 0.11 });
  s.ball([0.8, 0, 0], 0.6, { r: [4, 5], controls: { roughness: 0.7 } }, { res: 0.11 });
  s.bake();
  return B.finish({ cam: { target: [0, 0, 0], dist: 4.7, yaw: 0, pitch: 0.1 }, dither: 0, look: { pixel: false } });
}
test('raw sculpt materials and JSON scenes bind controls before sampling and retain finishes', () => {
  const w = sculptScene({ transmission: 0.6, roughness: 0.2 });
  assert(w.opticalSplats);
  assert(w.surfaces.some(s => s.settings.materialControls));
  w.surfaces[0].settings.materialBaseColor.forEach((v, i) => near(v, [173, 212, 223][i] / 255));
  const spec = {
    id: 'controlled',
    solids: [
      {
        kind: 'ball',
        at: [0, 0, 0],
        r: 0.4,
        res: 0.14,
        mat: { role: 'stone', controls: { roughness: 0.2, coating: 1 } }
      }
    ]
  };
  const built = K.diorama.build(spec);
  assert(built.surfaces.some(s => s.settings.materialControls.coating.weight === 1));
  spec.solids[0].mat.controls.ior = 0;
  assert.throws(() => K.diorama.build(spec), /controls[\s\S]*IOR/);
});
test('live updates preserve geometry, unrelated profiles and advanced layers and fail atomically', () => {
  const w = sculptScene({ transmission: 0.6, roughness: 0.2 }),
    geometry = w.data.slice(),
    before = w.opticalSplats.slice(),
    other = w.surfaces[1].settings;
  const result = M.update(w, 1, { metalness: 0.3, coating: { weight: 0.8, roughness: 0.09 } });
  assert(result.count > 0);
  assert.equal(result.controls.roughness, 0.2);
  assert.equal(w.materialRevision, 1);
  assert.equal(w.surfaces[1].settings, other);
  assert.deepEqual(w.data, geometry);
  for (let i = 0; i < w.count; i++)
    if (w.surfaceData[i * 8] !== 1)
      assert.deepEqual(w.opticalSplats.subarray(i * 12, i * 12 + 12), before.subarray(i * 12, i * 12 + 12));
  const current = w.surfaces[0].settings,
    profiles = w.opticalSplats;
  assert.throws(() => M.update(w, 1, { ior: -1 }));
  assert.equal(w.surfaces[0].settings, current);
  assert.equal(w.opticalSplats, profiles);
  M.update(w, 1, { transmission: 0 });
  assert.equal(w.opticalSplats, undefined);
  assert.deepEqual(w.data, geometry);
});
test('headless rendering responds to roughness, metalness, IOR and coatings', () => {
  const { render } = require('../cli/render.js'),
    w = sculptScene(),
    settings = { w: 96, h: 72, px: 1, samples: true, edges: false };
  const first = render(w, settings).color;
  M.update(w, 1, { metalness: 1, roughness: 0.08, coating: 1, ior: 2 });
  const second = render(w, settings).color;
  assert(second.some((v, i) => Math.abs(v - first[i]) > 15));
  assert.equal(w.count, w.data.length / 16);
});
function single(kit, controls) {
  const { KIT: K, makeBuilder } = kit,
    B = makeBuilder(1, [0x05090e, 0x54879d, 0xffffff]),
    light = K.V.norm([0.5, 0.4, 1]),
    mat = K.material.resolve({ r: [1], controls }, { palette: [0x05090e, 0x54879d, 0xffffff] });
  B.surfaceNext(mat.surface, 0, 0, 1, light, 1);
  B.disc(0, 0, 0, [0, 0, 1], 0.7, 0.02, B.P[1], 3);
  return B.finish({
    cam: { target: [0, 0, 0], dist: 3, yaw: 0, pitch: 0 },
    radius: 2,
    dither: 0,
    look: { pixel: false }
  });
}
test(
  'native GPU controls match the shared finish at an opaque carrier and respond to live edits',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const run = require('../cli/look-webgl.js'),
      r = run({ hardware: true }, single, (kit, fixture, backend) => {
        const w = fixture(kit, { roughness: 0.6, metalness: 0.7, coating: 0.8 }),
          draw = backend(65, 65, { raw: true, dither: 0, damp: false }),
          sample = () => draw.sample({ center: [32, 32] }).center;
        try {
          draw.draw(w);
          const first = sample();
          draw.draw(w);
          const repeated = sample();
          draw.draw(w, { materialControls: false });
          const off = sample();
          kit.KIT.material.update(w, 1, { roughness: 0.1, metalness: 0, coating: 0 });
          draw.draw(w);
          const edited = sample();
          return { first, repeated, off, edited };
        } finally {
          draw.close();
        }
      });
    assert.deepEqual(r.first, r.repeated);
    assert.notDeepEqual(r.first, r.off);
    assert.notDeepEqual(r.first, r.edited);
    const w = single(kit, { roughness: 0.6, metalness: 0.7, coating: 0.8 }),
      prepared = S.prepare(w.surfaces[0].settings, w.pal, w.surfaces[0].light),
      base = [0x54, 0x87, 0x9d].map(v => v / 255),
      expected = S.shade(prepared, { position: [0, 0, 0], normal: [0, 0, 1], view: [0, 0, 1], visibility: 1 }, base);
    r.first.forEach((v, i) => near(v, expected[i] * 255, 4));
  }
);

test('CLI inspection and cold public imports expose the same mapping without dependencies', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    { execFileSync } = require('node:child_process'),
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-material-controls-'));
  try {
    const input = path.join(folder, 'material.json');
    fs.writeFileSync(input, JSON.stringify({ roughness: [0.1, 0.7], metalness: 0.4, ior: 1.6, coating: 0.8 }));
    const report = JSON.parse(
      execFileSync(process.execPath, ['cli/ink-studio.js', 'material-controls', input], {
        cwd: path.resolve(__dirname, '..'),
        encoding: 'utf8'
      })
    );
    near(report.dielectricF0, M.f0(1.6));
    assert.equal(report.controls.coating.weight, 0.8);
    assert(report.layers['control-coating']);
    const cold = execFileSync(
      process.execPath,
      [
        '-e',
        "const {MaterialControls,SurfaceLook}=require('.').load(); console.log(MaterialControls.describe({}).ior,typeof SurfaceLook.shade)"
      ],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }
    );
    assert.equal(cold.trim(), '1.5 function');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

function mixedNative(kit, options = {}) {
  const { KIT: K, makeBuilder, makeSculpt } = kit,
    B = makeBuilder(7, [0x0d1321, 0x19384c, 0x2d6a82, 0x72b5cb, 0xd8e8e1, 0xb37442, 0xffd495]),
    S = K.sculpt(makeSculpt(B));
  S.pixel = true;
  S.sun = [0, 0.6, 0.8];
  S.box([0, 0, -0.7], [1.2, 1, 0.08], { r: [5, 6] }, { res: 0.13 });
  S.ball(
    [0, 0, 0],
    0.65,
    { r: [1, 2, 3, 4], controls: { roughness: 0.4, metalness: 0.65, coating: 0.7 } },
    { res: 0.12, ghost: true }
  );
  S.bake();
  return B.finish({
    cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 },
    look: { pixel: true },
    dither: 0,
    areaLights: [
      K.lightEmitters.rectangle({
        id: 'panel',
        at: [-1, 1, 2],
        normal: [0, -0.4, -1],
        size: [1, 1],
        radius: 5,
        intensity: 3,
        sampleGrid: 1,
        shadows: false,
        visible: false
      })
    ]
  });
}
test(
  'native controls compose with patterned pixels, emitters and live optical coverage',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl.js')({ hardware: true }, mixedNative, (kit, fixture, backend) => {
      const world = fixture(kit),
        b = backend(96, 72, { dither: 0, damp: false }),
        binding = world.surfaces.findIndex(s => s.settings.materialControls) + 1;
      try {
        b.draw(world);
        const on = b.image();
        b.draw(world);
        const repeat = b.image();
        b.draw(world, { materialControls: false });
        const off = b.image();
        const before = world.data.slice();
        kit.KIT.material.update(world, binding, { metalness: 0, transmission: 1, ior: 1 });
        b.draw(world);
        const clear = b.image();
        kit.KIT.material.update(world, binding, { transmission: 0.4, ior: 2 });
        b.draw(world);
        const thick = b.image();
        const layer = world.surfaces[binding - 1].settings.layers['control-specular'];
        layer.mask = { type: 'checker', scale: 0.1 };
        world.materialRevision++;
        let rejected = 0;
        for (let i = 0; i < 2; i++)
          try {
            b.draw(world);
          } catch (error) {
            if (error.message.includes('Native material-control slots')) rejected++;
            else throw error;
          }
        delete layer.mask;
        world.materialRevision++;
        b.draw(world);
        b.image();
        return { on, repeat, off, clear, thick, rejected, unchanged: world.data.every((v, i) => v === before[i]) };
      } finally {
        b.close();
      }
    });
    assert.equal(result.on, result.repeat);
    assert.notEqual(result.on, result.off);
    assert.notEqual(result.clear, result.thick);
    assert(result.unchanged);
    assert.equal(result.rejected, 2);
  }
);
