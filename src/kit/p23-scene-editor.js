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
      const node = Object.assign(parent('mesh-topology', id, mesh.label), { mesh });
      for (const modifier of mesh.modifiers ?? []) {
        const key = 'mesh-modifier:' + id + '/' + modifier.id;
        const stage = { key, kind: 'mesh-modifier', name: modifier.id, modifier, children: [] };
        node.children.push(stage);
        nodes.set(key, stage);
      }
      roots.push(node);
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

    function preparePrefabRefresh(prefabs, assets) {
      const bindings = { ...buildEnv, assets, prefabs: freeze(clone(prefabs)) };
      const source = snapshot();
      let instances = [], error;
      try {
        instances = A.scenePrefabs.review(source, buildEnv.prefabs, bindings.prefabs);
        validate(source, bindings);
      } catch (failure) {
        error = failure;
      }
      const problems = error?.problems ?? (error ? [{level: 'error', problem: error.message}] : []);
      return {bindings, error, report: freeze({ok: !error && instances.every(row => row.ok), instances, problems})};
    }

    function planPrefabRefresh(prefabs, { assets = buildEnv.assets } = {}) {
      return preparePrefabRefresh(prefabs, assets).report;
    }

    function refreshPrefabs(prefabs, { assets = buildEnv.assets } = {}) {
      const {bindings, error, report} = preparePrefabRefresh(prefabs, assets);
      if (!report.ok)
        throw Object.assign(error ?? new Error('Procedural prefab identities need review'), {report});
      Object.assign(buildEnv, bindings, { brushSession: A.brushRegions.create() });
      indexScene = undefined;
      document.checkpointSession();
      return report;
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

    function storeTileset(before, next, id, label) {
      const result = next.tilesets[id];
      if (next === before) return result;
      const write = () => {
        document.setEnvironment({tilesets:{[id]:result}});
        return result;
      };
      return document.pending() ? write() : document.transact(label,write);
    }

    function registerTileset(id,source) {
      const before = snapshot();
      return storeTileset(before,A.tilesets.register(before,id,source),id,'Register tileset '+id);
    }

    function extractTileset(sourceId,targetId,rectangle) {
      const before = snapshot();
      return storeTileset(before,A.tilesets.extract(before,sourceId,targetId,rectangle),targetId,'Extract tileset '+targetId);
    }

    function tilesetGrid(id) {
      const {tilesets,tilesetDefaults} = snapshot();
      return A.tilesets.prepare(tilesets,tilesetDefaults).grid(id);
    }

    function setTilesetGrid(id, size) {
      const {patch,grid} = A.tilesets.gridPatch(snapshot(),id,size);
      const write = () => {
        document.setEnvironment(patch);
        return grid;
      };
      return document.pending() ? write() : document.transact('Set tile grid'+(id ? ' for '+id : ' defaults'),write);
    }

    function setTilesetTexelsPerUnit(texelsPerUnit) {
      const patch = A.tilesets.scalePatch(snapshot(),texelsPerUnit);
      const write = () => {
        document.setEnvironment(patch);
        return patch.tilesetDefaults.texelsPerUnit;
      };
      return document.pending() ? write() : document.transact('Set tileset texels per unit',write);
    }

    function stageTilesetCanvas(id,operation) {
      const before = snapshot(), {asset,meshes,report} = A.tilesetCanvas.plan(before,id,operation);
      if (!asset) return {report};
      const patch = {tilesets:{[id]:asset},...(Object.keys(meshes).length && {topologyMeshes:meshes})};
      const candidate = {...before,tilesets:{...before.tilesets,[id]:asset},
        ...(patch.topologyMeshes && {topologyMeshes:{...before.topologyMeshes,...meshes}})};
      const problems = DIO.check(candidate,buildEnv).filter(problem=>problem.level === 'error');
      return problems.length ? {report:freeze({...report,canCommit:false,problems})} : {patch,report};
    }

    function planTilesetCanvas(id,operation) {
      return stageTilesetCanvas(id,operation).report;
    }

    function transformTilesetCanvas(id,operation) {
      const {patch,report} = stageTilesetCanvas(id,operation);
      if (!report.canCommit)
        throw Object.assign(new RangeError('Tileset edit needs reference or tile grid review'),{report});
      if (!patch) return report;
      const write = () => document.batchSession(() => {
        // Replace the raster record in full so a promoted RGBA image drops its indexed fields.
        document.setEnvironment({tilesets:{[id]:null}});
        document.setEnvironment(patch);
        return report;
      });
      return document.pending() ? write() : document.transact((operation.type === 'swap' ? 'Swap atlas regions in ' : 'Edit tileset canvas ')+id,write);
    }

    function tilesetDependencies(id) {
      return A.tilesetRevisions.dependencies(snapshot(),id,buildEnv.prefabs);
    }

    function stageTilesetRevision(request, links) {
      const before = snapshot(), {patch,report} = A.tilesetRevisions.plan(before,request,buildEnv.prefabs);
      if (!patch) return {report};
      if (links) patch.tilesetSources = {...before.tilesetSources,...links};
      const problems = DIO.check({...before,...patch},buildEnv).filter(problem=>problem.level === 'error');
      return problems.length ? {report:freeze({...report,canCommit:false,problems})} : {patch,report};
    }

    function planTilesetRevision(request) {
      return stageTilesetRevision(request).report;
    }

    function editTilesetRevision(request) {
      const {patch,report} = stageTilesetRevision(request);
      if (!report.canCommit) throw Object.assign(new RangeError('Tileset revision needs review'),{report});
      return commitTilesetRevision(patch,report,'Revise tilesets');
    }

    function commitTilesetRevision(patch,report,label) {
      const write = () => document.batchSession(() => {
        document.setEnvironment({tilesets:null,...(patch.tilesetSources && {tilesetSources:null})});
        document.setEnvironment(patch);
        return report;
      });
      return document.pending() ? write() : document.transact(label,write);
    }

    function planTilesetSource(id,asset,source) {
      return stageTilesetRevision({type:'replace',id,asset},{[id]:source}).report;
    }

    function updateTilesetSource(id,asset,source) {
      const {patch,report} = stageTilesetRevision({type:'replace',id,asset},{[id]:source});
      if (!report.canCommit) throw Object.assign(new RangeError('Tileset source needs review'),{report});
      return commitTilesetRevision(patch,report,'Reload tileset '+id);
    }

    function constructionPlane() {
      return A.constructionPlane.forScene(snapshot()).plane;
    }

    function setConstructionPlane(changes) {
      if (!changes || Object.getPrototypeOf(changes) !== Object.prototype)
        throw new TypeError('Construction plane changes need a record');
      const scene = snapshot(), plane = A.constructionPlane;
      let before;
      try {
        before = plane.forScene(scene).plane;
      } catch (error) {
        if (error.code !== 'construction-edge-unavailable' || changes.edgeAnchor === undefined) throw error;
        before = plane.resolve(scene.constructionPlane).plane;
      }
      if (before.edgeAnchor && changes.edgeAnchor === undefined &&
          ['origin','right','up'].some(key=>changes[key] !== undefined))
        throw new RangeError('Detach the edge anchor before editing the explicit frame');
      const requested = {...before,...(changes.edgeAnchor && {lock:null}),...changes};
      const next = plane.forScene({...scene,constructionPlane:requested}).plane;
      const write = () => document.batchSession(() => {
        // A complete plane replacement also removes an explicitly cleared lock.
        document.setEnvironment({constructionPlane:null});
        document.setEnvironment({constructionPlane:next});
        return next;
      });
      return document.pending() ? write() : document.transact('Set construction plane',write);
    }

    function planConstructionOrigin(request, options) {
      return A.constructionPlane.snapOrigin(snapshot(),request,options);
    }

    function snapConstructionOrigin(request, options) {
      const result = planConstructionOrigin(request,options);
      setConstructionPlane({...result.plane,edgeAnchor:result.plane.edgeAnchor ?? null});
      return result;
    }

    function stageTilesetFace(request, options) {
      const before = snapshot(), {row,report} = A.tilesetFaces.plan(before,request,options);
      if (!row) return {report};
      const patch = {topologyMeshes:{...before.topologyMeshes,[report.object]:row}};
      const problems = DIO.check({...before,...patch},buildEnv).filter(problem=>problem.level === 'error');
      return problems.length ? {report:freeze({...report,canCommit:false,problems})} : {patch,report};
    }

    function planTilesetFace(request, options) {
      return stageTilesetFace(request,options).report;
    }

    function placeTilesetFace(request, options) {
      const {patch,report} = stageTilesetFace(request,options);
      if (!report.canCommit) throw Object.assign(new RangeError('Tile face placement needs review'),{report});
      const write = () => {
        document.setEnvironment(patch);
        return report;
      };
      return document.pending() ? write() : document.transact('Place tile '+report.face,write);
    }

    function stageTilesetFaceEdit(plan, request, options) {
      const before = snapshot(), {row,remove,report} = plan(before,request,options);
      if (!row && !remove) return {report};
      const topologyMeshes = {...before.topologyMeshes};
      if (remove) delete topologyMeshes[report.object];
      else topologyMeshes[report.object] = row;
      const patch = {topologyMeshes};
      const problems = DIO.check({...before,...patch},buildEnv).filter(problem=>problem.level === 'error');
      return problems.length ? {report:freeze({...report,canCommit:false,problems})} : {patch,remove,report};
    }

    function planTilesetStroke(request, options) {
      return stageTilesetFaceEdit(A.tilesetStrokes.plan,request,options).report;
    }

    function planTilesetRectangle(request, options) {
      return stageTilesetFaceEdit(A.tilesetStrokes.planRectangle,request,options).report;
    }

    function commitTilesetFaceEdit(plan, request, options, name) {
      const {patch,remove,report} = stageTilesetFaceEdit(plan,request,options);
      if (!report.canCommit) throw Object.assign(new RangeError('Tile face '+name+' needs review'),{report});
      if (!patch) return report;
      const write = () => document.batchSession(() => {
        if (remove) document.setEnvironment({topologyMeshes:null});
        document.setEnvironment(patch);
        return report;
      });
      const label = report.mode[0].toUpperCase()+report.mode.slice(1)+' '+report.id;
      return document.pending() ? write() : document.transact(label,write);
    }

    function applyTilesetStroke(request, options) {
      return commitTilesetFaceEdit(A.tilesetStrokes.plan,request,options,'stroke');
    }

    function applyTilesetRectangle(request, options) {
      return commitTilesetFaceEdit(A.tilesetStrokes.planRectangle,request,options,'rectangle');
    }

    function meshTopology(object, part) {
      const meshes = snapshot().topologyMeshes ?? {};
      const mesh = Object.hasOwn(meshes, object) ? meshes[object] : null;
      if (!mesh || part !== undefined && mesh.part !== part)
        throw new RangeError('No editable topology for scene object ' + object + (part === undefined ? '' : '/' + part));
      return mesh;
    }

    function editMeshTopology(object, patch, { part, projection, label, materials } = {}) {
      const before = meshTopology(object, part);
      const { row, ...evidence } = A.meshTopologyScene.revise(before, patch, { projection });
      function write() {
        const next = { topologyMeshes: { ...snapshot().topologyMeshes, [object]: materials===undefined ? row : {...row,materials} } };
        validate({ ...snapshot(), ...next });
        document.setEnvironment(next);
        return freeze(evidence);
      }
      return document.pending() ? write() : document.transact(label ?? 'Edit topology of ' + object, write);
    }

    function planMeshAttachmentTransfer(object, patch, {part,projection, ...settings} = {}) {
      return A.meshTopologyScene.transferAttachments(meshTopology(object,part),patch,settings,projection);
    }

    function transferMeshAttachments(object, patch, options) {
      const {row,...plan}=planMeshAttachmentTransfer(object,patch,options);
      if (!plan.report.canCommit)
        throw Object.assign(new RangeError('Mesh attachment transfer needs review'),{report:plan.report});
      function write() {
        const next={topologyMeshes:{...snapshot().topologyMeshes,[object]:row}};
        validate({...snapshot(),...next});
        document.setEnvironment(next);
        return freeze(plan);
      }
      return document.pending() ? write() : document.transact('Transfer mesh attachments of '+object,write);
    }

    function requireMeshShapeOwner(object, part, scene, action) {
      const ownership = A.hybridOwnership, policy = scene.hybridOwnership;
      if (ownership.manages(policy, { object, part })) {
        const declaration = ownership.prepare(policy);
        const ownsShape = declaration.parts.some(({ owners }) => {
          const source = declaration.sources[owners.shape.source];
          return source.kind === 'mesh' && source.target.object === object && source.target.part === part;
        });
        if (!ownsShape) throw new RangeError(action + ' the authored hybrid shape source for ' + object);
      }
    }

    function meshSnapField(scene,id) {
      const solid=scene.solids.find(item=>item.id===id && !item.carve && !item.ghost);
      if (!solid) return;
      const {style,roles,palette,groups,parts,dataInputs}=scene;
      return DIO.brushField({id:scene.id,style,roles,palette,groups,parts,dataInputs,solids:[solid]},buildEnv).sdf;
    }

    function planMeshRetopology(object,request,{part}={}) {
      const row=meshTopology(object,part), scene=snapshot();
      requireMeshShapeOwner(object,row.part,scene,'Retopology');
      return K.meshTopology.planRetopology(row.document,request,{
        mesh:(id,part)=>meshTopology(id,part).document,
        sdf:id=>meshSnapField(scene,id)
      });
    }

    function retopologizeMeshTopology(object,request,options) {
      const plan=planMeshRetopology(object,request,options);
      if (!plan.report.canCommit)
        throw Object.assign(new RangeError('Retopology patch failed guide or surface checks'),{report:plan.report});
      return freeze({retopology:plan.report,topology:editMeshTopology(object,plan.patch,options)});
    }

    function planMeshTransform(object, request, { part } = {}) {
      if (request?.frame !== undefined)
        throw new TypeError('Retained scene mesh coordinates already use scene placement');
      const row = meshTopology(object, part), scene = current().preview;
      requireMeshShapeOwner(object, row.part, scene, 'Transform');
      return K.meshTopology.planTransform(row.document, request, {
        ...(request?.space === 'plane' || request?.snap?.kind === 'construction-plane' ?
          {constructionPlane:A.constructionPlane.forScene(scene).plane} : {}),
        mesh(id) {
          return { document: meshTopology(id).document };
        },
        socket(instance, binding) {
          const placements = scene.assetParts ?? {}, imports = buildEnv.assetPartImports ?? {};
          if (!Object.hasOwn(placements, instance) || !Object.hasOwn(imports, instance)) return;
          const bindings = imports[instance].part.bindings;
          const target = Object.hasOwn(bindings, binding) && bindings[binding];
          if (target?.kind === 'socket' && target.status === 'bound') return target.resolved.position;
        },
        sdf:id=>meshSnapField(scene,id)
      });
    }

    function transformMeshTopology(object, request, options) {
      const plan = planMeshTransform(object, request, options);
      return freeze({ transform: plan.report, ...(plan.patch.vertices.length && {
        topology: editMeshTopology(object, plan.patch, options)
      }) });
    }

    function planMeshRepair(object, request, { part } = {}) {
      const row = meshTopology(object, part);
      requireMeshShapeOwner(object, row.part, snapshot(), 'Repair');
      return K.meshTopology.planRepair(row.document, request);
    }

    function repairMeshTopology(object, request, options) {
      const plan = planMeshRepair(object, request, options);
      if (!plan.report.canCommit)
        throw Object.assign(new RangeError('Repair would create or worsen a non-manifold edge'), { report: plan.report });
      return freeze({ repair: plan.report, ...(Object.keys(plan.patch).length && {
        topology: editMeshTopology(object, plan.patch, options)
      }) });
    }

    function planMeshCut(object, request, { part } = {}) {
      const row = meshTopology(object, part);
      requireMeshShapeOwner(object, row.part, snapshot(), 'Cut');
      return K.meshTopology.planCut(row.document, request);
    }

    function cutMeshTopology(object, request, options) {
      const plan = planMeshCut(object, request, options);
      return freeze({ cut: plan.report, ...(Object.keys(plan.patch).length && {
        topology: editMeshTopology(object, plan.patch, options)
      }) });
    }

    function planMeshBoolean(object, request, { part } = {}) {
      const target=meshTopology(object,part);
      requireMeshShapeOwner(object,target.part,snapshot(),'Boolean edit');
      let operand=request?.operand, tool;
      if (operand?.object!==undefined) {
        if (Object.getPrototypeOf(operand)!==Object.prototype ||
            Object.keys(operand).some(key=>!['object','part','revision','selection'].includes(key)))
          throw new TypeError('Select a scene Boolean operand by object, part and topology revision');
        const {object:toolId,part:toolPart,...settings}=operand;
        tool=meshTopology(toolId,toolPart);
        operand=toolId===object ? settings : {...settings,document:tool.document};
      }
      const plan=K.meshTopology.planBoolean(target.document,{...request,operand});
      if (!plan.report.canCommit) return plan;
      const blocked=issue=>freeze({...plan,report:{...plan.report,canCommit:false,issues:[issue]}});
      if (plan.report.empty) return blocked({code:'empty-editable-scene-mesh'});
      if (!tool || tool===target) return plan;
      const authored=new Map((target.materials ?? []).map(row=>[row.id,row]));
      const supplied=new Map((tool.materials ?? []).map(row=>[row.id,row]));
      const used=new Set(plan.report.faces.filter(row=>row.operand==='tool' && row.material!==request.cutMaterial).map(row=>row.material));
      let changed=false;
      for (const id of used) {
        const incoming=supplied.get(id);
        if (!incoming) continue;
        const current=authored.get(id);
        if (current && JSON.stringify(current)!==JSON.stringify(incoming))
          return blocked({code:'operand-material-conflict',material:id});
        if (!current) {
          authored.set(id,incoming);
          changed=true;
        }
      }
      return changed ? freeze({...plan,materials:[...authored.values()]}) : plan;
    }

    function booleanMeshTopology(object,request,options) {
      const plan=planMeshBoolean(object,request,options);
      if (!plan.report.canCommit)
        throw Object.assign(new RangeError('Mesh Boolean failed geometry or scene checks'),{report:plan.report});
      return freeze({boolean:plan.report,...(Object.keys(plan.patch).length && {
        topology:editMeshTopology(object,plan.patch,{...options,materials:plan.materials})
      })});
    }

    function planMeshFaceRegion(object, request, { part } = {}) {
      const row = meshTopology(object, part);
      requireMeshShapeOwner(object, row.part, snapshot(), 'Edit');
      return K.meshTopology.planFaceRegion(row.document, request);
    }

    function editMeshFaceRegion(object, request, options) {
      const plan = planMeshFaceRegion(object, request, options);
      if (!plan.report.canCommit)
        throw Object.assign(new RangeError('Face-region edit failed geometry or wall clearance checks'), { report: plan.report });
      return freeze({ faceRegion: plan.report, topology: editMeshTopology(object, plan.patch, options) });
    }

    function planMeshEdgeEdit(object, request, { part } = {}) {
      const row = meshTopology(object, part);
      requireMeshShapeOwner(object, row.part, snapshot(), 'Edit');
      return K.meshTopology.planEdgeEdit(row.document, request);
    }

    function editMeshEdges(object, request, options) {
      const plan = planMeshEdgeEdit(object, request, options);
      if (!plan.report.canCommit)
        throw Object.assign(new RangeError('Edge edit failed geometry checks'), { report: plan.report });
      return freeze({ edgeEdit: plan.report, ...(Object.keys(plan.patch).length && {
        topology: editMeshTopology(object, plan.patch, options)
      }) });
    }

    function planMeshBevel(object, request, { part } = {}) {
      const row = meshTopology(object, part);
      requireMeshShapeOwner(object, row.part, snapshot(), 'Bevel');
      const plan = K.meshTopology.planBevel(row.document, request);
      if (!row.bakes?.length || !request.protect || !plan.patch.faces?.length) return plan;
      const { faces = [], materials = [], paint = [] } = request.protect;
      const guarded = new Set([...faces, ...paint.map(row => row.face)]);
      const original = new Map(row.document.faces.map(face => [face.id, face.material]));
      const slots = new Set([...materials, ...[...guarded].map(id => original.get(id))]);
      const changed = new Set(plan.patch.faces.flatMap(face => [original.get(face.id), face.material]));
      const bakes = row.bakes.filter(bake => !bake.invalidated && slots.has(bake.material) && changed.has(bake.material))
        .map(bake => bake.id);
      return bakes.length ? freeze({ ...plan, report: { ...plan.report, canCommit: false,
        issues: [...plan.report.issues, { kind: 'protected-bake', bakes }] } }) : plan;
    }

    function bevelMeshTopology(object, request, options) {
      const plan = planMeshBevel(object, request, options);
      if (!plan.report.canCommit)
        throw Object.assign(new RangeError('Bevel failed geometry or protection checks'), { report: plan.report });
      return freeze({ bevel: plan.report, ...(Object.keys(plan.patch).length && {
        topology: editMeshTopology(object, plan.patch, options)
      }) });
    }

    function planMeshShading(object, request, { part } = {}) {
      return K.meshTopology.planShading(meshTopology(object, part).document, request);
    }

    function editMeshShading(object, request, options) {
      const plan = planMeshShading(object, request, options);
      return freeze({ shading: plan.report, ...(Object.keys(plan.patch).length && {
        topology: editMeshTopology(object, plan.patch, options)
      }) });
    }

    function planMeshShapeKeys(object, request, {part}={}) {
      const row=meshTopology(object,part);
      return K.meshTopology.shapeKeys.plan(row.document,request,{shapeKeys:row.shapeKeys});
    }

    function editMeshShapeKeys(object, request, options={}) {
      const plan=planMeshShapeKeys(object,request,options);
      if (plan.report.destination==='rest') {
        requireMeshShapeOwner(object,meshTopology(object,options.part).part,snapshot(),'Edit');
        return freeze({shape:plan.report,topology:editMeshTopology(object,plan.patch,
          {...options,label:'Edit rest shape of '+object})});
      }
      function write() {
        const before=meshTopology(object,options.part);
        const row={...before,shapeKeys:plan.shapeKeys};
        const next={topologyMeshes:{...snapshot().topologyMeshes,[object]:row}};
        validate({...snapshot(),...next});
        document.setEnvironment(next);
        return freeze({shape:plan.report,changes:A.meshTopologyScene.diff(before,row)});
      }
      return document.pending() ? write() : document.transact('Edit pose shape of '+object,write);
    }

    function planMeshSkin(object, request, { part } = {}) {
      return K.meshTopology.skin.plan(meshTopology(object, part).document, request);
    }

    function editMeshSkin(object, request, options) {
      const plan = planMeshSkin(object, request, options);
      if (!plan.report.canCommit)
        throw Object.assign(new RangeError('Skin weights exceed the locked influence budget'), { report: plan.report });
      return freeze({ skin: plan.report, ...(Object.keys(plan.patch).length && {
        topology: editMeshTopology(object, plan.patch, { label:'Edit skin weights of '+object, ...options })
      }) });
    }

    function planMeshUV(object, request, { part } = {}) {
      return K.meshTopology.uv.plan(meshTopology(object, part).document, request);
    }

    function editMeshUV(object, request, options) {
      const plan = planMeshUV(object, request, options);
      if (!plan.report.canCommit)
        throw Object.assign(new RangeError('UV edit failed its corner or seam constraints'), { report: plan.report });
      return freeze({ uv: plan.report, ...(Object.keys(plan.patch).length && {
        topology: editMeshTopology(object, plan.patch, { label: 'Edit UVs of ' + object, ...options })
      }) });
    }

    function inspectMeshModifiers(object, { through, part, diagnostics = false } = {}) {
      meshTopology(object, part);
      return A.meshTopologyScene.evaluator(snapshot().topologyMeshes)(object, through, diagnostics);
    }

    function writeMeshModifiers(object, row, label) {
      function write() {
        const next = { topologyMeshes: { ...snapshot().topologyMeshes, [object]: row } };
        validate({ ...snapshot(), ...next });
        document.setEnvironment(next);
      }
      if (document.pending()) write();
      else document.transact(label, write);
    }

    function setMeshModifiers(object, modifiers, { part } = {}) {
      const row = meshTopology(object, part);
      requireMeshShapeOwner(object, row.part, snapshot(), 'Edit mesh modifiers on');
      const stack = K.meshTopology.modifierStack(modifiers);
      writeMeshModifiers(object, { ...row, modifiers: stack }, 'Set mesh modifiers on ' + object);
      return inspectMeshModifiers(object).report;
    }

    function updateMeshModifier(object, id, fields, { part } = {}) {
      const row = meshTopology(object, part);
      return setMeshModifiers(object, K.meshTopology.updateModifier(row.modifiers ?? [], id, fields), { part });
    }

    function planApplyMeshModifiers(object, { through, part } = {}) {
      const row = meshTopology(object, part);
      requireMeshShapeOwner(object, row.part, snapshot(), 'Apply mesh modifiers to');
      const plan = inspectMeshModifiers(object, { through, part });
      if (!plan.report.canApply) return freeze({ report: plan.report, remaining: plan.remaining });
      const { row: after, ...topology } = A.meshTopologyScene.applyModifiers(row, plan);
      return freeze({ row: after, report: plan.report, topology });
    }

    function applyMeshModifiers(object, options) {
      const plan = planApplyMeshModifiers(object, options);
      if (!plan.report.canApply) throw Object.assign(new RangeError('Mesh modifier ' +
        plan.report.stages.at(-1).id + ': ' + plan.report.stages.at(-1).message), { report: plan.report });
      if (plan.report.stages.length) writeMeshModifiers(object, plan.row, 'Apply mesh modifiers on ' + object);
      return plan;
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
      planPrefabRefresh, refreshPrefabs,
      registerTileset,
      extractTileset,
      tilesetGrid,
      setTilesetGrid,
      setTilesetTexelsPerUnit,
      constructionPlane, setConstructionPlane, planConstructionOrigin, snapConstructionOrigin,
      planTilesetFace, placeTilesetFace, planTilesetStroke, applyTilesetStroke,
      planTilesetRectangle, applyTilesetRectangle,
      planTilesetCanvas,
      transformTilesetCanvas,
      tilesetDependencies, planTilesetRevision, editTilesetRevision,
      planTilesetSource, updateTilesetSource,
      meshTopology,
      selectMeshTopology: (object, request, { part, visibility } = {}) =>
        K.meshTopology.select(meshTopology(object, part).document, request, { visibility }),
      editMeshTopology,
      planMeshTransform,
      transformMeshTopology,
      meshHealth: (object, settings, { part } = {}) => K.meshTopology.health(meshTopology(object, part).document, settings),
      planMeshRepair,
      repairMeshTopology,
      planMeshCut,
      cutMeshTopology,
      planMeshRetopology,
      retopologizeMeshTopology,
      planMeshBoolean,
      booleanMeshTopology,
      planMeshFaceRegion,
      editMeshFaceRegion,
      planMeshEdgeEdit,
      editMeshEdges,
      planMeshBevel,
      bevelMeshTopology,
      planMeshShading,
      editMeshShading,
      planMeshSkin,
      editMeshSkin,
      planMeshShapeKeys,
      editMeshShapeKeys,
      planMeshAttachmentTransfer,
      transferMeshAttachments,
      planMeshUV,
      editMeshUV,
      inspectMeshModifiers,
      setMeshModifiers,
      updateMeshModifier,
      planApplyMeshModifiers,
      applyMeshModifiers,
      hybridRoute: address => A.hybridOwnership.route(snapshot().hybridOwnership, address),
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
