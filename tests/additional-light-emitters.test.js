const test = require('node:test'),
  assert = require('node:assert/strict'),
  ink = require('..'),
  kit = ink.load(),
  { KIT: K, AreaLights: A, LightCookies: C, makeBuilder, makeSculpt } = kit;
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) <= e, `${a} != ${b}`),
  vec = (a, b, e = 1e-6) => a.forEach((n, i) => near(n, b[i], e));
const lamp = {
  id: 'panel',
  at: [0, 0, 2],
  normal: [0, 0, -1],
  size: [1, 0.6],
  intensity: 4,
  shadows: false,
  visible: false
};
test('rectangle, elliptical disc and line emitters use bounded deterministic quadrature', () => {
  const rectangle = A.prepare([lamp])[0],
    disc = A.prepare([{ ...lamp, shape: 'disk' }])[0],
    line = A.prepare([{ ...lamp, shape: 'line', size: [3, 0.05] }])[0];
  assert.equal(rectangle.points.length, 16);
  assert.equal(disc.points.length, 16);
  assert.equal(line.points.length, 4);
  assert(disc.points.every(p => (p[0] / 0.5) ** 2 + (p[1] / 0.3) ** 2 <= 1));
  assert(line.points.every(p => Math.abs(p[1]) < 1e-9));
  const left = A.evaluate([line], [0, 0, 0], [0, 0, 1]),
    right = A.evaluate([line], [0, 0, 4], [0, 0, -1]);
  vec(left, right);
  assert(A.evaluate([rectangle], [0, 0, 4], [0, 0, -1]).every(n => n === 0));
  assert(A.evaluate([rectangle], [0, 0, 0], [0, 0, -1]).every(n => n === 0));
  assert(A.evaluate([line], [0, 0, 20], [0, 0, -1]).every(n => n === 0));
});
test('line endpoints define the emitter frame and smooth zero-length mistakes fail', () => {
  const raw = K.lightEmitters.line({ id: 'tube', from: [1, 2, 3], to: [4, 2, 3], width: 0.1, normal: [0, 0, 1] }),
    l = A.prepare([raw])[0];
  vec(l.at, [2.5, 2, 3]);
  vec(l.u, [1, 0, 0]);
  assert(l.points.every(p => p[0] >= 1 && p[0] <= 4));
  near(l.half[0], 1.55);
  assert.throws(() => K.lightEmitters.line({ id: 'bad', from: [0, 0, 0], to: [0, 0, 0] }));
  assert.throws(() => K.lightEmitters.line({ id: 'bad', from: [0, 0, 0], to: [1, 0, 0], normal: [1, 0, 0] }));
});
test('animated positions, normals, color and cookie roll are evaluated once at the requested time', () => {
  const calls = { at: 0, intensity: 0, roll: 0 },
    source = {
      ...lamp,
      at: t => {
        calls.at++;
        return [t, 0, 2];
      },
      intensity: t => {
        calls.intensity++;
        return t + 1;
      },
      cookie: {
        width: 2,
        height: 1,
        mask: [255, 0],
        roll: t => {
          calls.roll++;
          return t * 180;
        },
        angle: 33
      }
    };
  const l = A.prepare([source], { time: 1 })[0];
  assert.deepEqual(calls, { at: 1, intensity: 1, roll: 1 });
  vec(l.at, [1, 0, 2]);
  near(l.intensity, 2);
  near(l.volumeIntensity, 2);
  assert(A.transmission(l, [1.5, 0, 0])[0] > 0);
  assert.equal(A.transmission(l, [0.5, 0, 0])[0], 0);
});
test('colored and alpha cookies transmit actual channels with nearest or linear filtering', () => {
  const raw = { width: 2, height: 1, rgba: [255, 0, 0, 255, 0, 0, 255, 128] },
    nearest = C.prepare(raw);
  vec(C.sample(nearest, 0.25, 0.5), [1, 0, 0]);
  vec(C.sample(nearest, 0.75, 0.5), [0, 0, 128 / 255]);
  assert(C.sample(nearest, -0.1, 0.5).every(n => n === 0));
  const linear = C.prepare({ ...raw, filter: 'linear' });
  vec(C.sample(linear, 0.5, 0.5), [0.5, 0, 64 / 255]);
  const source = A.prepare([{ ...lamp, cookie: raw }])[0];
  const left = A.evaluate([source], [-0.5, 0, 0], [0, 0, 1]),
    right = A.evaluate([source], [0.5, 0, 0], [0, 0, 1]);
  assert(left[0] > 0 && left[1] === 0 && left[2] === 0);
  assert(right[2] > 0 && right[0] === 0 && right[1] === 0);
});
test('cached cookie rasters have explicit invalidation and revision control', () => {
  const raw = { width: 1, height: 1, mask: [255] },
    first = C.prepare(raw);
  raw.mask[0] = 0;
  assert.equal(C.prepare(raw), first);
  C.invalidate(raw);
  assert.equal(C.prepare(raw).data[0], 0);
  raw.mask[0] = 128;
  raw.revision = 1;
  assert.equal(C.prepare(raw).data[0], 128);
});
test('procedural stencils are deterministic portable byte assets and repeat/offset stays in the lens', () => {
  for (const pattern of ['stripes', 'checker', 'rings', 'rosette', 'window', 'stainedGlass']) {
    const options = { pattern, width: 32, height: 24, colors: ['#ff0000', '#00ccff'] },
      a = C.pattern(options),
      b = C.pattern(options);
    assert.deepEqual(a, b);
    assert(a.rgba.some((v, i) => i % 4 !== 3 && v > 0));
    assert(a.rgba.some((v, i) => i % 4 !== 3 && v === 0));
  }
  const raw = { width: 2, height: 1, mask: [255, 0], angle: 33, repeat: [2, 1], offset: [0.25, 0], wrap: true },
    p = C.projection(raw, [0, 0, -1], 40);
  assert(p.wrap);
  assert.equal(p.sample([0, 0, 1], -1)[0], 0);
});
test('shared static shadow queries stop at the source and a bounded SDF cache retains geometry', () => {
  const source = {
    bounds: { min: [-0.2, -0.5, -0.2], max: [0.2, 0.5, 0.2] },
    distance: (x, y, z) => Math.max(Math.abs(x) - 0.2, Math.abs(y) - 0.5, Math.abs(z) - 0.2)
  };
  assert(A.occludes([source], [-1, 0, 0], [1, 0, 0], 2));
  assert(!A.occludes([source], [-1, 0, 0], [1, 0, 0], 0.5));
  const field = A.shadowField([source], { resolution: 24 });
  assert(field.data.some(n => n < 0));
  assert(field.data.every(Number.isFinite));
  assert(field.size.every(n => n <= 24));
  assert.throws(() => A.shadowField([source], { resolution: 200 }));
  const full = A.evaluate(A.prepare([{ ...lamp, shadows: true }]), [0, 0, 0], [0, 0, 1]),
    blocked = A.evaluate(A.prepare([{ ...lamp, shadows: true }]), [0, 0, 0], [0, 0, 1], [0, 0, 0], {
      shadow: () => true
    });
  assert(full.some(n => n > 0));
  assert(blocked.every(n => n === 0));
});
test('invalid light definitions and malformed byte textures fail before rendering', () => {
  for (const bad of [
    { ...lamp, shape: 'sphere' },
    { ...lamp, shape: 'line', size: [0.01, 2] },
    { ...lamp, size: [0, 1] },
    { ...lamp, normal: [0, 0, 0] },
    { ...lamp, intensity: () => NaN },
    { ...lamp, volumeIntensity: -1 }
  ])
    assert.throws(() => A.prepare([bad]));
  for (const raw of [
    { width: 1, height: 1, mask: [256] },
    { width: 2, height: 2, mask: [0] },
    { width: 1, height: 1, mask: [0], rgb: [0, 0, 0] },
    { width: 1, height: 1, rgb: [0, NaN, 0] }
  ])
    assert.throws(() => C.prepare(raw));
  assert.throws(() => C.pattern({ pattern: 'bad' }));
});
function room(kit, { fog = false, surface = false, blocker = false } = {}) {
  const { KIT: K, makeBuilder, makeSculpt } = kit,
    B = makeBuilder(5, [0x080e1e, 0x555555, 0x777777]),
    S = K.sculpt(makeSculpt(B));
  S.keepRenderSdf = true;
  S.box([0, 0, -0.6], [1.8, 1.2, 0.1], { r: [1], materialId: 'wall' }, { res: 0.08 });
  if (blocker) S.box([-0.35, 0, 0.3], [0.12, 0.7, 0.12], { r: [2] }, { res: 0.08 });
  S.bake();
  const area = {
    id: 'window',
    at: [0, 0, 1.3],
    normal: [0, 0, -1],
    size: [0.25, 0.25],
    color: '#ffffff',
    intensity: 7,
    sampleGrid: 2,
    radius: 6,
    visible: false,
    shadows: blocker,
    cookie: { width: 2, height: 1, rgb: [255, 0, 0, 0, 0, 255], angle: 40 }
  };
  const world = B.finish({
    cam: { target: [0, 0, -0.25], dist: 5, yaw: 0, pitch: 0 },
    radius: 6,
    look: { pixelSize: 1, splatCoverage: 'continuous' },
    areaLights: [area]
  });
  if (fog) {
    world.atmosphere = [
      K.atmosphere.box({
        min: [-1.7, -1, -0.4],
        max: [1.7, 1, 1],
        density: 0.35,
        color: '#ffffff',
        lit: true,
        step: 0.1
      })
    ];
    world.volumeLighting = { ambient: 0.02 };
  }
  if (surface) {
    const API = typeof SpriteSurface !== 'undefined' ? SpriteSurface : kit.SpriteSurface,
      atlas = API.make(64);
    atlas.face([-1.7, -1.1, -0.48], [3.4, 0, 0], [0, 2.2, 0], 48, 32, () => 0x555555);
    world.spriteSurfaces = atlas.finish();
  }
  return { world, area };
}
test('software colored projections affect SDF and sprite receivers while fog coverage remains independent', () => {
  for (const surface of [false, true]) {
    const { world } = room(kit, { surface, fog: true }),
      options = { w: 112, h: 88, px: 1, raw: true, captureFog: true },
      off = ink.render(world, { ...options, areaLights: false }),
      on = ink.render(world, options);
    assert.notDeepEqual(on.rgb, off.rgb);
    assert.deepEqual(on.fog, off.fog);
    const x = on.w / 2;
    let red = 0,
      blue = 0;
    for (let y = 15; y < 65; y++)
      for (let xx = 12; xx < 100; xx++) {
        const q = (y * on.w + xx) * 3;
        if (xx < x) red += on.rgb[q] - on.rgb[q + 2];
        else blue += on.rgb[q + 2] - on.rgb[q];
      }
    assert(red > 300 && blue > 300);
  }
});
test(
  'native shaped lights, colored cookies, textured surfaces, fog and moving sources use the browser renderer',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const r = require('../cli/look-webgl.js')({}, room, (kit, fixture, backend) => {
      const results = [];
      for (const surface of [false, true]) {
        const { world, area } = fixture(kit, { surface, fog: true, blocker: true }),
          b = backend(112, 88, { raw: true });
        try {
          b.draw(world, { areaLights: false });
          const off = b.image();
          b.draw(world);
          const full = b.image(),
            pixels = b.sample({ left: [39, 40], right: [73, 40] });
          b.draw(world);
          const repeat = b.image();
          b.draw(world, { areaLights: [{ ...area, shadows: false }] });
          const clear = b.image();
          b.draw(world, { areaLights: [{ ...area, at: [1, 0.5, 1.3] }] });
          const moved = b.image();
          results.push({
            surface,
            lit: full !== off,
            pure: full === repeat,
            shadow: full !== clear,
            moved: full !== moved,
            pixels
          });
        } finally {
          b.close();
        }
      }
      return { results };
    });
    for (const r0 of r.results) {
      assert(r0.lit && r0.pure && r0.shadow && r0.moved, JSON.stringify(r0));
      assert(r0.pixels.right[2] > r0.pixels.right[0]);
    }
  }
);

test('pattern assets round-trip through JSON and tools inspect source frames', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    cp = require('node:child_process'),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-emitters-'));
  try {
    const cookie = K.lightEmitters.cookie({ pattern: 'rosette', width: 12, height: 12 }),
      copy = JSON.parse(JSON.stringify(cookie));
    assert(Array.isArray(copy.rgba));
    assert.deepEqual(C.prepare(copy).data, C.prepare(cookie).data);
    const file = path.join(dir, 'lights.json');
    fs.writeFileSync(file, JSON.stringify([K.lightEmitters.disc({ ...lamp, cookie: copy })]));
    const report = JSON.parse(
      cp.execFileSync(process.execPath, ['cli/ink-studio.js', 'light-emitters', file, '--at', '1.2'], {
        cwd: path.resolve(__dirname, '..')
      })
    );
    assert.equal(report.emitters[0].shape, 'disk');
    assert.equal(report.emitters[0].cookie.width, 12);
    assert.equal(report.time, 1.2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('two-sided atlas receivers take front-side direct lighting without fog', () => {
  const { world } = room(kit, { surface: true }),
    off = ink.render(world, { w: 112, h: 88, px: 1, raw: true, areaLights: false }),
    on = ink.render(world, { w: 112, h: 88, px: 1, raw: true });
  assert.notDeepEqual(on.rgb, off.rgb);
  const q = (44 * 112 + 39) * 3;
  assert(on.rgb[q] > off.rgb[q]);
  assert(on.rgb[q] > on.rgb[q + 2]);
});
test(
  'native reused stamps have separate receiver charts and cookie changes invalidate the cache',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl.js')({}, room, (kit, fixture, backend) => {
      const { world, area } = fixture(kit),
        S = typeof SpriteSurface !== 'undefined' ? SpriteSurface : kit.SpriteSurface,
        a = S.make(16),
        region = a.reserve(8, 8, () => 0x666666);
      a.faceRegion([-1.5, -0.6, 0], [1, 0, 0], [0, 1.2, 0], region);
      a.faceRegion([0.5, -0.6, 0], [1, 0, 0], [0, 1.2, 0], region);
      world.spriteSurfaces = a.finish();
      const b = backend(112, 88, { raw: true });
      try {
        b.draw(world);
        const first = b.sample({ left: [35, 44], right: [77, 44] }),
          image = b.image();
        b.draw(world, { areaLights: [{ ...area, cookie: { ...area.cookie, rgb: [0, 0, 255, 255, 0, 0] } }] });
        return { first, swapped: b.sample({ left: [35, 44], right: [77, 44] }), changed: image !== b.image() };
      } finally {
        b.close();
      }
    });
    assert(result.first.left[0] > result.first.left[2] + 8);
    assert(result.first.right[2] > result.first.right[0] + 8);
    assert(result.swapped.left[2] > result.swapped.left[0] + 8);
    assert(result.changed);
  }
);
test(
  'native planar captures respect independent emitter reflection visibility',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl.js')(
      {},
      () => null,
      (kit, fixture, backend) => {
        const K = kit.KIT,
          B = kit.makeBuilder(1, [0x101525, 0x777777]),
          S = K.sculpt(kit.makeSculpt(B)),
          plane = K.reflection.plane({ id: 'pool' }),
          water = K.reflection.material({ r: [1] }, 'pool', { f0: 1, strength: 1, distortion: 0 });
        S.box([0, -0.825, -0.5], [2.4, 0.025, 2.5], { r: [1] }, { res: 0.13 });
        S.bake();
        const lamp = {
            id: 'reflection',
            at: [0, 1, -2],
            normal: [0, 0, 1],
            shape: 'disk',
            size: [0.8, 1],
            intensity: 3,
            color: '#ffcc77',
            twoSided: true,
            shadows: false,
            visible: false
          },
          world = B.finish({
            cam: { target: [0, 0, 0], yaw: 0, pitch: Math.atan(0.5), dist: Math.sqrt(45) },
            radius: 6,
            reflections: [plane],
            areaLights: [lamp]
          }),
          b = backend(112, 96, { raw: true });
        const waters = K.procedural.waterBodies;
        world.water = waters.scene([
          waters.create({
            id: 'lake',
            bounds: { min: [-2.4, -3], max: [2.4, 2] },
            resolution: [16, 16],
            sample: () => ({ bed: -0.8, surface: 0 }),
            optics: {
              tint: [0, 0, 0],
              extinction: [0, 0, 0],
              surfaceColor: [1, 1, 1],
              surface: 1,
              refraction: 0,
              foam: 0,
              caustics: 0,
              reflection: { plane: 'pool', distortion: 0 }
            }
          })
        ]);
        try {
          b.draw(world);
          const on = b.image();
          b.draw(world, { areaLights: [{ ...lamp, reflection: false }] });
          return { changed: on !== b.image() };
        } finally {
          b.close();
        }
      }
    );
    assert(result.changed);
  }
);

test('cold CommonJS loading permits direct destructured public names', () => {
  const cp = require('node:child_process'),
    path = require('node:path');
  const names = ['AreaLights', 'LightCookies', 'VolumeLight', 'ColorSpace'];
  const source = `const {${names.join(',')}}=require(${JSON.stringify(path.resolve(__dirname, '..'))}).load();process.stdout.write([${names.map(n => 'typeof ' + n).join(',')}].join(','));`;
  assert.equal(cp.execFileSync(process.execPath, ['-e', source], { encoding: 'utf8' }), 'object,object,object,object');
});
test('hierarchy-bound emitters transform normals correctly under shear while size stays in world units', () => {
  const matrix = [2, 0.5, 0.3, 0, 1, 0.4, 0, 0, 1],
    position = [3, 2, 1],
    graph = { toWorld: (id, v) => K.V.add(K.M.app(matrix, v), position) },
    source = K.lightEmitters.follow(graph, 'lamp', { ...lamp, at: t => [t, 0, 0] });
  const light = A.prepare([source], { time: 1 })[0];
  vec(light.at, [5, 2, 1]);
  near(K.V.dot(light.normal, K.M.app(matrix, [1, 0, 0])), 0);
  near(K.V.dot(light.normal, K.M.app(matrix, [0, 1, 0])), 0);
  vec(light.half, [0.5, 0.3]);
});

test('optional emitter support preserves an existing relight result in older toolkit hosts', async () => {
  const { createLightEmitters } = await import('../src/webgl/light-emitters.mjs');
  const optional = createLightEmitters(null, null, {}, 0, { KIT: {} });
  assert.equal(optional.prepare(), null);
  assert.equal(optional.compose(null, null, 0, null, true), true);
  assert.equal(optional.compose(null, null, 0, null, false), false);
});
