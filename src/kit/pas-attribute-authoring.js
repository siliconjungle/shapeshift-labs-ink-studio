/* Inspect and edit the native named attribute asset without reindexing its rows. */
(function (K) {
  const P = K.procedural, A = P.attributes;
  const { clone, hash } = P.data;
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const nameIsSafe = name => typeof name === 'string' && name.trim().length > 0 && name.length <= 128 &&
    !['__proto__', 'constructor', 'prototype'].includes(name);
  function need(ok, message) {
    if (!ok) throw new RangeError('Geometry attributes: ' + message);
  }

  function initialize(geometry, request) {
    need(fields(request, ['domain', 'channels']) && A.domains.includes(request.domain) &&
      (request.channels === undefined || record(request.channels)), 'expected a domain and optional named channels');
    const { domain, channels = {} } = request;
    let entities;
    if (Array.isArray(geometry)) {
      need(Array.from(geometry).every(row => record(row) && Object.hasOwn(row, 'id')),
        'element lists must give each row an explicit ID');
      entities = geometry;
    } else if (domain === 'curve') {
      const doc = K.curve.retained.create(geometry);
      entities = doc.splines.map(({ id }) => {
        const curve = K.curve.retained.compile(doc, id);
        return { id, point: curve.locate(.5).p };
      });
    } else {
      entities = A.entities(domain, geometry);
    }
    return A.asset(domain, entities, channels);
  }

  function read(source) {
    const asset = A.asset(source.domain, source.entities, source.channels);
    const json = JSON.stringify(asset);
    const revision = [json.length, hash(json), hash(json, 0x9e3779b9)].map(n => n.toString(36)).join('-');
    return { asset, revision };
  }

  function open(source) {
    A.open(source);
    return read(source);
  }

  function select(list, map, kind) {
    need(Array.isArray(list) && list.length <= 4096 && new Set(list).size === list.length &&
      Array.from(list).every(key => map.has(key)), 'selection contains unknown or duplicate ' + kind);
    return list;
  }

  function inspect(source, selection = {}) {
    const { asset, revision } = open(source), active = A.open(asset);
    need(fields(selection, ['channels', 'ids']), 'selection accepts channel names and element IDs');
    const slots = new Map(asset.entities.map((row, i) => [row.id, i]));
    const names = selection.channels === undefined ? [...active.channels.keys()] : select(selection.channels, active.channels, 'channels');
    const ids = selection.ids === undefined ? undefined : select(selection.ids, slots, 'element IDs');
    const channels = names.map(name => {
      const { type, interpolation, values, size, missing } = active.channels.get(name);
      const low = Array(size).fill(Infinity), high = Array(size).fill(-Infinity), labels = new Map();
      let absent = 0, count = 0;
      for (const i of ids ? ids.map(id => slots.get(id)) : asset.entities.keys()) {
        const first = values[i * size];
        if (missing.has(i) || first === null && type !== 'label') {
          absent++;
          continue;
        }
        count++;
        if (type === 'label') labels.set(first, (labels.get(first) ?? 0) + 1);
        else for (let k = 0; k < size; k++) {
          const n = values[i * size + k];
          low[k] = Math.min(low[k], n);
          high[k] = Math.max(high[k], n);
        }
      }
      return { name, type, interpolation, count, missing: absent, ...(type === 'label'
        ? { labels: [...labels].map(([value, count]) => ({ value, count })) }
        : { min: count ? (size === 1 ? low[0] : low) : null, max: count ? (size === 1 ? high[0] : high) : null }) };
    });
    return { domain: asset.domain, revision, entities: asset.entities.length, channels,
      ...(ids && { selected: ids.map(id => {
        const i = slots.get(id), values = active.read(i);
        return { ...asset.entities[i], values: Object.fromEntries(names.filter(name => Object.hasOwn(values, name))
          .map(name => [name, values[name]])), missing: names.filter(name => !Object.hasOwn(values, name)) };
      }) }) };
  }

  function edit(source, request) {
    const { asset, revision } = open(source);
    need(fields(request, ['revision', 'operations']) && Array.isArray(request.operations) &&
      request.operations.length >= 1 && request.operations.length <= 4096, 'expected 1 to 4096 operations');
    need(request.revision === undefined || request.revision === revision, 'edit was authored against a different revision');
    const active = A.open(asset), channels = active.channels;
    const slots = new Map(asset.entities.map((row, i) => [row.id, i]));
    for (const change of request.operations) {
      need(record(change), 'invalid operation');
      const { op, name, to, type, interpolation, id, value } = change;
      need(nameIsSafe(name), 'invalid channel name');
      const channel = channels.get(name);
      if (op === 'add-channel') {
        need(fields(change, ['op', 'name', 'type', 'interpolation']) && !channel, 'new channel needs a unique name');
        const spec = A.asset(asset.domain, asset.entities, { [name]: { type, interpolation } });
        channels.set(name, A.open(spec).channels.get(name));
        continue;
      }
      need(channel, 'unknown channel ' + name);
      if (op === 'rename-channel') {
        need(fields(change, ['op', 'name', 'to']) && nameIsSafe(to) && !channels.has(to), 'rename needs a unique channel name');
        channels.delete(name);
        channels.set(to, channel);
      } else if (op === 'remove-channel') {
        need(fields(change, ['op', 'name']), 'invalid remove-channel operation');
        channels.delete(name);
      } else if (op === 'set-interpolation') {
        need(fields(change, ['op', 'name', 'interpolation']) && ['linear', 'dominant', 'constant'].includes(interpolation) &&
          (channel.type !== 'label' || interpolation !== 'linear'), 'invalid channel interpolation');
        channel.interpolation = interpolation;
      } else if (op === 'set' || op === 'clear') {
        need(fields(change, op === 'set' ? ['op', 'name', 'id', 'value'] : ['op', 'name', 'id']) &&
          slots.has(id), 'edit needs an existing element ID');
        const index = slots.get(id), { size } = channel;
        if (op === 'set') {
          need(size === 1 ? !Array.isArray(value) : Array.isArray(value) && value.length === size, 'value must match the channel shape');
          const values = size === 1 ? [value] : value;
          A.table(asset.domain, [asset.entities[index]], { [name]: { type: channel.type, values } });
          for (let k = 0; k < size; k++) channel.values[index * size + k] = values[k];
          channel.missing.delete(index);
        } else {
          channel.values.fill(null, index * size, (index + 1) * size);
          channel.missing.add(index);
        }
      } else {
        need(false, 'unknown operation ' + op);
      }
    }
    const output = A.asset(asset.domain, asset.entities, Object.fromEntries([...channels].map(([name, channel]) =>
      [name, { type: channel.type, interpolation: channel.interpolation, values: channel.values, missing: [...channel.missing] }])));
    const after = read(output);
    return { asset: output, report: { domain: asset.domain, entities: asset.entities.length, revision,
      outputRevision: after.revision, operations: clone(request.operations) } };
  }

  P.attributeAuthoring = Object.freeze({ initialize, inspect, edit });
})(KIT);
