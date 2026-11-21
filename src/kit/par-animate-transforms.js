/* Independent transform channels for native placements, hierarchy nodes and particles. */
(function (K) {
  const A = K.procedural.animationGraph;
  const { record } = K.procedural.rasterSimSupport;
  const channels = ['position', 'rotation', 'scale'];
  const defaults = { position: [0, 0, 0], rotation: K.M.id(), scale: 1 };
  const name = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
  const number = value => Number.isFinite(value) && Math.abs(value) <= 1e6;
  const size = value => number(value) && value > 0;
  function vector(value, length, valid = number) {
    return (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length === length &&
      Array.from(value).every(valid);
  }

  function channel(row, key) {
    const value = Object.hasOwn(row, key) && row[key] !== undefined ? row[key] : defaults[key];
    if (key === 'position' && vector(value, 3)) return Array.from(value);
    if (key === 'rotation' && vector(value, 9) && K.anim.keyframeTrack.orientation(Array.from(value))) return Array.from(value);
    if (key === 'scale') {
      if (size(value)) return value;
      if (vector(value, 3, size)) return Array.from(value);
    }
    throw new TypeError('Invalid instance ' + key + ' for ' + row.id);
  }

  function index(rows) {
    if (!Array.isArray(rows) || rows.length > 65535) throw new RangeError('Expected up to 65535 instance transforms');
    const ids = new Map();
    for (const [i, row] of rows.entries()) {
      if (!record(row) || !name(row.id) || ids.has(row.id)) throw new TypeError('Instance transforms need distinct IDs');
      ids.set(row.id, i);
    }
    return ids;
  }

  function captureTransforms(rows) {
    index(rows);
    return Object.freeze(rows.map(row => {
      const pose = { id: row.id };
      for (const key of channels) pose[key] = Object.freeze(channel(row, key));
      return Object.freeze(pose);
    }));
  }

  function instanceMatrix(pose) {
    if (!record(pose)) throw new TypeError('Expected an instance pose');
    const rotation = channel(pose, 'rotation'), scale = channel(pose, 'scale');
    return rotation.map((n, i) => n * (Array.isArray(scale) ? scale[i % 3] : scale));
  }

  function staleTransforms(rows, edits, { snapshots = {}, missing = 'error' } = {}) {
    if (!Array.isArray(edits) || edits.length > 8192 || !record(snapshots) ||
        !['error', 'skip'].includes(missing))
      throw new TypeError('Stale transforms need a bounded edit list, named snapshots and a missing-ID policy');
    const current = index(rows), value = rows.slice(), banks = new Map(), written = new Map();
    let snapshotRows = 0, applied = 0, skipped = 0;
    for (const edit of edits) {
      if (!record(edit) || Object.keys(edit).some(key => !['id', 'from', 'snapshot', 'channels'].includes(key)) ||
          !name(edit.id) || edit.from !== undefined && !name(edit.from) ||
          edit.snapshot !== undefined && !name(edit.snapshot) || edit.from === undefined && edit.snapshot === undefined)
        throw new TypeError('Each stale transform edit needs a target and a donor or snapshot');
      const { id, from = id, snapshot, channels: keys = channels } = edit;
      if (!Array.isArray(keys) || !keys.length || keys.length > 3 ||
          new Set(keys).size !== keys.length || !Array.from(keys).every(key => channels.includes(key)))
        throw new TypeError('Expected distinct position, rotation or scale channels');
      const assigned = written.get(id) ?? new Set();
      for (const key of keys) {
        if (assigned.has(key)) throw new TypeError('Duplicate stale transform channel for ' + id);
        assigned.add(key);
      }
      written.set(id, assigned);

      let source = rows, ids = current;
      if (snapshot !== undefined) {
        if (!Object.hasOwn(snapshots, snapshot)) throw new RangeError('Unknown instance snapshot ' + snapshot);
        if (!banks.has(snapshot)) {
          const saved = snapshots[snapshot], ids = index(saved);
          snapshotRows += saved.length;
          if (snapshotRows > 262144) throw new RangeError('Instance snapshots exceed the pose budget');
          banks.set(snapshot, ids);
        }
        source = snapshots[snapshot];
        ids = banks.get(snapshot);
      }
      const target = current.get(id), donor = ids.get(from);
      if (target === undefined || donor === undefined) {
        if (missing === 'error') throw new RangeError('Missing stale transform instance ' + (target === undefined ? id : from));
        skipped++;
        continue;
      }
      const patch = Object.fromEntries(keys.map(key => [key, channel(source[donor], key)]));
      value[target] = { ...value[target], ...patch };
      applied++;
    }
    return { value, report: { applied, skipped } };
  }

  Object.assign(A, { captureTransforms, staleTransforms, instanceMatrix });
  Object.assign(A.operations, {
    'anim.captureTransforms': {
      inputs: { source: 'array<record>' }, outputs: { value: 'array<record>' },
      run({ source }) { return { value: captureTransforms(source) }; }
    },
    'anim.staleTransforms': {
      inputs: { source: 'array<record>', edits: 'array<record>', snapshots: { type: 'record', default: {} },
        options: { type: 'record', default: {} } },
      outputs: { value: 'array<record>', report: 'record' },
      run({ source, edits, snapshots, options }) { return staleTransforms(source, edits, { ...options, snapshots }); }
    }
  });
})(KIT);
