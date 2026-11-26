'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load();
const receiver = { id: 'slab', kind: 'box', at: [0, 0, 0], half: [1.25, .75, .24], res: .048, mat: 'stone' };
const scene = { id: 'preset-test', solids: [receiver] };
const reed = { silhouette: [[[-.11,-.04], [.09,-.035], [.13,.03], [-.09,.05]]], spacing: .23,
  depth: { back: .035, curve: [[0,.01],[.04,.065]] } };
const flow = K.flowMap.create({ width: 1, height: 1, bounds: [-2,-2,2,2] }).asset();
flow.vectors = [0, 1];
const style = { brush: { kind: 'mark-profile', profile: 'reed' }, direction: { field: { kind: 'flow-map', map: 'grain' } },
  looseness: { spacing: .63 }, relief: { mode: 'volume', height: .18, silhouetteAllowance: .12 }, mat: 'ember' };
const path = { id: 'stroke', res: .023, poses: [{ point: [-.57,0,.51], pressure: .82 }, { point: [.59,0,.51], pressure: .94 }],
  attachment: { kind: 'surface', slot: 'panel', snap: { mode: 'surface', maxDistance: .45, direction: [0,0,1] } } };
function place(mark, presets = { grass: style }) {
  return { id: 'detail', bindings: { panel: 'slab' }, painting: { id: 'specimen', format: K.authoring.paintings3d.format,
    version: 1, profiles: { reed }, flowMaps: { grain: flow }, presets, marks: [mark] } };
}
const update = (editor, request) => editor.applyPainting3d({ id: 'detail', ...request }, { update: true }).marks[0];
const stroke = editor => editor.extractPainting3d('detail').marks[0];

test('a stroke inherits four style channels and can override or restore only relief', () => {
  const editor = ink.createSceneEditor(scene), mark = { ...path, preset: 'grass' };
  const applied = editor.applyPainting3d(place(mark)).marks[0];
  assert.equal(applied.profile, 'reed');
  assert.deepEqual(applied.channelSources, {
    brush: 'preset', looseness: 'preset', direction: 'preset', relief: 'preset', mat: 'preset'
  });
  assert.equal(applied.looseness.spacing, .63);
  assert.equal(applied.relief.height, .18);
  assert(applied.orientation.samples > 8);
  assert(applied.orientation.frames.every(frame => frame.restTangent[1] > .99));
  const low = { mode: 'volume', height: .045, silhouetteAllowance: .04 };
  const probe = [applied.orientation.frames[0].rest[0], 0, .32];
  assert(K.diorama.brushField(editor.snapshot()).sdf(...probe) < 0);
  const revised = update(editor, { edits: [{ op: 'set', id: 'stroke', patch: { relief: low } }] });
  assert(K.diorama.brushField(editor.snapshot()).sdf(...probe) > 0);
  assert.deepEqual(revised.orientation, applied.orientation);
  assert.deepEqual(revised.looseness, applied.looseness);
  assert.equal(revised.channelSources.relief, 'mark');
  assert.deepEqual(stroke(editor), { ...mark, relief: low });
  assert.deepEqual(editor.extractPainting3d('detail').presets, { grass: style });
  const inherited = update(editor, { edits: [{ op: 'set', id: 'stroke', patch: { relief: null } }] });
  assert.deepEqual(inherited, applied);
  assert.deepEqual(stroke(editor), mark);
});

test('applying a preset to an existing stroke replaces just its channels and keeps prior unrelated values', () => {
  const editor = ink.createSceneEditor(scene);
  const local = { ...path, brush: { kind: 'sphere', radius: .13 }, mat: 'stone',
    relief: { mode: 'flat' }, grid: { kind: 'direction', field: { kind: 'axis', axis: [1,0,0] } } };
  editor.applyPainting3d(place(local));
  const edited = update(editor, { edits: [{ op: 'apply-preset', id: 'stroke', preset: 'grass' }] });
  assert.equal(edited.profile, 'reed');
  assert.equal(edited.material, 'ember');
  assert.equal(edited.channelSources.grid, 'mark');
  assert.deepEqual(stroke(editor).poses, local.poses);
  assert.deepEqual(stroke(editor).grid, local.grid);
  const old = stroke(editor);
  const finish = { relief: { mode: 'shading', height: -.03 }, looseness: { spacing: 1.25 } };
  const revised = update(editor, { presets: { grass: null, finish }, edits: [{ op: 'apply-preset', id: 'stroke', preset: 'finish' }] });
  assert.equal(revised.preset, 'finish');
  assert.equal(revised.channelSources.brush, 'mark');
  assert.equal(revised.channelSources.relief, 'preset');
  assert.equal(revised.channelSources.looseness, 'preset');
  assert.equal(revised.relief.height, -.03);
  assert(revised.orientation.samples < edited.orientation.samples);
  assert.equal(revised.material, 'ember');
  assert.deepEqual(stroke(editor), { ...old, preset: 'finish', brush: style.brush, direction: style.direction, mat: 'ember' });
  const frozen = editor.snapshot(), before = editor.inspectPaintings3d();
  assert.throws(() => update(editor, { presets: { finish: null } }), /Unknown brush preset finish/);
  assert.throws(() => update(editor, { presets: { bad: { poses: path.poses } } }), /Brush preset bad.*style channels/);
  assert.throws(() => update(editor, { presets: { bad: { brush: { kind: 'mark-profile', profile: 'missing' } } } }), /Unknown mark profile missing/);
  assert.deepEqual(editor.snapshot(), frozen);
  assert.deepEqual(editor.inspectPaintings3d(), before);
});

test('editing a shared preset updates inherited channels while leaving a local edit in place after rebinding', () => {
  const original = ink.createSceneEditor(scene), relief = { mode: 'flat' };
  original.applyPainting3d(place({ ...path, preset: 'grass', relief }));
  const changed = { ...style, relief: { mode: 'volume', height: .26, castShadow: true }, looseness: { spacing: 1.4 } };
  const report = update(original, { presets: { grass: changed } });
  assert.equal(report.looseness.spacing, 1.4);
  assert.deepEqual(report.relief, relief);
  const portable = original.extractPainting3d('detail');
  const second = ink.createSceneEditor({ ...scene, solids: [{ ...receiver, id: 'new-receiver' }] });
  const rebound = second.applyPainting3d({ id: 'reuse', painting: portable, bindings: { panel: 'new-receiver' } }).marks[0];
  assert.equal(rebound.target, 'new-receiver');
  assert.equal(rebound.profile, report.profile);
  assert.deepEqual(rebound.direction, report.direction);
  assert.equal(rebound.orientation.samples, report.orientation.samples);
  assert.deepEqual(rebound.relief, report.relief);
  assert.deepEqual(portable.flowMaps.grain, flow);
  assert.deepEqual(portable.profiles.reed, reed);
});
