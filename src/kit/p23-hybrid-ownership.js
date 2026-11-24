/* One authority per authored channel, independent of the representation on screen. */
(function (K) {
  const A = K.authoring, { freeze } = K.procedural.data;
  const format = 'ink-studio/hybrid-ownership';
  const channels = ['shape', 'pigment', 'coverage', 'detail'];
  const sourceKinds = {
    shape: ['sdf', 'mesh', 'splats', 'curves'],
    pigment: ['sdf', 'mesh', 'atlas', 'splats', 'curves'],
    coverage: ['sdf', 'mesh', 'atlas', 'splats', 'curves'],
    detail: ['sdf', 'mesh', 'atlas', 'splats', 'curves']
  };
  const inputsFor = {
    mesh: ['shape', 'pigment', 'coverage'],
    card: channels,
    proxy: ['shape', 'coverage']
  };
  const requiredFor = { mesh: ['shape'], card: ['shape', 'pigment', 'coverage'], proxy: ['shape', 'coverage'] };
  const compiled = new WeakMap();
  const name = id => TargetSelectors.name(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
  const record = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const key = ({ object, part }) => JSON.stringify([object, part]);
  const sameTarget = (a, b) => a === b || !!a && !!b && a.object === b.object && a.part === b.part;
  const target = row => fields(row, ['object', 'part']) && name(row.object) && (row.part === undefined || name(row.part));
  const intersects = (a, b) => a.object === b.object && (a.part === undefined || b.part === undefined || a.part === b.part);

  function prepare(raw) {
    if (compiled.has(raw)) return raw;
    if (!fields(raw, ['format', 'version', 'sources', 'parts']) || raw.format !== format || raw.version !== 1 ||
        !record(raw.sources) || !Object.keys(raw.sources).length || Object.keys(raw.sources).length > 256 ||
        !Array.isArray(raw.parts) || !raw.parts.length || raw.parts.length > 128)
      throw new TypeError('Use a version 1 Ink hybrid ownership document with sources and parts');
    const sources = {};
    for (const [id, source] of Object.entries(raw.sources)) {
      if (!name(id) || !fields(source, ['kind', 'target']) || !Object.values(sourceKinds).some(kinds => kinds.includes(source.kind)) ||
          !target(source.target)) throw new TypeError('Invalid hybrid source ' + id);
      sources[id] = { kind: source.kind, target: { ...source.target } };
    }

    const byPart = new Map(), assets = new Set();
    for (const row of raw.parts) {
      if (!fields(row, ['object', 'part', 'owners', 'derived']) || !name(row.object) || !name(row.part) ||
          byPart.has(key(row)) || !fields(row.owners, channels) ||
          row.derived !== undefined && (!Array.isArray(row.derived) || row.derived.length > 32))
        throw new TypeError('Hybrid parts need distinct object and part IDs, owners and up to 32 derived outputs');
      const { object, part } = row;
      const owners = Object.fromEntries(channels.map(channel => {
        const owner = row.owners[channel], source = owner && Object.hasOwn(sources, owner.source) && sources[owner.source];
        if (!fields(owner, ['source', 'destination']) || !source || !sourceKinds[channel].includes(source.kind) ||
            owner.destination !== undefined && !name(owner.destination))
          throw new RangeError('Invalid ' + channel + ' owner for ' + object + '/' + part);
        return [channel, { ...owner }];
      }));
      const derived = Array.from(row.derived ?? [], item => {
        const defaults = item && Object.hasOwn(inputsFor, item.kind) && inputsFor[item.kind];
        if (!fields(item, ['id', 'kind', 'uses', 'target']) || !name(item.id) || assets.has(item.id) ||
            !defaults || item.target !== undefined && !target(item.target))
          throw new TypeError('Each derived mesh, card or proxy needs a unique ID and optional target');
        const uses = item.uses ?? defaults;
        if (!Array.isArray(uses) || !Array.from(uses).every(channel => channels.includes(channel)) ||
            new Set(uses).size !== uses.length || !requiredFor[item.kind].every(channel => uses.includes(channel)))
          throw new RangeError('Invalid channels for derived ' + item.kind + ' ' + item.id);
        assets.add(item.id);
        return { id: item.id, kind: item.kind, uses: channels.filter(channel => uses.includes(channel)),
          ...(item.target && { target: { ...item.target } }) };
      });
      byPart.set(key(row), { object, part, owners, derived });
    }
    const result = freeze({ format, version: 1, sources, parts: [...byPart.values()] });
    compiled.set(result, byPart);
    return result;
  }

  function route(raw, address) {
    const declaration = prepare(raw);
    if (!fields(address, ['object', 'part', 'channel']) || !name(address.object) ||
        !name(address.part) || !channels.includes(address.channel))
      throw new TypeError('Choose a hybrid object, part and authored channel');
    const part = compiled.get(declaration).get(key(address));
    if (!part) throw new RangeError('Unknown hybrid part ' + address.object + '/' + address.part);
    const owner = part.owners[address.channel];
    const affected = declaration.parts.flatMap(part => part.owners[address.channel].source === owner.source ?
      part.derived.filter(item => item.uses.includes(address.channel)) : []);
    return freeze({ ...address, ...owner, ...declaration.sources[owner.source],
      derived: affected.map(item => ({ id: item.id, kind: item.kind })) });
  }

  function manages(raw, scope) {
    if (raw === undefined) return false;
    const declaration = prepare(raw);
    return declaration.parts.some(part => intersects(scope, part) ||
      part.derived.some(item => item.target && intersects(scope, item.target)) ||
      channels.some(channel => intersects(scope, declaration.sources[part.owners[channel].source].target)));
  }

  const revisionId = value => typeof value === 'string' && value.trim().length > 0 ||
    Number.isSafeInteger(value) && value >= 0;

  function checkedRevisions(raw) {
    if (!record(raw) || Object.values(raw).some(pin => !revisionId(pin) &&
        !(fields(pin, channels) && Object.keys(pin).length && Object.values(pin).every(revisionId))))
      throw new TypeError('Hybrid revisions need stable strings or nonnegative integers, optionally pinned by channel');
    return raw;
  }

  function plan(raw, revisions, previous) {
    const declaration = prepare(raw), pins = checkedRevisions(revisions), prior = new Map();
    if (previous !== undefined) {
      if (previous?.format !== 'ink-studio/hybrid-rebuild' || previous.version !== 1 || !Array.isArray(previous.outputs))
        throw new TypeError('Use a prior hybrid rebuild report');
      for (const row of previous.outputs) {
        if (!record(row) || !name(row.id) || prior.has(row.id) || !Array.isArray(row.inputs) ||
            row.inputs.some(input => !record(input) || !channels.includes(input.channel) ||
              !revisionId(input.revision) || !target(input.target)) ||
            new Set(row.inputs.map(input => input.channel)).size !== row.inputs.length)
          throw new TypeError('Invalid output in prior hybrid rebuild report');
        prior.set(row.id, row);
      }
    }
    const outputs = declaration.parts.flatMap(({ object, part, owners, derived }) => derived.map(item => {
      const { id, kind, target } = item;
      const inputs = item.uses.map(channel => {
        const { source } = owners[channel];
        const pin = Object.hasOwn(pins, source) ? pins[source] : undefined;
        const revision = record(pin) ? pin[channel] : pin;
        if (revision === undefined) throw new RangeError('Missing revision for hybrid source ' + source + '/' + channel);
        const authority = declaration.sources[source];
        return { channel, source, kind: authority.kind, target: authority.target, revision };
      });
      const old = prior.get(id);
      const same = old?.kind === kind && old.object === object && old.part === part &&
        sameTarget(old.target, target);
      const oldInputs = new Map(same ? old.inputs.map(row => [row.channel, row]) : []);
      const changedChannels = channels.filter(channel => {
        const input = inputs.find(row => row.channel === channel), old = oldInputs.get(channel);
        if (!input || !old) return input !== old;
        return input.source !== old.source || input.kind !== old.kind || input.revision !== old.revision ||
          !sameTarget(input.target, old.target);
      });
      return { object, part, id, kind, ...(target && { target }), inputs, changedChannels,
        status: same && !changedChannels.length ? 'reuse' : 'rebuild' };
    }));
    return freeze({ format: 'ink-studio/hybrid-rebuild', version: 1, outputs });
  }

  function create(raw, builders) {
    const declaration = prepare(raw);
    for (const { derived } of declaration.parts) for (const { kind } of derived)
      if (typeof builders?.[kind] !== 'function') throw new TypeError('Missing hybrid ' + kind + ' builder');
    const registered = Object.freeze({ ...builders });
    let current = null, building = false;
    function rebuild(sources) {
      if (building) throw new Error('Cannot rebuild hybrid assets inside another rebuild');
      if (!record(sources)) throw new TypeError('Hybrid rebuild needs a map of pinned source snapshots');
      const revisions = Object.fromEntries(Object.entries(sources).map(([id, source]) => {
        if (!fields(source, ['revision', 'value']) || source.value === undefined)
          throw new TypeError('Hybrid source ' + id + ' needs a revision and snapshot value');
        return [id, source.revision];
      }));
      const report = plan(declaration, revisions, current?.report), assets = {};
      building = true;
      try {
        for (const output of report.outputs) {
          const { id, kind, inputs } = output;
          const previous = current?.assets[id];
          const owned = Object.freeze(Object.fromEntries(inputs.map(row => [row.channel,
            Object.freeze({ ...row, value: sources[row.source].value })])));
          const asset = output.status === 'reuse' ? previous : registered[kind]({ output, owned });
          if (!asset || typeof asset !== 'object' || typeof asset.then === 'function')
            throw new TypeError('Hybrid ' + kind + ' builder must return a synchronous asset');
          assets[id] = asset;
        }
        current = Object.freeze({ report, assets: Object.freeze(assets) });
        return current;
      } finally { building = false; }
    }
    return Object.freeze({ rebuild, current: () => current });
  }

  A.hybridOwnership = Object.freeze({ format, prepare, route, manages, plan, create });
})(KIT);
