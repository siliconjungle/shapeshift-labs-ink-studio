'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const R = require('../cli/render.js');
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');
const P = require('./gatehouse-revision/portal.cjs');
const { sourceScene } = require('./gatehouse-revision/demo.cjs');
const gatehouse = require('./opaque-surface-gate.js');

const panelVertex = (x, y) => 'v/' + x + '/' + y;

function panel(columns = 6, rows = 4) {
  const vertices = [], faces = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++)
    vertices.push({ id: panelVertex(x, y), position: [x * .45, y * .45, 0] });
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const id = 'f/' + x + '/' + y;
    faces.push({ id, material: (x + y) % 2 ? 'warm' : 'cool',
      corners: [panelVertex(x, y), panelVertex(x + 1, y), panelVertex(x + 1, y + 1), panelVertex(x, y + 1)]
        .map((vertex, i) => ({ id: id + '/' + i, vertex })) });
  }
  return { id: 'maintenance-panels', vertices, faces };
}

function markedEdges(kit, doc, selected, tint) {
  const points = new Map(doc.vertices.map(row => [row.id, row.position])), active = new Set(selected);
  const groups = [
    { id: 'joint', rows: doc.edges.filter(edge => !active.has(edge.id)), color: 0x263846, half: .009 },
    { id: 'selection', rows: doc.edges.filter(edge => active.has(edge.id)), color: tint, half: .027 }
  ];
  return groups.map(({ id, rows, color, half }, k) => {
    const positions = [], indices = [], uvs = [];
    for (const { vertices } of rows) {
      const [a, b] = vertices.map(vertex => points.get(vertex)), i = positions.length / 3;
      const [dx, dy] = kit.V.norm(kit.V.sub(b, a)), x = -dy * half, y = dx * half, z = .003 + k * .001;
      positions.push(a[0] - x, a[1] - y, z, b[0] - x, b[1] - y, z,
        b[0] + x, b[1] + y, z, a[0] + x, a[1] + y, z);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
    return kit.sceneMeshes.create({ id, positions, indices, uvs, materials: [{ id, color }] });
  });
}

function run(directory) {
  const dir = path.resolve(directory), kit = ink.load(), { KIT: K, makeBuilder } = kit;
  const api = K.meshTopology, geometry = api.create(P.portal(true));
  const fixture = gatehouse(kit), world = fixture.build(fixture.seed, { sdfPortal: false });
  const scene = sourceScene(geometry, P.atlas(), world.cam);
  scene.topologyMeshes[P.object].materials.push({ id: 'selected-rim', color: 0x60ebd2 });
  const editor = ink.createSceneEditor(scene), editable = editor.build();
  Object.assign(world, { meshes: editable.meshes, topologyMeshes: editable.topologyMeshes });
  const view = { w: 144, h: 96, px: 1, t: 3 * Math.PI / 1.8, yaw: .36, lockCamera: true };
  const { frame, visibility } = ink.captureMeshTopologyVisibility(world, P.object, view);
  const rimQuery = { domain: 'edges', filter: { materials: [P.bevel], seam: true, crease: { min: 24 }, visibility: 'visible' } };
  const rim = editor.selectMeshTopology(P.object, rimQuery, { visibility });
  const faceQuery = { convert: 'faces', filter: { materials: [P.bevel], visibility: 'visible' } };
  const faces = editor.selectMeshTopology(P.object, { from: rim, ...faceQuery }, { visibility });
  const signBoundary = api.select(geometry, { domain: 'faces', ids: [P.sign], traverse: 'boundary' });
  const signIsland = api.select(geometry, { domain: 'faces', ids: [P.sign], traverse: 'island' });
  assert(rim.ids.length && faces.ids.length);
  assert.deepEqual(signIsland.ids, [P.sign]);

  const patch = { faces: geometry.faces.filter(row => faces.ids.includes(row.id)).map(row => ({ ...row, material: 'selected-rim' })) };
  const edit = editor.editMeshTopology(P.object, patch, { part: P.part });
  assert.equal(edit.faces.length, faces.ids.length);
  const marked = ink.render({ ...world, meshes: editor.build().meshes }, view);

  const tiles = api.create(panel()), seed = tiles.edges.find(edge => edge.vertices.includes(panelVertex(2, 2)) &&
    edge.vertices.includes(panelVertex(3, 2))).id;
  const fromEdge = { domain: 'edges', ids: [seed] };
  const loop = api.select(tiles, { ...fromEdge, traverse: 'loop' });
  const ring = api.select(tiles, { ...fromEdge, traverse: 'ring' });
  const base = api.toSceneMesh(tiles, { materials: [{ id: 'warm', color: 0x567a79 }, { id: 'cool', color: 0x456469 }] });
  const tileWorld = makeBuilder(18, [0x172b3a]).finish({ cam: { target: [1.35, .90, 0], dist: 4.5, yaw: .18, pitch: .18, ortho: true } });
  const tileImages = [[loop, 0x79efd5], [ring, 0xffb772]].map(([set, tint]) =>
    ink.render({ ...tileWorld, meshes: [base, ...markedEdges(K, tiles, set.ids, tint)] }, { w: view.w, h: view.h, px: 1, raw: true }));

  fs.mkdirSync(dir, { recursive: true });
  const save = (name, value) => files.json(path.join(dir, name + '.json'), value);
  save('mesh', geometry);
  save('scene', scene);
  save('view', view);
  save('visible', visibility);
  save('rim-query', rimQuery);
  save('rim-edges', rim);
  save('bevel-query', faceQuery);
  save('bevel-faces', faces);
  save('highlight-patch', patch);
  save('tiles', tiles);
  save('loop-query', { ...fromEdge, traverse: 'loop' });
  save('ring-query', { ...fromEdge, traverse: 'ring' });
  const report = { rim, faces, signBoundary, signIsland, loop, ring };
  save('report', report);

  const picture = R.grid([frame, marked, ...tileImages].map(image => R.upscale(image, 3)), 2);
  PNG.write(path.join(dir, 'comparison.png'), picture.w, picture.h, picture.rgb);
  return report;
}

if (require.main === module) run(process.argv[2] ?? 'output/component-selection');
module.exports = { panel, panelVertex, run };
