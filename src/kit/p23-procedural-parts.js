/* Stable authored identities for generated prefab members. */
(function (K) {
  const P = K.procedural, {clone, freeze} = P.data;
  const visual = ['solids', 'parts', 'groups', 'motion', 'effects'];
  const world = ['entities', 'systems'];
  const own = (object, key) => object != null && Object.hasOwn(object, key);

  function validate(definition, kind) {
    const {check, id, record} = K.world.data;
    const {generation} = definition;
    if (generation === undefined) return;
    const tables = kind === 'world' ? world : visual;
    check(record(generation) && Object.keys(generation).every(key => ['version', 'model', 'sections'].includes(key)) &&
      generation.version === 1 && id(generation.model) && record(generation.sections), 'Invalid procedural part identities');
    for (const [table, entries] of Object.entries(generation.sections)) {
      check(tables.includes(table) && record(entries), 'Invalid procedural identity section ' + table);
      for (const [key, parent] of Object.entries(entries))
        check(id(key) && own(definition[table], key) && (parent === null || id(parent) && parent !== key),
          'Invalid procedural identity or split source for ' + table + '/' + key);
    }
  }

  function prefab({model, revision, sections, base = {}, kind = 'visual'} = {}) {
    const {check, id, record} = K.world.data;
    check(['visual', 'world'].includes(kind) && id(model) && Number.isSafeInteger(revision) && revision > 0 &&
      record(sections) && record(base) && !own(base, 'generation') && !own(base, 'revision'),
      'A procedural prefab needs a model ID, revision and named sections');
    const definition = clone(base);
    definition.revision = revision;
    definition.generation = {version: 1, model, sections: {}};
    const tables = kind === 'world' ? world : visual;
    for (const [table, sources] of Object.entries(sections)) {
      const batches = Array.isArray(sources) ? [sources] : record(sources) ? Object.values(sources) : [];
      check(tables.includes(table) && (Array.isArray(sources) || record(sources)) &&
        batches.every(Array.isArray) && batches.reduce((count, rows) => count + rows.length, 0) <= 10000 &&
        (!own(definition, table) || record(definition[table])), 'Invalid procedural prefab section ' + table);
      const rows = batches.flat();
      const keys = new Set();
      for (const row of rows) {
        check(record(row) && id(row.id) && record(row.value) && (row.splitFrom === undefined ||
          id(row.splitFrom) && row.splitFrom !== row.id), 'Invalid procedural part in ' + table);
        check(!keys.has(row.id) && !own(definition[table], row.id), 'Duplicate procedural part ' + table + '/' + row.id);
        keys.add(row.id);
      }
      definition[table] = {...definition[table],
        ...Object.fromEntries(rows.map(({id, value}) => [id, clone(value)]))};
      definition.generation.sections[table] = Object.fromEntries(rows.map(({id, splitFrom}) => [id, splitFrom ?? null]));
    }
    if (kind === 'visual' && !own(definition, 'solids')) definition.solids = {};
    return freeze(definition);
  }

  function compare(before, after, {kind = 'visual'} = {}) {
    const {check, record} = K.world.data;
    check(record(before) && record(after) && ['visual', 'world'].includes(kind),
      'Procedural identity review needs two prefab definitions of the same kind');
    validate(before, kind);
    validate(after, kind);
    const prior = before.generation, next = after.generation;
    const sections = {}, conflicts = [];
    for (const table of new Set([...Object.keys(prior?.sections ?? {}), ...Object.keys(next?.sections ?? {})].sort())) {
      const left = prior?.sections[table] ?? {}, right = next?.sections[table] ?? {}, descendants = new Map();
      for (const child of Object.keys(right).sort()) {
        const parent = right[child];
        if (parent === null || !own(before[table], parent)) continue;
        if (!descendants.has(parent)) descendants.set(parent, []);
        descendants.get(parent).push(child);
      }
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right), ...descendants.keys()])].sort();
      sections[table] = Object.fromEntries(keys.map(id => {
        const existed = own(before[table], id), survives = own(after[table], id), children = descendants.get(id) ?? [];
        const tracked = own(left, id), trackedNext = own(right, id);
        let status, reason;
        if (children.length && (survives || children.length < 2 || prior && prior.model !== next.model)) {
          reason = 'A split needs multiple descendants in the same model and must retire the source ID';
        } else if (existed && survives && prior && (prior.model !== next?.model || tracked !== trackedNext)) {
          reason = 'The existing ID now belongs to a different model or source';
        }
        if (reason) {
          status = 'conflict';
          conflicts.push({table, id, reason});
        } else if (children.length) status = 'split';
        else if (existed) status = survives ? 'retained' : 'removed';
        else status = 'added';
        return [id, {status, ...(children.length && {descendants: children}), ...(reason && {reason})}];
      }));
    }
    return freeze({ok: !conflicts.length, from: before.revision ?? 1, to: after.revision ?? 1,
      ...(prior && {fromModel: prior.model}), ...(next && {model: next.model}), sections, conflicts});
  }

  P.model = Object.freeze({prefab, compare, validate});
})(KIT);
