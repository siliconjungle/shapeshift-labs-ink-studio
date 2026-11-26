'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const ShadowArt = require('../src/shadow-art.js');
const { KIT: K } = ink.load();
const plate = { id: 'slab', kind: 'box', at: [0, 0, 0], half: [1, .68, .26], mat: 'stone', res: .047 };
const scene = { id: 'relief-test', solids: [plate], camera: { target: [0, 0, 0], dist: 6 },
  style: { sun: [-.68, .56, .39], amb: .24, sky: .18, palette: [0x132338,0x4f6782,0x7d9cae,0xf1d7b7,0x9e522d,0xe7934d,
    0xfccb80,0x1f3347,0x354a61,0x577b88,0xabbfc0,0xd5e3d4],
    roles: { stone: [7,8,1,9,2,10,11,3], ember: [4,5,6], metal: [1,3,6] } } };
const field = editor => K.diorama.brushField(editor.snapshot());
const stroke = (relief, points = [-.55, .55]) => ({
  id: 'ridge', brush: { kind: 'box', half: [.25, .155, .09], round: .035 },
  poses: points.map(x => ({ point: [x, 0, .56] })), step: .055, mat: 'ember', res: .028, relief,
  attachment: { kind: 'surface', slot: 'plate', snap: { mode: 'surface', direction: [0, 0, 1], maxDistance: .40, offset: .03 } }
});
const place = mark => ({ id: 'detail', bindings: { plate: 'slab' }, painting: {
  id: 'test', format: K.authoring.paintings3d.format, version: 1, marks: [mark] } });
function author(relief, points, base = scene) {
  const editor = ink.createSceneEditor(base);
  const mark = stroke(relief, points);
  editor.applyPainting3d(place(mark));
  return editor;
}

test('flat and signed shading relief keep splat geometry and use the existing shading-normal path', () => {
  const flat = author({mode: 'flat'}), flush = flat.build();
  const raised = author({mode: 'shading', height: .06, feather: .055});
  const recessed = author({mode: 'shading', height: -.06, feather: .055});
  const [up, down] = [raised.build(), recessed.build()];
  const bare = ink.createSceneEditor(scene).build();
  assert.equal(flush.count, bare.count);
  assert.equal(up.count, flush.count);
  assert.equal(down.count, flush.count);
  assert.equal(flush.renderMetadata.shadingNormals, undefined);
  assert.deepEqual(up.renderMetadata.normals, bare.renderMetadata.normals);
  const changed = [], tintRows = [];
  for (let i = 0; i < flush.count; i++) {
    const o = i * 16, n = i * 3;
    for (const lane of [0,1,2,3,4,5,6,8,9,10]) {
      assert.equal(up.data[o + lane], flush.data[o + lane]);
      assert.equal(down.data[o + lane], flush.data[o + lane]);
    }
    if (flush.data[o + 7] !== bare.data[o + 7]) tintRows.push(i);
    const a = up.renderMetadata.shadingNormals[n + 1];
    if (Math.abs(a) > .15) {
      changed.push(i);
      assert(Math.abs(a + down.renderMetadata.shadingNormals[n + 1]) < 1e-4);
    }
  }
  assert(tintRows.length > 30 && changed.length > 15);
  assert(changed.some(i => up.data[i * 16 + 7] !== down.data[i * 16 + 7]));
  const mate = field(raised), at = [0, .13, .26], material = mate.surfaceAt(...at).material;
  const painted = mate.materialAt(material, at, [0, 0, 1]);
  assert(painted.model.normal[1] > .4);
  assert(mate.shadowSdf(0, 0, .32) > 0);
});

test('volume has a finite silhouette budget and casts only when enabled', () => {
  const open = author({ mode: 'volume', height: .24 }, [.86]);
  const off = field(open), at = [.86, 0, .42];
  assert(off.sdf(...at) < 0);
  assert(off.shadowSdf(...at) > 0);
  assert(off.sdf(1.09, 0, .32) < 0);
  const clipped = field(author({ mode: 'volume', height: .24, castShadow: true, silhouetteAllowance: .04 }, [.86]));
  assert(clipped.sdf(.86, 0, .285) < 0);
  assert(clipped.sdf(.86, 0, .32) > 0);
  assert(clipped.sdf(1.09, 0, .32) > 0);
  assert(clipped.shadowSdf(.86, 0, .285) < 0);
  const noShadow = open.build(undefined, { retainRenderSdf: true });
  const row = noShadow.renderMetadata.targets.findIndex(target => target?.entity === 'paint.detail.ridge');
  const hit = noShadow.renderMetadata.targetIds.indexOf(row);
  assert(hit >= 0);
  assert.equal(ShadowArt.bind(null, noShadow, 'cast')(hit), false);
  assert(noShadow.renderSdfs.some(source => source.distance(...at) < 0));
  assert(K.areaLights.staticSources(noShadow).every(source => source.distance(...at) > 0));
  const on = author({ mode: 'volume', height: .24, castShadow: true }, [.86]).build();
  assert.equal(ShadowArt.bind(null, on, 'cast'), undefined);
  assert(on.renderMetadata.targetIds.includes(on.renderMetadata.targets.findIndex(target => target?.entity === 'paint.detail.ridge')));
});

test('the live sun changes receiver pixels when a volume switches casting', () => {
  const settings = { mode: 'volume', height: .28, castShadow: false };
  const base = { ...scene, finish: { liveSun: true }, camera: { target: [0, 0, 0], dist: 4.4, yaw: .06, pitch: .06 } };
  const shadowOff = author(settings, undefined, base).build();
  const shadowOn = author({ ...settings, castShadow: true }, undefined, base).build();
  const view = { w: 191, h: 131, px: 1, ortho: true, raw: true, passes: ['position', 'materialId'],
    liveSun: { direction: [-.29, .85, .40], ambient: .20, intensity: .98, filter: 0 } };
  const open = ink.render(shadowOff, view), blocked = ink.render(shadowOn, view);
  const noMap = ink.render(shadowOn, { ...view, liveSun: { ...view.liveSun, shadows: false } });
  const { position, materialId, materials } = open.passes;
  const difference = [];
  for (let p = 0; p < materialId.length; p++) {
    const i = p * 3;
    if (materials[materialId[p]] !== 'stone' || Math.abs(position[i + 2] - .26) > .035 ||
        position[i + 1] > -.19 || position[i + 1] < -.59) continue;
    if (open.rgb[i] - blocked.rgb[i] > 15 && noMap.rgb[i] - blocked.rgb[i] > 15) difference.push(p);
  }
  assert(difference.length > 30, 'Found ' + difference.length + ' pixels with a cast shadow');
});

test('recessed volume removes only its receiver and exposes the retained mark material', () => {
  const neighbour = { ...plate, id: 'inlay-stock', at: [0, .112, .205], half: [.19, .027, .02], mat: 'metal' };
  const cut = author({ mode: 'volume', height: -.18 }, undefined, { ...scene, solids: [plate, neighbour] });
  const carved = field(cut);
  assert(carved.sdf(0, 0, .21) > 0);
  assert(carved.sdf(0, 0, .035) < 0);
  assert(carved.sdf(0, .112, .205) < 0);
  const at = [0, 0, .08], material = carved.surfaceAt(...at).material;
  assert.equal(carved.materialAt(material, at, [0, 0, 1]).materialId, 'ember');
  const world = cut.build();
  assert(world.renderMetadata.materials.includes('ember'));
  assert.deepEqual(cut.snapshot().solids, [plate, neighbour]);
  assert.equal(cut.extractPainting3d('detail').marks[0].relief.height, -.18);
  const original = cut.snapshot();
  const revise = relief => ({ id: 'detail', edits: [{ op: 'set', id: 'ridge', patch: { relief } }] });
  assert.throws(() => cut.applyPainting3d(revise({ mode: 'shading', height: .1, castShadow: true }), { update: true }), /settings for that mode/);
  assert.deepEqual(cut.snapshot(), original);
  cut.applyPainting3d(revise({ mode: 'flat' }), { update: true });
  assert(field(cut).sdf(0, 0, .21) < 0);
  assert.deepEqual(cut.extractPainting3d('detail').marks[0].poses, stroke({mode: 'flat'}).poses);
});

test('the exported mesh keeps the recessed groove on a receiver authored as a separate solid', () => {
  const corner = { ...scene, solids: [{ id: plate.id, kind: 'ball', at: [0,0,-.59], r: .85, mat: 'stone', separate: true }] };
  const edit = author({ mode: 'volume', height: -.18 }, [-.15,.15], corner);
  const model = K.diorama.scene(edit.snapshot()).model({ resolution: .055 });
  assert.equal(model.meshes.length, 1);
  assert(model.meshes[0].points.some(([x,y,z]) => Math.abs(x) < .43 && Math.abs(y) < .13 && Math.abs(z - .08) < .04));
});
