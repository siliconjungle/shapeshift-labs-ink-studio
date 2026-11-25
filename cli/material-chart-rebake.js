const fs = require('node:fs');
const path = require('node:path');
const littleEndian = require('node:os').endianness() === 'LE';
const zlib = require('node:zlib');
const png = require('./png.js');
const MeshUV = require('../src/mesh-uv.js');
const { digest } = require('./material-projection.js');
const topology = require('./material-topology-revision.js');

const editFormat = 'ink-studio/material-chart-edits';
const hash = value => digest(JSON.stringify(value));
const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const index = n => Number.isSafeInteger(n) && n >= 0;

function readPlan(input) {
  if (input === undefined) return [];
  const plan = typeof input === 'string' ? JSON.parse(fs.readFileSync(input, 'utf8')) : input;
  if (plan?.format !== editFormat || plan.version !== 1 || !Array.isArray(plan.edits))
    throw new TypeError('Expected a version 1 ' + editFormat + ' plan');
  for (const row of plan.edits) {
    const {mesh, charts, bounds, uvSet} = row ?? {};
    if (!index(mesh) || uvSet!==undefined && (!index(uvSet) || uvSet>31) || charts === undefined && bounds === undefined ||
        charts !== undefined && (!Array.isArray(charts) || charts.length === 0 || !charts.every(index)) ||
        bounds !== undefined && (!vector(bounds?.min) || !vector(bounds?.max) || bounds.min.some((n, i) => n > bounds.max[i])))
      throw new TypeError('A chart edit needs a mesh index and chart IDs or three-dimensional bounds');
  }
  return plan.edits;
}

function readBaseline(file) {
  if (file === undefined) return null;
  if (typeof file !== 'string' || !file) throw new TypeError('Rebaking needs a material-bake.json path');
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (document?.format !== 'ink-studio/registered-material-bake' || document.version !== 1 || !Array.isArray(document.meshes))
    throw new TypeError('Expected a registered material bake as the rebake baseline');
  const directory = fs.realpathSync(path.dirname(path.resolve(file)));
  function read(descriptor) {
    const name = descriptor?.file;
    if (typeof name !== 'string' || path.isAbsolute(name))
      throw new Error('Missing chart rebake sidecar. Export a fresh registered baseline.');
    const target = path.resolve(directory, name);
    if (!target.startsWith(directory + path.sep) || !fs.realpathSync(target).startsWith(directory + path.sep))
      throw new Error('Chart rebake sidecar must stay inside the baseline directory');
    const bytes = fs.readFileSync(target);
    if (digest(bytes) !== descriptor.sha256) throw new Error('Chart rebake checksum mismatch for ' + name);
    return bytes;
  }
  return {document, directory, read};
}

const topologyKey = mesh => hash([mesh.points.length, mesh.faces, mesh.chartGroups, ...(mesh.uvCuts ? [mesh.uvCuts] : [])]);
const uvKey = mesh => mesh.uvs ? hash(mesh.uvs.map(face => face.map(uv => uv.map(Math.fround)))) : null;
const paintKey = views => hash(views.map(({image,approval,...view}) => [view,image.hash,approval?.hash]));
const overlaps = (a, b) => a.min.every((x, k) => x <= b.max[k] && a.max[k] >= b.min[k]);

function baselineLayout(baseline, meshIndex, mesh, set = 0) {
  if (!baseline) return undefined;
  const main = baseline.document.meshes[meshIndex];
  if (main?.index !== meshIndex || main.name !== mesh.name)
    throw new Error('Chart rebake needs the baseline mesh order and names');
  const row=main.uvAtlases?.[set] ?? (!main.uvAtlases && (main.texCoord ?? 0)===set ? main : undefined);
  if (!row) return undefined;
  const state = JSON.parse(baseline.read(row.chartLayout));
  if (state.version !== 1 || hash([state.faces,state.uvs]) !== row.uvLayout)
    throw new Error('Chart rebake UV layout does not match the baseline manifest');
  const ids = topology.sourceIds(mesh);
  const sameIds = !state.identity || ids && hash([state.identity.vertexIds, state.identity.faceIds]) === hash([ids.vertexIds, ids.faceIds]);
  const sameTopology = state.topology === topologyKey(mesh) && sameIds;
  const revised = !sameTopology || state.authoredUV !== uvKey(mesh);
  if (revised && (!state.identity || !ids || !mesh.uvs))
    throw new Error('Chart rebake needs the saved face topology and authored UV layout or matching stable IDs and an authored atlas on ' + mesh.name);
  return { row, state, revised, lockSplits: sameTopology };
}

function unpack(packed, Type, length) {
  const bytes = zlib.inflateSync(packed, {maxOutputLength:length * Type.BYTES_PER_ELEMENT});
  if (bytes.length !== length * Type.BYTES_PER_ELEMENT) throw new Error('Invalid chart rebake raster length');
  if (littleEndian && bytes.byteOffset%4===0) return new Type(bytes.buffer,bytes.byteOffset,length);
  const data = new Type(length);
  // Sidecars store little-endian values, like the GLB data they accompany.
  const read = Type === Uint32Array ? bytes.readUInt32LE : bytes.readFloatLE;
  for (let i = 0; i < length; i++) data[i] = read.call(bytes,i*4);
  return data;
}

function pack(data) {
  if (littleEndian) return zlib.deflateSync(Buffer.from(data.buffer,data.byteOffset,data.byteLength));
  const bytes = Buffer.allocUnsafe(data.byteLength);
  const write = data instanceof Uint32Array ? bytes.writeUInt32LE : bytes.writeFloatLE;
  for (let i = 0; i < data.length; i++) write.call(bytes,data[i],i*4);
  return zlib.deflateSync(bytes);
}

function loadRaster(read, size, maps, masks) {
  const count = size*size;
  function raster(descriptor, channels) {
    const {w,h,data,max} = png.raster(read(descriptor));
    if (w !== size || h !== size || max !== 255) throw new Error('Invalid chart rebake map dimensions');
    const pixels = new Uint8Array(count*channels);
    for (let i = 0; i < count; i++) for (let c = 0; c < channels; c++) pixels[i*channels+c] = data[i*4+c];
    return pixels;
  }
  const pixels = Object.fromEntries(Object.entries({
    base:maps.pigment,normal:maps.normal,surface:maps.metallicRoughness,emission:maps.emission
  }).map(([key,map]) => [key,raster(map,3)]));
  return {pixels, ...(maps.opacity&&{opacity:raster(maps.opacity,1)}), footprint:raster(maps.coverage,1),
    masks:new Map(Object.entries(masks).map(([name,map]) => [name,raster(map,1)]))};
}

function loadAtlas(baseline, row) {
  const {width:size,maps,masks,rebakeState} = row, count = size*size;
  const packedOwners=baseline.read(rebakeState.owners);
  const packedPaint=rebakeState.paint && baseline.read(rebakeState.paint);
  return {...loadRaster(baseline.read,size,maps,masks), strength:row.emissionStrength,packedOwners,packedPaint,
    owners:unpack(packedOwners,Uint32Array,count),
    paint:packedPaint && unpack(packedPaint,Float32Array,count*4)};
}

function layoutError(report, conflicts) {
  const first = conflicts[0];
  const detail = first.chart === undefined ? first.charts?.join(', ') : first.chart;
  return Object.assign(new RangeError('Chart revision cannot preserve atlas space (' + first.code +
    (detail === undefined ? '' : ' on chart ' + detail) + ')'), { report: { ...report, conflicts } });
}

function planMesh({mesh, faces, uvs, normals, atlas, splits, sourceFaces, size, source, edits, views, baseline, forcePaint}) {
  const prior = source?.state, revised = source?.revised;
  const identity = topology.identify(mesh, faces, sourceFaces);
  const groups = !revised && prior ? prior.faceCharts :
    Array.from(atlas.islands ?? MeshUV.topology(mesh.points, faces, uvs, [], mesh.uvCuts).chart);
  const byGroup = new Map();
  const materials = mesh.materials.map(({texture,...material})=>{
    if (!texture) return hash(material);
    const {bytes,pixels,...layout}=texture;
    const source=bytes??pixels;
    const content=ArrayBuffer.isView(source) ? digest(Buffer.from(source.buffer,source.byteOffset,source.byteLength)) : source;
    return hash([material,layout,content]);
  });
  for (const [f, face] of faces.entries()) {
    const group = groups[f];
    if (!byGroup.has(group)) byGroup.set(group, { ...(!revised && { id: group }),
      faces:[],bounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]} });
    const chart = byGroup.get(group);
    chart.faces.push(f);
    for (const vertex of face) for (let k = 0; k < 3; k++) {
      chart.bounds.min[k] = Math.min(chart.bounds.min[k],mesh.points[vertex][k]);
      chart.bounds.max[k] = Math.max(chart.bounds.max[k],mesh.points[vertex][k]);
    }
  }
  const charts = [...byGroup.values()];
  const correspondence = topology.assign(charts, { identity, mesh, faces, uvs, normals, materials }, prior);
  charts.sort((a, b) => a.id - b.id);
  const faceCharts = groups.map(id => byGroup.get(id).id);
  const old = new Map(prior?.charts.map(row => [row.id, row]));
  const next = new Map(charts.map(row => [row.id, row]));
  const rebuild = new Set(revised ? charts.filter(chart => chart.layout !== old.get(chart.id)?.layout).map(chart => chart.id) : []);
  const release = new Set(revised ? [...correspondence.retired, ...[...rebuild].filter(id => old.has(id))] : []);

  const maskNames = [...new Set([...(mesh.maskNames ?? []),...mesh.materials.flatMap(m => Object.keys(m.masks ?? {}))])].sort();
  const statePaintKey = views.length ? paintKey(views) : prior?.paintKey ?? paintKey([]);
  const surfaceSources = mesh.surfaceSources?.map(({key,bounds,definition}) => ({key,bounds,signature:hash([bounds,definition])}));
  const state = {
    version:1, topology:topologyKey(mesh), authoredUV:uvKey(mesh), faces, uvs, splits, faceCharts,
    chartCount:identity ? charts.length : atlas.charts, utilization:atlas.utilization, maskNames,
    paintKey:statePaintKey,
    ...(identity && { identity, nextChartId: correspondence.nextChartId, opacity: Boolean(mesh.paintedOpacity) }),
    ...(surfaceSources && {surfaceSources}),
    paintMasks:[...new Set([...(prior?.paintMasks ?? []),
      ...(views.length ? ['projected-paint',...views.map(view => 'paint-'+view.id)] : [])])],
    charts:charts.map(chart => {
      const signature = chart.signature ?? hash(chart.faces.map(f => [materials[mesh.faceMaterials[f]],mesh.cornerNormals?.[f],
        faces[f].map(i => [mesh.points[i],mesh.cornerNormals ? undefined : normals[i],mesh.colors?.[i]])]));
      return {...chart, signature, paintKey:old.get(chart.id)?.paintKey ?? statePaintKey};
    })
  };
  const labelsFor = (chart, labels) => [...new Set(chart.faces.map(f => labels[f]))].sort();
  const currentFaces = revised && new Set(identity.labels);
  const removedFaces = id => labelsFor(old.get(id), prior.identity.labels).filter(face => !currentFaces.has(face));
  const layout = revised ? {
    retired: correspondence.retired.map(id => ({ id, faces: labelsFor(old.get(id), prior.identity.labels),
      removedFaces: removedFaces(id), paintTexels: 0, releasedTexels: 0 })),
    charts: charts.map(chart => ({
      id: chart.id, from: correspondence.related.get(chart), faces: labelsFor(chart, identity.labels),
      removedFaces: [...new Set(correspondence.related.get(chart).flatMap(removedFaces))].sort(),
      space: rebuild.has(chart.id) ? old.has(chart.id) ? 'revised' : 'new' : 'preserved',
      uvBefore: old.get(chart.id)?.uvBounds ?? null, uvAfter: chart.uvBounds,
      releasedTexels: 0, sampledTexels: 0, gutterObstructions: 0
    }))
  } : undefined;
  if (layout) {
    const conflicts = topology.overlapReport(mesh.points, faces, uvs, faceCharts, size);
    if (conflicts.length) throw layoutError({ mesh: mesh.name, layout }, conflicts);
  }

  const dirty = new Set(forcePaint ? state.charts.map(({id})=>id) : []);
  for (const edit of edits) {
    for (const id of edit.charts ?? []) {
      if (!next.has(id)) throw new RangeError('Chart edit references a missing chart on ' + mesh.name + ': ' + id);
      dirty.add(id);
    }
    if (edit.bounds) {
      const hits = charts.filter(chart => overlaps(chart.bounds,edit.bounds) ||
        old.has(chart.id) && overlaps(old.get(chart.id).bounds,edit.bounds));
      if (!hits.length) throw new RangeError('Chart edit bounds do not touch ' + mesh.name);
      for (const {id} of hits) dirty.add(id);
    }
  }
  if (prior && state.paintKey !== prior.paintKey && !dirty.size)
    throw new Error('Changed camera paint needs explicit chart IDs or bounds on ' + mesh.name);
  if (prior && (size !== source.row.width || size !== source.row.height || atlas.padding !== source.row.padding))
    throw new Error('Chart rebake needs the saved texture size and padding on ' + mesh.name);
  const reproject = new Set();
  for (const chart of state.charts) {
    if (views.length && (forcePaint || !prior || dirty.has(chart.id) && (chart.paintKey !== state.paintKey || rebuild.has(chart.id)))) {
      reproject.add(chart.id);
      chart.paintKey = state.paintKey;
    }
    if (!prior || rebuild.has(chart.id) || chart.signature !== old.get(chart.id)?.signature) dirty.add(chart.id);
  }
  if (prior && (surfaceSources || prior.surfaceSources)) {
    const before = new Map(prior.surfaceSources?.map(row => [row.key,row]));
    const after = new Map(surfaceSources?.map(row => [row.key,row]));
    const changed = [...before.values()].filter(row => row.signature !== after.get(row.key)?.signature)
      .concat([...after.values()].filter(row => row.signature !== before.get(row.key)?.signature));
    for (const chart of charts) if (!prior.surfaceSources || changed.some(({bounds}) =>
      !bounds || overlaps(chart.bounds,bounds) || old.has(chart.id) && overlaps(old.get(chart.id).bounds,bounds))) dirty.add(chart.id);
  }
  if (prior && (hash(maskNames) !== hash(prior.maskNames) || identity && prior.opacity !== undefined && state.opacity !== prior.opacity))
    for (const chart of charts) dirty.add(chart.id);
  const previous = source && loadAtlas(baseline,source.row);
  const transfer = revised && topology.transferPlan(prior, state, previous, size, release);
  if (layout) {
    for (const chart of layout.retired) {
      chart.paintTexels = transfer?.painted.get(chart.id) ?? 0;
      chart.unmappedPaintTexels = transfer?.missing.get(chart.id) ?? 0;
    }
    for (const chart of layout.charts) {
      const oldPaintedTexels = chart.from.reduce((total, id) => total + (transfer?.painted.get(id) ?? 0), 0);
      const unmappedOldPaintTexels = chart.from.reduce((total, id) => total + (transfer?.missing.get(id) ?? 0), 0);
      chart.paint = { status: reproject.has(chart.id) ? 'reprojected' : !oldPaintedTexels ? 'none' :
        rebuild.has(chart.id) ? 'transferred' : 'retained', oldPaintedTexels, mappedTexels: 0,
        transferredTexels: 0, unmappedTexels: 0, unmappedOldPaintTexels, reprojectedTexels: 0 };
    }
  }
  return {state,dirty,reproject,previous,layout,rebuild,release,transfer,
    ...(layout && { conflict: conflicts => layoutError({ mesh: mesh.name, layout }, conflicts) })};
}

module.exports = {readPlan,readBaseline,baselineLayout,planMesh,loadRaster,pack,unpack};
