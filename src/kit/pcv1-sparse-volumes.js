/* Portable sparse voxel fields with a shared, axis-aligned sampling lattice. */
(function (K) {
  const P = K.procedural;
  const { freeze } = P.data;
  const format = 'ink-studio/sparse-volume', denseFormat = 'ink-studio/dense-volume';
  const components = Object.freeze({ density: 1, temperature: 1, velocity: 3, signedDistance: 1, fuel: 1, vapor: 1 });
  const names = Object.keys(components), states = new WeakMap();
  const limits = Object.freeze({ cells: 1000000, storedComponents: 2000000, bricks: 131072 });
  const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
  const vector = (v, size, test) => Array.isArray(v) && v.length === size && Array.from(v).every(test);
  const record = v => v && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const fieldsOnly = (v, keys) => record(v) && Object.keys(v).every(key => keys.includes(key));
  const list = v => Array.isArray(v) || ArrayBuffer.isView(v) && typeof v.length === 'number';
  const same = (a, b) => a.every((n, axis) => n === b[axis]);
  const coordinate = n => Number.isFinite(n) && Math.abs(n) <= 1e7;
  const keyOf = p => p.join('/');
  const product = values => values.reduce((a, b) => a * b, 1);
  const order = (a, b) => a.at[2] - b.at[2] || a.at[1] - b.at[1] || a.at[0] - b.at[0];
  function need(ok, message) {
    if (!ok) throw new RangeError('Sparse volume: ' + message);
  }

  function lattice(source) {
    need(fieldsOnly(source, ['origin', 'spacing', 'size']), 'expected a grid origin, spacing and size');
    const { origin, spacing, size } = source;
    need(vector(origin, 3, coordinate) && vector(spacing, 3, x => Number.isFinite(x) && x >= 1e-5 && x <= 1e5) &&
      vector(size, 3, x => integer(x, 1, 100000)) &&
      origin.every((n, i) => coordinate(n + spacing[i] * size[i])), 'invalid grid coordinates or dimensions');
    return { origin: origin.slice(), spacing: spacing.slice(), size: size.slice() };
  }

  function normalize(name, value) {
    const n = Math.fround(typeof value === 'number' ? value : NaN);
    need(Number.isFinite(n) && (!['density', 'fuel', 'vapor'].includes(name) || value >= 0), 'invalid ' + name + ' component');
    return n || 0;
  }

  const tuple = (name, value) => components[name] === 1
    ? [normalize(name, value)]
    : (need(vector(value, 3, Number.isFinite), 'velocity needs XYZ components'), value.map(n => normalize(name, n)));

  function specifications(source) {
    need(fieldsOnly(source, names) && Object.keys(source).length > 0, 'expected one or more supported fields');
    return Object.fromEntries(names.filter(name => Object.hasOwn(source, name)).map(name => {
      const row = source[name];
      need(fieldsOnly(row, ['background', 'units']) &&
        (row.units === undefined || typeof row.units === 'string' && row.units.trim() && row.units.length <= 64),
      'invalid ' + name + ' descriptor');
      const value = row.background === undefined ? (name === 'signedDistance' ? 1 : components[name] === 3 ? [0, 0, 0] : 0)
        : row.background;
      const normalized = tuple(name, value);
      need(name !== 'signedDistance' || normalized[0] > 0, 'signedDistance needs a positive outside background');
      return [name, { background: components[name] === 1 ? normalized[0] : normalized, ...(row.units && { units: row.units }) }];
    }));
  }

  const descriptors = fields => Object.fromEntries(Object.entries(fields).map(([name, row]) =>
    [name, { ...row, base: components[name] === 1 ? [row.background] : row.background, width: components[name] }]));

  function brickIndex(at, side) {
    return at[0] + side * (at[1] + side * at[2]);
  }

  function xyz(index, [nx, ny]) {
    return [index % nx, Math.floor(index / nx) % ny, Math.floor(index / (nx * ny))];
  }

  function writer(grid, brickSize, fields) {
    need(integer(brickSize, 2, 16), 'brick size must be an integer from 2 to 16');
    const bricks = new Map(), specs = descriptors(fields);
    let stored = 0;
    function append(at, slot, name, value) {
      const { base, width } = specs[name];
      if (same(value, base)) return;
      stored += width;
      need(stored <= limits.storedComponents, 'output exceeds the stored component limit');
      const key = keyOf(at);
      let brick = bricks.get(key);
      if (!brick) {
        need(bricks.size < limits.bricks, 'output exceeds the brick limit');
        brick = { at: at.slice(), fields: {} };
        bricks.set(key, brick);
      }
      const runs = brick.fields[name] ?? (brick.fields[name] = []), last = runs.at(-1);
      if (last && last.start + last.values.length / width === slot) last.values.push(...value);
      else runs.push({ start: slot, values: value.slice() });
    }
    function set(index, name, value) {
      const at = index.map(i => Math.floor(i / brickSize));
      append(at, brickIndex(index.map(i => i % brickSize), brickSize), name, tuple(name, value));
    }
    function finish() {
      const rows = [...bricks.values()].sort(order);
      for (const row of rows) row.fields = Object.fromEntries(names.filter(n => row.fields[n]).map(n => [n, row.fields[n]]));
      const document = freeze({ format, version: 1, grid, brickSize, fields, bricks: rows });
      states.set(document, { bricks, specs, stored });
      return document;
    }
    return { append, set, finish };
  }

  function create(source) {
    if (states.has(source)) return source;
    need(fieldsOnly(source, ['format', 'version', 'grid', 'fields', 'brickSize', 'bricks']) &&
      source.format === format && source.version === 1 &&
      Array.isArray(source.bricks) && source.bricks.length <= limits.bricks, 'expected a bounded version 1 sparse volume');
    const grid = lattice(source.grid), fields = specifications(source.fields), { brickSize } = source;
    const out = writer(grid, brickSize, fields), seen = new Set(), inside = grid.size.map(n => Math.ceil(n / brickSize));
    const extent = [brickSize, brickSize], capacity = brickSize ** 3;
    let count = 0;
    for (const row of source.bricks) {
      need(fieldsOnly(row, ['at', 'fields']) && vector(row.at, 3, n => integer(n, 0, 100000)) &&
        row.at.every((n, i) => n < inside[i]) && fieldsOnly(row.fields, Object.keys(fields)) &&
        Object.keys(row.fields).length > 0, 'invalid brick coordinates or field list');
      const { at } = row, key = keyOf(at);
      need(!seen.has(key), 'duplicate brick at ' + key);
      seen.add(key);
      for (const [name, runs] of Object.entries(row.fields)) {
        const width = components[name];
        need(Array.isArray(runs) && runs.length > 0 && runs.length <= capacity, 'invalid brick runs');
        let end = 0;
        for (const run of runs) {
          need(fieldsOnly(run, ['start', 'values']) && integer(run.start, end, capacity - 1) &&
            Array.isArray(run.values) && run.values.length > 0 && run.values.length % width === 0 &&
            run.start + run.values.length / width <= capacity, 'overlapping, unsorted or out-of-range brick run');
          count += run.values.length;
          need(count <= limits.storedComponents, 'input exceeds the stored component limit');
          end = run.start + run.values.length / width;
          for (let slot = run.start; slot < end; slot++) {
            need(xyz(slot, extent).every((n, i) => at[i] * brickSize + n < grid.size[i]),
              'brick run extends outside the logical grid');
            const base = (slot - run.start) * width;
            const value = Array.from({ length: width }, (_, i) => normalize(name, run.values[base + i]));
            out.append(at, slot, name, value);
          }
        }
      }
    }
    return out.finish();
  }

  function selected(fields, requested = Object.keys(fields)) {
    need(Array.isArray(requested) && requested.length >= 1 && requested.length <= names.length &&
      new Set(requested).size === requested.length && Array.from(requested).every(n => Object.hasOwn(fields, n)),
    'field selection must name distinct declared fields');
    return Object.fromEntries(Object.keys(fields).filter(n => requested.includes(n)).map(n => [n, fields[n]]));
  }

  function bounds({ grid }, halo = 0) {
    return { min: grid.origin.map((n, i) => n - halo * grid.spacing[i]),
      max: grid.origin.map((n, i) => n + (grid.size[i] + halo) * grid.spacing[i]) };
  }

  function inspect(source) {
    const doc = create(source), { specs, stored } = states.get(doc), { grid, brickSize } = doc;
    const logicalCells = product(grid.size);
    const fields = Object.fromEntries(Object.entries(specs).map(([name, { base }]) => [name, {
      ...doc.fields[name], stored: 0, bricks: 0, range: null, activeIndexBounds: null,
      low: base.map(() => Infinity), high: base.map(() => -Infinity)
    }]));
    for (const brick of doc.bricks) for (const [name, runs] of Object.entries(brick.fields)) {
      const row = fields[name], width = components[name];
      row.bricks++;
      row.activeIndexBounds ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      const { min, max } = row.activeIndexBounds;
      for (const run of runs) for (let i = 0; i < run.values.length; i += width) {
        const p = xyz(run.start + i / width, [brickSize, brickSize]);
        for (let k = 0; k < width; k++) {
          row.low[k] = Math.min(row.low[k], run.values[i + k]);
          row.high[k] = Math.max(row.high[k], run.values[i + k]);
        }
        for (let k = 0; k < 3; k++) {
          const n = brick.at[k] * brickSize + p[k];
          min[k] = Math.min(min[k], n);
          max[k] = Math.max(max[k], n);
        }
        row.stored++;
      }
    }
    for (const [name, row] of Object.entries(fields)) {
      const { base, width } = specs[name];
      if (row.stored < logicalCells) for (let k = 0; k < width; k++) {
        row.low[k] = Math.min(row.low[k], base[k]);
        row.high[k] = Math.max(row.high[k], base[k]);
      }
      row.range = { min: width === 1 ? row.low[0] : row.low, max: width === 1 ? row.high[0] : row.high };
      delete row.low;
      delete row.high;
    }
    return { format, grid, bounds: bounds(doc), brickSize, logicalCells, bricks: doc.bricks.length,
      storedComponents: stored, fields };
  }

  function findRun(runs, slot, width) {
    let first = 0, end = runs?.length ?? 0;
    while (first < end) {
      const i = (first + end) >> 1, run = runs[i], offset = slot - run.start;
      if (offset < 0) end = i;
      else if (offset * width >= run.values.length) first = i + 1;
      else return run.values.slice(offset * width, (offset + 1) * width);
    }
  }

  function sampler(source, { filter = 'linear' } = {}) {
    const document = create(source), { grid, brickSize, fields } = document;
    const { bricks, specs } = states.get(document);
    need(['linear', 'nearest'].includes(filter), 'unknown sample filter');
    function lookup(index, name) {
      const { base, width } = specs[name];
      if (index.some((n, k) => n < 0 || n >= grid.size[k])) return base;
      const key = keyOf(index.map(n => Math.floor(n / brickSize)));
      const slot = brickIndex(index.map(n => n % brickSize), brickSize);
      return findRun(bricks.get(key)?.fields[name], slot, width) ?? base;
    }
    function sample(name, point) {
      need(Object.hasOwn(specs, name) && vector(point, 3, Number.isFinite), 'sample needs a declared field and finite XYZ');
      const { base, width } = specs[name];
      const q = point.map((n, k) => {
        const p = (n - grid.origin[k]) / grid.spacing[k] - .5, nearby = Math.round(p);
        const error = Number.EPSILON * 4 * Math.max(Math.abs(n), Math.abs(grid.origin[k])) / grid.spacing[k] + 1e-12;
        return Math.abs(p - nearby) <= error ? nearby : p;
      });
      let value;
      if (q.some((n, k) => n <= -1 || n >= grid.size[k])) value = base;
      else if (filter === 'nearest') value = lookup(q.map(n => Math.floor(n + .5)), name);
      else {
        const i = q.map(Math.floor), a = q.map((n, j) => n - i[j]);
        value = Array(width).fill(0);
        let present = false;
        for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          const weight = (x ? a[0] : 1 - a[0]) * (y ? a[1] : 1 - a[1]) * (z ? a[2] : 1 - a[2]);
          if (!weight) continue;
          const v = lookup([i[0] + x, i[1] + y, i[2] + z], name);
          present ||= v !== base;
          for (let k = 0; k < width; k++) value[k] += weight * v[k];
        }
        if (!present) value = base;
      }
      return width === 1 ? value[0] : value.slice();
    }
    function field(name) {
      need(Object.hasOwn(fields, name), 'unknown field ' + name);
      return K.fieldViews.source({ type: components[name] === 1 ? 'number' : 'vec3',
        units: fields[name].units ?? null, bounds: bounds(document, .5), sample: (...p) => sample(name, p) });
    }
    function density() {
      need(fields.density?.background === 0, 'renderable density requires a zero background');
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const row of document.bricks) {
        if (!row.fields.density) continue;
        for (let k = 0; k < 3; k++) {
          const first = row.at[k] * brickSize, end = Math.min(grid.size[k], first + brickSize);
          min[k] = Math.min(min[k], grid.origin[k] + (first - .5) * grid.spacing[k]);
          max[k] = Math.max(max[k], grid.origin[k] + (end + .5) * grid.spacing[k]);
        }
      }
      if (min[0] === Infinity) return P.density.bounded({ bounds: bounds(document), sample: () => 0 });
      return P.density.bounded({ bounds: { min, max }, sample: (x, y, z) => sample('density', [x, y, z]) });
    }
    return Object.freeze({ sample, field, density });
  }

  const defaults = { density: 'max', temperature: 'lerp', velocity: 'lerp', signedDistance: 'union', fuel: 'add', vapor: 'add' };
  const ops = { density: ['min', 'max', 'add', 'multiply', 'lerp'], temperature: ['min', 'max', 'add', 'lerp'],
    velocity: ['add', 'lerp'], signedDistance: ['union', 'intersect', 'subtract'],
    fuel: ['min', 'max', 'add', 'multiply', 'lerp'], vapor: ['min', 'max', 'add', 'multiply', 'lerp'] };

  function combine(left, right, options = {}) {
    const a = create(left), b = create(right);
    need(fieldsOnly(options, ['operations', 'mix', 'maxSamples']), 'unknown combine setting');
    const { operations = {}, mix = .5, maxSamples = limits.storedComponents } = options;
    need(fieldsOnly(operations, names) && Number.isFinite(mix) && mix >= 0 && mix <= 1 &&
      integer(maxSamples, 1, 2 * limits.storedComponents), 'invalid operations, mix or sample budget');
    need(a.brickSize === b.brickSize && ['origin', 'spacing', 'size'].every(n => same(a.grid[n], b.grid[n])),
      'combine requires a shared grid and brick size; resample to align');
    const A = states.get(a), B = states.get(b), fields = {}, rules = {}, applied = {};
    for (const name of names) {
      const first = A.specs[name], second = B.specs[name];
      if (first && second) {
        need(first.units === second.units, 'field units differ for ' + name);
        const op = Object.hasOwn(operations, name) ? operations[name] : defaults[name];
        need(ops[name].includes(op), 'unsupported ' + name + ' operation ' + op);
        const fn = {
          min: Math.min, max: Math.max, union: Math.min, intersect: Math.max,
          add: (x, y) => x + y, multiply: (x, y) => x * y, lerp: (x, y) => x * (1 - mix) + y * mix,
          subtract: (x, y) => Math.max(x, -y)
        }[op];
        rules[name] = (x, y) => x.map((n, k) => normalize(name, fn(n, y[k])));
        const value = rules[name](first.base, second.base);
        fields[name] = { ...a.fields[name], background: first.width === 1 ? value[0] : value };
        applied[name] = op;
      } else {
        need(!Object.hasOwn(operations, name), 'operation requires ' + name + ' on both inputs');
        if (first || second) {
          fields[name] = (first ? a : b).fields[name];
          applied[name] = first ? 'left' : 'right';
        }
      }
    }
    const out = writer(a.grid, a.brickSize, specifications(fields));
    let work = 0;
    for (const key of new Set([...A.bricks.keys(), ...B.bricks.keys()])) {
      const first = A.bricks.get(key), second = B.bricks.get(key), at = (first ?? second).at;
      for (const name of Object.keys(fields)) {
        const x = first?.fields[name] ?? [], y = second?.fields[name] ?? [], width = components[name];
        if (!x.length && !y.length) continue;
        const indices = new Set();
        for (const run of [...x, ...y]) {
          const size = run.values.length / width;
          for (let i = 0; i < size; i++) indices.add(run.start + i);
        }
        work += indices.size;
        need(work <= maxSamples, 'combine exceeds its active sample budget');
        for (const slot of [...indices].sort((a, b) => a - b)) {
          const l = findRun(x, slot, width), r = findRun(y, slot, width);
          const value = rules[name] ? rules[name](l ?? A.specs[name].base, r ?? B.specs[name].base) : l ?? r;
          out.append(at, slot, name, value);
        }
      }
    }
    const document = out.finish();
    return { document, report: { operations: applied, mix, work, maxSamples, bricks: document.bricks.length,
      storedComponents: states.get(document).stored } };
  }

  function cellBudget(grid, maxCells) {
    const cells = product(grid.size);
    need(integer(maxCells, 1, limits.cells) && cells <= maxCells, 'grid exceeds the cell budget');
    return cells;
  }

  function bake({ grid: target, brickSize = 8, fields: requested, maxCells = 250000 } = {}, sample) {
    const grid = lattice(target), fields = specifications(requested), cells = cellBudget(grid, maxCells);
    need(typeof sample === 'function', 'bake needs a field sampler');
    const out = writer(grid, brickSize, fields), channels = Object.keys(fields);
    for (let slot = 0; slot < cells; slot++) {
      const index = xyz(slot, grid.size), point = index.map((n, k) => grid.origin[k] + (n + .5) * grid.spacing[k]);
      for (const name of channels) out.set(index, name, sample(name, point, slot));
    }
    const document = out.finish();
    return { document, report: { cells, maxCells, fieldSamples: cells * channels.length, bricks: document.bricks.length,
      storedComponents: states.get(document).stored } };
  }

  function bakeSparse({ grid: target, brickSize = 8, fields: requested, maxCells = 250000 } = {}, indices, sample) {
    const grid = lattice(target), fields = specifications(requested), logicalCells = product(grid.size);
    need(integer(maxCells, 1, limits.cells) && indices && typeof indices[Symbol.iterator] === 'function' &&
      typeof sample === 'function', 'sparse bake needs a cell budget, ordered indices and sampler');
    const out = writer(grid, brickSize, fields), channels = Object.keys(fields);
    let visited = 0, previous = -1;
    for (const slot of indices) {
      need(integer(slot, previous + 1, logicalCells - 1), 'sparse bake indices must increase within the grid');
      need(++visited <= maxCells, 'sparse bake exceeds its cell visit budget');
      const index = xyz(slot, grid.size), point = index.map((n, k) => grid.origin[k] + (n + .5) * grid.spacing[k]);
      for (const name of channels) out.set(index, name, sample(name, point, slot));
      previous = slot;
    }
    const document = out.finish();
    return { document, report: { logicalCells, visited, maxCells, fieldSamples: visited * channels.length,
      bricks: document.bricks.length, storedComponents: states.get(document).stored } };
  }

  function resample(source, options) {
    const doc = create(source);
    need(fieldsOnly(options, ['grid', 'brickSize', 'channels', 'filter', 'maxCells']), 'unknown resample setting');
    const { grid, brickSize = doc.brickSize, channels, filter = 'linear', maxCells } = options;
    const fields = selected(doc.fields, channels), read = sampler(doc, { filter });
    const { document, report } = bake({ grid, brickSize, fields, maxCells }, read.sample);
    return { document, report: { filter, ...report } };
  }

  function dense(source, { channels, maxCells = 250000 } = {}) {
    const doc = create(source), { grid, brickSize } = doc;
    const fields = selected(doc.fields, channels), cells = cellBudget(grid, maxCells);
    const { specs } = states.get(doc), buffers = Object.fromEntries(Object.keys(fields).map(n => [n, []]));
    need(cells * Object.keys(fields).reduce((n, name) => n + components[name], 0) <= 2 * limits.storedComponents,
      'dense export exceeds the component budget');
    for (const [name, values] of Object.entries(buffers)) {
      const { base, width } = specs[name];
      values.length = cells * width;
      for (let k = 0; k < values.length; k++) values[k] = base[k % width];
    }
    const [nx, ny] = grid.size;
    for (const brick of doc.bricks) for (const [name, runs] of Object.entries(brick.fields)) {
      const values = buffers[name], width = components[name];
      if (!values) continue;
      for (const run of runs) for (let i = 0; i < run.values.length; i += width) {
        const [x, y, z] = xyz(run.start + i / width, [brickSize, brickSize]).map((n, k) => n + brick.at[k] * brickSize);
        const base = (x + nx * (y + ny * z)) * width;
        for (let k = 0; k < width; k++) values[base + k] = run.values[i + k];
      }
    }
    return { format: denseFormat, version: 1, grid, brickSize, fields, values: buffers };
  }

  function pack(source, { maxCells = 250000 } = {}) {
    need(fieldsOnly(source, ['format', 'version', 'grid', 'brickSize', 'fields', 'values']) &&
      source.format === denseFormat && source.version === 1, 'expected a version 1 dense volume');
    const grid = lattice(source.grid), fields = specifications(source.fields), cells = cellBudget(grid, maxCells);
    const { values, brickSize } = source, channels = Object.keys(fields);
    need(cells * channels.reduce((n, name) => n + components[name], 0) <= 2 * limits.storedComponents,
      'dense input exceeds the component budget');
    need(fieldsOnly(values, channels) && channels.every(n => list(values[n]) && values[n].length === cells * components[n]),
      'dense field buffers must match the declared grid and components');
    return bake({ grid, fields, brickSize, maxCells }, (name, _, slot) => {
      const width = components[name];
      return width === 1 ? values[name][slot] : Array.from(values[name].slice(slot * width, (slot + 1) * width));
    });
  }

  function extract(source, channels) {
    const doc = create(source), fields = selected(doc.fields, channels);
    if (Object.keys(fields).length === Object.keys(doc.fields).length) return doc;
    const bricks = doc.bricks.flatMap(brick => {
      const runs = Object.entries(brick.fields).filter(([n]) => Object.hasOwn(fields, n));
      return runs.length ? [{ at: brick.at, fields: Object.fromEntries(runs) }] : [];
    });
    return create({ ...doc, fields, bricks });
  }

  P.sparseVolume = Object.freeze({ format, denseFormat, components, limits, create, inspect, sampler, bake, bakeSparse,
    combine, resample, dense, pack, extract });
})(KIT);
