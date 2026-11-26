/* Resolve authored instance identities shared by selection and construction guides. */
(function (K) {
  const A = K.authoring;

  function select(scene, {kind,ids,layer,includeHidden} = {}) {
    let placements;
    const sources = [
      ['prefab',scene.instances ?? {},(_,id) => {
        placements ??= A.scenePrefabs.placements(scene.instances);
        const entry = scene.instances[id], origin = entry.mirror ? scene.instances[entry.mirror.source] : entry;
        return A.scenePrefabs.placedOrigin(origin,placements.get(id));
      }],
      ['asset-part',scene.assetParts ?? {},transform=>K.sceneGraph.transform(transform).position]
    ];
    if (kind !== undefined && !sources.some(([type])=>type === kind))
      throw new TypeError('Choose prefab or asset-part instances');
    if (ids !== undefined && (!Array.isArray(ids) || !Array.from(ids).every(TargetSelectors.name)))
      throw new TypeError('Instance IDs need an array of names');
    if (includeHidden !== undefined && typeof includeHidden !== 'boolean')
      throw new TypeError('Include hidden must be a boolean');
    if (layer !== undefined && kind === 'asset-part')
      throw new TypeError('Scene layers select visual prefab placements');
    const layout = layer !== undefined || includeHidden === false ? A.sceneLayers.prepare(scene) : undefined;
    const scope = layer === undefined ? null : new Set(layout.branch(layer,{includeHidden}));
    const enabled = sources.filter(([type])=>scope ? type === 'prefab' : kind === undefined || kind === type);
    function target([instanceKind,rows,origin], instance) {
      return {instance,instanceKind,target:origin(rows[instance].transform,instance)};
    }
    const allowed = ([type],id) => type !== 'prefab' || (scope ? scope.has(id) : includeHidden !== false || layout.isVisible(id));
    if (ids === undefined) return enabled.flatMap(source=>Object.keys(source[1]).sort()
      .filter(id=>allowed(source,id)).map(id=>target(source,id)));
    return [...new Set(ids)].sort().flatMap(instance=>{
      const matches = enabled.filter(([,rows])=>Object.hasOwn(rows,instance));
      if (!matches.length) throw new RangeError('Unknown scene instance '+instance);
      if (matches.length>1) throw new RangeError('Instance '+instance+' is ambiguous. Choose prefab or asset-part');
      return allowed(matches[0],instance) ? [target(matches[0],instance)] : [];
    });
  }

  function prefabSelection(scene, request) {
    const {id} = K.world.data;
    const saved = request.selection;
    if (saved !== undefined && (request.instances !== undefined ||
        saved?.format !== 'ink-studio/tileset-component-selection' || saved.version !== 1 || saved.domain !== 'instances' ||
        !Array.isArray(saved.instances) || !Array.from(saved.instances).every(row => row?.instanceKind === 'prefab' && id(row.instance))))
      throw new TypeError('Choose a saved prefab instance selection or an explicit list of instances');
    const ids = saved === undefined ? request.instances : saved.instances.map(row => row.instance);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 512 || !Array.from(ids).every(id) || new Set(ids).size !== ids.length)
      throw new TypeError('Select 1–512 distinct prefab instance IDs');
    return select(scene,{kind:'prefab',ids});
  }

  function assetSocket(scene, env, instance, binding) {
    if (!Object.hasOwn(scene.assetParts ?? {}, instance)) return;
    const bindings = env?.assetPartImports?.[instance]?.part?.bindings ?? {};
    const row = Object.hasOwn(bindings, binding) && bindings[binding];
    if (row?.kind === 'socket' && row.status === 'bound') return row.resolved.position;
  }

  function anchor(scene, env, { instance, instanceKind, anchor }) {
    const row = select(scene, { kind: instanceKind, ids: [instance] })[0];
    if (anchor === undefined) return row;
    const target = row.instanceKind === 'asset-part' ? assetSocket(scene, env, instance, anchor) :
      A.objectPoints.resolve(scene,env,{kind:'object-point',instance,id:anchor}).target;
    if (!target) throw new RangeError('No bound instance socket ' + instance + '/' + anchor);
    return { ...row, target };
  }

  A.sceneInstances = Object.freeze({select,prefabSelection,assetSocket,anchor});
})(KIT);
