/* Transfer only through the pinned topology map, then measure the native posed result. */
(function (K) {
  const topology=K.meshTopology, {V,M,procedural:{geometry,data,spatial}}=K;
  const {catalog,manifest,record,address,frame,points,mix}=meshAttachmentGeometry;
  const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
  const name=TargetSelectors.name;
  const order=(a,b)=>a<b ? -1 : a>b ? 1 : 0;
  const strong=row=>row.confidence===1&&!row.evidence.method.startsWith('projected-');
  const unique=rows=>[...new Set(rows)];
  const sum=row=>row.reduce((total,n)=>total+n,0);

  function links(raw,left,right,floor) {
    if (!Array.isArray(raw?.groups)) throw new TypeError('Transfer needs face and corner correspondence groups');
    const from=new Map(), to=new Map(), seen=new Set();
    for (const group of raw.groups) {
      if (!Array.isArray(group?.links)) throw new TypeError('Invalid topology correspondence group');
      for (const row of group.links) {
        const key=JSON.stringify([row?.from,row?.to]);
        if (!left.has(row?.from)||!right.has(row.to)||!unit(row.confidence)||!name(row.evidence?.method)||seen.has(key))
          throw new RangeError('Invalid topology correspondence link');
        seen.add(key);
        if (row.confidence<floor) continue;
        if (!from.has(row.from)) from.set(row.from,[]);
        if (!to.has(row.to)) to.set(row.to,[]);
        from.get(row.from).push(row);
        to.get(row.to).push(row);
      }
    }
    return {from,to};
  }

  function surfaceProject(loc, faces, normals, target, settings, work) {
    const hits=[];
    for (const face of [...faces.keys()].sort()) for (const tri of target.faces.get(face).triangles) {
      if (work.checks>=settings.maxChecks) return {reason:'projection-budget'};
      work.checks++;
      const normalDot=normals.reduce((max,n)=>Math.max(max,V.dot(n,tri.normal)),-1);
      if (normalDot<settings.minNormalDot) continue;
      const {at,weights}=geometry.closestTrianglePoint(loc,tri), distance=V.dist(at,loc);
      if (distance<=settings.maxProjectDistance) {
        const clean=weights.map(n=>Math.max(0,Math.min(1,n))), total=sum(clean);
        hits.push({tri,weights:clean.map(n=>n/total),distance,normalDot,confidence:faces.get(face)});
      }
    }
    hits.sort((a,b)=>a.distance-b.distance || b.confidence-a.confidence || order(a.tri.face,b.tri.face));
    const best=hits[0];
    if (!best) return {reason:'no-surface-match'};
    const support=hit=>new Map(hit.tri.labels.map((id,i)=>[id,hit.weights[i]]).filter(([,w])=>w>1e-7));
    const assigned=support(best);
    const contenders=hits.filter(hit=>hit.distance<=best.distance+settings.ambiguityDistance);
    const conflict=contenders.find(hit=>{
      const other=support(hit);
      return other.size!==assigned.size||[...other].some(([id,w])=>Math.abs(w-(assigned.get(id)??0))>1e-6);
    });
    if(conflict) return {reason:'ambiguous-surface',candidates:[best,conflict].map(hit=>({
      anchor:address(hit),distance:hit.distance,confidence:hit.confidence
    }))};
    return {...best,method:'mapped-surface'};
  }

  function transferHit(hit, right, faceLinks, cornerLinks, settings, work) {
    const allowed=new Map((faceLinks.from.get(hit.tri.face)??[]).map(row=>[row.to,row.confidence]));
    if (!allowed.size) return {reason:'unmapped-face'};
    const mapped=hit.tri.corners.map(id=>(cornerLinks.from.get(id)??[]).filter(row=>strong(row)&&allowed.has(right.corners.get(row.to).face)));
    const exact=[];
    for (const face of [...allowed.keys()].sort()) for (const tri of right.faces.get(face).triangles) {
      if (work.checks>=settings.maxChecks) return {reason:'projection-budget'};
      work.checks++;
      const order=tri.corners.map(id=>mapped.findIndex(rows=>rows.some(row=>row.to===id)));
      if (order.every(i=>i>=0)&&new Set(order).size===3)
        exact.push({tri,weights:order.map(i=>hit.weights[i]),method:'mapped-corners',confidence:allowed.get(face)});
    }
    if (exact.length===1) return exact[0];
    return surfaceProject(mix(hit.tri.p,hit.weights),allowed,[hit.tri.normal],right,settings,work);
  }

  function settings(input,left) {
    if (!record(input,['attachments','poses','maxRestError','maxPoseError','maxWeightError','maxAngle',
      'maxProjectDistance','minNormalDot','minConfidence','ambiguityDistance','maxChecks']))
      throw new TypeError('Invalid mesh attachment transfer settings');
    const bounds=spatial.boxOf([...left.vertices.values()].map(row=>row.position));
    const span=Math.max(1e-5,V.dist(bounds.min,bounds.max));
    const {maxRestError=span*.02,maxPoseError=span*.025,maxWeightError=.1,maxAngle=15,
      maxProjectDistance=span*.075,minNormalDot=.8,minConfidence=.5,ambiguityDistance=maxProjectDistance*1e-5,
      maxChecks=1000000, poses=[]}=input;
    if (![maxRestError,maxPoseError,maxWeightError,maxAngle,ambiguityDistance].every(n=>Number.isFinite(n)&&n>=0) ||
        !Number.isFinite(maxProjectDistance)||maxProjectDistance<=0||ambiguityDistance>maxProjectDistance ||
        maxAngle>180||maxWeightError>2||!unit(minNormalDot)||!unit(minConfidence)||
        !Number.isSafeInteger(maxChecks)||maxChecks<1||maxChecks>4000000||
        !Array.isArray(poses)||poses.length>24||new Set(poses.map(row=>row?.id)).size!==poses.length||
        !Array.from(poses).every(row=>record(row,['id','matrices'])&&name(row.id)&&row.matrices!==undefined))
      throw new RangeError('Use valid transfer budgets and up to 24 distinct named poses');
    return {maxRestError,maxPoseError,maxWeightError,maxAngle,maxProjectDistance,minNormalDot,minConfidence,ambiguityDistance,maxChecks,poses};
  }

  const rowWeight=(weights,joint)=>Object.hasOwn(weights??{},joint)?weights[joint]:0;
  function weightSource(vertex,left,right,faceLinks,exactVertices,config,work,matchedIds) {
    const id=vertex.id;
    if (matchedIds&&left.vertices.has(id)) return {ids:[id],weights:[1],method:'stable-vertex'};
    const exact=exactVertices.get(id);
    if (exact?.size===1) return {ids:[...exact],weights:[1],method:'mapped-corner-vertex'};
    const incident=[...(right.incident.get(id)??[])], allowed=new Map();
    for (const face of incident) for (const row of faceLinks.to.get(face)??[])
      allowed.set(row.from,Math.max(allowed.get(row.from)??0,row.confidence));
    if (!allowed.size) return {reason:'unmapped-vertex'};
    const normals=incident.flatMap(face=>right.faces.get(face).triangles.filter(tri=>tri.labels.includes(id)).map(tri=>tri.normal));
    const match=surfaceProject(vertex.position,allowed,normals,left,config,work);
    return match.reason ? match : {ids:match.tri.labels,weights:match.weights,method:match.method,
      anchor:address(match),confidence:match.confidence};
  }

  function skinTransfer(left,right,faceLinks,cornerLinks,config,work,matchedIds) {
    const source=left.doc, target=right.doc;
    if (!source.skin) return {document:target, rows:[], issues:[]};
    const {joints}=source.skin, skin=target.skin ?? source.skin;
    if (JSON.stringify(joints)!==JSON.stringify(skin.joints))
      throw new RangeError('Weight transfer requires the same named joints in matrix order');
    const base=target.skin ? target : topology.edit(target,{skin});
    const normalize=topology.skin.normalizer(base), slots=new Set(joints), locked=new Set(skin.locked);
    const fromWeights=new Map(topology.skin.inspect(source).vertices.map(row=>[row.id,row.effective]));
    const rows=[], issues=[], vertices=[], exactVertices=new Map();
    for (const [corner,matches] of cornerLinks.to) {
      const targetCorner=right.corners.get(corner);
      for (const link of matches) {
        const sourceCorner=left.corners.get(link.from);
        if (!strong(link)||!faceLinks.to.get(targetCorner.face)?.some(row=>row.from===sourceCorner.face)) continue;
        if(!exactVertices.has(targetCorner.vertex))exactVertices.set(targetCorner.vertex,new Set());
        exactVertices.get(targetCorner.vertex).add(sourceCorner.vertex);
      }
    }
    for (const vertex of target.vertices) {
      const match=weightSource(vertex,left,right,faceLinks,exactVertices,config,work,matchedIds);
      if (match.reason||match.ids.some(id=>!fromWeights.get(id))) {
        issues.push({vertex:vertex.id,reason:match.reason??'source-weights-unavailable',...(match.candidates&&{candidates:match.candidates})});
        continue;
      }
      const expected=Object.fromEntries(joints.map(joint=>[joint,Math.min(1,sum(match.ids.map((id,i)=>
        rowWeight(fromWeights.get(id),joint)*match.weights[i])))]).filter(([,n])=>n>0));
      const requested={...expected};
      for (const joint of locked) if (Object.hasOwn(vertex.weights??{},joint)) requested[joint]=vertex.weights[joint];
      const result=normalize(requested);
      if (result.problem) { issues.push({vertex:vertex.id,reason:result.problem}); continue; }
      const after=result.weights, weightError=sum(joints.map(joint=>Math.abs(rowWeight(expected,joint)-rowWeight(after,joint))));
      if (weightError>config.maxWeightError+1e-8) issues.push({vertex:vertex.id,reason:'weight-error',error:weightError});
      const auxiliary=Object.entries(vertex.weights??{}).filter(([joint])=>!slots.has(joint));
      vertices.push({...vertex,weights:{...Object.fromEntries(auxiliary),...after}});
      rows.push({id:vertex.id,match,expected,after,weightError,dropped:result.dropped,
        rest:distance(mix(match.ids.map(id=>left.vertices.get(id).position),match.weights),vertex.position),poses:[]});
    }
    return {document:topology.edit(base,{vertices}),rows,issues};
  }

  function distance(before,after) {
    return before&&after ? {before,after,error:V.dist(before,after)} : {before:before??null,after:after??null,error:null};
  }
  function compare(a,b) {
    const row=distance(a?.position,b?.position);
    if (!a||!b) return {...row,angle:null};
    const rotation=M.mul(M.tr(a.matrix),b.matrix);
    const angle=Math.acos(Math.max(-1,Math.min(1,(rotation[0]+rotation[4]+rotation[8]-1)*.5)))*180/Math.PI;
    return {...row,angle};
  }
  function posedPoint(map,ids,weights) {
    const rows=ids.map(id=>map.get(id));
    return rows.every(Boolean) ? mix(rows,weights) : null;
  }

  function transferAttachments(before,after,map,input={}) {
    const source=topology.create(before), target=topology.create(after);
    if (map?.format!=='ink-studio/topology-correspondence'||map.version!==1||
        map.before!==source.id||map.after!==target.id||map.beforeRevision!==topology.revision(source)||
        map.afterRevision!==topology.revision(target))
      throw new RangeError('Attachment transfer needs a topology correspondence pinned to both mesh revisions');
    if (!source.faces.length||!target.faces.length) throw new RangeError('Attachment transfer needs surface triangles');
    const left=catalog(source), right=catalog(target), config=settings(input,left), work={checks:0};
    const faceLinks=links(map.domains?.faces,left.faces,right.faces,config.minConfidence);
    const cornerLinks=links(map.domains?.corners,left.corners,right.corners,config.minConfidence);
    const incoming=manifest(left,input.attachments);
    const {document,rows:weights,issues}=skinTransfer(left,right,faceLinks,cornerLinks,config,work,map.matchedIds===true);
    const transferred=[];
    for (const {row,hit} of incoming) {
      const next=transferHit(hit,right,faceLinks,cornerLinks,config,work);
      if (next.reason) {
        issues.push({attachment:row.id,reason:next.reason,...(next.candidates&&{candidates:next.candidates})});
        continue;
      }
      const a=frame(hit,row), b=frame(next,row);
      const newRow={...row,anchor:address(next),
        ...(row.kind==='splat-group'&&a&&{reference:row.reference??{position:a.position,matrix:a.matrix}})};
      transferred.push({hit,next,newRow,source:row,report:{id:row.id,kind:row.kind,before:address(hit),after:address(next),
        method:next.method,confidence:next.confidence,rest:compare(a,b),poses:[]}});
    }
    const {poses,...budgets}=config;
    if (!poses.length && (source.skin || document.skin)) issues.push({reason:'pose-evidence-required'});
    const poseReady = !poses.length || [source,document].every(doc=>!doc.skin ||
      topology.skin.inspect(doc).vertices.every(row=>row.effective));
    if (!poseReady) issues.push({reason:'pose-skin-unavailable'});
    if (poses.length && poseReady) {
      const from=topology.toSceneMesh(source), to=topology.toSceneMesh(document);
      const a=source.skin&&topology.skin.bind(from), b=document.skin&&topology.skin.bind(to);
      for (const {id,matrices} of poses) {
        if (a) a.pose(matrices);
        if (b) b.pose(matrices);
        const old=points(from), revised=points(to);
        for (const row of weights) row.poses.push({id,...distance(posedPoint(old,row.match.ids,row.match.weights),revised.get(row.id))});
        for (const {hit,next,newRow,source,report} of transferred) report.poses.push({id,...compare(
          frame(hit,source,hit.tri.labels.map(id=>old.get(id))),
          frame(next,newRow,next.tri.labels.map(id=>revised.get(id))))});
      }
    }
    function validate(row, scope) {
      for (const [pose,sample,budget] of [[null,row.rest,config.maxRestError],
        ...row.poses.map(sample=>[sample.id,sample,config.maxPoseError])]) {
        if (sample.error===null||sample.error>budget+1e-8||sample.angle!==undefined&&(sample.angle===null||sample.angle>config.maxAngle+1e-8))
          issues.push({...scope,pose,reason:sample.error===null?'unavailable-frame':
            sample.error>budget+1e-8 ? (pose===null?'rest-error':'pose-error') : 'orientation-error',error:sample.error,
            ...(sample.angle!==undefined&&{angle:sample.angle})});
      }
    }
    for (const row of weights) validate(row,{vertex:row.id});
    const attachments=transferred.map(row=>row.report);
    for (const row of attachments) validate(row,{attachment:row.id});
    const binding=topology.attachments.create(document,transferred.map(row=>row.newRow));
    function peak(rows,pick) {
      return rows.reduce((max,row)=>Math.max(max,pick(row)??0),0);
    }
    const comparisons=[...weights,...attachments];
    const report={format:'ink-studio/mesh-attachment-transfer-report',version:1,
      beforeRevision:map.beforeRevision,replacementRevision:map.afterRevision,afterRevision:topology.revision(document),
      canCommit:!issues.length,budgets,checks:work.checks,poses:poses.map(row=>row.id),weights,attachments,issues,
      maxRestError:peak(comparisons,row=>row.rest.error),
      maxPoseError:poses.length&&poseReady?peak(comparisons,row=>peak(row.poses,sample=>sample.error)):null};
    return {document,attachments:binding,report};
  }

  K.meshTopology=Object.freeze({...topology,transferAttachments});
})(KIT);
