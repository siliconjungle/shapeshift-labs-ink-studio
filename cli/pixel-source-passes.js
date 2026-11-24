const { createHash } = require('node:crypto');
const Targets = require('../src/target-selectors.js');
const Provenance = require('../src/splat-provenance.js');
const SplatFit = require('./splat-fit-asset.js');
const PartMotion = require('./part-motion.js');

const lanes = 4, minimum = 1e-6;
const footprintDigests = new WeakMap();

function splatTargets(world, row=Targets.index(world).row) {
  if (!world.anim?.rig && !world.anim?.bones) return row;
  const {parts,rows}=PartMotion.catalog(world);
  return i=>{
    const target=row(i), part=parts[rows[i]]?.part;
    return part!==undefined && target.part===undefined ? {...target,part} : target;
  };
}

function rowRevision(world,row) {
  const editedFootprint=SplatFit.editedFootprint(world,row);
  const attributes=SplatFit.editedAttributes(world,row);
  world = SplatFit.baseWorld(world);
  const hash = createHash('sha256');
  const data = Provenance.restData(world);
  for (const [key,values,stride,start = 0] of [
    ['base',data,16],['surface',world.surfaceData,8,1],['fine',world.fine,12],['curve',world.curveRest,16],
    ['attrs',world.attr,4],['pixels',world.pix,8],['optical',world.opticalSplats,12],
    ['normals',world.renderMetadata?.normals,3],['shading',world.renderMetadata?.shadingNormals,3],
    ['emission',world.renderMetadata?.paintedEmission,3],['inkControls',world.renderMetadata?.inkControls,4]
  ]) {
    if (!values) continue;
    const chunk = values.subarray(row*stride+start,(row+1)*stride);
    hash.update(key);
    hash.update(Buffer.from(chunk.buffer,chunk.byteOffset,chunk.byteLength));
  }
  if (attributes) hash.update('splat-attributes').update(JSON.stringify(attributes));
  if (editedFootprint!==undefined) {
    if (editedFootprint && !footprintDigests.has(editedFootprint))
      footprintDigests.set(editedFootprint,createHash('sha256').update(JSON.stringify(editedFootprint)).digest('hex'));
    hash.update('footprint-edit').update(editedFootprint ? footprintDigests.get(editedFootprint) : 'gaussian');
  }
  return hash.digest('hex');
}

function splatBuffer(size) {
  const rows = new Uint32Array(size*lanes), weights = new Float64Array(size*lanes);
  const opacity = new Float32Array(size*lanes), depth = new Float32Array(size*lanes);
  const omitted = new Float64Array(size), planes = [rows,weights,opacity,depth];
  const frontRow = new Uint32Array(size), frontRank = new Uint8Array(size);
  const frontDepth = new Float64Array(size), frontAlpha = new Float32Array(size), frontWeight = new Float64Array(size);

  function add(p,row,alpha,z) {
    const start = p*lanes, end = start+lanes, remaining = 1-alpha;
    omitted[p] *= remaining;
    frontWeight[p] *= remaining;
    for (let i=start; i<end; i++) weights[i] *= remaining;
    if (row < 0 || alpha <= 0) return;
    // A weak foreground edge may fall outside the coverage-ranked lanes.
    const frontmost = Number.isFinite(z) && (!frontWeight[p] || z <= frontDepth[p]);
    if (frontmost) {
      frontRow[p] = row+1;
      frontRank[p] = 0;
      frontDepth[p] = z;
      frontAlpha[p] = frontWeight[p] = alpha;
    }
    if (alpha < minimum) {
      omitted[p] += alpha;
      return;
    }
    let at = end;
    // Fragment order is back to front. A newly drawn fragment wins an exact tie.
    while (at > start && alpha >= weights[at-1]) at--;
    if (at === end) {
      omitted[p] += alpha;
      return;
    }
    const rank = at-start+1;
    if (frontmost) frontRank[p] = rank;
    else if (frontRank[p] >= rank) frontRank[p] = frontRank[p] === lanes ? 0 : frontRank[p]+1;
    omitted[p] += weights[end-1];
    for (const values of planes) values.copyWithin(at+1,at,end-1);
    rows[at] = row+1;
    weights[at] = alpha;
    opacity[at] = alpha;
    depth[at] = z;
  }

  function finish(world,topDown) {
    const splatSources = [null], slots = new Map();
    const target = splatTargets(world);
    let identities;
    function slot(row) {
      if (!slots.has(row)) {
        const { object,entity,part,material } = target(row);
        slots.set(row,splatSources.length);
        identities ??= Provenance.identities(world,{fresh:true});
        splatSources.push({ id:identities.idAt(row) ?? null,renderRow:row,object,entity,part,material,editable:SplatFit.eligible(SplatFit.baseWorld(world),row),revision:rowRevision(world,row) });
      }
      return slots.get(row);
    }
    for (let i=0; i<rows.length; i++) {
      if (weights[i] < minimum) {
        omitted[Math.floor(i/lanes)] += weights[i];
        rows[i] = weights[i] = opacity[i] = depth[i] = 0;
      } else rows[i] = slot(rows[i]-1);
    }
    let extra, extraMetrics;
    for (let p=0; p<size; p++) {
      if (!Math.fround(frontWeight[p])) {
        frontRank[p] = 0;
        continue;
      }
      const rank = frontRank[p];
      if (rank && rows[p*lanes+rank-1]) continue;
      frontRank[p] = lanes+1;
      extra ??= new Uint32Array(size);
      extraMetrics ??= new Float32Array(size*3);
      extra[p] = slot(frontRow[p]-1);
      extraMetrics.set([frontAlpha[p],frontDepth[p],frontWeight[p]],p*3);
      omitted[p] = Math.max(0,omitted[p]-frontWeight[p]);
    }
    return { splatSources, sourceSplat:topDown(rows,lanes), sourceSplatAlpha:topDown(opacity,lanes),
      sourceSplatDepth:topDown(depth,lanes), sourceSplatWeight:topDown(Float32Array.from(weights),lanes),
      sourceSplatOmitted:topDown(Float32Array.from(omitted),1), sourceSplatFrontRank:topDown(frontRank,1),
      ...(extra && { sourceSplatFront:topDown(extra,1),sourceSplatFrontMetrics:topDown(extraMetrics,3) }) };
  }

  return { add,finish };
}

function surfaces(size,atlasOwners,topDown) {
  const surfaceSources = [null], slots = new Map();
  const sourceSurface = new Uint32Array(size), sourceTriangle = new Uint32Array(size);
  const sourceCoordinates = new Float32Array(size*3);
  for (const [p,hit] of atlasOwners ?? []) {
    const source = hit.source;
    if (!source) continue;
    const { key,identity,coordinate,triangle,topology } = source;
    if (!slots.has(key)) {
      slots.set(key,surfaceSources.length);
      surfaceSources.push({ ...identity,...(topology && { triangles:{} }) });
    }
    const slot = slots.get(key), triangles = surfaceSources[slot].triangles;
    if (triangles && topology && !Object.hasOwn(triangles,triangle))
      triangles[triangle] = createHash('sha256').update(topology).digest('hex');
    sourceSurface[p] = slot;
    sourceCoordinates.set(coordinate,p*3);
    if (triangle !== undefined) sourceTriangle[p] = triangle;
  }
  return { surfaceSources,sourceSurface:topDown(sourceSurface,1),sourceTriangle:topDown(sourceTriangle,1),
    sourceCoordinates:topDown(sourceCoordinates,3) };
}

module.exports = { splatBuffer, surfaces, rowRevision, splatTargets };
