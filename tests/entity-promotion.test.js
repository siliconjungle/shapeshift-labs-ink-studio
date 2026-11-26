'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..'), kit = ink.load(), { KIT: K } = kit, W = K.world;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const ortho = { w: 136, h: 96, ortho: true, raw: true };
const json = value => JSON.parse(JSON.stringify(value));
const body = id => ({ field: 'rig/bodies', body: id });

function fracture() {
  const source = require('../examples/world-surface-state.json');
  const run = W.runtime.create(source);
  run.advance(11);
  return run;
}

test('promotion uses the committed piece poses, chart windows and fresh cut material', () => {
  const run = fracture(), state = run.checkpoint();
  const request = { id: 'kept-pieces', select: [body('sign.0'), body('sign.1'), body('sign.0')] };
  const kept = ink.promoteSceneEntities(run, request);
  assert.deepEqual(ink.promoteSceneEntities(json(run.recording()), request), kept);
  assert.deepEqual(run.checkpoint(), state);
  assert.equal(kept.report.tick, 11);
  assert.equal(kept.report.added, 2);
  for (const [i, solid] of kept.scene.solids.entries()) {
    const input = run.query().probe('rig/bodies').value['sign.' + i];
    assert.deepEqual(solid.restAffine.position, input.position);
    assert.deepEqual(solid.restAffine.matrix, input.rotation);
    assert.deepEqual(solid.half, input.half);
    assert.deepEqual(solid.bodySurface.faces['+z'].window, input.surfaceState.faces['+z'].window);
    for (const chart of Object.keys(solid.bodySurface.charts))
      assert(Object.values(input.surfaceState.faces).some(row => (row.stateChart ?? row.chart) === chart));
    const field = K.diorama.brushField(kept.scene);
    const p = K.V.add(input.position, K.M.app(input.rotation, [0, 0, input.half[2]]));
    const normal = K.M.app(input.rotation, [0, 0, 1]);
    const painted = field.surfaceAt(...p).material.surfaceState.locate(p, normal);
    assert.deepEqual(painted.values, run.query().probe('rig/surface-state', {}, { body: input.id, face: '+z', uv: [.5, .5] }).value.values);
    const cut = K.diorama.sculptRestTrace(kept.scene, solid.id);
    const s = i ? -1 : 1;
    assert.equal(cut.materialAt([s * input.half[0], 0, 0], [s, 0, 0]).role, 'fresh-wood');
  }
  assert.throws(() => ink.promoteSceneEntities(state, { ...request, select: [body('sign')] }), /no promotable/);
  const frame = ink.render(K.diorama.build(kept.scene), ortho);
  assert(frame.rgb.some((c, i) => i % 3 === 0 && c > 80));
});

test('a later edit moves exactly the selected object, undo restores it, and retries retain the same IDs', () => {
  const run = fracture(), original = { id: 'layout', solids: [{ id: 'stage', kind: 'box', at: [0, -.3, 0], half: [3, .1, 3] }] };
  const editor = ink.createSceneEditor(original);
  const request = { id: 'harvest', select: [body('sign.0')] };
  const { objects } = editor.applyEntityPromotion(run, request);
  const id = objects[0].solid, baseline = editor.snapshot(), solid = baseline.solids[1];
  assert.equal(editor.applyEntityPromotion(run, request).added, 0);
  editor.setTransform({ translation: [.2, 0, 0] }, 'solid:' + id);
  assert.equal(editor.snapshot().solids[0].id, 'stage');
  assert.deepEqual(editor.node('solid:' + id).solid.restAffine, solid.restAffine);
  assert.throws(() => editor.applyEntityPromotion(run, request), /different object/);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(), baseline);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(), original);
});

test('a saved lifecycle group keeps exact attachment transforms and validates its generation', async () => {
  const place = W.simulationPlace({ id: 'yard', source: W.manifest({ id: 'yard-layout' }), visual: false });
  const session = W.portals.create({ places: [place], lifecycle: true });
  await session.enter('yard');
  const generation = session.lifecycle.spawn({ id: 'lightpost', place: 'yard', rotation: K.M.rot([0, 1, 0], .7),
    entities: {
      lightpost: { position: [2, 1, -1], sockets: { arm: [0, .3, 0] }, visual: { half: [.12, .8, .16], materialId: 'enamel' } },
      shade: { anchor: { entity: 'lightpost', socket: 'arm' }, position: [.4, 0, 0], visual: { half: [.3, .12, .21] } }
    } });
  const before = json(session.checkpoint()), request = { id: 'fixture', select: [{ spawn: generation }] };
  const planned = ink.promoteSceneEntities(session, request);
  assert.deepEqual(ink.promoteSceneEntities(before, request), planned);
  assert.deepEqual(json(session.checkpoint()), before);
  const shade = planned.scene.solids.find(solid => solid.id.endsWith('.shade'));
  assert.deepEqual(shade.restAffine.position, session.current().asset.query().frame({ entity: 'shade' }).point);
  assert.deepEqual(shade.restAffine.matrix, session.lifecycle.get('lightpost').rotation);
  assert.throws(() => ink.promoteSceneEntities(before, { ...request, select: [{ spawn: { ...generation, generation: 10 } }] }), /stale/);
  session.lifecycle.unload(generation);
  assert.throws(() => ink.promoteSceneEntities(session, request), /not loaded/);
});

test('qualified colliders and procedural descendants stay editable after reload', () => {
  const run = W.runtime.create({ id: 'other', systems: { rig: { kind: 'mechanics', config: { bodies: {
    axle: { position: [0, 1, 0], fixed: true, collider: { kind: 'capsule', a: [-.3, 0, 0], b: [.3, 0, 0], radius: .22 } }
  } } } }, entities: {
    pattern: { position: [2, 1, 0], visual: { half: [.2, .2, .2] } },
    tile: { parent: 'pattern', position: [.4, 0, 0], visual: { half: [.2, .1, .2] } }
  } });
  const keep = ink.promoteSceneEntities(run, { id: 'arrangement', select: [body('axle'), { entity: 'pattern', descendants: true }] });
  const data = json(keep.scene);
  assert.equal(data.solids.length, 3);
  assert.equal(data.solids[0].kind, 'body-shape');
  assert.equal(data.solids[0].collider.kind, 'capsule');
  assert.deepEqual(data.solids[2].restAffine.position, [2.4, 1, 0]);
  const field = K.diorama.brushField(data);
  assert(field.sdf(.4, 1, 0) < 0);
  assert(field.sdf(.6, 1, 0) > 0);
  assert(K.diorama.build(data).count > 50);
});

test('CLI discovers checkpoint candidates, previews selection and saves the editable artifact', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-entity-promotion-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = fracture().checkpoint(), selection = { id: 'kept', select: [body('sign.0')] };
  const file = path.join(dir, 'checkpoint.json');
  fs.writeFileSync(file, JSON.stringify(source));
  fs.writeFileSync(path.join(dir, 'pick.json'), JSON.stringify(selection));
  const call = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  assert(JSON.parse(call('scene', 'inspect-entities', 'checkpoint.json')).objects.some(row => row.id === 'sign.0'));
  const plan = JSON.parse(call('scene', 'promote-entities', 'checkpoint.json', 'pick.json', '--dry-run'));
  const save = JSON.parse(call('scene', 'promote-entities', 'checkpoint.json', 'pick.json', '--out', 'kept.json'));
  assert.deepEqual(plan, save);
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(source));
  call('render', 'kept.json', '--ortho', '--raw', '--w', '136', '--h', '96', '--out', 'proof.png');
  assert(fs.statSync(path.join(dir, 'proof.png')).size > 300);
});
