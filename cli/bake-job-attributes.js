const PNG = require('./png.js');
const EXR = require('./texture-exr.js');
const Meshes = require('./bake-job-mesh.js');
const bake = require('./glb-bake.js');

const spaces = { 'position-object': 'object', 'position-world': 'world', 'position-normalized': 'normalized' };
const identity = { 'vertex-id': 'vertex', 'material-id': 'material', 'part-id': 'part' };
const names = Object.freeze([...Object.keys(spaces), ...Object.keys(identity)]);
const axes = ['X', 'Y', 'Z'];
const generated = 0x800000, codeMask = 0xffffff, legendLimit = 64;

function settings(map) {
  return names.includes(map) ? { encoding: 'exr', attribute: spaces[map] ?? identity[map] } : {};
}

function authoredId(id, type) {
  if (id !== undefined && (!Number.isInteger(id) || id < 1 || id >= generated))
    throw new RangeError('Authored ' + type + ' IDs need an integer from 1 to 8388607');
  return id;
}

function unique(id, type, used) {
  if (used.has(id)) throw new RangeError('Duplicate authored ' + type + ' ID ' + id);
  used.add(id);
  return id;
}

function automatic(offset) {
  const id = generated + offset;
  if (id > codeMask) throw new RangeError('Bake scene exceeds the generated ID range');
  return id;
}

function coordinates(part, vertex) {
  return part.position.slice(vertex * 3, vertex * 3 + 3);
}

// Allocate fallbacks from the complete source, independent of targets, map order, and tiles.
function identities(model, requested) {
  const materialIds = new Set(), partIds = new Set(), vertexOwners = new Map();
  let nextPart = 0, nextVertex = 0;
  const unassigned = { id: generated, label: 'Unassigned' };
  const materials = requested.has('material') && model.materials.map((material, index) => ({
    id: unique(authoredId(material.inkId, 'material') ?? automatic(index + 1), 'material', materialIds),
    label: material.name, material: index
  }));
  const meshes = model.meshes.map((mesh, meshIndex) => {
    const accessors = new Map();
    return mesh.parts.map((part, index) => {
      const reference = { mesh: meshIndex, part: index };
      const partOrdinal = ++nextPart;
      const region = requested.has('part') && {
        id: unique(authoredId(part.inkId, 'part') ?? automatic(partOrdinal), 'part', partIds),
        label: typeof part.inkLabel === 'string' ? part.inkLabel.slice(0, 140) : mesh.name + ' · Primitive ' + index,
        ...reference
      };
      let vertex;
      if (requested.has('vertex')) {
        const accessor = part.positionAccessor, count = part.position.length / 3;
        if (!accessors.has(accessor)) {
          accessors.set(accessor, nextVertex + 1);
          nextVertex += count;
        }
        const base = accessors.get(accessor);
        if (part.vertexIds) for (const [i, value] of part.vertexIds.entries()) {
          const id = authoredId(value, 'vertex');
          const key = [meshIndex, ...coordinates(part, i)].join(',');
          if (vertexOwners.has(id) && vertexOwners.get(id) !== key)
            throw new RangeError('Authored vertex ID ' + id + ' refers to different object-space vertices');
          vertexOwners.set(id, key);
        } else automatic(base + count - 1);
        vertex = i => part.vertexIds?.[i] ?? automatic(base + i);
      }
      return { part: region, material: materials && (materials[part.material] ?? unassigned), vertex };
    });
  });
  return meshes;
}

// An odd multiplier permutes RGB24 codes. The same ID always has the same
// swatch, and black stays reserved for the empty code.
function color(id) {
  const rgb = Math.imul(id, 0x9e3759) & codeMask;
  return [rgb >>> 16, (rgb >>> 8) & 255, rgb & 255];
}
const hex = id => '#' + color(id).map(n => n.toString(16).padStart(2, '0')).join('');

function worldPlacement(model, selection, selector, K) {
  const nodes = model.nodes.filter(node => node.mesh === selection.index);
  if (selector !== undefined) {
    const matches = nodes.filter(node => typeof selector === 'number' ? node.index === selector : node.name === selector);
    if (matches.length !== 1) throw new RangeError('Choose one world position node for ' + selection.mesh);
    const [node] = matches;
    return { node: { index: node.index, name: node.name }, point: Meshes.sceneTransform(model, selection.index, K, node).point };
  }
  if (nodes.length === 1) return worldPlacement(model, selection, nodes[0].index, K);
  if (nodes.length) throw new RangeError('Set positionNode for the instanced mesh ' + selection.mesh);
  return { node: null, point: value => value };
}

function bounds(asset, point) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of asset.parts) for (const index of new Set(part.indices)) {
    const value = point(coordinates(part, index));
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(value[c], min[c]);
      max[c] = Math.max(value[c], max[c]);
    }
  }
  return { min, max };
}

function normalize(value, { min, max }, c) {
  return max[c] === min[c] ? .5 : Math.max(0, Math.min(1, (value - min[c]) / (max[c] - min[c])));
}

function positionData(scope, size, limits, placement) {
  return { scope, limits, placement, planes: Object.fromEntries(axes.map(axis => [axis, new Float32Array(size * size)])) };
}

function makePreview(size, owners, sample) {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < owners.length; i++) if (owners[i]) {
    pixels.set(sample(i), i * 4);
    pixels[i * 4 + 3] = 255;
  }
  return PNG.encode(size, size, pixels, 4, { srgb: true });
}

function pack(size, map, data, legend, { owners, sampledTexels, coverage }) {
  const scope = spaces[map];
  if (scope) {
    const { limits, placement, planes } = data;
    const sample = i => axes.map((axis, c) => Math.round(255 * (scope === 'normalized' ?
      planes[axis][i] : normalize(planes[axis][i], limits, c))));
    const output = { kind: 'position', space: scope, encoding: 'exr', bitDepth: 32,
      units: scope === 'normalized' ? 'unitless' : 'shape-units', bounds: limits,
      ...(placement && { node: placement.node }) };
    return { bytes: EXR.write({ width: size, height: size, planes }), preview: makePreview(size, owners, sample),
      output, texels: sampledTexels, coverage };
  }
  const palette = [...legend.palette.values()].sort((a, b) => a.id - b.id).map(row => ({ ...row, color: hex(row.id) }));
  return {
    bytes: EXR.write({ width: size, height: size, planes: { Y: data } }),
    preview: makePreview(size, owners, i => color(data[i])),
    output: { kind: 'id', identity: identity[map], encoding: 'exr', bitDepth: 32, units: 'id', background: 0,
      paletteMode: 'rgb24-multiply-9e3759', distinct: legend.seen.size, palette },
    texels: sampledTexels, coverage
  };
}

function rasterize(group, model, table, positionBounds, K) {
  const { selection, tile, settings: { size, padding } } = group.tasks[0];
  const sourceMesh = model.meshes[selection.index], data = new Map(), ids = new Map();
  const requested = new Set(group.tasks.map(task => task.map));
  for (const map of requested) {
    const scope = spaces[map];
    if (scope) {
      const { limits, placement } = positionBounds.get(group.tasks[0].authored.id).get(scope);
      data.set(map, positionData(scope, size, limits, placement));
    } else {
      data.set(map, new Float32Array(size * size));
      ids.set(map, { seen: new Set(), palette: new Map() });
    }
  }
  const positions = [...data.values()].filter(row => row.planes);
  function writeId(map, pixel, id, description) {
    const buffer = data.get(map);
    if (!buffer) return;
    buffer[pixel] = id;
    const { seen, palette } = ids.get(map);
    if (seen.has(id)) return;
    seen.add(id);
    if (palette.size < legendLimit) palette.set(id, description());
  }
  const withVertex = requested.has('vertex-id');
  const withPart = requested.has('part-id'), withMaterial = requested.has('material-id');
  const visibility = {
    forFace(f) {
      const source = selection.metadata[tile.source[f]], primitive = sourceMesh.parts[source.i];
      const corners = positions.length && source.vertices.map(i => coordinates(primitive, i));
      const row = table?.[selection.index][source.i];
      const vertexIds = withVertex && source.vertices.map(row.vertex);
      return (point, _normal, pixel) => {
        const weights = (positions.length || withVertex) && source.weights(point);
        if (withVertex) {
          let winner = 0;
          for (let k = 1; k < 3; k++) {
            if (weights[k] > weights[winner] + 1e-9 ||
                Math.abs(weights[k] - weights[winner]) <= 1e-9 && vertexIds[k] < vertexIds[winner]) winner = k;
          }
          const id = vertexIds[winner], vertex = source.vertices[winner];
          writeId('vertex-id', pixel, id, () => ({ id, mesh: selection.index, part: source.i, vertex }));
        }
        if (withPart) writeId('part-id', pixel, row.part.id, () => row.part);
        if (withMaterial) writeId('material-id', pixel, row.material.id, () => row.material);
        if (positions.length) {
          const local = axes.map((_, c) => corners.reduce((n, xyz, k) => n + xyz[c] * weights[k], 0));
          for (const { scope, limits, placement, planes } of positions) {
            const value = placement ? placement.point(local) : local;
            for (const [c, axis] of axes.entries())
              planes[axis][pixel] = scope === 'normalized' ? normalize(value[c], limits, c) : value[c];
          }
        }
      };
    },
    copy(from, to) {
      for (const values of data.values()) {
        if (values.planes) for (const plane of Object.values(values.planes)) plane[to] = plane[from];
        else values[to] = values[from];
      }
    }
  };
  const result = bake(tile.mesh, tile.faces, tile.uvs, tile.normals, size, padding, K,
    { registered: true, chartBake: { state: { faceCharts: tile.faces.map(() => 0) }, visibility } });
  return { raster: { owners: result.raster.owners, sampledTexels: result.sampledTexels, coverage: result.coverage }, data, ids };
}

function render(tasks, model, K) {
  const groups = new Map(), byTask = new Map(), positionBounds = new Map(), requestedIds = new Set();
  for (const task of tasks) {
    const { map, selection, authored, tile, settings } = task;
    if (!settings.attribute) continue;
    if (identity[map]) requestedIds.add(identity[map]);
    const scope = spaces[map];
    if (scope) {
      if (!positionBounds.has(authored.id)) positionBounds.set(authored.id, new Map());
      const spaces = positionBounds.get(authored.id);
      if (!spaces.has(scope)) {
        const placement = scope === 'world' && worldPlacement(model, selection, authored.positionNode, K);
        const limits = placement ? bounds(model.meshes[selection.index], placement.point) :
          (spaces.get('object') ?? spaces.get('normalized'))?.limits ??
          bounds(model.meshes[selection.index], value => value);
        spaces.set(scope, { limits, placement });
      }
    }
    const key = JSON.stringify([authored.id, tile.tile, settings.size, settings.padding]);
    if (!groups.has(key)) groups.set(key, { tasks: [] });
    const group = groups.get(key);
    group.tasks.push(task);
    byTask.set(task, group);
  }
  const table = requestedIds.size ? identities(model, requestedIds) : undefined;
  return task => {
    const group = byTask.get(task);
    group.raster ??= rasterize(group, model, table, positionBounds, K);
    const { raster, data, ids } = group.raster, legend = ids.get(task.map);
    const output = pack(task.settings.size, task.map, data.get(task.map), legend, raster);
    data.delete(task.map);
    ids.delete(task.map);
    if (!data.size) delete group.raster;
    return output;
  };
}

module.exports = { names, settings, render };
