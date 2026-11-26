'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load();
const plate = { id: 'plate', kind: 'box', at: [0, 0, 0], half: [1.45, 1, .2], mat: 'stone', res: .06 };
const scene = { id: 'mark-grid-test', solids: [plate], camera: { target: [0, 0, 0], dist: 6 } };
const degrees = Math.PI / 180;
const rotation = angle => [0, 0, Math.sin(angle * degrees / 2), Math.cos(angle * degrees / 2)];
const xy = (point, angle = 33, pressure = .83) => ({ point: [...point, .53], rotation: rotation(angle), pressure });
const dab = (id, point, grid, angle) => ({ id, brush: { kind: 'box', half: [.11, .035, .055], round: .02 },
  poses: [xy(point, angle)], grid, mat: 'ember', res: .03,
  attachment: { kind: 'surface', slot: 'panel', snap: { mode: 'surface', maxDistance: .48, direction: [0, 0, 1], offset: .022 } } });
const placement = (marks, flowMaps) => ({ id: 'detail', bindings: { panel: 'plate' }, painting: {
  id: 'pattern', format: K.authoring.paintings3d.format, version: 1, marks, ...(flowMaps && { flowMaps }) } });
const near = (actual, expected, e = 1e-5) => assert(Math.abs(actual - expected) < e, `${actual} expected near ${expected}`);
const same = (actual, expected, e) => expected.forEach((value, i) => near(actual[i], value, e));
const heading = frame => Math.atan2(frame.restTangent[1], frame.restTangent[0]) / degrees;

test('tangent grids use authored axes, phase and stagger while retaining the raw stroke', () => {
  const grid = { kind: 'tangent', origin: [.08, -.07, .2], u: [0, 1, 0], v: [-1, 0, 0], spacing: [.4, .5],
    phase: [.10, 0], stagger: .5, strength: .5, turnStrength: 1 };
  const mark = dab('ridge', [-.36, .39], grid), editor = ink.createSceneEditor(scene);
  const result = editor.applyPainting3d(placement([mark])).marks[0];
  const row = result.orientation.frames[0];
  assert.deepEqual(result.orientation.gridResults, { aligned: 1 });
  same(row.grid.before, [-.36, .39, .222]);
  same(row.grid.coords, [.46, .44]);
  same(row.grid.target, [.3, .5]);
  same(row.rest, [-.39, .31, .222]);
  near(heading(row), 90);
  const snapshot = editor.extractPainting3d('detail');
  assert.deepEqual(snapshot.marks[0].poses, mark.poses);
  assert.deepEqual(snapshot.marks[0].grid, grid);
  const actual = editor.build().made['paint.detail.ridge'];
  same(actual.bc, row.rest);
  const plain = editor.applyPainting3d({ id: 'detail', edits: [{ op: 'set', id: mark.id, patch: {grid: null} }] }, { update: true });
  assert.equal(plain.marks[0].orientation, undefined);
  assert.deepEqual(editor.extractPainting3d('detail').marks[0].poses, mark.poses);
});

test('style erasers follow their rest coordinates, including on a warped receiver', () => {
  const host = {id:'plate',kind:'warp',twist:.64,centre:[0,-.5,0],of:{...plate,id:'stock'}};
  const editor = ink.createSceneEditor({...scene,solids:[host]});
  const mark = dab('pattern',[-.36,.39],{kind:'tangent',spacing:[.20,.30]});
  mark.direction = {field:{kind:'axis',axis:[0,1,0]},strength:1};
  mark.poses.push(xy([.48,.39]));
  const before = editor.applyPainting3d(placement([mark])).marks[0].orientation;
  assert.equal(before.warped,true);
  near(heading(before.frames[0]),90);
  const report = editor.applyPainting3d({id:'detail',edits:[{op:'set-eraser',id:mark.id,eraser:'local',
    patch:{points:[[-.36,.39,.2]],radius:.22,channels:['style']}
  }]},{update:true}).marks[0].orientation;
  const frame = report.frames[0];
  assert.equal(frame.grid.status,'erased');
  same(frame.rest,frame.grid.before);
  near(heading(frame),33);
  assert(K.V.dist(frame.point,frame.rest)>.02);
  assert(report.gridResults.aligned>0);
  assert.deepEqual(editor.extractPainting3d('detail').marks[0].poses,mark.poses);
});

test('the grid reprojects onto curved receivers, and a failed snap is reported without moving a dab', () => {
  const ball = { id: 'plate', kind: 'ball', at: [0, 0, 0], r: 1, mat: 'stone', res: .05 };
  const editor = ink.createSceneEditor({ ...scene, solids: [ball] });
  const marks = [[.44, .17], [.87, 0]].map((point, i) => {
    const mark = dab('chip-' + i, point, { kind: 'tangent', spacing: [i ? 1.2 : .5, .5] });
    return { ...mark, poses: [{ ...mark.poses[0], point: [...point, 1.05] }],
      attachment: { ...mark.attachment, snap: { ...mark.attachment.snap, maxDistance: .8 } } };
  });
  const rows = editor.planPainting3d(placement(marks)).report.marks.map(mark => mark.orientation.frames[0]);
  const [on, missed] = rows;
  same(on.rest, [.511, 0, Math.sqrt(.75) * 1.022], 2e-5);
  near(K.V.dot(on.restTangent, on.restNormal), 0);
  assert.equal(missed.grid.status, 'projection-miss');
  same(missed.rest, missed.grid.before);
});

test('named skew UV charts quantize within their authored bounds and carry the same stations through a warp', () => {
  const surfaceState = { charts: { weave: { origin: [-1, -.71, .2], u: [1.7, .36, 0], v: [.44, 1.10, 0], depth: .067 } } };
  const receiver = { ...plate, surfaceState };
  const grid = { kind: 'uv', chart: 'weave', spacing: [.25, .25], phase: [.05, .05], heading: 'v' };
  const p = (u, v) => [-1 + 1.7*u + .44*v, -.71 + .36*u + 1.10*v];
  const marks = [dab('center', p(.36, .60), grid), dab('outside', [-1.25, -.8], grid),
    dab('edge', p(.99, .5), { ...grid, phase: [.1, .05] })];
  const check = host => ink.createSceneEditor({ ...scene, solids: [host] }).planPainting3d(placement(marks)).report.marks;
  const original = check(receiver), twisted = check({ id: plate.id, kind: 'warp', twist: .8, centre: [0, -.6, 0],
    of: { ...receiver, id: 'stock' } });
  const row = original[0].orientation.frames[0], moved = twisted[0].orientation.frames[0];
  same(row.grid.coords, [.36, .60]);
  same(row.grid.target, [.30, .55]);
  same(row.rest, [...p(.30, .55), .222]);
  same(row.restTangent, K.V.norm(surfaceState.charts.weave.v));
  assert(twisted[0].orientation.warped);
  same(moved.rest, row.rest);
  assert(K.V.dist(moved.point, row.rest) > .01);
  near(K.V.dot(moved.tangent, moved.normal), 0);
  assert.deepEqual(original[1].orientation.gridResults, { 'outside-chart': 1 });
  assert.deepEqual(original[2].orientation.gridResults, { 'outside-grid': 1 });
  const editor = ink.createSceneEditor(scene);
  assert.throws(() => editor.applyPainting3d(placement([marks[0]])), /no surface chart named weave/);
  assert.deepEqual(editor.inspectPaintings3d(), []);
});

test('direction grids quantize headings relative to a named flow field, before comb and seeded ruffle', () => {
  const flow = { ...K.flowMap.create({ width: 1, height: 1, bounds: [-1, -1, 1, 1] }).asset(), vectors: [0, 1] };
  const grid = { kind: 'direction', field: { kind: 'flow-map', map: 'weave' }, angleStep: 90, angleOffset: 15 };
  const mark = dab('scale', [.17, .20], grid, 49), editor = ink.createSceneEditor(scene);
  const report = editor.applyPainting3d(placement([mark], { weave: flow })).marks[0].orientation;
  const row = report.frames[0];
  near(row.grid.angle, -41);
  near(row.grid.targetAngle, -75);
  near(heading(row), 15);
  same(row.rest, row.grid.before);
  const revised = editor.applyPainting3d({ id: 'detail', edits: [{ op: 'set', id: mark.id, patch: {
    direction: { field: grid.field, strength: 0, seed: 47, ruffleDegrees: 8 }
  } }] }, { update: true }).marks[0].orientation.frames[0];
  near(heading(revised), 15 + revised.ruffleDegrees);
  const calm = editor.applyPainting3d({ id: 'detail', flowMaps: { weave: { ...flow, vectors: [0, 0] } } },
    { update: true }).marks[0].orientation;
  assert.deepEqual(calm.gridResults, { 'no-direction': 1 });
});
