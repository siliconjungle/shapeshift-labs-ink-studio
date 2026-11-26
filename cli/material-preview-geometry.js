const fs = require('node:fs');
const path = require('node:path');
const UV = require('../src/material-uv.js');

const clamp = value => Math.max(0, Math.min(1, value));
const epsilon = 1e-8;
const slice = (stream, offset, count) => Array.from(stream.slice(offset, offset + count));

function primitives(kind, slot, grid) {
  const points = [], normals = [], faces = [];
  const corner = (p, uv, n) => {
    points.push(p);
    normals.push(n);
    return { point: points.length - 1, uv: uv.map((value, i) => value * grid[i]) };
  };
  function quad(corners, normal) {
    const rows = corners.map((p, i) => corner(p, [[0, 1], [1, 1], [1, 0], [0, 0]][i], normal));
    faces.push({ slot, corners: rows.slice(0, 3) }, { slot, corners: [rows[0], rows[2], rows[3]] });
  }
  if (kind === 'plane') quad([[-1, -.72, 0], [1, -.72, 0], [1, .72, 0], [-1, .72, 0]], [0, 0, 1]);
  if (kind === 'cube') {
    for (const [normal, right] of [
      [[0, 0, 1], [1, 0, 0]], [[1, 0, 0], [0, 0, -1]], [[0, 0, -1], [-1, 0, 0]],
      [[-1, 0, 0], [0, 0, 1]], [[0, 1, 0], [1, 0, 0]], [[0, -1, 0], [1, 0, 0]]
    ]) {
      const up = [normal[1] * right[2] - normal[2] * right[1], normal[2] * right[0] - normal[0] * right[2],
        normal[0] * right[1] - normal[1] * right[0]];
      quad([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) =>
        normal.map((n, i) => n + right[i] * x + up[i] * y)), normal);
    }
  }
  if (kind === 'sphere') {
    const across = 40, down = 24, rows = [];
    for (let y = 0; y <= down; y++) {
      const pitch = y / down * Math.PI;
      const row = [];
      for (let x = 0; x <= across; x++) {
        const yaw = (x / across - .5) * Math.PI * 2;
        const normal = [Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), Math.sin(pitch) * Math.cos(yaw)];
        row.push(corner(normal, [x / across, y / down], normal));
      }
      rows.push(row);
    }
    for (let y = 0; y < down; y++) for (let x = 0; x < across; x++) {
      const a = rows[y][x], b = rows[y][x + 1], c = rows[y + 1][x + 1], d = rows[y + 1][x];
      if (y + 1 < down) faces.push({ slot, corners: [a, d, c] });
      if (y > 0) faces.push({ slot, corners: [a, c, b] });
    }
  }
  return { points, normals, faces };
}

function indexed(positions, normals, indices, slotAt, uvAt, normalAt) {
  const point = i => slice(positions, 3 * i, 3);
  const points = Array.from({ length: positions.length / 3 }, (_, i) => point(i));
  const directions = normals && points.map((_, i) => slice(normals, 3 * i, 3));
  const faces = [];
  for (let f = 0; f < indices.length / 3; f++) {
    const uv = uvAt(f);
    if (!uv) throw new RangeError('Preview face ' + (f + 1) + ' has no UVs in the selected layout');
    const cornerNormals = normalAt?.(f);
    faces.push({ slot: slotAt(f), corners: slice(indices, 3 * f, 3).map((point, i) => ({
      point, uv: uv[i], ...(cornerNormals && { n: cornerNormals[i] })
    })) });
  }
  return { points, normals: directions, faces };
}

function inkAsset(file, set, { KIT }) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value?.format === 'ink-studio/mesh-topology') {
    const geometry = KIT.meshTopology.triangulate(value);
    const uvs = (set ?? UV.resolve(geometry.uvBindings, 'pigment')) || 0;
    const source = uvs ? geometry.uvSets?.[uvs] : geometry.uvs;
    if (!source) throw new RangeError('Ink mesh has no UV set ' + uvs);
    // The retained UV editor exposes the presence of alternate coordinates per corner.
    const alternate = uvs && new Map(value.faces.flatMap(face => face.corners.map(corner => [corner.id, corner.attributes?.[UV.key(uvs)]])));
    return indexed(geometry.positions, geometry.normals, geometry.indices, f => geometry.materials[geometry.faceMaterials[f]],
      f => {
        if (alternate && geometry.triangleSources[f].corners.some(id => !alternate.get(id))) return;
        return slice(geometry.indices, f * 3, 3).map(i => slice(source, i * 2, 2));
      });
  }
  const asset = KIT.authoring.assetMeshes.validate(value);
  if ((set ?? 0) !== 0 || !asset.texture) throw new RangeError('An Ink triangle asset needs a UV texture carrier on set 0');
  const { positions, triangles, texture } = asset;
  return indexed(positions, undefined, triangles, f => 'material-' + (texture.faces[f] + 1),
    f => slice(triangles, f * 3, 3).map(i => slice(texture.uv, i * 2, 2)));
}

function load(target, toolkit, onFile) {
  const { kind, slot, uvGrid, file, uvSet } = target;
  if (!file) return primitives(kind, slot, uvGrid);
  onFile(file);
  if (kind === 'ink' && path.extname(file).toLowerCase() === '.json') return inkAsset(file, uvSet, toolkit);
  const extension = path.extname(file).toLowerCase();
  const ink = require('../index.js');
  if (kind === 'ink' && extension !== '.glb') throw new TypeError('An Ink preview asset needs .json topology, triangle asset, or Ink GLB');
  if (extension === '.obj' && uvSet > 0) throw new RangeError('OBJ has only UV set 0');
  // The importer exposes per-face UVs, including negative or multi-tile coordinates.
  let mesh, directions;
  if (extension === '.gltf' || extension === '.glb') {
    const asset = ink.readGltfAsset(file, { onFile });
    const { document, binary } = asset.snapshot();
    if (kind === 'ink' && !Object.keys(document.asset?.extras ?? {}).some(key => key.startsWith('inkStudio')))
      throw new TypeError('The specified GLB has no Ink asset metadata');
    const normals = [], { V } = toolkit.KIT;
    mesh = toolkit.KIT.mesh.gltf(document, [binary], {
      attributes: true, uvSet: uvSet ?? 0, allUVSets: uvSet === undefined,
      visitPrimitive(primitive, { firstVertex, vertexCount, accessor, matrix }) {
        const selected = primitive.attributes.NORMAL;
        if (selected === undefined) return;
        const stream = accessor(selected);
        if (stream.n !== vertexCount || stream.w !== 3) throw new RangeError('Invalid glTF normal stream');
        const [a, b, c] = [0, 4, 8].map(i => matrix.slice(i, i + 3));
        const dual = [V.cross(b, c), V.cross(c, a), V.cross(a, b)];
        const det = V.dot(a, dual[0]);
        if (Math.abs(det) < 1e-10) return;
        for (let vertex = 0; vertex < vertexCount; vertex++)
          normals[firstVertex + vertex] = V.norm([0, 1, 2].map(k => dual.reduce(
            (sum, axis, channel) => sum + axis[k] * stream.get(vertex, channel) / det, 0)));
      }
    });
    if (normals.length) directions = Array.from({ length: mesh.pos.length / 3 }, (_, i) => normals[i] ?? [0, 0, 0]).flat();
  } else if (extension === '.obj') mesh = toolkit.KIT.mesh.obj(fs.readFileSync(file, 'utf8'), undefined, { attributes: true });
  else throw new TypeError('Imported material preview meshes need OBJ, glTF, or GLB');
  const layout = uvSet === undefined && UV.resolve(mesh.uvBindings, 'pigment');
  const uvs = layout ? mesh.uvSets?.[layout] : mesh.uvs ?? mesh.uvFaces;
  if (!uvs) throw new RangeError('Preview carrier needs triangles with a UV layout');
  const flipV = extension === '.obj', used = new Set();
  const names = mesh.mats.map(({ name }, index) => {
    const base = name || 'material-' + index;
    let label = base, copy = 2;
    while (used.has(label)) label = base + ' [' + copy++ + ']';
    used.add(label);
    return label;
  });
  return { ...indexed(mesh.pos, directions, mesh.tri, f => names[mesh.tmat[f]] ?? 'default',
    f => flipV ? uvs[f]?.map(([u, v]) => [u, 1 - v]) : uvs[f],
    mesh.cornerNormals && (f => mesh.cornerNormals[f])), flipV };
}

function clip(polygon, axis, edge, side) {
  const output = [];
  for (let i = 0; i < polygon.length; i++) {
    const left = polygon[i], right = polygon[(i + 1) % polygon.length];
    const a = (left.uv[axis] - edge) * side, b = (right.uv[axis] - edge) * side;
    if (a >= 0) output.push(left);
    if (a * b < 0) {
      const t = a / (a - b);
      const mix = (x, y) => x.map((n, k) => n + t * (y[k] - n));
      const uv = mix(left.uv, right.uv);
      uv[axis] = edge;
      output.push({ uv, p: mix(left.p, right.p), ...(left.n && { n: mix(left.n, right.n) }) });
    }
  }
  return output;
}

const tileKey = uv => uv.join(',');
const tileLabel = ([x, y]) => x >= 0 && x < 10 && y >= 0 && y <= 99 ? String(1001 + x + 10 * y) : '[' + x + ', ' + y + ']';

function split({ points, normals: authoredNormals, faces, flipV }, K) {
  if (!faces.length || faces.length > 60000 || points.length > 180000 ||
      !points.every(p => p.length === 3 && p.every(n => Number.isFinite(n) && Math.abs(n) < 1e7)))
    throw new RangeError('Preview carrier needs bounded coordinates and 1–60,000 triangles');
  const box = K.procedural.spatial.boxOf(points), center = K.V.lerp(box.min, box.max, .5);
  const size = Math.max(...K.V.sub(box.max, box.min));
  if (!(size > 0)) throw new RangeError('Preview carrier has no volume or surface extent');
  const positions = [], normals = [], uvs = [], indices = [], faceMaterials = [], regions = new Map();
  const hasNormals = authoredNormals || faces.some(face => face.corners.some(row => row.n));
  for (const { slot, corners } of faces) {
    if (typeof slot !== 'string' || !slot.trim() || slot.length > 100 || /[\x00-\x1f]/.test(slot) ||
        corners.some(({ uv }) => uv?.length !== 2 || !uv.every(n => Number.isFinite(n) && Math.abs(n) <= 1000)))
      throw new TypeError('Preview faces need valid slot names and finite UV pairs');
    const triangle = corners.map(({ point, uv, n }) => ({
      uv, p: K.V.mul(K.V.sub(points[point], center), 2 / size), n: n ?? authoredNormals?.[point]
    }));
    if (hasNormals) {
      const [a, b, c] = triangle.map(row => row.p);
      const faceNormal = K.V.norm(K.V.cross(K.V.sub(b, a), K.V.sub(c, a)));
      for (const point of triangle) if (!point.n?.some(Boolean)) point.n = faceNormal;
    }
    const min = [0, 1].map(c => Math.floor(Math.min(...triangle.map(p => p.uv[c]))));
    const max = [0, 1].map(c => Math.max(min[c], Math.ceil(Math.max(...triangle.map(p => p.uv[c]))) - 1));
    if ((max[0] - min[0] + 1) * (max[1] - min[1] + 1) > 64) throw new RangeError('One preview face crosses more than 64 UV tiles');
    for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) {
      let polygon = clip(clip(triangle, 0, x, 1), 0, x + 1, -1);
      polygon = clip(clip(polygon, 1, y, 1), 1, y + 1, -1);
      if (polygon.length < 3) continue;
      const uv = [x, y], key = slot + '\0' + tileKey(uv);
      for (let j = 1; j + 1 < polygon.length; j++) {
        const corners = [polygon[0], polygon[j], polygon[j + 1]];
        const [a, b, c] = corners.map(row => row.p);
        if (K.V.len(K.V.cross(K.V.sub(b, a), K.V.sub(c, a))) < epsilon) continue;
        if (!regions.has(key)) {
          if (regions.size === 64) throw new RangeError('A preview carrier supports up to 64 visible slot / tile combinations');
          regions.set(key, { slot, uv, tile: tileLabel(uv), index: regions.size });
        }
        const region = regions.get(key);
        for (const corner of corners) {
          indices.push(positions.length / 3);
          positions.push(...corner.p);
          uvs.push(clamp(corner.uv[0] - x), clamp(flipV ? y + 1 - corner.uv[1] : corner.uv[1] - y));
          if (hasNormals) normals.push(...corner.n);
        }
        faceMaterials.push(region.index);
        if (faceMaterials.length > 100000) throw new RangeError('Tile clipping exceeds the preview triangle budget');
      }
    }
  }
  if (!indices.length) throw new RangeError('The preview carrier has no rendered triangles');
  return { geometry: { positions, ...(hasNormals && { normals }), uvs, indices, faceMaterials },
    regions: [...regions.values()] };
}

module.exports = { load, split, clip, tileKey, tileLabel };
