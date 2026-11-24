'use strict';

const { cutoff } = require('../src/art-passes.js');
const Targets = require('../src/target-selectors.js');
const PartMotion = require('./part-motion.js');

const minimumCoverage = 1e-6;

function create(world,w,h,request) {
  const { object,part,isolated = false } = request;
  if (Object.keys(request).some(key=>!['object','part','isolated'].includes(key)) ||
      typeof isolated !== 'boolean') throw new TypeError('Invalid pixel selection capture');
  const target = Targets.prepare({object,...(part !== undefined && {part})});
  const matches = subject => !!Targets.objectScope(target,subject);
  const { row } = Targets.index(world);
  const parts = part !== undefined ? PartMotion.catalog(world) : null;
  const rows = Uint8Array.from({length:world.count},(_,i)=>{
    const label = row(i), namedPart = parts?.parts[parts.rows[i]];
    return Number(matches(namedPart && !label.part ? { ...label,part:namedPart.part } : label));
  });
  const coverage = new Float32Array(w*h);
  function owns(i,hit) {
    if (!hit) return !!rows[i];
    const label = hit.source?.identity ?? hit.row?.target ?? hit.mesh ??
      { object:hit.objectId,part:hit.partId };
    return matches(label) || (!label.object && !label.entity && !!rows[i]);
  }
  return { isolated,row:i=>!!rows[i],matches,
    fragment(p,i,hit,alpha,writesDepth = false) {
      // Depth-writing cores own the pixel. Soft edges still admit contributed coverage.
      const through = writesDepth && alpha > cutoff ? 0 : 1-alpha;
      coverage[p] = coverage[p]*through+(owns(i,hit) ? alpha : 0);
    },
    finish() {
      const top = new Float32Array(coverage.length);
      for (let y=0; y<h; y++) top.set(coverage.subarray(y*w,(y+1)*w),(h-y-1)*w);
      return { w,h,scene:world.id ?? world.spec?.id,object,...(part !== undefined && {part}),isolated,coverage:top };
    }
  };
}

module.exports = { create, minimumCoverage };
