const fs = require('node:fs');
const path = require('node:path');
const littleEndian = require('node:os').endianness() === 'LE';
const zlib = require('node:zlib');
const png = require('./png.js');
const MeshUV = require('../src/mesh-uv.js');
const { digest } = require('./material-projection.js');

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
    const {mesh, charts, bounds} = row ?? {};
    if (!index(mesh) || charts === undefined && bounds === undefined ||
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

const topologyKey = mesh => hash([mesh.points.length, mesh.faces, mesh.chartGroups]);
const uvKey = mesh => mesh.uvs ? hash(mesh.uvs.map(face => face.map(uv => uv.map(Math.fround)))) : null;
const paintKey = views => hash(views.map(({image,approval,...view}) => [view,image.hash,approval?.hash]));
const overlaps = (a, b) => a.min.every((x, k) => x <= b.max[k] && a.max[k] >= b.min[k]);

function baselineLayout(baseline, meshIndex, mesh) {
  if (!baseline) return undefined;
  const row = baseline.document.meshes[meshIndex];
  if (row?.index !== meshIndex || row.name !== mesh.name)
    throw new Error('Chart rebake needs the baseline mesh order and names');
  const state = JSON.parse(baseline.read(row.chartLayout));
  if (state.version !== 1 || state.topology !== topologyKey(mesh) || state.authoredUV !== uvKey(mesh))
    throw new Error('Chart rebake needs the saved face topology and authored UV layout on ' + mesh.name);
  if (hash([state.faces,state.uvs]) !== row.uvLayout)
    throw new Error('Chart rebake UV layout does not match the baseline manifest');
  return {row,state};
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

function loadAtlas(baseline, row) {
  const {width:size,maps,rebakeState} = row, count = size*size;
  function raster(descriptor, channels) {
    const {w,h,data,max} = png.raster(baseline.read(descriptor));
    if (w !== size || h !== size || max !== 255) throw new Error('Invalid chart rebake map dimensions');
    const pixels = new Uint8Array(count*channels);
    for (let i = 0; i < count; i++) for (let c = 0; c < channels; c++) pixels[i*channels+c] = data[i*4+c];
    return pixels;
  }
  const pixels = Object.fromEntries(Object.entries({
    base:maps.pigment,normal:maps.normal,surface:maps.metallicRoughness,emission:maps.emission
  }).map(([key,map]) => [key,raster(map,3)]));
  const packedOwners=baseline.read(rebakeState.owners);
  const packedPaint=rebakeState.paint && baseline.read(rebakeState.paint);
  return {pixels, ...(maps.opacity&&{opacity:raster(maps.opacity,1)}), footprint:raster(maps.coverage,1), strength:row.emissionStrength,packedOwners,packedPaint,
    masks:new Map(Object.entries(row.masks).map(([name,map]) => [name,raster(map,1)])),
    owners:unpack(packedOwners,Uint32Array,count),
    paint:packedPaint && unpack(packedPaint,Float32Array,count*4)};
}

function planMesh({mesh, faces, uvs, normals, atlas, splits, size, source, edits, views, baseline}) {
  const prior = source?.state;
  const faceCharts = prior?.faceCharts ?? Array.from(atlas.islands ?? MeshUV.topology(mesh.points,faces,uvs).chart);
  const chartCount = prior?.charts.length ?? atlas.charts ?? faceCharts.reduce((max,id) => Math.max(max,id+1),0);
  const charts = Array.from({length:chartCount},(_,id) =>
    ({id,faces:[],bounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}}));
  const materials = mesh.materials.map(({texture,...material})=>{
    if (!texture) return hash(material);
    const {bytes,pixels,...layout}=texture;
    const source=bytes??pixels;
    const content=ArrayBuffer.isView(source) ? digest(Buffer.from(source.buffer,source.byteOffset,source.byteLength)) : source;
    return hash([material,layout,content]);
  });
  for (const [f, face] of faces.entries()) {
    const chart = charts[faceCharts[f]];
    chart.faces.push(f);
    for (const vertex of face) for (let k = 0; k < 3; k++) {
      chart.bounds.min[k] = Math.min(chart.bounds.min[k],mesh.points[vertex][k]);
      chart.bounds.max[k] = Math.max(chart.bounds.max[k],mesh.points[vertex][k]);
    }
  }
  const maskNames = [...new Set([...(mesh.maskNames ?? []),...mesh.materials.flatMap(m => Object.keys(m.masks ?? {}))])].sort();
  const statePaintKey = views.length ? paintKey(views) : prior?.paintKey ?? paintKey([]);
  const state = {
    version:1, topology:topologyKey(mesh), authoredUV:uvKey(mesh), faces, uvs, splits, faceCharts,
    chartCount:atlas.charts, utilization:atlas.utilization, maskNames,
    paintKey:statePaintKey,
    paintMasks:[...new Set([...(prior?.paintMasks ?? []),
      ...(views.length ? ['projected-paint',...views.map(view => 'paint-'+view.id)] : [])])],
    charts:charts.map(chart => {
      const signature = hash(chart.faces.map(f => [materials[mesh.faceMaterials[f]],mesh.cornerNormals?.[f],
        faces[f].map(i => [mesh.points[i],mesh.cornerNormals ? undefined : normals[i],mesh.colors?.[i]])]));
      return {...chart, signature, paintKey:prior?.charts[chart.id].paintKey ?? statePaintKey};
    })
  };
  const dirty = new Set();
  for (const edit of edits) {
    for (const id of edit.charts ?? []) {
      if (!charts[id]) throw new RangeError('Chart edit references a missing chart on ' + mesh.name + ': ' + id);
      dirty.add(id);
    }
    if (edit.bounds) {
      const hits = charts.filter(chart => overlaps(chart.bounds,edit.bounds) || prior && overlaps(prior.charts[chart.id].bounds,edit.bounds));
      if (!hits.length) throw new RangeError('Chart edit bounds do not touch ' + mesh.name);
      for (const {id} of hits) dirty.add(id);
    }
  }
  if (prior && state.paintKey !== prior.paintKey && !dirty.size)
    throw new Error('Changed camera paint needs explicit chart IDs or bounds on ' + mesh.name);
  if (prior && (size !== source.row.width || size !== source.row.height || atlas.padding !== source.row.padding))
    throw new Error('Chart rebake needs the saved texture size and padding on ' + mesh.name);
  // Each chart remembers which camera revision it received. Applying a view to
  // one chart today must leave the same revision available to other charts.
  const reproject = new Set();
  for (const chart of state.charts) {
    if (views.length && (!prior || dirty.has(chart.id) && chart.paintKey !== state.paintKey)) {
      reproject.add(chart.id);
      chart.paintKey = state.paintKey;
    }
    if (!prior || chart.signature !== prior.charts[chart.id].signature) dirty.add(chart.id);
  }
  if (prior && hash(maskNames) !== hash(prior.maskNames)) for (const chart of charts) dirty.add(chart.id);
  return {state,dirty,reproject,previous:source && loadAtlas(baseline,source.row)};
}

module.exports = {readPlan,readBaseline,baselineLayout,planMesh,pack};
