const test = require('node:test'),
  assert = require('node:assert/strict'),
  ink = require('..'),
  F = require('../src/splat-footprints');
const kit = ink.load(),
  K = kit.KIT,
  near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
const mask = () => {
  const w = 16,
    alpha = Array.from({ length: w * w }, (_, i) => {
      const x = i % w,
        y = (i / w) | 0;
      return x >= 2 && x <= 13 && y >= 2 && y <= 13 && !(x >= 6 && x <= 9 && y >= 6 && y <= 9) ? 255 : 0;
    });
  return { shape: 'mask', mask: { width: w, height: w, alpha }, softness: 0 };
};
test('all authored shapes have finite SDFs, real concavities and crisp/soft coverage', () => {
  const shapes = [
    'circle',
    'square',
    'wedge',
    'star',
    'cross',
    'chip',
    {
      shape: 'polygon',
      vertices: [
        [-1, -1],
        [1, -1],
        [0.3, 0],
        [1, 1],
        [-1, 1]
      ]
    },
    mask()
  ];
  for (const d of shapes) {
    const p = F.prepare(d),
      f = F.field(p);
    assert.equal(f.length, 128 ** 2);
    assert(f.every(Number.isFinite));
    assert(F.coverage(p, 4, 4) === 0);
    assert(F.distance(p, 0, 0) < 0 || p.shape === 'mask');
  }
  const c = F.prepare({ shape: 'cross', softness: 0 });
  assert.equal(F.coverage(c, 0.8, 0.8), 0);
  assert.equal(F.coverage(c, 0.8, 0.1), 1);
  const s = F.prepare({ shape: 'square', softness: 0.2 });
  near(F.coverage(s, 1, 0), 0.5, 0.002);
  assert(F.coverage(s, 0.9, 0) > F.coverage(s, 1.1, 0));
  const m = F.prepare(mask());
  assert.equal(F.coverage(m, 0, 0), 0);
  assert.equal(F.coverage(m, 0.5, 0.5), 1);
  const empty = F.prepare({ shape: 'mask', mask: { width: 2, height: 2, alpha: [0, 0, 0, 0] } });
  assert.equal(F.coverage(empty, 0, 0), 0);
  assert(F.field(empty).every(Number.isFinite));
  const top = F.prepare({ shape: 'mask', mask: { width: 2, height: 2, alpha: [255, 255, 0, 0] }, softness: 0 });
  assert.equal(F.coverage(top, 0, 0.6), 1);
  assert.equal(F.coverage(top, 0, -0.6), 0);
});
test('symmetric covariance mapping is invertible, stable under isotropy and bounded when rotated/stretched', () => {
  for (const A of [0.1, 1, 12])
    for (const C of [0.4, 1, 7])
      for (const rho of [-0.8, 0, 0.8]) {
        const B = rho * Math.sqrt(A * C),
          p = F.prepare({ shape: 'square', rotation: 0.8, stretch: [3, 0.3] }),
          m = F.transform(p, A, B, C);
        assert(m.every(Number.isFinite));
        assert(Math.abs(m[0] * m[3] - m[1] * m[2]) > 1e-9);
        near(F.sample(p, m, 0, 0), 1);
      }
  const p = F.prepare({ shape: 'wedge', rotation: Math.PI / 2, softness: 0 });
  const m = F.transform(p, 1, 0, 1);
  assert(F.sample(p, m, 0, F.half * 0.8) > 0);
  assert.equal(F.sample(p, m, F.half * 0.8, 0), 0);
});
test('invalid profiles and edits fail atomically; prepared settings round trip between bundles', () => {
  for (const d of [
    true,
    null,
    { shape: 'no' },
    { stretch: [0, 1] },
    { rotation: NaN },
    { softness: 1 },
    { shape: 'star', tips: 2 },
    { shape: 'cross', seed: 1 },
    { shape: 'polygon', vertices: [[1, 0]] },
    { shape: 'mask', mask: { width: 2, height: 2, alpha: [0, 0, 0, NaN] } },
    { unknown: 1 }
  ])
    assert.throws(() => F.prepare(d));
  const w = { count: 4 };
  const id = F.assign(w, 'all', 'square'),
    before = w.splatFootprints;
  assert.throws(() => F.assign(w, [4], 'star'));
  assert.equal(w.splatFootprints, before);
  assert.throws(() => F.update(w, id, false));
  assert.equal(w.splatFootprints, before);
  assert.throws(() => F.setTransform(w, id, { stretch: [1, 0] }));
  assert.equal(w.splatFootprints, before);
  const p = K.splatFootprints.prepare({ shape: 'star', rotation: 0.3 });
  assert.deepEqual(JSON.parse(JSON.stringify(p)), JSON.parse(JSON.stringify(F.prepare(p))));
});
test('transform-only animation reuses atlas fields, packed slots and bounded GPU work', () => {
  const w = { count: 100 },
    slot = F.assign(w, 'all', mask()),
    a = F.plan(w);
  for (let i = 1; i <= 100; i++) {
    F.setTransform(w, slot, { rotation: i * 0.01, stretch: [1 + i * 0.01, 1] });
    const b = F.plan(w);
    assert.equal(b.atlas, a.atlas);
    assert.equal(b.indices, a.indices);
    assert.notDeepEqual(b.params, a.params);
  }
  const saved = w.splatFootprints,
    old = F.plan(w);
  F.update(w, slot, { shape: 'cross' });
  F.plan(w);
  w.splatFootprints = saved;
  assert.equal(F.plan(w).atlas, old.atlas);
  F.setTransform(w, slot, { rotation: 0.2 });
  assert.equal(F.plan(w).atlas, old.atlas);
  F.update(w, slot, { shape: 'star' });
  assert.notEqual(F.plan(w).atlas, a.atlas);
  const grown = { ...w, count: 120 };
  assert(F.plan(grown).indices.every((v, i) => i < 400 || v === 0));
  F.assign(w, 'all', false);
  assert(!w.splatFootprints);
});
function fixture({ makeBuilder, KIT: K }) {
  const B = makeBuilder(17, [0x081d2a, 0xffce7d, 0x61cabd]);
  B.dab(0, 0, 0, [0, 0, 1], [1, 0, 0], 0.45, 0.45, 0.02, B.P[1], 1, 0);
  B.dab(0, 0, -0.5, [0, 0, 1], [1, 0, 0], 0.8, 0.8, 0.02, B.P[2], 1, 0);
  const w = B.finish({
    cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, ortho: true },
    radius: 10,
    look: { pixelSize: 1, splatCoverage: 'continuous' },
    fog: { c: 0, start: 1, max: 0 },
    dither: 0
  });
  K.splatFootprints.assign(w, [0], { shape: 'cross', rotation: 0.25, stretch: [1.7, 0.8], softness: 0.04 });
  return w;
}
test('sculpt materials, subsets, chunk joins, cached bakes and native LOD retain independent marks', () => {
  const { makeBuilder, makeSculpt } = kit,
    B = makeBuilder(1, [0, 0xffffff]),
    S = K.sculpt(makeSculpt(B));
  S.box([0, 0, 0], [1, 0.3, 1], { r: [1], footprint: 'square' }, { res: 0.35 });
  S.ball([0, 1, 0], [0.3, 0.3, 0.3], { r: [1], footprint: { shape: 'chip', seed: 19 } }, { res: 0.2 });
  S.bake();
  const w = B.finish();
  assert.equal(w.splatFootprints.styles.length, 2);
  assert(w.splatFootprints.indices.includes(1) && w.splatFootprints.indices.includes(2));
  const a = kit.SplatProvenance.subset(w, [0, w.count - 1]),
    b = kit.SplatProvenance.join([a, a]);
  assert.equal(b.splatFootprints.indices.length, 4);
  assert.equal(b.splatFootprints.styles.length, 2);
  const plan = F.plan(w);
  assert.equal(plan.count, w.count);
});
test('software colour, ownership and depth use footprint holes and extended bounds', () => {
  const w = fixture(kit),
    R = require('../cli/render');
  const render = () => R.render(w, { w: 100, h: 100, px: 1, t: 0, raw: true, passes: ['splatId', 'depth'] });
  const a = render();
  assert(a.rgb.some(v => v !== 0));
  K.splatFootprints.update(w, 1, mask());
  const b = render();
  const c = (50 * 100 + 50) * 3;
  assert(b.rgb[c + 1] > b.rgb[c]);
  assert.notDeepEqual(b.rgb, a.rgb);
  assert.equal(b.passes.splatId[50 * 100 + 50], 2);
  K.splatFootprints.update(w, 1, { shape: 'square', stretch: [4, 0.5], rotation: 0.4, softness: 0 });
  const stretched = render();
  assert.notDeepEqual(stretched.rgb, a.rgb);
});
test('ray queries honour custom holes and long marks beyond Gaussian bounds', () => {
  const w = fixture(kit);
  K.splatFootprints.update(w, 1, mask());
  const hit = K.procedural.contributions.create(w).ray({ origin: [0, 0, 4], direction: [0, 0, -1] });
  assert.equal(hit.solid.index, 1);
  K.splatFootprints.update(w, 1, { shape: 'square', stretch: [4, 0.3], softness: 0 });
  const side = K.procedural.contributions.create(w).ray({ origin: [1.7, 0, 4], direction: [0, 0, -1] });
  assert.equal(side.solid.index, 0);
});
test(
  'WebGL raster, owner/depth, atlas surfaces, view picking and live transforms share silhouettes',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      fixture,
      (kit, build, backend) => {
        const F = kit.KIT.splatFootprints,
          w = build(kit),
          b = backend(100, 100, { raw: true });
        const reports = [];
        for (const d of [
          'square',
          'wedge',
          'star',
          'cross',
          'chip',
          {
            shape: 'polygon',
            vertices: [
              [-1, -1],
              [1, -1],
              [0, 1]
            ]
          }
        ]) {
          F.update(w, 1, d);
          b.draw(w);
          reports.push({ shape: typeof d === 'string' ? d : d.shape, image: b.image() });
        }
        const canvas = document.createElement('canvas'),
          r = createRenderer(canvas, { toolkit: kit });
        const mask = {
          shape: 'mask',
          mask: {
            width: 8,
            height: 8,
            alpha: Array.from({ length: 64 }, (_, i) => {
              const x = i % 8,
                y = (i / 8) | 0;
              return x < 2 || x > 5 || y < 2 || y > 5 ? 255 : 0;
            })
          },
          softness: 0
        };
        F.update(w, 1, mask);
        r.render(w, { width: 100, height: 100, raw: true });
        const hit = r.pick(w, { origin: [0, 0, 4], direction: [0, 0, -1] }, { raw: true });
        const atlas = F.plan(w).atlas;
        for (let i = 0; i < 8; i++) {
          F.setTransform(w, 1, { rotation: i * 0.1 });
          r.render(w, { width: 100, height: 100, raw: true });
        }
        const retained = F.plan(w).atlas === atlas,
          error = canvas.getContext('webgl2').getError();
        r.dispose();
        b.close();
        return { reports, hit: hit.solid.index, retained, error };
      }
    );
    assert.equal(result.hit, 1);
    assert(result.retained);
    assert.equal(result.error, 0);
    assert.equal(new Set(result.reports.map(r => r.image)).size, 6);
  }
);

test(
  'GPU fragment coverage matches the shared SDF for every footprint, including rotated long strokes',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      fixture,
      (kit, build, backend) => {
        const F = kit.KIT.splatFootprints,
          B = kit.makeBuilder(1, [0x081c29, 0xffd58b]);
        B.dab(0, 0, 0, [0, 0, 1], [1, 0, 0], 0.5, 0.5, 0.05, B.P[1], 1, 0);
        const world = B.finish({
            cam: { target: [0, 0, 0], dist: 8, yaw: 0, pitch: 0, ortho: true },
            radius: 10,
            fog: { c: 0, start: 1, max: 0 }
          }),
          w = 161,
          h = 121;
        const b = backend(w, h, { raw: true, dither: 0, damp: false }),
          reports = [],
          f = h / (2 * 8 * Math.tan((19 * Math.PI) / 180)),
          A = (f * 0.5) ** 2 + 0.3;
        const shapes = [
          'circle',
          'square',
          'wedge',
          'star',
          'cross',
          'chip',
          {
            shape: 'polygon',
            vertices: [
              [-1, -1],
              [1, -1],
              [0.2, 0],
              [1, 1],
              [-1, 1]
            ]
          },
          {
            shape: 'mask',
            mask: {
              width: 8,
              height: 8,
              alpha: Array.from({ length: 64 }, (_, i) => {
                const x = i % 8,
                  y = (i / 8) | 0;
                return x < 2 || x > 5 || y < 2 || y > 5 ? 255 : 0;
              })
            }
          }
        ];
        for (const [i, shape] of shapes.entries()) {
          const p = F.prepare({
            ...(typeof shape === 'string' ? { shape } : shape),
            rotation: 0.31,
            stretch: i === 1 ? [4, 0.35] : [1.3, 0.8],
            softness: 0.07
          });
          F.assign(world, 'all', p);
          b.draw(world);
          const rgb = Uint8Array.from(atob(b.image()), c => c.charCodeAt(0)),
            map = F.transform(p, A, 0, A);
          let bad = 0,
            max = 0;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const expected = Math.min(0.99, F.sample(p, map, x + 0.5 - w / 2, h / 2 - y - 0.5)),
                actual = (rgb[(y * w + x) * 3] - 8) / 247,
                d = Math.abs(expected - actual);
              if (d > 0.025) bad++;
              max = Math.max(max, d);
            }
          reports.push({ shape: p.shape, bad, max });
        }
        b.close();
        return { reports };
      }
    );
    for (const row of result.reports) assert.equal(row.bad, 0, JSON.stringify(row));
  }
);

test('instance flattening and afterimage snapshots preserve authored footprint bindings', async () => {
  const { createSplatInstances } = await import('../webgl.mjs');
  const w = fixture(kit);
  const base = kit.makeBuilder(1, w.pal).finish();
  const group = createSplatInstances({ mark: w }, [
    { id: 'a', prototype: 'mark', position: [1, 0, 0] },
    { id: 'b', prototype: 'mark', position: [-1, 0, 0] }
  ]);
  const flat = group.flatten(base);
  assert.equal(flat.splatFootprints.indices.length, 4);
  assert.equal(flat.splatFootprints.styles.length, 1);
  assert.deepEqual([...flat.splatFootprints.indices], [1, 0, 1, 0]);
  const rows = new Float32Array(w.data);
  rows.splatFootprints = [F.prepare('cross'), F.prepare('star')];
  const appended = kit.KIT.afterimages.append(w, rows);
  assert.equal(appended.splatFootprints.indices.length, 4);
  assert.equal(appended.splatFootprints.styles[appended.splatFootprints.indices[3] - 1].shape, 'star');
});
