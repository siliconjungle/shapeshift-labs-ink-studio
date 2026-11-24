/* Asset identities are independent of source-file table indices. */
(function (K) {
  const format = 'ink-studio/asset-revision';
  const groups = { material: 'materials', socket: 'sockets', bone: 'bones' };
  const reserved = new Set(['__proto__', 'constructor', 'prototype']);
  const name = value => typeof value === 'string' && /^[\w.-][\w./:-]{0,127}$/.test(value) && !reserved.has(value);
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const revisionNumber = value => Number.isSafeInteger(value) && value > 0;
  const entries = (value, label) => {
    if (!record(value) || !Object.keys(value).every(name)) throw new TypeError(label + ' needs a map of stable IDs');
    return Object.entries(value);
  };

  function manifest(raw) {
    if (raw?.format !== format || raw.version !== 1 || !name(raw.asset) || !revisionNumber(raw.revision))
      throw new TypeError('Use an Ink asset revision manifest with a stable asset ID and positive revision');
    const parts = Object.fromEntries(entries(raw.parts, 'Asset parts').map(([id, part]) => {
      if (!record(part)) throw new TypeError('Invalid asset part ' + id);
      const lists = Object.values(groups).map(group => {
        const ids = part[group] === undefined ? [] : part[group];
        if (!Array.isArray(ids) || !Array.from(ids).every(name) || new Set(ids).size !== ids.length)
          throw new TypeError('Part ' + id + ' needs distinct ' + group + ' IDs');
        return [group, Object.freeze(ids.slice())];
      });
      return [id, Object.freeze(Object.fromEntries(lists))];
    }));
    if (!Object.keys(parts).length) throw new RangeError('An asset revision needs at least one part');
    return Object.freeze({ format, version: 1, asset: raw.asset, revision: raw.revision, parts: Object.freeze(parts) });
  }

  function placement(id, raw) {
    if (!name(id) || !record(raw) || typeof raw.file !== 'string' || !raw.file.trim() ||
        !name(raw.asset) || !name(raw.part) || !revisionNumber(raw.revision))
      throw new TypeError('Asset placement ' + id + ' needs file, asset, revision and part');
    const transform = K.sceneGraph.transform(raw.transform);
    const bindings = Object.fromEntries(entries(raw.bindings === undefined ? {} : raw.bindings, 'Part bindings').map(([key, binding]) => {
      if (!record(binding) || !Object.hasOwn(groups, binding.kind) || !name(binding.target) ||
          binding.required !== undefined && typeof binding.required !== 'boolean')
        throw new TypeError('Invalid part binding ' + id + '/' + key);
      return [key, { kind: binding.kind, target: binding.target, required: binding.required ?? true }];
    }));
    return { file: raw.file, asset: raw.asset, revision: raw.revision, part: raw.part, transform, bindings };
  }

  function placements(scene) {
    const rows = scene?.assetParts;
    const list = entries(rows === undefined ? {} : rows, 'Scene assetParts');
    if (list.length > 32) throw new RangeError('A scene supports up to 32 asset part placements');
    return Object.fromEntries(list.map(([id, raw]) => [id, placement(id, raw)]));
  }

  function resolve(id, raw, source) {
    const row = placement(id, raw);
    if (source?.manifest?.asset !== row.asset || source.manifest.revision !== row.revision)
      throw new RangeError('Placement ' + id + ' needs ' + row.asset + ' revision ' + row.revision);
    const inventory = source.part(row.part);
    if (!inventory) throw new RangeError('Missing asset part ' + row.part + ' for ' + id);
    const bindings = Object.fromEntries(Object.entries(row.bindings).map(([key, binding]) => {
      const { kind, target } = binding;
      const exists = inventory[groups[kind]].includes(target);
      if (!exists) return [key, { ...binding, status: 'missing' }];
      const resolved = kind === 'material'
        ? { object: id, entity: id, part: row.part, material: target }
        : K.sceneGraph.compose(row.transform, inventory.frames[kind][target]);
      return [key, { ...binding, status: 'bound', resolved }];
    }));
    return { file: row.file, asset: row.asset, revision: row.revision, part: row.part, transform: row.transform, bindings };
  }

  function frameChanged(before, after) {
    if (!before?.matrix || !after?.matrix) return false;
    const incoming = [...after.position, ...after.matrix];
    return [...before.position, ...before.matrix].some((n, i) => Math.abs(n - incoming[i]) > 1e-8);
  }

  function preview(scene, { instance, current, next, file, expect } = {}) {
    const all = placements(scene);
    const row = Object.hasOwn(all, instance) ? all[instance] : undefined;
    if (!row) throw new RangeError('Unknown asset placement ' + instance);
    if (expect !== undefined && expect !== row.revision)
      throw new RangeError('Stale asset revision for ' + instance + '. Expected ' + expect + ', found ' + row.revision);
    const before = resolve(instance, row, current), original = current.part(row.part);
    if (!next || next.manifest.asset !== row.asset || next.manifest.revision <= row.revision)
      throw new RangeError('Choose a newer revision of asset ' + row.asset);
    if (typeof file !== 'string' || !file.trim()) throw new TypeError('Give the replacement source file');
    const revision = next.manifest.revision, candidate = { ...row, file, revision };
    const target = next.part(row.part);
    const after = target ? resolve(instance, candidate, next) : null;
    const elements = Object.fromEntries(Object.values(groups).map(group => {
      const old = original[group], incoming = target?.[group] ?? [];
      return [group, { retained: old.filter(id => incoming.includes(id)), removed: old.filter(id => !incoming.includes(id)),
        added: incoming.filter(id => !old.includes(id)) }];
    }));
    const blockers = target ? [] : [{ code: 'missing-part', part: row.part }];
    const bindings = Object.entries(before.bindings).map(([id, binding]) => {
      const updated = after?.bindings[id], wasBound = binding.status === 'bound', bound = updated?.status === 'bound';
      const status = bound ? (wasBound ? 'retained' : 'restored') : (wasBound ? 'lost' : 'missing');
      if (!bound && binding.required) blockers.push({ code: 'missing-required-binding', binding: id });
      return { id, kind: binding.kind, target: binding.target, required: binding.required, status,
        ...(wasBound && { before: binding.resolved }), ...(bound && { after: updated.resolved }),
        ...(frameChanged(binding.resolved, updated?.resolved) && { frameChanged: true }) };
    });
    return { instance, asset: row.asset, part: row.part, fromRevision: row.revision, toRevision: revision, file,
      canReplace: !blockers.length, elements, bindings, blockers };
  }

  function replace(scene, options) {
    const report = preview(scene, options);
    if (!report.canReplace) throw Object.assign(new RangeError('Asset replacement blocked for ' + report.instance), { report });
    const { instance, file, toRevision } = report;
    return { scene: { ...scene, assetParts: { ...scene.assetParts,
      [instance]: { ...scene.assetParts[instance], file, revision: toRevision } } }, report };
  }

  function checkScene(scene, imports = {}) {
    for (const [key, row] of Object.entries(placements(scene))) {
      const loaded = Object.hasOwn(imports, key) && imports[key].part;
      const fields = ['file', 'asset', 'revision', 'part', 'transform'];
      if (!loaded || fields.some(field => JSON.stringify(row[field]) !== JSON.stringify(loaded[field])))
        throw new RangeError('Load the pinned asset part for placement ' + key);
      const ids = Object.keys(row.bindings);
      if (ids.length !== Object.keys(loaded.bindings).length || ids.some(id =>
        !Object.hasOwn(loaded.bindings, id) || ['kind', 'target', 'required'].some(field => loaded.bindings[id][field] !== row.bindings[id][field])))
        throw new RangeError('Reload changed bindings for asset part ' + key);
      for (const [id, binding] of Object.entries(loaded.bindings)) {
        if (binding.required && binding.status !== 'bound') throw new RangeError('Missing required binding ' + key + '/' + id);
      }
    }
  }

  const mounted = new WeakMap();
  function install(world, imports) {
    const previous = mounted.get(world) ?? new Set();
    const meshes = (world.meshes ?? []).filter(mesh => !previous.has(mesh));
    const ids = new Set(meshes.map(mesh => mesh.id)), occupied = new Set(meshes.map(mesh => mesh.objectId));
    for (const id of world.renderMetadata?.objects ?? []) occupied.add(id);
    const installed = new Set(), parts = {};
    for (const [key, entry] of entries(imports, 'Loaded asset parts')) {
      if (!entry?.part || !Array.isArray(entry.meshes) || !entry.meshes.length)
        throw new TypeError('Invalid loaded asset part ' + key);
      for (const [id, binding] of Object.entries(entry.part.bindings)) {
        if (binding.required && binding.status !== 'bound') throw new RangeError('Missing required binding ' + key + '/' + id);
      }
      for (const mesh of entry.meshes) {
        if (ids.has(mesh.id) || occupied.has(key) || mesh.objectId !== key || mesh.partId !== entry.part.part)
          throw new RangeError('Asset part ' + key + ' collides with scene mesh ' + mesh.id);
        ids.add(mesh.id);
        installed.add(mesh);
        meshes.push(mesh);
      }
      parts[key] = entry.part;
    }
    K.sceneMeshes.list({ meshes }, true);
    world.meshes = meshes;
    world.assetParts = parts;
    mounted.set(world, installed);
    return world;
  }

  K.authoring.assetRevisions = Object.freeze({ format, manifest, placements, resolve, preview, replace, checkScene, install });
})(KIT);
