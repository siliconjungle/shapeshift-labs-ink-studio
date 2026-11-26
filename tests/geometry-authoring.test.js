const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { KIT: K } = require('..').load();

const S = K.procedural.rationalSurface, A = K.procedural.attributeAuthoring;
const line = { degree: 1, knots: [0, 0, 1, 1] };
const control = (position, weight = 1) => ({ position, weight });
const near = (a, b, eps = 1e-9) => assert(Math.abs(a - b) <= eps, a + ' vs ' + b);
function patch() {
  return { format: S.format, version: 1, id: 'weighted-sheet', u: line, v: line, controls: [
    [control([0, 0, 0]), control([1, 0, 0], 2)],
    [control([0, 1, 0]), control([1, 1, 0], 2)]
  ] };
}
function loop(id, kind, points) {
  const controls = [...points, points[0]].map(point => control(point));
  return { id, kind, steps: 1, degree: 1, knots: [0, 0, ...points.slice(1).map((_, i) => (i + 1) / points.length), 1, 1], controls };
}
function curve() {
  return { format: K.curve.retained.format, version: 1, id: 'beam',
    splines: [{ id: 'wire', points: [
      { id: 'root', position: [0, 0, 0], outHandle: [1 / 3, 0, 0] },
      { id: 'tip', position: [1, 0, 0], inHandle: [-1 / 3, 0, 0] }
    ], segments: [{ id: 'span', from: 'root', to: 'tip' }] }],
    attachments: [{ id: 'jewel', spline: 'wire', segment: 'span', t: .6 }] };
}

test('a rational patch returns analytic quotient derivatives at interior and clamped endpoints', () => {
  const source = patch();
  for (const u of [0, .23, .5, 1]) {
    const row = S.sample(source, [u, .4]);
    near(row.point[0], 2 * u / (1 + u));
    near(row.point[1], .4);
    near(row.tangentU[0], 2 / (1 + u)**2);
    near(row.tangentV[1], 1);
    row.normal.forEach((value, i) => near(value, i === 2 ? 1 : 0));
    assert.equal(row.boundary, u === 0 || u === 1);
  }
  const rev = S.inspect(source).revision;
  const adjusted = S.edit(source, { revision: rev, operations: [
    { op: 'set-control', row: 1, column: 1, position: [1, 1, .8], weight: 3 }
  ] });
  assert(S.sample(adjusted.document, [.5, .5]).point[2] > 0);
  assert.equal(S.sample(source, [.5, .5]).point[2], 0);
  assert.throws(() => S.edit(adjusted.document, { revision: rev, operations: adjusted.report.operations }), /different revision/);
});

test('trim recovery retains an outer outline and an interior opening with the correct total UV area', () => {
  const outer = loop('seam', 'outer', [[.12, .12], [.9, .12], [.9, .84], [.12, .84]]);
  const hole = loop('opening', 'hole', [[.3, .3], [.7, .3], [.7, .6], [.3, .6]]);
  const source = { ...patch(), trims: [outer, hole] };
  const { geometry, report } = S.mesh(source, { resolution: 10 });
  const uv = i => geometry.uvs.slice(i * 2, i * 2 + 2);
  const sum = geometry.faces.reduce((total, tri) => {
    const [a, b, c] = tri.map(uv);
    const centroid = a.map((x, i) => (x + b[i] + c[i]) / 3);
    assert(S.sample(source, centroid).retained);
    return total + ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }, 0);
  near(sum, .78 * .72 - .4 * .3);
  near(sum, report.parameterArea);
  assert.equal(S.sample(source, [.3, .5]).boundary, true);
  assert.equal(S.sample(source, [.4, .5]).retained, false);
  assert.equal(S.sample(source, [.06, .5]).retained, false);
  const drop = S.edit(source, { operations: [{ op: 'remove-trim', id: 'opening' }] }).document;
  assert(S.sample(drop, [.4, .5]).retained);
  const crossing = loop('crossing', 'hole', [[.2, .4], [.5, .4], [.5, .7], [.2, .7]]);
  assert.throws(() => S.edit(source, { operations: [{ op: 'set-trim', trim: crossing }] }), /intersect or touch/);
});

test('time-sampled bends keep curve topology and existing attachment addresses', () => {
  const source = curve(), C = K.curve.retained;
  const bind = K.curve.bend.create(source, { format: K.curve.bend.format, version: 1, spline: 'wire',
    origin: [0, 0, 0], axis: [1, 0, 0], toward: [0, 1, 0], length: 1,
    keys: [{ time: 0, angle: 0, ease: 'linear' }, { time: 2, angle: Math.PI / 2 }] });
  assert.equal(bind.sample(0).document, C.create(bind.sample(0).document));
  assert.deepEqual(bind.sample(0).document, C.create(source));
  near(bind.sample(1).report.angle, Math.PI / 4);
  const { document, report } = bind.sample(2);
  assert.deepEqual(document.attachments, source.attachments);
  assert.deepEqual(document.splines[0].segments, source.splines[0].segments);
  const [root, tip] = document.splines[0].points;
  assert.deepEqual(root.position, [0, 0, 0]);
  near(tip.position[0], 2 / Math.PI);
  near(tip.position[1], 2 / Math.PI);
  near(tip.inHandle[0], 0);
  near(tip.inHandle[1], -1 / 3);
  assert(report.attachments[0].distance > .2);
  assert.deepEqual(report.attachments[0].after, C.compile(document).anchor('span', .6).p);
  assert.deepEqual(bind.sample(3).document, document);
});

test('attribute authoring preserves IDs, source metadata and null labels independently from missing values', () => {
  const table = A.initialize([{ id: 'stitch', point: [1, 2, 3], source: { from: 'sail' }, attributes: { finish: null } },
    { id: 7, point: [2, 3, 4] }], { domain: 'point', channels: { finish: { type: 'label' } } });
  const before = A.inspect(table, { ids: ['stitch', 7] });
  assert.deepEqual(before.selected.map(row => [row.values, row.missing]), [[{ finish: null }, []], [{}, ['finish']]]);
  const operations = [
    { op: 'rename-channel', name: 'finish', to: 'pigment' },
    { op: 'clear', name: 'pigment', id: 'stitch' },
    { op: 'set', name: 'pigment', id: 7, value: 'bronze' },
    { op: 'add-channel', name: 'flow', type: 'vec2' },
    { op: 'set', name: 'flow', id: 7, value: [.4, .7] },
    { op: 'set-interpolation', name: 'flow', interpolation: 'constant' }
  ];
  const { asset, report } = A.edit(table, { revision: before.revision, operations });
  const after = A.inspect(asset, { channels: ['flow', 'pigment'], ids: [7, 'stitch'] });
  assert.deepEqual(asset.entities, table.entities);
  assert.equal(report.outputRevision, after.revision);
  assert.deepEqual(after.selected[0].values, { flow: [.4, .7], pigment: 'bronze' });
  assert.deepEqual(after.channels[0].min, [.4, .7]);
  assert.deepEqual(after.selected[1].missing, ['flow', 'pigment']);
  assert.throws(() => A.edit(asset, { revision: before.revision, operations }), /different revision/);
  assert.throws(() => A.edit(asset, { operations: [{ op: 'set', id: 7, name: 'flow', value: [null, null] }] }), /invalid values/i);
  assert.deepEqual(A.initialize(curve(), { domain: 'curve' }).entities, [{ id: 'wire', point: [.5, 0, 0] }]);
  assert.deepEqual(A.initialize(curve(), { domain: 'curve-control' }).entities.map(row => row.id), ['root', 'tip']);
});

test('surface mesh output can be used directly to create a corner attribute asset through the CLI', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-geometry-authoring-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'patch.json'), mesh = path.join(tmp, 'mesh.json'), request = path.join(tmp, 'domain.json');
  fs.writeFileSync(input, JSON.stringify(patch()));
  fs.writeFileSync(request, JSON.stringify({ domain: 'corner' }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  execFileSync(process.execPath, [cli, 'surface', 'mesh', input, '--resolution', '4', '--out', mesh]);
  const asset = JSON.parse(execFileSync(process.execPath, [cli, 'attributes', 'init', mesh, request], { encoding: 'utf8' }));
  assert.equal(asset.domain, 'corner');
  assert.equal(asset.entities.length, 96);
  const bad = spawnSync(process.execPath, [cli, 'surface', 'mesh', input, '--out', input]);
  assert.notEqual(bad.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(input)).id, 'weighted-sheet');
});
