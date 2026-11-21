const test = require('node:test'),
  assert = require('node:assert/strict'),
  kit = require('..').load(),
  K = kit.KIT,
  P = kit.ScreenPrint;
const near = (a, b, e = 1e-5) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
function fixture(kit) {
  const B = kit.makeBuilder(5, [0x16334b, 0x387f98, 0xee7150, 0xf6e9cc]);
  B.dab(0, 0, 0, [0, 0, 1], [1, 0, 0], 2.2, 2.2, 0.001, [115, 146, 152], 3);
  B.describeSplats(0, 1, { object: 'plate' });
  return B.finish({
    cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, ortho: true },
    radius: 10,
    dither: 0,
    fog: { c: 0, start: 1, max: 0 },
    look: {
      pixelSize: 1,
      screenPrint: {
        ...kit.KIT.screenPrint.preset('duotone'),
        space: 'screen',
        spacing: 8,
        grain: 0,
        chart: { projection: 'plane' }
      }
    }
  });
}
test('circle, diamond and line screens reproduce requested ink area, including dense shadows', () => {
  for (const shape of P.shapes)
    for (const area of [0, 0.08, 0.25, 0.5, 0.8, 0.95, 1]) {
      let mean = 0;
      const n = 160;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) mean += P.mark(shape, (x + 0.5) / n, (y + 0.5) / n, area);
      near(mean / (n * n), area, 0.008);
    }
});
test('screen filtering approaches exact area at subpixel spacing and remains periodic', () => {
  for (const shape of P.shapes) {
    near(P.mark(shape, 0.2, 0.4, 0.37, 2), 0.37);
    near(P.mark(shape, 0.2, 0.4, 0.37), P.mark(shape, 3.2, -2.6, 0.37));
  }
});
test('ordered ink plates expose separations and distinguish overprint from knockout', () => {
  const plates = [
      { id: 'blue', ink: '#206d9b', gain: 2, order: 2 },
      { id: 'red', ink: '#e36d43', gain: 2, order: 1 }
    ],
    p = P.prepare({ paper: '#ffffff', plates, grain: 0 });
  assert.deepEqual(
    P.separate(p, [0, 0, 0]).map(q => q.id),
    ['red', 'blue']
  );
  const a = P.shade(p, [0.11, 0.34], [0, 0, 0]);
  near(a[0], (0xe3 / 255) * (0x20 / 255));
  const b = P.shade({ ...p, plates: p.plates.map(q => ({ ...q, blend: 'knockout' })) }, [0.11, 0.34], [0, 0, 0]);
  near(b[0], 0x20 / 255);
  assert.notDeepEqual(a, b);
});
test('CMYK black generation removes neutral component from chromatic plates', () => {
  const p = P.preset('cmyk', { blackGeneration: 1 }),
    s = P.separate(
      p,
      p.paper.map(v => v * 0.2)
    );
  assert(s.find(q => q.id === 'key').area > 0.7);
  for (const q of s.filter(q => q.id !== 'key')) assert(q.area < 0.04);
});
test('paper grain, registration and packed recipes are stable and isolated', () => {
  const p = P.preset('duotone', { seed: 4294967295, grain: 0.1 }),
    a = P.shade(p, [0.17, 0.23], [0.7, 0.4, 0.3]);
  assert.deepEqual(P.shade(p, [0.17, 0.23], [0.7, 0.4, 0.3]), a);
  assert.equal(P.pack(p), P.pack(p));
  assert(P.pack(p).every(Number.isFinite));
  const shifted = { ...p, plates: p.plates.map(q => ({ ...q, offset: [0.37, 0.1] })) };
  assert(
    Array.from({ length: 100 }, (_, i) => [i * 0.013, i * 0.017]).some(uv =>
      P.shade(shifted, uv, [0.7, 0.4, 0.3]).some((v, i) => v !== P.shade(p, uv, [0.7, 0.4, 0.3])[i])
    )
  );
});
test('invalid recipes, edits and selections leave the world untouched', () => {
  for (const q of [
    { spacing: 0 },
    { plates: [] },
    { plates: [{ id: 'x' }, { id: 'x' }] },
    { plates: [{ angle: Infinity }] },
    { space: 'wat' },
    { seed: 1.5 },
    { plates: [{ range: [0.7, 0.2] }] },
    { plates: [{ blend: 'add' }] },
    { grain: 2 }
  ])
    assert.throws(() => P.prepare(q));
  const w = fixture(kit),
    old = w.engraving;
  assert.throws(() => K.screenPrint.update(w, 1, { spacing: NaN }));
  assert.equal(w.engraving, old);
  assert.throws(() => K.screenPrint.bind(w, [9], true));
  assert.equal(w.engraving, old);
});
test('global defaults, per-material opt-outs and retained metadata survive native operations', () => {
  const B = kit.makeBuilder(2, [0x16334b, 0x387f98, 0xee7150, 0xf6e9cc]),
    S = K.sculpt(kit.makeSculpt(B));
  S.ball([-0.5, 0, 0], 0.4, { r: [0, 1, 2, 3] }, { res: 0.16 });
  S.ball([0.5, 0, 0], 0.4, { r: [0, 1, 2, 3], screenPrint: false }, { res: 0.16 });
  S.bake();
  const w = B.finish({ look: { screenPrint: 'duotone' } });
  assert(w.engraving.indices.some(Boolean));
  assert(w.engraving.indices.some(i => !i));
  const sub = kit.SplatProvenance.subset(w, [0, w.count - 1]);
  assert(sub.engraving.styles[0].screenPrint);
  const rest = K.deform.rest(w, [0]),
    anchor = w.engraving.anchors.slice();
  K.deform.apply(w, [0], rest, p => [p[0] * 1.2, p[1], p[2]]);
  assert.deepEqual(w.engraving.anchors, anchor);
  const cache = K.authoring.bakeCache.create();
  cache.write('print', 'a', K.authoring.bakeCache.pack(w));
  assert.deepEqual(cache.read('print', 'a').engraving.styles, w.engraving.styles);
});
test('live ink edits retain geometry, chart rows and cached plate buffers', () => {
  const w = fixture(kit),
    b = w.engraving,
    data = w.data,
    axes = w.splatFootprints.frames;
  K.screenPrint.update(w, 1, { dotGain: 0.1 });
  assert.equal(w.data, data);
  assert.equal(w.splatFootprints.frames, axes);
  assert.equal(w.engraving.indices, b.indices);
  assert.equal(w.engraving.anchors, b.anchors);
  assert.equal(w.engraving.restFrames, b.restFrames);
});
test('software printing changes pigment without changing geometry, coverage or ownership', () => {
  const w = fixture(kit),
    R = require('../cli/render'),
    o = { w: 96, h: 96, px: 1, raw: true, passes: ['splatId', 'depth'] },
    a = R.render(w, o),
    b = R.render(w, { ...o, screenPrint: false });
  assert.notDeepEqual(a.rgb, b.rgb);
  assert.deepEqual(a.passes, b.passes);
});
test(
  'WebGL and software use identical plate screens without extra samplers',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      fixture,
      (kit, build, backend) => {
        const w = build(kit),
          b = backend(96, 96, { raw: true }),
          images = [];
        for (const shape of ['circle', 'diamond', 'line']) {
          kit.KIT.screenPrint.update(w, 1, {
            plates: w.engraving.styles[0].screenPrint.plates.map(p => ({ ...p, shape }))
          });
          b.draw(w);
          images.push(b.image());
        }
        b.draw(w, { screenPrint: false });
        const base = b.image();
        b.close();
        return { images, base };
      }
    );
    const w = fixture(kit),
      R = require('../cli/render');
    for (let i = 0; i < 3; i++) {
      K.screenPrint.update(w, 1, {
        plates: w.engraving.styles[0].screenPrint.plates.map(p => ({ ...p, shape: P.shapes[i] }))
      });
      const cpu = R.render(w, { w: 96, h: 96, px: 1, raw: true }).rgb,
        gpu = Buffer.from(result.images[i], 'base64');
      let error = 0,
        count = 0;
      for (let y = 22; y < 74; y++)
        for (let x = 22; x < 74; x++)
          for (let c = 0; c < 3; c++) {
            const at = (y * 96 + x) * 3 + c;
            error += Math.abs(cpu[at] - gpu[at]);
            count++;
          }
      assert(error / count < 3, `shape ${i} MAE ${error / count}`);
    }
    assert.equal(new Set(result.images).size, 3);
    assert(!result.images.includes(result.base));
  }
);
test('global defaults, per-material opt-outs and disabled paths allocate only when used', () => {
  const b = kit.makeBuilder(9, [0x16334b, 0x79a0aa, 0xf6e9cc]),
    s = K.sculpt(kit.makeSculpt(b));
  s.ball([-0.6, 0, 0], 0.4, { r: [0, 1, 2] }, { res: 0.15 });
  s.ball([0.6, 0, 0], 0.4, { r: [0, 1, 2], screenPrint: false }, { res: 0.15 });
  s.bake();
  const w = b.finish({ look: { screenPrint: true } });
  assert(w.engraving.indices.some(Boolean));
  assert(w.engraving.indices.some(i => !i));
  const off = kit.makeBuilder(1);
  off.dab(0, 0, 0, [0, 0, 1], [1, 0, 0], 1, 1, 0.01, off.P[0], 1);
  const plain = off.finish({ look: { screenPrint: false } });
  assert.equal(plain.engraving, undefined);
  assert.equal(plain.splatFootprints, undefined);
  assert.equal(K.screenPrint.chart('duotone'), K.screenPrint.chart('duotone'));
});
test('print edits preserve partial chart settings and reject invalid changes atomically', () => {
  const w = fixture(kit);
  K.screenPrint.update(w, 1, { chart: { projection: 'cylinder', radius: 2 } });
  K.screenPrint.update(w, 1, { chart: { origin: [1, 2, 3] } });
  assert.equal(w.engraving.styles[0].projection, 'cylinder');
  assert.equal(w.engraving.styles[0].radius, 2);
  const old = w.engraving;
  assert.throws(() => K.screenPrint.update(w, 1, { chart: null }));
  assert.equal(w.engraving, old);
});
test('printing changes color while retaining native coverage, ownership and depth', () => {
  const w = fixture(kit),
    r = require('../cli/render'),
    opts = { w: 80, h: 80, px: 1, raw: true, passes: ['splatId', 'depth'] },
    a = r.render(w, opts),
    b = r.render(w, { ...opts, screenPrint: false });
  assert.notDeepEqual(a.rgb, b.rgb);
  assert.deepEqual(a.passes, b.passes);
  const before = w.engraving.anchors.slice(),
    frames = w.splatFootprints.frames.slice(),
    rest = K.deform.rest(w, [0]);
  K.deform.apply(w, [0], rest, p => [p[0] * 1.3, p[1], p[2]]);
  assert.deepEqual(w.engraving.anchors, before);
  assert.notDeepEqual(w.splatFootprints.frames, frames);
});
test(
  'surface chart print projections, grain and live light agree between CPU and WebGL',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      fixture,
      (kit, build, backend) => {
        const w = build(kit),
          b = backend(96, 96, { raw: true }),
          images = [];
        for (const projection of ['plane', 'cylinder', 'sphere', 'triplanar']) {
          kit.KIT.screenPrint.update(w, 1, {
            space: 'surface',
            spacing: 0.4,
            grain: 0.07,
            seed: 4294967295,
            lighting: 0.4,
            chart: { projection }
          });
          b.draw(w);
          images.push(b.image());
        }
        b.close();
        return images;
      }
    );
    const w = fixture(kit),
      r = require('../cli/render');
    for (const [i, projection] of ['plane', 'cylinder', 'sphere', 'triplanar'].entries()) {
      K.screenPrint.update(w, 1, {
        space: 'surface',
        spacing: 0.4,
        grain: 0.07,
        seed: 4294967295,
        lighting: 0.4,
        chart: { projection }
      });
      const cpu = r.render(w, { w: 96, h: 96, px: 1, raw: true }).rgb,
        gpu = Buffer.from(result[i], 'base64');
      let error = 0,
        n = 0;
      for (let y = 28; y < 68; y++)
        for (let x = 28; x < 68; x++)
          for (let c = 0; c < 3; c++) {
            let at = (y * 96 + x) * 3 + c;
            error += Math.abs(cpu[at] - gpu[at]);
            n++;
          }
      assert(error / n < 3, projection + ' error ' + error / n);
    }
  }
);
test('valid extreme coordinates and dense frequencies filter without overflowing coordinate budgets', () => {
  const p = P.prepare({ spacing: 0.001, grain: 0, plates: [{ frequency: 8 }] });
  assert(P.shade(p, [1000000, -1000000], [0.4, 0.5, 0.6], { footprint: 1 }).every(Number.isFinite));
});
