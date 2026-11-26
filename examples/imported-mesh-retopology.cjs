const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const kit = require('..').load();
const { KIT: K, makeBuilder } = kit, T = K.meshTopology;
const GLB = require('../cli/glb-file.js');
const PNG = require('../cli/png.js');
const R = require('../cli/render.js');
const Camera = require('../src/camera-lens.js');
const Composite = require('../src/frame-composite.js');

const directory = path.resolve(process.argv[2] ?? 'twinfin-review');
fs.mkdirSync(directory);
const file = name => path.join(directory, name);
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name)));
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const run = (action, ...args) => execFileSync(process.execPath, [cli, 'mesh-topology', action, ...args], { stdio: 'pipe' });

const width = 80, height = 64, indices = [], protectedMark = [];
const palette = [0x122934, 0x205465, 0x397c86, 0x69a5a0, 0x91c4b3, 0x352f38, 0x93704d, 0xd6a569, 0xf4dc9c];
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const span = Math.abs(x - 39.5), edge = Math.min(x, y, 79 - x, 63 - y);
  const stripe = Math.abs(span - (.48 * y + 3)), mark = Math.abs(span - 3) + Math.abs(y - 28) < 6;
  let n = x % 11 === 0 || (x + 7 * y) % 37 === 0 ? 3 : 2;
  if (edge < 6) n = [5, 6, 7, 8, 6, 5][edge];
  else if (stripe < 2.5 || span < 1) n = stripe < 1 || span < 1 ? 8 : 6;
  else if (stripe < 7) n = 1;
  if (mark) n = 8;
  indices.push(n);
  protectedMark.push(mark ? 255 : 0);
}
PNG.writeIndexed(file('pigment.png'), width, height, indices, palette.map(rgb => [rgb >> 16, rgb >> 8 & 255, rgb & 255]));
fs.writeFileSync(file('protected-mark.png'), PNG.encodeGray(width, height, Uint8Array.from(protectedMark)));

const positions = [], uvs = [], joint = [], weights = [], triangles = [];
const shape = [-1, -.66, -.33, 0, .33, .66, 1], widths = [.67, 1.12, 1.42, 1.30, .99, .67];
const rows = [-1, -.77, -.36, .10, .60, .92];
const vertex = (i, j) => j * shape.length + i;
for (const [j, y] of rows.entries()) for (const [i, at] of shape.entries()) {
  positions.push(at * widths[j], y, .33 * (1 - at * at) - .08 * y * y);
  uvs.push(i / (shape.length - 1), 1 - j / (rows.length - 1));
  const hinge = Math.abs(at) * .5;
  joint.push(0, 1, 0, 0);
  weights.push(1 - hinge, hinge, 0, 0);
}
for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < shape.length - 1; i++) {
  const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i + 1, j + 1), d = vertex(i, j + 1);
  triangles.push(...(i < 3 ? [a, b, c, a, c, d] : [a, b, d, b, c, d]));
}
const duplicate = positions.length / 3;
positions.push(...positions.slice(0, 3));
uvs.push(...uvs.slice(0, 2));
joint.push(...joint.slice(0, 4));
weights.push(...weights.slice(0, 4));
triangles[0] = duplicate;
triangles.push(...triangles.slice(0, 3), 1, 1, 2);
[triangles[12], triangles[14]] = [triangles[14], triangles[12]];

const source = GLB.document(), { gltf } = source;
const texture = source.texture(fs.readFileSync(file('pigment.png')), 'Twinfin enamel');
const material = source.add('materials', { name: 'enamel', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: texture } } });
const attribute = (array, type) => source.accessor(Float32Array.from(array), type, { target: 34962 });
gltf.meshes = [{ primitives: [{ material, attributes: { POSITION: attribute(positions, 'VEC3'), TEXCOORD_0: attribute(uvs, 'VEC2'),
  JOINTS_0: source.accessor(Uint16Array.from(joint), 'VEC4', { target: 34962 }), WEIGHTS_0: attribute(weights, 'VEC4') },
indices: source.accessor(Uint16Array.from(triangles), 'SCALAR', { target: 34963 }) }] }];
gltf.nodes = [{ mesh: 0, skin: 0 }, { name: 'hilt', children: [2] }, { name: 'fin' }];
gltf.skins = [{ joints: [1, 2], skeleton: 1 }];
gltf.scenes[0].nodes = [0, 1];
fs.writeFileSync(file('twinfin.glb'), source.finish());

const settings = { symmetry: { axis: 'x', tolerance: .000001 }, featureAngle: 32,
  protected: { edges: rows.slice(1).map((_, j) => [vertex(3, j), vertex(3, j + 1)]), faces: [0] },
  materials: [{ id: 'enamel', masks: { engraving: protectedMark } }] };
save('repair-settings.json', settings);
run('remesh-import', file('twinfin.glb'), file('repair-settings.json'), '--out', file('preflight'));
const repaired = read('preflight/repaired.json'), preview = read('preflight/report.json');
assert(preview.quads >= 20);
const pair = preview.pairs.find(row => row.mirror && row.mirror !== row.to);
const removed = pair.from.find(id => id !== pair.to);
const anchor = T.triangulate(repaired).triangleSources.find(row => row.face === removed);
const manifest = T.attachments.create(repaired, [{ id: 'lamp', kind: 'socket', node: 'guard', socket: 'lamp',
  anchor: { ...anchor, weights: [.18, .31, .51] }, offset: [0, 0, .045] }]);
const pose = { hilt: [...K.M.id(), 0, 0, 0], fin: [...K.M.rot([0, 1, 0], .23), 0, .03, .045] };
save('remesh-settings.json', { ...settings, transfer: { attachments: manifest, poses: [{ id: 'flex', matrices: pose }],
  maxRestError: .000001, maxPoseError: .000001, maxWeightError: .000001 } });
run('remesh-import', file('twinfin.glb'), file('remesh-settings.json'), '--out', file('result'));
const result = read('result/mesh.json'), report = read('result/report.json'), materials = read('result/materials.json');
const binding = read('result/attachments.json'), enamel = materials.find(row => row.id === 'enamel');
assert.deepEqual(enamel.texture.indices, indices);
assert.deepEqual(enamel.texture.palette, palette);
assert.deepEqual(enamel.masks.engraving, protectedMark);
assert.deepEqual(repaired.vertices, result.vertices);
assert.equal(report.preservation.attachments.attachments[0].before.face, removed);
assert.notEqual(binding.attachments[0].anchor.face, removed);
assert(report.preservation.attachments.maxPoseError < .000001);

const regular = result.faces.find(row => row.corners.length === 4 && row.corners.every(corner => {
  const i = +corner.vertex.split('/')[1], column = i % shape.length;
  return column > 0 && column < shape.length - 1 && i >= shape.length && i < (rows.length - 1) * shape.length;
}));
save('limit-samples.json', { samples: [{ face: regular.id, uv: [.37, .52] }] });
run('limit-surface', file('result/mesh.json'), file('limit-samples.json'), '--out', file('limit-surface.json'));
assert(read('limit-surface.json').converged);

const view = { target: [0, 0, .10], dist: 5.6, yaw: -.23, pitch: .14, ortho: true, fov: .56 };
const nativeMaterials = materials.map(row => ({ ...row,
  ...(row.texture && { texture: { ...row.texture, indices: Uint8Array.from(row.texture.indices),
    coverage: Uint8Array.from(row.texture.coverage) } }),
  ...(row.masks && { masks: Object.fromEntries(Object.entries(row.masks).map(([name, data]) => [name, Uint8Array.from(data)])) }) }));
function shot(document, manifest, matrices, wire) {
  const mesh = T.toSceneMesh(document, { materials: nativeMaterials }), builder = makeBuilder(3, [0x122530, 0xf5db9b]);
  if (matrices) {
    T.skin.bind(mesh).pose(matrices);
    const frame = T.attachments.bind(mesh, manifest).frame('lamp');
    builder.disc(...frame.position, frame.normal, .075, .012, builder.P[1], 2.6);
  }
  const world = builder.finish({ meshes: [mesh], cam: view, radius: 6, dither: 0 });
  let lens;
  const frame = R.render(world, { w: 232, h: 172, px: 1, raw: true, edges: false, lockCamera: true,
    ...R.cameraCapture(null, (raster, sample) => { lens = { ...raster, focal: sample.focal }; }) });
  if (!wire) return frame;
  const { eye, right, up } = Camera.fromView(lens.view);
  const points = new Map(document.vertices.map(row => {
    const delta = K.V.sub(row.position, eye);
    return [row.id, [frame.w / 2 + K.V.dot(right, delta) * lens.focal, frame.h / 2 - K.V.dot(up, delta) * lens.focal]];
  }));
  for (const edge of document.edges) {
    const [a, b] = edge.vertices.map(id => points.get(id));
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    const color = edge.vertices.every(id => +id.split('/')[1] % shape.length === 3) ? [255, 226, 156] : [94, 168, 166];
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(a[0] + (b[0] - a[0]) * i / Math.max(1, steps));
      const y = Math.round(a[1] + (b[1] - a[1]) * i / Math.max(1, steps));
      if (x >= 0 && x < frame.w && y >= 0 && y < frame.h) frame.rgb.set(color, (y * frame.w + x) * 3);
    }
  }
  return frame;
}
const images = [shot(repaired, manifest, null, true), shot(result, binding, null, true), shot(result, binding, pose, false)];
const base = R.grid(images, 3), { w, h } = base;
const draw = ['REPAIRED TRIANGLES', report.quads + ' RETAINED QUADS', 'POSED SOCKET'].map((text, i) =>
  ({ type: 'text', text, at: [(i + .5) * images[0].w, 19], size: 11, color: '#f5daa4' }));
const layer = K.frameComposite.prepare({ layers: [{ draw }] }, w, h, 1);
const sheet = Composite.compose(base, K.frameComposite.layers(layer, {}, 0), w, h, 'nearest');
PNG.write(file('twinfin-comparison.png'), sheet.w, sheet.h, sheet.rgb);
console.log(report.quads + ' quads, ' + report.triangles + ' retained triangles, exact pigment and weights, socket pose error ' +
  report.preservation.attachments.maxPoseError);
