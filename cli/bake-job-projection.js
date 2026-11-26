const fs = require('node:fs');
const path = require('node:path');
const Meshes = require('./bake-job-mesh.js');
const Cage = require('./material-cage.js');
const PNG = require('./png.js');
const { tileKey } = require('./material-preview-geometry.js');

const maps = Cage.masks.filter(name => name !== 'cage-cross-part');
const channels = ['pigment', 'normal', 'roughness', 'metallic', 'emission', 'opacity'];

function sceneLibrary(plan, receiver, directory, onInput) {
  const loaded = new Map([[plan.source, receiver]]);
  function get(id) {
    if (id === '$receiver') return receiver;
    const filename = plan.sources.get(id);
    if (!loaded.has(filename)) {
      onInput(filename);
      loaded.set(filename, Meshes.load(filename, path.join(directory, id), onInput));
    }
    return loaded.get(filename);
  }
  return { get, describe: () => ({
    sources: ['$receiver', ...plan.sources.keys()].map(id => ({ id, meshes: Meshes.catalog(get(id)) })),
    skewMaps: [...plan.skewMaps.keys()]
  }) };
}

function stem(name, suffix) {
  if (!suffix) return name;
  if (name.endsWith(suffix) && name.length > suffix.length) return name.slice(0, -suffix.length);
}

function matching(model, options, receiver) {
  if (options.match === 'selection') return [Meshes.chooseMesh(model, options.mesh, 'high source')];
  if (options.match === 'all') {
    const active = [...new Set(model.nodes.map(node => node.mesh).filter(index => index !== null))];
    return active.length ? active : model.meshes.map((_, index) => index);
  }
  const key = stem(receiver, options.lowSuffix);
  const found = model.meshes.flatMap(({ name }, i) => key !== undefined && stem(name, options.highSuffix) === key ? [i] : []);
  if (!found.length) throw new RangeError('No high mesh matches ' + receiver + ' with the selected suffixes');
  return found;
}

function highGeometry(model, indices, K, images) {
  const points = [], faces = [], cornerNormals = [], samplers = [];
  const placements = indices.flatMap(index => {
    const nodes = model.nodes.filter(node => node.mesh === index);
    return nodes.length ? nodes.map(node => [index, node]) : [[index, undefined]];
  });
  for (const [index, node] of placements) {
    const asset = Meshes.sceneMesh(model, index, K, node);
    const shape = Meshes.surfaces(model, asset, asset.parts.map(() => true), K, images);
    if (faces.length + shape.faces.length > 250000) throw new RangeError('High sources exceed 250,000 projected triangles');
    const at = points.length;
    for (const point of shape.points) points.push(point);
    for (const [i, face] of shape.faces.entries()) {
      const row = shape.metadata[i], material = model.materials[asset.parts[row.i].material];
      faces.push(face.map(k => k + at));
      cornerNormals.push(row.normals);
      samplers.push((point, normal) => {
        const value = row.sample(point, normal);
        return material?.alphaMode === 'MASK' && value.opacity < material.cutoff ? null : value;
      });
    }
  }
  return { points, faces, cornerNormals, alphaHoles: true, sampleSurface: (p, n, face) => samplers[face](p, n) };
}

function cages(model, receives, selector, K) {
  const mesh = selector ?? (model.meshes.length === 1 ? 0 : receives.mesh);
  const index = Meshes.chooseMesh(model, mesh, 'explicit cage');
  const asset = Meshes.sceneMesh(model, index, K);
  for (const [i, low] of receives.asset.parts.entries()) {
    if (!receives.selected[i]) continue;
    const part = asset.parts[i];
    if (!part || part.position.length !== low.position.length || part.indices.length !== low.indices.length ||
        part.indices.some((value, j) => value !== low.indices[j]))
      throw new RangeError('Cage requires the same vertex order and triangle indices as low submesh ' + i);
  }
  const {V} = K;
  let extent = 0;
  const corners = receives.metadata.map(row => {
    if (!row.selected) return null;
    const points = row.vertices.map(i => asset.parts[row.i].position.slice(3 * i, 3 * i + 3));
    for (const [i, p] of points.entries()) {
      const offset = V.sub(p, row.points[i]);
      if (V.dot(offset, row.normal) <= 1e-7) throw new RangeError('Explicit cage must lie outside its low surface');
      extent = Math.max(extent, V.len(offset));
    }
    return points;
  });
  if (!(extent > 0)) throw new RangeError('Explicit cage has no reach');
  return { corners, extent, mesh: asset.name };
}

function average(metadata, { V }) {
  const sums = new Map(), key = p => p.join(',');
  for (const row of metadata) {
    if (!row.selected) continue;
    for (const p of row.points) {
      const id = key(p);
      sums.set(id, V.add(sums.get(id) ?? [0, 0, 0], row.cross));
    }
  }
  return metadata.map(row => row.selected && row.points.map(p => V.norm(sums.get(key(p)), row.normal)));
}

function readSkew(value, tile, textures, onInput) {
  const filename = typeof value === 'string' ? value : value.get(tileKey(tile.tile));
  if (!filename) throw new RangeError('Missing skew PNG for tile ' + tile.label);
  if (!textures.has(filename)) {
    onInput(filename);
    const bytes = fs.readFileSync(filename), { w, h } = PNG.layout(bytes);
    if (w * h > 4e6) throw new RangeError('Skew map exceeds four million texels');
    const { data, max } = PNG.raster(bytes);
    const lane = (x, y) => data[(y * w + x) * 4] / max;
    const address = (u, n) => Math.max(0, Math.min(n - 1, u * n - .5));
    textures.set(filename, (u, v) => {
      const x = address(u, w), y = address(v, h), a = Math.floor(x), b = Math.floor(y);
      const fx = x - a, fy = y - b, right = Math.min(a + 1, w - 1), bottom = Math.min(b + 1, h - 1);
      return (lane(a, b) * (1 - fx) + lane(right, b) * fx) * (1 - fy) +
        (lane(a, bottom) * (1 - fx) + lane(right, bottom) * fx) * fy;
    });
  }
  return textures.get(filename);
}

function prepare(options, receiver, library, plan, K, images, onInput) {
  const { V } = K, self = !options || options.mode === 'self';
  const settings = { parts: new Map(), direction: options?.normals ?? 'authored', minFacing: 1e-8,
    partPolicy: 'allow', channels, maxWork: 24000000 };
  if (self) {
    const caster = { cast: (point, normal) => ({ point, normal, offset: 0, material: {} }) };
    return (tile) => {
      const {sample, maskNames, report} = Cage.prepare({ ...settings, direction: 'geometric', source: { kind: 'self' },
        caster, front: 1, back: 0 }, { ...tile.mesh, faces: receiver.faces }, null, K);
      return {sample, maskNames, report: () => ({ ...report(), mode: 'self', front: 0, distanceScale: null })};
    };
  }

  const model = library.get(options.high), indices = matching(model, options, receiver.mesh);
  const source = { kind: 'mesh', model: highGeometry(model, indices, K, images) };
  const explicit = options.cage && cages(library.get(options.cage.source), receiver, options.cage.mesh, K);
  const normals = !explicit && (options.normals === 'average' || options.skew) && average(receiver.metadata, K);
  let scale = 1;
  if (options.units === 'bounds') {
    const box = K.procedural.spatial.boxOf(receiver.metadata.filter(row => row.selected).flatMap(row => row.points));
    scale = Math.max(...V.sub(box.max, box.min));
    if (!(scale > 0)) throw new RangeError('Bounds-relative projection needs a low mesh with extent');
  }
  const front = explicit?.extent ?? options.front * scale, back = explicit ? 0 : options.back * scale;
  const textures = new Map();
  function fromCorners(corners, weights) {
    return weights.reduce((sum, weight, i) => V.mad(sum, corners[i], weight), [0, 0, 0]);
  }
  return (tile, size) => {
    const skew = options.skew && readSkew(plan.skewMaps.get(options.skew), tile, textures, onInput);
    function buildRay(point, smooth, geometric, face, pixel) {
      const row = receiver.metadata[face];
      if (explicit) {
        const delta = V.sub(fromCorners(explicit.corners[face], row.weights(point)), point);
        const distance = V.len(delta);
        return { axis: V.mul(delta, 1 / distance), front: distance, back: 0 };
      }
      if (normals) {
        const average = V.norm(fromCorners(normals[face], row.weights(point)), geometric);
        if (skew) {
          const value = skew((pixel[0] + .5) / size, (pixel[1] + .5) / size);
          return { axis: V.norm(V.lerp(average, smooth, options.invertSkew ? 1 - value : value), geometric) };
        }
        return { axis: average };
      }
      return { axis: options.normals === 'face' ? geometric : smooth };
    }
    const { sample, maskNames, report } = Cage.prepare({ ...settings, source, front, back, buildRay,
      backfaces: options.backfaces }, { ...tile.mesh, faces: receiver.faces }, null, K);
    return { sample, maskNames, report: () => ({ ...report(), mode: 'project', high: options.high,
      highMeshes: indices.map(i => model.meshes[i].name), match: options.match, units: explicit ? 'cage' : options.units,
      ...(explicit && { cageMesh: explicit.mesh }), ...(options.skew && { skew: options.skew, invertSkew: options.invertSkew }) }) };
  };
}

module.exports = { maps, sceneLibrary, prepare };
