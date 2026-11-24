'use strict';

function plan({ mode,settings,grid,attachment,frame,owner,skipped,K,guard }) {
  const { V,procedural:{freeformSculpt:api} }=K;
  const { projection,marks }=attachment;
  const stamps=[], hits=[];
  for (const { at,sourceAt,position,normal,depth } of marks) {
    const tangent=V.norm(V.mad(projection.right,normal,-V.dot(projection.right,normal)));
    if (V.len(tangent)<.99) { skipped.push({at,sourceAt,code:'brush-tangent-unavailable'}); continue; }
    const across=V.norm(V.cross(normal,tangent)), angle=(settings.angle ?? 0)*Math.PI/180;
    const along=V.mad(V.mul(tangent,Math.cos(angle)),across,Math.sin(angle));
    const basis=[along,V.norm(V.cross(normal,along)),normal];
    const worldPerPixel=V.len(projection.right)*(projection.perspective ? depth : 1);
    const radius=api.radius(settings.size,worldPerPixel);
    const origin=frame.point(...position);
    const drag=settings.delta;
    if (drag && V.len(drag)>radius*.45+1e-9) {
      skipped.push({at,sourceAt,code:'grab-displacement-exceeds-radius',radiusWorld:radius});
      continue;
    }
    const toRest=axis=>V.sub(frame.point(...V.add(position,axis)),origin);
    const stamp={origin,axes:basis.map(toRest),radius,...(drag && {drag:basis.map(axis=>V.dot(axis,drag))})};
    const placements=settings.mirror ? [stamp,api.reflect(stamp,settings.mirror)] : [stamp];
    const accepted=[];
    for (const [i,row] of placements.entries()) {
      const {bounds}=api.prepare({mode,strength:settings.strength,depth:settings.depth,stamps:[row]});
      const corners=[bounds.min[0],bounds.max[0]].flatMap(x=>[bounds.min[1],bounds.max[1]].flatMap(y=>
        [bounds.min[2],bounds.max[2]].map(z=>[x,y,z])));
      const mirrored=i>0;
      const protection=guard(corners,'cut') ?? (!['scrape','crease'].includes(mode) && guard(corners,'add'));
      if (protection) { skipped.push({at,sourceAt,mirrored,...protection}); continue; }
      stamps.push(row);
      accepted.push({ rest:row.origin,mirrored });
    }
    if (accepted.length) hits.push({at,sourceAt,rest:origin,surfaceDepth:depth,radiusWorld:radius,stamps:accepted});
  }
  if (!stamps.length) return;
  const program=api.prepare({ mode,strength:settings.strength,depth:settings.depth,stamps });
  const base=(...p)=>owner.sd(...frame.rest(...p))*frame.distanceScale;
  const field=program.field(base);
  // Probe several cross sections at capture time. These are occupancy samples, so
  // tangential edits have evidence even when the center ray has the same depth.
  let added=0,removed=0,samples=0;
  for (const {origin,axes,radius} of program.stamps) {
    for (const u of [-.68,-.34,0,.34,.68]) for (const v of [-.68,-.34,0,.34,.68]) {
      const tangent=V.mad(V.mad(origin,axes[0],u*radius),axes[1],v*radius);
      for (let j=0;j<32;j++) {
        const q=V.mad(tangent,axes[2],((j+.5)/16-1)*radius);
        const before=base(...q)<0, after=field(...q)<0;
        samples++;
        if (before && !after) removed++;
        if (!before && after) added++;
      }
    }
  }
  const brush={version:3,grid,settings,attachment,stamps};
  return {modifier:{kind:'grid-brush',mode,brush},report:{mode,grid,settings,
    projectedPixels:hits.length,hits,skippedHits:skipped,
    volume:{space:'solid-rest',bounds:program.bounds},
    occupancyProbes:{samples,added,removed},
    attachment:{ ...attachment.source,time:attachment.time }}};
}

module.exports = { plan };
