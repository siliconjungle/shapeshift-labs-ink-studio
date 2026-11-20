const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('node:v8');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const { KIT: K } = studio.load();

function scene() {
  return { id: 'incremental', seed: 3, finish: { look: { pixel: true } },
    camera: { target: [0, .65, 0], dist: 7, yaw: .2, pitch: .38 },
    solids: [
      { id: 'floor', kind: 'ground', rad: 2, res: .065, mat: 'earth' },
      { id: 'marker', kind: 'ball', at: [0, 1.2, 0], r: .5, res: .08, ghost: true, mat: 'ember' }
    ] };
}

test('editor reuses static bakes and samples, and local edits match a clean bake', () => {
  const spec = scene();
  const mesh = K.mesh.make([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  spec.solids.splice(1, 0, { id: 'plate', kind: 'mesh', asset: 'plate', at: [-1.2, 0, 0],
    cells: 18, size: .72, res: .08, mat: 'metal' });
  const env = { assets: { plate: mesh } };
  const cache = K.authoring.bakeCache.create();
  const editor = studio.createSceneEditor(spec, { env: { ...env, bakeCache: cache } });
  const first = editor.build();
  const warm = editor.buildIncremental(first);
  assert.deepEqual(warm.frame.changedRows, []);
  assert.deepEqual(warm.frame.changedPatternRows, []);
  const { pack } = K.authoring.bakeCache;
  assert.deepEqual(pack(first), pack(warm.world));
  assert.notEqual(first.data, warm.world.data);
  warm.world.data[0] = 99;
  warm.world.made.plate.field.D[0] = 99;
  assert.deepEqual(pack(editor.build()), pack(first));
  assert.equal(editor.build().made.plate.field.D[0], first.made.plate.field.D[0]);

  const view = K.diorama.build({ ...spec, camera: { ...spec.camera, yaw: 1 } }, { ...env, bakeCache: cache });
  const previousHits = cache.stats().byKind.splats.hits;
  const viewAgain = K.diorama.build({ ...spec, camera: { ...spec.camera, yaw: -.6 } }, { ...env, bakeCache: cache });
  assert.deepEqual(pack(view), pack(viewAgain));
  assert.equal(viewAgain.cam.yaw, -.6);
  assert.equal(cache.stats().byKind.splats.hits, previousHits + 1);

  editor.updateShape({ at: [.65, 1.2, 0] }, ['solid:marker']);
  const edit = editor.buildIncremental(first);
  assert(edit.frame.changedRows.length > 0 && edit.frame.changedRows.length < Math.ceil(first.count / 512));
  assert.deepEqual(pack(edit.world), pack(K.diorama.build(editor.snapshot(), env)));
  assert(editor.cacheStats().byKind.candidatePoints.hits >= 2);
  const beforeMeshEdit = editor.cacheStats().byKind.meshFields.misses;
  mesh.pos[7] = 1.25;
  const meshEdit = editor.build();
  assert.equal(editor.cacheStats().byKind.meshFields.misses, beforeMeshEdit + 1);
  assert.deepEqual(pack(meshEdit), pack(K.diorama.build(editor.snapshot(), env)));

  const previous = K.diorama.build(spec, { ...env, bakeCache: cache });
  for (const changes of [{ seed: 12 }, { light: { sun: [1, 1, 1] } }, { roles: { earth: [16, 17, 18] } }]) {
    const modified = { ...spec, ...changes };
    const world = K.diorama.build(modified, { ...env, bakeCache: cache });
    assert.notDeepEqual(world.data, previous.data);
    assert.deepEqual(pack(world), pack(K.diorama.build(modified, env)));
  }
});

test('cache bounds resident entries and preserves input identity where ordering and numeric bits matter', () => {
  const { create, signature } = K.authoring.bakeCache;
  assert.notEqual(signature({ a: 1, b: 2 }), signature({ b: 2, a: 1 }));
  assert.notEqual(signature(Float32Array.of(0)), signature(Float32Array.of(-0)));
  assert.equal(signature({ apply() {} }), undefined);
  const cache = create({ maxBytes: 180 });
  cache.write('a', 'first', Float32Array.of(1));
  cache.write('a', 'second', Float32Array.of(2));
  assert.deepEqual(cache.read('a', 'first'), Float32Array.of(1));
  cache.write('a', 'third', Float32Array.of(3));
  assert.equal(cache.read('a', 'second'), undefined);
  cache.write('a', 'oversize', new Float32Array(300));
  assert.equal(cache.stats().entries, 2);
  assert(cache.stats().bytes <= 180);
  cache.clear();
  assert.equal(cache.stats().bytes, 0);
});

test('decoded image pixels are reused across portable recipes and updated when the image changes', () => {
  let decodes = 0;
  const atob = globalThis.atob;
  globalThis.atob = value => { decodes++; return atob(value); };
  try {
    const recipe = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2],
      colors: [[1, 1, 1]], faceColors: [0],
      texture: { uv: [0, 0, 1, 0, 0, 1], images: [{ width: 1, height: 1, rgb: '/wAA', alpha: '/w==' }],
        maps: [{ image: 0, wrap: ['clamp', 'clamp'], filter: 'nearest', factor: [1, 1, 1] }], faces: [0] } };
    const sample = value => K.authoring.assetTextures.sampler(value).materialAt(0, .2, .3).color;
    const red = sample(recipe);
    assert(red[0] > .99 && red[1] === 0 && red[2] === 0);
    assert.equal(decodes, 2);
    const reparsed = structuredClone(recipe);
    assert.deepEqual(sample(reparsed), red);
    assert.equal(decodes, 2);
    const edited = structuredClone(recipe);
    edited.texture.images[0].rgb = 'AAC/';
    assert(sample(edited)[2] > .7);
    assert.equal(decodes, 4);
  } finally {
    globalThis.atob = atob;
  }
});

test('CLI reuses persisted splat records across processes and repairs a corrupted bake', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-bake-cache-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'scene.json'), directory = path.join(temp, 'bake');
  fs.writeFileSync(file, JSON.stringify(scene()));
  function render(name, options) {
    const output = path.join(temp, name + '.png');
    execFileSync(process.execPath, [path.resolve(__dirname, '../cli/ink-studio.js'), 'render', file,
      '--w', '96', '--h', '72', '--out', output, ...options], { stdio: 'pipe' });
    return fs.readFileSync(output);
  }
  const cold = render('cold', ['--asset-cache', directory]);
  const namespace = path.join(directory, fs.readdirSync(directory)[0]);
  const entries = fs.readdirSync(namespace).map(name => path.join(namespace, name));
  const record = entries.find(entry => v8.deserialize(fs.readFileSync(entry).subarray(32)).count > 0);
  assert(record);
  const timestamp = new Date(2020, 0, 1);
  fs.utimesSync(record, timestamp, timestamp);
  assert.deepEqual(render('warm', ['--asset-cache', directory]), cold);
  assert.equal(fs.statSync(record).mtimeMs, +timestamp);
  fs.writeFileSync(record, 'truncated');
  assert.deepEqual(render('repaired', ['--asset-cache', directory]), cold);
  assert.equal(v8.deserialize(fs.readFileSync(record).subarray(32)).count, K.diorama.build(scene()).count);
  assert.deepEqual(render('uncached', []), cold);
});

test('WebGL patches incremental rows and recovers when a renderer missed a revision', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, scene, (kit, source, backend) => {
    const editor = kit.KIT.authoring.sceneEditor.create(source());
    const draw = backend(120, 96, { offscreen: true }), cold = backend(120, 96, { offscreen: true });
    const texSubImage = WebGL2RenderingContext.prototype.texSubImage2D;
    const rows = [];
    WebGL2RenderingContext.prototype.texSubImage2D = function(...args) {
      if (args[4] === 2048 && this.getParameter(this.ACTIVE_TEXTURE) === this.TEXTURE0)
        for (let i = 0; i < args[5]; i++) rows.push(args[3] + i);
      return texSubImage.apply(this, args);
    };
    try {
      const first = editor.build();
      draw.draw(first);
      const initial = draw.image(), total = rows.splice(0).length;
      const warm = editor.buildIncremental(first);
      draw.draw(warm.world, warm.frame);
      const reuse = rows.splice(0);
      editor.updateShape({ at: [.65, 1.2, 0] }, ['solid:marker']);
      const edit = editor.buildIncremental(warm.world);
      draw.draw(edit.world, edit.frame);
      const patched = rows.splice(0), edited = draw.image();
      cold.draw(edit.world, edit.frame);
      const parity = edited === cold.image();
      const coldRows = rows.splice(0).length;

      editor.updateShape({ at: [-.65, 1.2, 0] }, ['solid:marker']);
      const missed = editor.buildIncremental(first);
      draw.draw(missed.world, missed.frame);
      const fallback = rows.splice(0).length;
      cold.draw(missed.world);
      return { reuse, patched, expected: edit.frame.changedRows, total, coldRows, fallback, parity,
        fallbackParity: draw.image() === cold.image(), changed: initial !== edited };
    } finally {
      WebGL2RenderingContext.prototype.texSubImage2D = texSubImage;
      draw.close();
      cold.close();
    }
  });
  assert.deepEqual(result.reuse, []);
  assert.deepEqual(result.patched, result.expected);
  assert(result.patched.length > 0 && result.patched.length < result.total);
  assert.equal(result.coldRows, result.total);
  assert.equal(result.fallback, result.total);
  assert(result.parity && result.fallbackParity && result.changed);
});
