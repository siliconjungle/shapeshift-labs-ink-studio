/* Typed project metadata with explicit prefab and placement overrides. */
(function (K) {
  const A = K.authoring, {freeze} = K.procedural.data;
  const types = ['boolean','enum','number','string'];
  const fields = (row,keys) => K.world.data.record(row) && Object.keys(row).every(key=>keys.includes(key));

  function schema(raw = {}) {
    const {record,id} = K.world.data;
    if (!record(raw) || Object.keys(raw).length>256) throw new TypeError('Expected a map of up to 256 property definitions');
    for (const [key,row] of Object.entries(raw)) {
      const type = row?.type;
      if (!id(key) || !types.includes(type) ||
          !fields(row,['type',...(type==='enum' ? ['choices'] : type==='number' ? ['min','max'] : [])]))
        throw new TypeError('Invalid definition for custom property '+key);
      if (type==='enum' && (!Array.isArray(row.choices) || !row.choices.length || row.choices.length>128 ||
          !Array.from(row.choices).every(choice=>typeof choice==='string' && choice.length>0) ||
          new Set(row.choices).size!==row.choices.length))
        throw new TypeError('Enum property '+key+' needs distinct string choices');
      if (type==='number' && ([row.min,row.max].some(bound=>bound!==undefined && !Number.isFinite(bound)) ||
          (row.min ?? -Infinity) > (row.max ?? Infinity)))
        throw new TypeError('Invalid number bounds for custom property '+key);
    }
    return raw;
  }

  function validate(values = {}, definitions, label) {
    const {record,own} = K.world.data;
    if (!record(values)) throw new TypeError(label+' needs a map of custom property values');
    for (const [key,value] of Object.entries(values)) {
      if (!own(definitions,key)) throw new RangeError(label+' uses unknown custom property '+key);
      const row = definitions[key];
      const ok = row.type==='enum' ? row.choices.includes(value) : row.type==='number' ?
        Number.isFinite(value) && value>=(row.min ?? -Infinity) && value<=(row.max ?? Infinity) :
        typeof value===row.type;
      if (!ok) throw new TypeError(label+' property '+key+' needs a valid '+row.type+' value');
    }
    return values;
  }

  function project(scene, env = {}) {
    const source = scene?.customProperties;
    if (typeof source==='string' && (!source.trim() || env.customProperties===undefined))
      throw new TypeError('Load the named customProperties file before building');
    const raw = typeof source==='string' ? env.customProperties : source;
    if (raw===undefined) return {definitions:{},values:{}};
    if (!fields(raw,['version','definitions','values']) || raw.version!==undefined && raw.version!==1)
      throw new TypeError('Expected a version 1 customProperties document');
    const definitions = schema(raw.definitions);
    return {definitions,values:validate(raw.values,definitions,'Project')};
  }

  function resolve(project, prefab, instance) {
    const values = {...project.values,...prefab,...instance};
    const sources = Object.fromEntries(Object.keys(values).map(key=>[key,
      Object.hasOwn(instance ?? {},key) ? 'instance' : Object.hasOwn(prefab ?? {},key) ? 'prefab' : 'project']));
    return {values,sources};
  }

  function patchMap(before, changes) {
    if (!K.world.data.record(changes)) throw new TypeError('Custom property changes need a named map');
    const out = new Map(Object.entries(before ?? {}));
    for (const [name,value] of Object.entries(changes)) {
      if (!K.world.data.id(name)) throw new TypeError('Invalid custom property name '+name);
      if (value===null) out.delete(name);
      else out.set(name,value);
    }
    return Object.fromEntries(out);
  }

  function inspect(project, prefab, instance) {
    const {values,sources} = resolve(project,prefab,instance);
    return Object.fromEntries(Object.keys(project.definitions).sort().map(key=>[key,{
      ...project.definitions[key],source:sources[key] ?? null,
      ...(Object.hasOwn(values,key) && {value:values[key]}),
      authored:Object.fromEntries([['project',project.values],['prefab',prefab],['instance',instance]]
        .filter(([,map])=>Object.hasOwn(map ?? {},key)).map(([scope,map])=>[scope,map[key]]))
    }]));
  }

  function stored(row, values) {
    const {properties,...rest} = row;
    return {...rest,...(Object.keys(values).length && {properties:values})};
  }

  function combine(links) {
    const values = new Map(), differences = [], {equal} = K.world.data;
    const keys = new Set(links.flatMap(([,link])=>Object.keys(link.propertyValues ?? {})));
    for (const key of [...keys].sort()) {
      const rows = links.map(([instance,link])=>({instance,value:link.propertyValues?.[key],scope:link.propertySources?.[key]}));
      if (!rows.every(row=>equal(row.value,rows[0].value))) {
        differences.push({reason:'different-module-property-values',property:key,instances:rows.map(({instance,value})=>
          ({instance,value:value ?? null}))});
      } else if (rows.some(row=>row.scope==='prefab' || row.scope==='instance')) values.set(key,rows[0].value);
    }
    return {values:Object.fromEntries(values),differences};
  }

  function plan(scene,env,request = {}) {
    const {id,own,equal} = K.world.data, {clone} = K.procedural.data;
    const {scope='project',prefab,instance,definitions,values,revision} = request ?? {};
    if (!fields(request,['scope','prefab','instance','definitions','values','revision']) ||
        !['project','prefab','instance'].includes(scope) ||
        (scope==='prefab' ? !id(prefab) : prefab!==undefined) ||
        (scope==='instance' ? !id(instance) : instance!==undefined) ||
        definitions!==undefined && scope!=='project' ||
        revision!==undefined && (scope!=='prefab' || !Number.isSafeInteger(revision) || revision<1))
      throw new TypeError('Inspect or edit project, prefab, or instance custom properties');
    const expanded = A.scenePrefabs.expand(scene,env), base = project(scene,env);
    const link = instance===undefined ? undefined : expanded.instances.get(instance);
    if (instance!==undefined && !link) throw new RangeError('Unknown prefab instance '+instance);
    const selected = link?.instance.prefab ?? prefab;
    const inline = own(scene.prefabs,selected);
    const definition = selected===undefined ? undefined : inline ? scene.prefabs[selected] :
      own(env?.prefabs,selected) ? env.prefabs[selected] : undefined;
    if (selected!==undefined && !definition) throw new RangeError('Unknown visual prefab '+selected);
    const before = inspect(base,definition?.properties,link?.instance.properties);
    const report = {format:'ink-studio/custom-properties',version:1,scene:scene.id,scope,
      ...(selected!==undefined && {prefab:selected,prefabRevision:definition.revision}),...(instance!==undefined && {instance}),
      ...(link?.mirror && {mirrorOf:link.mirror.source}),before,after:before,
      changed:false,canCommit:false,affectedInstances:[],conflicts:[],instances:[]};
    function finish(patch) { return {patch,report:freeze(clone(report))}; }
    function block(reason,detail={}) {
      report.conflicts.push({reason,...detail});
      return finish();
    }
    if (revision!==undefined && revision!==definition.revision) return block('stale-prefab-revision');
    if (definitions===undefined && values===undefined) {
      report.canCommit = true;
      return finish({});
    }
    if (scope==='project' && typeof scene.customProperties==='string') return block('edit-project-properties-file',{file:scene.customProperties});
    if (scope==='prefab' && !inline) return block('publish-prefab-library-revision',{prefab:selected});
    if (link?.mirror) return block('edit-live-mirror-source',{source:link.mirror.source});

    let patch, context=base, nextDefinition=definition, nextEntry=link?.instance;
    const apply = before => values===undefined ? before ?? {} : patchMap(before,values);
    try {
      if (scope==='project') {
        context = {definitions:definitions===undefined ? base.definitions : schema(patchMap(base.definitions,definitions)),
          values:apply(base.values)};
        validate(context.values,context.definitions,'Project');
        if (!equal(context,base)) patch = {customProperties:{version:1,...context}};
      } else if (scope==='instance') {
        const next = apply(nextEntry.properties);
        validate(next,base.definitions,'Instance '+instance);
        if (!equal(next,nextEntry.properties ?? {})) {
          nextEntry = stored(nextEntry,next);
          patch = {instances:{...scene.instances,[instance]:nextEntry}};
        }
      } else {
        const next = apply(definition.properties);
        validate(next,base.definitions,'Prefab '+selected);
        if (!equal(next,definition.properties ?? {})) {
          if (!Number.isSafeInteger(definition.revision+1)) throw new RangeError('Prefab revision exceeds the supported integer range');
          nextDefinition = {...stored(definition,next),revision:definition.revision+1};
          const instances = {...scene.instances};
          for (const [id,row] of Object.entries(instances)) if (row.prefab===selected) {
            const result = prefabSourceRebase.instance(id,row,definition,nextDefinition);
            if (result.invalid || result.report.conflicts.length) return block('prefab-overrides-need-review',{instance:id});
            instances[id] = result.entry;
          }
          patch = {prefabs:{...scene.prefabs,[selected]:nextDefinition},...(Object.keys(instances).length && {instances})};
          report.afterPrefabRevision = nextDefinition.revision;
        }
      }
      if (patch) {
        const after = A.scenePrefabs.expand({...scene,...patch},env);
        for (const [id,row] of after.instances) {
          const from = expanded.instances.get(id);
          if (equal(from.propertyValues,row.propertyValues) && equal(from.propertySources,row.propertySources)) continue;
          report.affectedInstances.push(id);
          report.instances.push({instance:id,objects:[...row.solids,...Array.from(row.meshes.values(),entry=>entry.object)]});
        }
      }
    } catch (error) {
      return block('invalid-custom-properties',{problem:error.message,
        ...(error.problems && {problems:error.problems})});
    }

    report.after = inspect(context,nextDefinition?.properties,nextEntry?.properties);
    report.changed = Boolean(patch);
    report.canCommit = true;
    return finish(patch ?? {});
  }

  A.customProperties = Object.freeze({project,validate,resolve,patchMap,stored,combine,plan});
})(KIT);
