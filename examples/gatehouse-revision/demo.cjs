'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const studio = require('../..');
const { loadSceneParts } = require('../../cli/asset-part.js');
const files = require('../../cli/asset-files.js');
const PNG = require('../../cli/png.js');
const { grid, upscale } = require('../../cli/render.js');
const { cameraPlan } = require('../../cli/render-suite.js');
const { pose } = require('../../cli/diarama-pose.js');
const decode = require('../../cli/gltf-image.js');
const gatehouse = require('../opaque-surface-gate.js');
const P = require('./portal.cjs');

const width = 128, height = 80, fps = 12, framesPerMove = 9;
const beforeNative = 'native-before.json', afterNative = 'native-after.json';
const beforeAsset = 'placed-before.json', afterAsset = 'placed-after.json';
const paintId = 'sign-paint', anchorId = 'sign-anchor', witnessId = 'exit-clearance-probe';
const lanes = ['Original', 'Native edit', 'Asset replacement'];
const ownership = {
  format: 'ink-studio/hybrid-ownership', version: 1,
  sources: {
    geometry: { kind: 'mesh', target: { object: P.object, part: P.part } },
    atlas: { kind: 'atlas', target: { object: P.object, part: P.part } }
  },
  parts: [{ object: P.object, part: P.part, owners: {
    shape: { source: 'geometry', destination: 'portal-topology' }, pigment: { source: 'atlas' },
    coverage: { source: 'geometry' }, detail: { source: 'atlas' }
  } }]
};
const pixelDocument = {
  format: 'ink-studio/pixel-art', version: 2, width, height, pixelAspect: [1, 1],
  palette: { brass: '#ffe1a2' }, layers: [{ id: 'review' }],
  frames: [{ id: 'orbit', durationMs: 100, cels: {} }],
  sceneBindings: [{ id: 'portal', scene: beforeNative, object: P.object, part: P.part }],
  destinations: [{ id: 'portal-topology', kind: 'mesh-topology', binding: 'portal' }]
};

function sourceScene(topology, atlas, camera) {
  const { target, dist, yaw, pitch } = camera;
  const texture = { ...atlas, pixels: Array.from(atlas.pixels) };
  return { id: 'painted-gatehouse-revision', style: 'slate', camera: { target, dist, yaw, pitch, sway: 0 },
    solids: [], hybridOwnership: ownership, topologyMeshes: {
      [P.object]: { document: topology, part: P.part,
        materials: [P.stone, P.sign, P.tunnel, P.bevel].map(id => ({ id, texture })),
        bindings: [{ id: anchorId, domain: 'faces', element: P.sign }],
        bakes: [{ id: paintId, material: P.sign, maps: { texture } }] }
    } };
}

function scenePlacement(scene) {
  const { topologyMeshes, ...base } = scene;
  return { ...base, assetParts: { [P.object]: { file: 'gatehouse-v1.glb', asset: P.assetId, revision: 1, part: P.part,
    bindings: { [paintId]: { kind: 'material', target: P.sign }, [anchorId]: { kind: 'socket', target: anchorId } }
  } } };
}

function installedAtlas(kit, filename) {
  const { document, binary } = studio.readGltfAsset(filename).snapshot();
  const { pixels, mime } = kit.authoring.assetTextures.embeddedImage({ json: document, bin: binary }, 0);
  return decode(pixels, mime);
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function compareAtlas(original, revised) {
  assert.equal(original.width, revised.width);
  assert.equal(original.height, revised.height);
  const a = Uint8Array.from(original.pixels), b = Uint8Array.from(revised.pixels);
  assert.equal(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < a.length; i += 4)
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) changed++;
  return { texels: a.length / 4, changed, before: sha(a), after: sha(b) };
}

function witness(kit) {
  return kit.sceneMeshes.create({ id: witnessId, positions: [-1.35, 1.17, -.49, 2, 1.17, -.49,
    -1.35, .48, -.49, 2, .48, -.49], uvs: [0, 0, 1, 0, 0, 1, 1, 1],
  indices: [0, 2, 1, 2, 3, 1], materials: [{ id: witnessId, color: 0x62d1cb }] });
}

function footprint(frame, name, channel) {
  const names = channel === 'objectId' ? frame.passes.objects : frame.passes.materials;
  const id = names.indexOf(name);
  const mask = Uint8Array.from(frame.passes[channel], value => value === id ? 1 : 0);
  let maxRun = 0, pixels = 0;
  for (let y = 0; y < frame.h; y++) {
    let run = 0;
    for (let x = 0; x < frame.w; x++) {
      const active = mask[y * frame.w + x];
      pixels += active;
      run = active ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    }
  }
  return { mask, pixels, maxRun };
}

function verifySign(before, after) {
  const old = footprint(before, P.sign, 'materialId'), next = footprint(after, P.sign, 'materialId');
  assert(old.pixels >= 12, 'The sign must be visible at the native art resolution');
  assert.deepEqual(next.mask, old.mask, 'The sign moved or was occluded');
  let changed = 0;
  for (let p = 0; p < old.mask.length; p++) if (old.mask[p])
    for (let c = 0; c < 3; c++) if (before.rgb[p * 3 + c] !== after.rgb[p * 3 + c]) { changed++; break; }
  assert.equal(changed, 0, 'The visible sign changed color');
  return { pixels: old.pixels, changed };
}

function worldClearance(kit, meshLanes) {
  const samples = [-1.10, -.39, .56, 1.51, 2.20];
  const clear = meshLanes.map(([mesh]) => {
    const trace = kit.sceneMeshes.rayQuery(mesh, kit);
    return samples.map(x => !trace({ origin: [x, .84, 1.6], direction: [0, 0, -1], maxDistance: 3 }));
  });
  assert.deepEqual(clear, [
    [false, false, true, false, false],
    [false, true, true, true, false],
    [false, true, true, true, false]
  ]);
  return { x: samples, height: .84, clear };
}

function displayClearance(frame, mask) {
  const rgb = Uint8Array.from(frame.rgb);
  for (let i = 0; i < mask.length; i++) if (mask[i]) rgb.set([91, 221, 207], 3 * i);
  return { w: frame.w, h: frame.h, rgb };
}

async function run(directory) {
  const dir = path.resolve(directory);
  fs.mkdirSync(dir, { recursive: true });
  const kit = studio.load(), { KIT: K } = kit;
  const example = gatehouse(kit);
  const world = example.build(example.seed, { sdfPortal: false });
  const atlas = P.atlas(), original = K.meshTopology.create(P.portal(false)), target = K.meshTopology.create(P.portal(true));
  const scene = sourceScene(original, atlas, world.cam);
  const location = name => path.join(dir, name);
  const save = (name, value) => files.json(location(name), value);
  const load = name => JSON.parse(fs.readFileSync(location(name), 'utf8'));
  const cli = (...args) => execFileSync(process.execPath,
    [path.resolve(__dirname, '../../cli/ink-studio.js'), ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });

  save(beforeNative, scene);
  save('pixel-document.json', pixelDocument);
  const sceneEditor = studio.createSceneEditor(scene);
  const editor = studio.createPixelEditor(pixelDocument, { sceneEditor, sceneRef: beforeNative });
  const address = { object: P.object, part: P.part, channel: 'shape' };
  const route = sceneEditor.hybridRoute(address);
  const patch = { id: 'widen-and-bevel', revision: editor.describe().revision, frame: 'orbit', destination: route.destination,
    ownership: address, operation: { patch: P.editPatch(original, target) } };
  patch.sourceRevision = editor.previewEdit(patch).sourceRevision;
  save('native-patch.json', patch);
  const editArgs = ['pixel-document.json', 'native-patch.json', '--scene', beforeNative];
  cli('pixel-art', 'preview', ...editArgs, '--exact', '--out', 'native-preview.json');
  const preview = load('native-preview.json');
  assert(preview.valid && preview.diff.topology.length === 1, 'The native edit must preview with topology evidence');
  assert.deepEqual(preview.diff.topology[0].changes.bakes, [], 'An unchanged sign bake must stay ready');
  const receipt = JSON.parse(cli('pixel-art', 'edit', ...editArgs, '--out', afterNative));
  assert.equal(receipt.affectedTargets[0].ownership.source, 'geometry');
  save('native-receipt.json', receipt);
  const edited = load(afterNative), beforeRow = scene.topologyMeshes[P.object], editedRow = edited.topologyMeshes[P.object];
  assert.deepEqual(editedRow.materials, beforeRow.materials);
  assert.deepEqual(editedRow.bakes, beforeRow.bakes);
  assert.deepEqual(editedRow.bindings, beforeRow.bindings);
  assert.deepEqual(editedRow.document.faces.find(row => row.id === P.sign), original.faces.find(row => row.id === P.sign));
  const paint = row => row.materials.find(item => item.id === P.stone).texture;

  studio.writeGltfAsset(P.gltf(K, original, atlas, 1), { out: location('gatehouse-v1.glb') });
  studio.writeGltfAsset(P.gltf(K, editedRow.document, atlas, 2), { out: location('gatehouse-v2.glb') });
  const placed = scenePlacement(scene);
  save(beforeAsset, placed);
  const replacementArgs = [beforeAsset, P.object, 'gatehouse-v2.glb', '--expect', '1'];
  const replacementPreview = JSON.parse(cli('asset-part', 'preview', ...replacementArgs));
  assert(replacementPreview.canReplace);
  assert.deepEqual(replacementPreview.elements.materials.added, [P.bevel]);
  assert.deepEqual(replacementPreview.bindings.map(({ id, status, frameChanged }) => [id, status, frameChanged ?? false]),
    [[paintId, 'retained', false], [anchorId, 'retained', false]]);
  save('replacement-preview.json', replacementPreview);
  cli('asset-part', 'replace', ...replacementArgs, '--out', afterAsset);
  const placedAfter = load(afterAsset);
  const originalImports = await loadSceneParts(placed, location(beforeAsset), { toolkit: kit });
  const imports = await loadSceneParts(placedAfter, location(afterAsset), { toolkit: kit });
  assert.equal(imports[P.object].part.revision, 2);

  const atlases = {
    native: compareAtlas(paint(beforeRow), paint(editedRow)),
    replacement: compareAtlas(installedAtlas(K, location('gatehouse-v1.glb')), installedAtlas(K, location('gatehouse-v2.glb')))
  };
  assert.equal(atlases.native.changed, 0);
  assert.equal(atlases.replacement.changed, 0);
  assert.equal(atlases.native.after, atlases.replacement.after);

  const old = sceneEditor.build(), revised = studio.createSceneEditor(edited).build();
  const assetWorld = { ...world };
  K.authoring.assetRevisions.install(assetWorld, originalImports);
  const replaced = assetWorld.meshes[0];
  K.authoring.assetRevisions.install(assetWorld, imports);
  assert.notEqual(assetWorld.meshes[0], replaced);
  assert.equal(assetWorld.assetParts[P.object].bindings[paintId].status, 'bound');
  assert.equal(assetWorld.assetParts[P.object].bindings[anchorId].status, 'bound');
  const meshLanes = [old.meshes, revised.meshes, assetWorld.meshes];
  const clearance = worldClearance(K, meshLanes);
  const probe = witness(K), camera = cameraPlan(world.cam, framesPerMove, fps).filter(sample => sample.move === 'orbit');
  // Use the existing screen animation at the left end of its travel for every matched camera.
  const screenTime = 3 * Math.PI / 1.8;
  pose(world, screenTime, { kit });
  const metrics = [], images = [], clearanceImages = [];
  for (const sample of camera) {
    const options = { ...sample.camera, w: width, h: height, px: 1, t: screenTime,
      lockCamera: true, passes: ['objectId', 'materialId'] };
    const frames = meshLanes.map(meshes => studio.render({ ...world, meshes }, options));
    const clear = meshLanes.map(meshes => footprint(studio.render({ ...world, meshes: [...meshes, probe] }, options),
      witnessId, 'objectId'));
    const orbit = sample.frameInMove + 1;
    assert(clear[1].maxRun >= clear[0].maxRun + 2,
      'The widened passage must gain two contiguous pixels at view ' + orbit + ' (' +
      clear[0].maxRun + ' → ' + clear[1].maxRun + ')');
    assert(clear[1].pixels >= clear[0].pixels + 12, 'The widened passage must gain visible exit area at view ' + orbit);
    assert.deepEqual(clear[2].mask, clear[1].mask, 'Both edit paths must open the same exit pixels');
    assert.deepEqual(frames[2].rgb, frames[1].rgb, 'The imported revision must match the native render');
    const rim = footprint(frames[1], P.bevel, 'materialId');
    assert(rim.pixels >= 8, 'The bevel must show up at the native resolution in view ' + orbit);
    const sign = verifySign(frames[0], frames[1]);
    metrics.push({ orbit, camera: sample.camera,
      visibleExitPixels: clear.map(row => row.pixels), widestClearRun: clear.map(row => row.maxRun),
      sign, bevelPixels: rim.pixels });
    images.push(frames);
    if (orbit === 1 || orbit === 5 || orbit === 9)
      clearanceImages.push([displayClearance(frames[0], clear[0].mask), displayClearance(frames[1], clear[1].mask)]);
  }

  const report = { format: 'ink-studio/painted-gatehouse-acceptance', version: 1, grid: { width, height }, lanes, screenTime,
    clearance, atlases, replacementRevision: imports[P.object].part.revision, frames: metrics };
  save('report.json', report);
  fs.writeFileSync(location('pigment-atlas.png'), PNG.encode(atlas.width, atlas.height, atlas.pixels, 4));
  const comparison = grid([images[0], images[4], images[8]].flat().map(frame => upscale(frame, 2)), 3);
  PNG.write(location('comparison.png'), comparison.w, comparison.h, comparison.rgb);
  const diagnostic = grid(clearanceImages.flat().map(frame => upscale(frame, 2)), 2);
  PNG.write(location('clearance.png'), diagnostic.w, diagnostic.h, diagnostic.rgb);
  PNG.animate(location('orbit.apng'), images.map(frames => grid(frames, 3)), fps);
  return report;
}

if (require.main === module) run(process.argv[2] ?? 'output/gatehouse-revision').catch(error => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
module.exports = { run, sourceScene };
