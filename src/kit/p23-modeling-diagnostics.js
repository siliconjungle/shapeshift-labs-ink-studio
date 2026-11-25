/* Compact geometry evidence for graph and retained modifier stages. */
(function (K) {
  const P=K.procedural, {freeze}=P.data;
  const domains=['vertices','edges','faces','corners'];
  const own=(row,key)=>row!=null&&Object.hasOwn(row,key);
  const equal=(a,b)=>K.world.data.equal(a,b);
  const retained=value=>value?.format==='ink-studio/mesh-topology';

  function receipt(value) {
    const {kind,status='performed',sourceIds=[],counts={},...detail}=value??{};
    if (!['remesh','rebake','upload'].includes(kind)||!['performed','required'].includes(status)||
        !Array.isArray(sourceIds)||sourceIds.length>250001||!Array.from(sourceIds).every(id=>typeof id==='string'&&id.length<=1024)||
        !counts||typeof counts!=='object'||Array.isArray(counts)||
        Object.values(counts).some(n=>!Number.isFinite(n)||n<0))
      throw new TypeError('Expected a modeling work receipt with source IDs and nonnegative counts');
    const ids=[...new Set(sourceIds)].sort();
    return freeze(P.data.clone({kind,status,sourceIds:ids.slice(0,256),counts,...detail,
      ...(ids.length>256&&{sourceCount:ids.length})}));
  }

  function inspect(value, { limit=64 }={}) {
    if (value===undefined) return null;
    try {
      let document, identity='retained';
      if (retained(value)) document=K.meshTopology.create(value);
      else if (P.graphTypes.validator('mesh')(value)) {
        identity='local-indices';
        const mesh=P.sceneGraph.mesh(value);
        document=K.meshTopology.fromIndexed({id:'watched-mesh',positions:mesh.pos,indices:mesh.tri,
          faceMaterials:mesh.tmat,
          materials:mesh.mats.map((row,i)=>row.name+'-'+i)});
      } else return null;
      const topology=K.meshTopology.inspect(document);
      const summary={identity, id:document.id, revision:K.meshTopology.revision(document),
        vertices:topology.vertices, edges:topology.edges.length, faces:topology.faces, triangles:topology.triangles};
      const health=K.meshTopology.health(document,{limit,maxPairs:25000});
      return {document,summary,health};
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
      return {error:error.message};
    }
  }

  function attributeFields(row,domain) {
    if (!row) return new Map();
    const keys=domain==='vertices' ? ['weights'] : domain==='edges' ? ['smooth','crease','uvSeam','uvSeams'] :
      domain==='faces' ? ['material'] : ['uv','uvPinned','uvPins','normal'];
    return new Map([...keys.filter(key=>own(row,key)).map(key=>[key,row[key]]),
      ...Object.entries(row.attributes??{}).map(([key,value])=>['attributes/'+key,value])]);
  }

  function compare(before, after, {limit=64,lineage={}}={}) {
    if (!Number.isSafeInteger(limit)||limit<1||limit>512) throw new RangeError('Modeling evidence limit must be 1–512');
    const old=before?.document, next=after?.document;
    const comparable=Boolean(old&&next&&before.summary.identity==='retained'&&after.summary.identity==='retained'&&old.id===next.id);
    const changes={};
    if (comparable) {
      const diff=old===next?null:K.authoring.meshTopologyScene.diff({document:old},{document:next});
      for (const domain of domains) {
        const sources=new Set(), changed=[], attributes=[], origins=new Map();
        let attributeCount=0;
        const rows=diff?.[domain]??[];
        const targets=new Set(rows.filter(row=>row.after).map(row=>row.id));
        for (const {from,to} of lineage[domain]??[]) if(targets.has(to)) {
          sources.add(from);
          if (!origins.has(to)) origins.set(to,new Set());
          origins.get(to).add(from);
        }
        const originals=origins.size && new Map((domain==='corners' ? old.faces.flatMap(face=>face.corners) :
          domain==='edges'?K.meshTopology.inspect(old).edges:old[domain]).map(row=>[row.id,row]));
        for (const {id,before:left,after:right} of rows) {
          if (left) sources.add(id);
          const from=origins.get(id);
          if (changed.length<limit) changed.push({id,change:!left?'added':!right?'removed':'changed',
            ...(from && {from:[...from].sort().slice(0,limit)})});
          const original=left??(from?.size===1?originals.get(from.values().next().value):undefined);
          const a=attributeFields(original,domain), b=attributeFields(right,domain);
          for (const key of new Set([...a.keys(),...b.keys()])) {
            const copied=!left&&a.has(key)&&b.has(key)&&equal(a.get(key),b.get(key));
            if (!copied&&equal(a.get(key),b.get(key))) continue;
            if (++attributeCount<=limit) attributes.push({id,channel:key,...(copied&&{copied}),
              ...(a.has(key)&&{before:a.get(key)}),...(b.has(key)&&{after:b.get(key)})});
          }
        }
        changes[domain]={count:rows.length, changed, affected: [...sources].sort().slice(0,limit),
          affectedCount:sources.size, attributeCount, attributes};
      }
    }
    const side=row=>row && (row.error ? {error:row.error} : {...row.summary,health:row.health});
    return freeze({identity:comparable?'retained':'unmapped',before:side(before)??null,after:side(after)??null,
      ...(comparable&&{changes})});
  }

  function attributes(before,after,remap) {
    const a=before&&P.attributes.open(before), b=after&&P.attributes.open(after), limit=64;
    const left=new Map(a?.entities.map(({id},i)=>[id,i])), right=new Map(b?.entities.map(({id},i)=>[id,i]));
    const matches=new Map(remap?.rows?.map(row=>[row.id,row.from]));
    const compatible=a?.domain===b?.domain, changed=[], affected=new Set(), matched=new Set();
    let changeCount=0;
    function add(id,old,next,from) {
      for (const channel of new Set([...Object.keys(old),...Object.keys(next)])) {
        if (equal(old[channel],next[channel])) continue;
        if (++changeCount<=limit) changed.push({id,channel,from:from.slice(0,limit),
          ...(own(old,channel)&&{before:old[channel]}),...(own(next,channel)&&{after:next[channel]})});
        for (const source of from) affected.add(source);
      }
    }
    for (const [id,i] of right) {
      const from=matches.get(id)?.map(row=>row.id)??(compatible&&left.has(id)?[id]:[]);
      const old=from.length===1&&left.has(from[0]) ? a.read(left.get(from[0])) : {};
      for (const source of from) matched.add(source);
      add(id,old,b.read(i),from);
    }
    for (const [id,i] of left) if (!matched.has(id)) add(id,a.read(i),{},[id]);
    const issues=remap?.issues??[];
    return freeze({before:a?{domain:a.domain,elements:left.size,channels:[...a.channels.keys()]}:null,
      after:b?{domain:b.domain,elements:right.size,channels:[...b.channels.keys()]}:null,
      changeCount,changed,affectedCount:affected.size,affected:[...affected].slice(0,limit),
      issueCount:issues.length,issues:issues.slice(0,limit)});
  }

  P.modelingDiagnostics=Object.freeze({inspect,compare,attributes,receipt});
})(KIT);
