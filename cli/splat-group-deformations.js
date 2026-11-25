'use strict';

const Provenance = require('../src/splat-provenance.js');
const Targets = require('../src/target-selectors.js');
const ScanRotation = require('./splat-scan-rotation.js');

const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => keys.includes(key));
const bounded = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const point = value => Array.isArray(value) && value.length === 3 &&
  Array.from(value).every(n => bounded(n, -1e6, 1e6));
const groupLimit = 32, memberLimit = 32768, modifierLimit = 8;

function modifierMap(modifier, pivot, {deform, V}) {
  const {type, axis, side, length, angle, amount, bounds, size, handles} = modifier ?? {};
  if (type === 'bend' || type === 'taper') {
    const isBend = type === 'bend';
    if (!fields(modifier, isBend ? ['type','axis','side','length','angle'] : ['type','axis','length','amount']) ||
        !point(axis) || V.len(axis) < 1e-6 || !bounded(length, .001, 1e6) ||
        (isBend ? !bounded(angle, -180, 180) || !point(side) || V.len(side)<1e-6 ||
          V.len(V.cross(V.norm(axis), V.norm(side))) < 1e-6 : !bounded(amount, -.95, .95)))
      throw new RangeError('Invalid splat group ' + type + ' modifier');
    return deform.morph({base:pivot, up:axis, side, height:length,
      ...(isBend ? {arc:angle * Math.PI / 180} : {taper:amount})});
  }
  if (type !== 'lattice' || !fields(modifier, ['type','bounds','size','handles']) ||
      !fields(bounds, ['min','max']) || !point(bounds.min) || !point(bounds.max) ||
      !bounds.min.every((n,i) => bounds.max[i] - n >= .001) ||
      !point(size) || !size.every(n => Number.isInteger(n) && n>=2 && n<=5) ||
      !Array.isArray(handles) || handles.length > size[0]*size[1]*size[2])
    throw new RangeError('Invalid splat group lattice modifier');
  const map = deform.lattice({min:V.add(pivot,bounds.min), max:V.add(pivot,bounds.max)}, size);
  const used = new Set();
  for (const handle of handles) {
    if (!fields(handle, ['at','offset']) || !point(handle.at) || !point(handle.offset) ||
        !handle.at.every((n,i) => Number.isInteger(n) && n>=0 && n<size[i]) ||
        used.has(String(handle.at)))
      throw new RangeError('Invalid or duplicate splat group lattice handle');
    used.add(String(handle.at));
    map.move(...handle.at, handle.offset);
  }
  return map;
}

function falloffAt(falloff, pivot) {
  if (falloff === undefined) return () => 1;
  const { center = pivot, inner = 0, outer } = falloff ?? {};
  if (!fields(falloff, ['center','inner','outer']) || !point(center) || !bounded(inner,0,1e6) ||
      !bounded(outer,.001,1e6) || outer<=inner)
    throw new RangeError('Splat group falloff needs a center and increasing inner and outer radii');
  return p => {
    const distance = Math.hypot(p[0]-center[0],p[1]-center[1],p[2]-center[2]);
    const t = Math.max(0, Math.min(1, (outer-distance)/(outer-inner)));
    return t*t*(3-2*t);
  };
}

function extendBounds(box, p) {
  box.min = box.min.map((n,i) => Math.min(n,p[i]));
  box.max = box.max.map((n,i) => Math.max(n,p[i]));
}

function prepare(world, groups, {target, attributes, retired, eligible}) {
  if (!Array.isArray(groups) || groups.length>groupLimit)
    throw new RangeError('Splat fit needs a bounded group list');
  const { M, V, deform } = require('../index.js').load().KIT;
  const ids = Provenance.identities(world), owner = Targets.index(world).row, rest = Provenance.restData(world);
  const names = new Set(), affected = new Map(), report = [], identity = M.id();
  let visits = 0;
  for (const group of groups) {
    const {id, pivot, members, mask = [], falloff, modifiers} = group ?? {};
    if (!fields(group,['id','pivot','members','mask','falloff','modifiers']) || !Targets.name(id) ||
        names.has(id) || !point(pivot) || !Array.isArray(members) || !members.length ||
        !Array.isArray(mask) || mask.length>members.length || !Array.isArray(modifiers) ||
        !modifiers.length || modifiers.length>modifierLimit || (visits += members.length)>memberLimit)
      throw new RangeError('Invalid, duplicate, or over-budget splat group ' + id);
    names.add(id);
    const rows = new Map();
    for (const member of members) {
      const row = ids.rowOf(member);
      if (rows.has(member) || row<0 || retired?.has(row) || !eligible(world,row) ||
          !Targets.objectScope(target,owner(row)))
        throw new RangeError('Invalid, duplicate, or unavailable splat group member ' + member);
      rows.set(member,row);
    }
    const weights = new Map();
    for (const entry of mask) {
      if (!Array.isArray(entry) || entry.length!==2 || !rows.has(entry[0]) ||
          weights.has(entry[0]) || !bounded(entry[1],0,1))
        throw new RangeError('Splat group mask needs distinct member IDs and weights from 0 to 1');
      weights.set(...entry);
    }
    const radial = falloffAt(falloff,pivot);
    const stack = deform.chain(...modifiers.map(op => modifierMap(op,pivot,{deform,V})));
    const before = {min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    const after = {min:before.min.slice(),max:before.max.slice()};
    let influenced = 0, minDeterminant = Infinity;
    for (const [member,row] of rows) {
      const sourcePoint = Array.from(rest.subarray(row*16,row*16+3));
      const input = attributes?.get(row)?.position ?? Array.from(world.data.subarray(row*16,row*16+3));
      const prior = affected.get(row);
      const center = prior?.position ?? input;
      const maskWeight = weights.get(member) ?? 1;
      extendBounds(before,center);
      if (!maskWeight || !radial(sourcePoint)) {
        extendBounds(after,center);
        continue;
      }
      // Perturb the source and the current point together. A falloff edge changes
      // the differential as well as the center, including through earlier groups.
      const basis = prior?.matrix ?? M.id();
      const map = delta => {
        const p = V.add(center, M.app(basis,delta));
        const weight = maskWeight * radial(V.add(sourcePoint,delta));
        return V.add(p,V.mul(V.sub(stack(p),p),weight));
      };
      const position = map([0,0,0]), matrix = deform.jac(map,[0,0,0],1e-5);
      const determinant = M.det(matrix);
      if (!point(position) || !bounded(determinant,1e-5,1e6) || !matrix.every(n=>bounded(n,-100,100)) ||
          !M.inv(matrix).every(n=>bounded(n,-100,100)))
        throw new RangeError('Splat group ' + id + ' folds or collapses near ' + member);
      influenced++;
      minDeterminant = Math.min(minDeterminant,determinant);
      if (prior || V.dist(input,position)>1e-8 || matrix.some((v,i)=>Math.abs(v-identity[i])>1e-8))
        affected.set(row,{position,matrix});
      extendBounds(after,position);
    }
    report.push({id, members:rows.size, influenced, pinned:rows.size-influenced,
      modifiers:modifiers.map(op=>op.type), before, after,
      minDeterminant:influenced ? minDeterminant : null});
  }
  return {affected,report,...ScanRotation.transport(world,affected,M)};
}

module.exports = {prepare};
