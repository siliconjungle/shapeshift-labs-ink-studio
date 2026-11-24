const Targets = require('../src/target-selectors.js');
const Provenance = require('../src/splat-provenance.js');
const SplatFit = require('./splat-fit-asset.js');

const lanes = 4, minimum = 1e-6;

function splatBuffer(size) {
  const rows = new Uint32Array(size*lanes), weights = new Float64Array(size*lanes);
  const opacity = new Float32Array(size*lanes), depth = new Float32Array(size*lanes);
  const omitted = new Float64Array(size), planes = [rows,weights,opacity,depth];

  function add(p,row,alpha,z) {
    const start = p*lanes, end = start+lanes, remaining = 1-alpha;
    omitted[p] *= remaining;
    for (let i=start; i<end; i++) weights[i] *= remaining;
    if (row < 0) return;
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
    omitted[p] += weights[end-1];
    for (const values of planes) values.copyWithin(at+1,at,end-1);
    rows[at] = row+1;
    weights[at] = alpha;
    opacity[at] = alpha;
    depth[at] = z;
  }

  function finish(world,topDown) {
    const splatSources = [null], slots = new Map();
    const targets = Targets.index(world);
    let identities;
    const truncation = Float32Array.from(omitted);
    for (let i=0; i<rows.length; i++) {
      if (weights[i] < minimum) {
        truncation[Math.floor(i/lanes)] += weights[i];
        rows[i] = weights[i] = opacity[i] = depth[i] = 0;
        continue;
      }
      const row = rows[i]-1;
      if (!slots.has(row)) {
        const { object,entity,part,material } = targets.row(row);
        slots.set(row,splatSources.length);
        identities ??= Provenance.identities(world);
        splatSources.push({ id:identities.idAt(row) ?? null,object,entity,part,material,editable:SplatFit.eligible(world,row) });
      }
      rows[i] = slots.get(row);
    }
    return { splatSources, sourceSplat:topDown(rows,lanes), sourceSplatAlpha:topDown(opacity,lanes),
      sourceSplatDepth:topDown(depth,lanes), sourceSplatWeight:topDown(Float32Array.from(weights),lanes),
      sourceSplatOmitted:topDown(truncation,1) };
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
    const { key,identity,coordinate,triangle } = source;
    if (!slots.has(key)) {
      slots.set(key,surfaceSources.length);
      surfaceSources.push(identity);
    }
    sourceSurface[p] = slots.get(key);
    sourceCoordinates.set(coordinate,p*3);
    if (triangle !== undefined) sourceTriangle[p] = triangle;
  }
  return { surfaceSources,sourceSurface:topDown(sourceSurface,1),sourceTriangle:topDown(sourceTriangle,1),
    sourceCoordinates:topDown(sourceCoordinates,3) };
}

module.exports = { splatBuffer, surfaces };
