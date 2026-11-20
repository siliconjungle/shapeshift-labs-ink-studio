const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const studio = require('../index.js');
const PNG = require('../cli/png.js');

function folder(t) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-layers-'));
  t.after(() => fs.rmSync(out, { force: true, recursive: true }));
  return out;
}

function world() {
  const b = studio.load().makeBuilder(1, [0, 0xff6655, 0x4fbbad, 0xe4cc94]);
  b.disc(0, .18, -.4, [0, 0, 1], .72, .03, b.P[1], 2);
  b.describeSplats(0, 1, { object: 'back', material: 'red' });
  b.disc(.25, -.09, .1, [0, .6, .8], .52, .03, b.P[2], 2);
  b.describeSplats(1, 2, { object: 'front', material: 'teal' });
  b.disc(0, .18, .5, [0, 0, 1], .84, .03, b.P[3], .18, { nd: true, em: true });
  return b.finish({ id: 'pass-fixture', radius: 2, cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0 } });
}

const requested = ['depth', 'normal', 'objectId', 'materialId'];
const view = { w: 83, h: 57, px: 2, ortho: true, raw: true };

function verifyFrame(directory, frame, source) {
  const { files, width, height, camera } = frame;
  const color = PNG.raster(path.join(directory, files.color));
  const depth = PNG.raster(path.join(directory, files.depth));
  const normals = PNG.raster(path.join(directory, files.normal));
  const objects = PNG.raster(path.join(directory, files.objectId));
  const materials = PNG.raster(path.join(directory, files.materialId));
  const exact = fs.readFileSync(path.join(directory, files.depthFloat));
  const masks = frame.materialMasks.map(({ id, label, file }) => ({
    id, label, image: PNG.raster(path.join(directory, file))
  }));
  for (const { w, h } of [color, depth, normals, objects, materials, ...masks.map(row => row.image)])
    assert.deepEqual([w, h], [width, height]);
  assert.equal(depth.max, 65535);
  assert.equal(exact.length, width * height * 4);
  assert.deepEqual(frame.surfaceSize, [source.passes.w, source.passes.h]);
  assert.equal(camera.view.length, 16);
  assert.equal(camera.ortho, true);
  const datasets = source.passes, observed = new Set();
  let soft = 0, holes = 0, depthChanges = 0;
  for (let p = 0; p < width * height; p++) {
    const x = p % width, y = Math.floor(p / width), at = p * 4;
    const index = (w, h) => Math.floor((y + .5) * h / height) * w + Math.floor((x + .5) * w / width);
    const colorPixel = index(source.w, source.h), surface = index(datasets.w, datasets.h);
    const alpha = source.alpha[colorPixel], z = datasets.depth[surface];
    const object = datasets.objectId[surface], material = datasets.materialId[surface];
    const unpack = image => image.data[at] * 65536 + image.data[at + 1] * 256 + image.data[at + 2];
    assert.equal(color.data[at + 3], alpha);
    if (alpha) for (let c = 0; c < 3; c++) assert.equal(color.data[at + c], source.rgb[colorPixel * 3 + c]);
    assert.equal(exact.readFloatLE(at), z);
    assert.equal(unpack(objects), object);
    assert.equal(unpack(materials), material);
    for (const matte of masks) {
      assert.equal(matte.label, datasets.materials[matte.id]);
      assert.equal(matte.image.data[at], matte.id === material ? 255 : 0);
    }
    if (material) observed.add(material);
    if (alpha > 0 && alpha < 255) soft++;
    if (alpha === 0) holes++;
    if (!Number.isFinite(z)) {
      assert.equal(depth.data[at], 0);
      assert.equal(normals.data[at + 3], 0);
    } else {
      const { near, far } = frame.depthRange, code = depth.data[at];
      assert(code >= 1);
      const recovered = near + (code - 1) * (far - near) / 65534;
      assert(Math.abs(recovered - z) <= (far - near) / 65534 + 1e-6);
      const normal = datasets.normal.subarray(surface * 3, surface * 3 + 3);
      if (normal.some(Boolean)) {
        assert.equal(normals.data[at + 3], 255);
        for (const [c, value] of normal.entries())
          assert(Math.abs((normals.data[at + c] / 255) * 2 - 1 - value) <= 1 / 255 + 1e-6);
      }
      if (z > near) depthChanges++;
    }
  }
  assert(soft && holes && depthChanges);
  assert.deepEqual([...observed].sort(), masks.map(row => row.id));
  assert.deepEqual(frame.objects, datasets.objects);
  assert.deepEqual(frame.materials, datasets.materials);
}

test('layered sequences export matching straight alpha, exact depth, normals, IDs and visible material mattes', t => {
  const out = folder(t), scene = world(), samples = [];
  const capture = studio.exportLayers(scene, { out, view, times: [0, .5], pose(w, time) {
    w.cam.yaw = time * .3;
    samples.push(studio.render(w, { ...view, t: time, transparent: true, passes: requested }));
  } });
  assert.equal(JSON.stringify(capture.manifest, null, 2) + '\n', fs.readFileSync(capture.file, 'utf8'));
  assert.equal(capture.manifest.rows, 'top-down');
  assert.deepEqual(capture.manifest.frames.map(frame => frame.time), [0, .5]);
  for (const [i, frame] of capture.manifest.frames.entries()) {
    assert.deepEqual([frame.width, frame.height], [view.w, view.h]);
    verifyFrame(out, frame, samples[i]);
  }
  const before = fs.readFileSync(capture.file);
  assert.throws(() => studio.exportLayers(scene, { out, view, times: [0, 1], pose(_, time) {
    if (time) throw new Error('test interruption');
  } }), /test interruption/);
  assert.deepEqual(fs.readFileSync(capture.file), before);
  assert.equal(fs.readdirSync(out).filter(file => file.startsWith('take-')).length, 1);
  assert.throws(() => studio.exportLayers(scene, { out, view, times: [1, 0] }), /playback order/);
});

test('mixed-resolution composites and empty backgrounds keep a consistent export grid', t => {
  const out = folder(t), scene = world(), compositeView = { ...view, composite: {
    world: { resolution: [43, 31] }, layers: []
  } };
  const { manifest } = studio.exportLayers(scene, { out, view: compositeView });
  verifyFrame(out, manifest.frames[0], studio.render(scene, { ...compositeView, transparent: true, passes: requested }));
  const empty = studio.load().makeBuilder(1).finish({ cam: scene.cam, radius: 2 });
  const result = studio.exportLayers(empty, { out, view: { ...view, t: 3 }, native: true });
  const [frame] = result.manifest.frames;
  assert.equal(frame.time, 3);
  assert.equal(frame.depthRange, null);
  assert.deepEqual(frame.materialMasks, []);
  assert.deepEqual([frame.width, frame.height], frame.surfaceSize);
  assert.equal(PNG.raster(path.join(out, frame.files.depth)).data[0], 0);
  assert.equal(fs.readFileSync(path.join(out, frame.files.depthFloat)).readFloatLE(0), Infinity);
});

test('the CLI writes numbered layers with the standard scene and view options', t => {
  const out = folder(t), scene = path.join(__dirname, '../lab/data-shrine.json');
  const args = ['export-layers', scene, '--out', out, '--t', '0,.25', '--w', '64', '--h', '48', '--px', '2', '--px1'];
  execFileSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), ...args], { encoding: 'utf8' });
  const { frames } = JSON.parse(fs.readFileSync(path.join(out, 'layers.json'), 'utf8'));
  assert.deepEqual(frames.map(({ width, height, time }) => [width, height, time]), [[32, 24, 0], [32, 24, .25]]);
  assert(frames[0].files.color.endsWith('/color/frame-000000.png'));
  assert(frames[1].files.normal.endsWith('/normal/frame-000001.png'));
  assert(frames.every(frame => frame.materialMasks.length > 0));
});
