/* Discrete seeded grids, associative pattern recall, and shared glyph artwork. */
(function (K) {
  const { hash } = K.procedural.data;
  const finite = Number.isFinite;
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const unit = value => finite(value) && value >= 0 && value <= 1;
  const record = value => value != null && Object.getPrototypeOf(value) === Object.prototype;
  const sequence = value => Array.isArray(value) || ArrayBuffer.isView(value) && Number.isSafeInteger(value.length);
  const check = (ok, message) => { if (!ok) throw new RangeError('Glyph grid: ' + message); };
  const cardinal = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const moore = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const maxCells = 65536, maxWork = 32000000;
  const shuffle = (values, random) => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  function dimensions(width, height, states) {
    check(integer(width, 1, 1024) && integer(height, 1, 1024) && width * height <= maxCells &&
      integer(states, 2, 256), 'expected bounded dimensions and 2–256 states');
  }

  function packed(values, size, states) {
    check(sequence(values) && values.length === size, 'expected one state per cell');
    return Uint8Array.from(values, value => {
      check(integer(value, 0, states - 1), 'cell state is outside the alphabet');
      return value;
    });
  }

  function offsetsFor(neighborhood) {
    if (neighborhood === 'moore') return moore;
    if (neighborhood === 'cardinal') return cardinal;
    check(Array.isArray(neighborhood) && integer(neighborhood.length, 1, 32) &&
      Array.from(neighborhood).every(point => Array.isArray(point) && point.length === 2 &&
        Array.from(point).every(n => integer(n, -16, 16)) && (point[0] || point[1])) &&
      new Set(neighborhood.map(point => point.join(','))).size === neighborhood.length,
    'expected distinct nonzero neighborhood offsets');
    return neighborhood.map(point => point.slice());
  }

  function create({ width, height, states = 2, initial = 0, seed = 0, rule,
    neighborhood = 'moore', boundary = 'empty', patterns = [] } = {}) {
    dimensions(width, height, states);
    check(Number.isSafeInteger(seed) && (rule === undefined || typeof rule === 'function') &&
      ['empty', 'wrap'].includes(boundary), 'expected a seed, synchronous rule and valid boundary');
    const size = width * height, offsets = offsetsFor(neighborhood);
    const state = value => integer(value, 0, states - 1);
    const randomAt = (scope, index) => K.grow.dice(scope ^ Math.imul(index + 1, 0x9e3779b1));
    const at = (x, y) => integer(x, 0, width - 1) && integer(y, 0, height - 1);
    const index = (x, y) => y * width + x;
    const seedInitial = hash('glyph-grid/initial', seed);
    let start;
    if (typeof initial === 'function') {
      start = packed(Array.from({ length: size }, (_, i) =>
        initial({ x: i % width, y: Math.floor(i / width), random: randomAt(seedInitial, i) })), size, states);
    } else if (sequence(initial)) start = packed(initial, size, states);
    else {
      check(state(initial), 'initial state is outside the alphabet');
      start = new Uint8Array(size).fill(initial);
    }

    let cells = start.slice(), locked = new Uint8Array(size), memories = [], tick = 0, revision = 0, busy = false;
    const available = () => check(!busy, 'cannot edit the grid during a rule or recall');
    function remember(items) {
      check(Array.isArray(items) && items.length <= 32 && items.length * size <= (1 << 20),
        'pattern memory exceeds its budget');
      return Array.from(items, entry => {
        const { cells, weight = 1 } = sequence(entry) ? { cells: entry } : entry ?? {};
        check(unit(weight), 'pattern weight must be in [0, 1]');
        return { cells: packed(cells, size, states), weight };
      });
    }
    memories = remember(patterns);

    function learn(items) {
      available();
      memories = remember(items);
      revision++;
    }

    function edit(changes) {
      available();
      check(Array.isArray(changes) && changes.length <= maxCells, 'expected a bounded edit list');
      const edits = Array.from(changes, item => {
        check(record(item) && at(item.x, item.y) && Object.keys(item).every(key =>
          ['x', 'y', 'state', 'locked'].includes(key)) && (item.state !== undefined || item.locked !== undefined) &&
          (item.state === undefined || state(item.state)) && (item.locked === undefined || typeof item.locked === 'boolean'),
        'each edit needs valid coordinates and a state or lock');
        return { ...item, i: index(item.x, item.y) };
      });
      for (const change of edits) {
        if (change.state !== undefined) cells[change.i] = change.state;
        if (change.locked !== undefined) locked[change.i] = Number(change.locked);
      }
      if (edits.length) revision++;
    }

    function advance(steps, work, evolve) {
      available();
      check(integer(steps, 1, 10000) && steps * work <= maxWork && Number.isSafeInteger(tick + steps),
        'updates exceed the step budget');
      busy = true;
      try {
        let next = cells.slice();
        for (let j = 1; j <= steps; j++) next = evolve(next, tick + j);
        cells = next;
        tick += steps;
        revision++;
      } finally {
        busy = false;
      }
      return tick;
    }

    function neighbor(cells, x, y) {
      if (boundary === 'wrap') return cells[index((x % width + width) % width, (y % height + height) % height)];
      return at(x, y) ? cells[index(x, y)] : 0;
    }

    function step(steps = 1, update = rule) {
      check(typeof update === 'function', 'step needs a synchronous neighborhood rule');
      return advance(steps, size * (offsets.length + 1), (current, tick) => {
        const next = current.slice(), scope = hash('glyph-grid/rule/' + tick, seed);
        for (let i = 0; i < size; i++) {
          if (locked[i]) continue;
          const x = i % width, y = Math.floor(i / width), previous = current[i];
          const value = update({ x, y, state: previous, tick, random: randomAt(scope, i),
            neighbors: offsets.map(([dx, dy]) => neighbor(current, x + dx, y + dy)) });
          check(state(value), 'a rule must return a valid cell state');
          next[i] = value;
        }
        return next;
      });
    }

    // The overlap excludes the cell being updated, so locks provide evidence instead of self-coupling.
    function recall(steps = 1, { fraction = 1, temperature = 0 } = {}) {
      check(memories.length > 0 && unit(temperature) && unit(fraction) && fraction > 0,
        'recall needs learned patterns, a positive fraction and temperature in [0, 1]');
      return advance(steps, size * (memories.length + 1) + Math.ceil(size * fraction) * (states + memories.length),
        (current, tick) => {
          const random = K.grow.dice(hash('glyph-grid/recall/' + tick, seed));
          const order = shuffle(Array.from({ length: size }, (_, i) => i).filter(i => !locked[i]), random);
          const overlaps = memories.map(pattern => current.reduce((sum, value, i) => sum + Number(value === pattern.cells[i]), 0));
          const scores = new Float64Array(states);
          const count = Math.ceil(order.length * fraction), baseline = (size - 1) / states;
          const divisor = Math.max(1, (size - 1) * memories.length);
          for (let n = 0; n < count; n++) {
            const i = order[n], previous = current[i];
            scores.fill(0);
            for (let j = 0; j < memories.length; j++) {
              const pattern = memories[j], target = pattern.cells[i];
              const matching = overlaps[j] - Number(previous === target);
              scores[target] += pattern.weight * (matching - baseline) / divisor;
            }
            if (temperature) for (let state = 0; state < states; state++) scores[state] += (random() - .5) * temperature;
            let best = previous;
            for (let state = 0; state < states; state++) if (scores[state] > scores[best]) best = state;
            if (best === previous) continue;
            for (let j = 0; j < memories.length; j++) {
              const target = memories[j].cells[i];
              overlaps[j] += Number(best === target) - Number(previous === target);
            }
            current[i] = best;
          }
          return current;
        });
    }

    return Object.freeze({
      width, height, states, edit, learn, step, recall,
      get tick() { return tick; },
      get revision() { return revision; },
      get(x, y) {
        check(at(x, y), 'cell coordinates are out of bounds');
        return cells[index(x, y)];
      },
      snapshot() { return Object.freeze({ width, height, states, tick, cells: cells.slice(), locked: locked.slice() }); },
      restore(snapshot) {
        available();
        check(snapshot?.width === width && snapshot.height === height && snapshot.states === states &&
          integer(snapshot.tick, 0, Number.MAX_SAFE_INTEGER), 'snapshot is incompatible');
        const next = packed(snapshot.cells, size, states), pins = packed(snapshot.locked, size, 2);
        cells = next;
        locked = pins;
        tick = snapshot.tick;
        revision++;
      },
      reset() {
        available();
        cells = start.slice();
        locked = new Uint8Array(size);
        tick = 0;
        revision++;
      }
    });
  }

  function life({ birth = [3], survive = [2, 3] } = {}) {
    for (const list of [birth, survive])
      check(Array.isArray(list) && Array.from(list).every(n => integer(n, 0, 32)), 'invalid life rule');
    const births = new Set(birth), remains = new Set(survive);
    return ({ state, neighbors }) => Number((state ? remains : births)
      .has(neighbors.reduce((n, value) => n + Number(value !== 0), 0)));
  }

  function paint({ mode = 'glyph', tiles, glyphs } = {}) {
    check(['glyph', 'pixel'].includes(mode) && Array.isArray(tiles) && integer(tiles.length, 2, 256) &&
      (glyphs === undefined || record(glyphs) && Object.keys(glyphs).length <= 256),
    'paint needs a glyph or pixel mode and a tile for each state');
    const font = mode === 'glyph' ? TargetInspection.font(K.ascii.atlas(), glyphs) : null;
    const cellW = font ? 6 : 1, cellH = font ? 8 : 1;
    const parsed = Array.from(tiles, tile => {
      if (tile === null) return null;
      check(record(tile) && Object.keys(tile).every(key => ['glyph', 'color', 'background'].includes(key)) &&
        (font ? typeof tile.glyph === 'string' && font.has(tile.glyph) : tile.glyph === undefined),
      'each tile needs a known glyph in glyph mode and a valid color');
      return { bits: font?.get(tile.glyph), fg: DrawingPrimitives.color(tile.color),
        bg: tile.background === undefined ? null : DrawingPrimitives.color(tile.background) };
    });
    function layout(frame) {
      dimensions(frame?.width, frame?.height, frame?.states);
      check(frame.states === parsed.length && sequence(frame.cells) && frame.cells.length === frame.width * frame.height &&
        (Array.isArray(frame.cells) ? Array.from(frame.cells) : frame.cells)
          .every(n => integer(n, 0, parsed.length - 1)), 'frame and tile alphabet must match');
      return { w: frame.width * cellW, h: frame.height * cellH };
    }
    function pixels(frame, background, visit) {
      for (let i = 0; i < frame.cells.length; i++) {
        const tile = parsed[frame.cells[i]];
        if (!tile) continue;
        const x = (i % frame.width) * cellW, y = Math.floor(i / frame.width) * cellH;
        for (let v = 0; v < cellH; v++) for (let u = 0; u < cellW; u++) {
          const ink = !tile.bits || tile.bits[v * cellW + u] ? tile.fg : background ? tile.bg : null;
          if (ink?.[3] && visit(x + u, y + v, ink) === false) return false;
        }
      }
      return true;
    }
    function raster(frame, { scale = 1 } = {}) {
      const size = layout(frame), w = size.w * scale, h = size.h * scale;
      check(integer(scale, 1, 8) && w * h <= (1 << 22), 'raster exceeds its pixel budget');
      const rgba = new Uint8Array(w * h * 4);
      pixels(frame, true, (x, y, ink) => {
        for (let v = 0; v < scale; v++)
          for (let u = 0; u < scale; u++) rgba.set(ink, ((y * scale + v) * w + x * scale + u) * 4);
      });
      return { w, h, rgba };
    }
    function emit(frame, draw, { origin = [0, 0, 0], across = [.05, 0, 0], down = [0, -.05, 0],
      width, density = 1, emissive = true, depth = true, background = false, maxSplats = 16384 } = {}) {
      const size = layout(frame);
      const vector = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(finite);
      check([origin, across, down].every(vector) && K.V.len(K.V.cross(across, down)) > 1e-12 &&
        K.V.mad(K.V.mad(origin, across, size.w), down, size.h).every(finite) &&
        (width === undefined || finite(width) && width > 0) && finite(density) && density >= 0 &&
        typeof draw?.point === 'function' && [emissive, depth, background].every(value => typeof value === 'boolean') &&
        integer(maxSplats, 1, 100000), 'invalid splat draw settings');
      width ??= .43 * Math.min(K.V.len(across), K.V.len(down));
      let emitted = 0;
      const complete = pixels(frame, background, (x, y, ink) => {
        if (!density) return;
        if (emitted === maxSplats) return false;
        const position = K.V.mad(K.V.mad(origin, across, x + .5), down, y + .5);
        if (draw.point(position, { width, rgb: ink.slice(0, 3).map(n => n / 255),
          density: density * (ink[3] / 255), emissive, depth }) === false) return false;
        emitted++;
      });
      return { emitted, truncated: !complete };
    }
    return Object.freeze({ raster, emit });
  }

  K.glyphGrid = Object.freeze({ create, paint, rules: Object.freeze({ life }) });
})(KIT);
