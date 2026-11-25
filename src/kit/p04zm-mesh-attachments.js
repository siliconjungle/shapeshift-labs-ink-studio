/* A retained triangle frame for sockets, grown roots, and rigid splat groups. */
const meshAttachmentGeometry = ((K) => {
  const { V, M, sceneMeshes: native } = K, topology = K.meshTopology;
  const format = 'ink-studio/mesh-attachments';
  const record = (row, fields) => row && Object.getPrototypeOf(row) === Object.prototype &&
    (!fields || Object.keys(row).every(key => fields.includes(key)));
  const name = TargetSelectors.name;
  const axes = [0,1,2];
  const vector = (value, length = 3) => Array.isArray(value) && value.length === length &&
    Array.from(value).every(Number.isFinite);
  const mix = (points, weights) => axes.map(k=>points.reduce((sum,p,i)=>sum+p[k]*weights[i],0));
  const key = ids => JSON.stringify([...ids].sort());
  const unit = n => Number.isFinite(n) && n>=0 && n<=1;

  function catalog(doc) {
    const vertices = new Map(doc.vertices.map(row=>[row.id,row]));
    const faces = new Map(doc.faces.map(row=>[row.id,{row,triangles:[]}]));
    const corners = new Map(), incident = new Map();
    for (const face of doc.faces) for (const corner of face.corners) {
      corners.set(corner.id,{...corner,face:face.id});
      if (!incident.has(corner.vertex)) incident.set(corner.vertex,new Set());
      incident.get(corner.vertex).add(face.id);
    }
    const triangles = new Map();
    for (const {face,corners:ids} of topology.triangulate(doc).triangleSources) {
      const labels = ids.map(id=>corners.get(id).vertex), p = labels.map(id=>vertices.get(id).position);
      const [a,b,c] = p, u=V.sub(b,a), v=V.sub(c,a);
      const tri = {face,corners:ids,labels,a,b,c,u,v,p,normal:V.norm(V.cross(u,v))};
      faces.get(face).triangles.push(tri);
      triangles.set(key(ids),tri);
    }
    return {doc,vertices,faces,corners,incident,triangles};
  }

  function resolve(catalog, anchor) {
    if (!record(anchor,['face','corners','weights']) || !vector(anchor.weights) || !anchor.weights.every(unit) ||
        Math.abs(anchor.weights.reduce((sum,n)=>sum+n,0)-1)>1e-7 ||
        !Array.isArray(anchor.corners) || anchor.corners.length!==3 || !Array.from(anchor.corners).every(name) ||
        new Set(anchor.corners).size!==3) throw new RangeError('An attachment needs three named triangle corners and normalized barycentrics');
    const tri = catalog.triangles.get(key(anchor.corners));
    if (tri?.face!==anchor.face || !tri) throw new RangeError('Attachment corners do not form a triangle on face '+anchor.face);
    return {tri,weights:tri.corners.map(id=>anchor.weights[anchor.corners.indexOf(id)])};
  }
  const address = ({tri,weights}) => ({face:tri.face,corners:tri.corners.slice(),weights:weights.slice()});

  function manifest(index, raw = {format,version:1,mesh:index.doc.id,revision:topology.revision(index.doc),attachments:[]}) {
    if (!record(raw,['format','version','mesh','revision','attachments']) || raw.format!==format || raw.version!==1 ||
        raw.mesh!==index.doc.id || raw.revision!==topology.revision(index.doc) ||
        !Array.isArray(raw.attachments) || raw.attachments.length>4096)
      throw new RangeError('Use a mesh attachment manifest pinned to this topology revision');
    const ids = new Set(), sockets = new Set(), groups = new Set(), splats = new Set(), S=K.sceneGraph;
    const rows = [];
    for (const row of raw.attachments) {
      const base=['id','kind','anchor','tangent','offset'];
      if (!name(row?.id) || ids.has(row.id) || !['socket','curve-root','splat-group'].includes(row.kind) ||
          row.tangent!==undefined && (!vector(row.tangent) || V.len(row.tangent)<=1e-10) ||
          row.offset!==undefined && !vector(row.offset))
        throw new RangeError('Invalid or duplicate mesh attachment');
      if (row.kind==='socket') {
        if (!record(row,[...base,'node','socket']) || !name(row.node) || !name(row.socket) || sockets.has(key([row.node+'\0'+row.socket])))
          throw new RangeError('Mesh sockets need distinct node and socket references');
        sockets.add(key([row.node+'\0'+row.socket]));
      } else if (row.kind==='splat-group') {
        if (!record(row,[...base,'group','members','reference']) || !name(row.group) || groups.has(row.group) ||
            !Array.isArray(row.members) || !row.members.length || row.members.length>32768 ||
            !Array.from(row.members).every(id=>SplatProvenance.validId(id) && !splats.has(id)) ||
            new Set(row.members).size!==row.members.length)
          throw new RangeError('Mesh splat groups need distinct stable member IDs and group names');
        if (row.reference!==undefined) S.transform(row.reference);
        groups.add(row.group);
        for (const id of row.members) splats.add(id);
      } else if (!record(row,base)) throw new RangeError('Invalid mesh curve-root fields');
      ids.add(row.id);
      rows.push({row,hit:resolve(index,row.anchor)});
    }
    return rows;
  }

  function frame(hit, row, points = hit.tri.p) {
    if (points.some(p=>!p)) return null;
    const {tri,weights}=hit, [a,b,c]=points;
    const u=V.sub(b,a), v=V.sub(c,a), cross=V.cross(u,v);
    if (V.len(cross)<1e-10) return null;
    const n=V.norm(cross), direction = row.tangent ?? [1,0,0];
    const tangent = V.norm(V.mad(direction,tri.normal,-V.dot(tri.normal,direction)),V.perp(tri.normal));
    const e=V.dot(tri.u,tri.u), f=V.dot(tri.u,tri.v), g=V.dot(tri.v,tri.v), det=e*g-f*f;
    if (!(det>0)) return null;
    const s=V.dot(tangent,tri.u), t=V.dot(tangent,tri.v);
    const x=V.norm(V.add(V.mul(u,(g*s-f*t)/det),V.mul(v,(e*t-f*s)/det)),V.perp(n));
    const y=V.cross(n,x), matrix=M.tr([...x,...y,...n]), position=V.add(mix(points,weights),M.app(matrix,row.offset ?? [0,0,0]));
    return {position,matrix,tangent:x,bitangent:y,normal:n};
  }

  function points(mesh) {
    const {positions}=native.geometry(mesh);
    return new Map(Array.from({length:mesh.vertices},(_,i)=>[topology.sourceVertex(mesh,i),
      Array.from(positions.subarray(i*3,i*3+3))]));
  }

  function bind(mesh, raw) {
    const doc=topology.sourceDocument(mesh);
    if (!doc) throw new TypeError('Mesh attachments need retained topology geometry');
    const S=K.sceneGraph, rows=manifest(catalog(doc),raw), byId=new Map(rows.map(item=>[item.row.id,item]));
    let revision, current;
    function at(id) {
      const item=byId.get(id);
      if (!item) return null;
      const tick=native.revision(mesh);
      if (tick!==revision) { current=points(mesh); revision=tick; }
      return frame(item.hit,item.row,item.hit.tri.labels.map(label=>current.get(label)));
    }
    function root(id) {
      const live=byId.get(id)?.row.kind==='curve-root' && at(id);
      return live ? {p:live.position,n:live.normal,tangent:live.tangent,bitangent:live.bitangent} : null;
    }
    function poseSockets(graph) {
      const items=rows.filter(({row})=>row.kind==='socket').map(({row})=>{
        graph.frame({node:row.node,socket:row.socket});
        const live=at(row.id);
        if (!live) throw new RangeError('Collapsed mesh socket '+row.id);
        let depth=0, node=row.node;
        while (graph.node(node).parent) { node=graph.node(node).parent.node; depth++; }
        return {row,live,depth};
      });
      for (const {row,live} of items.sort((a,b)=>a.depth-b.depth))
        graph.setSocket(row.node,row.socket,S.compose(S.inverse(graph.frame(row.node)),live));
      return items.length;
    }
    function bindSplats(world) {
      const identity=SplatProvenance.identities(world);
      const groups=rows.filter(({row})=>row.kind==='splat-group').map(({row,hit})=>{
        const indices=row.members.map(id=>identity.rowOf(id));
        if (indices.some(i=>i<0 || Math.round(world.data[i*16+11])%16!==0 || CurveSplat.isRow(world.data,i*16)))
          throw new RangeError('Splat group '+row.group+' needs available static member rows');
        const {position,matrix}=row.reference ? S.transform(row.reference) : frame(hit,row);
        const original=S.inverse(S.transform({position,matrix}));
        return {row,indices,original,rest:K.deform.rest(world,indices)};
      });
      return Object.freeze({pose() {
        const next=groups.map(group=>{
          const live=at(group.row.id);
          if (!live) throw new RangeError('Collapsed mesh splat group '+group.row.group);
          const {indices}=group;
          if (indices.some((i,k)=>SplatProvenance.identities(world).rowOf(group.row.members[k])!==i))
            throw new RangeError('Mesh splat group rows changed since binding');
          const transform=S.compose(live,group.original);
          return {group,map:Object.assign(p=>S.point(transform,p),{jacobian:()=>transform.matrix})};
        });
        for (const {group,map} of next) K.deform.apply(world,group.indices,group.rest,map);
        return groups.length;
      }});
    }
    return Object.freeze({mesh,frame:at,root,poseSockets,bindSplats,revision:()=>native.revision(mesh)});
  }

  function create(source, attachments) {
    const doc=topology.create(source), raw={format,version:1,mesh:doc.id,revision:topology.revision(doc),attachments};
    manifest(catalog(doc),raw);
    return K.procedural.data.freeze(K.procedural.data.clone(raw));
  }

  K.meshTopology=Object.freeze({...topology,attachments:Object.freeze({create,bind})});
  return { catalog,manifest,frame,points,address,record,vector,mix };
})(KIT);
