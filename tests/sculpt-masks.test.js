const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const workshop = require('../examples/sculpt-masks/workshop.js');
const plan = require('../examples/sculpt-masks/plan.json');
const kit = ink.load();
const P = kit.KIT.procedural;
const fixture = () => {
  const scene = workshop(kit), world = scene.build(scene.seed);
  return { world, panel: world.brickMeshes[0] };
};
const ray = x => ({ origin: [x, 1.57, 2], direction: [0, 0, -1] });
const brush = () => {
  const { volume, ...settings } = plan.actions[1].brush;
  return { ...settings, sdf: P.sculptMasks.field(volume) };
};

test('a feathered sculpt stroke preserves locked face geometry and labels and remeshes locally', () => {
  const { panel } = fixture(), initial = panel.current();
  const before = panel.setSculptMasks(plan.actions[0].document);
  assert.equal(before.bricks, initial.bricks);
  assert.deepEqual(before.work.rebuilt, []);
  assert(before.chunks.every((chunk, i) => chunk === initial.chunks[i]));
  const bronze = before.assets.pick(ray(-1.11)), center = before.assets.pick(ray(0)), cover = before.assets.pick(ray(2));
  assert(bronze.faceSets.includes('bronze-trim'));
  assert.deepEqual(center.faceSets, ['carving']);
  assert.deepEqual(cover.faceSets, ['side-cover']);
  const opts = { masks: ['carving-window'] };
  assert.equal(before.sculpt.sample([0, 1.5, .37], opts).weight, 1);
  assert(Math.abs(before.sculpt.sample([1.3, 1.5, .37], opts).weight - .5) < 1e-10);
  assert.equal(before.sculpt.sample([-1.11, 1.5, .45], opts).reason, 'locked');
  const after = panel.edit(brush());
  assert(after.work.rebuilt.length > 0 && after.work.rebuilt.length < after.chunks.length);
  assert(after.work.sculpt.relabeled.every(key => after.work.rebuilt.includes(key)));
  assert(after.chunks.every((chunk, i) => after.work.rebuilt.includes(chunk.key) || chunk === before.chunks[i]));
  assert.deepEqual(after.work.sculpt.retainedLocks, ['bronze-trim']);
  assert.equal(after.assets.pick(ray(-1.11)).faceId, bronze.faceId);
  assert.equal(after.assets.pick(ray(-1.11)).distance, bronze.distance);
  assert.equal(after.assets.pick(ray(2)).faceId, cover.faceId);
  assert(after.assets.pick(ray(0)).distance > center.distance + .2);
  assert.deepEqual(after.assets.pick(ray(0)).faceSets, center.faceSets);
  assert.throws(() => panel.update(after.bricks.edit(brush())), {
    code: 'protected-sdf-feature', kind: 'face-set', feature: 'bronze-trim'
  });
  assert.equal(panel.current(), after);
});

test('hidden and isolated sets filter visual mesh, depth, and picking while leaving the signed field intact', () => {
  const { world, panel } = fixture();
  const before = panel.setSculptMasks(plan.actions[0].document), document = before.sculpt.document;
  const hidden = panel.setSculptMasks({ ...document, controls: { hidden: ['side-cover'] } });
  assert.deepEqual(hidden.work.rebuilt, []);
  assert.deepEqual(hidden.work.sculpt.relabeled, []);
  assert(hidden.work.sculpt.visibleTriangles < before.work.sculpt.visibleTriangles);
  assert.equal(hidden.sculpt.faceSets.find(row => row.id === 'side-cover').visible, 0);
  assert.equal(hidden.sculpt.sample([2, 1.5, .51]).reason, 'hidden');
  assert.equal(hidden.assets.pick(ray(2)), null);
  assert.equal(hidden.assets.collision, before.assets.collision);
  assert(hidden.assets.depthProxies.reduce((sum, mesh) => sum + mesh.triangles, 0) <
    before.assets.depthProxies.reduce((sum, mesh) => sum + mesh.triangles, 0));
  assert.deepEqual(P.brickMeshes.fullView(hidden).assets.pick(ray(2)), before.assets.pick(ray(2)));
  const opts = { w: 128, h: 96, px: 1, raw: true };
  assert.deepEqual(ink.render(world, { ...opts, sdfAssist: true }).rgb, ink.render(world, opts).rgb);
  const isolated = panel.setSculptMasks({ ...document, controls: { isolate: ['carving'] } });
  assert.equal(isolated.work.sculpt.visibleTriangles, isolated.sculpt.faceSets.find(row => row.id === 'carving').faces);
  const hit = isolated.assets.pick(ray(.2));
  assert.equal(isolated.sculpt.face(hit.brick, hit.sourceTriangle).id, hit.faceId);
  assert.deepEqual(hit.faceSets, ['carving']);
  assert.equal(isolated.sculpt.sample([2, 1.5, .51]).reason, 'outside-isolation');
  assert.equal(panel.setSculptMasks(isolated.sculpt.document), isolated);
  assert.equal(panel.setSculptMasks(null).assets.pick(ray(2)).faceId, undefined);
});

test('weighted sparse edits blend signed displacement and threshold categorical paint', () => {
  const root = P.sparseBricks.create({ cell: .125, brickSize: 4, base: () => -.25 });
  const settings = { operation: 'subtract', bounds: { min: [0, 0, 0], max: [.25, 0, 0] },
    sdf: () => -.75, material: 'clay', medium: 'water' };
  const edited = root.edit({ ...settings, weight: x => x * 2 });
  assert.equal(edited.distance(0, 0, 0), -.25);
  assert.equal(edited.distance(.125, 0, 0), 0);
  assert.equal(edited.distance(.25, 0, 0), .25);
  assert.equal(edited.attributes(.125, 0, 0).material, null);
  assert.equal(edited.attributes(.25, 0, 0).material, 'clay');
  assert.equal(edited.attributes(.25, 0, 0).medium, 'water');
  assert.throws(() => root.edit({ ...settings, weight: () => 1.01 }), /brush weights/);
});

test('WebGL picks retained faces and does not draw a hidden set', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = require('../cli/look-webgl.js')({}, workshop, (kit, make, backend) => {
    const scene = make(kit), world = scene.build(scene.seed), panel = world.brickMeshes[0];
    const document = {
      masks: [{ id: 'cover', volumes: [{ kind: 'box', min: [1.49, .3, -.7], max: [2.7, 2.8, .8] }] }],
      faceSets: [{ id: 'side-cover', mask: 'cover' }]
    };
    const view = backend(176, 112, { raw: true });
    const ray = { origin: [2, 1.57, 2], direction: [0, 0, -1] };
    const spots = { cover: [127, 53], center: [87, 53] };
    try {
      panel.setSculptMasks(document);
      view.draw(world);
      const before = view.sample(spots), hit = view.pick(world, ray).solid;
      panel.setSculptMasks({ ...document, controls: { hidden: ['side-cover'] } });
      view.draw(world);
      return { before, after: view.sample(spots), hit, next: view.pick(world, ray).solid };
    } finally {
      view.close();
    }
  });
  assert.deepEqual(result.hit.faceSets, ['side-cover']);
  assert.equal(result.next, null);
  assert.notDeepEqual(result.after.cover, result.before.cover);
  assert.deepEqual(result.after.center, result.before.center);
});
