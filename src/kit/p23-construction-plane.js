/* Shared scene coordinates for placement, transform pivots and alignment. */
(function (K) {
  const A = K.authoring, { V } = K, { freeze } = K.procedural.data;
  const fields = ['origin','right','up','grid','lock','edgeAnchor'];
  const names = ['x','y','z'];
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
      throw new TypeError('A construction plane needs origin, right, up, grid, and an optional axis lock or edge anchor');
    const {origin=[0,0,0],right=[1,0,0],up=[0,1,0],grid=1,lock} = raw;
    const anchor = edgeAnchor(raw.edgeAnchor);
    if (lock != null && anchor) throw new TypeError('Choose an axis lock or an edge anchor');
    if (lock != null && !names.includes(lock)) throw new TypeError('Construction plane lock must be x, y, or z');
    if (![origin,right,up].every(value=>vector(value,3)))
      throw new TypeError('A construction plane needs finite XYZ vectors');
    if (!Number.isFinite(grid) || grid<=0) throw new RangeError('Construction plane grid must be positive');
    const r = Math.hypot(...right), u = Math.hypot(...up);
    if (!r || !u || !Number.isFinite(r) || !Number.isFinite(u))
      throw new RangeError('Construction plane axes need nonzero directions');
    const x = right.map(value=>value/r), guide = up.map(value=>value/u);
    if (Math.abs(V.dot(x,guide)) > 1e-10) throw new RangeError('Construction plane right and up must be perpendicular');
    const z = V.norm(V.cross(x,guide)), y = V.cross(z,x);
    const axes = [x,y,z].map(axis=>axis.map(value=>value || 0));
    if (lock != null && Math.abs(axes[2][names.indexOf(lock)]) < 1-1e-10)
      throw new RangeError('Construction plane normal must match its '+lock.toUpperCase()+' lock');
    return freeze({plane:{origin:origin.slice(),right:right.slice(),up:up.slice(),grid,...(lock && {lock}),...(anchor && {edgeAnchor:anchor})},axes});
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

  function edgeFrame(plane, anchor, {mesh,edge}) {
    if (!anchor.vertices.every(id=>edge.vertices.includes(id)))
      throw edgeError('Construction plane edge '+anchor.edge+' has different endpoints');
    const positions = anchor.vertices.map(id=>mesh.vertices.find(row=>row.id === id).position);
    const along = V.sub(positions[1],positions[0]), length = V.len(along);
    if (!length || !Number.isFinite(length)) throw edgeError('Construction plane edge endpoints need a nonzero span');
    const right = along.map(value=>value/length), baseline = projectedUp(right,anchor.referenceUp);
    if (!baseline) throw edgeError('Construction plane edge is parallel to its reference up');
    const radians = (anchor.degrees%360)*Math.PI/180;
    const up = V.mad(V.mul(baseline,Math.cos(radians)),V.cross(right,baseline),Math.sin(radians));
    const origin = V.mad(positions[0],along,anchor.at);
    return resolve({...plane,lock:null,edgeAnchor:anchor,origin,right,up});
  }

  function forScene(scene) {
    const frame = resolve(scene.constructionPlane), anchor = frame.plane.edgeAnchor;
    return anchor ? edgeFrame(frame.plane,anchor,edgeOf(scene,anchor.object,anchor.edge)) : frame;
  }

  function tilt(scene, options) {
    const fields = ['object','edge','from','at','degrees','referenceUp','grid'];
    if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.keys(options).some(key=>!fields.includes(key)))
      throw new TypeError('Use a construction plane edge tilt request');
    const base = resolve(scene.constructionPlane);
    const prior = options.object === undefined ? base.plane.edgeAnchor : undefined;
    const {object=prior?.object,edge=prior?.edge,from,at=prior?.at ?? 0,degrees=prior?.degrees,
      referenceUp,grid=base.plane.grid} = options;
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
    return edgeFrame({...base.plane,grid},anchor,source);
  }

  function point(frame, at) {
    if (!vector(at,2)) throw new TypeError('Construction plane grid coordinates need a finite [u, v] pair');
    const {plane:{origin,grid},axes:[right,up]} = frame;
    const result = V.mad(V.mad(origin,right,at[0]*grid),up,at[1]*grid);
    if (!vector(result,3)) throw new RangeError('Construction plane grid point exceeds coordinate bounds');
    return result;
  }

  function project(frame, position, mode = 'plane') {
    if (!vector(position,3) || !['plane','grid'].includes(mode))
      throw new TypeError('Construction plane alignment needs a world point and plane or grid mode');
    const delta = V.sub(position,frame.plane.origin);
    const at = frame.axes.slice(0,2).map(axis=>V.dot(delta,axis)/frame.plane.grid);
    const gridAt = mode === 'grid' ? at.map(value=>Math.round(value) || 0) : at;
    return {point:point(frame,gridAt),gridAt};
  }

  A.constructionPlane = Object.freeze({resolve,pick,forScene,tilt,point,project});
})(KIT);
