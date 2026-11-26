'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const PNG = require('../cli/png.js');
const Lens = require('../src/camera-lens.js');
const studio = require('..');

const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cli = path.join(__dirname, '../cli/ink-studio.js');
const trainingCount = 6;

function dataset(root) {
  const width = 40, height = 36, at = [.13, -.08, .07], radius = .7;
  const views = Array.from({ length: trainingCount + 1 }, (_, i) => {
    const id = 'angle-' + i, split = i < trainingCount ? 'train' : 'holdout';
    const perspective = i % 2 || split === 'holdout';
    const type = perspective ? 'perspective' : 'orthographic';
    const yaw = split === 'holdout' ? .75 : i * 2 * Math.PI / trainingCount;
    const pose = Lens.orbitPose(yaw, i % 2 ? -.12 : .22, 5, [0, 0, 0]);
    const { eye, right, up, back } = pose;
    const fx = perspective ? 83 : 16, fy = perspective ? 78 : 15, cx = 19, cy = 17;
    const pixels = new Uint8Array(width * height * 4), matte = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = (x + .5 - cx) / fx, v = (cy - (y + .5)) / fy;
      const origin = eye.map((n, k) => n + (perspective ? 0 : u * right[k] + v * up[k]));
      const direction = back.map((n, k) => -n + (perspective ? u * right[k] + v * up[k] : 0));
      const relative = origin.map((n, k) => n - at[k]), closest = -dot(relative, direction) / dot(direction, direction);
      const distance = Math.hypot(...relative.map((n, k) => n + closest * direction[k]));
      const p = y * width + x, inside = distance <= radius;
      pixels.set(inside ? [219, 139, 65, 255] : [0, 0, 0, i === 1 ? 255 : 0], 4 * p);
      matte[p] = inside ? 255 : 0;
    }
    const image = id + '.png', camera = { type, pose, fx, fy, cx, cy, near: .4, far: 30 };
    fs.writeFileSync(path.join(root, image), PNG.encode(width, height, pixels, 4));
    if (i === 1) fs.writeFileSync(path.join(root, 'matte.png'), PNG.encodeGray(width, height, matte));
    return { id, split, width, height, image, camera, ...(i === 1 && { mask: 'matte.png' }) };
  });
  return { format: 'ink-studio/gaussian-training', version: 1, bounds: { min: [-.9, -.9, -.9], max: [1, .9, .9] },
    settings: { resolution: 16, maxPoints: 450, iterations: 15, maxSamples: 15_000_000 }, views };
}

test('Gaussian training round-trips a bounded cloud and keeps held-out images isolated', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-gaussian-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const doc = dataset(root), file = path.join(root, 'dataset.json');
  const run = name => {
    fs.writeFileSync(file, JSON.stringify(doc));
    return spawnSync(process.execPath, [cli, 'gaussian-train', 'train', file, '--out', path.join(root, name)], { encoding: 'utf8' });
  };
  const artifact = (dir, name) => path.join(root, dir, name);
  const read = dir => JSON.parse(fs.readFileSync(artifact(dir, 'report.json')));
  const baseline = run('fit');
  assert.equal(baseline.status, 0, baseline.stderr);
  const report = read('fit'), asset = artifact('fit', 'cloud.ply'), holdout = report.heldOut[0];
  const cloud = await studio.readGaussianSplat(asset);
  assert.equal(cloud.count, report.asset.points);
  assert.equal(cloud.degree, 0);
  assert.equal(report.training.length, trainingCount);
  assert(report.training[1].maskSha256);
  assert(report.fit.losses[report.fit.bestIteration] < report.fit.losses[0]);
  assert(holdout.fit.silhouetteIoU > .8 && holdout.fit.mse < holdout.before.mse, JSON.stringify(holdout.fit));
  assert(PNG.raster(artifact('fit', holdout.images[3])).w === doc.views[trainingCount].width);

  const withheld = path.join(root, doc.views[trainingCount].image), source = PNG.raster(withheld);
  const modified = Uint8Array.from(source.data, (n, i) => i % 4 === 3 ? n : 255 - n);
  fs.writeFileSync(withheld, PNG.encode(source.w, source.h, modified, 4));
  const changed = run('changed');
  assert.equal(changed.status, 0, changed.stderr);
  assert.deepEqual(fs.readFileSync(asset), fs.readFileSync(artifact('changed', 'cloud.ply')));
  assert.notEqual(read('changed').heldOut[0].fit.mae, holdout.fit.mae);

  doc.views[trainingCount].camera = doc.views[1].camera;
  const duplicate = run('duplicate');
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /distinct calibrated cameras/);
  assert(!fs.existsSync(artifact('duplicate', 'cloud.ply')));
  doc.settings.maxSamples = 1;
  const budget = run('budget');
  assert.equal(budget.status, 1);
  assert.match(budget.stderr, /sample budget exceeded/);
  assert(!fs.existsSync(artifact('budget', 'report.json')));
});
