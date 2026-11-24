const ArtPasses = require('../src/art-passes.js');
const EmissiveFinishes = require('../src/emissive-finishes.js');
const { ditherFootprint } = require('./dither-footprint.js');
const { surfacePoint } = require('./scene-optics.js');
const TargetSelectors = require('../src/target-selectors.js');
const PartMotion = require('./part-motion.js');
const SurfaceMotion = require('./opaque-surface-pass.js');
const PixelSources = require('./pixel-source-passes.js');

const SplatFrames = require('../src/splat-frames.js');
const { rows: shutterRows } = require('./programmable-exposure.js');
let matrices;
function sampleFrames(world, time) {
  if (!matrices && (world.anim?.rig || world.anim?.bones || world.reconstructionPose)) matrices = require('../index.js').load().KIT.M;
  const exposure = world[shutterRows];
  const base = SplatFrames.create(world, time, matrices);
  if (!exposure) return base;
  const sources = new Map();
  return index => {
    const alternate = exposure.pose(index), clock = exposure.clock(index);
    if (!clock || !alternate && clock.scene === time) return base(index);
    const source = alternate ?? world;
    const key = alternate ?? clock;
    if (!sources.has(key)) {
      if (!matrices && (source.anim?.rig || source.anim?.bones || source.reconstructionPose)) matrices = require('../index.js').load().KIT.M;
      sources.set(key, SplatFrames.create(source, clock.scene, matrices));
    }
    return sources.get(key)(index);
  };
}

function createArtPasses(request, w, h, emissiveSlots, capturePartMotion, captureSurfaceMotion, captureHistory) {
  const selected = new Set(ArtPasses.select(request));
  if (!selected.size && !capturePartMotion && !captureSurfaceMotion && !captureHistory) return null;
  const size = w * h;
  const coverage = selected.has('coverage') ? new Float32Array(size) : null;
  const surfaceCoverage=selected.has('surfaceCoverage') ? new Float32Array(size) : null;
  const emission = selected.has('emission') ? new Float32Array(size * 3) : null;
  const emissionOwner = selected.has('emissionMotion') ? new Int32Array(size).fill(-1) : null;
  const scopedOwners = emissiveSlots && new Uint8Array(size);
  const scopedCoverage = emissiveSlots && new Float32Array(size);
  const emissionDepth = selected.has('emissionDepth') || emissionOwner || scopedOwners ? new Float32Array(size).fill(Infinity) : null;
  const needsOwner = captureHistory || capturePartMotion || captureSurfaceMotion ||
    [...selected].some(channel => !['emission', 'emissionDepth', 'emissionMotion', 'coverage', 'protected'].includes(channel));
  const owner = needsOwner ? new Int32Array(size).fill(-1) : null;
  const depth = needsOwner ? new Float32Array(size).fill(Infinity) : null;

  const bindings = selected.has('sourceSplat') ? PixelSources.splatBuffer(size) : null;
  let atlasOwners;
  function fragment(p, i, a, solid, z, emits, r, g, b, atlas, emissionTint, sourceDepth = z) {
    bindings?.add(p,atlas ? -1 : i,a,sourceDepth);
    const tint=emissionTint ?? atlas?.emission;
    emits ||= Boolean(tint);
    if (coverage) coverage[p] = a + coverage[p] * (1 - a);
    if (emission) {
      const j = p * 3;
      if (emits || emission[j] || emission[j + 1] || emission[j + 2]) {
        emission[j] = ArtPasses.over(tint ? tint[0] : emits ? r : 0, emission[j], a);
        emission[j + 1] = ArtPasses.over(tint ? tint[1] : emits ? g : 0, emission[j + 1], a);
        emission[j + 2] = ArtPasses.over(tint ? tint[2] : emits ? b : 0, emission[j + 2], a);
      }
    }
    if (scopedOwners && z <= emissionDepth[p]) {
      if (emits && a > .03) {
        const slot = emissiveSlots[i] || EmissiveFinishes.unscoped;
        scopedCoverage[p] = slot === scopedOwners[p] ? ArtPasses.over(1, scopedCoverage[p], a) : a;
        scopedOwners[p] = slot;
      } else if (!emits && scopedCoverage[p]) {
        scopedCoverage[p] *= 1-a;
        if (scopedCoverage[p] <= .03) {
          scopedOwners[p] = 0;
          scopedCoverage[p] = 0;
        }
      }
    }
    if (emissionDepth && a > .03) {
      if (emits && z <= emissionDepth[p]) {
        emissionDepth[p] = z;
        if (emissionOwner) emissionOwner[p] = i;
      } else if (!emits && solid && a > .97 && z <= emissionDepth[p]) {
        emissionDepth[p] = Infinity;
        if (emissionOwner) emissionOwner[p] = -1;
      }
    }
    if (owner && ArtPasses.ownsSurface(a, solid, z, depth[p])) {
      owner[p] = i;
      depth[p] = z;
      if (surfaceCoverage) surfaceCoverage[p]=a;
      if (atlas) (atlasOwners??=new Map()).set(p,atlas);
      else atlasOwners?.delete(p);
      return true;
    }
  }

  function sprite(p, i, z) {
    bindings?.add(p,i,1,z);
    atlasOwners?.delete(p);
    if (coverage) coverage[p] = 1;
    if (emission) emission.fill(0, p * 3, p * 3 + 3);
    if (emissionDepth) emissionDepth[p] = Infinity;
    if (emissionOwner) emissionOwner[p] = -1;
    if (scopedOwners) scopedOwners[p] = scopedCoverage[p] = 0;
    if (owner) {
      owner[p] = i;
      depth[p] = z;
      if (surfaceCoverage) surfaceCoverage[p]=1;
    }
  }

  function finalize(world, time, geometry) {
    const topDown = (values, components) => {
      const out = new values.constructor(values.length);
      const row = w * components;
      for (let y = 0; y < h; y++) out.set(values.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
      return out;
    };
    const result = { w, h };
    if (selected.has('sourceSurface')) Object.assign(result,PixelSources.surfaces(size,atlasOwners,topDown));
    if (bindings) Object.assign(result,bindings.finish(world,topDown));
    if (geometry.ditherView) result.ditherView = geometry.ditherView;
    if (coverage) result.coverage = topDown(coverage, 1);
    if (surfaceCoverage) result.surfaceCoverage=topDown(surfaceCoverage,1);
    if (emission) result.emission = topDown(emission, 3);
    if (scopedOwners) result.scopedEmission = { slots:topDown(scopedOwners,1), coverage:topDown(scopedCoverage,1) };
    if (selected.has('emissionDepth')) result.emissionDepth = topDown(emissionDepth, 1);
    if (selected.has('protected')) {
      const { detail, sprM, surfaceGlint } = geometry;
      result.protected = new Uint8Array(size);
      for (let p = 0; p < size; p++) {
        const bottom = (h - 1 - Math.floor(p / w)) * w + p % w;
        result.protected[p] = Number(Boolean(detail?.[p] || sprM?.[bottom] || surfaceGlint?.[bottom]));
      }
    }
    const topDepth=(selected.has('depth')||captureSurfaceMotion) && topDown(depth,1);
    if (selected.has('depth')) result.depth=topDepth;
    if (selected.has('pigment')) {
      // RGB24 plus one keeps opaque black distinct from a missing sample.
      const data=world.rest??world.data;
      const pigment=Uint32Array.from(owner,(i,p)=>{
        if (i>=0) {
          const rgb=Math.round(data[i*16+7]);
          return world.materialAlbedo?.[i] || ((rgb&255)<<16 | rgb&0xff00 | rgb>>>16&255)+1;
        }
        const color=atlasOwners?.get(p)?.color;
        return color ? color.reduce((value,n)=>value*256+Math.round(Math.min(1,Math.max(0,n))*255),0)+1 : 0;
      });
      result.pigment=topDown(pigment,1);
    }
    if (captureSurfaceMotion) {
      const motion=SurfaceMotion.capture(w,h,captureSurfaceMotion,topDepth,atlasOwners,selected);
      geometry.motionReference.surfaceMotion=motion.snapshot;
      if (motion.vectors) result.surfaceMotion=motion.vectors;
      if (motion.valid) result.surfaceMotionValid=motion.valid;
    }
    if(captureHistory){
      const labels=new Map(), keys=[null], ids=new Uint32Array(size);
      for(let p=0;p<size;p++){
        const hit=atlasOwners?.get(p), i=owner[p];
        const key=hit ? !hit.mesh?.localProjection && hit.mesh?.key && hit.mesh.key+'/'+hit.mesh.triangle : i>=0 ? i+1 : null;
        if(!key)continue;
        if(!labels.has(key)){labels.set(key,keys.length);keys.push(key);}
        ids[p]=labels.get(key);
      }
      result.historyOwners=topDown(ids,1);
      result.historyKeys=keys;
    }
    if (selected.has('surfaceKind')) {
      result.surfaceKind=topDown(Uint8Array.from(owner,(i,p)=>{
        const hit=atlasOwners?.get(p);
        return hit?.sdf ? 2 : hit?.mesh ? 1 : hit?.surface ? 5 : hit ? 4 : i>=0 ? 3 : 0;
      }),1);
    }
    if (selected.has('surfaceUV')||selected.has('surfaceUVValid')) {
      const uv=selected.has('surfaceUV') && new Float32Array(size*2), valid=new Uint8Array(size);
      for (const [p,hit] of atlasOwners ?? []) if (hit.uv) {
        if (uv) uv.set(hit.uv,p*2);
        valid[p]=255;
      }
      if (uv) result.surfaceUV=topDown(uv,2);
      result.surfaceUVValid=topDown(valid,1);
    }
    const parts = (capturePartMotion || selected.has('partId')) && PartMotion.catalog(world);
    if (selected.has('partId')) {
      for (const {object,part} of [...(geometry.representationLabels ?? []),...(geometry.surfaceLabels?.parts ?? [])])
        parts.authored(object,part);
      result.partId = topDown(Uint32Array.from(owner,(i,p)=>{
        const hit=atlasOwners?.get(p), part=hit?.mesh?.part ?? hit?.partId;
        if (part!==undefined) return parts.authored(hit.mesh?.object ?? hit.objectId,part);
        return parts.rows[i] ?? 0;
      }),1);
      result.parts = parts.parts;
    }
    const normalOut = (selected.has('normal')||selected.has('shadingNormal')) ? new Float32Array(size * 3) : null;
    const geometric = selected.has('geometricNormal') ? new Float32Array(size * 3) : null;
    const positionOut = selected.has('position') ? new Float32Array(size * 3) : null;
    const objectOut = selected.has('objectPosition') ? new Float32Array(size * 3) : null;
    const sample = (normalOut || geometric || positionOut || objectOut || capturePartMotion) && sampleFrames(world,time);
    if (capturePartMotion) {
      const motion = PartMotion.capture(w,h,parts,owner,depth,capturePartMotion,geometry,topDown,sample,atlasOwners,selected);
      geometry.motionReference.partMotion = motion.snapshot;
      if (selected.has('partMotion')) result.partMotion = motion.vectors;
      if (selected.has('partMotion') || selected.has('partMotionValid')) result.partMotionValid = motion.valid;
      if (selected.has('previousDepth')) {
        result.previousDepth = motion.previousDepth;
        result.previousDepthValid = motion.valid;
      }
    }
    if (normalOut || geometric || positionOut || objectOut) {
      const frames = new Map();
      for (let p = 0; p < size; p++) {
        const atlas=atlasOwners?.get(p);
        if (atlas) {
          if (atlas.normal) {
            normalOut?.set(atlas.normal,p*3);
            geometric?.set(atlas.biasNormal ?? atlas.normal,p*3);
          }
          positionOut?.set(atlas.position,p*3);
          objectOut?.set(atlas.objectPosition,p*3);
          if (atlas.patternPosition) (result.ditherRest ??= new Map()).set((h-1-Math.floor(p/w))*w+p%w,atlas.patternPosition);
          continue;
        }
        const i = owner[p];
        if (i < 0) continue;
        if (!frames.has(i)) frames.set(i, sample(i));
        const frame = frames.get(i);
        if (frame.normal) {
          normalOut?.set(frame.normal,p*3);
          geometric?.set(frame.normal,p*3);
        }
        if (!positionOut && !objectOut) continue;
        const x = geometry.x[i], y = geometry.y[i], z = geometry.z[i];
        const hit = frame.normal ?
          surfacePoint(geometry.rayAt(p % w + .5, Math.floor(p / w) + .5), frame.normal, x, y, z, depth[p], geometry.span) :
          [x, y, z];
        if (positionOut) positionOut.set(hit, p * 3);
        if (objectOut) {
          const offset = frame.localOffset(hit[0] - x, hit[1] - y, hit[2] - z);
          for (let k = 0; k < 3; k++) objectOut[p * 3 + k] = (frame.rest[k] ?? 0) + offset[k];
        }
      }
      if (normalOut) {
        const normals=topDown(normalOut,3);
        if (selected.has('normal')) result.normal=normals;
        if (selected.has('shadingNormal')) result.shadingNormal=normals;
      }
      if (geometric) result.geometricNormal=topDown(geometric,3);
      if (positionOut) result.position = topDown(positionOut, 3);
      if (objectOut) result.objectPosition = topDown(objectOut, 3);
      if (geometry.ditherPixelStep && result.position) {
        result.ditherFootprint = (p, space) => {
          const x = p % w, y = h - 1 - Math.floor(p / w), bottom = y * w + x;
          const atlas = atlasOwners?.get(bottom);
          const frame = frames.get(owner[bottom]);
          const footprint = ditherFootprint(geometry.rayAt, x + .5, y + .5, result.position.subarray(p * 3, p * 3 + 3),
            atlas ? atlas.normal : frame?.normal, geometry.ditherPixelStep,
            space === 'object' ? frame?.localOffset : space === 'view' ? geometry.ditherView : undefined);
          return space === 'object' && atlas?.objectScale ? footprint / atlas.objectScale : footprint;
        };
      }
    }
    for (const [channel, ids] of [['motion', owner], ['emissionMotion', emissionOwner]]) {
      if (!selected.has(channel)) continue;
      const vectors = new Float32Array(size * 2), valid = new Uint8Array(size);
      const previous = channel === 'motion' ? geometry.motionFrom : geometry.emissionMotionFrom;
      const current = geometry.motionReference;
      if (previous?.w === w && previous.h === h && previous.centers?.length === geometry.centers.length) {
        for (let p = 0; p < size; p++) {
          const i = ids[p] * 2;
          if (i < 0 || !Number.isFinite(previous.centers[i]) || !Number.isFinite(geometry.centers[i])) continue;
          const ownerId = ids[p];
          if (current?.birthIds && ownerId >= current.baseCount &&
              (current.splatSource !== previous.splatSource || current.emitterSource !== previous.emitterSource ||
                current.baseCount !== previous.baseCount ||
                current.birthIds[ownerId] !== previous.birthIds?.[ownerId])) continue;
          valid[p] = 255;
          vectors[p * 2] = geometry.centers[i] - previous.centers[i];
          vectors[p * 2 + 1] = geometry.centers[i + 1] - previous.centers[i + 1];
        }
      }
      result[channel] = topDown(vectors, 2);
      result[channel + 'Valid'] = topDown(valid, 1);
    }
    if (selected.has('splatId')) result.splatId = topDown(Uint32Array.from(owner, i => i + 1), 1);
    for (const [channel, names] of [['objectId', 'objects'], ['materialId', 'materials']]) {
      if (!selected.has(channel)) continue;
      const ids = world.renderMetadata?.[channel + 's'];
      const defaults=world.renderMetadata?.[names] || [null];
      const key=channel==='objectId' ? 'object' : 'material';
      const declared=(geometry.representationLabels ?? []).map(row=>row[key]);
      const labels = new Set([...(geometry.surfaceLabels?.[names] ?? []), ...declared]);
      for (const hit of atlasOwners?.values() ?? []) if (hit[channel] !== undefined) labels.add(hit[channel]);
      const appended = [...labels].filter(name => !defaults.includes(name)).sort();
      const table=appended?.length ? [...defaults,...appended] : defaults;
      const byName=new Map(table.map((name,i)=>[name,i]));
      result[channel]=topDown(Uint32Array.from(owner,(i,p)=>{
        const hit=atlasOwners?.get(p);
        const name = hit?.mesh?.[key] ?? hit?.[channel];
        return name===undefined ? ids?.[i] || 0 : byName.get(name) ?? 0;
      }),1);
      result[names]=table;
    }
    return result;
  }

  return { fragment, sprite, finalize };
}

function selectVisibleSubjects(world, owners, selectors) {
  const index = TargetSelectors.index(world), seen = new Map();
  return Uint8Array.from(owners, id=>{
    if (!id || id>world.count) return 0;
    const target = index.row(id-1);
    if (!seen.has(target)) seen.set(target,selectors.reduce((bits,select,i)=>
      TargetSelectors.matches(select,target) ? bits | 1<<i : bits,0));
    return seen.get(target);
  });
}

module.exports = { createArtPasses, sampleFrames, selectVisibleSubjects };
