/* Tiled solid operands with retained atlas paint and topology transactions. */
(function (K) {
  const A = K.authoring, T = K.meshTopology, {V} = K, {freeze} = K.procedural.data;
  const fields = ['id','object','part','mode','orientation','at','fromFace','edge','size','depth','snapGrid',
    'selection','paint','uvInset','material','materialDefinition'];
  const sides = [
    ['seat',[1,0,3,2]],['cap',[4,5,6,7]],['near',[0,1,5,4]],
    ['right',[1,2,6,5]],['far',[2,3,7,6]],['left',[3,0,4,7]]
  ];
  const unitBox = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const name = value=>typeof value === 'string' && Boolean(value.trim());
  const positive = n=>Number.isFinite(n) && n>0;
  const finite = (values,length)=>Array.isArray(values) && values.length===length && Array.from(values).every(Number.isFinite);

  function supportFrame(frame, document, request) {
    const {fromFace,orientation='fixed',edge:id,mode,size,depth} = request;
    const g = retainedMeshHealth.incidence(document), face = g.faces.get(fromFace);
    if (!face) throw new RangeError('Unknown block support face '+fromFace);
    const points = face.corners.map(corner=>g.vertices.get(corner.vertex).position);
    const normal = V.norm(meshFaceRegionGeometry.area(points));
    const edges = g.edges.filter(edge=>edge.uses.some(use=>use.face === fromFace));
    const edge = id === undefined ? edges[0] : edges.find(edge=>edge.id === id);
    if (!edge) throw new RangeError('Block orientation edge must belong to '+fromFace);
    const {from,to} = edge.uses.find(use=>use.face === fromFace);
    const tangent = V.sub(g.vertices.get(g.corners.get(to).vertex).position,g.vertices.get(g.corners.get(from).vertex).position);
    const project = axis=>V.mad(axis,normal,-V.dot(axis,normal));
    const reference = orientation === 'edge-relative' ? project(tangent) :
      frame.axes.slice(0,2).map(project).find(axis=>V.len(axis)>1e-8);
    const right = V.norm(reference), up = V.cross(normal,right);
    const local = points.map(point=>V.sub(point,points[0]));
    const bounds = [right,up].map(axis=>{
      const values = local.map(point=>V.dot(point,axis));
      return [Math.min(...values),Math.max(...values)];
    });
    const width = bounds[0][1]-bounds[0][0], height = bounds[1][1]-bounds[1][0];
    const extent = size ?? [width,height,depth];
    const origin = V.mad(V.mad(points[0],right,(bounds[0][0]+bounds[0][1]-extent[0])/2),
      up,(bounds[1][0]+bounds[1][1]-extent[1])/2);
    const base = mode === 'subtract' ? V.mad(origin,normal,-extent[2]) : origin;
    return {origin:base,axes:[right,up,normal],size:extent,face,points,edges,g,
      ...(orientation === 'edge-relative' && {edge:edge.id})};
  }

  function placement(scene, document, request) {
    if (request.fromFace !== undefined && !document) throw new RangeError('A face-anchored block needs an editable mesh');
    const plane = A.constructionPlane, frame = plane.forScene(scene);
    if (request.fromFace !== undefined) return supportFrame(frame,document,request);
    const [u,v,n=0] = request.at;
    const at = request.snapGrid ? plane.quantize(frame,[u,v]) : [u,v];
    return {origin:V.mad(plane.point(frame,at),frame.axes[2],n),axes:frame.axes,size:request.size,at:[...at,n]};
  }

  function blockTool(brush, frame, prefix) {
    const point = uvw=>uvw.reduce((origin,n,i)=>V.mad(origin,frame.axes[i],n*frame.size[i]),frame.origin);
    const vertices = unitBox.map((xyz,i)=>({id:prefix+'/v'+i,position:point(xyz)}));
    const faces = sides.map(([side,indices])=>{
      const id = prefix+'/'+side;
      return {id,material:brush.material,corners:A.tilesetFaces.cornersFor(brush,id,indices.map(i=>vertices[i].id))};
    });
    return {vertices,faces};
  }

  function matchedSeat(frame, tool) {
    if (frame.face?.corners.length !== 4) return null;
    const epsilon = Math.max(...frame.size.slice(0,2))*1e-8;
    const roots = tool.vertices.slice(0,4).map(({position})=>{
      const i = frame.points.findIndex(point=>V.dist(point,position)<=epsilon);
      return frame.face.corners[i];
    });
    return roots.every(Boolean) && new Set(roots).size===4 ? roots : null;
  }

  function attached(document, request, frame, tool, roots) {
    const test = T.planFaceRegion(document,{id:request.id,revision:T.revision(document),
      selection:T.select(document,{domain:'faces',ids:[frame.face.id]}),
      operation:{kind:'extrude',distance:frame.size[2],direction:frame.axes[2]}});
    if (!test.report.canCommit) return {kind:'face-region',issues:test.report.issues};
    const isolated = frame.edges.every(edge=>edge.uses.length===1);
    const source = roots.map(corner=>frame.g.vertices.get(corner.vertex));
    const vertices = tool.vertices.slice(4).map((vertex,i)=>({...vertex,
      position:V.mad(source[i].position,frame.axes[2],frame.size[2]),
      ...(source[i].weights && {weights:source[i].weights})}));
    const weld = new Map(tool.vertices.slice(0,4).map((vertex,i)=>[vertex.id,source[i].id]));
    const painted = tool.faces.slice(1).map(face=>({...face,corners:face.corners.map(corner=>
      ({...corner,vertex:weld.get(corner.vertex) ?? corner.vertex}))}));
    const retained = isolated ? {...frame.face,corners:frame.face.corners.slice().reverse().map(corner=>
      corner.normal ? {...corner,normal:V.mul(corner.normal,-1)} : corner)} : null;
    if (!isolated) {
      const cap = painted[0];
      const set = MaterialUV.resolve(document.uvBindings,'pigment');
      const issues = [];
      painted[0] = {...cap,id:frame.face.id,corners:cap.corners.map((corner,i)=>{
        const prior = roots[i], uv = MaterialUV.uv(corner,set);
        if (MaterialUV.pinned(prior,set) && uv.some((n,axis)=>Math.abs(n-MaterialUV.uv(prior,set)[axis])>1e-12))
          issues.push({reason:'pinned-uv',corner:prior.id});
        return {...prior,vertex:corner.vertex,...(set ?
          {attributes:{...prior.attributes,[MaterialUV.key(set)]:uv}} : {uv})};
      })};
      if (issues.length) return {kind:'face-region',issues};
    }
    const faces = retained ? [retained,...painted] : painted;
    return {kind:'face-region',patch:{vertices,faces},painted:painted.map((face,i)=>({face:face.id,side:sides[i+1][0]})),issues:[]};
  }

  function boolean(document, request, tool) {
    const operand = T.create({id:'block-tool',...tool,uvBindings:document.uvBindings});
    const result = T.planBoolean(document,{id:request.id,revision:T.revision(document),
      operation:request.mode === 'add' ? 'union' : 'difference',
      operand:{document:operand,revision:T.revision(operand)}});
    return {kind:'mesh-boolean',patch:result.patch,issues:result.report.issues,empty:result.report.empty,
      painted:result.report.faces?.filter(face=>face.operand === 'tool').map(face=>
        ({face:face.face,side:face.sourceFace.split('/').at(-1)})),boolean:result.report};
  }

  function bindings(row, brush, painted, id) {
    const applied = new Map(painted.map(item=>[item.face,item]));
    const original = row.bindings ?? [];
    const used = new Set(original.map(item=>item.id));
    const kept = original.filter(item=>!applied.has(item.element) || !A.tilesetFaces.isSourceBinding(item));
    for (const [face,{side}] of applied) {
      const previous = original.find(item=>item.element === face && A.tilesetFaces.isSourceBinding(item));
      const prefix = 'tileset/'+face;
      let key = previous?.id ?? prefix;
      if (!previous) for (let n=2;used.has(key);n++) key = prefix+'/'+n;
      used.add(key);
      kept.push({id:key,domain:'faces',element:face,data:{...brush.source,placement:{block:id,side}}});
    }
    return kept;
  }

  function plan(scene, request) {
    const {id,object,part,mode,orientation='fixed',at,fromFace,edge,size,depth,snapGrid=false,
      selection,paint,uvInset,material,materialDefinition} = request ?? {};
    const onFace = fromFace !== undefined;
    if (!request || Object.getPrototypeOf(request)!==Object.prototype || Object.keys(request).some(key=>!fields.includes(key)) ||
        typeof id !== 'string' || !/^[\w.-]{1,96}$/.test(id) || !name(object) || part !== undefined && !name(part) ||
        !['add','subtract'].includes(mode) || !['fixed','edge-relative'].includes(orientation) ||
        typeof snapGrid !== 'boolean' || (onFace ? !name(fromFace) || at !== undefined || snapGrid :
          !(finite(at,2) || finite(at,3)) || orientation !== 'fixed' || depth !== undefined) ||
        edge !== undefined && (!onFace || orientation !== 'edge-relative' || !name(edge)) ||
        (size === undefined ? !onFace || !positive(depth) : !finite(size,3) || !size.every(positive) || depth !== undefined))
      throw new TypeError('Use a block edit ID, mesh, add or subtract mode, and a grid position with size or a support face with depth');
    const meshes = scene.topologyMeshes ?? {}, old = Object.hasOwn(meshes,object) ? meshes[object] : undefined;
    if (old && part !== undefined && old.part !== part) throw new RangeError('No editable topology for scene object '+object+'/'+part);
    if (!old && mode === 'subtract') throw new RangeError('Subtract needs an editable solid mesh');
    const document = old && T.create(old.document), frame = placement(scene,document,request);
    const prefix = 'block/'+id, api = A.tilesetFaces;
    const brush = api.prepare(scene,{object,part,face:prefix,selection,paint,uvInset,material,materialDefinition},undefined,frame.size.slice(0,2));
    const info = {format:'ink-studio/tileset-block',version:1,id,object,mode,orientation,...(brush.part && {part:brush.part}),
      size:frame.size.slice(),frame:{origin:frame.origin,right:frame.axes[0],up:frame.axes[1],normal:frame.axes[2]},
      ...(frame.at && {at:frame.at}),...(onFace && {fromFace}),...(frame.edge && {edge:frame.edge}),
      source:brush.source,material:brush.material,beforeRevision:document ? T.revision(document) : null};
    const blocked = (issues,extra={})=>({report:freeze({...info,...extra,canCommit:false,issues})});
    if (brush.conflicts.length) return blocked(brush.conflicts);
    const tool = blockTool(brush,frame,prefix);
    const roots = mode === 'add' && onFace && matchedSeat(frame,tool);
    const authored = !old ? {kind:'placement',patch:tool,
      painted:tool.faces.map((face,i)=>({face:face.id,side:sides[i][0]})),issues:[]} :
      roots ? attached(document,request,frame,tool,roots) : boolean(document,request,tool);
    const evidence = {solver:authored.kind,...(authored.boolean && {boolean:authored.boolean})};
    if (authored.issues.length) return blocked(authored.issues,evidence);
    const patch = authored.patch;
    const reserved = [...(document?.vertices ?? []),...(document?.faces ?? []),
      ...(document?.faces.flatMap(face=>face.corners) ?? [])];
    if (roots && reserved.some(row=>row.id.startsWith(prefix+'/')))
      return blocked([{reason:'block-id-in-use'}],evidence);
    const row = old ? A.meshTopologyScene.revise(old,patch).row :
      {document:T.create({id:object,...tool}),...(part && {part})};
    const hinge = scene.constructionPlane?.edgeAnchor;
    if (hinge?.object === object && !row.document.edges.some(edge=>edge.id === hinge.edge))
      return blocked([{reason:'construction-plane-edge',edge:hinge.edge}],evidence);
    if (authored.painted.length) {
      row.bindings = bindings(row,brush,authored.painted,id);
      if (!brush.slot) row.materials = [...(row.materials ?? []),
        brush.materialDefinition ?? {id:brush.material,texture:{tileset:brush.source.selection.tileset}}];
    }
    const remove = authored.empty === true;
    const report = freeze({...info,...evidence,canCommit:true,issues:[],painted:authored.painted,removedMesh:remove,
      afterRevision:remove ? null : T.revision(row.document),changes:A.meshTopologyScene.diff(old,remove ? undefined : row)});
    return remove ? {remove,report} : {row,report};
  }

  A.tilesetBlocks = Object.freeze({plan,boxTopology:freeze({positions:unitBox,sides})});
})(KIT);
