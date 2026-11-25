/* Retain a dimensional recipe beside each painted primitive's authored polygons. */
(function (K) {
  const A = K.authoring, T = K.meshTopology, {V} = K, {freeze} = K.procedural.data;
  const format = 'ink-studio/tileset-primitive';
  const kinds = ['box','wedge','cylinder','cone','sphere'];
  const names = ['id','object','part','mode','size','segments'];
  const stampFields = ['kind','at','snapGrid','selection','cell','paint','uvInset','material','materialDefinition'];
  const pair = values=>Array.isArray(values) && Array.from(values).every(Number.isFinite);
  const name = value=>typeof value === 'string' && value.trim();
  const close = (a,b)=>a.length === b.length && a.every((n,i)=>Math.abs(n-b[i])<=1e-9);
  const index = rows=>new Map(rows.map(row=>[row.id,row]));

  function counts(kind, raw, previous) {
    const curved = ['cylinder','cone','sphere'].includes(kind);
    const keys=curved ? ['radial','axial'] : ['subdivisions'];
    if (raw !== undefined && (!raw || Object.getPrototypeOf(raw)!==Object.prototype ||
        Object.keys(raw).some(key=>!keys.includes(key))))
      throw new TypeError(curved ? 'Use radial and axial segments for a curved primitive' : 'Use subdivisions for a box or wedge');
    if (!curved) {
      const subdivisions=raw?.subdivisions ?? previous?.subdivisions ?? 1;
      if (!Number.isSafeInteger(subdivisions) || subdivisions<1 || subdivisions>24)
        throw new RangeError('A box or wedge needs 1–24 subdivisions per edge');
      return {subdivisions};
    }
    const {radial,axial} = {radial:16,axial:kind === 'sphere' ? 8 : 1,...previous,...raw};
    if (!Number.isSafeInteger(radial) || radial<3 || radial>128 ||
        !Number.isSafeInteger(axial) || axial<(kind === 'sphere' ? 2 : 1) || axial>64)
      throw new RangeError('Primitive segments need 3–128 radial and 1–64 axial steps, with at least 2 axial steps for spheres');
    return {radial,axial};
  }

  function newFrame(scene, at=[0,0], snapGrid=false) {
    if (!pair(at) || ![2,3].includes(at.length) || typeof snapGrid !== 'boolean')
      throw new TypeError('Primitive placement needs [u,v] or [u,v,normalOffset] and a boolean snapGrid');
    const plane=A.constructionPlane, frame=plane.forScene(scene);
    const gridAt=snapGrid ? plane.quantize(frame,at.slice(0,2)) : at.slice(0,2);
    return {origin:V.mad(plane.point(frame,gridAt),frame.axes[2],at[2] ?? 0),axes:frame.axes};
  }

  function geometry(id, recipe) {
    return A.tilesetPrimitiveGeometry.build(id,recipe.kind,recipe.frame,recipe.size,recipe.segments);
  }

  function brushPick(scene, selection, cell, paint, uvInset) {
    if (selection?.format !== 'ink-studio/tileset-brush') {
      if (cell !== undefined) throw new TypeError('A primitive cell needs a saved tile brush');
      return {selection,paint,uvInset};
    }
    const asset=A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults).source(selection.tileset);
    const brush=TilesetSelection.readBrush(asset,selection);
    if (cell === undefined && TilesetSelection.hasGaps(brush))
      throw new RangeError('Choose a column and row for a brush with atlas gutters');
    const rect=cell === undefined ? brush : TilesetSelection.cell(brush,cell);
    return {selection:TilesetSelection.pick(brush.tileset,asset,rect),paint:paint ?? selection.paint,
      uvInset:uvInset ?? selection.uvInset};
  }

  function authored(model, material, map, doc) {
    const set=MaterialUV.resolve(doc?.uvBindings,'pigment'), sets=[...new Set(Object.values(doc?.uvBindings ?? {}).filter(Boolean))];
    const faces=model.faces.map(({id,ids,chart})=>({id,material,corners:ids.map((vertex,i)=>{
      const at=chart[i], pigment=map(at);
      return {id:id+'/c'+i,vertex,uv:set ? at : pigment,
        ...(sets.length && {attributes:Object.fromEntries(sets.map(n=>[MaterialUV.key(n),n===set ? pigment : at]))})};
    })}));
    return {vertices:model.vertices,faces};
  }

  function stampMap(corners) {
    const origin=corners[3], right=corners[2], bottom=corners[0];
    return ([u,v])=>origin.map((n,i)=>Math.max(0,Math.min(1,n+(right[i]-n)*u+(bottom[i]-n)*v)));
  }

  function recipeBinding(id, element, recipe) {
    return {id:'primitive/'+id,domain:'faces',element,data:{format,version:1,...recipe}};
  }

  function sourceBindings(faces, source, id) {
    return faces.map(face=>({id:'tileset/'+face.id,domain:'faces',element:face.id,
      data:{...source,placement:{primitive:id}}}));
  }

  function fitChart(samples) {
    const [[anchor,origin],...other] = samples;
    const first = other.find(([at])=>!close(at,anchor));
    if (!first) return;
    const b=first[0].map((n,i)=>n-anchor[i]);
    const determinant = at=> b[0]*(at[1]-anchor[1])-b[1]*(at[0]-anchor[0]);
    const second=other.find(([at])=>Math.abs(determinant(at))>1e-10);
    if (!second) return;
    const c=second[0].map((n,i)=>n-anchor[i]), det=determinant(second[0]);
    const map = ([u,v])=>{
      const x=u-anchor[0], y=v-anchor[1];
      const p=(x*c[1]-y*c[0])/det, q=(b[0]*y-b[1]*x)/det;
      return origin.map((n,i)=>n+(first[1][i]-n)*p+(second[1][i]-n)*q);
    };
    if (samples.every(([at,uv])=>close(map(at),uv)))
      return at=>map(at).map(n=>Math.max(0,Math.min(1,n)));
  }

  function paintForResegment(row, doc, model, owned, id) {
    const painted=new Map((row.bindings ?? []).filter(binding=>A.tilesetFaces.isSourceBinding(binding) &&
      binding.data.placement?.primitive === id && !binding.review && !binding.data.review).map(binding=>[binding.element,binding.data]));
    const byFace=index(doc.faces), material=byFace.get(model.faces[0].id).material, source=painted.get(model.faces[0].id);
    const slot=row.materials?.find(item=>item.id === material);
    if (!source || slot?.texture?.tileset !== source.selection.tileset) return;
    if (model.vertices.some(vertex=>owned.vertices.get(vertex.id).weights)) return;
    if (doc.edges.some(edge=>edge.vertices.every(id=>owned.ids.has(id)) &&
        (edge.crease !== undefined || edge.smooth !== undefined || edge.uvSeam || edge.uvSeams))) return;
    const set=MaterialUV.resolve(doc.uvBindings,'pigment'), samples=[];
    for (const {id,chart} of model.faces) {
      const face=byFace.get(id), data=painted.get(id);
      if (face.material !== material || !data || !A.tilesetFaces.sameMaterial(data,source)) return;
      for (const [i,corner] of face.corners.entries()) {
        const at=chart[i];
        if (corner.normal || corner.uvPinned || corner.uvPins || set && !close(corner.uv,at) ||
            Object.entries(corner.attributes ?? {}).some(([key,uv])=>
              !MaterialUV.isKey(key) || key !== MaterialUV.key(set) && !close(uv,at))) return;
        samples.push([at,MaterialUV.uv(corner,set)]);
      }
    }
    const map=fitChart(samples);
    return map && {map,source,material};
  }

  function ownedGeometry(doc, model) {
    const vertices=index(doc.vertices), faces=index(doc.faces);
    const ids=new Set(model.vertices.map(row=>row.id)), faceIds=new Set(model.faces.map(row=>row.id));
    if (model.vertices.some(row=>!vertices.has(row.id) || !close(vertices.get(row.id).position,row.position)) ||
        model.faces.some(row=>{
          const corners=faces.get(row.id)?.corners;
          return !corners || corners.length!==row.ids.length ||
            !corners.every((corner,i)=>corner.vertex===row.ids[i] && corner.id===row.id+'/c'+i);
        }) ||
        doc.faces.some(row=>!faceIds.has(row.id) && row.corners.some(corner=>ids.has(corner.vertex)))) return;
    return {vertices,faces,ids,faceIds};
  }

  function plan(scene, request) {
    const {id,object,part,mode='stamp',kind,size:requestedSize,segments:requestedSegments,at,snapGrid,
      selection,cell,paint,uvInset,material,materialDefinition} = request ?? {};
    const revising=mode==='revise';
    if (!request || Object.getPrototypeOf(request)!==Object.prototype ||
        Object.keys(request).some(key=>!names.includes(key) && (revising || !stampFields.includes(key))) ||
        typeof id!=='string' || !/^[\w.-]{1,96}$/.test(id) || !name(object) || part!==undefined && !name(part) ||
        !['stamp','revise'].includes(mode) || !revising && !kinds.includes(kind))
      throw new TypeError('Use a primitive ID, mesh object, and stamp kind or revise request');
    const meshes=scene.topologyMeshes ?? {}, old=Object.hasOwn(meshes,object) && meshes[object] || undefined;
    if (old && part!==undefined && old.part!==part) throw new RangeError('No editable topology for scene object '+object+'/'+part);
    const doc=old && T.create(old.document);
    const key='primitive/'+id;
    const binding=old?.bindings?.find(item=>item.id===key);
    const prior=binding?.data;
    const shape=revising ? prior?.kind : kind;
    const size=requestedSize ?? (revising ? prior?.size : undefined);
    if (revising && (!prior || prior.format!==format || prior.version!==1 || !kinds.includes(shape)))
      throw new RangeError('Unknown retained primitive '+id);
    if (!pair(size) || size.length!==3 || size.some(n=>n<=0)) throw new RangeError('Primitive size needs three positive scene-unit dimensions');
    const segments=counts(shape,requestedSegments,revising ? prior.segments : undefined);
    const frame=revising ? prior.frame : newFrame(scene,at,snapGrid);
    const recipe={kind:shape,size:size.slice(),segments,frame};
    const model=geometry(id,recipe);
    const info={format,version:1,id,object,mode,...((old?.part ?? part) && {part:old?.part ?? part}),
      ...recipe, beforeRevision:doc ? T.revision(doc) : null};
    const blocked = issues=>({report:freeze({...info,canCommit:false,issues})});

    let patch, tileBindings, addedMaterial, pigment;
    if (!revising) {
      const pick=brushPick(scene,selection,cell,paint,uvInset);
      const brush=A.tilesetFaces.prepare(scene,{object,part,face:key,...pick,material,materialDefinition},undefined,size.slice(0,2));
      if (brush.conflicts.length) return blocked(brush.conflicts);
      const reserved=[...(doc?.vertices ?? []),...(doc?.faces ?? []),
        ...(doc?.faces.flatMap(face=>face.corners) ?? []),...(old?.bindings ?? [])];
      if (binding || reserved.some(row=>row.id.startsWith(key+'/') || row.id.startsWith('tileset/'+key+'/')))
        return blocked([{reason:'primitive-id-in-use'}]);
      patch=authored(model,brush.material,stampMap(brush.pigmentUV),doc);
      tileBindings=sourceBindings(patch.faces,brush.source,id);
      pigment={source:brush.source,material:brush.material};
      if (!brush.slot) addedMaterial=brush.materialDefinition ?? {id:brush.material,texture:{tileset:brush.source.selection.tileset}};
    } else {
      const previous=geometry(id,prior), owned=ownedGeometry(doc,previous);
      if (binding.review || !owned) return blocked([{reason:'primitive-topology-was-edited'}]);
      if (A.tilesetFaces.sameMaterial(segments,prior.segments)) {
        if (size.every((n,i)=>n===prior.size[i])) return {report:freeze({...info,canCommit:true,issues:[],
          vertices:model.vertices.length,faces:model.faces.length,afterRevision:info.beforeRevision})};
        patch={vertices:model.vertices.map(row=>({...owned.vertices.get(row.id),position:row.position}))};
      } else {
        const source=paintForResegment(old,doc,previous,owned,id);
        if (!source) return blocked([{reason:'primitive-paint-or-topology-needs-review'}]);
        patch=authored(model,source.material,source.map,doc);
        if (patch.vertices.some(row=>owned.vertices.has(row.id) && !owned.ids.has(row.id)) ||
            patch.faces.some(row=>owned.faces.has(row.id) && !owned.faceIds.has(row.id)))
          return blocked([{reason:'primitive-element-id-in-use'}]);
        const vertices=new Set(patch.vertices.map(row=>row.id)), faces=new Set(patch.faces.map(row=>row.id));
        patch.removeVertices=[...owned.ids].filter(key=>!vertices.has(key));
        patch.removeFaces=[...owned.faceIds].filter(key=>!faces.has(key));
        tileBindings=sourceBindings(patch.faces,source.source,id);
        pigment={source:source.source,material:source.material};
      }
    }

    const row=old ? A.meshTopologyScene.revise(old,patch).row : {document:T.create({id:object,...patch}),...(part && {part})};
    const hinge=scene.constructionPlane?.edgeAnchor;
    if (hinge?.object===object && !row.document.edges.some(edge=>edge.id===hinge.edge))
      return blocked([{reason:'construction-plane-edge',edge:hinge.edge}]);
    row.bindings=(row.bindings ?? []).filter(item=>item.id!==key &&
      !(tileBindings && A.tilesetFaces.isSourceBinding(item) && item.data.placement?.primitive===id));
    const retained=recipeBinding(id,model.faces[0].id,recipe);
    row.bindings.push(retained,...(tileBindings ?? []));
    if (addedMaterial) row.materials=[...(row.materials ?? []),addedMaterial];
    const report=freeze({...info,canCommit:true,issues:[],vertices:model.vertices.length,faces:model.faces.length,...pigment,
      afterRevision:T.revision(row.document),changes:A.meshTopologyScene.diff(old,row)});
    return {row,report};
  }

  A.tilesetPrimitives = Object.freeze({plan});
})(KIT);
