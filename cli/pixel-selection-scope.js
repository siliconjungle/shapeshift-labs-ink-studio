'use strict';

const { cutoff } = require('../src/art-passes.js');
const Targets = require('../src/target-selectors.js');
const PartMotion = require('./part-motion.js');

const minimumCoverage = 1e-6;

function create(world,w,h,request) {
  const { object,part,isolated = false,captureDepth = false } = request;
  if (Object.keys(request).some(key=>!['object','part','isolated','captureDepth'].includes(key)) ||
      typeof isolated !== 'boolean' || typeof captureDepth !== 'boolean') throw new TypeError('Invalid pixel selection capture');
  const target = Targets.prepare({object,...(part !== undefined && {part})});
  const matches = subject => !!Targets.objectScope(target,subject);
  const { row } = Targets.index(world);
  const parts = part !== undefined ? PartMotion.catalog(world) : null;
  const rows = Uint8Array.from({length:world.count},(_,i)=>{
    const label = row(i), namedPart = parts?.parts[parts.rows[i]];
    return Number(matches(namedPart && !label.part ? { ...label,part:namedPart.part } : label));
  });
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
  return { isolated,row:i=>!!rows[i],matches,
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
      return { w,h,scene:world.id ?? world.spec?.id,object,...(part !== undefined && {part}),isolated,
        coverage:topDown(coverage),...(depth && { depth:topDown(depth) }) };
    }
  };
}

module.exports = { create, minimumCoverage };
