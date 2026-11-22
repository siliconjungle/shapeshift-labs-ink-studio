const test = require('node:test');
const assert = require('node:assert/strict');

test('surface order settings validate work limits and use top-left normalized art coordinates', async () => {
  const { surfaceOrderSettings, surfaceOrderRegion } = await import('../src/webgl/surface-order.mjs');
  assert.equal(surfaceOrderSettings('center'), null);
  const options = surfaceOrderSettings('surface', { region: [.1, .23, .65, .4], layers: 2 });
  assert.equal(options.layers, 2);
  assert.deepEqual(surfaceOrderRegion(options.region, 100, 50), [10, 18, 65, 21]);
  assert.throws(() => surfaceOrderSettings('surface', { layers: 1 }), /2–8/);
  assert.throws(() => surfaceOrderSettings('surface', { region: [0, 0, 1, 0] }), /normalized region/);
  assert.throws(() => surfaceOrderSettings('depth'), /center or surface/);
});

test('live surface ordering resolves a translucent crossing with deterministic pixel fallback',
  { skip: !process.env.INK_TEST_CHROME }, () => {
    const result = require('../cli/look-webgl.js')({}, () => {}, (kit, fixture, backend) => {
      const make = extra => {
        const b = kit.makeBuilder(81, [0x111722, 0xe9a16a, 0x59c5d0, 0x9f87ce]);
        const normal = n => kit.KIT.V.norm([n, 0, 1]);
        b.disc(-.22, 0, 0, normal(-1), .69, .009, b.P[2], .88);
        b.disc(.22, 0, 0, normal(1), .69, .009, b.P[1], .88);
        if (extra) b.disc(.4, 0, -.7, [0,0,1], .26, .008, b.P[3], .55);
        return b.finish({ radius: 6, fog: { start: 1, max: 0 }, dither: 0,
          cam: { target: [0,0,0], dist: 4, pitch: 0, yaw: 0, ortho: true } });
      };
      const world = make(false), crowd = make(true);
      const draw = backend(96, 84, { offscreen: true, raw: true, colored: false, dither: 0, damp: false });
      function sample(w, yaw, splatOrder, surfaceOrder, view = {}) {
        let report;
        draw.draw(w, { camera: { ...w.cam, yaw }, splatOrder, surfaceOrder, surfaceOrderReport: value => { report = value; }, ...view });
        return { ...draw.sample({ left: [37, 41], right: [59, 41], empty: [0,0] }), report };
      }
      const left = sample(world, -.015, 'center'), right = sample(world, .015, 'center');
      const surfaceLeft = sample(world, -.015, 'surface'), surfaceRight = sample(world, .015, 'surface');
      const region = { region: [.5,.25,.5,.5] };
      const narrow = sample(world, .015, 'surface', region);
      const narrowBefore = sample(world, -.015, 'surface', region);
      const over = sample(crowd, .015, 'surface', { layers: 2 }), regular = sample(crowd, .015, 'center');
      const enough = sample(crowd, .015, 'surface', { layers: 3 });
      const budget = sample(world, .015, 'surface', { maxPixels: 64 });
      const splatBudget = sample(crowd, .015, 'surface', { maxSplats: 2 });
      const noNormals = sample({ ...world, renderMetadata: undefined }, .015, 'surface');
      const rawColors = [89,197,208,233,161,106];
      const live = { ...world, renderMetadata: undefined, look: { splatOrder: 'surface' },
        gaussianHarmonics: { count: 2, colorMode: 'rgb', degree: 0, up: 'y', sh: new Float32Array(0),
          dc: Float32Array.from(rawColors, byte => (byte / 255 - .5) / .28209479177387814),
          normals: Int8Array.of(-90,0,90,90,0,90) } };
      const imported = sample(live, .015, undefined);
      const importedCenter = sample(live, .015, 'center');
      const repeat = sample(world, .015, 'surface');
      const paletteView = { raw: false, colored: true };
      const palette = sample(world, .015, 'surface', undefined, paletteView);
      const paletteCenter = sample(world, .015, 'center', undefined, paletteView);
      const perspective = { camera: { ...world.cam, ortho: false, yaw: .015 } };
      const perspectiveCenter = sample(world, .015, 'center', undefined, perspective);
      const perspectiveLocal = sample(world, .015, 'surface', undefined, perspective);
      draw.close();
      return { left, right, surfaceLeft, surfaceRight, narrow, narrowBefore, over, regular, enough, budget,
        splatBudget, noNormals, imported, importedCenter, repeat, palette, paletteCenter, perspectiveCenter, perspectiveLocal };
    }, {});
    const delta = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0);
    assert(result.right.right[0] - result.left.right[0] > 35);
    assert(result.surfaceLeft.left[0] - result.left.left[0] > 35);
    assert(result.right.right[0] - result.surfaceRight.right[0] > 35);
    for (const frame of [result.surfaceLeft, result.surfaceRight]) {
      assert.equal(frame.report.mode, 'surface');
      assert.equal(frame.report.passes, 2);
    }
    for (const side of ['left', 'right'])
      assert(delta(result.surfaceLeft[side], result.surfaceRight[side]) < delta(result.left[side], result.right[side]) / 5);
    assert.deepEqual(result.narrowBefore.left, result.left.left);
    assert.deepEqual(result.narrow.empty, result.right.empty);
    assert.deepEqual(result.narrow.right, result.surfaceRight.right);
    assert.deepEqual(result.over.right, result.regular.right);
    assert(result.regular.right[0] - result.enough.right[0] > 35);
    assert.deepEqual(result.budget.right, result.right.right);
    assert.equal(result.budget.report.reason, 'pixel-budget');
    assert.equal(result.splatBudget.report.reason, 'splat-budget');
    assert.deepEqual(result.splatBudget.right, result.regular.right);
    assert.equal(result.noNormals.report.reason, 'no-normals');
    assert.deepEqual(result.noNormals.right, result.right.right);
    assert.equal(result.imported.report.mode, 'surface');
    assert(delta(result.imported.right, result.importedCenter.right) > 50);
    assert.deepEqual(result.surfaceRight, result.repeat);
    assert.equal(result.palette.report.passes, 4);
    assert.notDeepEqual(result.palette.right, result.paletteCenter.right);
    assert.equal(result.perspectiveLocal.report.mode, 'surface');
    assert(delta(result.perspectiveLocal.right, result.perspectiveCenter.right) > 20);
  });
