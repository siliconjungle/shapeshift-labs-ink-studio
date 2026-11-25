/* Recover a reusable tile stamp from authored face corners and source bindings. */
(function (K) {
  const A = K.authoring, {V} = K, {freeze} = K.procedural.data;
  const format = 'ink-studio/tileset-face-pick';
  const tolerance = 1e-6;
  const rotations = [0,90,180,270];
  const orientations = rotations.flatMap(rotation=>[false,true].map(flipX=>({rotation,flipX,flipY:false})));

  function frameOf(doc, face) {
    if (face.corners.length !== 4) return null;
    const vertices = new Map(doc.vertices.map(row=>[row.id,row.position]));
    const [origin,b,c,d] = face.corners.map(corner=>vertices.get(corner.vertex));
    const u = V.sub(b,origin), v = V.sub(d,origin);
    const width = Math.hypot(...u), height = Math.hypot(...v);
    if (!width || !height) return null;
    const right = V.mul(u,1/width), up = V.mul(v,1/height);
    if (Math.abs(V.dot(right,up))>tolerance ||
        V.dist(c,V.add(b,v))>tolerance*Math.max(width,height)) return null;
    return {origin,right,up,normal:V.cross(right,up).map(n=>n || 0),size:[width,height]};
  }

  const same = (a,b)=>Math.abs(a-b)<=tolerance;
  const contained = ([left,top,right,bottom], {x,y,width,height}) =>
    [left-x,top-y,x+width-1-right,y+height-1-bottom].every(n=>n>=-tolerance);
  const centerIndex = n=>same(n,Math.round(n)) ? Math.round(n) : n;

  function orientationOf(points, hint, slots = [0,1,2,3]) {
    if (points.length !== slots.length) return {};
    const [left,top] = [0,1].map(axis=>Math.min(...points.map(point=>point[axis])));
    const [right,bottom] = [0,1].map(axis=>Math.max(...points.map(point=>point[axis])));
    const reference = [[left,bottom],[right,bottom],[right,top],[left,top]];
    const fits = paint=>{
      const oriented = TilesetSelection.paintCorners(reference,paint);
      return slots.every((slot,i)=>oriented[slot].every((n,axis)=>same(n,points[i][axis])));
    };
    if (hint && fits(hint)) return {paint:hint,orientationStatus:'retained'};
    const matches = orientations.filter(fits);
    return matches.length ? {paint:matches[0],orientationStatus:matches.length>1 ? 'ambiguous' : 'uv-inferred'} : {};
  }

  function sourceBinding(row, face) {
    const candidates = (row.bindings ?? []).filter(binding=>A.tilesetFaces.isSourceBinding(binding) && binding.element === face);
    return candidates.find(item=>item.id === 'tileset/'+face) ?? (candidates.length === 1 ? candidates[0] : undefined);
  }

  function recover(asset, tileset, texels, binding, slots) {
    const [left,top] = [0,1].map(axis=>Math.min(...texels.map(point=>point[axis])));
    const [right,bottom] = [0,1].map(axis=>Math.max(...texels.map(point=>point[axis])));
    const bounds = [left,top,right,bottom];
    const data = binding?.data, prior = data?.selection;
    const usable = !binding?.review && !data?.review && prior?.tileset === tileset &&
      [prior.x,prior.y,prior.width,prior.height].every(Number.isSafeInteger) &&
      data.atlasSize?.[0] === asset.width && data.atlasSize?.[1] === asset.height &&
      prior.x>=0 && prior.y>=0 && prior.width>0 && prior.height>0 &&
      prior.x+prior.width<=asset.width && prior.y+prior.height<=asset.height && contained(bounds,prior);
    const x = Math.floor(centerIndex(left)), y = Math.floor(centerIndex(top));
    const selection = TilesetSelection.pick(tileset,asset,usable ? prior :
      {x,y,width:Math.ceil(centerIndex(right))-x+1,height:Math.ceil(centerIndex(bottom))-y+1});
    let hint;
    if (usable) {
      try { hint = TilesetSelection.paintOrientation(data.paint ?? {}); }
      catch (error) { if (!(error instanceof TypeError || error instanceof RangeError)) throw error; }
    }
    const orientation = orientationOf(texels,hint,slots);
    const uvInset = {left:Math.max(0,left-selection.x),top:Math.max(0,top-selection.y),
      right:Math.max(0,selection.x+selection.width-1-right),bottom:Math.max(0,selection.y+selection.height-1-bottom)};
    for (const edge of Object.keys(uvInset)) if (same(uvInset[edge],0)) uvInset[edge] = 0;
    return {selection,...orientation,uvInset,sourceStatus:usable ? 'retained' : 'uv-inferred',
      ...(binding && !usable && {sourceNotice:'retained-source-needs-review'})};
  }

  function inspect(scene, row, {object,face,brushSize=false} = {}) {
    if (typeof face !== 'string' || !face.trim() || typeof brushSize !== 'boolean')
      throw new TypeError('Eyedrop needs a face ID and an optional brushSize boolean');
    const doc = K.meshTopology.create(row.document);
    const polygon = doc.faces.find(item=>item.id === face);
    if (!polygon) throw new RangeError('Unknown mesh face '+face+' on '+object);
    const {material} = polygon, definition = row.materials?.find(item=>item.id === material);
    const bake = row.bakes?.find(item=>item.material === material && !item.invalidated);
    const uvSet = MaterialUV.resolve(doc.uvBindings,'pigment');
    const uv = polygon.corners.map(corner=>({corner:corner.id,uv:MaterialUV.uv(corner,uvSet)}));
    const frame = frameOf(doc,polygon);
    const {size,...worldFrame} = frame ?? {};
    const report = {format,version:1,object,...(row.part && {part:row.part}),face,material,uvSet,uv,
      revision:K.meshTopology.revision(doc),...(definition && {materialDefinition:definition}),...(frame && {worldFrame}),
      ...(brushSize && {brushSize:size ?? null,...(!frame && {sizeNotice:'face-is-not-rectangular'})})};
    const blocked = reason=>freeze({...report,canStamp:false,reason});
    if (bake) return blocked('active-material-bake');
    const tileset = definition?.texture?.tileset;
    if (!tileset) return blocked('material-has-no-tileset');
    const binding = sourceBinding(row,face);
    const slots = A.tilesetFaces.sourceCorners(binding,polygon.corners.length);
    if (!slots) return blocked('face-is-not-a-quad');

    const asset = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults).source(tileset);
    const texels = uv.map(({uv})=>[uv[0]*(asset.width-1),uv[1]*(asset.height-1)]);
    const recovered = recover(asset,tileset,texels,binding,slots);
    if (!recovered.paint) return blocked('pigment-uv-is-not-a-rectangular-stamp');
    const {selection,paint,uvInset} = recovered;
    const stamp = {selection,paint,material,materialDefinition:definition,
      ...(Object.values(uvInset).some(Boolean) && {uvInset}),
      ...(brushSize && size && {worldSize:size})};
    return freeze({...report,...recovered,canStamp:true,...(slots.length === 3 && {uvCorners:slots}),
      ...(binding && {binding:binding.id}),stamp});
  }

  A.tilesetEyedrop = Object.freeze({inspect,recover,orientationOf,sourceBinding});
})(KIT);
