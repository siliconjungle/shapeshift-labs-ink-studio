// Rest-space brush masks and named sets carried by the extracted surface.
(function (K) {
  const P = K.procedural, { freeze, clone } = P.data;
  const format = 'ink-studio/sculpt-masks';
  const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => names.includes(key));
  const xyz = value => Array.isArray(value) && value.length === 3 &&
    Array.from(value).every(n => Number.isFinite(n) && Math.abs(n) <= 1e8);
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const name = id => typeof id === 'string' && /^[a-zA-Z0-9][\w.-]{0,63}$/.test(id);
  const positive = n => Number.isFinite(n) && n > 0 && n <= 1e8;
  const ids = (value, known) => Array.isArray(value) && Array.from(value).every(id => known.has(id)) &&
    new Set(value).size === value.length;

  function volume(raw) {
    if (fields(raw, ['kind', 'min', 'max']) && raw.kind === 'box' &&
        xyz(raw.min) && xyz(raw.max) && raw.min.every((n, i) => n < raw.max[i])) {
      const [cx, cy, cz] = raw.min.map((n, i) => (n + raw.max[i]) / 2);
      const [hx, hy, hz] = raw.max.map((n, i) => (n - raw.min[i]) / 2);
      return ([x, y, z]) => {
        const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy, dz = Math.abs(z - cz) - hz;
        return Math.hypot(Math.max(0, dx), Math.max(0, dy), Math.max(0, dz)) + Math.min(0, Math.max(dx, dy, dz));
      };
    }
    if (fields(raw, ['kind', 'center', 'radius']) && raw.kind === 'sphere' && xyz(raw.center) && positive(raw.radius)) {
      const [x, y, z] = raw.center, radius = raw.radius;
      return p => Math.hypot(p[0] - x, p[1] - y, p[2] - z) - radius;
    }
    throw new TypeError('A sculpt volume needs a box with min/max or a sphere with center/radius');
  }

  function prepare(raw = {}) {
    if (!fields(raw, ['format', 'version', 'masks', 'faceSets', 'controls']) ||
        (raw.format ?? format) !== format || (raw.version ?? 1) !== 1)
      throw new TypeError('Use a version 1 sculpt mask document');
    const { masks = [], faceSets = [], controls = {} } = raw;
    if (!Array.isArray(masks) || masks.length > 32 || !Array.isArray(faceSets) || faceSets.length > 32 ||
        !fields(controls, ['isolate', 'locked', 'hidden']))
      throw new TypeError('Use up to 32 sculpt masks and face sets with named editing controls');
    const maskRows = new Map(), sets = new Map();
    for (const row of masks) {
      if (!fields(row, ['id', 'volumes', 'feather', 'strength']) || !name(row.id) || maskRows.has(row.id) ||
          !Array.isArray(row.volumes) || !row.volumes.length || row.volumes.length > 24 ||
          row.feather !== undefined && row.feather !== 0 && !positive(row.feather) ||
          row.strength !== undefined && !unit(row.strength))
        throw new RangeError('A sculpt mask needs a unique ID, one to 24 volumes, and optional feather and strength');
      Array.from(row.volumes, volume);
      maskRows.set(row.id, row);
    }
    for (const row of faceSets) {
      if (!fields(row, ['id', 'mask']) || !name(row.id) || sets.has(row.id) || !maskRows.has(row.mask))
        throw new RangeError('A face set needs a unique ID and a known rest-space mask');
      sets.set(row.id, maskRows.get(row.mask));
    }
    const normalized = Object.fromEntries(['isolate', 'locked', 'hidden'].map(key => {
      const list = controls[key] ?? [];
      if (!ids(list, sets)) throw new RangeError('Sculpt ' + key + ' needs distinct face set IDs');
      return [key, list];
    }));
    return freeze(clone({ format, version: 1, masks, faceSets, controls: normalized }));
  }

  function compile(raw) {
    const document = prepare(raw), { controls } = document;
    const masks = new Map(document.masks.map(row => {
      const shapes = row.volumes.map(volume);
      const distance = p => shapes.reduce((nearest, shape) => Math.min(nearest, shape(p)), Infinity);
      function weight(p) {
        const d = distance(p), edge = row.feather ?? 0;
        if (d > 0) return 0;
        const u = edge ? Math.min(1, Math.max(0, -d / edge)) : 1;
        return u * u * (3 - 2 * u) * (row.strength ?? 1);
      }
      return [row.id, { distance, weight }];
    }));
    const sets = new Map(document.faceSets.map(({ id, mask }) => [id, masks.get(mask)]));
    const blend = (list, p) => list.reduce((best, row) => Math.max(best, row.weight(p)), 0);
    const locked = controls.locked.map(id => [id, sets.get(id)]), hidden = controls.hidden.map(id => [id, sets.get(id)]);
    const isolated = controls.isolate.map(id => sets.get(id));
    const visible = memberships => !controls.hidden.some(id => memberships.includes(id)) &&
      (!controls.isolate.length || controls.isolate.some(id => memberships.includes(id)));

    function membership(p) {
      return [...sets].filter(([, mask]) => mask.distance(p) <= 0).map(([id]) => id);
    }

    function sampler(selection, padding = 0) {
      if (selection !== undefined && (!ids(selection, masks) || !selection.length))
        throw new RangeError('Choose a nonempty list of distinct sculpt mask IDs');
      const chosen = selection?.map(id => masks.get(id));
      return p => {
        const lock = locked.find(([, mask]) => mask.distance(p) <= padding);
        if (lock) return { weight: 0, reason: 'locked', faceSet: lock[0] };
        const hide = hidden.find(([, mask]) => mask.distance(p) <= 0);
        if (hide) return { weight: 0, reason: 'hidden', faceSet: hide[0] };
        const current = isolated.length ? blend(isolated, p) : 1;
        const weight = Math.min(current, chosen ? blend(chosen, p) : 1);
        return { weight, ...(weight === 0 && { reason: current === 0 ? 'outside-isolation' : 'outside-selection' }) };
      };
    }
    return { document, membership, visible, sampler,
      visibilityActive: controls.hidden.length > 0 || controls.isolate.length > 0 };
  }

  function field(shape) {
    const signed = volume(shape);
    return (x, y, z) => signed([x, y, z]);
  }

  P.sculptMasks = Object.freeze({ prepare, compile, field });
})(KIT);
