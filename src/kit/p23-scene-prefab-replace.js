/* Replace selected linked placements using the visual prefab revision rebaser. */
(function (K) {
  const A = K.authoring, {freeze} = K.procedural.data;
  const {tables} = prefabSourceRebase;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (row,keys) => record(row) && Object.keys(row).every(key => keys.includes(key));

  function migration(raw, from, to) {
    const {id,own} = K.world.data;
    if (raw !== undefined && (!fields(raw,['revision','members','faces']) ||
        raw.revision !== undefined && raw.revision !== from.revision || raw.members !== undefined &&
        !fields(raw.members,tables) || raw.faces !== undefined && !record(raw.faces)))
      throw new RangeError('Invalid or stale prefab replacement migration');
    const members = raw?.members ?? {}, faces = raw?.faces ?? {};
    const member = (table,name) => own(members[table],name) ? members[table][name] : name;
    for (const [table,rows] of Object.entries(members)) {
      if (!record(rows) || !Object.entries(rows).every(([old,next]) => own(from[table],old) && id(next) && own(to[table],next)))
        throw new RangeError('Member migration needs existing source and destination rows in '+table);
      const resolved = Object.keys(from[table] ?? {}).map(name => member(table,name));
      if (new Set(resolved).size !== resolved.length) throw new RangeError('Ambiguous member migration in '+table);
    }
    for (const [name,rows] of Object.entries(faces)) {
      const left = from.topologyMeshes?.[name]?.document?.faces;
      const right = to.topologyMeshes?.[member('topologyMeshes',name)]?.document?.faces;
      if (!left || !right || !record(rows) || !Object.entries(rows).every(([a,b]) =>
          left.some(face => face.id === a) && right.some(face => face.id === b)) ||
          new Set(Object.values(rows)).size !== Object.values(rows).length)
        throw new RangeError('Face migration needs distinct face targets on a mapped mesh member');
    }
    return {member,face:(mesh,name) => own(faces[mesh],name) ? faces[mesh][name] : name};
  }

  function rebase(id, link, target, to, move) {
    const {selector} = K.world.data, from = link.definition, entry = link.instance;
    const renamed = Object.fromEntries(tables.map(table => [table,Object.fromEntries(
      Object.entries(from[table] ?? {}).map(([name,row]) => [move.member(table,name),row]))]));
    const rewrite = edit => {
      const [table,name,...keys] = selector(edit.path);
      const member = move.member(table,name);
      return member === name ? edit : {...edit,path:[table,member,...keys]};
    };
    // Attachment manifests have their own topology revision and transfer checks.
    const withoutAttachments = ({attachments,...row}) => row;
    const meshMerge = (...rows) => prefabSourceRebase.mergeMesh(...rows.map(withoutAttachments));
    const review = prefabSourceRebase.instance(id,{
      ...entry,prefab:to,
      ...(entry.overrides && {overrides:entry.overrides.map(rewrite)}),
      ...(entry.meshOverrides && {meshOverrides:Object.fromEntries(Object.entries(entry.meshOverrides)
        .map(([name,row]) => [move.member('topologyMeshes',name),row]))})
    },{...from,...renamed},target,{meshMerge});
    for (const evidence of review.report.overrides) {
      const original = selector(entry.overrides[evidence.index].path);
      if (original[1] !== evidence.path[1]) evidence.fromPath = [...original];
    }
    return review;
  }

  function plan(scene, env, request) {
    const {id,own} = K.world.data;
    const {to,revision,migrations={}} = request ?? {};
    if (!fields(request,['instances','selection','to','revision','migrations']) || !id(to) || !record(migrations) ||
        revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
      throw new TypeError('Choose a target prefab and optional revision, with selected prefab instances');
    const selected = A.sceneInstances.prefabSelection(scene,request);
    const target = own(scene.prefabs,to) ? scene.prefabs[to] : own(env.prefabs,to) ? env.prefabs[to] : undefined;
    if (!target) throw new RangeError('Unknown replacement visual prefab '+to);
    if (revision !== undefined && revision !== target.revision) throw new RangeError('Stale replacement prefab revision');

    const before = A.scenePrefabs.expand(scene,env), instances = {...scene.instances}, addresses = new Map(), moves = new Map();
    const report = {format:'ink-studio/prefab-replacement',version:1,scene:scene.id,
      to:{prefab:to,revision:target.revision},instances:[],anchors:[],conflicts:[],changed:false};
    const sources = new Set(selected.map(({instance}) => before.instances.get(instance).instance.prefab));
    if (Object.keys(migrations).some(name => !sources.has(name)))
      throw new RangeError('Prefab migrations must name selected source families');
    let invalid = false;
    for (const {instance,target:origin} of selected) {
      const link = before.instances.get(instance), from = link.instance.prefab;
      const move = migration(own(migrations,from) ? migrations[from] : undefined,link.definition,target);
      report.anchors.push({kind:'origin',instance,status:'retained',at:origin});
      if (from === to) {
        report.instances.push({instance,from:{prefab:from,revision:link.revision},status:'unchanged',
          transform:link.instance.transform ?? null,objects:[...link.solids,...[...link.meshes.values()].map(row=>row.object)]});
        continue;
      }
      moves.set(instance,move);
      const result = rebase(instance,link,target,to,move);
      const row = {...result.report,from:{prefab:from,revision:link.revision},transform:link.instance.transform ?? null,
        status:result.report.conflicts.length ? 'conflict' : 'replaced'};
      const oldObjects = [...link.solids,...[...link.meshes.values()].map(row => row.object)];
      row.objects = [...new Set([...oldObjects,...(row.objects ?? [])])].sort();
      report.instances.push(row);
      for (const conflict of row.conflicts) report.conflicts.push({instance,...conflict});
      invalid ||= Boolean(result.invalid);
      if (!result.entry) continue;
      instances[instance] = result.entry;
      for (const [table,names] of [['solids',Object.keys(link.resolved.solids)],['topologyMeshes',[...link.meshes.keys()]]]) {
        for (const name of names) {
          const object = instance+'.'+move.member(table,name);
          addresses.set(instance+'.'+name,{instance,object,
            part:part => part.startsWith(instance+'.') ? instance+'.'+move.member('parts',part.slice(instance.length+1)) : part,
            face:face => move.face(name,face)});
        }
      }
      row.meshMembers = [...link.meshes.keys()].map(name => ({from:name,to:move.member('topologyMeshes',name)}));
    }
    if (invalid) return {report:freeze({...report,canCommit:false})};
    let patch = {instances}, after;
    try {
      after = A.scenePrefabs.expand({...scene,...patch},env);
    } catch (error) {
      return {report:freeze({...report,canCommit:false,problems:error.problems ?? [{level:'error',problem:error.message}]})};
    }
    report.conflicts.push(...A.scenePrefabs.indexedTargets(scene,before,after,(instance,table,name) => [instance,moves.get(instance)?.member(table,name) ?? name]));
    for (const row of report.instances) for (const names of row.meshMembers ?? []) {
      const old = before.instances.get(row.instance).meshes.get(names.from);
      const targetLink = after.instances.get(row.instance);
      const next = targetLink.meshes.get(names.to), base = targetLink.resolved.topologyMeshes[names.to];
      if (!next) {
        if (old.row.attachments?.attachments.length)
          report.conflicts.push({instance:row.instance,member:names.from,reason:'attachment-member-removed'});
        continue;
      }
      let mesh = next.row;
      function carry(from,source) {
        if (!from.attachments?.attachments.length) return;
        try {
          const result = prefabReplacementAnchors.attachments(from,mesh);
          for (const evidence of result.evidence)
            report.anchors.push({kind:'mesh-attachment',instance:row.instance,member:names.to,source,...evidence});
          for (const issue of result.issues ?? [])
            report.conflicts.push({instance:row.instance,member:names.to,...issue});
          if (result.manifest) mesh = {...mesh,attachments:result.manifest};
        } catch (error) {
          report.conflicts.push({instance:row.instance,member:names.to,reason:'attachment-transfer-needs-review',detail:error.message});
        }
      }
      if (!mesh.attachments && base.attachments) carry(base,'target');
      carry(old.row,'source');
      if (mesh !== next.row) {
        const current = instances[row.instance];
        instances[row.instance] = {...current,meshOverrides:{...current.meshOverrides,
          [names.to]:{revision:target.revision,base:next.base,mesh}}};
      }
    }
    const decals = prefabReplacementAnchors.decals(scene,before,after,addresses);
    report.anchors.push(...decals.evidence);
    report.conflicts.push(...decals.conflicts);
    if (decals.document) patch = {...patch,surfaceDecals:decals.document};
    const conflicted = new Set(report.conflicts.map(row => row.instance));
    for (const row of report.instances) if (conflicted.has(row.instance)) row.status = 'conflict';
    report.changed = report.instances.some(row => row.status !== 'unchanged');
    return {patch,report:freeze({...report,canCommit:!report.conflicts.length})};
  }

  A.prefabReplacement = Object.freeze({plan});
})(KIT);
