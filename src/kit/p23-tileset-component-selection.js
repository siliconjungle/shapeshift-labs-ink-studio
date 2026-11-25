/* Independent selection domains for tile modeling edits. */
(function (K) {
  const A = K.authoring, {freeze} = K.procedural.data;
  const domains = ['tiles','edges','vertices','instances'];
  const edits = freeze({inspect:domains,eyedrop:['tiles'],reskin:['tiles'],grow:['edges'],'tilt-plane':['edges'],
    'move-vertex':['vertices'],'mesh-transform':['tiles','edges','vertices'],'snap-origin':domains,
    stamp:[],place:[],stroke:[],rectangle:[],'brush-run':[],primitive:[]});
  const record = value=>value && Object.getPrototypeOf(value) === Object.prototype;

  function selectionDomains(edit='inspect', requested) {
    if (typeof edit !== 'string' || !Object.hasOwn(edits,edit)) throw new RangeError('Unknown tile selection edit '+String(edit));
    const supported = edits[edit];
    if (requested === undefined) return supported;
    if (!Array.isArray(requested) || !Array.from(requested).every(domain=>supported.includes(domain)))
      throw new RangeError('Enabled domains for '+edit+' must come from '+supported.join(', '));
    return freeze(supported.filter(domain=>requested.includes(domain)));
  }

  function selectMesh(row, domain, query, options) {
    const tiles = domain === 'tiles' ? new Map((row.bindings ?? []).filter(binding=>
      !binding.review && A.tilesetFaces.isSourceBinding(binding)).map(binding=>[binding.element,binding])) : null;
    const native = tiles ? 'faces' : domain;
    if (query.domain !== undefined && query.domain !== native)
      throw new TypeError('The topology query must use '+native+' for the '+domain+' domain');
    if (tiles && Array.isArray(query.ids)) for (const id of query.ids) {
      if (!tiles.has(id)) throw new RangeError('Face '+id+' has no retained tile source');
    }
    const seeds = tiles && query.ids === undefined && query.from === undefined ? {ids:[...tiles.keys()]} : {};
    const selection = K.meshTopology.select(row.document,{...query,...seeds,domain:native},options);
    if (selection.domain !== native) throw new RangeError('Use mesh-topology select to convert selection domains');
    if (!tiles) return {ids:selection.ids,selection};
    const ids = selection.ids.filter(id=>tiles.has(id));
    return {ids,selection:{...selection,ids},tiles:ids.map(face=>{
      const {id,data} = tiles.get(face);
      return {face,binding:id,selection:data.selection};
    })};
  }

  function select(scene, request = {}, {visibility} = {}) {
    if (!record(request) || Object.keys(request).some(key=>!['edit','enabledDomains','domain','object','part','query'].includes(key)))
      throw new TypeError('Use a tile component selection query');
    const {edit='inspect',domain,object,part,query={}} = request;
    const enabledDomains = selectionDomains(edit,request.enabledDomains);
    const report = {format:'ink-studio/tileset-component-selection',version:1,edit,enabledDomains};
    if (domain === undefined) {
      if ([object,part,request.query,visibility].some(value=>value !== undefined))
        throw new TypeError('Choose a selection domain before providing targets or a query');
      return freeze(report);
    }
    if (!enabledDomains.includes(domain))
      throw new RangeError('Domain '+domain+' is disabled for '+edit+'. Enabled domains: '+(enabledDomains.join(', ') || 'none'));
    if (!record(query)) throw new TypeError('A tile component query needs an object');
    if (domain === 'instances') {
      if ([object,part,visibility].some(value=>value !== undefined) || Object.keys(query).some(key=>!['kind','ids'].includes(key)))
        throw new TypeError('Select instances by kind and IDs without a mesh or visibility capture');
      const instances = A.sceneInstances.select(scene,query);
      return freeze({...report,domain,ids:instances.map(row=>row.instanceKind+':'+row.instance),instances});
    }
    if (!TargetSelectors.name(object) || part !== undefined && !TargetSelectors.name(part))
      throw new TypeError('Tile, edge, and vertex selections need an editable mesh object');
    const meshes = scene.topologyMeshes ?? {};
    const row = Object.hasOwn(meshes,object) && meshes[object];
    if (!row || part !== undefined && row.part !== part) throw new RangeError('No editable topology for scene object '+object);
    const options = {visibility,object,part:row.part};
    return freeze({...report,domain,object,...(row.part && {part:row.part}),...selectMesh(row,domain,query,options)});
  }

  A.tilesetComponentSelection = Object.freeze({select,selectionDomains});
})(KIT);
