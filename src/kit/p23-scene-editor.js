/* Headless editing over the diorama JSON used by the CLI. */
(function (K) {
  const A = K.authoring, DIO = K.diorama;
  const { clone, freeze } = K.procedural.data;
  const documents = new WeakMap();
  const modes = ['replace', 'add', 'toggle', 'remove'];
  const encodeSlot = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const stack = solid => Array.isArray(solid.modifiers) ? solid.modifiers : [];
  function patchFields(original, patch) {
    const result = { ...original };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete result[key];
      else result[key] = value;
    }
    return result;
  }

  function sceneIndex(scene, env) {
    const solids = scene.solids ?? [];
    const nodes = new Map(), byEntity = new Map(), roots = [], parts = new Map(), groups = new Map();
    function parent(kind, id, label = id) {
      const node = { key: kind + ':' + id, kind, name:label, children: [] };
      nodes.set(node.key, node);
      return node;
    }

    for (const name of new Set([...Object.keys(scene.parts ?? {}), ...solids.map(solid => solid.part).filter(Boolean)]))
      parts.set(name, parent('part', name, scene.parts?.[name]?.label));
    for (const [name, node] of parts) {
      const container = parts.get(scene.parts?.[name]?.parent);
      (container?.children ?? roots).push(node);
    }
    for (const name of Object.keys(scene.groups ?? {})) {
      const node = parent('group', name);
      groups.set(name, node);
      roots.push(node);
    }

    function solidNode(solid, path, address, operand, modifier) {
      const slot = 'slot:' + path.join('/');
      const key = solid.id === undefined ? address ? 'operand:' + address.join('/') : slot : 'solid:' + solid.id;
      const base = solid.id === undefined ? address : [encodeSlot(solid.id)];
      const descend = trail => base && [...base, ...trail];
      const operands = DIO.operandFields(solid).filter(field => record(solid[field]));
      const modifierOperands = stack(solid).filter(entry => typeof entry?.id === 'string' && record(entry.shape));
      const node = { key, kind: 'solid', shape: solid.kind, ...(operand && { operand }), ...(modifier && { modifier }),
        name: solid.label ?? solid.id ?? solid.kind, solid, children: [
          ...operands.map(field => solidNode(solid[field], [...path,field], descend([field]), field)),
          ...modifierOperands.map(({ id, shape }) => {
            const trail = ['modifiers',encodeSlot(id),'shape'];
            return solidNode(shape,[...path,...trail],descend(trail),'shape',id);
          })
        ] };
      nodes.set(key, node);
      if (solid.id === undefined && key !== slot) nodes.set(slot,node);
      if (solid.id !== undefined) byEntity.set(solid.id, key);
      return node;
    }
    const indexedNodes = solids.map((solid, i) => {
      const node = solidNode(solid, [i]);
      const owner = parts.get(solid.part) ?? groups.get(solid.group);
      (owner?.children ?? roots).push(node);
      return node;
    });
    const linked = A.scenePrefabs.expand(scene, env).instances;
    for (const [id, { instance, revision, solids }] of linked) {
      const node = Object.assign(parent('prefab', id), { instance, revision, solids });
      for (const name of solids) byEntity.set(name, node.key);
      roots.push(node);
    }
    for (const [id, mesh] of Object.entries(scene.topologyMeshes ?? {})) {
      roots.push(Object.assign(parent('mesh-topology', id, mesh.label), { mesh }));
      byEntity.set(id, 'mesh-topology:' + id);
    }
    const byStroke = new Map();
    if (scene.brushRegion) {
      const brushRegion = parent('brushRegion', 'Brush region');
      const strokes = scene.brushRegion.strokes;
      for (const stroke of Array.isArray(strokes) ? strokes : []) {
        if (typeof stroke?.id !== 'string') continue;
        const key = 'stroke:' + stroke.id;
        const node = { key, kind: 'stroke', name: stroke.id, stroke, children: [] };
        nodes.set(key, node);
        byStroke.set('brush-stroke:' + stroke.id, key);
        brushRegion.children.push(node);
      }
      roots.push(brushRegion);
    }
    const tree = freeze({ key: 'scene:' + scene.id, kind: 'scene', name: scene.name ?? scene.id, children: roots });
    nodes.set(tree.key, tree);

    // A preview tag identifies anonymous geometry without replacing its render ownership.
    const usedTags = new Set([...nodes.values()].flatMap(node => node.solid?.tags ?? []));
    const byTag = new Map(), preview = { ...scene, solids: solids.map((solid, i) => {
      if (solid.id !== undefined) return solid;
      let tag = '@editor/' + i;
      while (usedTags.has(tag)) tag += '_';
      usedTags.add(tag);
      byTag.set(tag, indexedNodes[i].key);
      return { ...solid, tags: [...(solid.tags ?? []), tag] };
    }) };
    return { tree, nodes, byEntity, byTag, byStroke, preview: freeze(preview) };
  }

  function create(source, { env, historyLimit } = {}) {
    const input = typeof source === 'string' ? JSON.parse(source) : source;
    if (A.projectBundles && input?.format === A.projectBundles.format)
      return A.projectBundles.open(input).editor({ env, historyLimit });
    const baked = input?.data instanceof Float32Array;
    if (baked && !input.spec) throw new TypeError('This splat bake has no retained diorama source');
    const scene = clone(baked ? input.spec : input);
    const buildEnv = { ...env, brushSession: A.brushRegions.create(), bakeCache: env?.bakeCache ?? A.bakeCache.create() };
    function validate(candidate, bindings = buildEnv) {
      const problems = DIO.check(candidate, bindings);
      if (problems.some(problem => problem.level === 'error')) {
        const error = new Error(DIO.report(problems));
        error.problems = problems;
        throw error;
      }
    }
    validate(scene);
    const document = A.document({ format: A.data.format, version: A.data.version, id: scene.id,
      seed: 1, nextId: 1, entities: {}, styles: {}, environment: scene }, { historyLimit });
    const snapshot = () => document.snapshot().environment;
    document.beforeCommit(() => validate(snapshot()));

    let selection = freeze([]), indexScene, index, previewWorld, cachedPick;
    function current() {
      const scene = snapshot();
      if (scene !== indexScene || !index) {
        indexScene = scene;
        index = sceneIndex(scene, buildEnv);
        previewWorld = cachedPick = undefined;
      }
      return index;
    }
    function keys(value, solidsOnly = false) {
      const requested = typeof value === 'string' ? [value] : value;
      const kinds = solidsOnly ? ['solid'] : ['solid', 'stroke', 'prefab', 'mesh-topology'];
      if (!Array.isArray(requested) || Array.from(requested).some(key => !kinds.includes(current().nodes.get(key)?.kind)))
        throw new RangeError(solidsOnly ? 'Edits need keys of solids in the scene tree' :
          'Selection needs keys of solids, prefab instances, mesh topology, or brush strokes in the scene tree');
      return [...new Set(requested)];
    }

    function selectedKeys() {
      const { nodes } = current();
      return freeze(selection.filter(key => ['solid', 'stroke', 'prefab', 'mesh-topology'].includes(nodes.get(key)?.kind)));
    }

    function select(requested, { mode = 'replace' } = {}) {
      if (!modes.includes(mode)) throw new RangeError('Selection mode must be replace, add, toggle or remove');
      const next = new Set(mode === 'replace' ? [] : selectedKeys());
      for (const key of keys(requested)) {
        if (mode === 'remove' || mode === 'toggle' && next.has(key)) next.delete(key);
        else next.add(key);
      }
      selection = freeze([...next]);
      return selection;
    }

    function edit(label, targets, update) {
      const selected = new Set(keys(targets, true).map(key => current().nodes.get(key).solid));
      if (!selected.size) return false;
      function rewrite(solid) {
        let next = solid;
        for (const field of DIO.operandFields(solid)) {
          if (!record(solid[field])) continue;
          const child = rewrite(solid[field]);
          if (child !== solid[field]) next = { ...next, [field]: child };
        }
        const modifiers = stack(solid).map(entry => {
          if (!record(entry?.shape)) return entry;
          const shape = rewrite(entry.shape);
          return shape === entry.shape ? entry : { ...entry, shape };
        });
        if (modifiers.some((entry, i) => entry !== solid.modifiers[i])) next = { ...next, modifiers };
        return selected.has(solid) ? update(next) : next;
      }
      const write = () => document.setEnvironment({ solids: (snapshot().solids ?? []).map(rewrite) });
      if (document.pending()) write();
      else document.transact(label, write);
      return true;
    }

    function setTransform(patch, targets = selectedKeys()) {
      const values = clone(patch);
      if (!values || typeof values !== 'object' || Array.isArray(values))
        throw new TypeError('A transform edit needs an object');
      if (!Object.keys(values).length) return false;
      return edit('Transform solids', targets, solid => ({ ...solid, transform: { ...solid.transform, ...values } }));
    }
    function updateShape(patch, targets = selectedKeys()) {
      const fields = clone(patch);
      if (!record(fields)) throw new TypeError('A shape edit needs an object');
      return edit('Edit shape', targets, solid => {
        const { need, may } = DIO.kinds[solid.kind];
        for (const field of Object.keys(fields)) {
          if (!Object.hasOwn(need, field) && !Object.hasOwn(may ?? {}, field))
            throw new RangeError('Unknown ' + solid.kind + ' shape parameter: ' + field);
        }
        return patchFields(solid, fields);
      });
    }

    function setModifiers(modifiers, targets = selectedKeys()) {
      const list = clone(modifiers);
      if (!Array.isArray(list)) throw new TypeError('Modifiers must be an ordered list');
      return edit('Set sculpt modifiers', targets, solid =>
        list.length ? { ...solid, modifiers: list } : patchFields(solid, { modifiers: null }));
    }

    function updateModifier(id, patch, targets = selectedKeys()) {
      const fields = clone(patch);
      if (!TargetSelectors.name(id) || !record(fields) || Object.hasOwn(fields, 'id') || Object.hasOwn(fields, 'kind'))
        throw new TypeError('A modifier edit needs an ID and parameter fields');
      return edit('Edit sculpt modifier', targets, solid => {
        const modifiers = stack(solid);
        if (!modifiers.some(entry => entry?.id === id)) throw new RangeError('Unknown modifier: ' + id);
        return { ...solid, modifiers: modifiers.map(entry => entry?.id === id ? patchFields(entry, fields) : entry) };
      });
    }

    function setMaterial(material, targets = selectedKeys()) {
      const value = clone(material);
      return edit('Set solid material', targets, solid => ({ ...solid, mat: value }));
    }
    function paintDiffuse(label, field, mark, { layer = 'diffuse', keys = selectedKeys() }) {
      if (!TargetSelectors.name(layer)) throw new TypeError('A shadow band needs a diffuse layer name');
      return edit(label, keys, solid => {
        const mat = solid.mat, finish = mat?.surface, layers = finish?.layers;
        const diffuse = layers && Object.hasOwn(layers, layer) && layers[layer];
        if (diffuse?.type !== 'diffuse')
          throw new RangeError('Add a named diffuse lighting ramp to the solid material before painting');
        const strokes = [...(diffuse[field]?.strokes ?? []), mark];
        if (strokes.length > 256) throw new RangeError('A painted diffuse layer supports up to 256 strokes');
        return { ...solid, mat: { ...mat, surface: { ...finish, layers: {
          ...layers, [layer]: { ...diffuse, [field]: { strokes } }
        } } } };
      });
    }
    function paintShadowBand(stroke, options = {}) {
      const mark = SurfaceLook.shadowBandPaint.stroke(stroke), name = options.pbrMaterial;
      if (name === undefined) return paintDiffuse('Paint a shadow band', 'shadowBand', mark, options);
      const finish = snapshot().finish, look = finish?.look, recipe = look?.pbrMaterials;
      const material = recipe?.materials && Object.hasOwn(recipe.materials,name) && recipe.materials[name];
      if (!material) throw new RangeError('Unknown PBR material: ' + name);
      const strokes = [...(material.shadowBand?.strokes ?? []),mark];
      if (strokes.length > 256) throw new RangeError('A painted PBR ramp supports up to 256 strokes');
      const materials = { ...recipe.materials, [name]: { ...material, shadowBand:{strokes} } };
      const write = () => document.setEnvironment({finish:{...finish,look:{...look,pbrMaterials:{...recipe,materials}}}});
      if (document.pending()) write();
      else document.transact('Paint a PBR shadow band',write);
      return true;
    }
    function paintShadeNormal(stroke, options = {}) {
      return paintDiffuse('Paint a shade normal', 'shadeNormals', SurfaceLook.shadowBandPaint.normals.stroke(stroke), options);
    }
    function setSurfaceState(state, targets = selectedKeys()) {
      const value = clone(state);
      return edit('Set rest surface state', targets, solid => patchFields(solid, { surfaceState: value }));
    }
    function setSdfPaint(paint, targets = selectedKeys()) {
      const value = clone(paint);
      return edit('Paint SDF material', targets, solid => patchFields(solid, { sdfPaint:value }));
    }
    function setSdfProtection(protection, targets = selectedKeys()) {
      const value = clone(protection);
      K.procedural.sdfProtection.check(value);
      return edit('Set SDF feature protection', targets, solid => patchFields(solid, { sdfProtection:value }));
    }
    function editSurfaceDecal(id, operation) {
      const decals = K.surfaceDecals.edit(snapshot().surfaceDecals, id, operation);
      const write = () => document.setEnvironment({ surfaceDecals:decals });
      if (document.pending()) write();
      else document.transact('Edit surface decal ' + id, write);
      return snapshot();
    }
    function setRole(name, ramp) {
      if (!TargetSelectors.name(name)) throw new TypeError('A material role needs a name');
      const indices = clone(ramp);
      if (!Array.isArray(indices) || !indices.length) throw new TypeError('A material role needs a nonempty palette ramp');
      const write = () => document.setEnvironment({ roles: { [name]: indices } });
      if (document.pending()) write();
      else document.transact('Edit material role ' + name, write);
    }

    const build = (inputs = buildEnv.parameterInputs, {
      retainRenderSdf = buildEnv.retainRenderSdf, retainPartRenderSdf = buildEnv.retainPartRenderSdf
    } = {}) => Object.assign(DIO.build(current().preview, {
      ...buildEnv, parameterInputs:inputs,retainRenderSdf,retainPartRenderSdf
    }), { spec:snapshot() });

    function refreshPrefabs(prefabs, { assets = buildEnv.assets } = {}) {
      const bindings = { ...buildEnv, assets, prefabs: freeze(clone(prefabs)) };
      validate(snapshot(), bindings);
      Object.assign(buildEnv, bindings, { brushSession: A.brushRegions.create() });
      indexScene = undefined;
      document.checkpointSession();
    }

    function setPrefabInstance(id, instance) {
      if (!K.world.data.id(id)) throw new TypeError('A prefab placement needs an instance ID');
      const value = clone(instance);
      const instances = { ...snapshot().instances };
      if (value === null) delete instances[id];
      else instances[id] = value;
      const write = () => {
        document.setEnvironment({ instances: null });
        document.setEnvironment({ instances });
      };
      if (document.pending()) document.batchSession(write);
      else document.transact('Edit prefab instance ' + id, write);
    }

    function meshTopology(object, part) {
      const meshes = snapshot().topologyMeshes ?? {};
      const mesh = Object.hasOwn(meshes, object) ? meshes[object] : null;
      if (!mesh || part !== undefined && mesh.part !== part)
        throw new RangeError('No editable topology for scene object ' + object + (part === undefined ? '' : '/' + part));
      return mesh;
    }

    function editMeshTopology(object, patch, { part, projection, label } = {}) {
      const before = meshTopology(object, part);
      const { row, ...evidence } = A.meshTopologyScene.revise(before, patch, { projection });
      function write() {
        const next = { topologyMeshes: { ...snapshot().topologyMeshes, [object]: row } };
        validate({ ...snapshot(), ...next });
        document.setEnvironment(next);
        return freeze(evidence);
      }
      return document.pending() ? write() : document.transact(label ?? 'Edit topology of ' + object, write);
    }

    function setBrushRegion(region) {
      const value = clone(region);
      const write = () => document.setEnvironment({ brushRegion: value });
      if (document.pending()) write();
      else document.transact('Select brush region', write);
    }

    function setBreakables(definitions) {
      const value = clone(definitions);
      function write() {
        document.setEnvironment({ breakables: null });
        if (value !== null) document.setEnvironment({ breakables: value });
        document.preview();
        return (previewWorld = build());
      }
      if (!document.pending()) return document.transact('Set breakable groups', write);
      return document.batchSession(() => {
        try {
          return write();
        } catch (error) {
          document.cancel();
          throw error;
        }
      });
    }

    function applyBrush(stroke) {
      const value = clone(stroke);
      const region = snapshot().brushRegion;
      if (!region) throw new Error('Select a brush region before applying a stroke');
      function edit() {
        document.setEnvironment({ brushRegion: { strokes: [...(region.strokes ?? []), value] } });
        document.preview();
        const world = build();
        previewWorld = world;
        return world;
      }
      if (!document.pending()) return document.transact('Brush ' + (value?.mode ?? 'edit'), edit);
      try {
        return edit();
      } catch (error) {
        document.cancel();
        throw error;
      }
    }

    function pick(ray, { world, time, reconstruction, sampleWithdrawal } = {}) {
      const { byEntity, byTag, byStroke } = current();
      const rendered = world ?? (previewWorld ??= build());
      const at = time ?? rendered.lookSnapshot?.time ?? 0;
      // A caller-owned world can be animated or edited in place between picks.
      if (world || !cachedPick || cachedPick.time !== at || cachedPick.reconstruction !== reconstruction ||
          cachedPick.sampleWithdrawal !== sampleWithdrawal) {
        const posed = K.reconstruction.frame(rendered, at, reconstruction ?? rendered.look?.reconstruction);
        const query = K.procedural.contributions.create(posed, { time: at, sampleWithdrawal });
        cachedPick = { time: at, reconstruction, sampleWithdrawal, query };
      }
      const result = cachedPick.query.ray(ray);
      if (world) cachedPick = undefined;
      for (const hit of [result.dominant, ...result.contributions]) {
        const target = hit?.target;
        const tag = target?.tags?.find(tag => byTag.has(tag));
        const stroke = target?.surface === 'brush-region' ? byStroke.get(target.entity) : undefined;
        const key = stroke ?? (tag ? byTag.get(tag) : byEntity.get(target?.entity ?? target?.object));
        if (key) return { key, hit };
      }
      return null;
    }

    const editor = Object.freeze({
      snapshot,
      serialize: (space = 2) => JSON.stringify(snapshot(), null, space),
      fork: (source = snapshot()) => create(source,{ env:buildEnv, historyLimit:0 }),
      sourceDependencies: () => A.bakeCache.signature([
        buildEnv.assets ?? {},buildEnv.prefabs ?? {},buildEnv.parameterInputs ?? {}
      ]),
      tree: () => current().tree,
      node: key => current().nodes.get(key),
      selection: selectedKeys,
      select,
      pick,
      suggestBreakable({ world, ...options } = {}) {
        current();
        return A.breakables.suggest(world ?? (previewWorld ??= build()), options);
      },
      selectRay(ray, { mode = 'replace', ...options } = {}) {
        const result = pick(ray, options);
        select(result ? [result.key] : [], { mode });
        return result;
      },
      setTransform,
      updateShape,
      setModifiers,
      updateModifier,
      setPrefabInstance,
      refreshPrefabs,
      meshTopology,
      editMeshTopology,
      setBrushRegion,
      setBreakables,
      applyBrush,
      setMaterial,
      paintShadowBand,
      paintShadeNormal,
      setSurfaceState,
      setSdfPaint,
      setSdfProtection,
      editSurfaceDecal,
      setRole,
      materials: () => freeze(clone(DIO.sceneMaterials(snapshot()))),
      build,
      buildIncremental(previousWorld, inputs) {
        const world = build(inputs);
        return { world, frame: A.bakeCache.frameDiff(previousWorld, world) };
      },
      cacheStats: () => buildEnv.bakeCache.stats(),
      begin: label => { document.begin(label); },
      preview() { document.preview(); return snapshot(); },
      commit: () => document.commit(),
      cancel: () => document.cancel(),
      undo: () => document.undo(),
      redo: () => document.redo(),
      history: () => document.history(),
      revision: () => document.revision(),
      onChange(listener) {
        if (typeof listener !== 'function') throw new TypeError('Scene change listener must be a function');
        return document.onChange(({ type, label, revision }) => listener({ type, label, revision, snapshot: snapshot() }));
      }
    });
    documents.set(editor,{ document, validate });
    return editor;
  }

  A.sceneEditor = Object.freeze({
    create,
    transactionDocument: editor => documents.get(editor)?.document,
    validateSnapshot: (editor,snapshot) => documents.get(editor).validate(snapshot)
  });
})(KIT);
