/* Organize placed visual modules without changing their transform hierarchy. */
(function (K) {
  const A = K.authoring, {freeze} = K.procedural.data;
  const fields = (row,keys) => K.world.data.record(row) && Object.keys(row).every(key=>keys.includes(key));

  function prepare(scene) {
    const {id,own,record} = K.world.data;
    const state = scene.sceneLayers ?? {}, instances = scene.instances ?? {};
    const {layers={},members={},insertion} = state;
    if (scene.sceneLayers !== undefined && !fields(scene.sceneLayers,['layers','members','insertion']) ||
        !record(layers) || Object.keys(layers).length>256 || !record(members))
      throw new TypeError('Scene layers need a layer map and an optional placement membership map');
    const known = value => id(value) && own(layers,value);
    for (const [key,row] of Object.entries(layers)) {
      if (!id(key) || !fields(row,['parent','visible','label']) ||
          row.parent !== undefined && !known(row.parent) ||
          row.visible !== undefined && typeof row.visible !== 'boolean' ||
          row.label !== undefined && (typeof row.label !== 'string' || !row.label.trim() || row.label.length>160))
        throw new TypeError('Invalid scene layer '+key+' or its parent');
    }
    if (insertion !== undefined && !known(insertion)) throw new RangeError('Unknown insertion layer '+insertion);
    for (const [instance,layer] of Object.entries(members))
      if (!own(instances,instance) || layer !== null && !known(layer))
        throw new RangeError('Invalid layer membership for prefab instance '+instance);
    const branches = new Map(), visiting = new Set();
    function visit(key) {
      if (branches.has(key)) return branches.get(key);
      if (visiting.has(key)) throw new RangeError('Scene layer parent cycle at '+key);
      visiting.add(key);
      const row = layers[key], parent = row.parent === undefined ? null : visit(row.parent);
      const branch = {id:key,label:row.label ?? key,parent:row.parent ?? null,visible:row.visible !== false,
        effectiveVisible:row.visible !== false && (parent?.effectiveVisible ?? true),path:[...(parent?.path ?? []),key]};
      branches.set(key,branch);
      visiting.delete(key);
      return branch;
    }
    for (const key of Object.keys(layers)) visit(key);
    const placementLayers = new Map();
    if (Object.keys(members).length) for (const key of A.scenePrefabs.placements(instances).keys()) {
      const instance = instances[key], carrier = instance.parent ?? instance.mirror?.source;
      placementLayers.set(key,own(members,key) ? members[key] : placementLayers.get(carrier) ?? null);
    }
    const layerOf = instance => placementLayers.get(instance) ?? null;
    const isVisible = instance => branches.get(layerOf(instance))?.effectiveVisible ?? true;
    const branch = (layer,{includeHidden=true}={}) => {
      if (layer !== null && !known(layer)) throw new RangeError('Unknown scene layer '+layer);
      return Object.keys(instances).filter(key=> {
        const assigned = layerOf(key);
        return (includeHidden || isVisible(key)) &&
          (layer === null ? assigned === null : branches.get(assigned)?.path.includes(layer));
      }).sort();
    };
    return {branches,layerOf,isVisible,branch,insertion};
  }

  function reconcile(scene, instances, source) {
    const state = scene.sceneLayers;
    if (state === undefined) return {};
    const {own,equal} = K.world.data, members = Object.fromEntries(
      Object.entries(state.members ?? {}).filter(([id])=>own(instances,id)));
    const layer = state.insertion ?? (source === undefined ? undefined : prepare(scene).layerOf(source));
    if (layer !== undefined) for (const id of Object.keys(instances))
      if (!own(scene.instances,id)) members[id] = layer;
    return equal(members,state.members ?? {}) ? {} : {sceneLayers:{...state,members}};
  }

  function plan(scene, env, request = {}) {
    const {id,own,equal} = K.world.data;
    const {action='inspect',layer,parent,label,visible,from} = request ?? {};
    const scoped = layer !== undefined && ['inspect','center','set-origins'].includes(action);
    const options = {inspect:['layer','includeHidden'],set:['layer','parent','label','visible'],insertion:['layer'],
      move:['layer','from','instances','selection'],center:['layer','includeHidden','basis','detachEdge'],
      'set-origins':['layer','includeHidden','target']};
    if (!own(options,action) || !fields(request,['action',...options[action]]) ||
        ((action !== 'inspect' || scoped) && !(id(layer) || layer === null && action !== 'set')) ||
        (request.includeHidden !== undefined && (!scoped || typeof request.includeHidden !== 'boolean')))
      throw new TypeError('Inspect, organize, center, or set origins for a scene layer');
    const previous = prepare(scene), before = scene.sceneLayers ?? {}, conflicts = [];
    const next = {...before,layers:{...before.layers},members:{...before.members}};
    const report = {format:'ink-studio/scene-layers',version:1,scene:scene.id,action,
      ...(layer !== undefined && {layer}),conflicts,instances:[],changed:false,canCommit:false};
    function finish(patch) { return {patch,report:freeze(report)}; }
    if (action==='set') {
      const row = {...(own(next.layers,layer) ? next.layers[layer] : {}),
        ...(label !== undefined && {label}),...(visible !== undefined && {visible})};
      if (parent === null) delete row.parent;
      else if (parent !== undefined) row.parent = parent;
      next.layers[layer] = row;
    } else if ((action!=='inspect' || scoped) && layer !== null && !previous.branches.has(layer)) {
      conflicts.push({reason:'unknown-layer',layer});
      return finish();
    } else if (action==='insertion') {
      if (layer === null) delete next.insertion;
      else next.insertion = layer;
    } else if (action==='move') {
      if (from !== undefined && (request.instances !== undefined || request.selection !== undefined))
        throw new TypeError('Choose a source layer branch, explicit instance IDs, or a saved prefab selection');
      const population = from === undefined ? A.sceneInstances.prefabSelection(scene,request).map(row=>row.instance) : previous.branch(from);
      for (const key of population) next.members[key] = layer;
      report.moved = population.filter(key=>previous.layerOf(key)!==layer || !own(before.members,key));
    }
    let current;
    try {
      current = action==='inspect' ? previous : prepare({...scene,sceneLayers:next});
    } catch (error) {
      conflicts.push({reason:'invalid-layers',problem:error.message});
      return finish();
    }
    const expanded = A.scenePrefabs.expand(scene,env), {instances} = expanded;
    const population = scoped ? previous.branch(layer,{includeHidden:request.includeHidden}) : undefined;
    const scope = scoped ? new Set(population) : undefined;
    for (const [id,link] of instances) {
      if (scope && !scope.has(id)) continue;
      const beforeLayer = previous.layerOf(id), afterLayer = current.layerOf(id);
      const beforeVisible = previous.isVisible(id), afterVisible = current.isVisible(id);
      report.instances.push({instance:id,beforeLayer,layer:afterLayer,beforeVisible,visible:afterVisible,
        objects:[...link.solids,...Array.from(link.meshes.values(),row=>row.object)]});
    }
    report.layers = [...current.branches.values()];
    report.insertion = current.insertion ?? null;
    if (scoped) {
      report.includeHidden = request.includeHidden ?? true;
      report.measurement = A.sceneLayerFrames.measure(scene,env,expanded,population);
      if (action === 'inspect') {
        report.canCommit = true;
        return finish({});
      }
      const {patch,conflicts:problems=[],changed=false,...evidence} =
        A.sceneLayerFrames.plan(scene,env,request,expanded,report.measurement);
      Object.assign(report,evidence,{changed:changed && Boolean(patch),canCommit:Boolean(patch)});
      conflicts.push(...problems);
      return finish(patch);
    }
    report.changed = action!=='inspect' && !equal(next,{...before,layers:before.layers ?? {},members:before.members ?? {}});
    report.canCommit = true;
    return finish(report.changed ? {sceneLayers:next} : {});
  }

  function visibility(source, links) {
    if (source?.sceneLayers === undefined) return;
    const layers = prepare(source), solids=new Set(), meshes=new Set(), effects=new Set(), instances=new Set();
    for (const [id,link] of links) if (!layers.isVisible(id)) {
      instances.add(id);
      for (const key of link.solids) solids.add(key);
      for (const {object} of link.meshes.values()) meshes.add(object);
      for (const index of link.effectIndices) effects.add(index);
    }
    return instances.size ? {solids,meshes,effects,instances} : undefined;
  }

  function visibleBreakables(spec, authored) {
    const solids = new Set(), parts = new Set();
    for (const row of spec.solids) {
      if (row.id) solids.add(row.id);
      if (row.part) parts.add(row.part);
    }
    const groups = authored.groups.map(row=>({...row,parts:row.parts.filter(ref=>
      ref.startsWith('solid:') ? solids.has(ref.slice(6)) : ref.startsWith('part:') ? parts.has(ref.slice(5)) : true)}));
    if (groups.every((row,i)=>row.parts.length===authored.groups[i].parts.length)) return authored;
    const surviving = groups.filter(row=>row.parts.length), ids = new Set(surviving.map(row=>row.id));
    if (!surviving.length) return;
    const links = authored.links?.filter(link=>link.every(id=>ids.has(id)));
    return {...authored,groups:surviving,links};
  }

  A.sceneLayers = Object.freeze({prepare,plan,reconcile,visibility,visibleBreakables});
})(KIT);
