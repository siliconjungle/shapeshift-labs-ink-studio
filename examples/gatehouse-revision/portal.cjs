'use strict';

const { isDeepStrictEqual } = require('node:util');
const { document, readGlb } = require('../../cli/glb-file.js');
const PNG = require('../../cli/png.js');

const object = 'gatehouse-portal', part = 'stonework', assetId = 'saltgate/painted-portal';
const sign = 'tide-sign', stone = 'painted-masonry', tunnel = 'tunnel', bevel = 'rim-bevel';
const size = { width: 96, height: 64 };
const texel = (x, y) => [(x + .5) / size.width, (y + .5) / size.height];
const stable = fields => ({ extras: { inkStudio: fields } });

function atlas() {
  const { width, height } = size, pixels = new Uint8Array(width * height * 4);
  function put(x, y, rgb) { pixels.set([rgb >> 16, rgb >> 8 & 255, rgb & 255, 255], (y * width + x) * 4); }
  const sand = [0x997059, 0xb17c60, 0xb98164, 0xbc8967, 0xa87256, 0xc08b6f];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor((y - 16) / 8), column = Math.floor((x + (row % 2 ? 8 : 0)) / 16);
    const edge = (x + (row % 2 ? 8 : 0)) % 16, course = y % 8;
    let pigment = sand[(row * 13 + column * 3 + sand.length * 20) % sand.length];
    if (course === 7 || edge === 15) pigment = 0x85594e;
    else if (course === 0) pigment = 0xc99873;
    else if ((x * 11 + y * 7) % 31 === 0) pigment = 0xa4745d;
    if (y < 16 && x >= 48) pigment = y < 3 || y > 12 || x < 50 || x > 93 ? 0xab7959 : 0x284b51;
    put(x, y, pigment);
  }
  const letters = [
    ['111', '010', '010', '010', '010'], ['111', '010', '010', '010', '111'],
    ['110', '101', '101', '101', '110'], ['111', '100', '110', '100', '111']
  ];
  for (const [index, rows] of letters.entries()) for (const [y, row] of rows.entries())
    for (const [x, ink] of Array.from(row).entries()) if (ink === '1') {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
        put(57 + 8 * index + x * 2 + dx, 3 + y * 2 + dy, 0xffe1a2);
    }
  for (const x of [52, 91]) for (const y of [5, 10]) put(x, y, 0xcaa574);
  put(94, 63, 0xd19a72);
  put(95, 63, 0x795950);
  return { ...size, pixels };
}

function portal(widened) {
  const vertices = [], faces = [], points = new Map();
  function vertex(id, position) {
    vertices.push({ id, position });
    points.set(id, position);
    return id;
  }
  function face(id, material, ring, uv) {
    faces.push({ id, material, corners: ring.map(vertex => ({ id: id + '/' + vertex,
      vertex, uv: uv(points.get(vertex), vertex) })) });
  }

  const center = .56, radius = widened ? 1.10 : .82;
  const rim = ['left-foot', ...Array.from({ length: 13 }, (_, i) => 'arch-' + i), 'right-foot'];
  function aperture(width, rise) {
    return [[center - width, .15], ...Array.from({ length: 13 }, (_, i) => {
      const angle = Math.PI * (1 - i / 12);
      return [center + width * Math.cos(angle), 1.22 + rise * Math.sin(angle)];
    }), [center + width, .15]];
  }
  const open = aperture(radius, .72), mouth = widened ? aperture(radius + .14, .86) : open;
  const outside = [[-1.57, .15], [2.47, .15], [2.47, 2.75], [-1.57, 2.75]];
  const names = ['left-base', ...rim, 'right-base', 'right-top', 'left-top'];
  function ring(side, z, opening) {
    const rows = [outside[0], ...opening, ...outside.slice(1)];
    return rows.map(([x, y], i) => vertex(side + '/' + names[i], [x, y, z]));
  }
  const front = ring('front', .44, mouth), back = ring('back', -.36, open);
  const throat = widened ? open.map(([x, y], i) => vertex('throat/' + rim[i], [x, y, .30])) : front.slice(1, -3);
  const paint = ([x, y]) => texel(69 * (x + 1.57) / 4.04, 17 + 45 * (2.75 - y) / 2.6);
  const tunnelUV = () => texel(95, 63), bevelUV = () => texel(94, 63);
  face('painted-front', stone, front, paint);
  face('painted-back', stone, back.slice().reverse(), paint);
  for (let i = 0; i < front.length; i++) {
    const next = (i + 1) % front.length;
    if (i > 0 && i < rim.length) {
      face('passage/' + rim[i - 1], tunnel, [throat[i], throat[i - 1], back[i], back[next]], tunnelUV);
      if (widened) face('bevel/' + rim[i - 1], bevel, [front[next], front[i], throat[i - 1], throat[i]], bevelUV);
    } else {
      const wall = [front[next], front[i], back[i], back[next]];
      if (widened && i === 0) wall.push(throat[0]);
      if (widened && i === rim.length) wall.splice(2, 0, throat.at(-1));
      face('wall/' + names[i], tunnel, wall, tunnelUV);
    }
  }
  const signPoints = [[-.17, 2.54], [-.17, 2.19], [1.29, 2.19], [1.29, 2.54]];
  const signUV = [[48, 1], [48, 14], [95, 14], [95, 1]];
  const plaque = signPoints.map(([x, y], i) => vertex('plaque-' + i, [x, y, .465]));
  face(sign, sign, plaque, (_, id) => texel(...signUV[plaque.indexOf(id)]));
  return { id: 'painted-portal', vertices, faces };
}

function editPatch(before, revised) {
  const changed = key => {
    const previous = new Map(before[key].map(row => [row.id, row]));
    return revised[key].filter(row => !isDeepStrictEqual(row, previous.get(row.id)));
  };
  return { vertices: changed('vertices'), faces: changed('faces') };
}

function gltf(kit, topology, texture, revision) {
  const doc = document();
  const mesh = kit.meshTopology.triangulate(topology);
  const diffuse = doc.texture(PNG.encode(texture.width, texture.height, texture.pixels, 4), 'Gatehouse pigment atlas');
  doc.gltf.materials = mesh.materials.map(id => ({ name: id, ...stable({ materialId: id }),
    pbrMetallicRoughness: { baseColorTexture: { index: diffuse }, metallicFactor: 0, roughnessFactor: 1 } }));
  const POSITION = doc.accessor(Float32Array.from(mesh.positions), 'VEC3', { bounds: true, target: 34962 });
  const TEXCOORD_0 = doc.accessor(Float32Array.from(mesh.uvs), 'VEC2', { target: 34962 });
  const meshIndex = doc.add('meshes', { primitives: mesh.materials.map((_, material) => ({
    attributes: { POSITION, TEXCOORD_0 }, material,
    indices: doc.accessor(Uint16Array.from(mesh.faceMaterials.flatMap((slot, i) =>
      slot === material ? mesh.indices.slice(i * 3, i * 3 + 3) : [])), 'SCALAR', { target: 34963 })
  })) });
  const anchor = doc.add('nodes', { name: 'Sign registration', translation: [.56, 2.365, .465],
    ...stable({ socketId: 'sign-anchor' }) });
  doc.gltf.scenes[0].nodes = [doc.add('nodes', { name: 'Painted gate revision ' + revision,
    mesh: meshIndex, children: [anchor], ...stable({ partId: part }) })];
  const { gltf: source, bin } = readGlb(doc.finish());
  // Preserve the hard texel boundaries through import.
  source.samplers[0] = { ...source.samplers[0], magFilter: 9728, minFilter: 9728 };
  return kit.authoring.gltfAssets.create({ document: source, binary: bin }).withRevision({
    format: kit.authoring.assetRevisions.format, version: 1, asset: assetId, revision,
    parts: { [part]: { materials: mesh.materials, sockets: ['sign-anchor'] } }
  });
}

module.exports = { object, part, assetId, sign, stone, tunnel, bevel, atlas, portal, editPatch, gltf };
