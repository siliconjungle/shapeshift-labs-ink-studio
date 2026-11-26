/* Shared scene coordinates for placement, transform pivots and alignment. */
(function (K) {
  const A = K.authoring, { V } = K, { freeze } = K.procedural.data;
  const fields = ['origin','right','up','grid','rounding','lock','edgeAnchor'];
  const names = ['x','y','z'];
  const round = Object.freeze({nearest:Math.round,floor:Math.floor,ceiling:Math.ceil});
  const vector = (value,size) => Array.isArray(value) && value.length === size && Array.from(value).every(Number.isFinite);

  function edgeAnchor(raw) {
    if (raw == null) return;
    const keys = ['object','edge','vertices','at','degrees','referenceUp'];
    if (Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key=>!keys.includes(key)) ||
        ![raw.object,raw.edge].every(TargetSelectors.name) || raw.vertices?.length !== 2 ||
        !Array.isArray(raw.vertices) || !Array.from(raw.vertices).every(TargetSelectors.name) ||
        raw.vertices[0] === raw.vertices[1] || !Number.isFinite(raw.at) || raw.at<0 || raw.at>1 ||
        !Number.isFinite(raw.degrees) || !vector(raw.referenceUp,3) ||
        !Math.hypot(...raw.referenceUp) || !Number.isFinite(Math.hypot(...raw.referenceUp)))
      throw new TypeError('An edge anchor needs a mesh, edge, directed endpoints, fraction, tilt angle, and reference up');
    return {...raw,vertices:raw.vertices.slice(),referenceUp:raw.referenceUp.slice()};
  }

  function resolve(raw = {}) {
    if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key=>!fields.includes(key)))
      throw new TypeError('A construction plane needs an origin, axes, grid settings, and an optional axis lock or edge anchor');
    const {origin=[0,0,0],right=[1,0,0],up=[0,1,0],grid=1,rounding,lock} = raw;
    const anchor = edgeAnchor(raw.edgeAnchor);
    if (lock != null && anchor) throw new TypeError('Choose an axis lock or an edge anchor');
    if (lock != null && !names.includes(lock)) throw new TypeError('Construction plane lock must be x, y, or z');
    if (![origin,right,up].every(value=>vector(value,3)))
      throw new TypeError('A construction plane needs finite XYZ vectors');
    const positive = value=>Number.isFinite(value) && value>0;
    if (!(positive(grid) || vector(grid,2) && grid.every(positive)))
      throw new RangeError('Construction plane grid needs a positive interval or two positive intervals');
    if (rounding !== undefined && (typeof rounding !== 'string' || !Object.hasOwn(round,rounding)))
      throw new TypeError('Construction plane rounding must be nearest, floor, or ceiling');
    const r = Math.hypot(...right), u = Math.hypot(...up);
    if (!r || !u || !Number.isFinite(r) || !Number.isFinite(u))
      throw new RangeError('Construction plane axes need nonzero directions');
    const x = right.map(value=>value/r), guide = up.map(value=>value/u);
    if (Math.abs(V.dot(x,guide)) > 1e-10) throw new RangeError('Construction plane right and up must be perpendicular');
    const z = V.norm(V.cross(x,guide)), y = V.cross(z,x);
    const axes = [x,y,z].map(axis=>axis.map(value=>value || 0));
    if (lock != null && Math.abs(axes[2][names.indexOf(lock)]) < 1-1e-10)
      throw new RangeError('Construction plane normal must match its '+lock.toUpperCase()+' lock');
    return freeze({plane:{origin:origin.slice(),right:right.slice(),up:up.slice(),grid:Array.isArray(grid) ? grid.slice() : grid,
      ...(rounding !== undefined && {rounding}),...(lock && {lock}),...(anchor && {edgeAnchor:anchor})},axes});
  }

  function pick(raw, pose, {lock} = {}) {
    const current = resolve(raw), camera = CameraLens.pose(pose);
    if (current.plane.edgeAnchor) throw new RangeError('Detach the edge anchor before picking a camera plane');
    const {lock:previous,...plane} = current.plane, locked = lock === undefined ? previous : lock;
    if (locked != null && !names.includes(locked)) throw new TypeError('Construction plane lock must be x, y, or z');
    // Prefer the front plane, then the side, on equal face-on scores.
    const index = locked == null ? [2,0,1].reduce((best,i)=>
      Math.abs(camera.back[i])>Math.abs(camera.back[best])+1e-12 ? i : best) : names.indexOf(locked);
    const axis = names[index];
    const kept = locked != null && (previous === locked ||
      Math.abs(current.axes[2][index]) >= 1-1e-10 && V.dot(current.axes[2],camera.back) >= -1e-12);
    let frame;
    if (kept) frame = resolve({...plane,lock:locked});
    else {
      const normal = [0,0,0];
      normal[index] = camera.back[index]<-1e-12 ? -1 : 1;
      let best = -Infinity, right, up;
      for (let i=0;i<3;i++) if (i !== index) for (const facing of [1,-1]) {
        const candidate = [0,0,0];
        candidate[i] = facing;
        const vertical = V.cross(normal,candidate).map(n=>n || 0);
        const score = V.dot(candidate,camera.right)+V.dot(vertical,camera.up);
        if (score>best+1e-12) {
          best=score;
          right=candidate;
          up=vertical;
        }
      }
      frame = resolve({...plane,right,up,lock:locked});
    }
    return freeze({...frame,axis,kept,camera});
  }

  function edgeError(message) {
    return Object.assign(new RangeError(message),{code:'construction-edge-unavailable'});
  }

  function edgeOf(scene, object, id) {
    const meshes = scene.topologyMeshes ?? {};
    const row = Object.hasOwn(meshes,object) && meshes[object];
    if (!row) throw edgeError('Construction plane mesh '+object+' is unavailable');
    const mesh = K.meshTopology.create(row.document);
    const edge = mesh.edges.find(row=>row.id === id);
    if (!edge) throw edgeError('Construction plane edge '+id+' is unavailable on '+object);
    return {mesh,edge};
  }

  function projectedUp(right, direction) {
    const length = Math.hypot(...direction);
    if (!length || !Number.isFinite(length)) return null;
    const unit = direction.map(value=>value/length);
    const projected = V.mad(unit,right,-V.dot(unit,right));
    return V.len(projected)>1e-10 ? V.norm(projected) : null;
  }

  function edgeSpan(anchor, {mesh,edge}) {
    if (!anchor.vertices.every(id=>edge.vertices.includes(id)))
      throw edgeError('Construction plane edge '+anchor.edge+' has different endpoints');
    const positions = anchor.vertices.map(id=>mesh.vertices.find(row=>row.id === id).position);
    const along = V.sub(positions[1],positions[0]), length = V.len(along);
    if (!length || !Number.isFinite(length)) throw edgeError('Construction plane edge endpoints need a nonzero span');
    return {start:positions[0],along,length};
  }

  function edgeFrame(plane, anchor, source) {
    const {start,along,length} = edgeSpan(anchor,source);
    const right = along.map(value=>value/length), baseline = projectedUp(right,anchor.referenceUp);
    if (!baseline) throw edgeError('Construction plane edge is parallel to its reference up');
    const radians = (anchor.degrees%360)*Math.PI/180;
    const up = V.mad(V.mul(baseline,Math.cos(radians)),V.cross(right,baseline),Math.sin(radians));
    const origin = V.mad(start,along,anchor.at);
    return resolve({...plane,lock:null,edgeAnchor:anchor,origin,right,up});
  }

  function forScene(scene) {
    const frame = resolve(scene.constructionPlane), anchor = frame.plane.edgeAnchor;
    return anchor ? edgeFrame(frame.plane,anchor,edgeOf(scene,anchor.object,anchor.edge)) : frame;
  }

  function tilt(scene, options) {
    const fields = ['object','edge','from','at','degrees','referenceUp','grid','rounding'];
    if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.keys(options).some(key=>!fields.includes(key)))
      throw new TypeError('Use a construction plane edge tilt request');
    const base = resolve(scene.constructionPlane);
    const prior = options.object === undefined ? base.plane.edgeAnchor : undefined;
    const {object=prior?.object,edge=prior?.edge,from,at=prior?.at ?? 0,degrees=prior?.degrees,
      referenceUp,grid=base.plane.grid,rounding=base.plane.rounding} = options;
    if ((options.object === undefined) !== (options.edge === undefined) ||
        ![object,edge].every(TargetSelectors.name) || !Number.isFinite(degrees))
      throw new TypeError('Choose an edge mesh, edge ID, and tilt in degrees');
    const source = edgeOf(scene,object,edge), {mesh,edge:row} = source;
    if (prior && !prior.vertices.every(id=>row.vertices.includes(id)))
      throw edgeError('Construction plane edge '+edge+' has different endpoints');
    const start = from ?? prior?.vertices[0] ?? row.vertices[0];
    if (!row.vertices.includes(start)) throw new RangeError('Edge start must be one of its vertex IDs');
    const vertices = [start,row.vertices.find(id=>id !== start)];
    const [a,b] = vertices.map(id=>mesh.vertices.find(vertex=>vertex.id === id).position);
    const right = V.norm(V.sub(b,a));
    let axes = base.axes;
    if (referenceUp === undefined && !prior && base.plane.edgeAnchor) {
      try {
        axes = forScene(scene).axes;
      } catch (error) {
        if (error.code !== 'construction-edge-unavailable') throw error;
      }
    }
    const guide = referenceUp ?? prior?.referenceUp ?? axes.slice(1).find(direction=>projectedUp(right,direction));
    const anchor = edgeAnchor({object,edge,vertices,at,degrees,referenceUp:guide});
    return edgeFrame({...base.plane,grid,rounding},anchor,source);
  }

  function mean(points) {
    return V.mul(points.reduce(V.add,[0,0,0]),1/points.length);
  }

  function originTarget(scene, request, env = {}) {
    if (request?.kind === 'object-point') return A.objectPoints.resolve(scene,env,request);
    const {kind,object,vertex,instance,instanceKind,anchor,selection} = request ?? {};
    const fields = {vertex:['object','vertex'],instance:['instance','instanceKind','anchor'],bounds:['object','selection'],average:['object','selection']};
    const name = TargetSelectors.name;
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || !Object.hasOwn(fields,kind) ||
        Object.keys(request).some(key=>key !== 'kind' && !fields[kind].includes(key)) ||
        !(kind === 'instance' ? name(instance) && (anchor === undefined || name(anchor)) && (instanceKind === undefined || ['prefab','asset-part'].includes(instanceKind)) :
          name(object) && (kind === 'vertex' ? name(vertex) : selection)))
      throw new TypeError('Snap the construction origin to a vertex, instance, named object point, selection bounds, or selection average');
    if (kind === 'instance') return {kind,...A.sceneInstances.anchor(scene,env,{instance,instanceKind,anchor}),
      ...(anchor !== undefined && {anchor})};

    const rows = scene.topologyMeshes ?? {};
    if (!Object.hasOwn(rows,object)) throw new RangeError('Unknown editable mesh '+object);
    const topology = K.meshTopology, mesh = topology.create(rows[object].document);
    const vertices = new Map(mesh.vertices.map(row=>[row.id,row.position]));
    if (kind === 'vertex') {
      if (!vertices.has(vertex)) throw new RangeError('Unknown scene vertex '+vertex+' on '+object);
      return {kind,object,vertex,target:vertices.get(vertex)};
    }
    const picked = topology.select(mesh,{from:selection});
    if (!picked.ids.length) throw new RangeError('Select at least one element to snap the construction origin');
    const evidence = {kind,object,selection:picked,count:picked.ids.length};
    if (kind === 'bounds') {
      const {ids} = topology.select(mesh,{from:picked,convert:'vertices'});
      const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
      for (const id of ids) vertices.get(id).forEach((value,i)=>{
        min[i] = Math.min(min[i],value);
        max[i] = Math.max(max[i],value);
      });
      return {...evidence,bounds:{min,max},target:mean([min,max])};
    }
    const ids = new Set(picked.ids);
    const centers = mesh[picked.domain].filter(row=>ids.has(row.id)).map(row=>{
      if (picked.domain === 'vertices') return row.position;
      const members = picked.domain === 'edges' ? row.vertices : row.corners.map(corner=>corner.vertex);
      return mean(members.map(id=>vertices.get(id)));
    });
    return {...evidence,target:mean(centers)};
  }

  function snapOrigin(scene, request, options, env) {
    return snapTo(scene,originTarget(scene,request,env),options);
  }

  function snapTo(scene, snap, {detachEdge = false} = {}) {
    if (typeof detachEdge !== 'boolean') throw new TypeError('Detach edge must be a boolean');
    let frame;
    try {
      frame = forScene(scene);
    } catch (error) {
      if (error.code !== 'construction-edge-unavailable' || !detachEdge) throw error;
      frame = resolve(scene.constructionPlane);
    }
    const anchor = frame.plane.edgeAnchor;
    if (!anchor || detachEdge)
      return freeze({...resolve({...frame.plane,edgeAnchor:null,origin:snap.target}),snap});

    const source = edgeOf(scene,anchor.object,anchor.edge);
    const {start,along,length} = edgeSpan(anchor,source);
    const fraction = V.dot(V.sub(snap.target,start),frame.axes[0])/length;
    const at = Math.max(0,Math.min(1,fraction));
    const distance = V.dist(snap.target,V.mad(start,along,at));
    if (distance>1e-8*Math.max(1,length))
      throw new RangeError('Detach the edge anchor to snap the origin off the anchored edge');
    return freeze({...edgeFrame(frame.plane,{...anchor,at},source),snap});
  }

  function gridPreset(scene, request, {projectTexelsPerUnit} = {}) {
    const {kind,tileset,moduleSize} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        Object.keys(request).some(key=>!['kind','tileset','moduleSize'].includes(key)) ||
        !['texel','brick','module'].includes(kind) || tileset !== undefined && kind !== 'brick' ||
        moduleSize !== undefined && kind !== 'module')
      throw new TypeError('Use a texel, brick, or module construction grid preset');
    if (kind === 'module') return freeze({kind,grid:resolve({grid:moduleSize === undefined ? 1 : moduleSize}).plane.grid});
    const api = A.tilesets, sheets = api.prepare(scene.tilesets,scene.tilesetDefaults);
    const texelsPerUnit = api.positiveScale(sheets.texelsPerUnit ?? projectTexelsPerUnit ?? 16,'Texels per unit');
    let grid = 1/texelsPerUnit;
    if (kind === 'brick') {
      const {tileSize} = sheets.grid(tileset);
      if (tileset !== undefined && !tileSize) throw new RangeError('Set tile dimensions for '+tileset+' before using its brick grid');
      const {width,height} = tileSize ?? {width:16,height:8};
      grid = [width/texelsPerUnit,height/texelsPerUnit];
    }
    return freeze({kind,grid:resolve({grid}).plane.grid,texelsPerUnit,...(tileset !== undefined && {tileset})});
  }

  const intervals = grid=>Array.isArray(grid) ? grid : [grid,grid];

  function quantize(frame, at, worldMagnitude = 0) {
    if (!vector(at,2)) throw new TypeError('Construction plane grid coordinates need a finite [u, v] pair');
    const mode = round[frame.plane.rounding ?? 'nearest'], step = intervals(frame.plane.grid);
    return at.map((value,i)=>{
      // Projection through a rotated basis can put an on-grid value a few ULPs below an integer.
      const integer = Math.round(value);
      const epsilon = Math.min(1e-7,8*Number.EPSILON*Math.max(1,Math.abs(value),worldMagnitude/step[i]));
      return (Math.abs(value-integer)<=epsilon ? integer : mode(value)) || 0;
    });
  }

  function point(frame, at) {
    if (!vector(at,2)) throw new TypeError('Construction plane grid coordinates need a finite [u, v] pair');
    const {plane:{origin,grid},axes:[right,up]} = frame, [u,v] = intervals(grid);
    const result = V.mad(V.mad(origin,right,at[0]*u),up,at[1]*v);
    if (!vector(result,3)) throw new RangeError('Construction plane grid point exceeds coordinate bounds');
    return result;
  }

  function project(frame, position, mode = 'plane') {
    if (!vector(position,3) || !['plane','grid'].includes(mode))
      throw new TypeError('Construction plane alignment needs a world point and plane or grid mode');
    const delta = V.sub(position,frame.plane.origin);
    const step = intervals(frame.plane.grid);
    const at = frame.axes.slice(0,2).map((axis,i)=>V.dot(delta,axis)/step[i]);
    const gridAt = mode === 'grid' ?
      quantize(frame,at,Math.max(...position.map(Math.abs),...frame.plane.origin.map(Math.abs))) : at;
    return {point:point(frame,gridAt),gridAt};
  }

  A.constructionPlane = Object.freeze({resolve,pick,forScene,tilt,originTarget,snapOrigin,snapTo,gridPreset,quantize,point,project});
})(KIT);
