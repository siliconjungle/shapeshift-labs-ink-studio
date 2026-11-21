const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..'),
  R = require('../src/render-grid');
const kit = ink.load();
const near = (a, b, e = 1e-8) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
const area = v =>
  Math.abs(
    v.reduce((s, p, i) => {
      const q = v[(i + 1) % v.length];
      return s + p[0] * q[1] - p[1] * q[0];
    }, 0)
  ) / 2;
function inside(v, p) {
  return v.every((a, i) => {
    const b = v[(i + 1) % v.length];
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-8;
  });
}
test('all three lattices tile without overlapping interiors, with shared complete edges', () => {
  for (const mode of R.modes)
    for (const angle of [0, 0.37]) {
      const p = R.prepare({ mode, size: 13.7, angle, origin: [-12.3, 8.7], aspect: 1.37 });
      const cells = R.cells(p, [-32, -32, 64, 64]);
      const expected =
        (mode === 'hex' ? Math.sqrt(3) / 2 : mode === 'triangle' ? Math.sqrt(3) / 4 : 0.25) * p.size ** 2 * p.aspect;
      for (const c of cells) {
        near(area(c.vertices), expected, 1e-7);
        assert.equal(R.cellAt(p, ...c.center).id, c.id);
        near(R.cellAt(p, ...c.center).edge, 1);
        for (let i = 0; i < c.vertices.length; i++) {
          const a = c.vertices[i],
            b = c.vertices[(i + 1) % c.vertices.length],
            m = a.map((v, k) => (v + b[k]) / 2);
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const neighbor = R.cellAt(
            p,
            m[0] + ((b[1] - a[1]) / length) * 0.0001,
            m[1] - ((b[0] - a[0]) / length) * 0.0001
          );
          assert.notEqual(neighbor.id, c.id);
          assert(neighbor.vertices.some(v => Math.hypot(v[0] - a[0], v[1] - a[1]) < 1e-6));
          assert(neighbor.vertices.some(v => Math.hypot(v[0] - b[0], v[1] - b[1]) < 1e-6));
        }
      }
      for (let i = 0; i < 160; i++) {
        const x = -31.9 + ((i * 0.61803398875) % 1) * 63.8,
          y = -31.7 + ((i * 0.41421356237) % 1) * 63.4;
        const c = R.cellAt(p, x, y),
          containing = cells.filter(c => inside(c.vertices, [x, y]));
        assert.equal(containing.length, 1, mode + ' ' + [x, y]);
        assert.equal(containing[0].id, c.id);
      }
    }
});
test('grid settings are immutable, reject invalid input, and bound allocation and enumeration', () => {
  const definition = { mode: 'hex', origin: [1, 2], gapColor: [3, 4, 5] };
  const p = R.prepare(definition);
  definition.origin[0] = 99;
  definition.gapColor[0] = 99;
  assert.deepEqual(p.origin, [1, 2]);
  assert.deepEqual(p.gapColor, [3, 4, 5]);
  assert.equal(R.prepare(p), p);
  for (const d of [
    null,
    true,
    [],
    { mode: 'circle' },
    { size: 0 },
    { size: Infinity },
    { gap: -1 },
    { gap: 0.9 },
    { aspect: 0 },
    { origin: [0] },
    { origin: [NaN, 1] },
    { angle: Infinity },
    { gapColor: [1, 2, 256] },
    { gapColor: [1.1, 2, 3] },
    { maxPixels: 1.1 },
    { maxPixels: 0 },
    { typo: 3 }
  ])
    assert.throws(() => R.prepare(d));
  assert.throws(() => R.cellAt(false, 0, 0));
  assert.throws(() => R.cellAt('hex', NaN, 0));
  assert.throws(() => R.dimensions(R.prepare({ maxPixels: 12 }), 4, 4));
  assert.throws(() => R.dimensions(p, 2.5, 5));
  assert.throws(() => R.cells(p, [0, 0, 10000, 10000], { maxCells: 20 }));
  assert.throws(() => R.cells(p, [0, 0, -1, 2]));
  assert.throws(() => R.apply({ w: 2, h: 2, rgb: new Uint8Array(3) }, p));
  assert.equal(kit.KIT.renderGrid.modes.join(','), R.modes.join(','));
  assert.deepEqual(JSON.parse(JSON.stringify(p)), JSON.parse(JSON.stringify(kit.KIT.renderGrid.prepare(p))));
  assert.deepEqual(R.cellAt(kit.KIT.renderGrid.prepare(p), 5, 7), R.cellAt(p, 5, 7));
  assert.throws(() => R.prepare({ origin: new Array(2) }));
  assert.throws(() => R.prepare({ gapColor: new Array(3) }));
  assert.throws(() => R.cells(p, new Array(4)));
});
test('cell IDs and geometry are independent of viewport extent and preserve negative coordinates', () => {
  for (const mode of R.modes) {
    const p = R.prepare({ mode, size: 11, origin: [3, -2], angle: -0.27 });
    const small = R.cells(p, [-20, -20, 40, 40]),
      large = new Map(R.cells(p, [-80, -80, 160, 160]).map(c => [c.id, c]));
    for (const c of small) assert.deepEqual(c, large.get(c.id));
    assert(small.some(c => c.address[0] < 0));
    assert(small.some(c => c.address[1] < 0));
  }
});
test('CPU resolver samples a single palette colour per cell, clips frame boundaries and retains alpha', () => {
  const w = 53,
    h = 37,
    rgb = Uint8Array.from({ length: w * h * 3 }, (_, i) => (i * 31) % 256),
    alpha = Uint8Array.from({ length: w * h }, (_, i) => i % 256);
  const input = { w, h, rgb, alpha, metadata: 'retained' };
  assert.equal(R.apply(input, false), input);
  for (const mode of R.modes)
    for (const gap of [0, 0.13]) {
      const p = R.prepare({
          mode,
          size: 9.3,
          origin: [-2.7, 3.1],
          angle: 0.29,
          aspect: 0.8,
          gap,
          gapColor: [7, 9, 11]
        }),
        out = R.apply(input, p);
      assert.equal(out.metadata, 'retained');
      assert.notEqual(out.rgb, rgb);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const c = R.cellAt(p, x + 0.5, y + 0.5),
            dest = y * w + x;
          const source =
            Math.max(0, Math.min(h - 1, Math.floor(c.center[1]))) * w +
            Math.max(0, Math.min(w - 1, Math.floor(c.center[0])));
          assert.deepEqual(
            [...out.rgb.slice(dest * 3, dest * 3 + 3)],
            c.edge < gap ? p.gapColor : [...rgb.slice(source * 3, source * 3 + 3)]
          );
          assert.equal(out.alpha[dest], c.edge < gap ? 255 : alpha[source]);
        }
    }
});
function fixture({ makeBuilder, makeSculpt, KIT: K, SpriteSurface: surfaces }) {
  const B = makeBuilder(18, [0x071525, 0x19494e, 0x388d8b, 0x9ae0c4, 0x795030, 0xd79442, 0xffda83]);
  const S = K.sculpt(makeSculpt(B));
  S.pixelSize(28);
  Object.assign(S, { amb: 0.4, sunK: 0.6, sky: 0.15 });
  S.box([0, -0.2, 0], [2.8, 0.2, 1.5], { r: [0, 1, 2] }, { res: 0.2 });
  S.ball([-0.75, 0.8, 0], [0.8, 1, 0.65], { r: [1, 2, 3] }, { res: 0.12 });
  S.box([1, 0.7, 0.6], [0.55, 0.7, 0.5], { r: [4, 5, 6] }, { res: 0.12 });
  S.ball([-0.1, 0.6, 1], [0.6, 0.6, 0.12], { r: [2, 3], alpha: 0.45 }, { res: 0.12 });
  S.bake();
  const SS = surfaces ?? (typeof SpriteSurface === 'undefined' ? null : SpriteSurface),
    a = SS?.make(32);
  a?.face([-2, 0.05, 1.3], [4, 0, 0], [0, 0, -2.6], 32, 16, (x, y) => ((x + y) % 3 ? 0x388d8b : 0xd79442));
  return B.finish({
    ...(a && { spriteSurfaces: a.finish() }),
    look: { splatCoverage: 'continuous', pixelSize: 1 },
    cam: { target: [0, 0.5, 0], dist: 8, yaw: 0.2, pitch: 0.35 },
    radius: 9,
    fog: { c: 0, start: 1, max: 0 }
  });
}
test('software renderer integrates grids after graph resolve, preserves diagnostics and supports disabling', () => {
  const { render } = require('../cli/render'),
    w = fixture(kit),
    frame = { w: 77, h: 59, px: 1, t: 0, passes: ['depth'], renderStats: true };
  const base = render(w, frame);
  for (const mode of R.modes) {
    w.look.renderGrid = kit.KIT.renderGrid.prepare({ mode, size: 8.3, origin: [0.17, 0.29], angle: 0.12 });
    const out = render(w, frame),
      expected = R.apply(base, w.look.renderGrid);
    assert.deepEqual(out.rgb, expected.rgb);
    assert.deepEqual(out.passes, base.passes);
    assert(out.renderStats.frameMs > 0);
    assert.deepEqual(render(w, { ...frame, renderGrid: false }).rgb, base.rgb);
  }
  const graph = { passes: [{ id: 'shift', type: 'chromatic', offset: [2, 0] }] };
  const plain = render(w, { ...frame, renderGraph: graph, renderGrid: false });
  const out = render(w, { ...frame, renderGraph: graph });
  assert.deepEqual(out.rgb, R.apply(plain, w.look.renderGrid).rgb);
});
test(
  'WebGL grids agree with CPU cell resolution on real rendered splats and survive mode/offscreen/size changes',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      fixture,
      (kit, build, backend) => {
        const world = build(kit),
          R = kit.KIT.renderGrid,
          w = 101,
          h = 79;
        const decode = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)),
          reports = [];
        for (const offscreen of [false, true]) {
          const b = backend(w, h, { offscreen, raw: true, dither: 0 });
          b.draw(world, { renderGrid: false });
          const rgb = decode(b.image());
          for (const mode of R.modes)
            for (const settings of [
              { size: 8 },
              { size: 14 },
              { size: 11.37, angle: 0.23, origin: [0.173, 0.291], aspect: 1.19, gap: 0.071, gapColor: [5, 11, 17] }
            ]) {
              const definition = { mode, ...settings },
                angle = settings.angle ?? 0;
              b.draw(world, { renderGrid: definition });
              const actual = decode(b.image()),
                expected = R.apply({ w, h, rgb }, definition).rgb;
              let bad = 0,
                max = 0;
              for (let i = 0; i < actual.length; i++) {
                const d = Math.abs(actual[i] - expected[i]);
                if (d > 1) bad++;
                max = Math.max(max, d);
              }
              reports.push({ mode, angle, offscreen, bad, max });
            }
          b.draw(world, { renderGrid: false });
          const reset = decode(b.image());
          reports.push({ resetExact: reset.every((v, i) => v === rgb[i]), offscreen });
          b.close();
        }
        const canvas = document.createElement('canvas'),
          renderer = createRenderer(canvas, { toolkit: kit });
        for (const [width, height] of [
          [83, 61],
          [121, 91],
          [71, 53]
        ]) {
          renderer.render(world, { width, height, renderGrid: { mode: 'hex', size: 8 } });
          reports.push({ sizeExact: canvas.width === width && canvas.height === height });
        }
        let rejected = false;
        try {
          renderer.render(world, { width: 150, height: 100, renderGrid: { mode: 'triangle', maxPixels: 10 } });
        } catch (e) {
          rejected = e instanceof RangeError;
        }
        reports.push({ budgetRejected: rejected && canvas.width === 71 && canvas.height === 53 });
        renderer.dispose();
        return { reports };
      }
    );
    for (const r of result.reports)
      if ('bad' in r) assert.equal(r.bad, 0, JSON.stringify(r));
      else assert(r.resetExact ?? r.sizeExact ?? r.budgetRejected, JSON.stringify(r));
  }
);

test('CLI inspects geometry and frame descriptions expose the representation budget', () => {
  const { execFileSync } = require('node:child_process');
  const report = JSON.parse(
    execFileSync(
      process.execPath,
      ['cli/ink-studio.js', 'render-grid', 'triangle', '--size', '13', '--point', '10,20', '--bounds', '0,0,20,20'],
      { cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8' }
    )
  );
  assert.equal(report.cell.vertices.length, 3);
  assert(report.cells.length > 2);
  assert.equal(report.resources.textureReadsPerPixel, 1);
  const w = fixture(kit);
  w.look.renderGrid = kit.KIT.renderGrid.prepare({ mode: 'diamond', size: 12 });
  const d = kit.KIT.renderContract.describe(w, { width: 100, height: 80 });
  assert.equal(d.representation.mode, 'diamond');
  assert.equal(d.representation.resources.colorBytes, 32000);
  assert(!kit.KIT.renderContract.describe(w, { renderGrid: false }).representation);
});
