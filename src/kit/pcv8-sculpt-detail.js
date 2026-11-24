// Capture signed relief independently of silhouette and transfer it through a surface chart.
(function(K) {
  const { V,procedural:P }=K, C=SdfDetailChart;
  const freeze=P.data.freeze;

  function capture(coarse,detailed,raw) {
    if (![coarse,detailed].every(P.sparseBricks.isSnapshot) ||
        !C.record(raw,['chart','depth','maxRelief','object'])) throw new TypeError('Detail capture needs two signed brick snapshots and a chart');
    const {cell}=detailed, chart=C.chart(raw.chart,cell);
    const {depth=8*cell,maxRelief=3*cell,object}=raw;
    if (!C.finite(depth,cell,32*cell) || !C.finite(maxRelief,cell*.25,cell*12) || !C.objectId(object))
      throw new RangeError('Detail capture needs bounded chart depth and relief range');
    const {center}=C.basis(chart), {size:[w,h],normal}=chart;
    const rows=Array.from({length:w*h},(_,i)=>{
      const centerPoint=center(i%w,Math.floor(i/w)), step=cell*.5, epsilon=cell*1e-5;
      const original=C.front(coarse.distance,centerPoint,normal,-depth,depth,step,epsilon);
      if (original.status) return {status:original.status};
      const p=V.mad(centerPoint,normal,original.height);
      const facing=C.normalAt(coarse.distance,p,cell*.25);
      if (V.dot(facing,normal)<.25) return {status:'fold'};
      // The extra step gives a sample on both sides when the root lies at the limit.
      const radius=maxRelief+step;
      const detail=C.front(detailed.distance,centerPoint,normal,original.height-radius,original.height+radius,step,epsilon);
      if (detail.status) return {status:detail.status};
      const offset=detail.height-original.height;
      if (Math.abs(offset)>maxRelief+epsilon) return {status:'lost-correspondence'};
      return {height:original.height,normal:facing,offset:Math.abs(offset)<cell*.01 ? 0 : offset};
    });
    return C.prepare({format:C.format,version:1,cell,chart,rows,...(object!==undefined && {object})});
  }

  function project(raw,coarse,{reach,minWall,minNormalDot=.65,targetFrame,weight,maxSamples=524288}={}) {
    const layer=C.prepare(raw);
    if (!P.sparseBricks.isSnapshot(coarse) || coarse.cell>layer.cell*(1+1e-9))
      throw new TypeError('Detail transfer needs a target brick lattice at least as fine as the capture');
    const {cell}=layer;
    if (targetFrame!==undefined && !C.record(targetFrame,['origin','normal','tangent']))
      throw new TypeError('A target chart frame accepts origin, normal and tangent');
    const chart=targetFrame ? C.chart({...layer.chart,...targetFrame},cell) : layer.chart;
    const {size:[w,h],normal}=chart;
    reach ??=8*cell;
    minWall ??=2*cell;
    if (!C.finite(reach,cell*.5,cell*40) || !C.finite(minWall,cell*.5,cell*16) ||
        !C.finite(minNormalDot,.25,1) || weight!==undefined && typeof weight!=='function' ||
        !Number.isSafeInteger(maxSamples) || !C.finite(maxSamples,1,4000000))
      throw new RangeError('Detail transfer needs bounded reach, wall thickness, normal agreement and sample budget');
    const {center,coordinates,axes}=C.basis(chart), originalAxes=C.basis(layer.chart).axes;
    const step=cell*.5, epsilon=coarse.cell*1e-5;
    const mapNormal=n=>targetFrame ? axes.reduce((sum,axis,i)=>V.mad(sum,axis,V.dot(n,originalAxes[i])),[0,0,0]) : n;
    const rows=layer.rows.map((source,i)=>{
      const x=i%w,y=Math.floor(i/w), base=center(x,y);
      const row={x,y,source:source.status ? base : V.mad(base,normal,source.height),offset:source.offset ?? null};
      if (source.status) return {...row,status:source.status,phase:'capture'};
      const match=C.front(coarse.distance,base,normal,source.height-reach,source.height+reach,step,epsilon);
      if (match.status) return {...row,...match,phase:'transfer'};
      const {height}=match, position=V.mad(base,normal,height);
      const n=C.normalAt(coarse.distance,position,coarse.cell*.25), normalDot=V.dot(n,mapNormal(source.normal));
      const evidence={...row,target:position,height,normalDot};
      if (normalDot<minNormalDot || V.dot(n,normal)<.25) return {...evidence,status:'fold',phase:'transfer',reason:'normal-mismatch'};
      const requiredWall=minWall+Math.max(0,-source.offset);
      const back=C.roots(coarse.distance,base,normal,height-requiredWall-2*cell,height-step*.25,step,epsilon)
        .filter(hit=>!hit.outward).at(-1);
      const oblique=V.dot(n,normal)<.96 && C.roots(coarse.distance,position,n,-requiredWall-2*cell,-step*.25,step,epsilon)
        .filter(hit=>!hit.outward).at(-1);
      const thickness=back || oblique ? Math.min(back ? height-back.height : Infinity,oblique ? -oblique.height : Infinity) : null;
      if (thickness!==null && thickness<requiredWall) return {...evidence,status:'thin-wall',phase:'transfer',thickness,requiredWall};
      if (source.offset && weight && !weight(...position)) return {...evidence,status:'masked',phase:'transfer'};
      const edge=x===0 || x===w-1 || y===0 || y===h-1;
      return {...evidence,status:source.offset ? edge ? 'edge' : 'applied' : 'flat',thickness};
    });
    const counts=Object.fromEntries(['applied','flat','edge','fold','thin-wall','lost-correspondence','masked'].map(status=>[status,0]));
    for (const row of rows) counts[row.status]++;
    const accepted=rows.filter(row=>row.status==='applied');
    const report={format:'ink-studio/sculpt-detail-review',version:1,...(layer.object!==undefined && {object:layer.object}),
      chart,captureCell:cell,targetCell:coarse.cell,reach,minWall,minNormalDot,counts,rows};
    if (!accepted.length) return {snapshot:coarse,report:freeze({...report,dirty:[],changedSamples:0})};

    const pad=Math.hypot(chart.spacing,chart.spacing)+cell*1.8;
    const bounds=P.spatial.boxOf(accepted.flatMap(row=>{
      const r=pad+Math.abs(row.offset);
      return [row.target.map(n=>n-r),row.target.map(n=>n+r)];
    }));
    const snapshot=coarse.edit({bounds,operation:'reshape',weight,maxSamples,transform(x,y,z,value) {
      const [u,v,height]=coordinates([x,y,z]), edge=Math.min(u,v,w-1-u,h-1-v,1);
      if (edge<=0) return value;
      const sx=Math.floor(u),sy=Math.floor(v),a=u-sx,b=v-sy;
      let relief=0, surface=0, wall=Infinity;
      for (const [ox,oy,blend] of [[0,0,(1-a)*(1-b)],[1,0,a*(1-b)],[0,1,(1-a)*b],[1,1,a*b]]) {
        if (blend<=1e-8) continue;
        const row=rows[(sy+oy)*w+sx+ox];
        if (row.status!=='applied' && row.status!=='flat' && row.status!=='edge') return value;
        relief+=row.offset*blend;
        surface+=row.height*blend;
        wall=Math.min(wall,row.thickness ?? Infinity);
      }
      if (!relief) return value;
      const distance=Math.abs(height-surface), plateau=Math.abs(relief)+cell*.15;
      const outer=Math.min(plateau+cell*1.5,height<surface ? wall-coarse.cell*.1 : Infinity);
      if (distance>=outer) return value;
      const fade=Math.min(1,(outer-distance)/Math.max(outer-plateau,coarse.cell*.1));
      const displacement=relief*edge*edge*(3-2*edge)*fade*fade*(3-2*fade);
      return coarse.distance(...V.mad([x,y,z],normal,-displacement));
    }});
    const dirty=snapshot.sampleChangesFrom(coarse,{channels:['offset']}).map(({key,samples,bounds})=>({key,samples,bounds}));
    return {snapshot,report:freeze({...report,dirty,changedSamples:dirty.reduce((n,row)=>n+row.samples,0)})};
  }

  P.sculptDetail=Object.freeze({capture,prepare:C.prepare,project});
})(KIT);
