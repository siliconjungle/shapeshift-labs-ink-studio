/* Retained mesh geometry and its source-dependent records share a scene snapshot. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology;
  const elementKinds = ['faces', 'edges', 'corners'];
  const record = row => row && Object.getPrototypeOf(row) === Object.prototype;
  const fields = (row, keys) => record(row) && Object.keys(row).every(key => keys.includes(key));
  const name = value => typeof value === 'string' && !!value.trim();
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const sorted = ids => [...new Set(ids)].sort();

  function index(rows, label) {
    if (!Array.isArray(rows)) throw new TypeError(label + ' must be an array');
    const map = new Map();
    for (const row of rows) {
      if (!record(row) || !name(row.id) || map.has(row.id)) throw new RangeError(label + ' need distinct nonempty IDs');
      map.set(row.id, row);
    }
    return map;
  }

  function elements(document, frame) {
    if (!document) return Object.fromEntries(['vertices', ...elementKinds].map(kind => [kind, new Map()]));
    const vertices = index(document.vertices, 'Vertices');
    const point = id => frame ? K.sceneGraph.point(frame, vertices.get(id).position) : vertices.get(id).position;
    const corners = new Map(), faces = new Map(), edges = new Map();
    for (const face of document.faces) {
      for (const corner of face.corners)
        corners.set(corner.id, { ...corner, face: face.id, position: point(corner.vertex) });
      faces.set(face.id, { ...face, positions: face.corners.map(corner => point(corner.vertex)) });
    }
    for (const edge of topology.inspect(document).edges) edges.set(edge.id, { ...edge, positions: edge.vertices.map(point) });
    return { vertices, faces, edges, corners };
  }

  function byteMap(value, label) {
    if (!Array.isArray(value) || !Array.from(value).every(n => Number.isInteger(n) && n >= 0 && n <= 255))
      throw new RangeError(label + ' needs JSON bytes');
    return Uint8Array.from(value);
  }

  function material(input, tilesets) {
    const value = { ...input };
    const shared = tilesets.resolve(value.texture);
    if (shared) value.texture = shared;
    else if (value.texture !== undefined) {
      if (!record(value.texture)) throw new TypeError('A mesh texture needs a JSON descriptor');
      value.texture = { ...value.texture };
      for (const channel of ['pixels', 'indices', 'coverage']) if (value.texture[channel] !== undefined)
        value.texture[channel] = byteMap(value.texture[channel], 'Mesh texture ' + channel);
    }
    for (const channel of ['normal', 'emission', 'roughness', 'metalness']) {
      if (value[channel] !== undefined && (['normal', 'emission'].includes(channel) || typeof value[channel] !== 'number'))
        value[channel] = byteMap(value[channel], 'Mesh material ' + channel);
    }
    return value;
  }

  function prepareRow(object, row, evaluation, tilesets, frame) {
    if (!TargetSelectors.name(object) || !fields(row, ['document', 'part', 'label', 'materials', 'bindings', 'bakes', 'modifiers', 'attachments', 'shapeKeys', 'pivot']) ||
        (row.part !== undefined && !TargetSelectors.name(row.part)) || (row.label !== undefined && !name(row.label)))
      throw new TypeError('An editable scene mesh needs an object ID, document, and optional named part');
    if (row.pivot !== undefined && !meshPivot.xyz(row.pivot))
      throw new TypeError('An editable mesh pivot needs a finite local XYZ point');
    const cage = topology.create(row.document), document = evaluation?.document ?? cage;
    if (!document.faces.length) throw new RangeError('An editable scene mesh needs at least one polygon');
    const records = elements(cage), bindings = index(row.bindings ?? [], 'Mesh bindings');
    for (const binding of bindings.values()) {
      if (!fields(binding, ['id', 'domain', 'element', 'data', 'review']) || !elementKinds.includes(binding.domain) ||
          !name(binding.element) || binding.review === undefined && !records[binding.domain].has(binding.element) ||
          binding.review !== undefined && (!fields(binding.review, ['reason', 'candidates']) ||
            !name(binding.review.reason) || !Array.isArray(binding.review.candidates) ||
            !Array.from(binding.review.candidates).every(name)))
        throw new RangeError('Invalid element binding ' + binding.id + ' on ' + object);
    }
    const bakes = index(row.bakes ?? [], 'Mesh bakes');
    const declared = index(row.materials ?? [], 'Mesh materials');
    const active = new Map(document.faces.map(face => [face.material, declared.get(face.material) ?? { id: face.material }]));
    const used = new Set();
    for (const bake of bakes.values()) {
      if (!fields(bake, ['id', 'material', 'maps', 'artifact', 'invalidated']) || !name(bake.material) ||
          used.has(bake.material) || !fields(bake.maps, ['texture', 'normal', 'emission', 'emissionStrength', 'roughness', 'metalness', 'mipmaps']) ||
          !Object.keys(bake.maps).length ||
          bake.invalidated !== undefined && (!fields(bake.invalidated, ['faces']) || !Array.isArray(bake.invalidated.faces) ||
            !bake.invalidated.faces.length || !Array.from(bake.invalidated.faces).every(name)))
        throw new RangeError('Invalid material bake ' + bake.id + ' on ' + object);
      used.add(bake.material);
      if (!bake.invalidated && active.has(bake.material)) {
        const { sampling, ...base } = active.get(bake.material);
        active.set(bake.material, { ...base, ...bake.maps, sampling: bake.maps.mipmaps ? undefined : sampling });
      }
    }
    const mesh = topology.toSceneMesh(document, { objectId: object, partId: row.part, meshId: 'topology/' + object, frame,
      materials: [...active.values()].map(input => material(input, tilesets)) });
    const moved = document !== cage && bindings.size ?
      remapBindings([...bindings.values()], topology.correspond(cage, document, { lineage: evaluation.lineage })) : [...bindings.values()];
    const visible = bindings.size && (frame || document !== cage) ? elements(document, frame) : records;
    const resolvedBindings = Object.fromEntries(moved.filter(binding => !binding.review)
      .map(binding => [binding.id, { ...binding, geometry: visible[binding.domain].get(binding.element) }]));
    const skin = document.skin && K.meshTopology.skin.bind(mesh);
    const manifest=row.attachments;
    if (manifest && (!record(manifest) || manifest.format!=='ink-studio/mesh-attachments' || manifest.version!==1 ||
        manifest.mesh!==cage.id || !name(manifest.revision) || !Array.isArray(manifest.attachments)))
      throw new TypeError('An editable mesh needs a version 1 attachment manifest');
    const attachmentBinding=manifest && manifest.revision===topology.revision(document) && topology.attachments.bind(mesh,manifest);
    const attachmentStatus=manifest && (attachmentBinding ? 'ready' : 'needs-transfer');
    const shapeKeyStatus=row.shapeKeys!==undefined && K.meshTopology.shapeKeys.status(document,row.shapeKeys);
    const shapeKeys=shapeKeyStatus==='ready' && K.meshTopology.shapeKeys.bind(mesh,row.shapeKeys,frame);
    return { mesh, document, bindings: moved, resolvedBindings, bakes: [...bakes.values()], ...(skin && {skin}),
      ...(shapeKeyStatus && {shapeKeyStatus}), ...(shapeKeys && {shapeKeys}),
      ...(attachmentStatus && {attachmentStatus}), ...(attachmentBinding && {attachments:attachmentBinding}),
      ...(evaluation && { cage, modifierReport: evaluation.report }) };
  }

  function evaluator(rows, placements) {
    const known = new Map(Object.entries(rows)), visited = new Set(), cache = new Map();
    function evaluate(id, through, diagnostics = false) {
      if (!diagnostics && through === undefined && cache.has(id)) return cache.get(id);
      if (visited.has(id)) throw new RangeError('Mesh modifier projection cycle at ' + [...visited, id].join(' → '));
      const row = known.get(id);
      if (!row) throw new RangeError('Unknown editable mesh ' + id);
      visited.add(id);
      try {
        const plan = topology.evaluateModifiers(row.document, row.modifiers ?? [], { through, diagnostics,
          target(targetId) {
            const target = known.has(targetId) && evaluate(targetId);
            if (target) requireComplete(target);
            const source = target?.document, from = placements?.get(targetId), to = placements?.get(id);
            if (!source || from === to) return source;
            const world = K.sceneGraph.transform(from), local = K.sceneGraph.inverse(K.sceneGraph.transform(to));
            const frame = K.sceneGraph.compose(local, world);
            return topology.edit(source, { vertices: source.vertices.map(vertex => ({
              ...vertex, position: K.sceneGraph.point(frame, vertex.position)
            })) });
          } });
        if (!diagnostics && through === undefined) cache.set(id, plan);
        if (!diagnostics || !row.bakes?.length) return plan;
        const stages = plan.report.stages.map((stage,index) => {
          const {before,after} = plan.captures[index];
          if (before===after || stage.status!=='evaluated') return stage;
          const original = {...row,document:before,bindings:undefined,
            bakes:row.bakes.map(({invalidated,...bake})=>bake)};
          const {bakes} = transition(original,before,after);
          const work = bakes.filter(item=>item.after?.status==='invalidated').map(({id,after})=>
            ({kind:'rebake',status:'required',sourceIds:after.faces,counts:{bakes:1},bake:id}));
          return work.length ? {...stage,work} : stage;
        });
        return K.procedural.data.freeze({...plan,report:{...plan.report,stages}});
      } finally {
        visited.delete(id);
      }
    }
    return evaluate;
  }

  function requireComplete(plan) {
    if (!plan.report.canApply) {
      const last = plan.report.stages.at(-1);
      throw Object.assign(new RangeError('Mesh modifier ' + last.id + ': ' + last.message), { report: plan.report });
    }
    return plan;
  }

  function prepare(rows, tilesets = A.tilesets.prepare(), placements) {
    if (rows === undefined) return [];
    if (!record(rows) || Object.keys(rows).length > 32) throw new TypeError('Scene topologyMeshes needs a map of up to 32 editable meshes');
    const evaluate = evaluator(rows, placements);
    return Object.entries(rows).map(([object, row]) => [object,
      prepareRow(object, row, row?.modifiers === undefined ? undefined : requireComplete(evaluate(object)), tilesets, placements?.get(object))]);
  }

  function mount(world, prepared) {
    if (!prepared?.length) return;
    const meshes = [...(world.meshes ?? [])], ids = new Set(meshes.map(mesh => mesh.id));
    const objects = new Set([...(world.renderMetadata?.objects ?? []), ...meshes.map(mesh => mesh.objectId)]);
    for (const [object, row] of prepared) {
      if (ids.has(row.mesh.id) || objects.has(object))
        throw new RangeError('Editable mesh ' + object + ' collides with an existing scene mesh or object');
      ids.add(row.mesh.id);
      objects.add(object);
      meshes.push(row.mesh);
    }
    K.sceneMeshes.list({ meshes }, true);
    world.meshes = meshes;
    world.topologyMeshes = Object.fromEntries(prepared);
  }

  function recordsChanged(before, after) {
    const result = [];
    for (const id of sorted([...before.keys(), ...after.keys()])) {
      const left = before.get(id) ?? null, right = after.get(id) ?? null;
      if (!same(left, right)) result.push({ id, before: left, after: right });
    }
    return result;
  }

  function geometricRecord(row, kind, uvSet = 0) {
    if (!row) return row;
    if (kind === 'edges') {
      const { smooth, crease, uvSeam, uvSeams, ...geometry } = row;
      return geometry;
    }
    if (kind === 'corners') {
      const { normal, uvPinned, uvPins, attributes, ...geometry } = row;
      const retained=attributes && Object.fromEntries(Object.entries(attributes).filter(([key])=>!MaterialUV.isKey(key)));
      return {...geometry,uv:MaterialUV.uv(row,uvSet),...(retained && Object.keys(retained).length && {attributes:retained})};
    }
    return kind === 'faces' ? { ...row, corners: row.corners.map(corner => geometricRecord(corner,'corners',uvSet)) } : row;
  }

  function bakeState(bake) {
    if (!bake) return null;
    return { id: bake.id, material: bake.material, status: bake.invalidated ? 'invalidated' : 'ready',
      ...(bake.invalidated && { faces: bake.invalidated.faces }), ...(bake.artifact !== undefined && { artifact: bake.artifact }) };
  }

  function diff(before, after) {
    const left = elements(before && topology.create(before.document)), right = elements(after && topology.create(after.document));
    const changes = Object.fromEntries(['vertices', ...elementKinds].map(kind => [kind, recordsChanged(left[kind], right[kind])]));
    const oldBindings = index(before?.bindings ?? [], 'Mesh bindings'), newBindings = index(after?.bindings ?? [], 'Mesh bindings');
    changes.bindings = recordsChanged(oldBindings, newBindings).map(row => ({ ...row,
      change: row.after?.review ? 'needs-review' : row.before?.element !== row.after?.element ? 'rebound' : 'updated' }));
    for (const [id, binding] of oldBindings) {
      if (binding.review || !same(binding, newBindings.get(id))) continue;
      const prior = left[binding.domain].get(binding.element), next = right[binding.domain].get(binding.element);
      if (!same(geometricRecord(prior, binding.domain), geometricRecord(next, binding.domain))) changes.bindings.push({ id, change: 'displaced', before: binding, after: binding,
        geometry: { before: prior ?? null, after: next ?? null } });
    }
    const oldBakes = (before?.bakes ?? []).map(bakeState), newBakes = (after?.bakes ?? []).map(bakeState);
    changes.bakes = recordsChanged(index(oldBakes, 'Mesh bakes'), index(newBakes, 'Mesh bakes'));
    if (before?.shapeKeys || after?.shapeKeys)
      changes.shapeKeys=recordsChanged(index(before?.shapeKeys?.keys??[],'Mesh shape keys'),
        index(after?.shapeKeys?.keys??[],'Mesh shape keys'));
    if (before?.attachments || after?.attachments)
      changes.attachments=recordsChanged(index(before?.attachments?.attachments??[],'Mesh attachments'),
        index(after?.attachments?.attachments??[],'Mesh attachments'));
    return changes;
  }

  function remapBindings(bindings, correspondence) {
    const groups = Object.fromEntries(elementKinds.map(kind =>
      [kind, new Map(correspondence.domains[kind].groups.flatMap(group => group.from.map(id => [id, group])))]));
    return bindings.map(binding => {
      if (binding.review) return binding;
      const group = groups[binding.domain].get(binding.element);
      const links = group.links.filter(link => link.from === binding.element);
      if (links.length === 1 && links[0].confidence === 1) return { ...binding, element: links[0].to };
      const unresolved = correspondence.domains[binding.domain].unresolved?.find(row => row.side === 'from' && row.id === binding.element);
      const candidates = links.length ? links.map(link => link.to) : unresolved?.candidates.map(row => row.id) ?? [];
      return { ...binding, review: { reason: links.length > 1 ? 'split' : links.length ? 'projected' : group.status,
        candidates: sorted(candidates) } };
    });
  }

  function transition(row, before, document, correspondence) {
    const updated = { ...row, document };
    if (row.bindings) {
      const remapped = remapBindings(row.bindings,correspondence);
      if (row.bindings.some(binding=>binding.data?.uvCorners)) {
        const left = new Map(before.faces.map(face=>[face.id,face])), right = new Map(document.faces.map(face=>[face.id,face]));
        updated.bindings = remapped.map((binding,i)=>{
          if (binding.review || !binding.data?.uvCorners) return binding;
          const first = left.get(row.bindings[i].element), last = right.get(binding.element);
          const slots = first && A.tilesetFaces.sourceCorners(binding,first.corners.length);
          if (!slots || slots.length !== 3 || last?.corners.length !== slots.length) return binding;
          const byCorner = new Map(first.corners.map(({id},i)=>[id,slots[i]]));
          const uvCorners = last.corners.map(({id})=>byCorner.get(id));
          return uvCorners.every(slot=>slot !== undefined) && uvCorners.some((slot,i)=>slot !== slots[i]) ?
            {...binding,data:{...binding.data,uvCorners}} : binding;
        });
      } else updated.bindings = remapped;
    }
    if (row.bakes) {
      const dirty = new Map(), oldSet=MaterialUV.resolve(before.uvBindings,'pigment'),
        newSet=MaterialUV.resolve(document.uvBindings,'pigment');
      const left=elements(before).faces, right=elements(document).faces;
      const changes=oldSet===newSet ? recordsChanged(left,right) : sorted([...left.keys(),...right.keys()])
        .map(id=>({id,before:left.get(id),after:right.get(id)}));
      for (const { id, before: old, after: next } of changes) {
        if (oldSet===newSet && same(geometricRecord(old,'faces',oldSet),geometricRecord(next,'faces',newSet))) continue;
        for (const material of new Set([old?.material, next?.material])) {
          if (!dirty.has(material)) dirty.set(material, []);
          dirty.get(material).push(id);
        }
      }
      updated.bakes = row.bakes.map(bake => !dirty.has(bake.material) ? bake : { ...bake,
        invalidated: { faces: sorted([...(bake.invalidated?.faces ?? []), ...dirty.get(bake.material)]) } });
    }
    return { row: updated, correspondence, ...diff(row, updated) };
  }

  function revise(row, patch, { projection } = {}) {
    const before = topology.create(row.document);
    const { document, correspondence } = topology.editWithCorrespondence(before, patch, { projection });
    return transition(row, before, document, correspondence);
  }

  function applyModifiers(row, plan) {
    requireComplete(plan);
    const before = topology.create(row.document);
    const correspondence = topology.correspond(before, plan.document, { lineage: plan.lineage });
    const result = transition(row, before, plan.document, correspondence);
    result.row.modifiers = plan.remaining;
    return result;
  }

  function transferAttachments(row, patch, settings, projection) {
    const before=topology.create(row.document);
    const {document,correspondence}=topology.editWithCorrespondence(before,patch,{projection});
    const plan=topology.transferAttachments(before,document,correspondence,{attachments:row.attachments,...settings});
    const updated=transition(row,before,plan.document,correspondence).row;
    if (row.attachments || settings?.attachments) updated.attachments=plan.attachments;
    return {row:updated, correspondence, report:plan.report, changes:diff(row,updated)};
  }

  A.meshTopologyScene = Object.freeze({ prepare, mount, diff, revise, evaluator, applyModifiers, transferAttachments });
})(KIT);
