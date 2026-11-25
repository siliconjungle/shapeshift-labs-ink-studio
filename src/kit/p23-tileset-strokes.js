/* Fixed-distance tile brush strokes on the retained construction plane. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology, {V} = K, {freeze} = K.procedural.data;
  const brushFields = ['selection','material','texelsPerUnit','brushScale'];
  const fields = ['mode','id','object','part','path','interval','snapGrid'];
  const maxSamples = 4096;
  const name = value=>TargetSelectors.name(value) && !['__proto__','prototype','constructor'].includes(value);
  const pair = value=>Array.isArray(value) && value.length === 2 && Array.from(value).every(Number.isFinite);

  function samplePath(frame, path, interval, snapGrid) {
    const plane = A.constructionPlane, {grid} = frame.plane;
    const [u,v] = Array.isArray(grid) ? grid : [grid,grid];
    const segments = [];
    let length = 0;
    for (let i=1;i<path.length;i++) {
      const [x,y] = path[i-1], [nextX,nextY] = path[i];
      const span = Math.hypot((nextX-x)*u,(nextY-y)*v);
      if (span) segments.push({start:length,end:length+span,span,from:path[i-1],to:path[i]});
      length += span;
    }
    const steps = length/interval;
    if (!Number.isFinite(steps) || steps >= maxSamples)
      throw new RangeError('A tile stroke supports up to '+maxSamples+' samples');
    const last = Math.floor(steps + 16*Number.EPSILON*Math.max(1,steps));
    if (last >= maxSamples) throw new RangeError('A tile stroke supports up to '+maxSamples+' samples');
    const samples = [];
    let segment = 0;
    for (let index=0;index<=last;index++) {
      const distance = index*interval;
      while (segments[segment]?.end < distance && segment+1 < segments.length) segment++;
      const span = segments[segment];
      const t = span ? Math.min(1,(distance-span.start)/span.span) : 0;
      const at = !index ? path[0].slice() :
        span.from.map((value,axis)=>value+(span.to[axis]-value)*t);
      const gridAt = snapGrid ? plane.quantize(frame,at) : at;
      samples.push({index,distance,at,...(snapGrid && {gridAt}),point:plane.point(frame,gridAt)});
    }
    return {length,samples};
  }

  function draw(scene, request, samples, options) {
    const api = A.tilesetFaces;
    const {id,path,object,part,snapGrid,selection,material:slot,texelsPerUnit,brushScale:scale} = request;
    const brush = api.prepare(scene,{object,part,face:id,selection,material:slot,texelsPerUnit,brushScale:scale,
      planeAt:path[0],snapGrid},options);
    const {source,material,density,brushScale,size,conflicts} = brush;
    const stamps = [], visited = new Set();
    for (const sample of samples) {
      const key = JSON.stringify(sample.point);
      if (visited.has(key)) {
        sample.status = 'repeated-position';
        continue;
      }
      visited.add(key);
      const face = id+'/'+sample.index;
      const stamp = api.stamp(brush,face,sample.point);
      Object.assign(sample,{face,status:stamp.conflicts.length ? 'conflict' : 'draw'});
      conflicts.push(...stamp.conflicts);
      stamps.push(stamp);
    }
    return {brush:{source,material,texelsPerUnit:density,brushScale,size},conflicts,
      ...(!conflicts.length && {row:api.append(brush,stamps)})};
  }

  function tileBinding(binding) {
    return binding.domain === 'faces' && !binding.review &&
      binding.data?.format === 'ink-studio/tileset-face-source' && binding.data.version === 1;
  }

  function hitRegions(doc, bound, frame) {
    const [right,up,normal] = frame.axes;
    const project = point=>{
      const delta = V.sub(point,frame.plane.origin);
      return [V.dot(delta,right),V.dot(delta,up),V.dot(delta,normal)];
    };
    const vertices = new Map(doc.vertices.map(({id,position})=>[id,position]));
    return {project,regions:doc.faces.filter(face=>bound.has(face.id)).flatMap(face=>{
      const points = face.corners.map(({vertex})=>vertices.get(vertex));
      const ring = points.map(project);
      const epsilon = 64*Number.EPSILON*Math.max(1,...points.flat().map(Math.abs),...frame.plane.origin.map(Math.abs));
      if (ring.some(point=>Math.abs(point[2])>epsilon)) return [];
      const bounds = [0,1].map(axis=>{
        const values = ring.map(point=>point[axis]);
        return [Math.min(...values)-epsilon,Math.max(...values)+epsilon];
      });
      return [{id:face.id,ring,bounds,epsilon}];
    })};
  }

  function contains({ring,bounds,epsilon}, point) {
    if (bounds.some(([min,max],axis)=>point[axis]<min || point[axis]>max)) return false;
    const [x,y] = point;
    let inside = false;
    // Use half-open crossings so adjacent faces do not both own a shared edge.
    for (const [i,[ax,ay]] of ring.entries()) {
      const [bx,by] = ring[(i+1)%ring.length];
      if ((ay>y+epsilon) === (by>y+epsilon)) continue;
      const crossing = ax+(bx-ax)*(y-ay)/(by-ay);
      if (crossing>x+epsilon) inside = !inside;
    }
    return inside;
  }

  function erase(existing, doc, frame, samples, part) {
    const conflicts = [];
    if (existing && part !== undefined && existing.part !== part)
      return {conflicts:[{reason:'different-mesh-part'}]};
    const removed = new Set(), bindings = (existing?.bindings ?? []).filter(tileBinding);
    const bound = new Set(bindings.map(binding=>binding.element));
    const regions = bound.size ? hitRegions(doc,bound,frame) : null;
    for (const sample of samples) {
      const at = regions?.project(sample.point);
      const hits = regions?.regions.filter(region=>contains(region,at)).map(region=>region.id) ?? [];
      if (hits.length === 1) {
        const [face] = hits;
        Object.assign(sample,{face,status:removed.has(face) ? 'repeated-face' : 'erase'});
        removed.add(face);
      } else if (hits.length) Object.assign(sample,{status:'ambiguous',candidates:hits});
      else sample.status = 'miss';
    }
    if (!removed.size) return {conflicts};
    if (removed.size === doc.faces.length) return {conflicts,remove:true};

    const used = new Set(), retired = new Set();
    for (const face of doc.faces) for (const {vertex} of face.corners)
      (removed.has(face.id) ? retired : used).add(vertex);
    const patch = {removeFaces:[...removed],removeVertices:[...retired].filter(id=>!used.has(id))};
    const next = A.meshTopologyScene.revise(existing,patch).row;
    const retiredBindings = new Set(bindings.filter(binding=>removed.has(binding.element)).map(binding=>binding.id));
    next.bindings = next.bindings.filter(binding=>!retiredBindings.has(binding.id));
    return {conflicts,row:next};
  }

  function plan(scene, request, options) {
    const {mode,id,object,part,path,interval,snapGrid=false} = request ?? {};
    const drawing = mode === 'draw';
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || !['draw','erase'].includes(mode) ||
        Object.keys(request).some(key=>!fields.includes(key) && !(drawing && brushFields.includes(key))) ||
        ![id,object].every(name) || part !== undefined && !name(part) || typeof snapGrid !== 'boolean' ||
        !Array.isArray(path) || !path.length || path.length>maxSamples || !Array.from(path).every(pair) ||
        !Number.isFinite(interval) || interval<=0)
      throw new TypeError('A tile stroke needs draw or erase mode, stroke and mesh IDs, a finite grid path, and a positive scene-unit interval');
    const frame = A.constructionPlane.forScene(scene);
    const {length,samples} = samplePath(frame,path,interval,snapGrid);
    const existing = Object.hasOwn(scene.topologyMeshes ?? {},object) ? scene.topologyMeshes[object] : undefined;
    const doc = existing && topology.create(existing.document);
    const {row,remove,conflicts,brush} = drawing ? draw(scene,request,samples,options) : erase(existing,doc,frame,samples,part);
    if (mode === 'erase' && frame.plane.edgeAnchor?.object === object && (remove ||
        row && !row.document.edges.some(edge=>edge.id === frame.plane.edgeAnchor.edge)))
      conflicts.push({reason:'construction-plane-edge',edge:frame.plane.edgeAnchor.edge});
    const changed = Boolean(row || remove) && !conflicts.length;
    const after = changed ? row?.document : doc;
    const report = freeze({format:'ink-studio/tileset-face-stroke',version:1,id,object,mode,
      ...((existing?.part ?? part) && {part:existing?.part ?? part}),constructionPlane:frame.plane,path:path.map(point=>point.slice()),interval,length,snapGrid,
      ...(brush && {brush}),samples,conflicts,canCommit:!conflicts.length,
      beforeRevision:doc ? topology.revision(doc) : null,
      afterRevision:after ? topology.revision(after) : null,
      removedMesh:Boolean(changed && remove),...(changed && {changes:A.meshTopologyScene.diff(existing,row)})});
    return changed ? {row,remove,report} : {report};
  }

  A.tilesetStrokes = Object.freeze({plan});
})(KIT);
