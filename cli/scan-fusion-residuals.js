'use strict';

const SH0=.28209479177387814;
const counts=()=>({matched:0,hidden:0,conflict:0,appearance:0,relief:0,uncovered:0,duplicate:0,budget:0});

function collect(views,proxy,settings,kit) {
  const {V,M,Q}=kit, {resolution,supportTolerance,conflictTolerance,residualLimit,rgbThreshold}=settings;
  const trace=residualLimit && kit.sceneMeshes.rayQuery(proxy,kit), sources=[], ranked=[], reasons=counts();
  const sourceStride=Math.max(1,Math.ceil(views.reduce((n,view)=>n+view.model.count,0)/140000));
  for (const view of views) {
    let i=0;
    for (const sample of view.model.observations()) {
      if (i++%sourceStride) continue;
      const normal=V.norm(M.app(view.matrix,sample.normal)), position=view.toWorld(sample.position);
      const [sx,sy]=view.camera.scaleAt(sample.d).map(n=>n*view.model.stride);
      const [x,y,z]=sample.normal, w=1+z,length=Math.hypot(x,y,w);
      const rotation=Q.mul(view.rotation,length>1e-8 ? [-y/length,x/length,0,w/length] : [0,1,0,0]);
      const row={position,normal,rotation,scale:[sx*.53,sy*.53,Math.min(sx,sy)*.1],
        color:sample.color,view:view.id,pixel:[sample.u,sample.v]};
      sources.push(row);
      if (!residualLimit) continue;
      const origin=view.perspective ? view.position : view.toWorld([sample.position[0],sample.position[1],0]);
      const vector=V.sub(position,origin), range=V.len(vector), direction=V.mul(vector,1/range);
      const hit=trace({origin,direction,maxDistance:Infinity});
      const gap=hit ? hit.distance-range : Infinity;
      if (gap< -supportTolerance) { reasons.hidden++; continue; }
      if (views.some(other=>{
        if (other===view) return false;
        const facing=other.perspective ? V.norm(V.sub(other.position,position)) : other.front;
        if (V.dot(normal,facing)<.28) return false;
        const answer=other.project(position);
        return answer&&answer.gap>conflictTolerance&&other.confidence(answer)>.27;
      })) { reasons.conflict++; continue; }
      let error=0;
      if (hit) {
        const rgb=[hit.pigment>>16,hit.pigment>>8&255,hit.pigment&255];
        error=Math.max(...rgb.map((n,k)=>Math.abs(n-sample.color[k]*255)));
      }
      const reason=!hit ? 'uncovered' : gap>supportTolerance ? 'relief' : error>=rgbThreshold ? 'appearance' : 'matched';
      if (reason==='matched') { reasons.matched++; continue; }
      const bias=Math.min(Math.max(sx,sy)*.2,supportTolerance*.2);
      ranked.push({...row,reason,position:reason==='appearance' ? V.add(hit.point,V.mul(hit.normal,bias)) : position,
        score:reason==='appearance' ? error : 255+(hit ? Math.min(255,gap/supportTolerance) : 256)});
    }
  }
  ranked.sort((a,b)=>b.score-a.score);
  const cells=new Map(), chosen=[], spacing=resolution*.56;
  for (const row of ranked) {
    const key=row.position.map(n=>Math.floor(n/spacing)).join(',');
    const cell=cells.get(key)??[];
    if (cell.some(normal=>V.dot(normal,row.normal)>.75)) { reasons.duplicate++; continue; }
    cell.push(row.normal);
    cells.set(key,cell);
    if (chosen.length>=residualLimit) { reasons.budget++; continue; }
    chosen.push(row);
    reasons[row.reason]++;
  }
  return {sources,chosen,reasons,sourceStride};
}

function cloud(rows) {
  const count=rows.length, positions=new Float32Array(count*3), scales=new Float32Array(count*3),
    normals=new Float32Array(count*3), dc=new Float32Array(count*3), rotations=new Float32Array(count*4);
  rows.forEach((row,i)=>{
    positions.set(row.position,i*3); normals.set(row.normal,i*3); scales.set(row.scale,i*3);
    rotations.set(row.rotation,i*4); dc.set(row.color.map(n=>(n-.5)/SH0),i*3);
  });
  return {count,degree:0,positions,scales,rotations,normals,dc,opacity:new Float32Array(count).fill(.93),sh:new Float32Array()};
}

module.exports={collect,cloud};
