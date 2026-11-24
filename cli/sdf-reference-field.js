const ColorSpace = require('../src/color-space.js');
const Optical = require('../src/optical-materials.js');
const RenderStages = require('../src/render-stages.js');
const SdfPose = require('./sdf-pose.js');
const { slab } = require('../src/scene-optics.js');

const linear = ColorSpace.prepare('srgb', 'srgb-linear');
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const along = (a,b,t) => [a[0]+b[0]*t,a[1]+b[1]*t,a[2]+b[2]*t];
const clamp = (n,a = 0,b = 1) => Math.min(b,Math.max(a,n));

function materials(palette, roles) {
  const profiles = new WeakMap();
  const color = value => linear(RenderStages.unpack(RenderStages.albedo(value, palette, roles)));
  return mat => {
    if (profiles.has(mat)) return profiles.get(mat);
    const albedo = color(mat.albedo ?? mat.r?.at(-1) ?? 0);
    const em = mat.em ? albedo.map(n => n * (typeof mat.em === 'number' ? Math.max(0,mat.em) : 2)) : null;
    const optical = mat.optical && Optical.material(mat.optical);
    const layer = Object.values(mat.surface?.layers ?? {}).find(value => value?.type === 'transmission');
    let glass, thin;
    if (optical || mat.glass || !layer && mat.a < 1) {
      glass = {
        ior: mat.glass ? 1.45 : 1,
        reflect: optical?.reflection ?? (mat.glass ? .034 : 0),
        extinction: optical ? (optical.absorption + optical.scattering) * optical.depth.scale : 0,
        interfaceTint: optical ? [1,1,1] : albedo.map(n => n**.25),
        mirrorTint: optical ? linear(optical.reflectionColor) : [1,1,1],
        uncovered: 1 - (optical?.coverage ?? (mat.glass ? 0 : clamp(mat.a)))
      };
    } else if (layer) {
      const rgb = layer.color === undefined ? albedo : color(layer.color);
      thin = { rgb, strength: clamp(layer.strength ?? 1), thickness: Math.max(0,layer.thickness ?? .24),
        source: layer.source ?? 'both' };
    }
    const profile = { albedo, em, glass, thin };
    profiles.set(mat,profile);
    return profile;
  };
}

function bind(world, epsilon, steps, posed = false) {
  const palette = world.pal;
  const profile = materials(palette,world.paletteRoles), rows = new Uint8Array(world.count);
  const boned = new Set(world.anim?.boned ?? []), sources = [];
  const rangesByOwner = new Map(), trees = new Map(), normals = world.renderMetadata?.normals;
  const { nearest } = require('../index.js').load().KIT.procedural.attributes;
  let excludedMoving = 0;
  for (const source of world.referenceSdfs ?? []) {
    if (posed && world.anim?.bones) {
      for (const [key,group] of SdfPose.groups(world,source,(i,rest)=>{
        const flags=Math.round(rest[i*16+11]);
        return [0,1,7,12].includes(flags&15) && !(flags&8704);
      },source.bind)) {
        const motion=SdfPose.transform(key,world.anim.bones);
        if (motion===false) continue;
        for (const owner of group.owners) {
          const ranges=source.rows.get(owner) ?? [];
          for (const [start,end] of ranges) rows.fill(1,start,end);
          rangesByOwner.set(owner,ranges);
        }
        sources.push(...group.fields.map(field=>SdfPose.field(field,motion)));
      }
      continue;
    }
    const allowed = new Set();
    for (const [owner,ranges] of source.rows) {
      let moved = Boolean(owner.born !== undefined || owner.mat.motionAt);
      for (const [start,end,saved] of ranges) {
        for (let i = start; !moved && i < end; i++) {
          const j = i * 16, k = (i-start)*3, flags = Math.round(world.data[j+11]), kind = flags & 15;
          moved = i >= world.count || world.anim?.geometryOwned?.[i] || world.anim?.rig?.bid?.[i] ||
            boned.has(i) || (kind !== 0 && kind !== 1 && kind !== 7) || (flags & 8704) !== 0 ||
            world.data[j] !== saved[k] || world.data[j+1] !== saved[k+1] || world.data[j+2] !== saved[k+2];
        }
      }
      if (moved) { excludedMoving++; continue; }
      allowed.add(owner);
      rangesByOwner.set(owner,ranges);
      for (const [start,end] of ranges) rows.fill(1,start,end);
    }
    sources.push(...source.bind(owner => allowed.has(owner)));
  }
  if (!sources.length) throw new RangeError('SDF reference needs at least one retained finite static sculpt');
  const stats = { fields: sources.length, excludedMoving, rays: 0, stepLimit: 0 };
  const bias = epsilon * 4;
  function support(hit) {
    if (!trees.has(hit.owner)) {
      const points = [], ids = [];
      for (const [start,end,saved] of rangesByOwner.get(hit.owner) ?? []) {
        for (let i=start;i<end;i++) {
          const k=(i-start)*3;
          points.push([saved[k],saved[k+1],saved[k+2]]);
          ids.push(i);
        }
      }
      trees.set(hit.owner,points.length ? { ids, search: nearest({points,entities:ids,read:i=>ids[i]}) } : null);
    }
    const tree = trees.get(hit.owner);
    return tree?.search.sample(hit.point,i=>{
      if (!normals) return true;
      const j=tree.ids[i]*3, x=normals[j], y=normals[j+1], z=normals[j+2];
      return x*x+y*y+z*z<.25 || hit.normal[0]*x+hit.normal[1]*y+hit.normal[2]*z>.4;
    })?.distance ?? Infinity;
  }
  function normalAt(field, [x,y,z]) {
    const dx = field(x+epsilon,y,z)-field(x-epsilon,y,z);
    const dy = field(x,y+epsilon,z)-field(x,y-epsilon,z);
    const dz = field(x,y,z+epsilon)-field(x,y,z-epsilon);
    const length = Math.hypot(dx,dy,dz);
    return length > 1e-10 && Number.isFinite(length) ? [dx/length,dy/length,dz/length] : null;
  }
  function intersect(origin, direction, near, far, candidates = sources) {
    stats.rays++;
    let closest;
    for (const source of candidates) {
      const { min,max } = source.bounds, range = [near, closest?.t ?? far];
      if (!slab(range,origin[0],direction[0],min[0],max[0]) ||
          !slab(range,origin[1],direction[1],min[1],max[1]) ||
          !slab(range,origin[2],direction[2],min[2],max[2])) continue;
      const field = source.distance;
      let t = range[0], step = 0;
      for (; step < steps && t < range[1]; step++) {
        const x = origin[0]+t*direction[0], y = origin[1]+t*direction[1], z = origin[2]+t*direction[2];
        const distance = field(x,y,z), magnitude = Math.abs(distance);
        if (!Number.isFinite(magnitude)) break;
        if (magnitude > epsilon) { t += .72*magnitude; continue; }
        const point = [x,y,z];
        const normal = normalAt(field,point);
        if (normal && (!source.accepts || source.accepts(...point))) {
          const hit = source.surface(point,normal);
          if (hit && !hit.material.skip) {
            closest = { ...hit, source, t, point, normal, profile: profile(hit.material),
              front: dot(normal,direction) < 0 };
            break;
          }
        }
        t += bias / Math.max(.12, normal ? Math.abs(dot(normal,direction)) : 1);
      }
      if (step === steps && t < range[1]) stats.stepLimit++;
    }
    return closest;
  }
  return { rows, stats, bias, intersect, support };
}

module.exports = { bind, dot, along, clamp, linear };
