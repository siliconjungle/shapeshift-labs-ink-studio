// Construct a rectangular patch from registered rails and cross guides.
const retopologyGuides = (function(K) {
  const {V}=K;
  const sides=['bottom','right','top','left'];
  const key=(i,j)=>i+'/'+j;
  const record=(row,fields)=>row && Object.getPrototypeOf(row)===Object.prototype &&
    Object.keys(row).every(field=>fields.includes(field));
  const xyz=p=>Array.isArray(p) && p.length===3 && Array.from(p).every(n=>Number.isFinite(n) && Math.abs(n)<=1e7);
  const id=value=>typeof value==='string' && value.trim().length>0 && value.length<=96;
  const finite=(n,a,b)=>Number.isFinite(n) && n>=a && n<=b;
  const grid=(side,n,w,h)=>side==='bottom' ? [n,0] : side==='top' ? [n,h] : side==='left' ? [0,n] : [w,n];
  const edges=(axis,n,w,h)=>Array.from({length:(axis==='row' ? w : h)+1},(_,i)=>axis==='row' ? [i,n] : [n,i]);
  const pair=(a,b)=>JSON.stringify(a<b ? [a,b] : [b,a]);

  function samples(raw,length) {
    if (!record(raw,['points','sampling']) || !Array.isArray(raw.points) || raw.points.length<2 || raw.points.length>129 ||
        !Array.from(raw.points).every(xyz) || !['arc','knots'].includes(raw.sampling ?? 'arc'))
      throw new TypeError('A retopology guide needs 2–129 XYZ points and arc or knots sampling');
    const points=raw.points.map(row=>row.slice()), cumulative=[0];
    for (let i=1;i<points.length;i++) {
      const d=V.dist(points[i-1],points[i]);
      if (!(d>1e-8)) throw new RangeError('Consecutive guide points must be distinct');
      cumulative.push(cumulative.at(-1)+d);
    }
    if (raw.sampling==='knots') {
      if (points.length!==length) throw new RangeError('Knots sampling needs one authored point per grid position');
      return points;
    }
    let j=1;
    return Array.from({length},(_,i)=>{
      const wanted=i/(length-1)*cumulative.at(-1);
      while(j<cumulative.length-1 && cumulative[j]<wanted) j++;
      return V.lerp(points[j-1],points[j],Math.max(0,Math.min(1,(wanted-cumulative[j-1])/(cumulative[j]-cumulative[j-1]))));
    });
  }

  function prepare(api,doc,request,options) {
    const {size:[w,h],rails={},rims={},guides=[],pins=[]}=request;
    if (!record(rails,sides) || !record(rims,sides) || !Array.isArray(guides) || guides.length>20 ||
        !Array.isArray(pins) || pins.length>512 || new Set(guides.map(row=>row?.id)).size!==guides.length)
      throw new TypeError('Use named retopology rails and rims, distinct flow guides and bounded pins');
    if (['bottom','top'].some(side=>rails[side]===undefined && rims[side]===undefined))
      throw new RangeError('Supply a bottom and top guide or rim');
    const issues=[], nodes=new Map(), guideRows=new Set([0,h]), guideColumns=new Set([0,w]), paths=[];
    const incidence=retainedMeshHealth.incidence(doc);
    const byPair=new Map(incidence.edges.map(edge=>[pair(...edge.vertices),edge]));
    const rimEdges=new Set(), rimVertices=new Map(), rimUses=[];
    let flip;
    function place(at,position,{source,pin,vertex,synthetic=false}={}) {
      const index=key(...at), prior=nodes.get(index);
      if (!prior) {
        nodes.set(index,{at,position,paths:source ? [source] : [],kinds:pin ? [pin] : [],vertex,synthetic});
        return;
      }
      if (source) prior.paths.push(source);
      if (pin) prior.kinds.push(pin);
      const distance=V.dist(prior.position,position);
      const fixed=prior.vertex || prior.kinds.length>Number(Boolean(pin));
      if (vertex && prior.vertex && prior.vertex!==vertex ||
          distance>(fixed && pin ? options.tolerance : options.guideTolerance))
        issues.push({kind:'guide-conflict',at,sources:prior.paths.slice(),distance});
      if (!fixed && (pin || !synthetic))
        prior.position=pin || prior.synthetic ? position : V.lerp(prior.position,position,.5);
      prior.vertex ??= vertex;
      prior.synthetic &&= synthetic;
    }
    for (const side of sides) {
      const length=(side==='bottom' || side==='top' ? w : h)+1;
      const trace=Array.from({length},(_,i)=>grid(side,i,w,h));
      const rim=rims[side], rail=rails[side];
      if (rim!==undefined) {
        if (rail!==undefined || !Array.isArray(rim) || rim.length!==length || new Set(rim).size!==length ||
            Array.from(rim).some(id=>!incidence.vertices.has(id)))
          throw new RangeError('A rim needs distinct existing vertices, one per grid position on '+side);
        for (const [i,vertex] of rim.entries()) {
          const prior=rimVertices.get(vertex), at=trace[i];
          if (prior!==undefined && prior!==key(...at)) throw new RangeError('Rim vertices cannot stitch multiple grid positions');
          rimVertices.set(vertex,key(...at));
          place(at,incidence.vertices.get(vertex).position,{source:side,pin:'rim',vertex});
        }
        for (let i=0;i<rim.length-1;i++) {
          const a=rim[i],b=rim[i+1], edge=byPair.get(pair(a,b));
          if (edge?.uses.length!==1 || rimEdges.has(edge.id))
            throw new RangeError('A stitched rim must follow distinct open boundary edges');
          rimEdges.add(edge.id);
          const forward=side==='bottom' || side==='right', existing=incidence.corners.get(edge.uses[0].from).vertex;
          const reverse=existing===(forward ? a : b);
          if (flip!==undefined && flip!==reverse) issues.push({kind:'inconsistent-rim-winding',side,edge:edge.id});
          flip ??= reverse;
          rimUses.push({side,edge:edge.id,vertices:[a,b]});
        }
      } else if (rail!==undefined) {
        samples(rail,length).forEach((p,i)=>place(trace[i],p,{source:side}));
      } else continue;
      paths.push({id:side,kind:rim ? 'rim' : 'rail',grid:trace});
    }
    for (const raw of guides) {
      if (!record(raw,['id','axis','index','kind','points','sampling']) || !id(raw.id) || sides.includes(raw.id) ||
          !['row','column'].includes(raw.axis) || !['flow','joint','seam','silhouette'].includes(raw.kind) ||
          !Number.isSafeInteger(raw.index) || raw.index<0 || raw.index>(raw.axis==='row' ? h : w))
        throw new TypeError('A guide needs an ID, row or column index, kind and XYZ path');
      const {id:guideId,axis,index,kind,...curve}=raw, row=axis==='row' ? guideRows : guideColumns;
      const trace=edges(axis,index,w,h), pin=['seam','silhouette'].includes(kind) ? kind : undefined;
      row.add(index);
      samples(curve,trace.length).forEach((p,i)=>place(trace[i],p,{source:guideId,pin}));
      paths.push({id:guideId,kind,grid:trace});
    }
    const locked=new Set();
    for (const pin of pins) {
      if (!record(pin,['at','position','kind']) || !Array.isArray(pin.at) || pin.at.length!==2 ||
          !Array.from(pin.at).every((n,i)=>Number.isSafeInteger(n) && finite(n,0,[w,h][i])) ||
          !xyz(pin.position) || !['seam','silhouette'].includes(pin.kind) || locked.has(key(...pin.at)))
        throw new TypeError('Use distinct pinned grid positions with a seam or silhouette and an authored XYZ point');
      locked.add(key(...pin.at));
    }
    function sideProfile(side) {
      if (rails[side] || rims[side]) return;
      const i=side==='left' ? 0 : w, anchors=[...guideRows].sort((a,b)=>a-b);
      for (const [k,start] of anchors.slice(0,-1).entries()) {
        const end=anchors[k+1], a=nodes.get(key(i,start)).position, b=nodes.get(key(i,end)).position;
        for(let j=start+1;j<end;j++) if (!nodes.has(key(i,j)))
          place([i,j],V.lerp(a,b,(j-start)/(end-start)),{synthetic:true});
      }
    }
    sideProfile('left');
    sideProfile('right');
    for (const {at,position,kind} of pins) {
      const old=nodes.get(key(...at));
      if (old?.kinds.length) place(at,position,{source:'pin',pin:kind});
      else if (old) { old.position=position.slice(); old.kinds.push(kind); }
      else place(at,position.slice(),{source:'pin',pin:kind});
    }
    const rows=[...guideRows].sort((a,b)=>a-b), columns=[...guideColumns].sort((a,b)=>a-b);
    const at=(i,j)=>nodes.get(key(i,j)).position;
    for (const [i0,iStart] of columns.slice(0,-1).entries()) for (const [j0,jStart] of rows.slice(0,-1).entries()) {
      const iEnd=columns[i0+1],jEnd=rows[j0+1];
      for(let j=jStart+1;j<jEnd;j++) for(let i=iStart+1;i<iEnd;i++) {
        if (nodes.has(key(i,j))) continue;
        const u=(i-iStart)/(iEnd-iStart),v=(j-jStart)/(jEnd-jStart);
        const blend=V.add(V.lerp(at(i,jStart),at(i,jEnd),v),V.lerp(at(iStart,j),at(iEnd,j),u));
        const corners=V.lerp(V.lerp(at(iStart,jStart),at(iEnd,jStart),u),V.lerp(at(iStart,jEnd),at(iEnd,jEnd),u),v);
        place([i,j],V.sub(blend,corners));
      }
    }
    return {nodes,paths,rimUses,flip,issues};
  }

  return {prepare,key,record,xyz,id,finite,pair};
})(KIT);
