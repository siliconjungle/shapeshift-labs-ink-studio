const assert = require('node:assert/strict');
const test = require('node:test');
const kit = require('../index.js').load();
const { KIT: K, makeBuilder } = kit;
const build = require('../examples/hybrid-cage-sail.js')(kit).build;
const [rest, bent, pinched, foldedTip] = require('../examples/hybrid-cage-sail-poses.json');

test('one rest cage poses registered mesh paint, finite roots, and residual covariance without touching the input', () => {
  const world = build(91), mesh = world.meshes[0], paint = K.sceneMeshes.layer(mesh).pixels.slice();
  const data = world.data.slice(), stations = world.curveStations.slice();
  const binding = world.hybridCage.growth[0].binding, roots = binding.snapshot();
  const cage = K.deform.hybridCage(world, world.hybridCage);
  const before = cage.preview(rest), result = cage.apply(bent), next = result.world.meshes[0];
  assert.deepEqual(K.sceneMeshes.geometry(before.world.meshes[0]), K.sceneMeshes.geometry(mesh));
  assert.deepEqual(K.sceneMeshes.geometry(next).indices, K.sceneMeshes.geometry(mesh).indices);
  assert.notDeepEqual(K.sceneMeshes.geometry(next).positions, K.sceneMeshes.geometry(mesh).positions);
  assert.deepEqual(K.sceneMeshes.layer(next).pixels, paint);
  assert.notEqual(K.sceneMeshes.layer(next).pixels, K.sceneMeshes.layer(mesh).pixels);
  assert.equal(next.partId, mesh.partId);
  assert.equal(result.report.ready, true);
  assert.ok(result.report.stretching.triangles.length > 0);
  const [root] = result.report.grown[0].strands[0].roots;
  assert.deepEqual(root.weights, roots.strands[0].roots[0].weights);
  assert.notDeepEqual(root.point, roots.strands[0].roots[0].point);
  assert.notDeepEqual(result.world.curveStations, stations);
  const { id, row, point, posedAnchor, restAnchor } = result.report.splats[0], at = row * 16;
  assert.notDeepEqual(posedAnchor, restAnchor);
  assert.deepEqual(Array.from(result.world.data.subarray(at, at + 3)), point);
  assert.notEqual(result.world.data[at + 4], data[at + 4]);
  for (const offset of [3, 7, 11]) assert.equal(result.world.data[at + offset], data[at + offset]);
  assert.equal(result.world.splatIds[row], id);
  assert.deepEqual(cage.preview(bent).world.data, result.world.data);
  assert.deepEqual(result.world.rest, data);
  assert.deepEqual(world.data, data);
  assert.deepEqual(world.curveStations, stations);
  assert.deepEqual(binding.snapshot(), roots);
  assert.equal(K.sceneMeshes.revision(mesh), 0);
});

test('the cage reports measured gap loss, missing residuals, cell folds, and stale host geometry', () => {
  const world = build(91), config = world.hybridCage, cage = K.deform.hybridCage(world, config);
  const { report } = cage.preview(pinched);
  assert.equal(report.ready, false);
  assert.equal(report.cells.folds.length, 0);
  assert.equal(report.clearance[0].violated, true);
  assert.ok(report.clearance[0].samples.every(probe => probe.change < -.2 && probe.posed.width < .34));
  assert.throws(() => cage.apply(pinched), error => error.report.clearance[0].violated);
  const broken = K.deform.hybridCage(world, { ...config, residuals: [
    { ...config.residuals[0], id: 'missing' }, { ...config.residuals[1], surface: { triangle: 99999, weights: [1, 0, 0] } }
  ] }).preview(bent);
  assert.deepEqual(broken.report.failedAttachments.map(row => row.reason), ['missing-or-ambiguous-source', 'surface-unavailable']);
  const { report: folded } = cage.preview(foldedTip);
  assert.equal(folded.ready, false);
  assert.ok(folded.cells.folds.length > 0);
  assert.ok(folded.failedAttachments.some(row => row.kind === 'splat' && row.reason === 'folded-cage'));
  assert.equal(folded.clearance[0].violated, false);
  const mesh = world.meshes[0];
  K.sceneMeshes.pose(mesh, K.sceneMeshes.geometry(mesh).positions);
  assert.throws(() => cage.preview(bent), /source changed/);
});

test('failed surface roots are visible in the receipt and leave the original curve binding active', () => {
  const builder = makeBuilder(11, [0x182639, 0xebd293]);
  const mesh = K.sceneMeshes.create({ id: 'panel', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2], materials: [{ id: 'paint', color: 0x75a192 }] });
  const binding = K.curveSplats.grow(builder, { kind: 'uv', mesh,
    intact: (_, { world }) => !world || K.sceneMeshes.revision(world.meshes[0]) === 0 },
  { roots: [{ id: 'stitch-root', uv: [.3, .3] }], segments: 3 },
  { width: .03, color: '#ebd293' });
  const world = builder.finish({ meshes: [mesh] });
  const cage = K.deform.hybridCage(world, { id: rest.cage, mesh: mesh.id,
    bounds: { min: [-.1, -.1, -.2], max: [1.1, 1.1, .2] }, growth: [{ id: 'test', binding }] });
  const result = cage.preview(rest);
  assert.equal(result.report.ready, false);
  assert.deepEqual(result.report.failedAttachments,
    [{ kind: 'strand', group: 'test', id: 'stitch-root', reason: 'root-unavailable' }]);
  assert.deepEqual(result.report.grown[0].strands[0].roots[0].restPoint, binding.snapshot().strands[0].roots[0].point);
  for (let row = binding.first; row < binding.end; row++) {
    assert.equal(result.world.data[row * 16 + 3], 0);
    assert.ok(world.data[row * 16 + 3] > 0);
  }
});
