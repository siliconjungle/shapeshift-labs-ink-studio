/* Retained ring geometry from sweep profiles, loft sections and revolved meridians. */
(function (K) {
  const P = K.procedural, {V, meshTopology:Topology} = K, {freeze,clone,hash} = P.data;
  const format = 'ink-studio/section-mesh';
  const epsilon = 1e-8, tau = 2 * Math.PI;
  const sources = new WeakMap(), generated = new WeakMap(), revisions = new WeakMap();
  const names = ['sweep','loft','revolve'];
  const sectionFields = {
    sweep:['position','right','up','w','h','roll'],
    loft:['y','profile','center','scale','roll'],
    revolve:['y','radius']
  };
  const common = ['material','crease'];
  const record = row => row && Object.getPrototypeOf(row)===Object.prototype;
  const fields = (row, keys) => record(row) && Object.keys(row).every(key=>keys.includes(key));
  const name = value => typeof value==='string' && /^[a-zA-Z0-9_.-]{1,96}$/.test(value);
  const finite = n => Number.isFinite(n) && Math.abs(n)<=1e5;
  const positive = n => finite(n) && n>epsilon;
  const unit = n => Number.isFinite(n) && n>=0 && n<=1;
  const vec = (v,n) => Array.isArray(v) && v.length===n && Array.from(v).every(finite);
  const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
  const mix = (a,b,t) => a+(b-a)*t;
  const vertexId = (section, column) => 'ring/'+section+'/'+column;
  const edgeId = (a,b) => 'edge/'+JSON.stringify(a<b ? [a,b] : [b,a]);
  function need(ok, message) {
    if (!ok) throw new RangeError('Section mesh: '+message);
  }

  function area(points) {
    const [x,y]=points[0];
    return points.reduce((sum,[u,v],i)=>{
      const [a,b]=points[(i+1)%points.length];
      return sum+(u-x)*(b-y)-(v-y)*(a-x);
    },0);
  }

  function polygon(profile) {
    need(Array.isArray(profile) && profile.length>=3 && profile.length<=128 &&
      Array.from(profile).every(p=>vec(p,2)) && Math.abs(area(profile))>epsilon,'need a bounded, nonzero polygon profile');
    return profile.map(p=>p.slice());
  }

  function section(row, kind) {
    need(fields(row,['id',...common,...sectionFields[kind]]) && name(row.id), 'invalid section or ID');
    const {id,material='default',crease=0}=row;
    need(name(material) && unit(crease),'invalid material or crease on '+id);
    const base={id,material,crease};
    if (kind==='sweep') {
      const {position,right,up,w=.1,h=.02,roll=0}=row;
      need(vec(position,3) && vec(right,3) && vec(up,3) && V.len(right)>epsilon && V.len(up)>epsilon &&
        V.len(V.cross(right,up))>epsilon && positive(w) && positive(h) && finite(roll), 'invalid sweep frame or profile on '+id);
      return {...base,position:position.slice(),right:right.slice(),up:up.slice(),w,h,roll};
    }
    const {y}=row;
    need(finite(y),'invalid height on '+id);
    if (kind==='loft') {
      const {center=[0,0],scale=1,roll=0}=row;
      need(vec(center,2) && positive(scale) && finite(roll),'invalid loft placement on '+id);
      return {...base,y,profile:polygon(row.profile),center:center.slice(),scale,roll};
    }
    need(finite(row.radius) && (row.radius===0 || row.radius>epsilon),'radius must be zero or positive on '+id);
    return {...base,y,radius:row.radius};
  }

  function shape(raw) {
    need(fields(raw,['shape','fold','cup','round']),'invalid sweep profile options');
    const {shape='flat',fold=0,cup=0,round=.3}=raw;
    need(['flat','round','rect'].includes(shape) && finite(fold) && Math.abs(fold)<Math.PI/2 &&
      finite(cup) && unit(round),'invalid sweep shape, fold, cup, or roundness');
    return {shape,fold,cup,round};
  }

  function sectionColumns(kind, sections, sides) {
    const fractions = new Set(sides ? Array.from({length:sides},(_,i)=>i/sides) : []);
    if (kind==='loft')
      for (const {profile} of sections)
        for (let i=0;i<profile.length;i++) fractions.add(i/profile.length);
    need(fractions.size<=128,'profile correspondence exceeds 128 columns');
    return [...fractions].sort((a,b)=>a-b);
  }

  function create(raw) {
    if (sources.has(raw)) return raw;
    need(fields(raw,['format','version','kind','id','sections','sides','profile','closed','caps','capMaterial',
      'pose','origin','loops','profileCreases','attachments']) && raw.format===format && raw.version===1 &&
      names.includes(raw.kind) && name(raw.id) && Array.isArray(raw.sections) &&
      raw.sections.length>=2 && raw.sections.length<=256,'expected a version 1 sweep, loft, or revolve source');
    const {kind,id, capMaterial, sides=kind==='loft' ? 0 : 32, closed=false, caps=kind!=='revolve'&&!closed}=raw;
    need(typeof closed==='boolean' && (kind==='sweep' || !closed) && typeof caps==='boolean' &&
      (!(closed || kind==='revolve') || !caps) && (capMaterial===undefined || caps && name(capMaterial)) &&
      Number.isSafeInteger(sides) && (sides>=3 && sides<=128 || kind==='loft' && sides===0),'invalid sampling or cap settings');
    need((kind==='sweep' || raw.profile===undefined) && (kind==='loft' || raw.pose===undefined) &&
      (kind==='revolve' || raw.origin===undefined && raw.loops===undefined),'source fields must match the generator');
    const sections=Array.from(raw.sections,row=>section(row,kind)), byId=new Map(sections.map(row=>[row.id,row]));
    need(byId.size===sections.length && (!closed || sections.length>=3),'section IDs must be unique and a loop needs three rings');
    if (kind==='loft') {
      need(sections.every((row,i)=>i===0 || row.y-sections[i-1].y>epsilon),'loft elevations must increase');
      const sign=Math.sign(area(sections[0].profile));
      need(sections.every(row=>Math.sign(area(row.profile))===sign),'loft profiles need matching winding');
      for (const {profile} of sections) checkProfiles([profile]);
    }
    if (kind==='sweep')
      need(sections.every((row,i)=>i===0 || V.dist(sections[i-1].position,row.position)>epsilon) &&
        (!closed || V.dist(sections[0].position,sections.at(-1).position)>epsilon),'sweep stations need distinct adjacent positions');
    const columns=sectionColumns(kind,sections,sides);
    const profileCreases=raw.profileCreases ?? [];
    need(Array.isArray(profileCreases) && Array.from(profileCreases).every(x=>Number.isInteger(x)&&x>=0&&x<columns.length) &&
      new Set(profileCreases).size===profileCreases.length,'profile crease columns must be distinct and in range');
    const source={format,version:1,id,kind,sides,closed,caps,sections,profileCreases:profileCreases.slice().sort((a,b)=>a-b),
      ...(capMaterial!==undefined && {capMaterial})};
    let chains, contourSignature;
    if (kind==='sweep') source.profile=shape(raw.profile ?? {});
    else if (kind==='loft' && raw.pose!==undefined) {
      need(fields(raw.pose,['position','rotation','scale']),'invalid loft pose settings');
      P.transforms.local(raw.pose);
      source.pose=clone(raw.pose);
    }
    if (kind==='revolve') {
      const origin=raw.origin ?? [0,0,0], loops=raw.loops;
      need(vec(origin,3) && Array.isArray(loops) && loops.length>=1 && loops.length<=16 &&
        Array.from(loops).every(loop=>Array.isArray(loop)&&loop.length>=3),'revolve needs an origin and 1–16 closed meridians');
      const used=loops.flat();
      need(used.length===sections.length && new Set(used).size===used.length &&
        used.every(id=>byId.has(id)),'revolve meridians must name each section exactly once');
      const profiles=loops.map(loop=>polygon(loop.map(id=>{
        const {radius,y}=byId.get(id);
        return [radius,y];
      })));
      checkProfiles(profiles);
      const distance=profiles.map(P.geometry.profileDistance), nesting=profiles.map((points,i)=>
        distance.reduce((depth,fn,j)=>depth+Number(i!==j && fn(...points[0])<0),0));
      contourSignature=profiles.map((points,i)=>[Math.sign(area(points)),nesting[i]]);
      chains=loops.map((ids,i)=>({
        ids, closed:true, reverse:(Math.sign(area(profiles[i]))<0)!==(nesting[i]%2===1),
        lo:.04+.92*i/loops.length, hi:.04+.92*(i+1)/loops.length-.025/loops.length
      }));
      source.origin=origin.slice();
      source.loops=loops.map(loop=>loop.slice());
    } else {
      chains=[{ids:sections.map(row=>row.id),closed,reverse:kind==='loft' && area(sections[0].profile)<0,
        lo:.05,hi:caps ? .70 : .95}];
    }
    const anchors=raw.attachments??[], attachmentIds=new Set();
    need(Array.isArray(anchors) && anchors.length<=4096,'too many section attachments');
    source.attachments=Array.from(anchors,row=>{
      need(fields(row,['id','section','u']) && name(row.id) && !attachmentIds.has(row.id) &&
        byId.has(row.section) && unit(row.u),'invalid or duplicate section attachment');
      attachmentIds.add(row.id);
      return {id:row.id,section:row.section,u:row.u};
    });
    freeze(source);
    sources.set(source,{byId,columns,chains,contourSignature});
    return source;
  }

  function checkProfiles(profiles) {
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const sign=value=>Math.abs(value)<epsilon ? 0 : Math.sign(value);
    const edges=profiles.flatMap((pts,loop)=>pts.map((a,i)=>({a,b:pts[(i+1)%pts.length],i,loop,length:pts.length})));
    for (const [j,{a,b,i,loop,length}] of edges.entries()) {
      need(Math.hypot(a[0]-b[0],a[1]-b[1])>epsilon,'a profile edge collapsed');
      for (let k=j+1;k<edges.length;k++) {
        const row=edges[k];
        if (row.loop===loop && (row.i===i+1 || i===0&&row.i===length-1)) continue;
        const {a:c,b:d}=row;
        const overlaps=a.every((value,k)=>Math.max(Math.min(value,b[k]),Math.min(c[k],d[k]))<=
          Math.min(Math.max(value,b[k]),Math.max(c[k],d[k]))+epsilon);
        if (overlaps && sign(cross(a,b,c))*sign(cross(a,b,d))<=0 && sign(cross(c,d,a))*sign(cross(c,d,b))<=0)
          throw new RangeError('Section mesh: profile contours cross or touch');
      }
    }
  }

  function revision(input) {
    const src=create(input);
    if (!revisions.has(src)) {
      const text=JSON.stringify(src);
      revisions.set(src,[text.length,hash(text),hash(text,0x9e3779b9)].map(n=>n.toString(36)).join('-'));
    }
    return revisions.get(src);
  }

  function profilePoint(row,u) {
    const n=row.profile.length, at=u*n, i=Math.min(n-1,Math.floor(at+1e-10));
    const next=row.profile[(i+1)%n];
    return row.profile[i].map((v,k)=>mix(v,next[k],Math.max(0,at-i)));
  }

  function ring(src,row,columns) {
    const posed=src.pose && P.transforms.local(src.pose);
    let a,b, sin,cos;
    if (src.kind==='sweep') {
      a=V.norm(row.right);
      b=V.norm(V.sub(row.up,V.mul(a,V.dot(a,row.up))));
      cos=Math.cos(row.roll);
      sin=Math.sin(row.roll);
    }
    const pole=src.kind==='revolve' && row.radius===0;
    const positions=(pole ? [0] : columns).map(u=>{
      if (src.kind==='sweep') {
        const [x,y]=K.sweep.outline({...src.profile,w:row.w,h:row.h},tau*u);
        return V.add(row.position,V.add(V.mul(a,x*cos+y*sin),V.mul(b,-x*sin+y*cos)));
      }
      if (src.kind==='loft') {
        const p=P.forms.loft.point(profilePoint(row,u),row);
        return posed ? P.transforms.point(posed,p) : p;
      }
      return K.revolvePoint(src.origin,row.radius,row.y,u*tau);
    });
    return {pole,vertices:positions.map((position,i)=>({id:vertexId(row.id,i),position}))};
  }

  function sample(src,mesh,{section,u}) {
    const {columns,byId}=sources.get(src);
    need(byId.has(section) && unit(u),'attachment needs a section and a unit perimeter position');
    const vertices=mesh instanceof Map ? mesh : new Map(mesh.vertices.map(row=>[row.id,row.position]));
    if (src.kind==='revolve' && byId.get(section).radius===0) {
      const key=vertexId(section,0);
      need(vertices.has(key),'attachment section no longer has its pole or ring');
      return {section,u,p:vertices.get(key),vertices:[key],weights:[1]};
    }
    const i=Math.max(0,columns.findIndex((value,k)=>u>=value && (u<(columns[k+1]??1) || k===columns.length-1)));
    const fraction=(u-columns[i])/((columns[i+1]??1)-columns[i]);
    const keys=[vertexId(section,i),vertexId(section,(i+1)%columns.length)];
    need(keys.every(id=>vertices.has(id)),'attachment section no longer has its ring');
    return {section,u,p:V.lerp(...keys.map(key=>vertices.get(key)),fraction),vertices:keys,weights:[1-fraction,fraction]};
  }

  function layout(src) {
    const meta=sources.get(src), {columns,byId,chains}=meta, n=columns.length;
    const rings=new Map(src.sections.map(row=>[row.id,ring(src,row,columns)]));
    const faceOwners=new Map(), rimSections=new Set();
    const edges=new Map(), faces=[], uCoord=u=>.035+.93*u;
    const vertex=(id,i)=>vertexId(id,rings.get(id).pole ? 0 : i%n);
    function edge(a,b,settings) {
      if (a===b || !Object.keys(settings).length) return;
      const id=edgeId(a,b), prior=edges.get(id);
      edges.set(id,{id,vertices:[a,b],...prior,...settings});
    }
    function face(id,owner,items,reverse) {
      const corners=(reverse?items.slice().reverse():items).map(([vertex,uv])=>({id:id+'/'+vertex,vertex,uv}));
      faces.push({id,material:owner.startsWith('cap/') ? src.capMaterial ?? byId.get(owner.slice(4)).material : byId.get(owner).material,corners});
      faceOwners.set(id,owner);
    }
    const mirror=src.pose && K.M.det(P.transforms.local(src.pose).R)<0;
    for (const {ids,closed,reverse,lo,hi} of chains) {
      const intervals=ids.length-(closed ? 0 : 1);
      const flipped=Boolean(reverse)!==Boolean(mirror);
      for (let s=0;s<intervals;s++) {
        const a=ids[s], b=ids[(s+1)%ids.length], poleA=rings.get(a).pole, poleB=rings.get(b).pole;
        if (poleA && poleB) continue;
        const v0=mix(lo,hi,s/intervals), v1=mix(lo,hi,(s+1)/intervals);
        for (let i=0;i<n;i++) {
          const u0=uCoord(columns[i]), u1=uCoord(columns[i+1]??1), poleU=(u0+u1)/2;
          const a0=vertex(a,i),a1=vertex(a,i+1),b0=vertex(b,i),b1=vertex(b,i+1);
          const from=poleA ? [[a0,[poleU,v0]]] : [[a0,[u0,v0]]];
          const to=poleB ? [[b0,[poleU,v1]]] : [[b0,[u0,v1]],[b1,[u1,v1]]];
          const key='band/'+a+'/'+i, quad=[...from,...to,...(poleA?[]:[[a1,[u1,v0]]])];
          if (src.kind==='loft') {
            // A pair of corresponding profile edges need not be coplanar.
            // Keep a fixed diagonal so a local profile edit retains both face IDs.
            face(key+'/a',a,quad.slice(0,3),flipped);
            face(key+'/b',a,[quad[0],quad[2],quad[3]],flipped);
          } else face(key,a,quad,flipped);
          edge(a0,b0,{...(i===0 && {uvSeam:true}),...(src.profileCreases.includes(i)&&{crease:1,smooth:false})});
        }
      }
      if (src.caps) {
        for (const [i,key] of [ids[0],ids.at(-1)].entries()) {
          const u= i===0 ? .245 : .755;
          face('cap/'+key,'cap/'+key,columns.map((t,j)=>[vertex(key,j),
            [u+Math.cos(t*tau)*.18,.855+Math.sin(t*tau)*.105]]),flipped!==(i===1));
          rimSections.add(key);
        }
      }
      for (const [i,key] of ids.entries()) if (!rings.get(key).pole) for (let j=0;j<n;j++) {
        const rim=rimSections.has(key), crease=rim ? 1 : byId.get(key).crease;
        edge(vertex(key,j),vertex(key,j+1),{
          ...(crease && {crease,smooth:false}), ...((rim || closed&&i===0) && {uvSeam:true})});
      }
    }
    need(faces.length>0,'the source produced no side or cap faces');
    const mesh=Topology.create({id:src.id,vertices:[...rings.values()].flatMap(row=>row.vertices),faces,edges:[...edges.values()],
      shading:{smooth:true,weighting:'area-angle'}});
    return {mesh,faceOwners,rimSections};
  }

  function result(src,mesh) {
    const {columns}=sources.get(src), vertex=new Map(mesh.vertices.map(row=>[row.id,row.position]));
    return freeze({source:src,mesh,report:{revision:revision(src),meshRevision:Topology.revision(mesh),
      columns:columns.length,sections:src.sections.map(({id,material,crease,radius})=>({id,material,crease,
        vertices:(radius===0 ? [0] : columns).map((_,i)=>vertexId(id,i))})),
      attachments:src.attachments.map(row=>({id:row.id,...sample(src,vertex,row)}))}});
  }

  function compile(input) {
    const src=create(input);
    if (!generated.has(src)) {
      const {mesh,faceOwners,rimSections}=layout(src);
      generated.set(src,{mesh,faceOwners,rimSections});
    }
    return result(src,generated.get(src).mesh);
  }

  function plan(input, request, { mesh:authored } = {}) {
    const before=compile(input), src=before.source, beforeState=sources.get(src);
    need(fields(request,['revision','meshRevision','sections']) && Array.isArray(request.sections) &&
      request.sections.length>=1 && request.sections.length<=256,'edit one or more existing sections');
    const old=authored===undefined ? before.mesh : Topology.create(authored);
    need(old.id===before.mesh.id,'editable mesh ID must match its generated source');
    need(request.revision===undefined || before.report.revision===request.revision,'source revision changed');
    need(request.meshRevision===undefined || Topology.revision(old)===request.meshRevision,'editable mesh revision changed');
    const edits=new Map();
    for (const row of request.sections) {
      const from=beforeState.byId.get(row?.id);
      need(from && !edits.has(row.id) && fields(row,['id',...common,...sectionFields[src.kind]]) &&
        Object.keys(row).length>1,'choose a distinct retained section with editable fields');
      if (row.profile!==undefined)
        need(Array.isArray(row.profile) && row.profile.length===from.profile.length &&
          Array.from(row.profile).every(p=>vec(p,2)) && Math.sign(area(row.profile))===Math.sign(area(from.profile)),
          'local loft edits must keep profile count and winding');
      if (row.radius!==undefined) need((row.radius===0)===(from.radius===0),'local revolve edits must retain axis poles');
      edits.set(row.id,{...from,...row});
    }
    const candidate=create({...src,sections:src.sections.map(row=>edits.get(row.id)??row)});
    const next=sources.get(candidate);
    need(same(beforeState.contourSignature,next.contourSignature),'local revolve edits must retain meridian winding and nesting');
    const expected=new Map(before.mesh.vertices.map(row=>[row.id,row]));
    const vertices=new Map(old.vertices.map(row=>[row.id,row]));
    const faces=new Map(old.faces.map(row=>[row.id,row]));
    const baseFaces=new Map(before.mesh.faces.map(row=>[row.id,row]));
    const edges=new Map(old.edges.map(row=>[row.id,row]));
    const {faceOwners,rimSections}=generated.get(src), patch={vertices:[],faces:[],edges:[]};
    const changedSections=[], dirtyFaces=new Set(), changedVertices=new Set(), creaseVertices=new Set();
    for (const id of edits.keys()) {
      const a=beforeState.byId.get(id), b=next.byId.get(id);
      if (same(a,b)) continue;
      changedSections.push(id);
      for (const {id:vertex,position} of ring(candidate,b,next.columns).vertices) {
        const base=expected.get(vertex), actual=vertices.get(vertex);
        need(actual,'missing editable ring vertex '+vertex);
        if (same(position,base.position)) continue;
        const changed=same(base.position,actual.position) ? position : V.add(actual.position,V.sub(position,base.position));
        patch.vertices.push({id:vertex,position:changed});
        changedVertices.add(vertex);
      }
      if (a.crease!==b.crease && !rimSections.has(id) && b.radius!==0)
        for (let i=0;i<next.columns.length;i++) {
          const key=edgeId(vertexId(id,i),vertexId(id,(i+1)%next.columns.length));
          need(edges.has(key),'missing editable crease edge '+key);
          patch.edges.push({id:key,smooth:b.crease ? false : null,crease:b.crease || null});
          for (const vertex of edges.get(key).vertices) creaseVertices.add(vertex);
        }
    }
    for (const [id,owner] of faceOwners) {
      const cap=owner.startsWith('cap/'), section=cap ? owner.slice(4) : owner;
      const base=baseFaces.get(id), face=faces.get(id), material=next.byId.get(section).material;
      const dirty=base.corners.some(row=>changedVertices.has(row.vertex));
      const rebinding=!(cap&&src.capMaterial) && material!==beforeState.byId.get(section).material;
      if (!dirty && !rebinding && !base.corners.some(row=>creaseVertices.has(row.vertex))) continue;
      need(face && same(base.corners.map(row=>row.vertex),face.corners.map(row=>row.vertex)),
        'affected generated face changed connectivity '+id);
      if (rebinding) patch.faces.push({...face,material});
      dirtyFaces.add(id);
    }
    const mesh=Object.values(patch).some(rows=>rows.length) ? Topology.edit(old,patch) : old;
    if (old===before.mesh) generated.set(candidate,{mesh,faceOwners,rimSections});
    const output=result(candidate,mesh), prior=old===before.mesh ? before : result(src,old);
    return freeze({...output,patch,report:{...output.report,inputRevision:before.report.revision,inputMeshRevision:prior.report.meshRevision,
      changedSections,dirtyFaces:[...dirtyFaces],reusedFaces:old.faces.length-dirtyFaces.size,
      changedVertices:[...changedVertices],changedCreases:patch.edges.map(row=>row.id),
      attachments:output.report.attachments.map((row,i)=>({...row,before:prior.report.attachments[i].p,
        displacement:V.dist(row.p,prior.report.attachments[i].p)}))}});
  }

  function sweep(path, profile={}, options={}) {
    const points=(Array.isArray(path) ? path : path?.points);
    need(Array.isArray(points) && points.length>=2 && points.length<=257 &&
      Array.from(points).every(p=>vec(p,3)),'sweep mesh needs 2–256 sections, plus an optional repeated seam');
    const {id='sweep', sections:authored, up, material='default', closed=path?.closed ??
      (points.length>3 && V.dist(points[0],points.at(-1))<epsilon), ...settings}=options;
    const repeated=closed && V.dist(points[0],points.at(-1))<epsilon;
    const frames=K.curve.frames(closed && !repeated ? [...points,points[0]] : points,up,closed);
    const rings=closed ? frames.slice(0,-1) : frames;
    need(authored===undefined || Array.isArray(authored)&&authored.length===rings.length,'section settings must match sweep rings');
    const {w=.1,h=.02,twist=0,...profileOptions}=profile;
    const at=(value,t)=>typeof value==='function' ? value(t) : value;
    const sections=rings.map(({p,B,N,t},i)=>({id:'section-'+i,material,w:at(w,t),h:at(h,t),roll:at(twist,t)*tau*t,
      ...authored?.[i],position:p,right:B,up:N}));
    return compile({format,version:1,id,kind:'sweep',sections,closed,profile:profileOptions,...settings});
  }

  function loft(sections, options={}) {
    const {id='loft',material='default',...settings}=options;
    need(Array.isArray(sections),'loft needs a list of polygon sections');
    return compile({format,version:1,id,kind:'loft',sections:sections.map((row,i)=>({id:'section-'+i,material,...row})),...settings});
  }

  function revolve(outline,origin=[0,0,0],options={}) {
    const {id='revolve',material='default',sections:authored,...settings}=options;
    need(Array.isArray(outline) && Array.from(outline).every(loop=>Array.isArray(loop) &&
      Array.from(loop).every(p=>vec(p,2))),'revolve needs closed loops of radius and height pairs');
    need(authored===undefined || Array.isArray(authored) && authored.length===outline.length,
      'section settings must match the meridians');
    const rings=outline.map((loop,i)=>{
      const points=loop.length>1 && same(loop[0],loop.at(-1)) ? loop.slice(0,-1) : loop;
      need(!authored || Array.isArray(authored[i])&&authored[i].length===points.length,'section settings must match meridian rings');
      return points.map(([radius,y],j)=>({id:'section-'+i+'-'+j,material,...authored?.[i]?.[j],radius,y}));
    });
    return compile({format,version:1,id,kind:'revolve',origin,sections:rings.flat(),loops:rings.map(loop=>loop.map(row=>row.id)),...settings});
  }

  P.sectionMeshes=Object.freeze({format,create,compile,plan,revision,sweep,loft,revolve,
    anchor:(input,location,{mesh}={})=>{
      const src=create(input);
      return sample(src,mesh ? Topology.create(mesh) : compile(src).mesh,location);
    }});
  K.sweep.mesh=sweep;
  P.forms.loft.mesh=loft;
})(KIT);
