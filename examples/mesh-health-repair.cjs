'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const R = require('../cli/render.js');
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');

function hatch() {
  const points = [], faces = [], z = .36;
  function ring(label, bounds, weighted = {}) {
    const [l, b, r, t] = bounds;
    return [[l, b], [r, b], [r, t], [l, t]].map(([x, y], i) => {
      const id = label + '/' + i;
      points.push({ id, position: [x, y, z], ...(weighted[i] && { weights: weighted[i] }) });
      return { vertex: id, uv: [Number(i === 1 || i === 2), Number(i < 2)] };
    });
  }
  function plate(id, material, ring) {
    faces.push({ id, material, corners: ring.map(row => ({ id: id + '/' + row.vertex, ...row })) });
  }
  const a = ring('release', [-2.04, .46, -1.26, 1.62], { 1: { mount: .8, hinge: .2 }, 2: { mount: 1 } });
  const b = ring('control', [-1.214, .46, -.08, 1.62], { 0: { mount: .4, hinge: .6 }, 3: { mount: 1 } });
  const c = ring('badge', [.06, .46, 1.37, 1.62]);
  const d = ring('side', [1.5, .46, 2.02, 1.62]);
  plate('release', 'copper', a);
  plate('control', 'teal', b.slice().reverse());
  plate('badge-a', 'label', c.slice(0, 3));
  plate('badge-b', 'label', [c[0], c[2], c[3]]);
  plate('side', 'copper', d);
  return { id: 'tidal-hatch', vertices: points, faces };
}

function art(id) {
  const width = 48, height = 40, pixels = new Uint8Array(width * height * 4);
  const badge = ['111101101101111', '110101110101110', '111001011001111'];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
    const metal = id === 'copper' ? [149, 93, 68] : id === 'teal' ? [53, 117, 110] : [71, 96, 105];
    const fleck = (11 * x + 23 * y) % 73 < 2;
    const tile = x > 7 && x < 40 && y > 9 && y < 27;
    const rivet = [4, 43].some(cx => [4, 35].some(cy => (x - cx) ** 2 + (y - cy) ** 2 <= 5));
    let rgb = metal.map(value => value + (edge < 2 ? -19 : edge === 2 ? 24 : fleck ? 15 : 0));
    if (rivet) rgb = [223, 172, 111];
    else if (tile && id === 'label') {
      const gx = Math.floor((x - 12) / 2), gy = Math.floor((y - 12) / 2), letter = Math.floor(gx / 4);
      rgb = gy >= 0 && gy < 5 && gx >= 0 && gx % 4 < 3 && badge[letter]?.[3 * gy + gx % 4] === '1' ?
        [255, 212, 151] : [25, 51, 56];
    } else if (id === 'teal' && y > 12 && y < 31 && x > 11 && x < 36)
      rgb = y % 6 < 2 ? [28, 59, 65] : (y % 6 === 2 ? [102, 164, 149] : rgb);
    else if (id === 'copper' && x > 15 && x < 33 && y > 14 && y < 25)
      rgb = (x + y) % 9 < 4 ? [55, 47, 53] : [220, 146, 83];
    pixels.set([...rgb, 255], (y * width + x) * 4);
  }
  return { width, height, pixels: Array.from(pixels) };
}

function wires(kit, doc, highlights) {
  const vertices = new Map(doc.vertices.map(row => [row.id, row.position]));
  const bands = new Map();
  for (const { id, vertices: endpoints } of doc.edges) {
    const color = highlights.get(id) ?? 0x26343b;
    if (!bands.has(color)) bands.set(color, []);
    bands.get(color).push(endpoints.map(id => vertices.get(id)));
  }
  return [...bands].map(([color, segments], slot) => {
    const id = 'wire/' + slot, points = [], uvs = [], indices = [];
    for (const [a, b] of segments) {
      const [dx, dy] = kit.V.norm(kit.V.sub(b, a)), width = color === 0x26343b ? .014 : .031;
      const x = -dy * width, y = dx * width, z = .365 + slot * .002, i = points.length / 3;
      points.push(a[0] - x, a[1] - y, z, b[0] - x, b[1] - y, z, b[0] + x, b[1] + y, z, a[0] + x, a[1] + y, z);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
    return kit.sceneMeshes.create({ id, positions: points, uvs, indices, materials: [{ id, color }] });
  });
}

function run(directory) {
  const dir = path.resolve(directory), toolkit = ink.load(), { KIT: kit, makeBuilder, makeSculpt } = toolkit;
  const api = kit.meshTopology, doc = api.create(hatch());
  const camera = { target: [0, 1, 0], dist: 6.3, yaw: .16, pitch: .17, ortho: true };
  const scene = { id: 'repair-bench', style: 'slate', solids: [],
    topologyMeshes: { hatch: { document: doc, materials: ['teal', 'copper', 'label'].map(id => ({ id, texture: art(id) })),
      bindings: [{ id: 'badge-paint', domain: 'faces', element: 'badge-b' }] } } };
  const edge = doc.edges.find(row => row.vertices.join() === 'badge/0,badge/2').id;
  const request = { revision: api.revision(doc), operations: [
    { kind: 'weld', keep: 'release/1', remove: ['control/0'], maxDistance: .05, weights: 'average' },
    { kind: 'weld', keep: 'release/2', remove: ['control/3'], maxDistance: .05 },
    { kind: 'winding', anchor: 'release' },
    { kind: 'dissolve', edge, keep: 'badge-a' }
  ] };
  const editor = ink.createSceneEditor(scene), old = editor.build(), preview = editor.planMeshRepair('hatch', request);
  assert(preview.report.canCommit);
  const repair = editor.repairMeshTopology('hatch', request), after = editor.build();
  const joined = api.planRepair(doc, { ...request, operations: request.operations.slice(0, 2) });
  const healthSettings = { duplicateDistance: .05 };
  const beforeHealth = api.health(doc, healthSettings);
  const joinedHealth = api.health(joined.document), finalHealth = api.health(preview.document);
  assert.equal(joinedHealth.counts.winding, 1);
  assert.equal(beforeHealth.counts.duplicates, 2);
  assert.equal(finalHealth.counts.duplicates, 0);
  assert.equal(finalHealth.counts.winding, 0);
  assert.equal(finalHealth.counts.selfIntersections, 0);

  const B = makeBuilder(29, [0x162431, 0x2b3d4a, 0x435a64, 0x637a7c, 0x836452, 0x9f8061, 0xcb9d70]);
  const S = kit.sculpt(makeSculpt(B));
  S.box([0, .924, -.10], [2.19, .72, .29], { r: [1, 2, 3] }, { rd: .10, res: .105 });
  S.box([0, .16, -.18], [2.63, .10, .85], { r: [4, 5, 6] }, { rd: .07, res: .09 });
  S.bake();
  const world = B.finish({ cam: camera, dither: 0, radius: 5 });
  const focus = new Map([[edge, 0xfabe7b]]);
  for (const row of doc.edges) {
    const pair = row.vertices.join();
    if (pair === 'control/0,control/3' || pair === 'release/1,release/2') focus.set(row.id, 0x6beed1);
    else if (row.vertices.every(id => id.startsWith('control/'))) focus.set(row.id, 0xec8182);
  }
  const view = { w: 144, h: 88, px: 1, raw: true, lockCamera: true };
  const render = (meshes, document, highlights = new Map()) =>
    ink.render({ ...world, meshes: [...meshes, ...wires(kit, document, highlights)] }, view);
  const images = [render(old.meshes, doc), render(old.meshes, doc, focus), render(after.meshes, preview.document)];
  const picture = R.grid(images.map(frame => R.upscale(frame, 2)), 3);

  fs.mkdirSync(dir, { recursive: true });
  const save = (name, value) => files.json(path.join(dir, name), value);
  save('scene.json', scene);
  save('repaired-scene.json', editor.snapshot());
  save('mesh.json', doc);
  save('repaired-mesh.json', preview.document);
  save('health-settings.json', healthSettings);
  save('health-before.json', beforeHealth);
  save('health-after-weld.json', joinedHealth);
  save('health-after.json', finalHealth);
  save('repair.json', request);
  save('report.json', repair.repair);
  save('correspondence.json', repair.topology.correspondence);
  PNG.write(path.join(dir, 'comparison.png'), picture.w, picture.h, picture.rgb);
}

if (require.main === module) run(process.argv[2] ?? 'output/mesh-health-repair');
