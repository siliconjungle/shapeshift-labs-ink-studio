// Compare against polygon boundaries at fixed world-space probes.
const meshBooleanDiagnostics = (function(K) {
  const {V,procedural:{spatial}}=K, S=meshBooleanSurfaces;
  const raysPerAxis=6, edgeLimit=192;
  const measure=op=>(a,b)=>op==='union' ? a || b : op==='intersection' ? a && b : a && !b;

  function raycast(triangles,tolerance) {
    const tree=spatial.pointIndex(triangles);
    return (origin,direction,distance)=>{
      const points=[], end=V.mad(origin,direction,distance);
      tree.box(spatial.expand(spatial.boxOf([origin,end]),tolerance),row=>{
        const {a,u,v,normal}=row, alignment=V.dot(direction,normal);
        if (Math.abs(alignment)<1e-10) return;
        const cross=V.cross(direction,v), det=V.dot(u,cross);
        const delta=V.sub(origin,a), p=V.dot(delta,cross)/det, qvec=V.cross(delta,u);
        const q=V.dot(direction,qvec)/det, t=V.dot(v,qvec)/det;
        if (p < -1e-9 || q < -1e-9 || p+q>1+1e-9 || t<0 || t>distance) return;
        points.push({t,row,enter:alignment<0});
      });
      points.sort((a,b)=>a.t-b.t || a.row.i-b.row.i);
      const events=[];
      for (let i=0;i<points.length;) {
        const first=points[i++], group=[first];
        while (i<points.length && points[i].t-first.t<=tolerance) group.push(points[i++]);
        if (group.every(row=>row.enter===first.enter)) events.push(first);
      }
      return events;
    };
  }

  function exactEvents(events,config) {
    const predicate=measure(config.operation);
    let a=false,b=false;
    const result=[];
    for (let i=0;i<events.length;) {
      const first=events[i++], group=[first], prior=predicate(a,b);
      while (i<events.length && events[i].t-first.t<=config.tolerance) group.push(events[i++]);
      // Prefer target ownership for simultaneous crossings on the same plane.
      group.sort((x,y)=>Number(x.row.side==='tool')-Number(y.row.side==='tool'));
      for (const hit of group) {
        if (hit.row.side==='target') a=hit.enter;
        else b=hit.enter;
      }
      const next=predicate(a,b);
      if (prior!==next) result.push({...group[0],enter:next});
    }
    return result;
  }

  function intervals(events,owner) {
    const result=[];
    let from;
    for (const event of events) {
      if (event.enter) { from ??=event; continue; }
      if (from && event.t>from.t) result.push({start:from.t,end:event.t,thickness:event.t-from.t,
        entry:owner(from.row),exit:owner(event.row)});
      from=undefined;
    }
    return result;
  }

  function edges(api,doc,input) {
    if (!doc.faces.length) return [];
    const positions=new Map(doc.vertices.map(row=>[row.id,row.position]));
    const planes=new Map(input.triangles.map(row=>[row.source.id,row.normal]));
    return api.inspect(doc).edges.flatMap(edge=>{
      if (edge.uses.length!==2) return [];
      const normals=edge.uses.map(row=>planes.get(row.face));
      if (V.dot(...normals)>.94) return [];
      const [a,b]=edge.vertices.map(id=>positions.get(id));
      return [{id:edge.id,a,b,normals,length:V.dist(a,b)}];
    });
  }

  function review({api,left,right,native,candidate,config,bounds}) {
    const epsilon=config.tolerance, cell=config.cell;
    const reference=native ? native.side : undefined;
    const model=candidate.side.faces.length ? S.input(api,candidate.side,undefined,'result') : {triangles:[]};
    const lookup=S.nearest(model.triangles), castOut=raycast(model.triangles,epsilon);
    const [castA,castB]=[left,right].map(row=>raycast(row.triangles,epsilon));
    const owners=new Map(candidate.owners.map(row=>[row.face,row]));
    const sourceOwner=row=>({operand:row.side,sourceFace:row.source.id,
      material:config.operation==='difference' && row.side==='tool' && config.cutMaterial || row.source.material});
    const retainedOwner=row=>{
      const {face,...owner}=owners.get(row.source.id);
      return owner;
    };
    const edgeInput=reference?.faces.length ? S.input(api,reference,undefined,'reference') : undefined;
    const traceLength=V.len(V.sub(bounds.max,bounds.min))*3, ray=V.norm([.657,.494,.569]);
    const edgeCandidates=reference ? edgeInput ? edges(api,reference,edgeInput) : [] :
      [left,right].flatMap((row,i)=>edges(api,row.doc,row).filter(edge=>{
        const other=i===0 ? castB : castA;
        const inside=other(V.lerp(edge.a,edge.b,.5),ray,traceLength).length%2===1;
        return config.operation==='union' ? !inside : config.operation==='intersection' || i===1 ? inside : !inside;
      }).map(edge=>i===1 && config.operation==='difference' ?
        {...edge,normals:edge.normals.map(row=>V.mul(row,-1))} : edge));
    const selected=edgeCandidates.sort((a,b)=>b.length-a.length || (a.id<b.id ? -1 : a.id>b.id ? 1 : 0)).slice(0,edgeLimit);
    const edgeSamples=selected.flatMap(({id,a,b,normals})=>[.15,.5,.85].map(t=>{
      const point=V.lerp(a,b,t), match=lookup(point,cell*3);
      const alignment=match ? Math.max(...normals.map(n=>V.dot(n,match.row.normal))) : null;
      return {id,point,t,...(match && {projected:match.at}),distance:match?.distance ?? null,normalDot:alignment,
        changed:!match || match.distance>config.edgeTolerance || alignment<.9};
    }));
    const shell=[], material=[], invalidProbes=[];
    const span=V.sub(bounds.max,bounds.min), rays=config.probes.slice();
    for (let k=0;k<3;k++) for(let y=0;y<raysPerAxis;y++) for(let x=0;x<raysPerAxis;x++) {
      const u=(k+1)%3,v=(k+2)%3,origin=bounds.min.slice(), direction=[0,0,0];
      origin[k]-=cell*3;
      origin[u]+=span[u]*(x+.45)/raysPerAxis;
      origin[v]+=span[v]*(y+.55)/raysPerAxis;
      direction[k]=1;
      rays.push({origin,direction,distance:span[k]+cell*6});
    }
    for (const {id,origin,direction,distance} of rays) {
      const a=castA(origin,direction,distance),b=castB(origin,direction,distance),out=castOut(origin,direction,distance);
      if (id!==undefined && [a,b,out].some(events=>events.length && (!events[0].enter || events.at(-1).enter))) {
        invalidProbes.push({id,reason:'ray-needs-outside-endpoints'});
        continue;
      }
      const events=a.concat(b).sort((x,y)=>x.t-y.t);
      const expected=intervals(exactEvents(events,config),sourceOwner),fallback=intervals(out,retainedOwner);
      const used=new Set(), location={...(id!==undefined && {probe:id}),origin,direction};
      for (const exact of expected) {
        let best, score=0;
        for (const [i,other] of fallback.entries()) {
          const overlap=Math.min(other.end,exact.end)-Math.max(other.start,exact.start);
          if (!used.has(i) && overlap>score) { best=i; score=overlap; }
        }
        const found=fallback[best];
        if (found) used.add(best);
        const delta=found ? found.thickness-exact.thickness : null;
        shell.push({...location,expected:[exact.start,exact.end],fallback:found ? [found.start,found.end] : null,delta,
          status:!found ? 'lost-wall' : Math.abs(delta)>config.thicknessTolerance ? 'thickness-changed' : 'matched'});
        if (!found) continue;
        for (const [endpoint,t] of [['entry',found.start],['exit',found.end]]) {
          const before=exact[endpoint], after=found[endpoint];
          if (Math.abs(t-(endpoint==='entry' ? exact.start : exact.end))>cell*3) continue;
          material.push({...(id!==undefined && {probe:id}),point:V.mad(origin,direction,t),endpoint,expected:before,fallback:after,
            changedMaterial:before.material!==after.material,
            changedOwner:before.operand!==after.operand || before.sourceFace!==after.sourceFace});
        }
      }
      for (const [i,extra] of fallback.entries()) if (!used.has(i))
        shell.push({...location,expected:null,fallback:[extra.start,extra.end],delta:null,status:'new-wall'});
    }
    const distances=edgeSamples.flatMap(row=>row.distance===null ? [] : [row.distance]);
    const deltas=shell.flatMap(row=>row.delta===null ? [] : [Math.abs(row.delta)]);
    return {edgeShape:{reference:reference ? 'mesh-boolean' : 'eligible-input-edges',available:edgeCandidates.length,
      tolerance:config.edgeTolerance,changed:edgeSamples.filter(row=>row.changed).length,maxDistance:distances.length ? Math.max(...distances) : null,
      samples:edgeSamples},
      shellThickness:{reference:'operand-ray-intervals',tolerance:config.thicknessTolerance,invalidProbes,
        changed:shell.filter(row=>row.status==='thickness-changed').length,lost:shell.filter(row=>row.status==='lost-wall').length,
        new:shell.filter(row=>row.status==='new-wall').length,maxAbsoluteDelta:deltas.length ? Math.max(...deltas) : null,samples:shell},
      materialOwnership:{reference:'operand-ray-boundaries',changedMaterial:material.filter(row=>row.changedMaterial).length,
        changedOwner:material.filter(row=>row.changedOwner).length,samples:material}};
  }

  return {review};
})(KIT);
