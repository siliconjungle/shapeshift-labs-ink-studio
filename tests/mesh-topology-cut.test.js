'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT } = ink.load(), api = KIT.meshTopology;
const sample = require('../examples/mesh-cut/fixture.js');

function plan(doc, request) {
  return api.planCut(doc, { id: 'test', revision: api.revision(doc), ...request });
}

const splitHousing = {
  plane: { origin: [0, 0, 0], normal: [0, 0, 1] }, cap: { kind: 'triangles', material: 'cut' }
};

test('a hollow mesh splits into capped pieces with a preserved bore and source attributes', () => {
  const doc = api.create(sample.housing()), result = plan(doc, splitHousing);
  assert.equal(result.pieces.length, 2);
  assert.equal(result.report.cutEdges.length, 48);
  for (const piece of result.pieces) {
    assert.equal(piece.boundary.paths.length, 2);
    assert(piece.boundary.paths.every(path => path.closed));
    const record = piece.document, vertices = new Map(record.vertices.map(row => [row.id, row]));
    assert(api.inspect(record).edges.every(edge => edge.uses.length === 2));
    const material = record.faces.filter(face => piece.caps.includes(face.id));
    const area = material.reduce((sum, face) => {
      const [a, b, c] = face.corners.map(row => vertices.get(row.vertex).position);
      return sum + KIT.V.len(KIT.V.cross(KIT.V.sub(b, a), KIT.V.sub(c, a))) / 2;
    }, 0);
    assert(Math.abs(area - 3 * (1.28 ** 2 - .67 ** 2)) < 1e-7, String(area));
    assert(material.every(face => face.material === 'cut' && face.corners.every(row => row.uv.every(n => n >= 0 && n <= 1))));
    const through = KIT.sceneMeshes.rayQuery(api.toSceneMesh(record), KIT);
    assert.equal(through({ origin: [0, 0, 1], direction: [0, 0, -1], maxDistance: 2 }), null);
    assert(through({ origin: [.95, 0, 1], direction: [0, 0, -1], maxDistance: 2 }));
    const newVertices = record.vertices.filter(row => row.position[2] === 0);
    assert(newVertices.every(row => row.weights.mount === .5 && row.weights.shell === .5));
    const cutWall = record.faces.filter(face => face.material !== 'cut');
    assert(cutWall.flatMap(face => face.corners).every(corner => Number.isFinite(corner.attributes.coat)));
  }
  assert.deepEqual(result.document.faces.find(face => face.id === 'front/0'), doc.faces.find(face => face.id === 'front/0'));
  assert.deepEqual(api.edit(doc, result.patch), result.document);
  assert(result.patch.lineage.edges.some(row => row.from === 'edge/["front/outer/0","rear/outer/0"]'));
  assert.deepEqual(plan(doc, splitHousing).report, result.report);
  assert.throws(() => plan(doc, { ...splitHousing, cap: { kind: 'ngon', material: 'cut' } }), /hole/);
  const noCut = plan(doc, { plane: { origin: [0, 0, 9], normal: [0, 0, 1] } });
  assert.equal(noCut.document, doc);
  assert.deepEqual(noCut.patch, {});
});

test('finite bent knife paths split a concave plaque and keep interpolated paint attached', () => {
  const doc = api.create(sample.plaque());
  const knife = { projection: sample.projection, path: sample.path };
  const result = plan(doc, { knife });
  assert.equal(result.pieces.length, 2);
  assert(result.report.cutEdges.length > 3);
  assert(result.pieces.every(piece => piece.boundary.paths.length === 1 && !piece.boundary.paths[0].closed));
  for (const piece of result.pieces) {
    const vertices = new Map(piece.document.vertices.map(row => [row.id, row.position]));
    for (const corner of piece.document.faces.flatMap(face => face.corners)) {
      assert(Math.abs(corner.uv[0] - (vertices.get(corner.vertex)[0] + 1.3) / 2.6) < 1e-8);
      assert(Math.abs(corner.attributes.coat - corner.uv[0]) < 1e-8);
    }
  }
  const tip = plan(doc, { knife: { ...knife, path: [[-.20, -.22], [.30, .21]] } });
  assert.equal(tip.pieces.length, 1);
  assert(tip.report.cutEdges.length > 0);
  const enclosed = plan(doc, { knife: { ...knife,
    path: [[-.35, -.28], [.28, -.28], [.28, .19], [-.35, .19], [-.35, -.28]] } });
  assert.equal(enclosed.pieces.length, 2);
  assert(enclosed.pieces.every(piece => piece.boundary.paths[0].closed));
  const connected = plan(doc, { knife, split: false });
  assert.equal(api.select(connected.document, { domain: 'faces', ids: ['painted-front'], traverse: 'island' }).ids.length,
    connected.document.faces.length);
  assert.throws(() => plan(doc, { knife, cap: { kind: 'triangles', material: 'cut' } }), /closed/);
  assert.throws(() => plan(doc, { knife: { ...knife, path: [[0, 0], [1, 1], [0, 1], [1, 0]] } }), /crosses itself/);
});

test('knife inserts conforming edge points but keeps separate corner values across a UV seam', () => {
  const v = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]].map(([x, y], i) =>
    ({ id: 'v' + i, position: [x, y, 0] }));
  const face = (id, ring, pigment) => ({ id, material: id,
    corners: ring.map((i, c) => ({ id: id + '/' + c, vertex: 'v' + i, uv: [pigment, v[i].position[1]],
      attributes: { tint: [pigment, .4, .7] } })) });
  const doc = api.create({ id: 'tiles', vertices: v, faces: [face('left', [0, 1, 4, 3], 1), face('right', [1, 2, 5, 4], 0)] });
  const selection = api.select(doc, { domain: 'faces', ids: ['left'] });
  const cut = plan(doc, { knife: { projection: sample.projection, path: [[-.2, .4], [2.2, .4]], selection }, split: false });
  const at = cut.document.vertices.find(({ position: [x, y] }) => x === 1 && Math.abs(y - .4) < 1e-9);
  assert(at);
  const corners = cut.document.faces.flatMap(face =>
    face.corners.filter(corner => corner.vertex === at.id).map(corner => [face.material, corner.uv[0], corner.attributes.tint[0]]));
  assert(corners.some(row => row[0] === 'left' && row[1] === 1 && row[2] === 1));
  assert(corners.some(row => row[0] === 'right' && row[1] === 0 && row[2] === 0));
  const remapped = api.inspect(cut.document).edges.filter(edge =>
    edge.vertices.includes(at.id) && edge.vertices.some(id => ['v1', 'v4'].includes(id)));
  assert.equal(remapped.length, 2);
  assert(remapped.every(edge => edge.uses.length === 2));
});

test('a plane can detach a preexisting edge and cap a simple section with polygons', () => {
  const points = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
  const box = api.create({ id: 'box', vertices: points.map((position, i) => ({ id: 'v' + i, position })),
    faces: faces.map((ring, i) => ({ id: 'f' + i, corners: ring.map(j => ({ id: i + '/' + j, vertex: 'v' + j })) })) });
  const p = plan(box, { plane: { origin: [0, 0, 0], normal: [1, 0, 0] }, cap: { kind: 'ngon', material: 'cap' } });
  assert.deepEqual(p.pieces.map(piece => piece.caps.length), [1, 1]);
  assert(p.pieces.every(piece => api.inspect(piece.document).edges.every(edge => edge.uses.length === 2)));
  const panel = api.fromIndexed({ id: 'panel', positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3] });
  const cut = plan(panel, { plane: { origin: [0, 0, 0], normal: [1, -1, 0] } });
  assert.deepEqual(cut.report.cutEdges, [['v/0', 'v/2']]);
  assert.equal(cut.pieces.length, 2);
});

test('cut preview, pixel receipt and CLI replay share the same topology edit and piece files', t => {
  const doc = api.create(sample.plaque());
  const scene = { id: 'workbench', style: 'slate', solids: [], topologyMeshes: { plaque: { document: doc, part: 'surface' } } };
  const source = ink.createSceneEditor(scene);
  const request = { id: 'desk', revision: api.revision(doc), knife: { projection: sample.projection, path: sample.path } };
  const preview = source.planMeshCut('plaque', request);
  assert.equal(preview.pieces.length, 2);
  const design = { format: 'ink-studio/pixel-art', version: 2, width: 8, height: 8, pixelAspect: [1, 1],
    palette: { chalk: '#c3aa76' }, layers: [{ id: 'ink' }], frames: [{ id: 'front', durationMs: 100, cels: {} }],
    sceneBindings: [{ id: 'plaque', scene: 'workbench', object: 'plaque', part: 'surface' }],
    destinations: [{ id: 'geometry', kind: 'mesh-topology', binding: 'plaque' }] };
  const pixels = ink.createPixelEditor(design, { sceneEditor: source });
  const patch = { id: 'cut', frame: 'front', revision: pixels.describe().revision, destination: 'geometry', operation: { cut: request } };
  patch.sourceRevision = pixels.previewEdit(patch).sourceRevision;
  const diff = pixels.previewEdit(patch, { exact: true });
  assert.equal(diff.valid, true, JSON.stringify(diff.conflicts));
  assert.deepEqual(diff.targets[0].cut, preview.report);
  pixels.apply(patch);
  const receipt = pixels.receipts()[0];
  assert.equal(pixels.undo(), true);
  assert.deepEqual(source.snapshot(), scene);
  pixels.replay(receipt);
  assert.deepEqual(source.meshTopology('plaque').document, preview.document);
  assert.throws(() => source.planMeshCut('plaque', request), /Stale mesh cut revision/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-topology-cut-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  write('scene.json', scene);
  write('request.json', request);
  execFileSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), 'mesh-topology', 'cut', 'scene.json', 'request.json',
    '--object', 'plaque', '--out', 'after.json', '--report', 'report.json', '--pieces', 'pieces'], { cwd: dir });
  assert.deepEqual(read('after.json'), source.snapshot());
  assert.deepEqual(read('report.json').cut, preview.report);
  assert.deepEqual(read('pieces/piece-2.json'), preview.pieces[1].document);
});
