/* Tile brush edits on the retained construction plane. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology, {V} = K, {freeze} = K.procedural.data;
  const brushFields = ['selection','material','texelsPerUnit','brushScale','paint'];
  const fields = ['mode','id','object','part','snapGrid'];
  const strokeFields = ['path','interval'];
  const rectangleFields = ['from','to'];
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

  function prepareBrush(scene, request, at, options, cellSize) {
    const {id,object,part,selection,material,texelsPerUnit,brushScale,paint} = request;
    return A.tilesetFaces.prepare(scene,{object,part,face:id,selection,material,texelsPerUnit,brushScale,paint,planeAt:at},options,cellSize);
  }

  function draw(brush, id, samples) {
    const api = A.tilesetFaces;
    const {source,material,density,brushScale,size,conflicts} = brush;
    const stamps = [], visited = new Set();
    for (const sample of samples) {
      if (sample.status) continue;
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
      ...(!conflicts.length && stamps.length>0 && {row:api.append(brush,stamps)})};
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
    return {project,regions:doc.faces.filter(face=>!bound || bound.has(face.id)).flatMap(face=>{
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
    return {conflicts,...removeFaces(existing,doc,removed,bindings)};
  }

  function removeFaces(existing, doc, removed, bindings) {
    if (!removed.size) return {};
    if (removed.size === doc.faces.length) return {remove:true};
    const used = new Set(), retired = new Set();
    for (const face of doc.faces) for (const {vertex} of face.corners)
      (removed.has(face.id) ? retired : used).add(vertex);
    const patch = {removeFaces:[...removed],removeVertices:[...retired].filter(id=>!used.has(id))};
    const row = A.meshTopologyScene.revise(existing,patch).row;
    const retiredBindings = new Set(bindings.filter(binding=>removed.has(binding.element)).map(binding=>binding.id));
    row.bindings = row.bindings.filter(binding=>!retiredBindings.has(binding.id));
    return {row};
  }

  function validRequest(request, extra, allowedBrush) {
    const {id,object,part,snapGrid=false} = request ?? {};
    return request && Object.getPrototypeOf(request) === Object.prototype &&
      Object.keys(request).every(key=>fields.includes(key) || extra.includes(key) || allowedBrush.includes(key)) &&
      [id,object].every(name) && (part === undefined || name(part)) && typeof snapGrid === 'boolean';
  }

  function plan(scene, request, options) {
    const {mode,id,object,part,path,interval,snapGrid=false} = request ?? {};
    const drawing = mode === 'draw';
    if (!validRequest(request,strokeFields,drawing ? brushFields : []) || !['draw','erase'].includes(mode) ||
        !Array.isArray(path) || !path.length || path.length>maxSamples || !Array.from(path).every(pair) ||
        !Number.isFinite(interval) || interval<=0)
      throw new TypeError('A tile stroke needs draw or erase mode, stroke and mesh IDs, a finite grid path, and a positive scene-unit interval');
    const frame = A.constructionPlane.forScene(scene);
    const {length,samples} = samplePath(frame,path,interval,snapGrid);
    const {existing,doc} = meshSource(scene,object);
    const result = drawing ? draw(prepareBrush(scene,request,path[0],options),id,samples) : erase(existing,doc,frame,samples,part);
    return finish(frame,existing,doc,result,{format:'ink-studio/tileset-face-stroke',version:1,id,object,mode,
      ...((existing?.part ?? part) && {part:existing?.part ?? part}),constructionPlane:frame.plane,
      path:path.map(point=>point.slice()),interval,length,snapGrid,samples,...(result.brush && {brush:result.brush})});
  }

  function meshSource(scene, object) {
    const meshes = scene.topologyMeshes ?? {};
    const existing = Object.hasOwn(meshes,object) ? meshes[object] : undefined;
    return {existing,doc:existing && topology.create(existing.document)};
  }

  function finish(frame, existing, doc, {row,remove,conflicts}, info) {
    const anchor = frame.plane.edgeAnchor;
    if (info.mode === 'erase' && anchor?.object === info.object && (remove ||
        row && !row.document.edges.some(edge=>edge.id === anchor.edge)))
      conflicts.push({reason:'construction-plane-edge',edge:anchor.edge});
    const changed = Boolean(row || remove) && !conflicts.length;
    const after = changed ? row?.document : doc;
    const report = freeze({...info,conflicts,canCommit:!conflicts.length,
      beforeRevision:doc ? topology.revision(doc) : null,afterRevision:after ? topology.revision(after) : null,
      removedMesh:Boolean(changed && remove),...(changed && {changes:A.meshTopologyScene.diff(existing,row)})});
    return changed ? {row,remove,report} : {report};
  }

  function rectangle(frame, from, to, snapGrid) {
    const plane = A.constructionPlane;
    const corners = [from,to].map(at=>snapGrid ? plane.quantize(frame,at) : at);
    if (!corners.every(at=>at.every(Number.isSafeInteger)))
      throw new RangeError('Rectangle corners need integer cells or snapGrid');
    const [a,b] = corners;
    const min = a.map((value,i)=>Math.min(value,b[i]));
    const max = a.map((value,i)=>Math.max(value,b[i])+1);
    const size = max.map((value,i)=>value-min[i]);
    if (!max.every(Number.isSafeInteger) || size[0]*size[1]>maxSamples)
      throw new RangeError('A tile rectangle supports up to '+maxSamples+' cells with safe integer bounds');
    const [columns,rows] = size;
    const {grid} = frame.plane, cellSize = Array.isArray(grid) ? grid : [grid,grid];
    const outline = [min,[max[0],min[1]],max,[min[0],max[1]]].map(at=>plane.point(frame,at));
    const cells = [];
    for (let v=0;v<rows;v++) for (let u=0;u<columns;u++) {
      const at = [min[0]+u,min[1]+v];
      cells.push({index:cells.length,at,point:plane.point(frame,at),placements:[],otherFaces:[]});
    }
    return {min,max,size,cellSize,outline,cells};
  }

  const cellPlanes = [
    {normal:[-1,0,0],offset:0},{normal:[1,0,0],offset:1},
    {normal:[0,-1,0],offset:0},{normal:[0,1,0],offset:1}
  ];

  function coversCell(ring, at) {
    const points = ring.map(([u,v])=>[u-at[0],v-at[1],0]);
    const [clipped] = K.procedural.geometry.clipPlanarFaces([{points}],cellPlanes);
    if (!clipped) return false;
    // A shared edge alone contributes zero area, even if the clipped ring has three points.
    const polygon = clipped.points, [x,y] = polygon[0];
    const twiceArea = polygon.slice(2).reduce((area,[u,v],i)=>{
      const [s,t] = polygon[i+1];
      return area+(s-x)*(v-y)-(t-y)*(u-x);
    },0);
    return Math.abs(twiceArea)>1e-12;
  }

  function rectangleHits(doc, frame, footprint, bound, filling) {
    const {min,max,cellSize,cells,size:[columns]} = footprint, affected = [];
    if (!doc) return affected;
    for (const region of hitRegions(doc,null,frame).regions) {
      const {id,ring,epsilon} = region;
      const tiled = bound.has(id);
      const units = ring.map(point=>point.slice(0,2).map((value,i)=>value/cellSize[i]));
      const low = region.bounds.map(([value],i)=>Math.max(min[i],Math.floor(value/cellSize[i])));
      const high = region.bounds.map(([,value],i)=>Math.min(max[i],Math.ceil(value/cellSize[i])));
      let hit = false;
      for (let v=low[1];v<high[1];v++) for (let u=low[0];u<high[0];u++) {
        const cell = cells[(v-min[1])*columns+u-min[0]];
        if (!coversCell(units,cell.at)) continue;
        (tiled ? cell.placements : cell.otherFaces).push(id);
        hit = true;
      }
      if (hit) affected.push({face:id,tile:tiled,action:!filling && tiled ? 'erase' : 'keep',
        extendsOutside:units.some(point=>point.some((value,i)=>value<min[i]-epsilon/cellSize[i] ||
          value>max[i]+epsilon/cellSize[i]))});
    }
    return affected;
  }

  function planRectangle(scene, request, options) {
    const {mode,id,object,part,from,to,snapGrid=false} = request ?? {}, filling = mode === 'fill';
    if (!validRequest(request,rectangleFields,filling ? ['selection','material','paint'] : []) ||
        !['fill','erase'].includes(mode) || !pair(from) || !pair(to))
      throw new TypeError('A tile rectangle needs fill or erase mode, edit and mesh IDs, and two grid cell addresses');
    const frame = A.constructionPlane.forScene(scene), footprint = rectangle(frame,from,to,snapGrid);
    const {existing,doc} = meshSource(scene,object);
    const bindings = (existing?.bindings ?? []).filter(tileBinding);
    const affected = rectangleHits(doc,frame,footprint,new Set(bindings.map(binding=>binding.element)),filling);
    const {cells,...bounds} = footprint;
    for (const cell of cells) {
      if (filling && (cell.placements.length || cell.otherFaces.length)) cell.status = 'occupied';
      if (!filling) cell.status = cell.placements.length ? 'erase' : cell.otherFaces.length ? 'other-face' : 'empty';
    }
    let result;
    if (filling) {
      const brush = prepareBrush(scene,request,bounds.min,options,bounds.cellSize);
      const draws = draw(brush,id,cells);
      result = {...draws,brush:{source:brush.source,material:brush.material,size:bounds.cellSize}};
      for (const cell of cells) if (cell.status === 'draw') cell.status = 'fill';
    } else {
      const conflicts = existing && part !== undefined && part !== existing.part ? [{reason:'different-mesh-part'}] : [];
      const removed = new Set(affected.filter(row=>row.action === 'erase').map(row=>row.face));
      result = {conflicts,...(!conflicts.length && removeFaces(existing,doc,removed,bindings))};
    }
    return finish(frame,existing,doc,result,{format:'ink-studio/tileset-face-rectangle',version:1,id,object,mode,
      ...((existing?.part ?? part) && {part:existing?.part ?? part}),constructionPlane:frame.plane,
      from:from.slice(),to:to.slice(),snapGrid,footprint:bounds,cells,affected,...(result.brush && {brush:result.brush})});
  }

  A.tilesetStrokes = Object.freeze({plan,planRectangle});
})(KIT);
