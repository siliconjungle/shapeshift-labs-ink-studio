/* Revise one housing in an existing Ink scene with authored placement and bindings. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const { document, readGlb } = require('../cli/glb-file.js');
const PNG = require('../cli/png.js');
const { grid, upscale } = require('../cli/render.js');
const files = require('../cli/asset-files.js');
const { KIT } = studio.load();

const assetId = 'harbor/signal-relay';
const stable = fields => ({ extras: { inkStudio: fields } });

function pigment() {
  const width = 40, height = 30, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const edge = Math.min(x, width - 1 - x, y, height - 1 - y);
    const ring = Math.hypot(x - 16, (y - 21) * 1.12);
    let ink = y > 14 ? 0x4b7e7c : 0x518d88;
    if (edge < 2) ink = edge === 0 || x > 35 ? 0x213c4a : 0x84b0a3;
    if (x >= 5 && x <= 27 && y >= 6 && y <= 23) {
      ink = 0x182e3d;
      if (ring >= 7.5 && ring <= 10 && y < 20) ink = x < 16 ? 0x6eb4a8 : 0xecb56b;
      if (y >= 12 && y < 22 && Math.abs(x - 16 - (22 - y) / 1.8) < 1) ink = 0xf2d4a0;
    }
    if (x > 30 && x < 36 && y >= 10 && y <= 21) ink = y % 4 < 2 ? 0xe3ae6e : 0x213c4a;
    data.set([ink >> 16, ink >> 8 & 255, ink & 255, 255], (y * width + x) * 4);
  }
  return PNG.encode(width, height, data, 4);
}

function shell(id, outline, depth, faceMaterial, caseMaterial, detail) {
  const vertices = [depth, -depth].flatMap((z, side) => outline.map(([x, y], i) =>
    ({ id: side + '/' + i, position: [x, y, z] })));
  const polygon = (id, material, row, painted) => ({
    id, material, corners: row.map((vertex, i) => {
      const [x, y] = vertices[vertex].position;
      return { id: id + '/' + i, vertex: vertices[vertex].id,
        uv: painted ? [(x + 1.06) / 2.12, (1.7 - y) / 1.44] : [0, 0] };
    })
  });
  const n = outline.length, ring = outline.map((_, i) => i);
  return KIT.meshTopology.triangulate({ id, vertices, faces: [
    polygon('front', faceMaterial, ring, faceMaterial === 'enamel'),
    polygon('back', caseMaterial, ring.slice().reverse().map(i => n + i)),
    ...ring.map(i => {
      const j = (i + 1) % n;
      return polygon('wall/' + i, detail?.edge === i ? detail.material : caseMaterial, [j, i, i + n, j + n]);
    })
  ] });
}

function source(revision) {
  const changed = revision > 1, doc = document();
  const marker = (kind, id, translation) => ({ name: 'Revision ' + revision + ' ' + id, translation, ...stable({ [kind + 'Id']: id }) });
  const materialIds = changed ? ['casing', 'recess', 'enamel', 'battery'] : ['enamel', 'battery', 'casing'];
  const diffuse = doc.texture(pigment(), 'Relay dial');
  const colors = { enamel: [1, 1, 1, 1], casing: [.042, .092, .115, 1], battery: [.12, .14, .12, 1], recess: [.55, .29, .105, 1] };
  doc.gltf.materials = materialIds.map(id => ({ name: 'Finish ' + id + ' ' + revision, ...stable({ materialId: id }),
    pbrMetallicRoughness: { baseColorFactor: colors[id], ...(id === 'enamel' && { baseColorTexture: { index: diffuse } }) } }));

  const cover = shell('housing', [
    [-1.06, .27], [1.06, .27], [1.06, changed ? 1.13 : 1.40],
    ...(changed ? [[.57, 1.13]] : []), [changed ? .57 : .79, 1.69], [-.81, 1.69], [-1.06, 1.43]
  ], .28, 'enamel', 'casing', changed ? { edge: 3, material: 'recess' } : null);
  const battery = shell('power-pack', [[-.28, .25], [.28, .25], [.28, 1.15], [.19, 1.24], [-.19, 1.24], [-.28, 1.15]],
    .23, 'battery', 'battery');
  function bake(geometry) {
    const position = doc.accessor(Float32Array.from(geometry.positions), 'VEC3', { bounds: true, target: 34962 });
    const uv = doc.accessor(Float32Array.from(geometry.uvs), 'VEC2', { target: 34962 });
    return { primitives: geometry.materials.map((name, i) => {
      const rows = geometry.faceMaterials.flatMap((slot, j) => slot === i ? geometry.indices.slice(j * 3, j * 3 + 3) : []);
      return { attributes: { POSITION: position, TEXCOORD_0: uv },
        indices: doc.accessor(Uint16Array.from(rows), 'SCALAR', { target: 34963 }), material: materialIds.indexOf(name) };
    }) };
  }
  const housing = doc.add('meshes', bake(cover)), pack = doc.add('meshes', bake(battery));
  const lamp = marker('socket', 'lamp-mount', [changed ? .57 : .79, 1.58, .28]);
  const hinge = marker('bone', 'hinge-axis', [-.85, .47, 0]);
  const markers = changed ? [hinge, lamp] : [lamp, hinge, marker('socket', 'test-port', [.92, .5, .28])];
  const children = markers.map(row => doc.add('nodes', row));
  const coverNode = doc.add('nodes', { name: 'Housing ' + revision, mesh: housing, children, ...stable({ partId: 'housing' }) });
  const batteryNode = doc.add('nodes', { name: 'Power pack ' + revision, mesh: pack, ...stable({ partId: 'power-pack' }) });
  doc.gltf.scenes[0].nodes = changed ? [batteryNode, coverNode] : [coverNode, batteryNode];
  const { gltf, bin } = readGlb(doc.finish());
  const manifest = { format: KIT.authoring.assetRevisions.format, version: 1, asset: assetId, revision, parts: {
    housing: { materials: changed ? ['enamel', 'casing', 'recess'] : ['enamel', 'casing'],
      sockets: changed ? ['lamp-mount'] : ['lamp-mount', 'test-port'], bones: ['hinge-axis'] },
    'power-pack': { materials: ['battery'] }
  } };
  return KIT.authoring.gltfAssets.create({ document: gltf, binary: bin }).withRevision(manifest);
}

function scene() {
  return {
    id: 'relay-workbench', name: 'Relay workbench', style: 'slate',
    camera: { target: [.04, .91, 0], dist: 3.75, yaw: .30, pitch: .15, sway: 0 },
    light: { sun: [-.5, .75, .43] },
    solids: [
      { id: 'bench', kind: 'box', at: [.06, .04, -.05], half: [1.62, .14, .63], res: .055, mat: 'stone' },
      { id: 'bench-riser', kind: 'box', at: [-.32, .21, 0], half: [.6, .08, .36], res: .045, mat: 'metal' }
    ],
    assetParts: {
      relay: { file: 'relay-v1.glb', asset: assetId, revision: 1, part: 'housing', transform: { position: [-.26, 0, 0] },
        bindings: {
          paint: { kind: 'material', target: 'enamel' },
          lamp: { kind: 'socket', target: 'lamp-mount' },
          hinge: { kind: 'bone', target: 'hinge-axis' },
          probe: { kind: 'socket', target: 'test-port', required: false }
        } },
      battery: { file: 'relay-v1.glb', asset: assetId, revision: 1, part: 'power-pack', transform: { position: [1.24, 0, -.07] } }
    }
  };
}

function main(directory) {
  const file = name => path.resolve(directory, name);
  const cli = (...args) => execFileSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), ...args], { encoding: 'utf8' });
  studio.writeGltfAsset(source(1), { out: file('relay-v1.glb') });
  studio.writeGltfAsset(source(2), { out: file('relay-v2.gltf') });
  files.json(file('before.json'), scene());
  const args = [file('before.json'), 'relay', file('relay-v2.gltf'), '--expect', '1'];
  cli('asset-part', 'preview', ...args, '--out', file('preview.json'));
  cli('asset-part', 'replace', ...args, '--out', file('after.json'));
  const frames = ['before', 'after'].map(tag => {
    cli('render', file(tag + '.json'), '--out', file(tag + '.png'), '--raw', '--ortho', '--w', '176', '--h', '124', '--px', '1');
    return upscale(PNG.read(file(tag + '.png')), 2);
  });
  const comparison = grid(frames, 2);
  PNG.write(file('comparison.png'), comparison.w, comparison.h, comparison.rgb);
}

if (require.main === module) main(process.argv[2] ?? 'asset-part-review');
module.exports = { source, scene };
