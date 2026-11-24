const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { capture } = require('../cli/mesh-uv-editor.js');
const PNG = require('../cli/png.js');
const example = path.join(__dirname, '../examples/mesh-uv-texel-budget.cjs');
const kit = ink.load(), api = kit.KIT.meshTopology, UV = api.uv, { fixture } = require(example);

test('local reprojection and relaxation improve stretch while holding exact seam, pin and paint coordinates', () => {
  const { doc, request } = fixture(kit), [unwrap, relax] = request.operations;
  const pin = doc.faces.find(face => face.id === 'woven-0').corners.find(row => row.vertex === 'cloth00');
  const pinned = UV.plan(doc, { operations: [{ op: 'pin', ids: [pin.id], pinned: true }] }).document;
  const { document, report, patch } = UV.plan(pinned, { protect: request.protect, operations: [unwrap, relax] });
  assert.equal(report.canCommit, true);
  assert.deepEqual(api.edit(pinned, patch), document);
  for (const row of report.operations) {
    assert(row.pointEdits > 0);
    assert(row.evidence.after.meanStretch < row.evidence.before.meanStretch);
  }
  const before = UV.inspect(pinned), after = UV.inspect(document);
  const corners = [
    ...before.edges.find(row => row.id === request.protect.seams[0]).sides.flatMap(side => side.corners),
    ...before.faces.find(row => row.id === 'approved-badge').corners
  ];
  for (const id of corners) assert.deepEqual(after.corners.find(row => row.id === id).uv, before.corners.find(row => row.id === id).uv);
  assert.deepEqual(document.vertices, doc.vertices);
  assert.deepEqual(document.edges, doc.edges);
  assert.equal(after.corners.find(row => row.id === pin.id).pinned, true);
});

test('local overlap or an impossible budget blocks the whole transaction', () => {
  const { doc, request } = fixture(kit), [unwrap, relax, budget] = request.operations;
  const collision = UV.plan(doc, { protect: request.protect, operations: [relax,
    { ...unwrap, rect: [.68, .70, .14, .14] }] });
  assert.equal(collision.report.canCommit, false);
  assert(collision.report.operations[1].conflicts.some(row => row.code === 'new-uv-overlap' && row.faces.includes('approved-badge')));
  assert.deepEqual(collision.document, doc);
  for (const [change, code] of [
    [{ maxTexels: 200 }, 'texel-budget-reserved'],
    [{ features: budget.features.map(row => row.id === 'route-sign' ? { ...row, minDensity: 125 } : row) }, 'texel-density-shortfall']
  ]) {
    const result = UV.plan(doc, { protect: request.protect, operations: [{ ...budget, ...change }] });
    assert.equal(result.report.canCommit, false);
    assert(result.report.operations[0].conflicts.some(row => row.code === code));
    assert.deepEqual(result.document, doc);
  }
});

test('fixed atlas budget reallocates density and improves native camera sampling without enlarging the sign', () => {
  const { doc, request, view } = fixture(kit), result = UV.plan(doc, request);
  assert.equal(result.report.canCommit, true);
  const allocation = result.report.operations[2].evidence;
  assert(allocation.used <= allocation.maxTexels + 1e-7);
  const sign = allocation.features.find(row => row.id === 'route-sign');
  const donor = allocation.features.find(row => row.id === 'cabinet');
  assert(sign.densityAfter > sign.densityBefore * 10);
  assert(donor.densityAfter < donor.densityBefore);
  assert.deepEqual(result.document.faces.find(face => face.id === 'approved-badge'),
    doc.faces.find(face => face.id === 'approved-badge'));
  for (const row of allocation.islands.filter(island => island.locked)) assert.deepEqual(row.before, row.after);
  const [before, after] = [doc, result.document].map(document => {
    const { mesh, frame } = capture(document, { ...view, raw: true, t: 0 }, kit);
    return UV.readability(mesh, frame, view.readability).features[0];
  });
  assert.deepEqual(before.bounds, after.bounds);
  assert.equal(before.ready, false);
  assert.equal(after.ready, true);
  assert(after.texelsPerPixel.p10 > before.texelsPerPixel.p10 * 10);
});

test('CLI review uses matching registered pigment bakes, retaining the approved face texels', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-uv-texels-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, [example, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  const read = name => fs.readFileSync(path.join(dir, name));
  const [a, b] = ['atlas-before.png', 'atlas-after.png'].map(name => PNG.raster(read(name)));
  assert.equal(a.w, b.w);
  for (let y = 89; y < 110; y++) for (let x = 87; x < 106; x++) {
    const i = (y * a.w + x) * 4;
    assert.deepEqual(a.data.subarray(i, i + 4), b.data.subarray(i, i + 4));
  }
  const review = JSON.parse(read('receipt.json')).preview;
  assert.equal(review.readability.before.features[0].ready, false);
  assert.equal(review.readability.after.features[0].ready, true);
  assert(!read('native-before.png').equals(read('native-after.png')));
  assert(read('comparison.png').length > 100);
});
