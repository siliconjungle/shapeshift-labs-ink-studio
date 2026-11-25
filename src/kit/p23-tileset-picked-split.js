/* Pair face subdivisions with their original atlas and reusable child crops. */
(function (K) {
  const A = K.authoring, {freeze} = K.procedural.data;

  function atlasFor(scene, row, polygon) {
    const material = row.materials?.find(item=>item.id === polygon.material);
    const tileset = material?.texture?.tileset;
    if (!tileset) return;
    const asset = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults).source(tileset);
    const texels = ([u,v])=>[u*(asset.width-1),v*(asset.height-1)];
    const uvSet = MaterialUV.resolve(row.document.uvBindings,'pigment');
    const prior = A.tilesetEyedrop.sourceBinding(row,polygon.id);
    const outline = polygon.corners.map(corner=>texels(MaterialUV.uv(corner,uvSet)));
    const original = A.tilesetEyedrop.recover(asset,tileset,outline,prior);
    const {x,y} = original.selection;
    return {asset,tileset,texels,uvSet,prior,outline,original,size:[asset.width,asset.height],origin:[x,y]};
  }

  function decorate(scene, row, plan, source) {
    const {face,cut,grid,children} = plan.report.detail;
    const atlasSource = source ?? atlasFor(scene,row,row.document.faces.find(item=>item.id === face));
    if (!atlasSource) return {plan};
    const {asset,tileset,texels,uvSet,prior,outline,original,size} = atlasSource;
    const validSource = prior && original.sourceStatus === 'retained' && original.paint;
    const availableFaces = new Map((plan.document?.faces ?? []).map(item=>[item.id,item]));
    const cropRows = (children ?? []).flatMap(id=>{
      const child = availableFaces.get(id);
      if (!child) return [];
      const points = child.corners.map(corner=>texels(MaterialUV.uv(corner,uvSet)));
      const tight = A.tilesetEyedrop.recover(asset,tileset,points);
      const crop = validSource ? A.tilesetEyedrop.recover(asset,tileset,points,
        {...prior,data:{...prior.data,selection:tight.selection}}) : tight;
      return [{face:id,selection:crop.selection,uvInset:crop.uvInset,...(crop.paint && {paint:crop.paint})}];
    });
    const atlas = {tileset,size,units:'texel-centers',uvSet,
      source:original.selection,sourceStatus:original.sourceStatus,
      outline,...(cut && {line:cut.line.map(row=>texels(row.uv)),pick:texels(cut.pick.uv)}),
      ...(grid && {grid:grid.map(row=>row.map(node=>texels(node.uv)))}),children:cropRows};
    const sourceSplit = plan.report.canCommit && validSource && cropRows.length > 1 &&
      cropRows.length === children.length && cropRows.every(row=>row.paint) ?
      {prior,children:cropRows} : undefined;
    return {plan:freeze({...plan,report:{...plan.report,detail:{...plan.report.detail,atlas}}}),sourceSplit};
  }

  function install(bindings, split) {
    if (!split) return bindings;
    const {prior,children} = split, used = new Set(bindings.map(binding=>binding.id));
    return bindings.flatMap(binding=>{
      if (binding.id !== prior.id) return [binding];
      return children.map(({face:element,selection,paint})=>{
        const base = 'tileset/'+element;
        let id = element === prior.element ? prior.id : base;
        if (element !== prior.element) for (let n=2;used.has(id);n++) id = base+'/'+n;
        used.add(id);
        const data = {format:prior.data.format,version:prior.data.version,atlasSize:prior.data.atlasSize,selection,paint};
        return {id,domain:'faces',element,data};
      });
    });
  }

  A.tilesetPickedSplit = Object.freeze({atlasFor,decorate,install});
})(KIT);
