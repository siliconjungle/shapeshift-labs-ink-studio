// Revision-checked polygon strips with exact rim continuity and retained guide receipts.
(function(K) {
  const api=K.meshTopology, {V,procedural:{spatial,data:{freeze}}}=K;
  const G=retopologyGuides, S=retopologySurface;
  const {key,record,id,finite,pair}=G;

  function planRetopology(source,request,context={}) {
    if (!record(request,['id','revision','surface','size','rails','rims','guides','pins','projection','material','maxChecks']) ||
        !id(request.id) || !/^[\w.-]+$/.test(request.id) ||
        !Array.isArray(request.size) || request.size.length!==2 ||
        !Array.from(request.size).every(n=>Number.isSafeInteger(n) && finite(n,1,64)) ||
        request.size[0]*request.size[1]>2048 || !id(request.material))
      throw new TypeError('Retopology needs a patch ID, bounded quad grid and material');
    const doc=api.create(source), beforeRevision=api.revision(doc);
    if (beforeRevision!==request.revision) throw new RangeError('Stale retopology target revision');
    const {size:[w,h],maxChecks=250000}=request;
    if (!Number.isSafeInteger(maxChecks) || !finite(maxChecks,1,2000000))
      throw new RangeError('Use a valid retopology surface check budget');
    const options=S.settings(request.projection);
    const surface=S.prepare(api,doc,request.surface,options,context);
    const construction=G.prepare(api,doc,request,options);
    const {nodes,paths,rimUses,issues}=construction, ordered=[], vertices=[], faces=[], faceRows=[];
    const ids=new Set([...doc.vertices,...doc.faces,...doc.faces.flatMap(row=>row.corners)].map(row=>row.id));
    function makeId(type,i,j,k='') {
      const id='retopo/'+request.id+'/'+type+'/'+i+'/'+j+k;
      if (ids.has(id)) throw new RangeError('Retopology patch ID is already used: '+request.id);
      ids.add(id);
      return id;
    }
    for(let j=0;j<=h;j++) for(let i=0;i<=w;i++) {
      const node=nodes.get(key(i,j)), pinned=node.kinds.length>0;
      node.id=node.vertex ?? makeId('v',i,j);
      const hit=surface.project(node.position,pinned ? options.pinTolerance : options.maxDistance);
      if (!hit) issues.push({kind:pinned ? 'pin-off-surface' : 'projection-miss',at:node.at,position:node.position});
      const position=hit && !pinned ? hit.point : node.position;
      ordered.push({id:node.id,at:node.at,authored:node.position,position,pins:[...new Set(node.kinds)],
        paths:node.paths,...(hit && {hit}),...(node.vertex && {rim:true})});
      if (!node.vertex) vertices.push({id:node.id,position});
    }
    const at=(i,j)=>ordered[j*(w+1)+i], rows=[];
    let agreement=0;
    for(let j=0;j<h;j++) for(let i=0;i<w;i++) {
      const ring=[at(i,j),at(i+1,j),at(i+1,j+1),at(i,j+1)];
      const [a,b,c,d]=ring.map(row=>row.position);
      const first=V.cross(V.sub(b,a),V.sub(c,a)), second=V.cross(V.sub(c,a),V.sub(d,a));
      const normal=V.norm(V.add(first,second)), align=V.dot(V.norm(first),V.norm(second));
      const supporters=ring.flatMap(row=>row.hit ? [row.hit.normal] : []);
      const expected=V.norm(supporters.reduce(V.add,[0,0,0]));
      const score=V.len(expected)>.99 ? V.dot(expected,normal) : null;
      agreement+=score ?? 0;
      const edgeLengths=ring.map((row,k)=>V.dist(row.position,ring[(k+1)%4].position)), edgeRatio=Math.max(...edgeLengths)/Math.max(1e-12,Math.min(...edgeLengths));
      const faceId=makeId('f',i,j);
      if (align<=.05 || Math.min(...edgeLengths)<=1e-8)
        issues.push({kind:'folded-quad',at:[i,j],face:faceId});
      const probes=[
        ring.reduce((sum,row)=>V.mad(sum,row.position,.25),[0,0,0]),
        ...ring.map((row,k)=>V.lerp(row.position,ring[(k+1)%4].position,.5))
      ];
      const fits=probes.map(point=>{
        const hit=surface.project(point,options.maxDistance);
        return hit ? {point,distance:hit.distance} : {point,distance:null};
      });
      const missing=fits.filter(row=>row.distance===null);
      if (missing.length) issues.push({kind:'unsupported-quad',at:[i,j],face:faceId,probes:missing.map(row=>row.point)});
      const deviation=Math.max(0,...fits.map(row=>row.distance ?? 0));
      if (options.maxDeviation!==undefined && deviation>options.maxDeviation)
        issues.push({kind:'surface-deviation',at:[i,j],face:faceId,deviation});
      rows.push({i,j,id:faceId,ring,score,edgeRatio,deviation,missing:missing.length});
    }
    const flip=construction.flip ?? agreement<0;
    for(const row of rows) {
      const {i,j,ring}=row, score=row.score===null ? null : row.score*(flip ? -1 : 1);
      if (score!==null && score<.05)
        issues.push({kind:'reversed-surface-quad',at:[i,j],face:row.id,normalDot:score});
      const corners=(flip ? ring.slice().reverse() : ring).map(({id,at:[u,v]},k)=>({
        id:makeId('c',i,j,'/'+k),vertex:id,uv:[u/w,v/h]
      }));
      faces.push({id:row.id,material:request.material,corners});
      faceRows.push({id:row.id,at:[i,j],vertices:corners.map(row=>row.vertex),normalDot:score,edgeRatio:row.edgeRatio,deviation:row.deviation,missing:row.missing});
    }
    const proposed={vertices,faces}, generated=faces.map(row=>row.id);
    let document=null, health=null;
    if (!issues.length) {
      try { document=api.edit(doc,proposed); }
      catch (error) {
        if (!(error instanceof RangeError)) throw error;
        issues.push({kind:'invalid-polygon',message:error.message});
      }
    }
    if (document) {
      const patchFaces=api.select(document,{domain:'faces',ids:generated});
      health=api.health(document,{selection:patchFaces,maxPairs:maxChecks,duplicateDistance:0,
        sliverQuality:0,intersectionTolerance:options.tolerance,limit:64});
      const check=health.counts.selfIntersections ? meshBooleanSurfaces.intersections(api,
        meshBooleanSurfaces.input(api,document,undefined,'retopology'),options.tolerance,maxChecks,patchFaces) : null;
      if (health.counts.nonManifold || health.counts.winding || check?.findings.length)
        issues.push({kind:'surface-contact',nonManifold:health.counts.nonManifold,winding:health.counts.winding,
          intersections:check?.findings.slice(0,16) ?? []});
      if (!health.work.intersectionsComplete || check?.complete===false) issues.push({kind:'check-budget'});
    }
    const pinned=ordered.filter(row=>row.pins.length), byPair=document && new Map(document.edges.map(row=>[pair(...row.vertices),row.id]));
    const traces=paths.map(({grid,...row})=>{
      const vertices=grid.map(([i,j])=>at(i,j).id);
      const edges=byPair ? vertices.slice(1).map((id,i)=>byPair.get(pair(vertices[i],id))) : [];
      return {...row,vertices,edges};
    });
    const pins={vertices:pinned.map(row=>row.id),edges:traces.filter(row=>
      ['seam','silhouette','rim'].includes(row.kind)).flatMap(row=>row.edges)};
    const report={format:'ink-studio/mesh-retopology',version:1,mesh:doc.id,id:request.id,beforeRevision,
      afterRevision:document ? api.revision(document) : null,surface:surface.label,size:[w,h],flip,
      canCommit:issues.length===0,issues,health,vertices:ordered,quads:faceRows,guides:traces,rims:rimUses,
      pins,bounds:spatial.boxOf(ordered.map(row=>row.position)),
      maxSnapDistance:Math.max(0,...ordered.flatMap(row=>row.hit ? [row.hit.distance] : [])),
      maxDeviation:Math.max(0,...faceRows.map(row=>row.deviation))};
    return freeze({document,patch:issues.length ? {} : proposed,report});
  }

  K.meshTopology=Object.freeze({...api,planRetopology});
})(KIT);
