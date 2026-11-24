const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { KIT } = require('..').load();
const topology = KIT.meshTopology;

function panel() {
  const vertices = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [1, 1, 0], [0, 2, 0], [2, 0, -1], [0, 0, -1]]
    .map((position, i) => ({ id: 'v' + i, position }));
  const face = (id, material, rows) => ({
    id, material, corners: rows.map(([i, u, v]) => ({ id: id + '/' + i, vertex: 'v' + i, uv: [u, v] }))
  });
  return topology.create({
    id: 'panel', vertices, edges: [{ id: 'base', vertices: ['v1', 'v0'] }],
    faces: [
      face('front', 'paint', [[0, 0, 1], [1, 1, 1], [2, 1, 0], [3, .5, .5], [4, 0, 0]]),
      face('side', 'metal', [[1, 0, 0], [0, 1, 0], [6, 1, 1], [5, 0, 1]])
    ]
  });
}

test('bounded concave polygons retain their authored rings, winding, and seam corners', () => {
  const doc = panel(), result = topology.triangulate(doc), report = topology.inspect(doc);
  assert.equal(report.faces, 2);
  assert.equal(report.edges.length, 8);
  assert.equal(report.triangles, 5);
  assert.equal(result.positions.length / 3, 9);
  assert.deepEqual(result.materials, ['paint', 'metal']);
  assert.deepEqual(result.faceMaterials, [0, 0, 0, 1, 1]);
  assert.deepEqual(report.edges.find(edge => edge.id === 'base'), {
    id: 'base', vertices: ['v0', 'v1'],
    uses: [{ face: 'front', from: 'front/0', to: 'front/1' }, { face: 'side', from: 'side/1', to: 'side/0' }]
  });
  const coverArea = result.triangleSources.reduce((area, { face, corners }) => {
    if (face !== 'front') return area;
    const [a, b, c] = corners.map(id => doc.vertices[+id.split('/')[1]].position);
    const twice = KIT.V.cross(KIT.V.sub(b, a), KIT.V.sub(c, a))[2];
    assert(twice > 0);
    return area + twice / 2;
  }, 0);
  assert.equal(coverArea, 3);
  assert.deepEqual(topology.create(JSON.parse(JSON.stringify(doc))), doc);
});

test('editing a ring preserves shared IDs, retains a collinear corner and validates the whole patch', () => {
  const doc = panel(), [front] = doc.faces;
  const edited = topology.edit(doc, {
    vertices: [{ id: 'split', position: [2, 1, 0] }],
    faces: [{ ...front, corners: [...front.corners.slice(0, 2), { id: 'front/split', vertex: 'split', uv: [.85, .5] }, ...front.corners.slice(2)] }]
  });
  assert.equal(doc.vertices.length, 7);
  assert.equal(doc.faces[0].corners.length, 5);
  assert.equal(edited.faces[0].id, 'front');
  assert(edited.faces[0].corners.some(corner => corner.id === 'front/split'));
  assert(edited.edges.some(edge => edge.id === 'base'));
  assert(!edited.edges.some(edge => edge.vertices.join('/') === 'v1/v2'));
  assert.equal(topology.inspect(edited).triangles, 6);
  assert(topology.triangulate(edited).triangleSources.some(row => row.corners.includes('front/split')));
  assert.throws(() => topology.edit(edited, { removeVertices: ['v2'] }), /existing vertices/);
  const reduced = topology.edit(edited, { removeVertices: ['v2', 'split'], removeFaces: ['front'] });
  assert.deepEqual(reduced.faces.map(face => face.id), ['side']);
  assert(reduced.edges.some(edge => edge.id === 'base'));
});

test('indexed input and native textured mesh picking use polygon source IDs', () => {
  const indexed = topology.fromIndexed({
    id: 'triangle', positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
    indices: Uint32Array.of(2, 1, 0), materials: ['metal']
  });
  assert.deepEqual(topology.triangulate(indexed).triangleSources, [{ face: 'f/0', corners: ['c/0', 'c/1', 'c/2'] }]);
  const doc = panel(), mesh = topology.toSceneMesh(doc, {
    objectId: 'relay', partId: 'cover', materials: [{ id: 'paint', color: 0x549888 }, { id: 'metal', color: 0x875b43 }]
  });
  const trace = KIT.sceneMeshes.rayQuery(mesh, KIT);
  const ray = (x, y) => trace({ origin: [x, y, 3], direction: [0, 0, -1], maxDistance: 5 });
  const hit = ray(.25, .4);
  assert.equal(hit.target.material, 'paint');
  assert.equal(hit.pigment, 0x549888);
  assert.equal(hit.target.part, 'cover');
  assert.equal(topology.triangleSource(mesh, hit.triangle).face, 'front');
  assert.equal(topology.triangleSource(mesh, 500), null);
  assert.equal(ray(1, 1.8), null);
});

test('self-crossing faces and edges absent from authored rings fail validation', () => {
  const doc = panel();
  assert.throws(() => topology.create({ ...doc, version: 2 }), /version 1/);
  assert.throws(() => topology.create({ ...doc, edges: [...doc.edges, { id: 'diagonal', vertices: ['v0', 'v3'] }] }), /polygon boundary/);
  const front = doc.faces[0];
  assert.throws(() => topology.edit(doc, { faces: [{ ...front, corners: [0, 2, 4, 1].map(i => front.corners[i]) }] }), /simple polygon/);
});

test('demo patch replays through the CLI and produces different native renders', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-mesh-topology-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.resolve(__dirname, '..');
  const run = (...args) => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  const file = name => path.join(directory, name);
  run('examples/editable-mesh-topology.cjs', directory);
  run('cli/ink-studio.js', 'mesh-topology', 'edit', file('before.json'), file('patch.json'), '--out', file('replayed.json'));
  assert.deepEqual(fs.readFileSync(file('after.json')), fs.readFileSync(file('replayed.json')));
  assert.notDeepEqual(fs.readFileSync(file('before.png')), fs.readFileSync(file('after.png')));
  const report = JSON.parse(run('cli/ink-studio.js', 'mesh-topology', 'inspect', file('replayed.json')));
  assert.equal(report.faces, 9);
  assert.equal(report.triangles, 24);
  const geometry = JSON.parse(run('cli/ink-studio.js', 'mesh-topology', 'triangulate', file('replayed.json')));
  assert.equal(geometry.triangleSources.length, 24);
});
