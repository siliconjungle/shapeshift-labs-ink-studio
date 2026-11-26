/* Find authored faces by their pigment UV footprint on a registered sheet. */
(function (K) {
  const A = K.authoring, {freeze} = K.procedural.data, {sameUV,area2} = MeshUV;
  const epsilon = 1e-7;
  const axes = [0,1];

  function inside(point, min, max) {
    return axes.every(axis=>point[axis]>=min[axis]-epsilon && point[axis]<=max[axis]+epsilon);
  }

  function matches(points, min, max) {
    if (!points.every(point=>inside(point,min,max))) return false;
    const low = axes.map(axis=>Math.min(...points.map(point=>point[axis])));
    const high = axes.map(axis=>Math.max(...points.map(point=>point[axis])));
    if (!sameUV(low,min) || !sameUV(high,max)) return false;
    const width = max[0]-min[0], height = max[1]-min[1];
    if (!width || !height) return true;
    const on = (point,axis,bound)=>Math.abs(point[axis]-bound)<=epsilon;
    if (!points.every((a,i)=>{
      const b = points[(i+1)%points.length];
      return axes.some(axis=>[min[axis],max[axis]].some(bound=>on(a,axis,bound) && on(b,axis,bound)));
    })) return false;
    const twice = points.reduce((sum,b,i)=>sum+area2(points[0],b,points[(i+1)%points.length]),0);
    return Math.abs(Math.abs(twice)-2*width*height)<=4*epsilon*(width+height);
  }

  // Rectangles and UV triangles separate along a sheet axis or a triangle-edge normal.
  function touches(triangle, min, max) {
    if (axes.some(axis=>triangle.every(p=>p[axis]<min[axis]-epsilon) || triangle.every(p=>p[axis]>max[axis]+epsilon))) return false;
    return triangle.every(([x,y],i)=>{
      const [u,v] = triangle[(i+1)%3], a = y-v, b = u-x;
      const lo = a*(a<0 ? max[0] : min[0])+b*(b<0 ? max[1] : min[1]);
      const hi = a*(a<0 ? min[0] : max[0])+b*(b<0 ? min[1] : max[1]);
      const tolerance = epsilon*(Math.abs(a)+Math.abs(b));
      const projected = triangle.map(([u,v])=>a*u+b*v);
      return Math.max(...projected)>=lo-tolerance && Math.min(...projected)<=hi+tolerance;
    });
  }

  function select(scene, request) {
    const {object,part,selection,mode='match'} = request ?? {};
    if (!request || Object.getPrototypeOf(request)!==Object.prototype ||
        Object.keys(request).some(key=>!['object','part','selection','mode'].includes(key)) ||
        !TargetSelectors.name(object) || part!==undefined && !TargetSelectors.name(part) ||
        selection?.format!=='ink-studio/tileset-selection' || selection.version!==1 || !['match','inside','touch'].includes(mode))
      throw new TypeError('Atlas selection needs a mesh, an exact tileset pick, and match, inside, or touch mode');
    const meshes = scene.topologyMeshes ?? {}, row = Object.hasOwn(meshes,object) && meshes[object];
    if (!row || part!==undefined && row.part!==part) throw new RangeError('No editable topology for scene object '+object);
    const topo = K.meshTopology, doc = topo.create(row.document);
    const asset = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults).source(selection.tileset);
    const atlas = TilesetSelection.pick(selection.tileset,asset,selection);
    const {pigmentUV:[,max,,min]} = A.tilesetFaces.cropSource(asset,atlas);
    const uvSet = MaterialUV.resolve(doc.uvBindings,'pigment');
    const sheets = new Map((row.materials ?? []).map(({id,texture})=>[id,texture?.tileset]));
    for (const bake of row.bakes ?? []) if (!bake.invalidated && bake.maps?.texture !== undefined)
      sheets.set(bake.material,bake.maps.texture?.tileset);
    const corners = new Map(), picked = new Set();
    for (const face of doc.faces) {
      if (sheets.get(face.material)!==atlas.tileset) continue;
      const points = face.corners.map(corner=>MaterialUV.uv(corner,uvSet));
      if (points.some(point=>!point)) continue;
      if (mode==='match') {
        if (matches(points,min,max)) picked.add(face.id);
      } else if (mode==='inside') {
        if (points.every(point=>inside(point,min,max))) picked.add(face.id);
      } else {
        if (points.some(point=>inside(point,min,max))) picked.add(face.id);
        else if (axes.every(axis=>points.some(p=>p[axis]>=min[axis]-epsilon) && points.some(p=>p[axis]<=max[axis]+epsilon)))
          face.corners.forEach(({id},i)=>corners.set(id,points[i]));
      }
    }
    if (corners.size) for (const triangle of topo.triangulate(doc).triangleSources) {
      if (picked.has(triangle.face) || !corners.has(triangle.corners[0])) continue;
      if (touches(triangle.corners.map(id=>corners.get(id)),min,max)) picked.add(triangle.face);
    }
    const result = topo.select(doc,{domain:'faces',ids:[...picked]});
    return freeze({format:'ink-studio/tileset-atlas-selection',version:1,object,...(row.part && {part:row.part}),mode,atlas,
      uvSet,uvBounds:{min,max},ids:result.ids,selection:result});
  }

  A.tilesetAtlasSelection = Object.freeze({select,touches});
})(KIT);
