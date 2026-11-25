/* Resolve authored instance identities shared by selection and construction guides. */
(function (K) {
  const A = K.authoring;

  function select(scene, {kind,ids} = {}) {
    const sources = [
      ['prefab',scene.instances ?? {},A.scenePrefabs.origin],
      ['asset-part',scene.assetParts ?? {},transform=>K.sceneGraph.transform(transform).position]
    ];
    if (kind !== undefined && !sources.some(([type])=>type === kind))
      throw new TypeError('Choose prefab or asset-part instances');
    if (ids !== undefined && (!Array.isArray(ids) || !Array.from(ids).every(TargetSelectors.name)))
      throw new TypeError('Instance IDs need an array of names');
    const enabled = sources.filter(([type])=>kind === undefined || kind === type);
    function target([instanceKind,rows,origin], instance) {
      return {instance,instanceKind,target:origin(rows[instance].transform)};
    }
    if (ids === undefined) return enabled.flatMap(source=>Object.keys(source[1]).sort().map(id=>target(source,id)));
    return [...new Set(ids)].sort().map(instance=>{
      const matches = enabled.filter(([,rows])=>Object.hasOwn(rows,instance));
      if (!matches.length) throw new RangeError('Unknown scene instance '+instance);
      if (matches.length>1) throw new RangeError('Instance '+instance+' is ambiguous. Choose prefab or asset-part');
      return target(matches[0],instance);
    });
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
    const target = row.instanceKind === 'asset-part' && assetSocket(scene, env, instance, anchor);
    if (!target) throw new RangeError('No bound instance socket ' + instance + '/' + anchor);
    return { ...row, target };
  }

  A.sceneInstances = Object.freeze({select,assetSocket,anchor});
})(KIT);
