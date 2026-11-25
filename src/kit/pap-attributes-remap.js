/* Typed columns move through explicit ancestry, including representation changes. */
(function(K) {
  const P=K.procedural, A=P.attributes, {V}=K;
  const validId=id=>typeof id==='string'&&!!id.trim()||Number.isSafeInteger(id)&&id>=0;
  const order=(a,b)=>a<b?-1:a>b?1:0;
  const stable=(a,b)=>order(JSON.stringify(a.id),JSON.stringify(b.id));
  const record=row=>row&&Object.getPrototypeOf(row)===Object.prototype;
  const sum=rows=>rows.reduce((total,row)=>total+row.weight,0);

  function contributors(rows) {
    if (!Array.isArray(rows)||rows.length>250000||!Array.from(rows).every(row=>record(row)&&validId(row.id)&&
      Number.isFinite(row.weight)&&row.weight>0)||new Set(rows.map(row=>row.id)).size!==rows.length)
      throw new RangeError('Attribute lineage needs distinct stable IDs and positive finite weights');
    const total=sum(rows);
    if (!Number.isFinite(total)) throw new RangeError('Attribute lineage weight total exceeds numeric precision');
    return rows.map(({id,weight})=>({id,weight:weight/total})).sort(stable);
  }

  function remap(source,domain,entities,lineage=[],{retain=true}={}) {
    const input=A.open(source), target=A.asset(domain,entities);
    if (!Array.isArray(lineage)||lineage.length>250000||typeof retain!=='boolean')
      throw new RangeError('Attribute remap needs a bounded lineage and an optional retain flag');
    const joins=new Map(input.entities.map(({id},i)=>[id,i])), mappings=new Map();
    for(const row of lineage) {
      if(!record(row)||!validId(row.id)||mappings.has(row.id)||row.reason!==undefined&&
        (typeof row.reason!=='string'||!row.reason||row.from?.length))
        throw new RangeError('Attribute lineage needs at most one mapping per target');
      mappings.set(row.id,{from:contributors(row.from),reason:row.reason});
    }
    const channels=Object.fromEntries([...input.channels].map(([id,row])=>[id,{
      type:row.type,interpolation:row.interpolation,values:[],missing:[]
    }]));
    const issues=[], rows=[], destinations=new Set(target.entities.map(row=>row.id));
    for (const [targetIndex,{id}] of target.entities.entries()) {
      const authored=mappings.get(id);
      const from=authored?.from??(retain&&domain===input.domain&&joins.has(id)?[{id,weight:1}]:[]);
      const missing=from.filter(row=>!joins.has(row.id));
      const issue=authored?.reason??(!from.length?'unmapped-element':missing.length?'missing-source-element':null);
      if(issue)issues.push({id,reason:issue,...(missing.length&&{sources:missing.map(row=>row.id)})});
      const indices=from.map(row=>joins.get(row.id)), weights=from.map(row=>row.weight);
      let known=0;
      for (const [name,channel] of input.channels) {
        const value=issue?undefined:A.blend(channel,indices,weights);
        if(value===undefined) {
          channels[name].values.push(...Array(channel.size).fill(null));
          channels[name].missing.push(targetIndex);
          if(!issue) issues.push({id,channel:name,reason:indices.some(i=>channel.missing.has(i)||
            channel.type!=='label'&&channel.values[i*channel.size]===null)?'missing-source-value':'constant-conflict'});
        } else {
          channels[name].values.push(...[].concat(value));
          known++;
        }
      }
      rows.push({id,from,status:issue?'unmapped':known<input.channels.size?'partial':authored?'mapped':'retained'});
    }
    const output=A.asset(domain,target.entities,channels);
    return {asset:output,report:{format:'ink-studio/attribute-remap-report',version:1,from:input.domain,to:domain,
      rows,issues,unusedLineage:[...mappings.keys()].filter(id=>!destinations.has(id))}};
  }

  function links(raw,source,target,minConfidence) {
    if(!Array.isArray(raw?.groups))throw new TypeError('Attribute lineage needs topology correspondence groups');
    const result=new Map();
    for(const group of raw.groups) {
      if(!Array.isArray(group?.links))throw new TypeError('Invalid topology correspondence group');
      for(const row of group.links) {
        if(!source.has(row?.from)||!target.has(row.to)||!Number.isFinite(row.confidence)||row.confidence<0||row.confidence>1||
          typeof row.evidence?.method!=='string')throw new RangeError('Invalid topology correspondence link');
        if(row.confidence<minConfidence)continue;
        if(!result.has(row.to))result.set(row.to,[]);
        result.get(row.to).push(row);
      }
    }
    return result;
  }

  function meshLineage(domain,before,after,map,options={}) {
    const T=K.meshTopology, source=T.create(before), target=T.create(after);
    if(map?.format!=='ink-studio/topology-correspondence'||map.version!==1||
      map.before!==source.id||map.after!==target.id||map.beforeRevision!==T.revision(source)||map.afterRevision!==T.revision(target))
      throw new RangeError('Attribute lineage needs a map pinned to both topology revisions');
    const bounds=P.spatial.boxOf(source.vertices.map(row=>row.position)), span=source.vertices.length ? V.dist(bounds.min,bounds.max) : 0;
    const {minConfidence=.5,maxDistance=map.projection?.maxDistance??Math.max(1e-8,span*1e-6),
      ambiguityDistance=maxDistance*1e-5,maxChecks=1000000}=options;
    if(!['edge','corner'].includes(domain)||!Number.isFinite(minConfidence)||minConfidence<=0||minConfidence>1||
      !Number.isFinite(maxDistance)||maxDistance<0||!Number.isFinite(ambiguityDistance)||ambiguityDistance<0||
      ambiguityDistance>maxDistance||!Number.isSafeInteger(maxChecks)||maxChecks<1||maxChecks>4000000)
      throw new RangeError('Choose edge or corner lineage with valid projection limits');
    if(domain==='edge') {
      const left=new Map(source.edges.map(row=>[row.id,row])), right=new Map(target.edges.map(row=>[row.id,row]));
      const refs=links(map.domains?.edges,left,right,minConfidence), vertices=new Map(source.vertices.map(row=>[row.id,row.position]));
      return target.edges.map(({id})=>{
        const ancestry=refs.get(id)??[];
        const from=ancestry.map(row=>({id:row.from,weight:Math.max(1e-10,V.dist(
          ...left.get(row.from).vertices.map(id=>vertices.get(id))))*row.confidence}));
        return {id,from,...(!from.length&&{reason:'unmapped-edge'})};
      });
    }
    const left=meshAttachmentGeometry.catalog(source), right=meshAttachmentGeometry.catalog(target);
    const faces=links(map.domains?.faces,left.faces,right.faces,minConfidence);
    const corners=links(map.domains?.corners,left.corners,right.corners,minConfidence);
    let work=0;
    const confidenceLinks=rows=>rows.filter(row=>row.confidence===1&&!row.evidence.method.startsWith('projected-'));
    return [...right.corners.values()].map(row=>{
      const {id,face,vertex}=row, candidates=faces.get(face)??[], allowed=new Set(candidates.map(row=>row.from));
      const exact=confidenceLinks(corners.get(id)??[]).filter(link=>allowed.has(left.corners.get(link.from).face));
      if(exact.length===1)return {id,from:[{id:exact[0].from,weight:1}]};
      if(exact.length>1)return {id,from:[],reason:'ambiguous-corner'};
      if(!allowed.size)return {id,from:[],reason:'unmapped-corner-face'};
      const point=right.vertices.get(vertex).position, hits=[];
      for(const sourceFace of [...allowed].sort()) for(const triangle of left.faces.get(sourceFace).triangles) {
        if(work++>=maxChecks)return {id,from:[],reason:'projection-budget'};
        const {at,weights}=P.geometry.closestTrianglePoint(point,triangle), distance=V.dist(point,at);
        if(distance<=maxDistance) hits.push({distance,from:triangle.corners.map((id,i)=>({id,weight:weights[i]}))
          .filter(row=>row.weight>1e-10).sort(stable)});
      }
      hits.sort((a,b)=>a.distance-b.distance);
      if(!hits.length)return {id,from:[],reason:'unmapped-corner'};
      const best=hits[0];
      if(hits.some(hit=>hit.distance<=best.distance+ambiguityDistance&&(hit.from.length!==best.from.length||
        hit.from.some((row,i)=>row.id!==best.from[i].id||Math.abs(row.weight-best.from[i].weight)>1e-7))))
        return {id,from:[],reason:'ambiguous-corner-surface'};
      return {id,from:best.from};
    });
  }

  function flatten(steps) {
    const authored=new Map();
    for (const {id,from} of steps) {
      if(!validId(id)||authored.has(id))throw new RangeError('Attribute lineage generated the same ID twice');
      const expanded=new Map();
      for (const row of contributors(from)) {
        if(row.id===id)throw new RangeError('Attribute lineage cannot create a cyclic source');
        for(const prior of authored.get(row.id)??[{id:row.id,weight:1}])
          expanded.set(prior.id,(expanded.get(prior.id)??0)+row.weight*prior.weight);
      }
      authored.set(id,contributors([...expanded].map(([id,weight])=>({id,weight}))));
    }
    return [...authored].map(([id,from])=>({id,from}));
  }

  function curveLineage(report) {
    if(!Array.isArray(report?.operations))throw new TypeError('Use a retained spline edit report');
    return flatten(report.operations.flatMap(row=>row.controls??[]));
  }

  function splatLineage(report) {
    if(!Array.isArray(report?.operations))throw new TypeError('Use a splat redistribution report');
    return flatten(report.operations.flatMap(row=>{
      if(row.op==='split'&&Array.isArray(row.children))return row.children.map(child=>({id:child.id,from:[{id:row.id,weight:1}]}));
      if(row.op==='merge'&&Array.isArray(row.from)&&Array.isArray(row.weights)&&row.from.length===row.weights.length)
        return [{id:row.id,from:row.from.map((id,i)=>({id,weight:row.weights[i]}))}];
      throw new RangeError('Attribute lineage needs a recorded splat split or weighted merge');
    }));
  }

  P.attributes=Object.freeze({...A,remap,meshLineage,curveLineage,splatLineage});
})(KIT);
