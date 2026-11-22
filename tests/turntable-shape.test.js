const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ink = require('..');
const { maskImage } = require('../cli/turntable-shape.js');

const kit = ink.load(), { KIT: K } = kit, S = K.turntableShape;
const lanternFile = path.resolve(__dirname, '../examples/turntable-shape-lantern.js');
const lantern = require(lanternFile)(kit);
const prior = S.fromSdf(lantern.distance, lantern), target = S.fromSdf(lantern.target, lantern);
const radians = degrees => degrees * Math.PI / 180;
const cameras = [-55, 0, 55].map(yaw => S.camera(prior, { yaw: radians(yaw) }));
const edits = cameras.map(camera => ({ camera, mask: S.silhouette(target, camera) }));
const loss = (a, b) => a.reduce((count, n, i) => count + (n !== b[i]), 0);

test('both signs of silhouette edits improve the shape at held-out yaws and pitch', () => {
  const { shape, report } = S.fit(prior, edits);
  assert(report.removed > 0 && report.added > 0);
  assert(report.views.every(v => v.addPixels > 0 && v.erasePixels > 0 && v.missing < 15 && v.extra === 0));
  for (const [yaw, pitch] of [[-34, 0], [25, 0], [28, 13], [42, 32]]) {
    const camera = S.camera(prior, { yaw: radians(yaw), pitch: radians(pitch) });
    const expected = S.silhouette(target, camera);
    assert(loss(S.silhouette(shape, camera), expected) < 0.3 * loss(S.silhouette(prior, camera), expected));
  }
  assert.deepEqual(S.fit(prior, [...edits].reverse()), {
    shape, report: { ...report, views: [...report.views].reverse() }
  });
  const proxy = S.proxy(JSON.parse(JSON.stringify(shape)));
  const b = kit.makeBuilder(1);
  K.voxelSurface.draw(b, proxy, { object: 'handle', material: 'brass' });
  const world = b.finish();
  assert(proxy.faces.length > 0 && world.renderMetadata.objects.includes('handle'));
  assert.equal(world.count, proxy.stats.splats);
  assert.equal(K.mesh.info(K.voxelSurface.toMesh(proxy)).tris, proxy.faces.length * 2);
});

test('unchanged masks preserve the prior and unresolved additions are reported', () => {
  assert.deepEqual(S.fit(prior, cameras.map(camera => ({ camera, mask: S.silhouette(prior, camera) }))).shape, prior);
  const impossible = edits.map(({ mask, camera }) => ({ camera, mask: mask.slice() }));
  impossible[0].mask[0] = 1;
  const { shape, report } = S.fit(prior, impossible);
  assert(report.views[0].missing >= 1);
  assert.equal(S.silhouette(shape, cameras[0])[0], 0);
  assert.equal(S.fit(prior, edits, { maxGrowth: 0 }).report.added, 0);
  assert.throws(() => S.fit(prior, [edits[0], edits[0]]), /ten degrees/);
  assert.throws(() => S.fit(prior, [{ ...edits[0], mask: [1] }, edits[1]]), /binary mask/);
  assert.throws(() => S.fit(prior, edits.map(edit => ({ ...edit, mask: new Uint8Array(edit.mask.length) }))), /no supported source/);
  assert.throws(() => S.proxy({ ...prior, runs: [0, 10, 6, 5] }), /occupied runs/);
});

test('CLI round trips edited PNGs through an atomic capture and a reusable proxy file', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-shape-test-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => execFileSync(process.execPath, [cli, 'shape', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
  const dir = path.join(cwd, 'capture'), manifest = path.join(dir, 'capture.json');
  run('capture', lanternFile, '--out', dir);
  const capture = JSON.parse(fs.readFileSync(manifest));
  assert.deepEqual(capture.views, cameras);
  assert.throws(() => run('capture', lanternFile, '--out', dir), /already exists/);
  assert.deepEqual(JSON.parse(run('fit', dir)).views.map(v => [v.addPixels, v.erasePixels, v.missing]), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  for (const [i, { camera, mask }] of edits.entries())
    fs.writeFileSync(path.join(dir, 'view-0' + (i + 1) + '.png'), maskImage(mask, camera.width, camera.height));
  const report = JSON.parse(run('fit', dir));
  const actual = JSON.parse(fs.readFileSync(report.output));
  assert.deepEqual(actual, S.fit(prior, edits).shape);
  assert.throws(() => run('fit', dir, '--out', manifest), /distinct/);
  run('capture', report.output, '--out', path.join(cwd, 'refit'));
  const first = path.join(dir, 'view-01.png');
  fs.writeFileSync(first, maskImage(new Uint8Array(64), 8, 8));
  assert.throws(() => run('fit', dir), /dimensions/);
});


test('the browser bake profile can draw a saved fitted proxy', () => {
  const { shape } = S.fit(prior, edits);
  const count = vm.runInNewContext(ink.bundle({ profile: 'bake' }) + `
    (() => {
      const canvaslessBuilder = makeBuilder(1);
      KIT.voxelSurface.draw(canvaslessBuilder, KIT.turntableShape.proxy(savedShape));
      return canvaslessBuilder.finish().count;
    })()
  `, { savedShape: shape });
  assert(count > 0);
});
