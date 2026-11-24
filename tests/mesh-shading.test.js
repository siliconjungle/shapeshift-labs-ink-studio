'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const toolkit = ink.load(), { KIT } = toolkit, api = KIT.meshTopology;
const meter = require('../examples/mesh-face-region/fixture.cjs').meter;

function hinge() {
  const vertices = [[0, 0, 0], [0, 1, 0], [-2, 0, 0], [-2, 1, 0], [0, 0, -.5], [0, 1, -.5]];
  const face = (id, ids, start) => ({ id, corners: ids.map((vertex, i) => ({
    id: id + '/' + i, vertex: 'v' + vertex, uv: [start + (i % 2) * .25, Math.floor(i / 2)]
  })) });
  return api.create({ id: 'hinge', vertices: vertices.map((position, i) => ({ id: 'v' + i, position })),
    faces: [face('plate', [2, 0, 1, 3], 0), face('roll', [0, 4, 5, 1], .65)] });
}
const req = (doc, fields) => ({ id: 'new-normals', revision: api.revision(doc), ...fields });
const close = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, JSON.stringify([a, b]));

test('smoothing crosses UV seams, respects hard edges and weights the face fan', () => {
  const doc = hinge(), edge = doc.edges.find(row => row.vertices.join() === 'v0,v1').id;
  const plan = api.planShading(doc, req(doc, { settings: { weighting: 'area' }, edges: [{ id: edge, smooth: true, crease: .6 }],
    corners: [{ id: 'plate/0', normal: [.5, 0, 1] }] }));
  assert.deepEqual(plan.document.vertices, doc.vertices);
  assert.deepEqual(plan.document.faces.map(face => face.corners.map(row => row.uv)), doc.faces.map(face => face.corners.map(row => row.uv)));
  assert.deepEqual(plan.document.edges.find(e => e.id === edge), { id: edge, vertices: ['v0', 'v1'], smooth: true, crease: .6 });
  const a = api.inspectShading(plan.document).faces;
  assert.deepEqual(a[0].geometric, [0, 0, 1]);
  assert.deepEqual(a[0].corners[1].shading, a[1].corners[0].shading);
  close(a[0].corners[1].shading[0] * 4, a[0].corners[1].shading[2]);
  close(a[0].corners[0].authored[0], 1 / Math.sqrt(5));
  const hard = api.planShading(plan.document, req(plan.document, { edges: [{ id: edge, smooth: false }] })).document;
  assert.deepEqual(api.inspectShading(hard).faces[0].corners[1].shading, [0, 0, 1]);
  assert.equal(hard.edges.find(row => row.id === edge).crease, .6);
  const reset = api.planShading(hard, req(hard, { edges: [{ id: edge, smooth: null, crease: null }],
    corners: [{ id: 'plate/0', normal: null }], settings: null })).document;
  assert.deepEqual(reset, doc);
  assert.deepEqual(api.edit(doc, plan.patch), plan.document);
  assert.throws(() => api.planShading(plan.document, req(doc, {})), /Stale/);
});

test('subdivision respects creases independently of smooth flags, materials and face-varying UVs', () => {
  const doc = api.create(meter()), front = doc.edges.filter(row => row.vertices.every(id => id.startsWith('front/')));
  const shape = key => api.subdivide(api.planShading(doc, req(doc, { settings: { smooth: true },
    edges: front.map(({ id }) => ({ id, crease: key })) })).document, { levels: 1 });
  const soft = shape(0), semi = shape(.5), creased = shape(1);
  const points = model => new Map(model.vertices.map(row => [row.id, row.position]));
  const id = 'front/0', z = doc.vertices.find(row => row.id === id).position[2];
  close(points(creased).get(id)[2], z);
  assert(points(soft).get(id)[2] < points(semi).get(id)[2] && points(semi).get(id)[2] < z);
  assert.equal(creased.edges.filter(edge => edge.crease === 1).length, 8);
  assert.equal(creased.faces.length, 24);
  assert(api.inspect(creased).edges.every(edge => edge.uses.length === 2));
  assert.equal(creased.faces.filter(face => face.material === 'dial').length, 4);
  assert(creased.faces.some(face => face.corners.some(row => row.uv[0] === .5 && row.uv[1] === .5)));
  assert.equal(doc.vertices.find(row => row.id === id).position[2], z);
});

function renderFixture({ KIT, makeBuilder }) {
  const positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
  const mesh = KIT.sceneMeshes.create({ id: 'plate', positions, uvs: [0, 1, 1, 1, 1, 0, 0, 0],
    indices: [0, 1, 2, 0, 2, 3], normals: [.8, 0, .6, .8, 0, .6, .8, 0, .6, .8, 0, .6],
    materials: [{ id: 'pigment', color: 0x686868 }] });
  const world = makeBuilder(4, [0x183244]).finish({ meshes: [mesh], dither: 0,
    cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0, ortho: true } });
  const view = { w: 80, h: 56, px: 1, raw: true };
  const lights = [{ id: 'key', shape: 'disk', at: [1.3, 0, .9], normal: [0, 0, -1],
    size: [.1, .1], color: '#ffffff', intensity: 3, radius: 6, sampleGrid: 1, visible: false, shadows: false }];
  return { mesh, positions, world, view, lights };
}

test('native passes and ray picks keep the geometry normal separate and transport authored normals on pose', () => {
  const { mesh, positions, world, view, lights } = renderFixture(toolkit);
  const frame = ink.render(world, { ...view, areaLights: lights, passes: ['opaque-surface'] });
  const hit = ink.pickSurface(frame.passes, 40, 28);
  assert.deepEqual(hit.geometricNormal, [0, 0, 1]);
  close(hit.shadingNormal[0], .8);
  const without = ink.render(world, { ...view, areaLights: lights, surfaceNormals: false, passes: ['opaque-surface'] });
  assert.deepEqual(ink.pickSurface(without.passes, 40, 28).shadingNormal, [0, 0, 1]);
  assert(frame.rgb[(28*80+40)*3] > without.rgb[(28*80+40)*3]);
  const ray = { origin: [.05, -.05, 3], direction: [0, 0, -1], maxDistance: 5 };
  const trace = () => KIT.sceneMeshes.rayQuery(mesh, KIT)(ray);
  close(trace().shadingNormal[0], .8);
  const rotated = positions.flatMap((_, i) => i % 3 ? [] : [-positions[i + 1], positions[i], positions[i + 2]]);
  KIT.sceneMeshes.pose(mesh, rotated);
  close(trace().shadingNormal[0], 0);
  close(trace().shadingNormal[1], .8);
  trace().geometricNormal.forEach((n, i) => close(n, Number(i === 2)));
});

test('WebGL uses authored shading for lights and uploads pose changes',
  { skip: !process.env.INK_TEST_CHROME }, () => {
    const checked = require('../cli/look-webgl.js')({}, renderFixture, (kit, build, backend) => {
      const { mesh, positions, world, view, lights } = build(kit);
      const painter = backend(view.w, view.h, { raw: true, dither: 0 }), point = { middle: [40,28] };
      try {
        painter.draw(world, { areaLights: lights, surfaceNormals: false });
        const flat = painter.sample(point).middle;
        painter.draw(world, { areaLights: lights });
        const authored = painter.sample(point).middle;
        kit.KIT.sceneMeshes.pose(mesh, positions.flatMap((_, i) => i % 3 ? [] :
          [-positions[i + 1], positions[i], positions[i + 2]]));
        painter.draw(world, { areaLights: lights });
        return { flat, authored, posed: painter.sample(point).middle };
      } finally { painter.close(); }
    });
    assert(checked.authored[0] > checked.flat[0], JSON.stringify(checked));
    assert(checked.authored[0] > checked.posed[0], JSON.stringify(checked));
  });

test('shading edits keep registered scene bakes and reach the native CLI and journal', t => {
  const doc = api.create(meter()), request = req(doc, { settings: { smooth: true }, corners: [{ id: 'gauge/corner/0', normal: [0,.3,1] }] });
  const scene = { id: 'workshop', style: 'slate', solids: [], topologyMeshes: { meter: { document: doc, part: 'dial',
    bindings: [{ id: 'dial', domain: 'corners', element: 'gauge/corner/0' }],
    bakes: [{ id: 'gauge-paint', material: 'dial', maps: { roughness: .35 } }] } } };
  const editor = ink.createSceneEditor(scene);
  const plan = editor.planMeshShading('meter', request);
  const applied = editor.editMeshShading('meter', request);
  assert.equal(applied.topology.bindings.length, 0);
  assert.equal(applied.topology.bakes.length, 0);
  const revised = editor.snapshot();
  assert(editor.undo());
  assert.deepEqual(editor.meshTopology('meter').document, doc);
  assert(editor.redo());
  assert.deepEqual(editor.meshTopology('meter').document, plan.document);
  const source = ink.createSceneEditor(scene), pixels = ink.createPixelEditor({
    format: 'ink-studio/pixel-art', version: 2, width: 8, height: 8, pixelAspect: [1, 1],
    palette: { ink: '#ba9b71' }, layers: [{ id: 'ink' }], frames: [{ id: 'front', durationMs: 100, cels: {} }],
    sceneBindings: [{ id: 'meter', scene: 'workshop', object: 'meter', part: 'dial' }],
    destinations: [{ id: 'geometry', kind: 'mesh-topology', binding: 'meter' }]
  }, { sceneEditor: source });
  const edit = { id: 'set-shade', frame: 'front', revision: pixels.describe().revision,
    destination: 'geometry', operation: { shading: request } };
  edit.sourceRevision = pixels.previewEdit(edit).sourceRevision;
  assert(pixels.previewEdit(edit, { exact: true }).valid);
  pixels.apply(edit);
  const receipt = pixels.receipts()[0];
  assert(pixels.undo());
  pixels.replay(receipt);
  assert.deepEqual(source.snapshot(), revised);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-mesh-shading-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  write('scene.json', scene);
  write('request.json', request);
  const command = spawnSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'),
    'mesh-topology', 'shading', 'scene.json', 'request.json', '--object', 'meter', '--preview', 'art',
    '--subdivision', '1', '--out', 'edited.json', '--report', 'receipt.json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(read('edited.json'), revised);
  assert.equal(read('art/derived.json').faces.length, 24);
  const native = read('receipt.json').shading.native;
  assert.deepEqual(native.grid, [160,112]);
  assert(native.changed > 0);
  assert.notDeepEqual(fs.readFileSync(native.geometric), fs.readFileSync(native.shading));
});
