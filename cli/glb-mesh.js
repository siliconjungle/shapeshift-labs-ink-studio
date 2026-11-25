// Turn indexed authoring geometry, corner UVs and skin weights into glTF primitives.
const png = require('./png');
const { unwrap, area2 } = require('./glb-uv');
const bake = require('./glb-bake');
const MeshUV = require('../src/mesh-uv.js');
const UV = require('../src/material-uv.js');

function meshWriter(doc, mesh, rig, kit, options) {
  const { V } = kit;
  const { name, points } = mesh;
  const validVector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
  if (!points?.length || !points.every(p => validVector(p, 3)) || !mesh.faces?.length)
    throw new Error('GLB export requires finite vertices and faces for ' + name);
  if (mesh.uvs && mesh.uvs.length !== mesh.faces.length) throw new Error('Face UV count does not match faces');
  if (mesh.colors && (mesh.colors.length !== points.length || !mesh.colors.every(c => validVector(c, 3) && c.every(x => x >= 0 && x <= 1))))
    throw new Error('Expected one linear RGB color per vertex');
  if (mesh.normals && (mesh.normals.length !== points.length || !mesh.normals.every(n => validVector(n, 3) && V.len(n)>0)))
    throw new Error('Expected one normal per vertex');
  if (mesh.faceMaterials && mesh.faceMaterials.length !== mesh.faces.length)
    throw new Error('Face material count does not match faces');
  const materials = mesh.materials?.length ? mesh.materials : [{ name, color: [0.45, 0.45, 0.45] }];
  const faces = [], faceMaterials = [], corners = [], hardNormals = [], sourceFaces = [], splits = [];
  const {registered, meshIndex:registeredIndex} = options;
  const bindings=UV.bindings(mesh.uvBindings), binding=channel=>UV.resolve(bindings,channel);
  const primary=binding('pigment'), alternate=new Map(Object.entries(mesh.uvSets ?? {}).map(([set,rows])=>[+set,rows]));
  for (const [set,rows] of alternate) if (!UV.layout(set) || !set || !Array.isArray(rows) || rows.length!==mesh.faces.length)
    throw new RangeError('Alternate mesh UV sets need one layout row per face');
  for(const set of Object.values(bindings ?? {})) if (set && !alternate.has(set))
    throw new RangeError('Material channel references missing UV set '+set);
  const meshAt=set=>set ? {...mesh,uvs:alternate.get(set),uvCuts:mesh.uvCutsBySet?.[set]} : mesh;
  const prior=new Map(), cornerSets=new Map([...alternate].map(([set])=>[set,[]]));
  const baseline=set=>{
    if (!prior.has(set)) prior.set(set,registered?.layout(registeredIndex,meshAt(set),set));
    return prior.get(set);
  };
  const source=baseline(primary);
  const once = new Set();
  for (const [f, face] of mesh.faces.entries()) {
    if (!Array.isArray(face) || face.length < 3 || face.length > 4 || new Set(face).size !== face.length ||
        !face.every(i => Number.isInteger(i) && i >= 0 && i < points.length))
      throw new Error('Expected indexed triangles or quads with distinct vertices on ' + name);
    if (mesh.uvs && (mesh.uvs[f]?.length !== face.length || !mesh.uvs[f].every(p => validVector(p, 2))))
      throw new Error('Expected UVs for every face corner');
    for (const [set,rows] of alternate) if (rows[f]?.length!==face.length || !rows[f].every(p=>validVector(p,2)))
      throw new Error('Expected UV set '+set+' on every face corner');
    if (mesh.cornerNormals && (mesh.cornerNormals[f]?.length !== face.length ||
        !mesh.cornerNormals[f].every(v => validVector(v, 3) && V.len(v) > 0)))
      throw new Error('Expected normals for every face corner');
    const m = mesh.faceMaterials?.[f] ?? 0;
    if (!Number.isInteger(m) || m < 0 || m >= materials.length) throw new Error('Invalid face material on ' + name);
    const mainDiagonal = face.length===4 && ((source?.lockSplits ? source.state.splits[f] : undefined) ??
      (V.dist(points[face[0]],points[face[2]]) <= V.dist(points[face[1]],points[face[3]])));
    splits.push(mainDiagonal);
    let split = [[0, 1, 2]];
    if (face.length === 4)
      split = mainDiagonal ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
    for (const tri of split) {
      const ids = tri.map(i => face[i]), key = ids.slice().sort((a, b) => a - b).join('/');
      if (once.has(key)) throw new Error('Duplicate triangles on ' + name);
      once.add(key);
      faces.push(ids);
      faceMaterials.push(m);
      sourceFaces.push(f);
      if (mesh.uvs) corners.push(tri.map(i => mesh.uvs[f][i]));
      for (const [set,rows] of alternate) cornerSets.get(set).push(tri.map(i=>rows[f][i]));
      if (mesh.cornerNormals) hardNormals.push(tri.map(i => V.norm(mesh.cornerNormals[f][i])));
    }
  }

  if (mesh.closed) {
    const edges = new Map();
    for (const face of faces) for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], key = a < b ? a + '/' + b : b + '/' + a;
      const use = edges.get(key) || [0, 0];
      use[a < b ? 0 : 1]++;
      edges.set(key, use);
    }
    if ([...edges.values()].some(([a, b]) => a !== 1 || b !== 1))
      throw new Error('Closed model has inconsistent winding or a non-manifold edge on ' + name);
  }
  const vertexNormals = points.map(() => [0, 0, 0]);
  const faceNormals = faces.map(face => {
    const [a, b, c] = face.map(i => points[i]), ab = V.sub(b, a), ac = V.sub(c, a);
    const cross = V.cross(ab, ac), length = V.len(cross);
    if (!Number.isFinite(length) || length <= 1e-12 * V.len(ab) * V.len(ac)) throw new Error('Degenerate triangle on ' + name);
    for (const v of face) vertexNormals[v] = V.add(vertexNormals[v], cross);
    return V.mul(cross, 1 / length);
  });
  const normals = (mesh.normals || vertexNormals).map(n => V.norm(n));
  const { uvMargin } = options;
  const textureSize = options.textureSize === 0 ? 0 : mesh.textureSize ?? options.textureSize ?? source?.row.width ?? 1024;
  if (![0, 256, 512, 1024, 2048, 4096].includes(textureSize)) throw new Error('Invalid texture size on ' + name);
  const generated = !mesh.uvs, atlases=new Map();
  function atlasAt(set) {
    if (!atlases.has(set)) {
      const saved=baseline(set);
      const atlas = saved && !saved.revised ? {
        uvs:saved.state.uvs,padding:saved.row.padding,charts:saved.state.chartCount,utilization:saved.state.utilization
      } : !set && generated ? unwrap(points, faces, faceNormals, {
        size: textureSize || 1024, margin: uvMargin, groups: mesh.chartGroups ? sourceFaces.map(i => mesh.chartGroups[i]) : undefined
      }) : {uvs:set ? cornerSets.get(set) : corners,padding:saved?.row.padding ?? Math.max(2,Math.ceil(textureSize*uvMargin/2))};
      if (registered) atlas.uvs=atlas.uvs.map(face=>face.map(uv=>uv.map(Math.fround)));
      if (atlas.uvs.some(uv=>Math.abs(area2(...uv))<1e-15)) throw new Error('Degenerate UV mapping on '+name+' set '+set);
      atlases.set(set,atlas);
    }
    return atlases.get(set);
  }
  const atlas = atlasAt(primary);
  if (registered && (!textureSize || materials.some(m=>m.alphaMode && m.alphaMode!=='OPAQUE' || (m.opacity??1)!==1 && !mesh.paintedOpacity)))
    throw new TypeError('Registered baking needs a texture size and opaque source materials');
  const bakeSource = registered || (generated || mesh.bakeUVs) && textureSize && materials.every(m=>!m.texture&&!m.alphaMode);
  const texture = (bytes,label,mime,texCoord=0)=>({ index:doc.texture(bytes,name+' · '+label,mime),...(texCoord && {texCoord}) });
  function emissive(material, value, strength) {
    if (value.some(x => x > 0)) material.emissiveFactor = value;
    if (strength > 1) {
      const ext = 'KHR_materials_emissive_strength';
      material.extensions = { [ext]: { emissiveStrength: strength } };
      const list = (doc.gltf.extensionsUsed ||= []);
      if (!list.includes(ext)) list.push(ext);
    }
  }
  function materialFor(m) {
    const material = {
      name: m.name || name,
      pbrMetallicRoughness: { baseColorFactor: [...(m.color || [0.45, 0.45, 0.45]), m.opacity ?? 1],
        roughnessFactor: m.roughness ?? 0.8, metallicFactor: m.metallic ?? 0 }
    };
    if (m.texture) {
      const { width, height, pixels, channels = 4, bytes, mimeType } = m.texture;
      material.pbrMetallicRoughness.baseColorTexture = texture(bytes || png.encode(width, height, pixels, channels), m.name || 'base color', mimeType,primary);
    }
    if (m.alphaMode) material.alphaMode = m.alphaMode;
    else if (mesh.paintedOpacity && (m.opacity??1)<1) material.alphaMode = 'BLEND';
    if (m.alphaMode === 'MASK') material.alphaCutoff = m.alphaCutoff ?? 0.5;
    if (m.doubleSided) material.doubleSided = true;
    const emission = m.emission || [0, 0, 0], strength = Math.max(1, ...emission);
    emissive(material, emission.map(q => q / strength), strength);
    return doc.add('materials', material);
  }
  let materialIds;
  let registeredBake;
  if (bakeSource) {
    const sets=new Set([primary,...['normal','metallicRoughness','emission'].map(binding)]);
    if (registered) for (const channel of ['masks',...Object.keys(bindings ?? {}).filter(id=>id.startsWith('mask/'))])
      sets.add(binding(channel));
    if (sets.size*textureSize**2>16777216) throw new RangeError('Channel UV atlases exceed the material pixel budget');
    const sample=mesh.sampleSurface;
    const bakeNormals=hardNormals.length ? hardNormals : mesh.smooth===false ? faceNormals.map(n=>[n,n,n]) : undefined;
    const bakedBySet=new Map(), pigmentUVs=atlas.uvs;
    for (const set of sets) {
      const current=atlasAt(set), saved=baseline(set), {uvs}=current;
      if (uvs.some(face=>face.some(uv=>uv.some(x=>x<0||x>1))))
        throw new Error('UV coordinates for a texture bake must be inside the atlas');
      if (registered && (set || !generated) && !saved) {
        const {overlap}=MeshUV.inspect({points,triangles:faces,uvs},{size:textureSize,padding:0,maxChecks:16000000});
        if (!overlap.complete || overlap.count)
          throw new Error('Registered bake needs a non-overlapping UV atlas on '+name+' set '+set+'. Inspect the layout with mesh-uv.');
      }
      const bakeMesh={...meshAt(set),materials,faceMaterials,cornerNormals:bakeNormals,
        sampleSurface:sample && ((p,n,f)=>sample.call(mesh,p,n,sourceFaces[f]))};
      const {chartBake,projection}=registered?.plan(registeredIndex,{
        mesh:{...bakeMesh,faces:mesh.faces},faces,uvs,normals,faceNormals,atlas:current,splits,sourceFaces,
        size:textureSize,source:saved,set,primary,pigmentUVs
      },kit) ?? {};
      const baked=bake(bakeMesh,faces,uvs,normals,textureSize,current.padding,{V},
        {registered:Boolean(registered),projection,chartBake,sourceFaces,...(sets.size>1 && {pigmentUVs})});
      bakedBySet.set(set,baked);
      if (registered) {
        const report=registered.record(registeredIndex,mesh,faces,uvs,textureSize,current.padding,baked,chartBake,
          projection,saved,{V},set,primary);
        if (set===primary) registeredBake=report;
      }
    }
    if (registered) registeredBake=registered.compose(registeredIndex,bindings,primary,registeredBake);
    const baked=bakedBySet.get(primary);
    const material={name,pbrMetallicRoughness:{
      baseColorTexture:texture(baked.textures.base,'base color',undefined,primary),metallicFactor:0,roughnessFactor:.8
    }};
    const normalSet=binding('normal'), surfaceSet=binding('metallicRoughness'), emissionSet=binding('emission');
    const normal=bakedBySet.get(normalSet).textures.normal, surface=bakedBySet.get(surfaceSet).textures.surface;
    const glow=bakedBySet.get(emissionSet);
    if (baked.translucent) material.alphaMode='BLEND';
    if (normal) material.normalTexture=texture(normal,'normal',undefined,normalSet);
    if (surface) {
      material.pbrMetallicRoughness.metallicRoughnessTexture=texture(surface,'roughness and metal',undefined,surfaceSet);
      material.pbrMetallicRoughness.metallicFactor=material.pbrMetallicRoughness.roughnessFactor=1;
    }
    if (glow.textures.emission) {
      material.emissiveTexture=texture(glow.textures.emission,'emission',undefined,emissionSet);
      emissive(material,[1,1,1],glow.strength);
    }
    atlas.coverage=baked.coverage;
    materialIds=materials.map(()=>0);
    materialIds[0]=doc.add('materials',material);
  } else materialIds = materials.map(materialFor);

  if (mesh.weights && (!rig.size || mesh.weights.length !== points.length)) throw new Error('Weights need a skeleton and one list per vertex');
  if (rig.size && !mesh.weights && !mesh.static) throw new Error('Provide weights or mark ' + name + ' static');
  const weights = mesh.weights?.map((weights, v) => {
    const combined = new Map();
    for (const [i, w] of weights) {
      if (!Number.isInteger(i) || i < 0 || i >= rig.size || i > 65535 || !Number.isFinite(w) || w < 0)
        throw new Error('Invalid skin weight on ' + name);
      combined.set(i, (combined.get(i) || 0) + w);
    }
    const best = [...combined].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
    const sum = best.reduce((s, pair) => s + pair[1], 0);
    if (!(sum > 0) || !Number.isFinite(sum)) throw new Error('Missing weight at vertex ' + v + ' of ' + name);
    while (best.length < 4) best.push([0, 0]);
    return best.map(([i, w]) => [w > 0 ? i : 0, w / sum]);
  });
  const primitives = [], byMaterial = new Map();
  for (let f = 0; f < faces.length; f++) {
    const m = materialIds[bakeSource ? 0 : faceMaterials[f]];
    if (!byMaterial.has(m)) byMaterial.set(m, []);
    byMaterial.get(m).push(f);
  }
  const exportSets=[0,...[...alternate.keys()].sort((a,b)=>a-b)].map(set=>[set,atlasAt(set).uvs]);
  const maxSet=exportSets.at(-1)[0];
  // Keep authored numbers stable while meeting glTF's consecutive TEXCOORD rule.
  const paddingSets=Array.from({length:maxSet},(_,i)=>i+1).filter(set=>!alternate.has(set));
  let vertices = 0;
  for (const [material, subset] of byMaterial) {
    const pos = [], nr = [], uv = exportSets.map(()=>[]), indices = [], colors = [], weight = [], joint = [], unique = new Map();
    for (const f of subset) for (const [c, vertex] of faces[f].entries()) {
      const tex = exportSets.map(([,rows])=>rows[f][c].map(Math.fround));
      const normal = hardNormals[f]?.[c] || (mesh.smooth === false ? faceNormals[f] : normals[vertex]);
      const key = [vertex, ...tex.flat(), ...normal.map(Math.fround)].join('/');
      if (!unique.has(key)) {
        unique.set(key, pos.length / 3);
        pos.push(...points[vertex]);
        nr.push(...normal);
        uv.forEach((values,i)=>values.push(...tex[i]));
        if (mesh.colors && !registered) colors.push(...mesh.colors[vertex]);
        if (weights) for (const [i, w] of weights[vertex]) {
          joint.push(i);
          weight.push(w);
        }
      }
      indices.push(unique.get(key));
    }
    vertices += pos.length / 3;
    const float = (data, type, bounds = false) => doc.accessor(Float32Array.from(data), type, { target: 34962, bounds });
    const attributes = { POSITION: float(pos, 'VEC3', true), NORMAL: float(nr, 'VEC3') };
    const coordinates=new Map(exportSets.map(([set],i)=>[set,float(uv[i],'VEC2')]));
    for (let set=0;set<=maxSet;set++) attributes['TEXCOORD_'+set]=coordinates.get(set) ?? coordinates.get(0);
    if (colors.length) attributes.COLOR_0 = float(colors, 'VEC3');
    if (weights) {
      attributes.JOINTS_0 = doc.accessor(Uint16Array.from(joint), 'VEC4', { target: 34962 });
      attributes.WEIGHTS_0 = float(weight, 'VEC4');
    }
    const Index = unique.size < 65536 ? Uint16Array : Uint32Array;
    primitives.push({ attributes, indices: doc.accessor(Index.from(indices), 'SCALAR', { target: 34963 }), material });
  }
  const meshIndex = doc.add('meshes', { name, primitives, ...((bindings || paddingSets.length) && {extras:{inkStudioMaterialUV:{version:1,
    ...(bindings && {bindings}),...(paddingSets.length && {paddingSets})}}}) });
  const node = doc.add('nodes', { name, mesh: meshIndex, ...(weights ? { skin: rig.skin() } : {}) });
  doc.gltf.scenes[0].nodes.push(node);
  return { name, vertices: new Set(faces.flat()).size, renderVertices: vertices, triangles: faces.length, uvLayers: exportSets.length,
    ...(registeredBake && {registeredBake}),
    generatedUVs: generated, ...(mesh.sourceTriangles === undefined ? {} : { sourceTriangles: mesh.sourceTriangles }), ...(generated ? { charts: atlas.charts, uvUtilization: atlas.utilization } : {}) };
}

module.exports = meshWriter;
