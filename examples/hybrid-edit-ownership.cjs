'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');
const { spriteAtlas, writeAtlas } = require('../cli/sprite-atlas.js');

const manifest = {
  format: 'ink-studio/hybrid-ownership', version: 1,
  sources: {
    solid: { kind: 'sdf', target: { object: 'relay-solid' } },
    enamel: { kind: 'atlas', target: { object: 'relay-atlas' } },
    fringe: { kind: 'splats', target: { object: 'relay', part: 'fringe' } }
  },
  parts: [{
    object: 'relay', part: 'housing',
    owners: {
      shape: { source: 'solid', destination: 'carve' },
      pigment: { source: 'enamel' },
      coverage: { source: 'solid' },
      detail: { source: 'fringe' }
    },
    derived: [
      { id: 'render-mesh', kind: 'mesh' },
      { id: 'distant-card', kind: 'card' },
      { id: 'occlusion-proxy', kind: 'proxy' }
    ]
  }]
};
const scene = {
  id: 'relay-station', style: 'slate', hybridOwnership: manifest,
  solids: [{ id: 'relay-solid', kind: 'box', at: [0, 0, 0], half: [1.61, .82, .235],
    round: .125, mat: 'stone', res: .08 }]
};
const document = {
  format: 'ink-studio/pixel-art', version: 2, width: 112, height: 76, pixelAspect: [1, 1],
  palette: { cream: '#f1d694' }, layers: [{ id: 'ink' }],
  frames: [{ id: 'front', durationMs: 100, cels: {} }],
  sceneBindings: [{ id: 'solid', scene: scene.id, object: 'relay-solid' }],
  destinations: [{ id: 'carve', kind: 'sdf-shape', binding: 'solid' }]
};
const camera = { target: [0, -.01, 0], dist: 4.9, yaw: .26, pitch: .15, ortho: true };
const view = { w: document.width, h: document.height, px: 1, raw: true, transparent: true };
const bounds = { min: [-1.86, -1.06, -.47], max: [1.86, 1.06, .47] };
const letters = {
  R: ['110', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  Y: ['101', '101', '010', '010', '010'],
  '7': ['111', '001', '010', '010', '010']
};
const colors = [0x182735, 0x614545, 0x986551, 0xd18e66, 0xf5c987, 0xffe7ae];

function atlas(teal) {
  const width = 80, height = 44, pixels = new Uint8Array(width * height * 4);
  const coat = teal ? [48, 127, 119] : [153, 72, 67];
  const rim = teal ? [34, 67, 71] : [87, 46, 49];
  function pixel(x, y, color) { pixels.set([...color, 255], (y * width + x) * 4); }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const edge = Math.min(x, width - 1 - x, y, height - 1 - y);
    const stripe = x > 46 && y > 31 && y < 38 && (x + y) % 9 < 4;
    const seam = y === 9 || y === 39 || x === 43;
    const stipple = y > 26 && (11 * x + 19 * y) % 53 === 0;
    const bolt = [5, 74].some(cx => [5, 40].some(cy => (cx - x) ** 2 + (cy - y) ** 2 < 5));
    const color = bolt ? [239, 183, 112] : stripe ? [220, 161, 92] : edge < 3 || seam ?
      rim : coat.map(value => value + (edge === 3 || stipple ? 24 : 0));
    pixel(x, y, color);
  }
  for (const [i, letter] of Array.from('RLY7').entries()) {
    letters[letter].forEach((row, y) => Array.from(row).forEach((ink, x) => {
      if (ink === '1') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
        pixel(47 + i * 8 + x * 2 + dx, 15 + y * 2 + dy, [255, 214, 145]);
    }));
  }
  return { width, height, pixels };
}

function fringe(count) {
  return Array.from({ length: count }, (_, i) => {
    const u = i / 36;
    return [1.13 + u * .72 + .053 * Math.sin(i * 9), -.44 - u * .70 + .065 * Math.sin(i * 2.1),
      .28 + .08 * Math.cos(i * 3.2), .063 + .036 * Math.sin(i * 1.2) ** 2, 1 + i % 5];
  });
}

function run(dir) {
  const { KIT, makeBuilder } = ink.load(), api = KIT.authoring.hybridOwnership;
  const geometryCache = new WeakMap();
  function geometry(shape, coverage) {
    assert.equal(shape, coverage);
    if (!geometryCache.has(shape)) {
      const field = KIT.diorama.brushField(shape);
      const surface = KIT.procedural.geometry.surfaceNets(field.sdf, bounds, { cell: .054, refine: 1 });
      geometryCache.set(shape, { positions: surface.points.flat(), indices: surface.triangles.flat(),
        uvs: surface.points.flatMap(([x, y]) => [Math.max(0, Math.min(1, .5 + x / 3.24)),
          Math.max(0, Math.min(1, .5 - y / 1.66))]) });
    }
    return geometryCache.get(shape);
  }
  function mesh(owned) {
    return KIT.sceneMeshes.create({ id: 'render-mesh', objectId: 'relay', partId: 'housing',
      ...geometry(owned.shape.value, owned.coverage.value),
      materials: [{ id: 'enamel', texture: owned.pigment.value }] });
  }
  function proxy(owned) {
    const { positions, indices } = geometry(owned.shape.value, owned.coverage.value);
    return KIT.sceneMeshes.depthProxy({ id: 'occlusion-proxy', objectId: 'relay', positions, indices });
  }
  function world(mesh, splats, proxy) {
    const builder = makeBuilder(29, colors);
    for (const [x, y, z, size, color] of splats)
      builder.disc(x, y, z, [0, 0, 1], size, .024, builder.P[color], .86);
    builder.describeSplats(0, builder.count(), { object: 'relay', target: { part: 'fringe' } });
    return builder.finish({ cam: camera, dither: 0, radius: 3, meshes: [mesh],
      splatDepthProxies: { meshes: [proxy], tolerance: .015 } });
  }
  const builds = api.create(manifest, {
    mesh: ({ owned }) => mesh(owned), proxy: ({ owned }) => proxy(owned),
    card({ owned }) {
      return spriteAtlas(world(mesh(owned), owned.detail.value, proxy(owned)), {
        width: view.w, height: view.h, directions: 1, view: { raw: true }, maps: ['depth', 'normal']
      });
    }
  });
  function snapshot(solid, shape, enamel, pigment, fibers, detail) {
    return { solid: { value: solid, revision: { shape, coverage: shape } },
      enamel: { value: enamel, revision: pigment }, fringe: { value: fibers, revision: detail } };
  }
  const sceneRef = 'scene.json';
  const portableDocument = { ...document, sceneBindings: document.sceneBindings.map(binding => ({ ...binding, scene: sceneRef })) };
  const source = ink.createSceneEditor(scene);
  const editor = ink.createPixelEditor(portableDocument, { sceneEditor: source, sceneRef });
  const before = source.snapshot(), rust = atlas(false), teal = atlas(true), full = fringe(35), trimmed = fringe(16);
  const initial = snapshot(before, 0, rust, 0, full, 0);
  const address = { object: 'relay', part: 'housing', channel: 'shape' };
  const route = source.hybridRoute(address);
  const patch = { id: 'service-hatch', revision: editor.describe().revision, frame: 'front',
    destination: route.destination, ownership: address, operation: { modifier: {
      kind: 'join', how: 'cut', shape: { kind: 'box', at: [-.73, -.09, 0], half: [.44, .40, .56], round: .14 }
    } } };
  patch.sourceRevision = editor.previewEdit(patch).sourceRevision;
  const preview = editor.previewEdit(patch, { exact: true });
  assert.deepEqual(preview.conflicts, []);
  assert.equal(preview.targets[0].ownership.source, 'solid');
  editor.apply(patch);
  const receipt = editor.receipts().at(-1), cut = source.snapshot();
  const inputs = [initial, snapshot(cut, 1, rust, 0, full, 0), snapshot(cut, 1, teal, 1, full, 0),
    snapshot(cut, 1, teal, 1, trimmed, 1)];
  const stages = ['01-original', '02-sdf-cut', '03-atlas-paint', '04-splat-trim'];
  const results = inputs.map(values => builds.rebuild(values));
  assert.notEqual(results[0].assets['occlusion-proxy'], results[1].assets['occlusion-proxy']);
  assert.equal(results[1].assets['occlusion-proxy'], results[2].assets['occlusion-proxy']);
  assert.equal(results[2].assets['render-mesh'], results[3].assets['render-mesh']);
  assert.notDeepEqual(results[2].assets['distant-card'].images.color, results[3].assets['distant-card'].images.color);

  fs.mkdirSync(dir, { recursive: true });
  const json = (name, value) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(value, null, 2) + '\n');
  const frames = results.map(({ assets, report }, i) => {
    const frame = ink.render(world(assets['render-mesh'], inputs[i].fringe.value, assets['occlusion-proxy']),
      { ...view, passes: ['proxyDepth'] });
    const output = path.join(dir, stages[i]);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'near.png'), PNG.encodeFrame(PNG.packFrame(frame)));
    writeAtlas(output, assets['distant-card']);
    const proxyPixels = Array.from(frame.passes.proxyDepth).filter(Number.isFinite).length;
    return { frame, card: assets['distant-card'].images.color, proxyPixels, report };
  });
  assert(frames[1].proxyPixels < frames[0].proxyPixels);
  assert.equal(frames[2].proxyPixels, frames[1].proxyPixels);
  json('ownership', manifest);
  json('scene', scene);
  json('route', route);
  json('pixel-document', portableDocument);
  json('cut-patch', patch);
  json('cut-preview', preview);
  json('cut-receipt', receipt);
  json('01-rebuild', frames[0].report);
  json('revisions', Object.fromEntries(Object.entries(inputs[1]).map(([id, data]) => [id, data.revision])));
  json('rebuild-report', frames.map(({ report, proxyPixels }, i) => ({ stage: stages[i], proxyPixels, ...report })));

  const scale = 2, gap = 8, panelWidth = view.w * scale, panelHeight = view.h * scale;
  const width = panelWidth * stages.length + gap * (stages.length + 1), height = panelHeight * 2 + gap * 3;
  const sheet = new Uint8Array(width * height * 3);
  for (let i = 0; i < sheet.length; i += 3) sheet.set([14, 21, 32], i);
  for (const [column, { frame, card }] of frames.entries()) {
    for (let row = 0; row < 2; row++) for (let y = 0; y < panelHeight; y++) for (let x = 0; x < panelWidth; x++) {
      const p = Math.floor(y / scale) * view.w + Math.floor(x / scale);
      const backdrop = [30, 41, 57].map(channel => channel + Math.floor(y / 18));
      const src = row ? card : frame.rgb, stride = row ? 4 : 3;
      const alpha = (row ? card[4 * p + 3] : frame.alpha[p]) / 255;
      const offset = ((gap + row * (panelHeight + gap) + y) * width + gap + column * (panelWidth + gap) + x) * 3;
      for (let channel = 0; channel < 3; channel++)
        sheet[offset + channel] = Math.round(backdrop[channel] * (1 - alpha) + src[stride * p + channel] * alpha);
    }
  }
  fs.writeFileSync(path.join(dir, 'relay-comparison.png'), PNG.encode(width, height, sheet, 3));
  return frames;
}

if (require.main === module) run(path.resolve(process.argv[2] ?? 'output/hybrid-ownership'));
module.exports = { manifest, scene, document, run };
