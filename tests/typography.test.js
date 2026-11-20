const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  cp = require('node:child_process');
const core = require('..'),
  kit = core.load(),
  { Typography: T, KIT: K, makeBuilder, makeSculpt } = kit,
  Ty = K.typography;
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) <= e, `${a} != ${b}`),
  vec = (a, b, e = 1e-6) => a.forEach((x, i) => near(x, b[i], e));
const square = [['M', 0, 0], ['L', 600, 0], ['L', 600, 700], ['L', 0, 700], ['Z']];
const font = () =>
  T.font({
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 100,
    glyphs: {
      A: { advance: 700, commands: square },
      V: { advance: 650, commands: square },
      '😀': { advance: 1000, commands: square },
      ' ': { advance: 300, commands: [] },
      '?': { advance: 600, commands: square }
    },
    kerning: { 'A,V': -100 }
  });

// Entirely original, tiny SFNT fixture: triangle, implied quadratic contour and a composite.
function sfnt({ format = 12, gpos = 0 } = {}) {
  const u16 = (b, p, n) => b.writeUInt16BE(n & 65535, p),
    i16 = (b, p, n) => b.writeInt16BE(n, p),
    u32 = (b, p, n) => b.writeUInt32BE(n, p);
  const simple = points => {
    const b = Buffer.alloc(14 + points.length * 5);
    i16(b, 0, 1);
    u16(b, 10, points.length - 1);
    u16(b, 12, 0);
    let p = 14,
      x = 0,
      y = 0;
    for (const q of points) b[p++] = q[2] ? 1 : 0;
    for (const q of points) {
      i16(b, p, q[0] - x);
      x = q[0];
      p += 2;
    }
    for (const q of points) {
      i16(b, p, q[1] - y);
      y = q[1];
      p += 2;
    }
    return b;
  };
  const a = simple([
      [0, 0, 1],
      [600, 0, 1],
      [300, 700, 1]
    ]),
    b = simple([
      [0, 350, 0],
      [300, 700, 0],
      [600, 350, 0],
      [300, 0, 0]
    ]),
    composite = Buffer.alloc(18);
  i16(composite, 0, -1);
  u16(composite, 10, 3);
  u16(composite, 12, 2);
  i16(composite, 14, 80);
  i16(composite, 16, 120);
  const glyf = Buffer.concat([a, b, composite]),
    loca = Buffer.alloc(20);
  [0, 0, a.length, a.length + b.length, glyf.length].forEach((v, i) => u32(loca, i * 4, v));
  const head = Buffer.alloc(54);
  u16(head, 18, 1000);
  i16(head, 50, 1);
  const hhea = Buffer.alloc(36);
  i16(hhea, 4, 800);
  i16(hhea, 6, -200);
  u16(hhea, 34, 4);
  const hmtx = Buffer.alloc(16);
  [500, 650, 700, 720].forEach((v, i) => u16(hmtx, i * 4, v));
  const maxp = Buffer.alloc(6);
  u16(maxp, 4, 4);
  let sub;
  if (format === 12) {
    const groups = [
      [65, 65, 1],
      [86, 86, 2],
      [233, 233, 3],
      [0x1f600, 0x1f600, 3]
    ];
    sub = Buffer.alloc(16 + groups.length * 12);
    u16(sub, 0, 12);
    u32(sub, 4, sub.length);
    u32(sub, 12, groups.length);
    groups.forEach((g, i) => g.forEach((v, k) => u32(sub, 16 + i * 12 + k * 4, v)));
  } else {
    const cps = [65, 86, 233, 65535],
      ids = [1, 2, 3, 0],
      n = 4;
    sub = Buffer.alloc(16 + n * 8);
    u16(sub, 0, 4);
    u16(sub, 2, sub.length);
    u16(sub, 6, n * 2);
    cps.forEach((v, i) => {
      u16(sub, 14 + i * 2, v);
      u16(sub, 16 + n * 2 + i * 2, v);
      u16(sub, 16 + n * 4 + i * 2, ids[i] - v);
    });
  }
  const cmap = Buffer.alloc(12 + sub.length);
  u16(cmap, 2, 1);
  u16(cmap, 4, 3);
  u16(cmap, 6, format === 12 ? 10 : 1);
  u32(cmap, 8, 12);
  sub.copy(cmap, 12);
  const kern = Buffer.alloc(24);
  u16(kern, 2, 1);
  u16(kern, 6, 20);
  u16(kern, 8, 1);
  u16(kern, 10, 1);
  u16(kern, 18, 1);
  u16(kern, 20, 2);
  i16(kern, 22, -75);
  const tables = { head, hhea, maxp, hmtx, loca, glyf, cmap, kern };
  if (gpos) {
    let pair;
    if (gpos === 1) {
      pair = Buffer.alloc(24);
      [1, 18, 4, 0, 1, 12, 1, 2, -90, 1, 1, 1].forEach((v, i) => u16(pair, i * 2, v));
    } else {
      pair = Buffer.alloc(46);
      [2, 24, 4, 0, 30, 38, 2, 2, 0, 0, 0, -110, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1].forEach((v, i) =>
        u16(pair, i * 2, v)
      );
    }
    const g = Buffer.alloc(36 + pair.length);
    u32(g, 0, 0x10000);
    u16(g, 6, 10);
    u16(g, 8, 24);
    u16(g, 10, 1);
    g.write('kern', 12);
    u16(g, 16, 8);
    u16(g, 20, 1);
    u16(g, 24, 1);
    u16(g, 26, 4);
    u16(g, 28, 2);
    u16(g, 32, 1);
    u16(g, 34, 8);
    pair.copy(g, 36);
    tables.GPOS = g;
  }
  const names = Object.keys(tables),
    header = Buffer.alloc(12 + names.length * 16);
  u32(header, 0, 0x10000);
  u16(header, 4, names.length);
  let at = header.length;
  const chunks = [header];
  names.forEach((name, i) => {
    const data = tables[name],
      entry = 12 + i * 16;
    header.write(name, entry);
    u32(header, entry + 8, at);
    u32(header, entry + 12, data.length);
    chunks.push(data);
    at += data.length;
  });
  return Buffer.concat(chunks);
}
test('portable outlines preserve metrics, Unicode indices, kerning and multiline alignment', () => {
  const f = font(),
    run = T.layout('AV\n😀 A', f, { size: 2, align: 'center', tracking: 0.05 });
  near(run.lines[0].width, 2.55);
  near(run.lines[1].width, 4.1);
  near(run.glyphs[0].x, -1.275);
  near(run.glyphs[1].x, -0.025);
  assert.equal(run.glyphs.length, 5);
  assert.equal(run.glyphs[2].char, '😀');
  near(run.glyphs[2].y, -2.2);
  near(T.layout('AV', f, { kerning: false }).width, 1.35);
  near(T.layout('AV', f).width, 1.25);
  assert(Object.isFrozen(run.glyphs[0]));
  assert.equal(f.glyph('Ж'), f.glyph('?'));
});
test('quadratic and cubic outlines subdivide adaptively and retain counters', () => {
  const cs = [['M', 0, 0], ['Q', 500, 1000, 1000, 0], ['C', 800, -500, 200, -500, 0, 0], ['Z'], ...square];
  const coarse = T.flatten(cs, 40),
    fine = T.flatten(cs, 0.5);
  assert.equal(fine.length, 2);
  assert(fine[0].length > coarse[0].length);
  assert(fine[0].some(p => Math.abs(p[1] - 500) < 1e-8));
  const f = Ty.fonts.sans(),
    r = T.raster(f, 'O', { pixelsPerEm: 60 });
  const center = (Math.floor(r.height / 2) * r.width + Math.floor(r.width / 2)) * 4;
  assert.equal(r.rgba[center + 3], 0);
  assert(r.rgba.some((v, i) => i % 4 === 3 && v === 255));
  assert.equal(T.outline(f, 'O'), T.outline(f, 'O'));
});
for (const format of [4, 12])
  test('TrueType cmap ' + format + ' reads metrics, implied points, composites and legacy kerning', () => {
    const bytes = sfnt({ format }),
      f = T.trueType(bytes);
    assert.equal(f.unitsPerEm, 1000);
    assert.equal(f.glyph('A').id, 1);
    assert.equal(f.glyph('V').id, 2);
    assert.equal(f.glyph('é').id, 3);
    if (format === 12) assert.equal(f.glyph('😀').id, 3);
    near(f.kerning('A', 'V'), -75);
    assert(f.glyph('V').commands.some(c => c[0] === 'Q'));
    const b = T.outline(f, 'V'),
      c = T.outline(f, 'é');
    assert.equal(b[0].length, c[0].length);
    b[0].forEach((p, i) => vec(c[0][i], [p[0] + 80, p[1] + 120]));
    const view = new Uint8Array(bytes.length + 20);
    view.set(bytes, 7);
    assert.equal(T.trueType(view.subarray(7, bytes.length + 7)).glyph('A').advance, 650);
  });
for (const gpos of [1, 2])
  test('GPOS pair format ' + gpos + ' takes precedence over legacy kerning', () => {
    const f = T.trueType(sfnt({ gpos }));
    near(f.kerning('A', 'V'), gpos === 1 ? -90 : -110);
    near(T.trueType(sfnt({ gpos }), { kerning: { 'A,V': -42 } }).kerning('A', 'V'), -42);
  });
test('malformed and unsupported fonts fail with bounded, useful errors', () => {
  const bytes = sfnt();
  for (const n of [0, 4, 12, 100, bytes.length - 2]) assert.throws(() => T.trueType(bytes.subarray(0, n)));
  const otf = Buffer.from(bytes);
  otf.write('OTTO');
  assert.throws(() => T.trueType(otf), /glyf-based/);
  const corrupt = Buffer.from(bytes);
  corrupt.writeUInt32BE(0xffffffff, 20);
  assert.throws(() => T.trueType(corrupt), /offset/);
  const cycle = Buffer.from(bytes);
  const n = cycle.readUInt16BE(4);
  let glyf;
  for (let i = 0; i < n; i++)
    if (cycle.toString('ascii', 12 + i * 16, 16 + i * 16) === 'glyf') glyf = cycle.readUInt32BE(20 + i * 16);
  cycle.writeUInt16BE(3, glyf + 29 + 34 + 12);
  assert.throws(() => T.trueType(cycle).glyph('é'));
});
test('write-on measures total contour distance without connecting counters or separate contours', () => {
  const loops = [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2]
    ],
    [
      [5, 0],
      [6, 0],
      [6, 1],
      [5, 1]
    ]
  ];
  assert.deepEqual(T.strokes(loops, 0), []);
  const a = T.strokes(loops, 0.5);
  assert.equal(a.length, 1);
  vec(a[0].at(-1), [0, 2]);
  const b = T.strokes(loops, 0.75);
  assert.equal(b.length, 2);
  vec(b[1].at(-1), [6, 0]);
  assert.equal(T.strokes(loops, 1).length, 2);
});
test('glyph transforms are local, seekable, deterministic and independent of frame partitions', () => {
  const run = T.layout('AV A', font()),
    options = {
      position: [3, 1, 2],
      rotation: [0, 0, Math.PI / 2],
      scale: 2,
      writeOn: { duration: 1, stagger: 0.2 },
      scramble: { duration: 1, stagger: 0.1, seed: 72, chars: 'AV' },
      transform: (g, t) => ({
        position: [0, Math.sin(t + g.index), 0],
        rotation: [0, 0, g.index * 0.1],
        scale: 1 + g.index * 0.1
      })
    };
  const a = T.pose(run, 0.5, options);
  T.pose(run, 99, options);
  assert.deepEqual(T.pose(run, 0.5, options), a);
  vec(a[0].position, [3 - 2 * Math.sin(0.5), 1, 2]);
  near(a[1].progress, 0.3);
  assert.equal(a[2].char, ' ');
  assert.equal(T.pose(run, 4, options)[0].char, 'A');
  assert(a.every(f => f.matrix.every(Number.isFinite)));
});
test('curve typography uses transported orientation, wrapping, fit and open-path clipping', () => {
  const run = Ty.layout('FORM', { size: 0.4 }),
    path = K.curve.path([
      [0, 0, 0],
      [3, 0, 0]
    ]),
    f = T.pose(run, 0, { path, offset: 0.5 });
  vec(f[0].position, [0.5, 0, 0]);
  vec(K.M.app(f[0].matrix, [1, 0, 0]), [1, 0, 0]);
  const clipped = T.pose(run, 0, { path, offset: 9 });
  assert(clipped.every(g => g.opacity === 0));
  assert(T.pose(run, 0, { path, offset: 9, wrap: true }).every(g => g.opacity === 1));
  const circle = K.curve.create({ type: 'superellipse', radii: [2, 2], exponent: 2 }),
    a = T.pose(run, 0, { path: circle, offset: 0, wrap: true }),
    b = T.pose(run, 0, { path: circle, offset: circle.length, wrap: true });
  a.forEach((g, i) => vec(g.position, b[i].position));
  const fitted = T.pose(run, 0, { path, fit: true });
  near(Math.hypot(...fitted[0].matrix.slice(0, 3)), path.length / run.width);
});
test('bitmap font traces actual cell boundaries, retains holes and rasterises pixel-exact', () => {
  const bits = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]),
    f = T.bitmapFont(new Map([['O', bits]]), { width: 3, height: 3, baseline: 3 }),
    image = T.raster(f, 'O', { pixelsPerEm: 3, padding: 0 });
  assert.equal(T.outline(f, 'O').length, 2);
  assert.equal(image.width, 3);
  assert.equal(image.height, 3);
  bits.forEach((v, i) => assert.equal(image.rgba[i * 4 + 3], v * 255));
  assert(Ty.fonts.bitmap().has('Ω'));
});
test('fitting centered or right-aligned runs fills the path and clipped outline pens stay hidden', () => {
  const path = K.curve.path([
    [0, 0, 0],
    [4, 0, 0]
  ]);
  for (const align of ['center', 'right']) {
    const run = Ty.layout('FORM', { align });
    const frames = T.pose(run, 0, { path, fit: true });
    assert(frames.every(f => f.opacity === 1));
    near(frames[0].position[0], 0);
  }
  assert(Ty.outlineStrokes(Ty.layout('FORM'), 0, { path, offset: 20 }).every(f => f.strokes.length === 0));
});
function extrusion() {
  const B = makeBuilder(5, [0x0a1020, 0x2e71ab, 0xf8b855]),
    S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S),
    run = Ty.layout('AV', { size: 1 });
  const text = Ty.extrude(B, S, run, { rig, material: { r: [1, 2] }, position: [0, 1, 0], res: 0.07 });
  S.bake();
  const world = B.finish(),
    stage = K.stage(world);
  stage.t0 = 0;
  rig.bind(stage);
  return { B, S, rig, run, text, world, stage };
}
test('SDF text bakes once into stable native rig groups; write-on fully hides and restores coverage', () => {
  const { text, stage, world, run } = extrusion(),
    count = world.count,
    before = world.data.slice();
  const binding = stage.add(
    text.bind(stage, {
      sample: t =>
        T.pose(run, t, {
          position: [0, 1, 0],
          writeOn: { duration: 1, stagger: 0.1 },
          transform: g => ({ position: [0, g.index * 0.2, 0], rotation: [0, 0.2, 0] })
        })
    })
  );
  stage.update(0, 0);
  assert(text.ids.every(i => world.data[i * 16 + 3] === 0));
  stage.update(0.5, 0.5);
  assert(text.ids.some(i => world.data[i * 16 + 3] > 0));
  assert(text.ids.some(i => world.data[i * 16 + 3] === 0));
  stage.update(1, 2);
  assert(text.ids.every(i => world.data[i * 16 + 3] > 0));
  assert.equal(world.count, count);
  assert.notDeepEqual(world.data, before);
  assert.equal(binding.inspect().length, 2);
  assert(world.data.every(Number.isFinite));
});
test('animated glyphs release their actual posed splats and rejoin moving homes through native materialisation', () => {
  const { text, stage, world, run } = extrusion(),
    binding = stage.add(text.bind(stage, { sample: t => T.pose(run, t, { position: [t, 1, 0] }) }));
  stage.update(0.1, 0.1);
  const ids = text.ids.slice(0, 30),
    fx = stage.add(binding.materialise({ ids: undefined, drag: 0 })); // text owns the exact selection
  const before = world.data.slice();
  fx.release({ ids, velocity: [2, 0, 0], normalImpulse: 0 });
  fx.advance(0.2);
  assert.notEqual(world.data[ids[0] * 16], before[ids[0] * 16]);
  fx.rejoin({ duration: 0.4 });
  stage.update(0.1, 0.4);
  fx.advance(0.5);
  assert.equal(fx.stats.home, text.ids.length);
  assert(world.data.every(Number.isFinite));
});
test('bitmap sprite typography shares layout, curve frames and seeded scrambling without rebuilding textures', () => {
  const run = Ty.layout('AV A', { font: Ty.fonts.bitmap(), size: 0.8 }),
    builder = kit.SpriteSurface.make(256),
    text = Ty.sprites(builder, run, { scrambleChars: 'VA', pixelsPerEm: 8 }),
    atlas = builder.finish(),
    pixels = atlas.pixels.slice(),
    binding = text.bind(atlas, {
      sample: t => T.pose(run, t, { position: [0, t, 0], scramble: { chars: 'VA', duration: 1, seed: 6 } })
    }),
    before = atlas.vertices.slice();
  binding.update(0, 0.4);
  assert.notDeepEqual(atlas.vertices, before);
  assert.deepEqual(atlas.pixels, pixels);
  assert.equal(atlas.geometryRevision, 1);
  binding.update(0, 0.4);
  assert.equal(atlas.geometryRevision, 1);
  binding.update(0, 2);
  assert.equal(atlas.geometryRevision, 2);
  assert.equal(atlas.vertices.length, run.glyphs.length * 6 * 5);
  assert(atlas.vertices.every(Number.isFinite));
});
test('invalid outlines, layouts and animations are rejected instead of emitting NaNs', () => {
  for (const commands of [[['L', 0, 0]], [['M', 0, 0]], [['M', 0, 0], ['C', 1, 2], ['Z']]])
    assert.throws(() => T.flatten(commands));
  for (const options of [{ size: 0 }, { tracking: NaN }, { align: 'middle' }, { lineHeight: -1 }])
    assert.throws(() => T.layout('A', font(), options));
  for (const options of [
    { scale: -1 },
    { position: [NaN, 0, 0] },
    { writeOn: { duration: 0 } },
    { scramble: { chars: '' } },
    { transform: () => ({ opacity: 2 }) }
  ])
    assert.throws(() => T.pose(T.layout('A', font()), 0, options));
  assert.throws(() => T.raster(font(), 'A', { pixelsPerEm: 0 }));
});
test('typography is exported by CommonJS, browser and ES module bundles without third-party imports', () => {
  const local = require('../src/typography.js');
  assert.equal(
    local.layout(
      'AV',
      local.font({
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        glyphs: { A: { advance: 700, commands: square } }
      })
    ).width,
    1.3
  );
  assert(core.bundle({ format: 'module' }).includes('export { Typography,'));
  assert.equal(typeof K.typography.extrude, 'function');
  assert.equal(typeof K.typography.sprites, 'function');
});
test('portable font definitions are snapshots of authored outlines and kerning', () => {
  const definition = {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: { A: { advance: 700, commands: square.map(c => c.slice()) } },
    kerning: { 'A,A': -30 }
  };
  const f = T.font(definition);
  definition.glyphs.A.commands[1][1] = 99999;
  definition.glyphs.A.advance = 99;
  definition.kerning['A,A'] = 30;
  assert.equal(f.glyph('A').commands[1][1], 600);
  assert.equal(f.glyph('A').advance, 700);
  assert.equal(f.kerning('A', 'A'), -30);
});
test('CLI inspects portable fonts, imported TrueType, curve placement and animated progress', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-type-'));
  try {
    const file = path.join(dir, 'type.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        text: 'AV',
        layout: { size: 2 },
        animation: { writeOn: { duration: 1, stagger: 0.2 } },
        path: { type: 'superellipse', radii: [3, 2], exponent: 2 }
      })
    );
    const run = (args = []) =>
      JSON.parse(
        cp.execFileSync(process.execPath, ['cli/ink-studio.js', 'typography', file, '--at', '.6', ...args], {
          cwd: path.resolve(__dirname, '..')
        })
      );
    const native = run();
    assert.equal(native.font.name, 'Ink Sans');
    near(native.glyphs[0].progress, 0.6);
    near(native.glyphs[1].progress, 0.4);
    assert(native.glyphs[0].outline.contours > 0);
    assert(native.glyphs[0].pathDistance !== null);
    fs.writeFileSync(path.join(dir, 'test.ttf'), sfnt());
    const imported = run(['--font', 'test.ttf']);
    assert.equal(imported.font.name, 'test.ttf');
    near(imported.width, (650 + 700 - 75) * 0.002);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('invalid custom poses fail before updating sprite geometry', () => {
  const run = Ty.layout('AV'),
    builder = kit.SpriteSurface.make(256),
    text = Ty.sprites(builder, run),
    atlas = builder.finish(),
    before = atlas.vertices.slice(),
    binding = text.bind(atlas, {
      sample: t => {
        const poses = T.pose(run, t);
        poses[1].position[0] = NaN;
        return poses;
      }
    });
  assert.throws(() => binding.update(0, 0), /finite/);
  assert.deepEqual(atlas.vertices, before);
});
function renderFixture(kit) {
  const K = kit.KIT,
    T = K.typography,
    B = kit.makeBuilder(3, [0x081226, 0x67bcd5, 0xffc282]),
    S = K.sculpt(kit.makeSculpt(B)),
    rig = K.rig(B, S),
    run = T.layout('O', { size: 2, align: 'center' }),
    state = { turn: 0, label: 0 };
  const text = T.extrude(B, S, run, { rig, material: { r: [1, 2] }, res: 0.065, depth: 0.25 });
  S.bake();
  const surfaces = typeof SpriteSurface !== 'undefined' ? SpriteSurface : kit.SpriteSurface,
    atlas = surfaces.make(256),
    label = T.sprites(atlas, T.layout('AV', { font: T.fonts.bitmap(), size: 0.55, align: 'center' }), {
      position: [0, 1.8, 0],
      pixelsPerEm: 8,
      color: 0xffc282,
      scrambleChars: 'VA'
    });
  const world = B.finish({ spriteSurfaces: atlas.finish() });
  world.cam = { target: [0, 0.9, 0], dist: 4, yaw: 0, pitch: 0 };
  world.radius = 5;
  world.look = { pixelSize: 1, clean: 1 };
  world.fog = { c: 0, start: 1, max: 0 };
  const stage = K.stage(world);
  stage.t0 = 0;
  rig.bind(stage);
  stage.add(
    text.bind(stage, {
      sample: t => T.pose(run, t, { writeOn: { duration: 1 }, transform: () => ({ rotation: [0, state.turn, 0] }) })
    })
  );
  stage.add(
    label.bind(world.spriteSurfaces, {
      sample: t => T.pose(label.layout, t, { position: [state.label, 1.8, 0] })
    })
  );
  return { world, stage, state };
}
test('software renderer shows animated SDF text and respects changed sprite geometry', () => {
  const { world, stage, state } = renderFixture(kit),
    render = () => core.render(world, { w: 160, h: 128, px: 1, raw: true });
  stage.update(0, 0);
  const hidden = render();
  stage.update(0.5, 0.5);
  const writing = render();
  stage.update(1, 2);
  const full = render();
  assert.notDeepEqual(hidden.rgb, writing.rgb);
  assert.notDeepEqual(writing.rgb, full.rgb);
  assert.deepEqual(render().rgb, full.rgb);
  state.turn = 0.7;
  stage.update(0, 2);
  assert.notDeepEqual(render().rgb, full.rgb);
  const posed = render().rgb;
  state.label = 0.7;
  stage.update(0, 2);
  assert.notDeepEqual(render().rgb, posed);
  assert(world.spriteSurfaces.geometryRevision > 0);
});
test(
  'native WebGL updates glyph transforms, coverage and sprite atlas revisions',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl.js')({}, renderFixture, (kit, fixture, backend) => {
      const { world, stage, state } = fixture(kit),
        draw = backend(160, 128, { raw: true });
      try {
        stage.update(0, 0);
        draw.draw(world, { changedRows: undefined });
        const hidden = draw.image();
        stage.update(0.5, 0.5);
        draw.draw(world, { changedRows: undefined });
        const writing = draw.image();
        stage.update(1, 2);
        draw.draw(world, { changedRows: undefined });
        const full = draw.image();
        draw.draw(world, { changedRows: [] });
        const repeat = draw.image();
        state.turn = 0.7;
        stage.update(0, 2);
        draw.draw(world, { changedRows: undefined });
        const posed = draw.image();
        state.label = 0.7;
        stage.update(0, 2);
        draw.draw(world, { changedRows: undefined });
        return {
          sprite: draw.image() !== posed,
          reveal: hidden !== writing && writing !== full,
          pure: repeat === full,
          pose: posed !== full,
          atlas: world.spriteSurfaces.geometryRevision > 0,
          finite: world.data.every(Number.isFinite)
        };
      } finally {
        draw.close();
      }
    });
    assert(result.reveal && result.pure && result.pose && result.sprite && result.atlas && result.finite);
  }
);
