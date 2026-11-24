'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT } = ink.load();
const api = KIT.meshTopology;
const { panel, panelVertex } = require('../examples/mesh-component-selection.cjs');
const cwd = path.resolve(__dirname, '..');

function line(doc, a, b) {
  const edge = doc.edges.find(({ vertices }) => vertices.includes(a) && vertices.includes(b));
  assert(edge, 'Expected authored edge ' + a + '–' + b);
  return edge.id;
}

test('loops cross regular vertices and rings cross opposite quad edges', () => {
  const doc = api.create(panel()), edge = (x, y) => line(doc, panelVertex(x, y), panelVertex(x + 1, y));
  const picked = { domain: 'edges', ids: [edge(2, 2)] };
  const loop = api.select(doc, { ...picked, traverse: 'loop' });
  const ring = api.select(doc, { ...picked, traverse: 'ring' });
  assert.deepEqual(loop.ids, Array.from({ length: 6 }, (_, x) => edge(x, 2)).sort());
  assert.deepEqual(ring.ids, Array.from({ length: 5 }, (_, y) => edge(2, y)).sort());
  assert.throws(() => api.select(doc, { domain: 'edges', traverse: 'ring' }), /edge seeds/);
  assert.equal(api.select(doc, { domain: 'edges', ids: [edge(0, 0)], traverse: 'boundary' }).ids.length, 20);
  assert.equal(api.select(doc, { domain: 'edges', ids: [edge(0, 0)], traverse: 'loop' }).ids.length, 20);
  assert.deepEqual(api.select(doc, { domain: 'edges', ids: [edge(2, 2)], traverse: 'boundary' }).ids, []);
  assert.throws(() => api.select(doc, { domain: 'faces', ids: null }), /need an array/);
});

test('grow, shrink, conversion and face boundaries operate on authored incidence', () => {
  const doc = api.create(panel());
  const center = api.select(doc, { domain: 'faces', ids: ['f/2/1'] });
  const grown = api.select(doc, { from: center, grow: 1 });
  assert.deepEqual(grown.ids, ['f/1/1', 'f/2/0', 'f/2/1', 'f/2/2', 'f/3/1']);
  assert.deepEqual(api.select(doc, { from: grown, shrink: 1 }), center);
  assert.deepEqual(api.select(doc, { from: center, shrink: 2 }).ids, []);
  const vertices = api.select(doc, { from: center, convert: 'vertices' });
  assert.deepEqual(vertices.ids, ['v/2/1', 'v/2/2', 'v/3/1', 'v/3/2']);
  assert.deepEqual(api.select(doc, { from: vertices, convert: 'faces', match: 'all' }), center);
  assert.equal(api.select(doc, { from: vertices, convert: 'faces' }).ids.length, 9);
  const boundary = api.select(doc, { domain: 'faces', ids: ['f/2/1', 'f/3/1'], traverse: 'boundary' });
  assert.equal(boundary.domain, 'edges');
  assert.equal(boundary.ids.length, 6);
  assert(!boundary.ids.includes(line(doc, 'v/3/1', 'v/3/2')));
  assert.deepEqual(api.select(doc, { domain: 'vertices', ids: ['v/2/1'], grow: 1 }).ids,
    ['v/1/1', 'v/2/0', 'v/2/1', 'v/2/2', 'v/3/1']);
  assert.deepEqual(api.select(doc, { from: JSON.parse(JSON.stringify(center)) }), center);
  const changed = api.edit(doc, { vertices: [{ id: 'v/0/0', position: [-.1, 0, 0] }] });
  assert.throws(() => api.select(changed, { from: center }), /same topology revision/);
});

function face(id, material, vertices, uvs) {
  return { id, material, corners: vertices.map((vertex, i) => ({ id: id + '/' + i, vertex, ...(uvs && { uv: uvs[i] }) })) };
}

test('islands, creases and UV seams use face corners and handle nonmanifold branches', () => {
  const vertices = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [-1, 0, 0], [0, -1, 0]]
    .map((position, i) => ({ id: 'v' + i, position }));
  const faces = [
    face('panel', 'paint', ['v0', 'v1', 'v2', 'v3'], [[0, 0], [1, 0], [1, 1], [0, 1]]),
    face('flange', 'steel', ['v1', 'v0', 'v4', 'v5'], [[1, 1], [0, 1], [0, 0], [1, 0]]),
    face('tab', 'paint', ['v0', 'v6', 'v7'])
  ];
  const doc = api.create({ id: 'folded-panel', vertices, faces, edges: [{ id: 'fold', vertices: ['v1', 'v0'] }] });
  const query = { domain: 'edges', filter: { materials: ['steel'], seam: true, crease: { min: 89, max: 91 } } };
  assert.deepEqual(api.select(doc, query).ids, ['fold']);
  const plate = { domain: 'faces', ids: ['panel'], traverse: 'island' };
  assert.deepEqual(api.select(doc, plate).ids, ['flange', 'panel']);
  assert.equal(api.select(doc, { domain: 'vertices', ids: ['v0'], traverse: 'island' }).ids.length, vertices.length);
  assert.deepEqual(api.select(doc, { domain: 'edges', ids: ['fold'], traverse: 'loop' }).ids, ['fold']);
  const nonmanifold = api.edit(doc, { faces: [face('branch', 'paint', ['v0', 'v1', 'v7'])] });
  assert.deepEqual(api.select(nonmanifold, { domain: 'edges', ids: ['fold'], traverse: 'ring' }).ids, ['fold']);
  assert.deepEqual(api.select(nonmanifold, query).ids, []);
  assert.deepEqual(api.select(nonmanifold, { domain: 'edges', filter: { seam: true } }).ids, ['fold']);
});

function tileSet(id, tiles) {
  const vertices = [], faces = [];
  for (const [name, x, z, material] of tiles) {
    const points = [[x, -.4, z], [x + .8, -.4, z], [x + .8, .4, z], [x, .4, z]];
    vertices.push(...points.map((position, i) => ({ id: name + '/' + i, position })));
    faces.push(face(name, material, points.map((_, i) => name + '/' + i)));
  }
  return { id, vertices, faces };
}

test('native visibility maps material-grouped triangles and excludes an occluded component', t => {
  const geometry = tileSet('panels', [['left', -1.65, 0, 'light'], ['middle', -.4, 0, 'dark'], ['right', .8, 0, 'light']]);
  const blocker = tileSet('blocker', [['solid', -.4, .8, 'dark']]);
  const materials = [{ id: 'light', color: 0xe2cf7c }, { id: 'dark', color: 0x415368 }];
  const scene = { id: 'visibility-scene', style: 'slate', solids: [],
    camera: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0, projection: 'orthographic', sway: 0 },
    topologyMeshes: {
      tiles: { document: geometry, part: 'wall', materials },
      block: { document: blocker, materials }
    }
  };
  const view = { w: 96, h: 64, lockCamera: true, ortho: true };
  const editor = ink.createSceneEditor(scene), world = editor.build();
  const { visibility } = ink.captureMeshTopologyVisibility(world, 'tiles', view);
  assert.deepEqual(visibility.visible.faces, ['left', 'right']);
  assert.equal(visibility.visible.vertices.length, 8);
  assert.equal(visibility.visible.edges.length, 8);
  assert(visibility.visible.edges.every(edge => !edge.includes('middle')));
  const query = { domain: 'faces', filter: { visibility: 'hidden' } };
  const result = editor.selectMeshTopology('tiles', query, { visibility, part: 'wall' });
  assert.deepEqual(result.ids, ['middle']);
  assert.throws(() => editor.selectMeshTopology('tiles', query, { visibility, part: 'roof' }), /No editable topology/);
  assert.throws(() => api.select(geometry, query), /Capture mesh visibility/);
  const moved = api.edit(geometry, { vertices: [{ id: 'middle/0', position: [-.25, -.4, 0] }] });
  assert.throws(() => api.select(moved, query, { visibility }), /topology revision/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-component-selection-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ scene, geometry, query, view, visibility, result, next: { convert: 'vertices' } }))
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(value));
  const cli = (...args) => [path.join(cwd, 'cli/ink-studio.js'), 'mesh-topology', 'select', ...args];
  const run = (...args) => JSON.parse(execFileSync(process.execPath, cli(...args), { cwd: dir, encoding: 'utf8' }));
  assert.deepEqual(run('scene.json', 'query.json', '--object', 'tiles', '--view', 'view.json'), result);
  assert.deepEqual(run('geometry.json', 'query.json', '--visibility', 'visibility.json'), result);
  assert.deepEqual(run('geometry.json', 'next.json', '--from', 'result.json').ids,
    ['middle/0', 'middle/1', 'middle/2', 'middle/3']);
  const denied = spawnSync(process.execPath, cli('geometry.json', 'next.json', '--from', 'result.json', '--out', 'result.json'),
    { cwd: dir, encoding: 'utf8' });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /separate file/);
});
