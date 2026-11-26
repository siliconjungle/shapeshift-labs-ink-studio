const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { KIT: K } = require('..').load();
const T = K.meshTopology;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

test('dirty imported triangles form reciprocal quads and retain protected boundaries', () => {
  const input = { id: 'plates', positions: [-1,0,0, 0,0,0, 0,1,0, -1,1,0, 1,0,0, 1,1,0, -1,0,0],
    indices: [6,1,2, 0,3,2, 1,4,2, 4,5,2, 0,1,2, 1,1,2] };
  const options = { symmetry: { axis: 'x' } };
  const merged = T.remeshImported(input, options);
  assert(merged.report.canCommit, JSON.stringify(merged.report.issues));
  assert.equal(merged.report.quads, 2);
  assert.deepEqual(merged.report.repair.welds.map(row => [row.removed, row.kept]), [['v/6','v/0']]);
  assert.deepEqual(merged.report.repair.flipped, ['f/1']);
  assert.deepEqual(merged.report.repair.removedFaces.map(row => row.kind), ['duplicate-triangle','collapsed-triangle']);
  assert.equal(merged.report.pairs[0].mirror, merged.report.pairs[1].to);
  assert.equal(merged.report.pairs[1].mirror, merged.report.pairs[0].to);
  assert.deepEqual(merged.document.vertices, merged.repaired.vertices);
  assert.equal(T.triangulate(merged.document).triangleSources.length, 4);
  assert(merged.report.preservation.material.complete);
  assert.equal(merged.correspondence.afterRevision, T.revision(merged.document));

  const held = T.remeshImported(input, { ...options, protected: { edges: [[0,2]] } });
  assert(held.report.canCommit);
  assert.equal(held.report.quads, 0);
  assert(held.report.retainedFeatures.some(row => row.reason === 'protected-edge'));
  assert.equal(held.report.unavailable['no-mirrored-quad'], 1);
});

test('import pairing keeps UV seams and blocks conflicting coincident pigment', () => {
  const positions = [0,0,0, 1,0,0, 1,1,0, 0,1,0];
  const input = { id: 'paint', positions, indices: [0,1,2, 0,2,3],
    cornerUVs: [[[0,0],[1,0],[1,1]], [[.2,0],[.8,1],[0,1]]] };
  const held = T.remeshImported(input);
  assert(held.report.canCommit);
  assert.equal(held.report.quads, 0);
  assert(held.report.retainedFeatures.some(row => row.reason === 'uv-seam'));
  const conflicted = T.remeshImported({ ...input, indices: [0,1,2,0,1,2] });
  assert.equal(conflicted.document, null);
  assert(conflicted.report.issues.some(row => row.kind === 'coincident-triangle-attribute-conflict'));
});

test('quad limit queries evaluate regular cubic patches and report bounded estimates', () => {
  const vertices = [], faces = [];
  const id = (x, y) => x + '/' + y;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++)
    vertices.push({ id: id(x,y), position: [x, y, .10 * x*x + .08 * y*y] });
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const face = 'q/' + id(x,y);
    faces.push({ id: face, corners: [id(x,y), id(x+1,y), id(x+1,y+1), id(x,y+1)].map((vertex, i) =>
      ({ id: face + '/' + i, vertex })) });
  }
  const doc = T.create({ id: 'smooth', vertices, faces });
  const query = { face: 'q/1/1', uv: [.25,.6] };
  const regular = T.queryLimitSurface(doc, { samples: [query], levels: 0 });
  const row = regular.samples[0], x = 1.25, y = 1.6;
  assert.equal(row.method, 'regular-bicubic');
  assert(regular.converged);
  assert(K.V.dist(row.position, [x, y, .1 * (x*x+1/3) + .08 * (y*y+1/3)]) < 1e-10);
  assert(K.V.dist(row.normal, K.V.norm([-.2*x,-.16*y,1])) < 1e-10);
  const boundary = { face: 'q/0/0', uv: [.05,.03] };
  const rough = T.queryLimitSurface(doc, { samples: [boundary], levels: 0 });
  assert.equal(rough.samples[0].method, 'refined-limit-estimate');
  assert.equal(rough.converged, false);
  const refined = T.queryLimitSurface(doc, { samples: [boundary], levels: 2 });
  assert(refined.samples[0].refinement > 0);
  assert(refined.samples[0].positionDelta >= 0);
});

test('CLI writes repair evidence and withholds a non-manifold workpiece', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-import-remesh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'broken.obj'), out = path.join(root, 'result');
  const source = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 -1 0\nv 0 0 1\nf 1 2 3\nf 2 1 4\nf 1 2 5\n';
  fs.writeFileSync(file, source);
  const child = spawnSync(process.execPath, [cli, 'mesh-topology', 'remesh-import', file, '--out', out], { encoding: 'utf8' });
  assert.equal(child.status, 2, child.stderr);
  assert.deepEqual(fs.readdirSync(out), ['report.json']);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json')));
  assert(report.issues.some(row => row.kind === 'non-manifold-edge'));
  assert.equal(fs.readFileSync(file, 'utf8'), source);
});
