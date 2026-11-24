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

const perspectiveFile = path.resolve(__dirname, '../examples/turntable-shape-perspective.js');
const approvalsFile = path.resolve(__dirname, '../examples/turntable-shape-perspective-views.json');
const perspectiveRecipe = require(perspectiveFile)(kit);
const approved = require('../cli/turntable-shape-views.js');

test('native perspective traversal matches opaque voxel mesh coverage at production framing', () => {
  const { camera } = approved.capture(perspectiveRecipe.build(), require(approvalsFile).views[1], kit);
  const { width: w, height: h } = camera;
  const box = S.fromSdf(() => -1, { bounds: { min: [-.63, 2.07, -.21], max: [.62, 2.82, .29] }, cell: .25 });
  const world = perspectiveRecipe.withShape(box);
  world.meshes = world.meshes.slice(-1);
  world.count = 0;
  world.data = new Float32Array();
  const image = ink.render(world, { w, h, px: 1, passes: ['depth'], camera: require(approvalsFile).views[1].camera });
  const expected = Uint8Array.from(image.passes.depth, z => Number(Number.isFinite(z)));
  assert(expected.some(Boolean));
  assert.deepEqual(S.silhouette(box, camera), expected);
  const turn = K.M.rot([0, 1, 0], .53), position = [3, -2, 1], initial = kit.CameraLens.fromView(camera.view);
  const moved = { ...camera, view: kit.CameraLens.matrix({
    eye: K.V.add(K.M.app(turn, initial.eye), position),
    right: K.M.app(turn, initial.right), up: K.M.app(turn, initial.up), back: K.M.app(turn, initial.back)
  }) };
  assert.deepEqual(S.silhouette(box, S.perspectiveCamera(moved, { position, matrix: turn })), expected);
  assert.throws(() => S.perspectiveCamera(camera, { matrix: [2, 0, 0, 0, 2, 0, 0, 0, 2] }), /orthonormal/);
});

test('perspective fitting keeps hidden voxels and distinguishes blocked paint from visible disagreement', () => {
  const views = approved.read(approvalsFile, kit, () => perspectiveRecipe.build());
  const original = views.map(({ openings, ...view }) => ({ ...view, mask: S.silhouette(prior, view.camera, view) }));
  const unchanged = S.fit(prior, original, { review: true });
  assert.deepEqual(unchanged.shape, prior);
  assert(unchanged.report.views.every(view => view.occludedPixels > 0 && view.missing === 0));
  const side = original[2], evidence = S.observe(prior, side.camera, side);
  const blocked = evidence.blocked.findIndex((n, i) => n === 2 && evidence.occluded[i]);
  const outside = evidence.sampled.findIndex(n => !n);
  assert(blocked >= 0 && outside >= 0);
  side.mask[blocked] = 1;
  side.mask[outside] = 1;
  const { shape, report, review } = S.fit(prior, original, { review: true });
  assert.deepEqual(shape, prior);
  assert.equal(report.views[2].occludedRequests, 1);
  assert.equal(report.views[2].missing, 1);
  assert.equal(review[2].disagreement[blocked], 3);
  assert.equal(review[2].disagreement[outside], 1);
});

test('the same opening is solved across three views and an obscured witness remains unverified', () => {
  const views = approved.read(approvalsFile, kit, () => perspectiveRecipe.build());
  const painted = views.map(view => ({ ...view, mask: S.silhouette(target, view.camera, view) }));
  const [x, y] = painted[0].openings[0].rect;
  painted[0].mask[y * painted[0].camera.width + x] = 1;
  const result = S.fit(prior, painted, { review: true });
  const [opening] = result.report.openings;
  assert(opening.ready && opening.views.every(witness => witness.clear === 84));
  assert.equal(opening.views[0].paintConflicts, 1);
  assert(result.report.removed > 0 && result.report.added > 0);
  assert(result.report.views.every(view => view.missing < 5 && view.extra === 0));
  assert.deepEqual(S.fit(prior, [...painted].reverse()).shape, result.shape);
  const side = painted[2], { camera } = side, evidence = S.observe(prior, camera, side);
  const hidden = evidence.blocked.findIndex((n, i) => n === 2 && evidence.occluded[i]);
  side.openings = [{ id: opening.id, rect: [hidden % camera.width, Math.floor(hidden / camera.width), 1, 1] }];
  const [blocked] = S.fit(prior, painted).report.openings;
  assert.equal(blocked.ready, false);
  assert.equal(blocked.views[2].occluded, 1);
  assert.throws(() => S.fit(prior, painted.map(view => ({ ...view, occluderDepth: [0] }))), /axial depth/);
});

test('the CLI captures an occluder scene at native size, replays the approved depth and writes review pixels', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-perspective-shape-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js'), dir = path.join(cwd, 'capture'), review = path.join(cwd, 'review');
  const run = (...args) => execFileSync(process.execPath, [cli, 'shape', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
  run('capture', perspectiveFile, '--views', approvalsFile, '--out', dir);
  const capture = JSON.parse(fs.readFileSync(path.join(dir, 'capture.json')));
  assert.equal(capture.version, 2);
  assert.deepEqual(capture.views.map(row => row.id), ['workbench', 'operator', 'rack-side']);
  assert(capture.views.every(row => row.camera.ortho === false && fs.existsSync(path.join(dir, row.occluded))));
  const report = JSON.parse(run('fit', dir, '--review', review));
  assert(report.openings[0].ready);
  assert(report.views.every(view => fs.existsSync(view.review) && view.occludedPixels > 0));
  const depthPath = path.join(dir, capture.views[0].depth), bytes = fs.readFileSync(depthPath);
  bytes[0] ^= 1;
  fs.writeFileSync(depthPath, bytes);
  assert.throws(() => run('fit', dir), /Occluder depth changed/);
});
