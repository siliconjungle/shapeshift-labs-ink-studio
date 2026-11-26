/* Replay path overrides and merge retained mesh snapshots against a new prefab baseline. */
const prefabSourceRebase = (function (K) {
  const A = K.authoring;
  const tables = ['solids','parts','groups','motion','effects','topologyMeshes'];
  const tableView = definition => Object.fromEntries(tables.map(table => [table,definition[table] ?? {}]));
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;

  function keyed(rows) {
    return Array.isArray(rows) && rows.every(row => record(row) && typeof row.id === 'string') &&
      new Set(rows.map(row => row.id)).size === rows.length;
  }

  function mergeMesh(base, source, local) {
    const {equal} = K.world.data, conflicts = [], merged = [];
    function visit(before,next,value,path) {
      if (equal(next,before)) return value;
      if (equal(value,before) || equal(value,next)) {
        merged.push(path);
        return next;
      }
      if ([before,next,value].every(record)) {
        const keys = [...new Set([...Object.keys(next),...Object.keys(value),...Object.keys(before)])];
        return Object.fromEntries(keys.map(key => [key,visit(before[key],next[key],value[key],[...path,key])])
          .filter(([,item]) => item !== undefined));
      }
      if ([before,next,value].every(keyed)) {
        const [old,source,local] = [before,next,value].map(list => new Map(list.map(row => [row.id,row])));
        const [a,b,c] = [old,source,local].map(rows => [...rows.keys()]);
        const reordered = equal(a,c) || equal(b,c);
        if (!reordered && !equal(a,b)) conflicts.push({path,reason:'incompatible-element-order',before:a,source:b,local:c});
        const ids = [...new Set([...(reordered ? b : c),...b,...c])];
        return ids.map(id => visit(old.get(id),source.get(id),local.get(id),[...path,id])).filter(row => row !== undefined);
      }
      conflicts.push({path,reason:'overlapping-mesh-edit',before:before ?? null,source:next ?? null,local:value ?? null});
      return value;
    }
    const normalized = row => ({...row,document:K.meshTopology.create(row.document)});
    const mesh = visit(normalized(base),normalized(source),normalized(local),[]);
    return {mesh,conflicts,merged};
  }

  function addressMoved(before,after,path) {
    for (const key of path) {
      const left = before?.[key], right = after?.[key];
      if (Array.isArray(before) && left?.id !== undefined && left.id !== right?.id) return true;
      before = left;
      after = right;
    }
    return false;
  }

  function paths(before,after,edits) {
    const W = K.world, {equal,own,selector,read} = W.data;
    const evidence = [];
    for (const [index,edit] of edits.entries()) {
      const path = selector(edit.path);
      const leaves = edit.op === 'merge' ? Object.keys(edit.value).map(key => [...path,key]) : [path];
      const touched = leaves.filter(path => !equal(read(before,path),read(after,path)));
      try {
        if (!own(after[path[0]],path[1])) throw new RangeError('Source member was removed');
        if (addressMoved(before,after,path)) throw new RangeError('Array index now addresses a different authored element');
        before = W.apply(before,[edit],{validate:null}).world;
        after = W.apply(after,[edit],{validate:null}).world;
      } catch (error) {
        evidence.push({index,op:edit.op,path,touched,status:'conflict',reason:error.message});
        return {evidence,conflict:true};
      }
      evidence.push({index,op:edit.op,path,touched,status:touched.length ? 'touched' : 'preserved'});
    }
    return {before,after,evidence};
  }

  function instance(id, entry, from, to) {
    const {equal} = K.world.data, T = K.meshTopology;
    const pathEdits = paths(tableView(from),tableView(to),entry.overrides ?? []);
    const report = {instance:id,overrides:pathEdits.evidence,meshOverrides:[],members:[],conflicts:[]};
    if (pathEdits.conflict) {
      report.conflicts.push({reason:'path-override-conflict',index:pathEdits.evidence.at(-1).index});
      return {report,invalid:true};
    }
    const {before,after} = pathEdits;
    report.objects = [...new Set([before,after].flatMap(tables =>
      ['solids','topologyMeshes'].flatMap(table => Object.keys(tables[table]).map(member => id+'.'+member))))].sort();
    const next = {};
    for (const [member,override] of Object.entries(entry.meshOverrides ?? {})) {
      const base = after.topologyMeshes[member];
      if (!base) {
        report.conflicts.push({reason:'mesh-member-removed',member});
        report.meshOverrides.push({member,status:'conflict'});
        return {report,invalid:true};
      }
      const old = before.topologyMeshes[member];
      const touched = !equal(old,base);
      const result = touched ? mergeMesh(old,base,override.mesh) : {mesh:override.mesh,conflicts:[],merged:[]};
      next[member] = {revision:to.revision,base:T.revision(base.document),mesh:result.mesh};
      const {conflicts,merged} = result;
      report.meshOverrides.push({member,status:conflicts.length ? 'conflict' : touched ? 'rebased' : 'preserved',merged,conflicts});
      for (const conflict of conflicts) report.conflicts.push({member,...conflict});
    }
    for (const table of tables) for (const member of [...new Set([...Object.keys(before[table]),...Object.keys(after[table])])].sort()) {
      const prior = table === 'topologyMeshes' ? entry.meshOverrides?.[member]?.mesh ?? before[table][member] : before[table][member];
      const proposed = table === 'topologyMeshes' ? next[member]?.mesh ?? after[table][member] : after[table][member];
      const sourceChanged = !equal(from[table]?.[member],to[table]?.[member]), changed = !equal(prior,proposed);
      if (!sourceChanged && !changed) continue;
      report.members.push({table,member,object:id+'.'+member,status:changed ? 'changed' : 'masked',
        ...(changed && table === 'topologyMeshes' && meshChanges(prior,proposed))});
    }
    return {report,entry:{...entry,...(entry.meshOverrides !== undefined && {meshOverrides:next})}};
  }

  function meshChanges(before,after) {
    try {
      const changes = A.meshTopologyScene.diff(before,after);
      return {elements:Object.fromEntries(Object.entries(changes).map(([kind,rows]) =>
        [kind,rows.map(row => row.id ?? row.uvSet)]))};
    } catch {
      // Scene validation supplies the specific topology error for an invalid review draft.
      return {};
    }
  }

  return Object.freeze({tables,instance});
})(KIT);
