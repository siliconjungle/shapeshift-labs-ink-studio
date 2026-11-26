/* Intrinsic face unfolding and retained UV refits. */
const meshUVFlatten = (function (K) {
  const {V} = K, T = K.meshTopology;
  const format = 'ink-studio/uv-flatten-binding';
  const validAtlas = size=>meshUVRegions.tuple(size,2,n=>Number.isSafeInteger(n) && n>1);
  const nearUV = (a,b)=>a && b && a.every((n,i)=>Math.abs(n-b[i])<=1e-10);
  const key = (a,b)=>JSON.stringify(a<b ? [a,b] : [b,a]);
  const isBinding = binding=>binding.domain==='faces' && binding.data?.format===format && binding.data.version===1;

  function mesh(document,selected) {
    const corners = new Map(), faces = new Map(), triangles = new Map();
    const vertices = new Map(document.vertices.map(({id,position})=>[id,position]));
    for (const face of document.faces) if (selected.has(face.id)) {
      faces.set(face.id,face);
      triangles.set(face.id,[]);
      for (const corner of face.corners) corners.set(corner.id,vertices.get(corner.vertex));
    }
    for (const {face,corners:ids} of T.triangulate(document).triangleSources) if (triangles.has(face))
      triangles.get(face).push({corners:ids,positions:ids.map(id=>corners.get(id))});
    return {corners,faces,triangles};
  }

  function unfold(corners, triangles, edge) {
    const edges = new Map();
    for (const [i,{corners:ids}] of triangles.entries()) for (const [j,a] of ids.entries()) {
      const mark = key(a,ids[(j+1)%3]);
      if (!edges.has(mark)) edges.set(mark,[]);
      edges.get(mark).push([i,j]);
    }
    const [start,end] = edge, entry = edges.get(key(start,end));
    if (entry?.length!==1 || triangles[entry[0][0]].corners[entry[0][1]]!==start) return;
    const length = V.dist(corners.get(start),corners.get(end));
    if (!(length>0)) return;
    const plane = new Map([[start,[0,0]],[end,[length,0]]]), visited = new Set(), queue = entry.slice();
    for (const [i,j] of queue) {
      if (visited.has(i)) continue;
      visited.add(i);
      const ids = triangles[i].corners, a = ids[j], b = ids[(j+1)%3], c = ids[(j+2)%3];
      const p = plane.get(a), q = plane.get(b), pa = corners.get(a);
      const side = V.sub(corners.get(b),pa), diagonal = V.sub(corners.get(c),pa), along = V.norm(side);
      const u = V.dot(diagonal,along), h = V.len(V.cross(along,diagonal)), length2D = Math.hypot(q[0]-p[0],q[1]-p[1]);
      if (!(h>0 && length2D>0)) return;
      const x = (q[0]-p[0])/length2D, y = (q[1]-p[1])/length2D;
      const point = [p[0]+x*u+y*h,p[1]+y*u-x*h], prior = plane.get(c);
      if (prior && Math.hypot(prior[0]-point[0],prior[1]-point[1])>1e-8*Math.max(1,length2D,h)) return;
      if (!prior) plane.set(c,point);
      for (const [k,id] of ids.entries()) for (const neighbor of edges.get(key(id,ids[(k+1)%3])))
        if (!visited.has(neighbor[0])) queue.push(neighbor);
    }
    return visited.size===triangles.length ? plane : undefined;
  }

  function fit(model, face, recipe) {
    const {atlas,origin,anchor,texelsPerUnit,uvSet} = recipe, spans = atlas.map(n=>n-1);
    const triangles = model.triangles.get(face.id), plane = unfold(model.corners,triangles,anchor);
    if (!plane || face.corners.some(corner=>!plane.has(corner.id))) return {reason:'degenerate-flatten'};
    const footprint = meshUVRegions.bounds(plane.values()), lower = footprint.slice(0,2);
    const texelBounds = [...origin,...footprint.slice(2).map((n,i)=>origin[i]+(n-lower[i])*texelsPerUnit)];
    if (!texelBounds.every((n,i)=>Number.isFinite(n) && n>=0 && n<=spans[i%2]+1e-9))
      return {reason:'flatten-outside-atlas',texelBounds:texelBounds.map(n=>Number.isFinite(n) ? n : null)};
    const points = new Map(face.corners.map(corner=>{
      const uv = plane.get(corner.id).map((n,i)=>Math.min(1,(origin[i]+(n-lower[i])*texelsPerUnit)/spans[i]));
      const before = MaterialUV.uv(corner,uvSet);
      return [corner.id,nearUV(before,uv) ? before : uv];
    }));
    const mapped = row=>row.corners.map(id=>points.get(id));
    const patches = triangles.map(row=>mapped(row));
    if (patches.some(triangle=>Math.abs(MeshUV.area2(...triangle))<=1e-12))
      return {reason:'flatten-collapsed-uv',texelBounds};
    for (const [i,triangle] of patches.entries()) for (let j=0;j<i;j++)
      if (MeshUV.overlaps(triangle,patches[j],1e-12)) return {reason:'flatten-self-overlap',texelBounds};
    const pinned = face.corners.filter(corner=>MaterialUV.pinned(corner,uvSet) && MaterialUV.uv(corner,uvSet)!==points.get(corner.id));
    if (pinned.length) return {reason:'flatten-pinned-corner',texelBounds,corners:pinned.map(row=>row.id)};
    const before = triangles.map(row=>({...row,uv:row.corners.map(id=>MaterialUV.uv(face.corners.find(corner=>corner.id===id),uvSet))}));
    return {points,texelBounds,metrics:{
      before:before.every(row=>row.uv.every(Boolean)) ? meshUVRegions.stats(before,spans) : null,
      after:meshUVRegions.stats(triangles,spans,mapped)
    }};
  }

  function signature(face, set, points) {
    return JSON.stringify([face.material,face.corners.map(corner=>[corner.id,corner.vertex,points?.get(corner.id) ?? MaterialUV.uv(corner,set)])]);
  }

  function writeFace(face, set, points) {
    return {...face,corners:face.corners.map(corner=>{
      const uv = points.get(corner.id);
      if (uv===MaterialUV.uv(corner,set)) return corner;
      return set ? {...corner,attributes:{...corner.attributes,[MaterialUV.key(set)]:uv}} : {...corner,uv};
    })};
  }

  function projection(g, ids, operation, points, options, conflict) {
    const {atlas,origin,texelsPerUnit=options.texelsPerUnit ?? 16,refit=false} = operation;
    if (!meshUVRegions.fields(operation,['op','domain','ids','selection','atlas','origin','texelsPerUnit','refit']) ||
        atlas!==undefined && !validAtlas(atlas) || origin!==undefined && !meshUVRegions.tuple(origin,2,n=>Number.isFinite(n) && n>=0) ||
        !Number.isFinite(texelsPerUnit) || texelsPerUnit<=0 || typeof refit!=='boolean')
      throw new TypeError('Flatten needs positive texel density, optional atlas dimensions and texel origin, and a boolean refit flag');
    if (refit && !options.retainFlatten) throw new TypeError('Retained flatten refits need an editable scene');
    const model = mesh(g.doc,new Set(ids)), faces = [];
    for (const id of ids) {
      const face = model.faces.get(id);
      const discovered = atlas===undefined && (options.flattenAtlasFor ?? options.atlasFor)?.(face.material);
      const size = atlas ?? discovered?.size;
      if (!validAtlas(size)) throw new RangeError('Flatten needs source atlas dimensions for material '+face.material+' or an explicit atlas');
      const uv = face.corners.map(corner=>MaterialUV.uv(corner,g.set));
      const offset = origin ?? meshUVRegions.bounds(uv.filter(Boolean)).slice(0,2).map((n,i)=>Number.isFinite(n) ? n*(size[i]-1) : 0);
      const recipe = {format,version:1,uvSet:g.set,atlas:size.slice(),origin:offset.slice(),texelsPerUnit,
        anchor:face.corners.slice(0,2).map(corner=>corner.id),
        ...(discovered && {channel:discovered.channel,tileset:discovered.tileset ?? null})};
      const fitted = fit(model,face,recipe);
      const evidence = {face:id,material:face.material,atlas:size.slice(),origin:offset.slice(),texelBounds:fitted.texelBounds ?? null};
      if (fitted.reason) conflict(fitted.reason,{...evidence,...(fitted.corners && {corners:fitted.corners})});
      else {
        for (const [corner,uv] of fitted.points) points.set(corner,uv);
        evidence.metrics = fitted.metrics;
        if (refit) evidence.binding = {...recipe,signature:signature(face,g.set,fitted.points)};
      }
      faces.push(evidence);
    }
    return {texelsPerUnit,refit,faces,edgeChanges:[]};
  }

  function updateBindings(row, before, requested, updates, atlasFor) {
    const existing = (row.bindings ?? []).filter(isBinding), evidence = [], changed = new Map();
    const wanted = new Map(updates.map(update=>[JSON.stringify([update.face,update.uvSet]),update]));
    if (!existing.length && !wanted.size) return {document:requested,changed,evidence};
    const oldFaces = new Map(before.faces.map(face=>[face.id,face])), newFaces = new Map(requested.faces.map(face=>[face.id,face]));
    const oldPositions = new Map(before.vertices.map(vertex=>[vertex.id,vertex.position]));
    const newPositions = new Map(requested.vertices.map(vertex=>[vertex.id,vertex.position]));
    const candidates = [];
    function record(binding,reason,details={}) {
      const face = binding.element, uvSet = binding.data.uvSet;
      evidence.push({face,uvSet,status:'needs-review',reason,...details});
      changed.set(binding.id,{...binding,review:{reason,candidates:newFaces.has(face) ? [face] : []}});
    }
    for (const binding of existing) {
      const face = newFaces.get(binding.element), recipe = binding.data, set = recipe.uvSet;
      if (wanted.has(JSON.stringify([binding.element,set]))) { changed.set(binding.id,null); continue; }
      if (binding.review) continue;
      if (!face || !oldFaces.has(face.id)) { record(binding,'flatten-face-removed'); continue; }
      if (!MaterialUV.layout(set) || !validAtlas(recipe.atlas) || !meshUVRegions.tuple(recipe.origin,2) ||
          !meshUVRegions.tuple(recipe.anchor,2,meshUVRegions.name) || !Number.isFinite(recipe.texelsPerUnit) || recipe.texelsPerUnit<=0) {
        record(binding,'invalid-flatten-binding'); continue;
      }
      if (signature(face,set)!==recipe.signature) { record(binding,'flatten-mapping-changed'); continue; }
      if (!face.corners.some(corner=>oldPositions.get(corner.vertex)?.some((n,i)=>n!==newPositions.get(corner.vertex)[i]))) continue;
      const source = recipe.channel && atlasFor?.(recipe.channel,face.material);
      if (recipe.channel && atlasFor && (!source || (source.tileset ?? null)!==recipe.tileset ||
          source.size.some((n,i)=>n!==recipe.atlas[i]))) { record(binding,'flatten-atlas-changed'); continue; }
      candidates.push(binding);
    }
    let document = requested;
    if (candidates.length) {
      const model = mesh(requested,new Set(candidates.map(binding=>binding.element))), faces = new Map();
      for (const binding of candidates) {
        const recipe = binding.data, face = faces.get(binding.element) ?? model.faces.get(binding.element);
        const result = fit(model,face,recipe);
        if (result.reason) {
          record(binding,result.reason,{texelBounds:result.texelBounds ?? null,...(result.corners && {corners:result.corners})});
        } else {
          const signatureAfter = signature(face,recipe.uvSet,result.points);
          if (signatureAfter===recipe.signature) continue;
          faces.set(face.id,writeFace(face,recipe.uvSet,result.points));
          changed.set(binding.id,{...binding,data:{...recipe,signature:signatureAfter}});
          evidence.push({face:face.id,uvSet:recipe.uvSet,status:'refit',texelBounds:result.texelBounds,metrics:result.metrics});
        }
      }
      if (faces.size) document = T.edit(requested,{faces:[...faces.values()]});
    }
    return {document,changed,evidence};
  }

  function install(bindings, document, updates, changed) {
    const result = bindings.flatMap(binding=>changed.has(binding.id) ? changed.get(binding.id) ?? [] : [binding]);
    const occupied = new Set(result.map(row=>row.id));
    const faces = new Map(document.faces.map(face=>[face.id,face]));
    const wanted = new Map(updates.map(update=>[JSON.stringify([update.face,update.uvSet]),update]));
    for (const {face,uvSet,binding:data} of wanted.values()) if (data && faces.has(face)) {
      const prefix = 'uv-flatten/'+uvSet+'/'+face;
      let id = prefix;
      for (let n=2;occupied.has(id);n++) id = prefix+'/'+n;
      occupied.add(id);
      const matches = signature(faces.get(face),uvSet)===data.signature;
      result.push({id,domain:'faces',element:face,data,
        ...(!matches && {review:{reason:'flatten-mapping-changed',candidates:[face]}})});
    }
    return result;
  }

  return Object.freeze({isBinding,projection,updateBindings,install,unfold});
})(KIT);
