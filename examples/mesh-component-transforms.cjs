'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const R = require('../cli/render.js');
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');
const { pose } = require('../cli/diarama-pose.js');
const P = require('./gatehouse-revision/portal.cjs');
const { sourceScene } = require('./gatehouse-revision/demo.cjs');
const gatehouse = require('./opaque-surface-gate.js');

function comparison(before, after, object) {
  const rgb = Uint8Array.from(after.rgb, value => Math.round(value * .52));
  const old = before.passes.objects.indexOf(object), next = after.passes.objects.indexOf(object);
  let opened = 0, filled = 0;
  for (let p = 0; p < before.w * before.h; p++) {
    const a = before.passes.objectId[p] === old, b = after.passes.objectId[p] === next;
    if (a === b) continue;
    if (a) {
      rgb.set([105, 246, 221], p * 3);
      opened++;
    } else {
      rgb.set([244, 171, 101], p * 3);
      filled++;
    }
  }
  return { w: before.w, h: before.h, rgb, opened, filled };
}

function run(directory) {
  const dir = path.resolve(directory), kit = ink.load(), { KIT: K } = kit;
  const fixture = gatehouse(kit), set = fixture.build(fixture.seed, { sdfPortal: false });
  const topology = K.meshTopology.create(P.portal(true));
  const scene = sourceScene(topology, P.atlas(), set.cam);
  const sceneRef = 'gatehouse.json', editor = ink.createSceneEditor(scene);
  const selection = editor.selectMeshTopology(P.object, { domain: 'vertices', ids: ['front/arch-0', 'throat/arch-0'] });
  const pinned = topology.vertices.map(row => row.id).filter(id => id.endsWith('/left-foot') ||
    id.endsWith('/left-base') || id.endsWith('/left-top'));
  const transform = {
    selection, operation: { kind: 'move', offset: [-.18, 0, 0] }, space: 'world',
    pins: { vertices: pinned }, falloff: { radius: .9, curve: 'smooth' },
    snap: { kind: 'plane', origin: [-.965, 0, 0], normal: [1, 0, 0],
      anchor: 'front/arch-0', maxDistance: .2 }
  };
  const planned = editor.planMeshTransform(P.object, transform, { part: P.part });
  const before = editor.build(), w = 144, h = 96;
  const design = {
    format: 'ink-studio/pixel-art', version: 2, width: w, height: h, pixelAspect: [1, 1],
    palette: { ochre: '#c08b6f' }, layers: [{ id: 'review' }], frames: [{ id: 'front', durationMs: 100, cels: {} }],
    sceneBindings: [{ id: 'portal', scene: sceneRef, object: P.object, part: P.part }],
    destinations: [{ id: 'portal-topology', kind: 'mesh-topology', binding: 'portal' }]
  };
  const session = ink.createPixelEditor(design, { sceneEditor: editor, sceneRef });
  const patch = {
    id: 'align-left-jamb', frame: 'front', revision: session.describe().revision, destination: 'portal-topology',
    ownership: { object: P.object, part: P.part, channel: 'shape' }, operation: { transform }
  };
  patch.sourceRevision = session.previewEdit(patch).sourceRevision;
  const preview = session.previewEdit(patch, { exact: true });
  assert.equal(preview.valid, true, JSON.stringify(preview.conflicts));
  assert.equal(preview.diff.topology[0].changes.vertices.length, planned.patch.vertices.length);
  session.apply(patch);
  assert.deepEqual(editor.meshTopology(P.object).document, planned.document);
  const receipt = session.receipts().at(-1);
  assert.deepEqual(receipt.affectedTargets[0].transform, planned.report);
  assert(planned.report.vertices.some(row => row.weight < 1 && !row.selected));
  assert(planned.report.vertices.every(row => !pinned.includes(row.id)));
  const alteredScene = editor.snapshot(), after = editor.build();
  assert.equal(session.undo(), true);
  assert.deepEqual(editor.snapshot(), scene);
  assert.equal(session.redo(), true);
  assert.deepEqual(editor.snapshot(), alteredScene);

  const view = { w, h, px: 1, yaw: .18, dist: 7.7, t: Math.PI / 1.8, lockCamera: true,
    passes: ['objectId'] };
  pose(set, view.t, { kit });
  const original = ink.render({ ...set, meshes: before.meshes }, view);
  const revised = ink.render({ ...set, meshes: after.meshes }, view);
  const evidence = comparison(original, revised, P.object);
  assert(evidence.opened >= 4, 'The snapped opening must read on the native grid');
  const picture = R.grid([original, revised, evidence].map(image => R.upscale(image, 2)), 3);

  fs.mkdirSync(dir, { recursive: true });
  const save = (name, value) => files.json(path.join(dir, name), value);
  save(sceneRef, scene);
  save('revised-gatehouse.json', alteredScene);
  save('selection.json', selection);
  save('transform.json', transform);
  save('pixel-document.json', design);
  save('pixel-patch.json', patch);
  save('preview.json', preview);
  save('receipt.json', receipt);
  save('report.json', { transform: planned.report, artGrid: [w, h],
    openedPixels: evidence.opened, filledPixels: evidence.filled });
  PNG.write(path.join(dir, 'comparison.png'), picture.w, picture.h, picture.rgb);
}

if (require.main === module) run(process.argv[2] ?? 'output/component-transform');
module.exports = { run };
