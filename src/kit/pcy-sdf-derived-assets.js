// Derived render and query assets prepared from one immutable brick revision.
(function(K) {
  const P=K.procedural, {V}=K;
  const point=p=>Array.isArray(p) && p.length===3 && Array.from(p).every(Number.isFinite);
  const fields=(value,keys)=>value && Object.getPrototypeOf(value)===Object.prototype &&
    Object.keys(value).every(key=>keys.includes(key));

  function settings(raw={}) {
    if (!fields(raw,['depthProxy','shadow','bakePaint','splats']) ||
        ['depthProxy','shadow'].some(key=>raw[key]!==undefined && typeof raw[key]!=='boolean') ||
        raw.bakePaint!==undefined && typeof raw.bakePaint!=='function')
      throw new TypeError('SDF derived assets accept depthProxy, shadow, bakePaint, and splats');
    const {depthProxy=false,shadow=false,bakePaint,splats=false}=raw;
    const maxSplats=splats===true ? 200000 : splats?.maxSplats ?? 200000;
    if (splats!==false && splats!==true && (!fields(splats,['maxSplats']) ||
        !Number.isSafeInteger(maxSplats) || maxSplats<1 || maxSplats>500000))
      throw new RangeError('SDF splat bakes need a budget of 1 to 500000 patches');
    return {depthProxy,shadow,bakePaint,maxSplats:splats ? maxSplats : 0};
  }

  function paint(bake,source,base) {
    const result=bake?.(source);
    if (result===undefined) return {uvs:new Float32Array(source.positions.length/3*2),materials:base};
    if (!fields(result,['uvs','materials']) || !result.uvs || !Array.isArray(result.materials) ||
        result.materials.length!==base.length || base.some((row,i)=>result.materials[i]?.id!==row.id))
      throw new TypeError('SDF paint bakes need UVs and the same ordered material IDs');
    for (const material of result.materials) {
      const texture=SemanticTextureMipmaps.texture(material.texture);
      for (let i=3;i<(texture?.pixels?.length ?? 0);i+=4)
        if (texture.pixels[i]!==255) throw new RangeError('SDF paint bakes need opaque pigment');
    }
    return result;
  }

  function splats(mesh,positions,indices,max) {
    if (mesh.triangles>max) throw new RangeError('SDF splat patches exceed the field budget');
    const builder=makeBuilder(1,undefined,{initialCapacity:mesh.triangles});
    for (let triangle=0;triangle<mesh.triangles;triangle++) {
      const vertices=indices.slice(triangle*3,triangle*3+3).map(i=>positions.slice(i*3,i*3+3));
      // Shared edges overlap slightly to cover distance-atlas interpolation near the corners.
      const center=V.mul(vertices.reduce(V.add),1/3);
      const cover=vertices.map(point=>V.mad(point,V.sub(point,center),.02));
      const {color,material}=K.sceneMeshes.trianglePigment(mesh,triangle);
      const rgb=[color>>16,color>>8&255,color&255];
      K.surfacePatches.triangle(builder,cover,{color:rgb,albedo:rgb.map(n=>n/255),object:mesh.objectId,
        material,target:{entity:mesh.objectId,surface:mesh.id}});
    }
    return Object.freeze(builder.finish({id:mesh.id,dither:0},{consumePendingPaint:false}));
  }

  function assemble(chunks,trace,options,previousShape) {
    const meshes=Object.freeze(chunks.flatMap(chunk=>chunk.mesh ? [chunk.mesh] : []));
    const {objectId,bounds}=trace;
    const shape=previousShape ?? (() => {
      function distance(x,y,z) {
        const p=[x,y,z];
        const box=Math.max(...p.map((n,i)=>Math.max(bounds.min[i]-n,n-bounds.max[i])));
        return Math.max(box,trace.distance(x,y,z));
      }
      return Object.freeze({
        collision:Object.freeze({id:objectId,bounds,distance:point=>distance(...point)}),
        ...(options.shadow && {shadow:Object.freeze({bounds,distance})})
      });
    })();
    const assets=Object.freeze({
      meshes,
      paintBakes:Object.freeze(meshes.map(K.sceneMeshes.layer)),
      depthProxies:Object.freeze(chunks.flatMap(chunk=>chunk.depthProxy ? [chunk.depthProxy] : [])),
      ...(options.maxSplats && {splats:Object.freeze(chunks.flatMap(chunk=>chunk.splats ? [chunk.splats] : []))}),
      ...shape,
      pick({origin,direction,maxDistance=100}={}) {
        if (!point(origin) || !point(direction) || V.len(direction)<1e-8 || !Number.isFinite(maxDistance) || maxDistance<=0)
          throw new TypeError('SDF picking needs a finite ray and positive distance');
        const axis=V.norm(direction);
        let nearest;
        for (const mesh of meshes) {
          const hit=K.sceneMeshes.rayQuery(mesh,K)({origin,direction:axis,maxDistance:nearest?.distance ?? maxDistance});
          if (hit && (!nearest || hit.distance<nearest.distance)) nearest=hit;
        }
        return nearest ?? null;
      }
    });
    return {assets,shape};
  }

  function splatWorld(snapshot,options={}) {
    if (!snapshot?.assets?.splats) throw new TypeError('Enable derived splats before building their presentation world');
    const parts=snapshot.assets.splats;
    const {pal,bg,fog,outline,seed}=parts[0] ?? makeBuilder(1,undefined,{initialCapacity:1}).finish({}, {consumePendingPaint:false});
    return SplatProvenance.join(parts,{id:snapshot.objectId,pal,bg,fog,outline,seed,dither:0,
      radius:Math.max(1,V.len(V.sub(snapshot.bounds.max,snapshot.bounds.min))),...options,brickSnapshot:snapshot});
  }

  P.sdfDerivedAssets=Object.freeze({settings,paint,splats,assemble,splatWorld});
})(KIT);
