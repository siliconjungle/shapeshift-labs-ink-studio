/* Plan instance-local edits against an explicit set of authored faces. */
const prefabEditIsolation = (function (K) {
  const A = K.authoring, T = K.meshTopology, { freeze } = K.procedural.data;
  const format = 'ink-studio/prefab-edit-isolation';
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const order = ids => [...new Set(ids)].sort();

  function activeMeshes(link, requested) {
    if (requested !== undefined && (!record(requested) || !Object.keys(requested).length))
      throw new TypeError('Choose active faces by prefab mesh member');
    const members = requested === undefined ? [...link.meshes.keys()] : Object.keys(requested);
    return new Map(members.sort().map(member => {
      const entry = link.meshes.get(member);
      if (!entry) throw new RangeError('Unknown prefab mesh member ' + member);
      const input = requested?.[member], doc = T.create(entry.row.document);
      if (requested !== undefined && !Array.isArray(input) && !record(input))
        throw new TypeError('Each active member needs a face ID list or a saved face selection');
      const selection = requested === undefined ? T.select(doc, { domain: 'faces' }) : Array.isArray(input) ?
        T.select(doc, { domain: 'faces', ids: input }) : T.select(doc, { from: input, domain: 'faces' });
      if (!selection.ids.length) throw new RangeError('Choose at least one active face on ' + member);
      return [member, { ...entry, selection, active: new Set(selection.ids) }];
    }));
  }

  function changesOutside(before, after, changes, active) {
    const faces = new Set();
    for (const { id } of changes.faces) if (!active.has(id)) faces.add(id);
    const moved = new Set(changes.vertices.map(row => row.id)), used = new Set();
    for (const row of [before, after]) for (const face of row.document.faces) {
      for (const { vertex } of face.corners) if (moved.has(vertex)) {
        used.add(vertex);
        if (!active.has(face.id)) faces.add(face.id);
      }
    }
    for (const edge of changes.edges) for (const use of [...(edge.before?.uses ?? []), ...(edge.after?.uses ?? [])])
      if (!active.has(use.face)) faces.add(use.face);
    // Leaving a baked slot may preserve the bake. Invalidating a shared slot affects every remaining user.
    const invalidated = new Set(changes.bakes.filter(row => row.before?.status === 'ready' &&
      row.after?.status === 'invalidated').map(row => row.after.material));
    for (const face of after.document.faces) if (invalidated.has(face.material) && !active.has(face.id)) faces.add(face.id);
    const vertices = [...moved].filter(id => !used.has(id)).sort();
    return faces.size || vertices.length ? { reason: 'outside-active-faces', faces: order(faces), vertices } : null;
  }

  function revise(row, patch) {
    if (!fields(patch, ['vertices', 'faces', 'edges', 'removeVertices', 'removeFaces']))
      throw new TypeError('An isolated topology patch can edit vertices, edges and faces');
    return A.meshTopologyScene.revise(row, patch);
  }

  function plan(scene, env, request, requireShapeOwner, authoredCamera) {
    if (!fields(request, ['instance', 'revision', 'faces', 'hideSurroundings', 'edits']) ||
        !K.world.data.id(request.instance) ||
        request.revision !== undefined && (!Number.isSafeInteger(request.revision) || request.revision < 1))
      throw new TypeError('Choose a prefab instance and optional positive revision');
    const { instance, revision, hideSurroundings = false, edits = [] } = request;
    if (typeof hideSurroundings !== 'boolean' || !Array.isArray(edits) || edits.length > 256)
      throw new TypeError('Prefab isolation needs a boolean hideSurroundings and up to 256 ordered edits');
    const { spec, instances, meshPlacements } = A.scenePrefabs.expand(scene, env);
    const link = instances.get(instance);
    if (!link) throw new RangeError('Unknown visual prefab instance ' + instance);
    if (revision !== undefined && revision !== link.revision) throw new RangeError('Stale prefab isolation revision');
    const scope = activeMeshes(link, request.faces), overrides = { ...link.instance.meshOverrides };
    const report = { format, version: 1, scene: scene.id, instance, prefab: link.instance.prefab, revision: link.revision,
      hideSurroundings, objects: order([...link.solids, ...Array.from(link.meshes.values(), entry => entry.object)]),
      members: Array.from(scope, ([member, entry]) => ({ member, object: entry.object, selection: entry.selection })),
      edits: [], conflicts: [], canCommit: true };
    let camera;
    const targetMesh = object => {
      const staged = [...scope.values()].find(entry => entry.object === object);
      const mesh = staged?.row ?? (Object.hasOwn(spec.topologyMeshes, object) && spec.topologyMeshes[object]);
      return mesh && { document: mesh.document, frame: meshPlacements.get(object) };
    };
    for (const [index, edit] of edits.entries()) {
      const kinds = ['patch', 'transform', 'reskin', 'pivot', 'variant'];
      if (!fields(edit, ['member', ...kinds]) || !K.world.data.id(edit.member) ||
          kinds.filter(key => Object.hasOwn(edit, key)).length !== 1)
        throw new TypeError('Each isolated edit needs a mesh member and one patch, transform, reskin, pivot, or variant');
      const { member } = edit, kind = kinds.find(key => Object.hasOwn(edit, key));
      const target = scope.get(member);
      if (!target) {
        report.conflicts.push({ index, member, reason: 'outside-active-members' });
        break;
      }
      const row = target.row, doc = T.create(row.document), beforeRevision = T.revision(doc);
      let next = row, changes, evidence;
      const pickActive = () => T.select(doc, { domain: 'faces', ids: doc.faces.filter(face => target.active.has(face.id)).map(face => face.id) });
      if (kind === 'patch') ({ row: next, ...changes } = revise(row, edit.patch));
      if (kind === 'pivot') {
        const raw = edit.pivot;
        if (!record(raw) || Object.hasOwn(raw, 'frame')) throw new TypeError('An isolated pivot uses the prefab placement frame');
        const anchor = raw.target;
        const pivotTarget = anchor?.kind === 'center' && anchor.object === undefined && anchor.selection === undefined ?
          { ...anchor, selection: pickActive() } : anchor;
        evidence = T.planPivot(doc, { ...raw, target: pivotTarget, frame: link.frame }, {
          pivot: row.pivot, mesh: targetMesh, instance: target => A.sceneInstances.anchor(scene, env, target)
        });
        if (evidence.changed) {
          next = { ...row };
          if (evidence.after) next.pivot = evidence.after.local;
          else delete next.pivot;
        }
      }
      if (kind === 'transform') {
        const raw = edit.transform;
        if (!record(raw) || Object.hasOwn(raw, 'frame')) throw new TypeError('An isolated transform uses the prefab placement frame');
        requireShapeOwner(target.object, spec.topologyMeshes[target.object].part, scene, 'Transform');
        const selection = raw.selection ?? pickActive();
        const transformed = T.planTransform(doc, { ...raw, selection, frame: link.frame }, {
          object: target.object, pivot: row.pivot,
          ...(raw.constructionPlane === undefined && meshComponentSnap.usesConstructionPlane(raw) ?
            { constructionPlane: A.constructionPlane.forScene(scene).plane } : {}),
          ...(raw.space === 'camera' && raw.camera === undefined && { camera: camera ??= authoredCamera() }),
          mesh: targetMesh
        });
        if (transformed.report.canCommit === false) {
          report.conflicts.push({index,member,reason:'face-fold-needs-review',details:transformed.report.issues});
          break;
        }
        if (transformed.patch.vertices.length || transformed.patch.faces?.length)
          ({ row: next, ...changes } = revise(row, transformed.patch));
        evidence = transformed.report;
      }
      if (kind === 'reskin' || kind === 'variant') {
        const raw = edit[kind];
        if (!record(raw) || !TargetSelectors.name(raw.face) || Object.hasOwn(raw, 'object') || Object.hasOwn(raw, 'part'))
          throw new TypeError('An isolated paint edit uses the selected prefab member');
        if (!target.active.has(raw.face)) {
          report.conflicts.push({ index, member, reason: 'outside-active-faces', faces: [raw.face], vertices: [] });
          break;
        }
        const reskin = kind==='variant' ? A.tilesetReskin.variant : A.tilesetReskin.plan;
        const result = reskin({ ...scene, topologyMeshes: { [target.object]: row } },
          { ...raw, object: target.object });
        next = result.row;
        evidence = result.report;
        if (!evidence.canCommit) {
          report.conflicts.push({ index, member, reason: kind+'-needs-review', details: evidence.conflicts });
          break;
        }
        changes = evidence.changes;
      }
      if (!next.document.faces.length) {
        report.conflicts.push({ index, member, reason: 'empty-mesh-member' });
        break;
      }
      const conflict = changes && changesOutside(row, next, changes, target.active);
      if (conflict) {
        report.conflicts.push({ index, member, ...conflict });
        break;
      }
      if (!K.world.data.equal(row, next)) {
        target.row = next;
        overrides[member] = { revision: link.revision, base: target.base, mesh: next };
      }
      report.edits.push({ index, member, kind, beforeRevision, afterRevision: T.revision(next.document),
        changedFaces: (changes?.faces ?? []).map(row => row.id),
        ...(evidence && { evidence }) });
    }
    const canCommit = report.conflicts.length === 0;
    const changed = canCommit && !K.world.data.equal(link.instance.meshOverrides ?? {}, overrides);
    const value = changed ? { ...link.instance, meshOverrides: overrides } : link.instance;
    const draft = changed ? { ...scene, instances: { ...scene.instances, [instance]: value } } : scene;
    return { draft, instance: value, report: freeze({ ...report, canCommit, changed }) };
  }
  return Object.freeze({ plan });
})(KIT);
