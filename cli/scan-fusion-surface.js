'use strict';

const {point,validId,inRange}=require('./scan-fusion-views.js');

const observed='observed', conflict='conflict', fillStatus='approved-fill';
const boundedText=v=>typeof v==='string'&&v.trim().length>0&&v.length<=256;

function fillsFor(list,views) {
  if (!Array.isArray(list)||list.length>128) throw new RangeError('Scan fusion supports up to 128 approved fills');
  const used=new Set(views.map(view=>view.id));
  let faces=0, points=0;
  return list.map(fill=>{
    const {id,vertices,triangles,color,approval}=fill??{};
    if (!validId(id)||used.has(id)||!boundedText(approval?.by)||!boundedText(approval?.reason)||
        !Array.isArray(vertices)||vertices.length<3||(points+=vertices.length)>16384||
        !vertices.every(v=>point(v))||!Array.isArray(triangles)||!triangles.length||(faces+=triangles.length)>8192||
        !triangles.every(tri=>Array.isArray(tri)&&tri.length===3&&new Set(tri).size===3&&
          Array.from(tri).every(i=>Number.isSafeInteger(i)&&i>=0&&i<vertices.length))||
        !point(color)||!color.every(n=>Number.isInteger(n)&&n>=0&&n<=255))
      throw new RangeError('An approved scan fill needs distinct IDs, triangles, RGB bytes and approval by and reason');
    used.add(id);
    return {id,vertices,triangles,color,approval:{by:approval.by,reason:approval.reason}};
  });
}

function boundsFor(views, bounds, truncation) {
  if (bounds!==undefined) {
    if (!point(bounds?.min)||!point(bounds?.max)||bounds.min.some((v,i)=>v>=bounds.max[i]))
      throw new RangeError('Scan fusion needs increasing world-space min and max bounds');
    return {min:bounds.min.slice(),max:bounds.max.slice()};
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for (const view of views) for (let i=0;i<view.d.length;i++) {
    const d=view.d[i];
    if (!d) continue;
    const p=view.toWorld(view.pixel(i%view.width,Math.floor(i/view.width),d));
    for (let k=0;k<3;k++) {
      min[k]=Math.min(min[k],p[k]);
      max[k]=Math.max(max[k],p[k]);
    }
  }
  if (!min.concat(max).every(n=>inRange(n,-1e6,1e6)))
    throw new RangeError('Registered scan positions exceed the supported range');
  return {min:min.map(n=>n-truncation),max:max.map(n=>n+truncation)};
}

function reconstruct(views,fills,bounds,settings,kit) {
  const {V,procedural:{geometry}}=kit;
  const {resolution,truncation,supportTolerance,conflictTolerance,maxCells,maxTriangles}=settings;
  const nominalCells=bounds.max.reduce((product,n,i)=>product*Math.ceil((n-bounds.min[i])/resolution),1);
  if (nominalCells>maxCells)
    throw new RangeError('Scan fusion grid exceeds its cell budget. Increase resolution size or tighten bounds.');
  const positions=[], faces=[], byPosition=new Map(), duplicate=new Set();
  const samples={unsupported:0,band:0,multiView:0,freeOnly:0};
  const precision=1/Math.max(1e-8,resolution*1e-5);
  let unsupportedFaces=0;
  function field(p) {
    let distance=0,total=0,support=0,free=false;
    for (const view of views) {
      const hit=view.project(p);
      if (!hit) continue;
      if (hit.gap>truncation) free=true;
      if (Math.abs(hit.gap)>truncation) continue;
      const angle=view.confidence(hit), weight=view.weight*angle*angle;
      distance+=weight*hit.gap*angle;
      total+=weight;
      support++;
    }
    samples[support ? 'band' : 'unsupported']++;
    if (support>1) samples.multiView++;
    if (!support&&free) samples.freeOnly++;
    return total ? distance/total : null;
  }
  function evidence(p,normal) {
    const hits=[];
    for (const view of views) {
      const toward=view.perspective ? V.norm(V.sub(view.position,p)) : view.front;
      const facing=V.dot(normal,toward);
      if (facing<.1) continue;
      const sample=view.project(p);
      if (!sample||sample.gap< -truncation) continue;
      const certainty=view.confidence(sample);
      // Grazing rays at a real silhouette do not reliably disprove a surface.
      if (sample.gap>truncation&&(facing<.32||certainty<.27)) continue;
      hits.push({view, ...sample, score:facing*facing*certainty*view.weight,
        aligned:Math.abs(sample.gap)<=supportTolerance});
    }
    const aligned=hits.filter(hit=>hit.aligned);
    // Deep free-space samples can flag a face, but cannot create one.
    const local=hits.filter(hit=>Math.abs(hit.gap)<=truncation);
    if (!local.length) return;
    const gaps=hits.map(hit=>hit.gap), spread=Math.max(...gaps)-Math.min(...gaps);
    const disputed=(hits.length>1&&spread>conflictTolerance)||!aligned.length;
    const sources=aligned.length ? aligned : local;
    sources.sort((a,b)=>b.score-a.score||Math.abs(a.gap)-Math.abs(b.gap)||(a.view.id<b.view.id ? -1 : a.view.id>b.view.id ? 1 : 0));
    return {status:disputed ? conflict : observed, primary:sources[0].view.id,
      views:hits.map(({view,u,v,measured,gap,aligned})=>({id:view.id,pixel:[u,v],depth:measured,delta:gap,aligned}))};
  }
  function face(a,b,c,record) {
    const v=[a,b,c].map(p=>{
      const key=p.map(n=>Math.round(n*precision)).join(',');
      if (!byPosition.has(key)) byPosition.set(key,positions.push(p)-1);
      return byPosition.get(key);
    });
    if (new Set(v).size!==3) return;
    const key=v.slice().sort((x,y)=>x-y).join(',');
    if (duplicate.has(key)) {
      if (record.status===fillStatus) throw new RangeError('Approved scan fill repeats an existing face: '+record.primary);
      return;
    }
    if (faces.length>=maxTriangles) throw new RangeError('Scan fusion exceeds its triangle budget. Increase resolution size.');
    duplicate.add(key);
    faces.push({id:'face-'+faces.length,vertices:v,...record});
  }
  const sampling=geometry.implicitTriangles(field,bounds,{resolution,maxCells,allowMissing:true},(a,b,c,normal)=>{
    const center=V.mul(V.add(V.add(a,b),c),1/3), record=evidence(center,normal);
    if (record) face(a,b,c,record);
    else unsupportedFaces++;
  });
  const measuredFaces=faces.length;
  if (!measuredFaces) throw new RangeError('The registered views produced no supported proxy faces. Check registration and resolution.');
  let fillSamples=0;
  for (const fill of fills) for (const indices of fill.triangles) {
    const points=indices.map(i=>fill.vertices[i]), [a,b,c]=points;
    const scale=V.len(V.cross(V.sub(b,a),V.sub(c,a)));
    if (scale<1e-10) throw new RangeError('Approved scan fill contains a degenerate face: '+fill.id);
    if (points.some(p=>p.some((n,k)=>n<bounds.min[k]||n>bounds.max[k])))
      throw new RangeError('Approved scan fill lies outside the fusion bounds: '+fill.id);
    const center=V.mul(V.add(V.add(a,b),c),1/3);
    const steps=Math.max(3,Math.ceil(Math.max(V.dist(a,b),V.dist(b,c),V.dist(c,a))/resolution));
    const count=(steps-1)*(steps-2)/2+1;
    if ((fillSamples+=count)*views.length>500000)
      throw new RangeError('Approved scan fill exceeds its measurement review budget');
    const probes=[center];
    for (let u=1;u<steps-1;u++) for (let v=1;v<steps-u;v++)
      probes.push(V.mad(V.lerp(a,b,u/steps),V.sub(c,a),v/steps));
    if (probes.some(p=>views.some(view=>{
      const hit=view.project(p);
      return hit&&hit.gap>= -supportTolerance;
    }))) throw new RangeError('Approved scan fill overlays a measurement or known free space: '+fill.id);
    face(a,b,c,{status:fillStatus,primary:fill.id,approval:fill.approval});
  }
  const edges=new Map();
  for (const row of faces) for (let i=0;i<3;i++) {
    const a=row.vertices[i],b=row.vertices[(i+1)%3], key=a<b ? a+','+b : b+','+a;
    if (!edges.has(key)) edges.set(key,{vertices:a<b?[a,b]:[b,a],faces:[]});
    edges.get(key).faces.push(row.id);
  }
  const boundaries=[], boundaryFaces=new Set();
  for (const edge of edges.values()) if (edge.faces.length===1) {
    boundaries.push({vertices:edge.vertices,face:edge.faces[0],status:'unobserved'});
    boundaryFaces.add(edge.faces[0]);
  }
  return {positions,faces,sampling,samples,boundaries,boundaryFaces,unsupportedFaces};
}

module.exports={fillsFor,boundsFor,reconstruct};
