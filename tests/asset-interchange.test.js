const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const studio = require('../index.js');
const { document, readGlb } = require('../cli/glb-file.js');
const { encode } = require('../cli/png.js');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-interchange-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cli(input, out) {
  return JSON.parse(execFileSync(process.execPath,
    [path.join(__dirname, '../cli/ink-studio.js'), 'interchange', input, '--out', out], { encoding: 'utf8' }));
}

test('glTF companions, transform hierarchy, material slots and animation survive both container formats', t => {
  const dir = directory(t), doc = document();
  const add = (data, type, opts) => doc.accessor(Float32Array.from(data), type, opts);
  const position = add([0, 0, 0, 1, 0, 0, 0, 1, 0], 'VEC3', { bounds: true });
  const uv = add([0, 0, 1, 0, 0, 1], 'VEC2');
  const morph = add([0, 0, 0, 0, 0, 0, 0, 0, .2], 'VEC3', { bounds: true });
  const time = add([0, 2], 'SCALAR', { bounds: true });
  const translation = add([1, 0, 0, 1, 4, 0], 'VEC3');
  const rotation = doc.accessor(Uint16Array.from([0, 0, 0, 65535, 0, 0, 65535, 0]), 'VEC4');
  doc.gltf.accessors[rotation].normalized = true;
  const scale = add([0, 0, 0, 1, 1, 1, 2, 0, 0, 0, 0, 0, 2, 1, 1, 0, 0, 0], 'VEC3');
  const sparseIndex = doc.accessor(Uint8Array.of(1), 'SCALAR');
  const sparseValue = add([1], 'SCALAR');
  const weights = doc.add('accessors', { componentType: 5126, type: 'SCALAR', count: 2, sparse: {
    count: 1, indices: { bufferView: doc.gltf.accessors[sparseIndex].bufferView, componentType: 5121 },
    values: { bufferView: doc.gltf.accessors[sparseValue].bufferView }
  } });
  Object.assign(doc.gltf, {
    nodes: [{ name: 'Root', translation: [3, 0, 0], children: [1] },
      { name: 'Carrier', children: [2] }, { name: 'Wing', mesh: 0, extras: { inkStudio: { pivot: [.5, 0, 0] } } },
      { name: 'Other scene' }],
    scenes: [{ nodes: [0] }, { nodes: [3] }],
    materials: [{ name: 'Enamel', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }, { name: 'Brass' }],
    textures: [{ source: 0 }],
    images: [{ uri: 'base.png' }],
    meshes: [{ primitives: [0, 1].map(material => ({
      attributes: { POSITION: position, TEXCOORD_0: uv }, targets: [{ POSITION: morph }], material
    })) }],
    animations: [{ name: 'Open', samplers: [
      { input: time, output: translation, interpolation: 'STEP' },
      { input: time, output: rotation },
      { input: time, output: scale, interpolation: 'CUBICSPLINE' },
      { input: time, output: weights }
    ], channels: [
      { sampler: 0, target: { node: 1, path: 'translation' } },
      { sampler: 1, target: { node: 2, path: 'rotation' } },
      { sampler: 2, target: { node: 0, path: 'scale' } },
      { sampler: 3, target: { node: 2, path: 'weights' } }
    ] }]
  });
  const { gltf, bin } = readGlb(doc.finish()), source = path.join(dir, 'original.gltf');
  const texture = encode(1, 1, Uint8Array.of(201, 99, 77, 255), 4);
  gltf.buffers[0].uri = 'geometry.bin';
  fs.writeFileSync(source, JSON.stringify(gltf));
  fs.writeFileSync(path.join(dir, 'geometry.bin'), bin);
  fs.writeFileSync(path.join(dir, 'base.png'), texture);
  const asset = studio.readGltfAsset(source), expected = asset.snapshot();
  const pose = asset.sample(1, { clip: 'Open' });
  assert.deepEqual(pose.map(node => node.parent), [null, 0, 1]);
  assert.deepEqual(pose[2].materials, [0, 1]);
  assert.deepEqual(pose[2].pivot, [.5, 0, 0]);
  assert.deepEqual(pose[2].weights, [.5]);
  assert.deepEqual(asset.sample()[2].weights, [0]);
  assert.deepEqual(pose[1].world.slice(12, 15), [5, 0, 0]);
  assert.ok(Math.abs(pose[2].local[1] - 1) < 1e-12);
  assert.equal(asset.sample(9, { clip: 0 })[1].local[13], 4);
  assert.deepEqual(asset.sample(0, { scene: 1 }).map(node => node.id), [3]);
  const image = expected.document.bufferViews[expected.document.images[0].bufferView];
  assert.deepEqual(expected.binary.slice(image.byteOffset, image.byteOffset + image.byteLength), Uint8Array.from(texture));
  for (const extension of ['glb', 'gltf']) {
    const out = path.join(dir, 'roundtrip.' + extension);
    assert.equal(cli(source, out).file, out);
    const restored = studio.readGltfAsset(out);
    assert.deepEqual(restored.snapshot(), expected);
    assert.deepEqual(restored.sample(1, { clip: 0 }), pose);
  }
  const edited = asset.snapshot();
  edited.document.nodes[2].extras.inkStudio.pivot[0] = 2;
  edited.document.meshes[0].primitives[0].material = 1;
  edited.binary.fill(42);
  const out = path.join(dir, 'edited.glb');
  studio.exportGlb(asset.withDocument(edited.document), { out });
  const restored = studio.readGltfAsset(out);
  assert.deepEqual(restored.sample()[2].pivot, [2, 0, 0]);
  assert.deepEqual(restored.sample()[2].materials, [1, 1]);
  assert.deepEqual(restored.snapshot().binary, expected.binary);
  assert.deepEqual(asset.snapshot(), expected);
  edited.document.nodes[2].children = [0];
  assert.throws(() => asset.withDocument(edited.document), /Cyclic/);
});

test('layered PNG interchange preserves raw RGBA, saved layer hierarchy, pivots and tagged playback', t => {
  const dir = directory(t), graph = studio.load().KIT.procedural.graph;
  const asset = graph.raster({ width: 2, height: 1, fps: 4, pivot: [1, 1], tags: { open: { start: 0, end: 2, loop: false } },
    layers: {
      paper: { frames: [[27, 24, 90, 255, 23, 28, 85, 255]] },
      ink: { parent: 'paper', material: 'cyan', opacity: .5, pivot: [.5, 1], frames: [
        { data: [40, 24, 128, 0, 144, 200, 70, 255] },
        { data: [100, 200, 178, 170, 144, 200, 70, 0], pivot: [.8, .9] }
      ] }
    } });
  const source = path.join(dir, 'ink.json'), out = path.join(dir, 'reimported', 'ink.json');
  studio.writeRasterAsset(asset, { out: source });
  cli(source, out);
  const restored = studio.readRasterAsset(out), raw = restored.snapshot();
  assert.deepEqual(raw, asset.snapshot());
  assert.deepEqual(restored.composite(1, { tag: 'open' }), asset.composite(1, { tag: 'open' }));
  assert.equal(restored.frameAt(4, 'open'), 1);
  assert.deepEqual(restored.layer('ink', .25).pivot, [.8, .9]);
  assert.equal(restored.layer('ink').material, 'cyan');
  raw.layers.paper.parent = 'ink';
  assert.throws(() => graph.raster(raw), /hierarchy/);
  const manifest = JSON.parse(fs.readFileSync(source));
  manifest.layers.paper.frames = [manifest.layers.paper.frames[0].file];
  fs.writeFileSync(source, JSON.stringify(manifest));
  assert.deepEqual(studio.readRasterAsset(source).snapshot(), asset.snapshot());
});

test('sprite PNG interchange keeps per-view pivots, silhouette and timed cel edits', t => {
  const dir = directory(t), pixels = Uint8Array.of(121, 90, 5, 255, 8, 12, 40, 255);
  const source = path.join(dir, 'source.json'), out = path.join(dir, 'copy', 'atlas.json');
  studio.writeSpriteAtlas({ metadata: {
    width: 2, height: 1, pivot: [1, 0, 0], fps: 8,
    frames: [0, 1].map(frame => ({ frame, direction: 0, pivot: { x: .2 + frame, y: .5 },
      rect: { x: frame, y: 0, width: 1, height: 1 }, duration: .25 })),
    cels: { poses: { open: 0 }, holds: [{ frame: 'open', frames: 2 }],
      replacements: [{ frame: 'open', images: { color: Uint8Array.of(66, 105, 44, 255) } }] }
  }, images: { color: pixels, silhouette: Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 0) } }, { out: source });
  const original = studio.readSpriteAtlas(source);
  cli(source, out);
  const restored = studio.readSpriteAtlas(out);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.deepEqual(restored.select(1, 'card').pivot, original.select(1, 'card').pivot);
});
