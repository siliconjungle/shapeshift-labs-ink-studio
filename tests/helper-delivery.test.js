const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..');
const { fixture } = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const near = (a, b) => assert.ok(K.V.dist(a, b) < 1e-6, `Expected ${a} near ${b}`);

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-delivery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return name => path.join(dir, name);
}

test('native scene delivery excludes helper visuals and retains reference frames from placed prefab members', t => {
  const file = temporary(t), { panel } = fixture();
  const body = { id: 'body', kind: 'box', at: [0, .5, 0], half: [.5, .5, .5] };
  const source = { id: 'relay', solids: [body], prefabs: { connector: { revision: 1, solids: {
    locator: { kind: 'box', at: [.6, .25, 0], half: [.2, .2, .15],
      deliveryHelper: { markerId: 'actuator', collisionRef: 'relay/collision@2', point: [.7, .25, 0] },
      sockets: { plug: { p: [.72, .25, .15], dir: [0, 0, 1] } }
    }
  }, topologyMeshes: { label: { ...panel, pivot: [.1, .4, 0],
    materials: panel.materials.map(({ texture, ...material }) => material),
    bindings: [], points: { tab: { position: [.4, .3, 0] } }, deliveryHelper: {} } } } },
    instances: { west: { prefab: 'connector', transform: { translation: [3, 0, 0], rotation: [.4, .2, 0] } },
      upper: { prefab: 'connector', parent: 'west', transform: { translation: [0, 1.4, 0] }, flipX: true } }
  };
  const editor = ink.createSceneEditor(source);
  const world = editor.build();
  assert.ok(world.renderMetadata.objects.includes('west.locator'));
  assert.ok(world.topologyMeshes['west.label']);
  editor.editSceneLayers({ action: 'set', layer: 'inspection' });
  editor.editSceneLayers({ action: 'move', layer: 'inspection', instances: ['upper'] });
  editor.editSceneLayers({ action: 'set', layer: 'inspection', visible: false });
  const deliverable = editor.snapshot();

  fs.writeFileSync(file('scene.json'), JSON.stringify(deliverable));
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
  const receipt = run('export-glb', file('scene.json'), '--out', file('relay.glb'),
    '--res', '.15', '--texture-size', '0');
  assert.deepEqual(receipt.helpers.map(row => row.helperId), ['west.locator', 'west.label']);
  const asset = ink.readGltfAsset(file('relay.glb')), { document } = asset.snapshot();
  assert.equal(document.meshes.length, 1);
  const positions = document.meshes[0].primitives.map(row => document.accessors[row.attributes.POSITION]);
  assert.ok(positions.every(row => row.max[0] <= .51));
  for (const helper of receipt.helpers) {
    const raw = document.nodes[helper.node], sample = asset.sample(), node = sample.find(row => row.id === helper.node);
    assert.ok(!Object.hasOwn(raw, 'mesh'));
    assert.equal(node.helper.prefabId, 'connector');
    assert.equal(node.helper.instanceId, 'west');
    near(node.world.slice(12, 15), helper.position);
    for (const socket of helper.sockets) {
      const child = sample.find(row => row.id === socket.node);
      assert.equal(child.parent, node.id);
      assert.equal(child.socketId, socket.socketId);
      near(child.world.slice(12, 15), socket.position);
    }
  }
  const locator = receipt.helpers[0], label = receipt.helpers[1];
  const worldPoint = K.diorama.solidFrames.authored(source.instances.west.transform).point;
  assert.equal(locator.markerId, 'actuator');
  assert.equal(locator.collisionRef, 'relay/collision@2');
  near(locator.position, worldPoint([.7, .25, 0]));
  near(locator.sockets[0].position, worldPoint([.72, .25, .15]));
  near(label.position, worldPoint([.1, .4, 0]));
});

test('metadata-only delivery follows the source rig and survives container conversion', t => {
  const file = temporary(t);
  const source = { id: 'hinge', solids: [
    { id: 'handle', kind: 'box', at: [1, 0, 0], half: [.18, .18, .18], part: 'lever',
      deliveryHelper: { socketId: 'grip' } }
  ], parts: { lever: { joint: [0, 0, 0] } },
  motion: [{ part: 'lever', do: 'spin', axis: [0, 0, 1], speed: 1 }] };
  const scene = K.diorama.scene(source), model = scene.model(1, { duration: 1, fps: 4 });
  assert.equal(model.meshes.length, 0);
  const report = ink.exportGlb(model, { out: file('hinge.glb') });
  assert.deepEqual(report.meshes, []);
  const asset = ink.readGltfAsset(report.file);
  const { document } = asset.snapshot(), helper = report.helpers[0];
  assert.equal(document.meshes, undefined);
  assert.equal(document.nodes[helper.node].mesh, undefined);
  const at = time => asset.sample(time, { clip: 0 }).find(row => row.id === helper.node).world.slice(12, 15);
  near(at(0), [1, 0, 0]);
  const world = scene.build(1);
  world.anim.update(0, 0);
  world.anim.update(.5, .5);
  const index = world.lab.rig.names.indexOf('lever') * 12;
  const matrix = Array.from(world.lab.rig.M.slice(index, index + 12));
  near(at(.5), K.V.add(K.M.app(matrix.slice(0, 9), [1, 0, 0]), matrix.slice(9)));
  assert.ok(K.V.dist(at(0), at(.5)) > .1);

  ink.writeGltfAsset(asset, { out: file('hinge.gltf') });
  const reopened = ink.readGltfAsset(file('hinge.gltf'));
  ink.writeGltfAsset(reopened, { out: file('repacked.glb') });
  assert.deepEqual(ink.readGltfAsset(file('repacked.glb')).sample(.5, { clip: 0 }), reopened.sample(.5, { clip: 0 }));
  assert.equal(reopened.sample().find(row => row.id === helper.node).socketId, 'grip');
});

test('validates helper metadata and exports static affine frames without a mesh or buffer', t => {
  const file = temporary(t);
  const affine = { position: [2, 3, 0], matrix: [-1, .3, 0, 0, 2, .4, 0, 0, 1] };
  const row = { kind: 'box', at: [0, 0, 0], half: [.3, .3, .3], id: 'datum', restAffine: affine };
  const source = helper => ({ id: 'datum', solids: [{ ...row, deliveryHelper: helper }] });
  for (const helper of [{}, { socketId: 'bad id' }, { markerId: 'mark', point: [0, 0] }, { collisionRef: '' }])
    assert.ok(K.diorama.check(source(helper)).some(row => row.level === 'error' && row.path.endsWith('.deliveryHelper')));
  const model = K.diorama.scene(source({ markerId: 'datum' })).model(1);
  const exported = ink.exportGlb(model, { out: file('datum.glb') }), asset = ink.readGltfAsset(exported.file);
  assert.equal(asset.snapshot().binary.length, 0);
  const node = asset.sample().find(row => row.helper);
  const { matrix, position } = affine;
  near(node.world.slice(12, 15), position);
  for (let column = 0; column < 3; column++)
    near(node.world.slice(column * 4, column * 4 + 3), [matrix[column], matrix[3 + column], matrix[6 + column]]);
});
