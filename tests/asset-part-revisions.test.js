const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const studio = require('..');
const { source, scene } = require('../examples/asset-part-revisions.cjs');
const { document, readGlb } = require('../cli/glb-file.js');
const { KIT } = studio.load();
const api = KIT.authoring.assetRevisions;
const cli = (...args) => execFileSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-asset-revision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return name => path.join(dir, name);
}

test('preview resolves renamed and reindexed elements and commits only the selected placement', () => {
  const old = source(1).assetRevision(), next = source(2).assetRevision();
  assert.notEqual(old.part('housing').node, next.part('housing').node);
  const document = scene(), options = { instance: 'relay', current: old, next, file: 'relay-v2.gltf', expect: 1 };
  const { scene: revised, report } = api.replace(document, options);
  assert.equal(report.canReplace, true);
  assert.deepEqual(report.elements.materials, { retained: ['enamel', 'casing'], removed: [], added: ['recess'] });
  assert.deepEqual(report.bindings.map(row => [row.id, row.status]), [
    ['paint', 'retained'], ['lamp', 'retained'], ['hinge', 'retained'], ['probe', 'lost']
  ]);
  const lamp = report.bindings.find(row => row.id === 'lamp');
  assert.equal(lamp.frameChanged, true);
  assert.deepEqual(lamp.before.position, [.53, 1.58, .28]);
  assert.deepEqual(lamp.after.position, [.30999999999999994, 1.58, .28]);
  assert.deepEqual(revised.assetParts.battery, document.assetParts.battery);
  assert.deepEqual(revised.assetParts.relay, { ...document.assetParts.relay, file: 'relay-v2.gltf', revision: 2 });
  assert.deepEqual(revised.solids, document.solids);
  assert.equal(document.assetParts.relay.revision, 1);
  assert.throws(() => api.replace(revised, options), /Stale asset revision/);
  const restored = api.replace(revised, { ...options, current: next, next: old, file: 'relay-v1.glb', expect: 2 });
  assert.equal(restored.report.bindings.find(row => row.id === 'probe').status, 'restored');
  assert.deepEqual(restored.scene, document);
  document.assetParts.relay.bindings.probe.required = true;
  assert.deepEqual(api.preview(document, options).blockers, [{ code: 'missing-required-binding', binding: 'probe' }]);
  assert.throws(() => api.replace(document, options), /replacement blocked/);
});

test('standalone manifests can be attached and stay stable across both container formats', t => {
  const file = directory(t), asset = source(1), { document } = asset.snapshot();
  const manifest = asset.assetRevision().manifest;
  assert.deepEqual(Object.keys(manifest).sort(), ['asset', 'format', 'parts', 'revision', 'version']);
  delete document.extras.inkStudio.assetRevision;
  studio.writeGltfAsset(asset.withDocument(document), { out: file('tagged.gltf') });
  fs.writeFileSync(file('manifest.json'), JSON.stringify(manifest));
  cli('interchange', file('tagged.gltf'), '--manifest', file('manifest.json'), '--out', file('retained.glb'));
  cli('interchange', file('retained.glb'), '--out', file('retained.gltf'));
  const roundtrip = studio.readGltfAsset(file('retained.gltf'));
  assert.deepEqual(roundtrip.assetRevision().manifest, manifest);
  assert.deepEqual(roundtrip.snapshot().binary, asset.snapshot().binary);
  assert.deepEqual(JSON.parse(cli('asset-part', 'manifest', file('retained.glb'))), manifest);
  assert.throws(() => asset.withRevision({ ...manifest, parts: {
    ...manifest.parts, housing: { ...manifest.parts.housing, sockets: ['wrong'] }
  } }), /unknown or duplicate socket/);
});

test('the ordinary scene renderer uses stable material targets and can reload one pinned part', async t => {
  const file = directory(t), authored = scene();
  studio.writeGltfAsset(source(1), { out: file('relay-v1.glb') });
  studio.writeGltfAsset(source(2), { out: file('relay-v2.gltf') });
  fs.writeFileSync(file('before.json'), JSON.stringify(authored));
  cli('asset-part', 'replace', file('before.json'), 'relay', file('relay-v2.gltf'), '--expect', '1', '--out', file('after.json'));
  const revised = JSON.parse(fs.readFileSync(file('after.json'), 'utf8'));
  for (const name of ['before', 'after']) {
    assert.equal(JSON.parse(cli('validate', file(name + '.json'), '--json')).valid, true);
    cli('render', file(name + '.json'), '--w', '120', '--h', '88', '--px', '1', '--ortho', '--out', file(name + '.png'));
  }
  assert.notDeepEqual(fs.readFileSync(file('before.png')), fs.readFileSync(file('after.png')));
  const load = require('../cli/asset-part.js').loadSceneParts;
  const originalImports = await load(authored, file('before.json'), { toolkit: studio.load() });
  const newImports = { ...originalImports, relay: await studio.readAssetRevisionPart(file('relay-v2.gltf'), 'relay', revised.assetParts.relay) };
  const world = KIT.diorama.build(authored, { assetPartImports: originalImports }), [before, battery] = world.meshes;
  KIT.authoring.assetRevisions.install(world, newImports);
  assert.notEqual(world.meshes[0], before);
  assert.equal(world.meshes[1], battery);
  assert.equal(world.assetParts.relay.bindings.probe.status, 'missing');
  const trace = KIT.sceneMeshes.rayQuery(world.meshes[0], KIT);
  const hit = trace({ origin: [-.4, .90, 3], direction: [0, 0, -1], maxDistance: 5 });
  assert.deepEqual(hit.target, world.assetParts.relay.bindings.paint.resolved);
  authored.assetParts.relay.bindings.probe.required = true;
  fs.writeFileSync(file('required.json'), JSON.stringify(authored));
  assert.throws(() => cli('asset-part', 'replace', file('required.json'), 'relay', file('relay-v2.gltf'), '--out', file('blocked.json')),
    /replacement blocked/);
  assert.equal(fs.existsSync(file('blocked.json')), false);
});

test('skinned parts use their glTF rest geometry and stable joint frames', async t => {
  const file = directory(t), doc = document();
  const POSITION = doc.accessor(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), 'VEC3');
  const JOINTS_0 = doc.accessor(new Uint8Array(12), 'VEC4');
  const WEIGHTS_0 = doc.accessor(Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0), 'VEC4');
  const inverseBindMatrices = doc.accessor(Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -.25, 0, 0, 1), 'MAT4');
  doc.gltf.nodes = [
    { mesh: 0, skin: 0, translation: [9, 0, 0], children: [1], extras: { inkStudio: { partId: 'panel' } } },
    { translation: [1, 0, 0], extras: { inkStudio: { boneId: 'axis' } } }
  ];
  doc.gltf.scenes[0].nodes = [0];
  doc.gltf.meshes = [{ primitives: [{ attributes: { POSITION, JOINTS_0, WEIGHTS_0 } }] }];
  doc.gltf.skins = [{ joints: [1], inverseBindMatrices }];
  const { gltf, bin } = readGlb(doc.finish());
  const asset = KIT.authoring.gltfAssets.create({ document: gltf, binary: bin }).withRevision({
    format: api.format, version: 1, asset: 'joint-test', revision: 1, parts: { panel: { bones: ['axis'] } }
  });
  const placement = { file: 'skin.glb', asset: 'joint-test', revision: 1, part: 'panel',
    transform: { position: [3, 0, 0] }, bindings: { axis: { kind: 'bone', target: 'axis' } } };
  studio.writeGltfAsset(asset, { out: file(placement.file) });
  const { part, meshes: [mesh] } = await studio.readAssetRevisionPart(file(placement.file), 'fixture', placement);
  assert.deepEqual(part.bindings.axis.resolved.position, [4, 0, 0]);
  const trace = KIT.sceneMeshes.rayQuery(mesh, KIT), ray = x => trace({ origin: [x, .15, 3], direction: [0, 0, -1], maxDistance: 4 });
  assert(ray(4));
  assert.equal(ray(3.2), null);
});
