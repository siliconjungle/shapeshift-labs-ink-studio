'use strict';

const { cutoff } = require('../src/art-passes.js');
const Targets = require('../src/target-selectors.js');
const PartMotion = require('./part-motion.js');

const minimumCoverage = 1e-6;

function create(world,w,h,request) {
  const { object,part,objects,isolated = false,captureDepth = false,review } = request;
  const reviewScope = review !== undefined;
  if (Object.keys(request).some(key=>!['object','part','objects','isolated','captureDepth','review'].includes(key)) ||
      reviewScope && (object !== undefined || part !== undefined || objects !== undefined || isolated ||
        typeof review?.matches !== 'function' || review.allow !== undefined && typeof review.allow !== 'function') ||
      objects !== undefined && (!Array.isArray(objects) || object !== undefined || part !== undefined ||
        !Array.from(objects).every(Targets.name)) ||
      typeof isolated !== 'boolean' || typeof captureDepth !== 'boolean') throw new TypeError('Invalid pixel selection capture');
  const target = !reviewScope && objects === undefined && Targets.prepare({object,...(part !== undefined && {part})});
  const group = objects !== undefined && new Set(objects);
  const matches = reviewScope ? review.matches : subject => group ?
    group.has(subject.object) || group.has(subject.entity) : !!Targets.objectScope(target,subject);
  const { row } = Targets.index(world);
  const parts = part !== undefined ? PartMotion.catalog(world) : null;
  const rows = Uint8Array.from({length:world.count},(_,i)=>{
    const label = row(i), namedPart = parts?.parts[parts.rows[i]];
    return Number(matches(namedPart && !label.part ? { ...label,part:namedPart.part } : label));
  });
  const allow = reviewScope ? review.allow : isolated ? matches : undefined;
  const allowed = allow && allow !== matches ? Uint8Array.from({length:world.count},(_,i)=>Number(allow(row(i)))) : rows;
  const filter = allow && { matches: allow, row: i => !!allowed[i] };
  const coverage = new Float32Array(w*h);
  const depth = captureDepth ? new Float32Array(w*h).fill(Infinity) : null;
  const topDown = values=>{
    const top = new Float32Array(values.length);
    for (let y=0; y<h; y++) top.set(values.subarray(y*w,(y+1)*w),(h-y-1)*w);
    return top;
  };
  function owns(i,hit) {
    if (!hit) return !!rows[i];
    const label = hit.source?.identity ?? hit.row?.target ?? hit.mesh ??
      { object:hit.objectId,part:hit.partId };
    return matches(label) || (!label.object && !label.entity && !!rows[i]);
  }
  return { isolated, filter, review: reviewScope, row:i=>!!rows[i],matches,
    fragment(p,i,hit,alpha,writesDepth = false,z = Infinity) {
      // Depth-writing cores own the pixel. Soft edges still admit contributed coverage.
      const through = writesDepth && alpha > cutoff ? 0 : 1-alpha;
      const selected = owns(i,hit);
      coverage[p] = coverage[p]*through+(selected ? alpha : 0);
      if (depth) {
        if (!through || coverage[p] <= minimumCoverage) depth[p] = Infinity;
        if (selected && alpha > minimumCoverage) depth[p] = Math.min(depth[p],z);
      }
    },
    finish() {
      return { w,h,scene:world.id ?? world.spec?.id,...(reviewScope ? {} : group ? {objects:[...group]} : {object,...(part !== undefined && {part})}),isolated,
        coverage:topDown(coverage),...(depth && { depth:topDown(depth) }) };
    }
  };
}

module.exports = { create, minimumCoverage };
