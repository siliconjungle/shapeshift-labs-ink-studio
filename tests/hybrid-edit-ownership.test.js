'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { manifest, scene, document } = require('../examples/hybrid-edit-ownership.cjs');

const { KIT, makeBuilder } = ink.load();
const api = KIT.authoring.hybridOwnership;
const address = channel => ({ object: 'relay', part: 'housing', channel });
const pins = { solid: { shape: 0, coverage: 0 }, enamel: 0, fringe: 0 };
const summary = ({ outputs }) => Object.fromEntries(outputs.map(({ id, status }) => [id, status]));

test('scene ownership is validated and mounted with stable routes to authored sources', () => {
  const invalid = structuredClone(scene);
  delete invalid.hybridOwnership.parts[0].owners.coverage;
  assert.throws(() => ink.createSceneEditor(invalid), /Invalid coverage owner/);
  const confused = structuredClone(manifest);
  confused.parts[0].owners.shape = { source: 'enamel' };
  assert.throws(() => api.prepare(confused), /Invalid shape owner/);
  const proxy = structuredClone(manifest);
  proxy.parts[0].derived.at(-1).uses = ['pigment', 'coverage'];
  assert.throws(() => api.prepare(proxy), /Invalid channels for derived proxy/);
  assert.equal(KIT.diorama.build(scene).hybridOwnership.parts[0].object, 'relay');
  assert.deepEqual(ink.createSceneEditor(scene).hybridRoute(address('shape')), {
    ...address('shape'), source: 'solid', kind: 'sdf', target: { object: 'relay-solid' }, destination: 'carve',
    derived: [{ id: 'render-mesh', kind: 'mesh' }, { id: 'distant-card', kind: 'card' },
      { id: 'occlusion-proxy', kind: 'proxy' }]
  });
  assert.equal(api.manages(manifest, { object: 'relay-solid' }), true);
  assert.equal(api.manages(manifest, { object: 'relay' }), true);
  assert.equal(api.manages(manifest, { object: 'relay', part: 'mount' }), false);
});

test('rebuilds use exact owner channels and publish only after every requested builder succeeds', () => {
  const declaration = structuredClone(manifest);
  // One atlas supplies both channels, independently revisioned.
  declaration.parts[0].owners.coverage = { source: 'enamel' };
  const baseline = { ...pins, enamel: { pigment: 0, coverage: 0 } };
  const repaint = { ...baseline, enamel: { pigment: 1, coverage: 0 } };
  const report = api.plan(declaration, baseline);
  const restored = JSON.parse(JSON.stringify(report));
  assert.deepEqual(summary(api.plan(declaration, repaint, restored)), {
    'render-mesh': 'rebuild', 'distant-card': 'rebuild', 'occlusion-proxy': 'reuse'
  });
  assert.throws(() => api.plan(declaration, { ...baseline, enamel: { pigment: 1 } }), /Missing revision.*coverage/);
  assert.throws(() => api.plan(declaration, baseline, { ...restored, outputs: [{ id: 'render-mesh' }] }), /Invalid output/);
  assert.deepEqual(api.route(declaration, address('pigment')).derived.map(row => row.id), ['render-mesh', 'distant-card']);

  let fail = false;
  const controller = api.create(declaration, {
    mesh: ({ owned }) => ({ geometry: owned.shape.value, paint: owned.pigment.value }),
    card: ({ owned }) => {
      if (fail) throw new Error('card bake failed');
      return { detail: owned.detail.value, paint: owned.pigment.value };
    },
    proxy: ({ owned }) => ({ coverage: owned.coverage.revision })
  });
  const snapshots = revisions => Object.fromEntries(Object.entries(revisions).map(([id, revision]) =>
    [id, { revision, value: { id, revision } }]));
  const first = controller.rebuild(snapshots(baseline)), painted = controller.rebuild(snapshots(repaint));
  assert.equal(first.assets['occlusion-proxy'], painted.assets['occlusion-proxy']);
  assert.notEqual(first.assets['render-mesh'], painted.assets['render-mesh']);
  assert.deepEqual(painted.report.outputs.find(row => row.kind === 'card').changedChannels, ['pigment']);
  fail = true;
  assert.throws(() => controller.rebuild(snapshots({ ...repaint, fringe: 1 })), /card bake failed/);
  assert.equal(controller.current(), painted);
  fail = false;
  const trimmed = controller.rebuild(snapshots({ ...repaint, fringe: 1 }));
  assert.equal(trimmed.assets['render-mesh'], painted.assets['render-mesh']);
  assert.equal(trimmed.assets['occlusion-proxy'], painted.assets['occlusion-proxy']);
  assert.notEqual(trimmed.assets['distant-card'], painted.assets['distant-card']);
});

test('pixel previews, commits, undo and replay check the physical owner', () => {
  const hybrid = structuredClone(scene);
  hybrid.hybridOwnership.parts[0].derived[0].target = { object: 'render-mesh' };
  const pixels = { ...document, sceneBindings: [...document.sceneBindings,
    { id: 'derived', scene: scene.id, object: 'render-mesh' }],
    destinations: [...document.destinations, { id: 'another-carve', kind: 'sdf-shape', binding: 'solid' },
      { id: 'edit-mesh', kind: 'mesh-topology', binding: 'derived' }] };
  const source = ink.createSceneEditor(hybrid), editor = ink.createPixelEditor(pixels, { sceneEditor: source });
  const patch = { id: 'cut', revision: editor.describe().revision, frame: 'front', destination: 'carve',
    operation: { modifier: { kind: 'join', how: 'cut', shape: { kind: 'box', at: [0, 0, 0], half: [.3, .4, .6] } } } };
  assert.equal(editor.previewEdit(patch).conflicts[0].code, 'hybrid-owner-required');
  assert.equal(editor.previewEdit({ ...patch, destination: 'edit-mesh' }).conflicts[0].code, 'hybrid-owner-required');
  const edit = { ...patch, ownership: address('shape') };
  assert.equal(editor.previewEdit({ ...edit, destination: 'another-carve' }).conflicts[0].code, 'wrong-hybrid-owner');
  assert.equal(editor.previewEdit({ ...edit, destination: 'edit-mesh' }).conflicts[0].code, 'wrong-hybrid-owner');
  const preview = editor.previewEdit(edit);
  assert.equal(preview.valid, true, JSON.stringify(preview.conflicts));
  assert.equal(preview.targets[0].ownership.source, 'solid');
  assert.deepEqual(source.snapshot(), hybrid);
  editor.begin('Cut the source field');
  editor.apply(edit);
  const receipt = editor.receipts().at(-1);
  assert.deepEqual(receipt.affectedTargets[0].ownership.channels, ['shape']);
  assert.equal(editor.previewChanges().targets[0].ownership.source, 'solid');
  editor.commit();
  assert.equal(source.snapshot().solids[0].modifiers[0].id, 'cut');
  assert.equal(editor.undo(), true);
  assert.deepEqual(source.snapshot(), hybrid);
  const replay = ink.createPixelEditor(pixels, { sceneEditor: ink.createSceneEditor(hybrid) });
  replay.replay(receipt);
  assert.equal(replay.sceneEditor.snapshot().solids[0].modifiers[0].id, 'cut');
});

test('atlas pigment uses the registered surface channel while SDF shape stays with the solid', () => {
  const hybrid = structuredClone(scene);
  hybrid.hybridOwnership.parts[0].owners.pigment.destination = 'paint';
  hybrid.solids.push({ ...hybrid.solids[0], id: 'relay-atlas',
    surfaceState: { charts: { front: { origin: [-1.61, -.82, .235], u: [3.22, 0, 0],
      v: [0, 1.64, 0], depth: .08 } } } });
  const pixels = { ...document, sceneBindings: [...document.sceneBindings,
    { id: 'atlas', scene: scene.id, object: 'relay-atlas' }], destinations: [...document.destinations,
    { id: 'paint', kind: 'surface-channel', binding: 'atlas', chart: 'front', channel: 'pigment' }] };
  const source = ink.createSceneEditor(hybrid), editor = ink.createPixelEditor(pixels, { sceneEditor: source });
  const patch = { id: 'paint-enamel', frame: 'front', revision: editor.describe().revision, destination: 'paint',
    ownership: address('pigment'), operation: { stamp: { value: 'cream',
      brush: { kind: 'rect', min: [.2, .2], max: [.35, .4] } } } };
  const preview = editor.previewEdit(patch);
  assert.equal(preview.valid, true, JSON.stringify(preview.conflicts));
  assert.equal(preview.targets[0].ownership.source, 'enamel');
  assert.deepEqual(preview.targets[0].ownership.derived.map(row => row.id), ['render-mesh', 'distant-card']);
  editor.apply({ ...patch, sourceRevision: preview.sourceRevision });
  assert.deepEqual(source.snapshot().solids[0], hybrid.solids[0]);
  assert.equal(source.snapshot().solids[1].surfaceState.charts.front.stamps[0].value.swatch, 'cream');
});

test('a detail-only splat part can be trimmed but cannot take over another channel', () => {
  const hybrid = structuredClone(scene), policy = hybrid.hybridOwnership;
  policy.parts[0].owners.detail.destination = 'trim';
  const pixels = { ...document, sceneBindings: [{ id: 'fringe', scene: scene.id, object: 'relay', part: 'fringe' }],
    destinations: [{ id: 'trim', kind: 'splat-attributes', binding: 'fringe' }] };
  const builder = makeBuilder(29, [0x182735, 0xf5c987]);
  builder.disc(0, 0, 0, [0, 0, 1], .3, .024, builder.P[1], 1, { splatId: 'loose-end' });
  builder.describeSplats(0, builder.count(), { object: 'relay', target: { part: 'fringe' } });
  const world = builder.finish({ cam: { target: [0, 0, 0], dist: 4, pitch: 0, yaw: 0, ortho: true } });
  const create = () => ink.createPixelEditor(pixels, { sceneEditor: ink.createSceneEditor(hybrid) });
  const editor = create(), patch = { id: 'trim-end', revision: editor.describe().revision, frame: 'front',
    destination: 'trim', ownership: address('detail'), operation: { splats: [{ splat: 'loose-end', visible: false }] } };
  const preview = editor.previewEdit(patch, { world: () => world });
  assert.equal(preview.valid, true, JSON.stringify(preview.conflicts));
  assert.deepEqual(preview.targets[0].ownership.derived, [{ id: 'distant-card', kind: 'card' }]);
  editor.apply(patch, { world: () => world });
  assert.equal(editor.receipts().at(-1).affectedTargets[0].ownership.source, 'fringe');

  policy.parts[0].owners.coverage = { source: 'fringe', destination: 'trim' };
  const shared = create();
  assert.equal(shared.previewEdit(patch, { world: () => world }).conflicts[0].code, 'hybrid-channel-mismatch');
  const coverage = { ...patch, ownership: address('coverage') };
  assert.equal(shared.previewEdit(coverage, { world: () => world }).valid, true);
});

test('CLI inspection and rebuild planning read the scene and a portable previous report', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-hybrid-ownership-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const json = (name, value) => {
    const file = path.join(dir, name + '.json');
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const source = json('scene', scene), revisions = json('revisions', { ...pins, fringe: 1 });
  const previous = json('prior', api.plan(manifest, pins));
  const cli = (...args) => JSON.parse(execFileSync(process.execPath,
    [path.join(__dirname, '../cli/ink-studio.js'), 'hybrid-ownership', ...args], { encoding: 'utf8' }));
  assert.deepEqual(cli('inspect', source), api.prepare(manifest));
  assert.equal(cli('route', source, 'relay', 'housing', 'pigment').source, 'enamel');
  assert.deepEqual(summary(cli('plan', source, revisions, '--previous', previous)), {
    'render-mesh': 'reuse', 'distant-card': 'rebuild', 'occlusion-proxy': 'reuse'
  });
});
