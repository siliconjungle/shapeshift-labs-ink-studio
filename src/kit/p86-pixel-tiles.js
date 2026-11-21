/* Editable, edge-registered stamp cels driven by a seekable pulse graph. */
(function (K) {
  const sides = 'NESW', dx = [0, 1, 0, -1], dy = [-1, 0, 1, 0];
  const templates = [
    { kind: 'cap', ports: 'S', entry: 2 },
    { kind: 'straight', ports: 'NS', entry: 0 },
    { kind: 'bend', ports: 'ES', entry: 2 },
    { kind: 'fork', ports: 'ESW', entry: 2 },
    { kind: 'cross', ports: 'NESW', entry: 2 }
  ];
  const bits = ports => [...ports].reduce((mask, side) => mask | (1 << sides.indexOf(side)), 0);
  const names = mask => [...sides].filter((_, d) => mask & (1 << d)).join('');
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const epsilon = 1e-9;
  function check(ok, message) {
    if (!ok) throw new RangeError('Pixel tiles: ' + message);
  }

  function rotations() {
    const byMask = new Map();
    for (const template of templates) {
      for (const mirror of [false, true]) for (let turn = 0; turn < 4; turn++) {
        const move = d => (turn + (mirror ? 4 - d : d)) % 4;
        const ports = [...template.ports].map(side => sides[move(sides.indexOf(side))]).join('');
        const mask = bits(ports);
        if (!byMask.has(mask)) byMask.set(mask, []);
        byMask.get(mask).push({ template, mirror, turn, entry: move(template.entry) });
      }
    }
    return byMask;
  }
  const variants = rotations();

  function rotate(source, size, { mirror, turn }) {
    if (!mirror && !turn) return source;
    const rgba = new Uint8Array(source.length), last = size - 1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let u = mirror ? last - x : x, v = y;
      for (let j = 0; j < turn; j++) [u, v] = [last - v, u];
      const at = (y * size + x) * 4;
      rgba.set(source.subarray(at, at + 4), (v * size + u) * 4);
    }
    return rgba;
  }

  function checkSockets(slots, size, ports) {
    const last = size - 1, mid = size / 2;
    const edges = [i => i, i => i * size + last, i => last * size + i, i => i * size];
    for (let side = 0; side < 4; side++) for (let i = 0; i < size; i++) {
      const socket = ports.includes(sides[side]) && (i === mid - 1 || i === mid);
      check((slots[edges[side](i)] !== null) === socket, 'cel pixels must match the two center pixels of each ' + ports + ' socket');
    }
  }

  function create({ width, height, size = 10, paths, style = 'copper', clips = {}, swatches,
    forkHold = .08, after = 'idle', cues = [] } = {}, palette = {}) {
    check(integer(width, 1, 4096) && integer(height, 1, 4096) && width * height <= 4096 &&
      integer(size, 4, 32) && size % 2 === 0 && width * height * size * size <= 1048576,
    'expected a bounded grid and an even tile size from 4 to 32');
    check(['copper', 'frost'].includes(style) && record(clips) &&
      Object.keys(clips).every(key => variants.has(bits(key)) && key === names(bits(key))) &&
      Number.isFinite(forkHold) && forkHold >= 0 && forkHold <= 3600 && ['idle', 'hold'].includes(after),
    'expected a style, canonical NESW clip keys, fork hold and idle or hold policy');
    check(Array.isArray(paths) && integer(paths.length, 1, 4096) &&
      Array.isArray(cues) && cues.length <= 32, 'expected routes and at most 32 cues');

    const count = width * height, neighbors = new Map();
    function address(point) {
      check(Array.isArray(point) && point.length === 2 &&
        integer(point[0], 0, width - 1) && integer(point[1], 0, height - 1), 'route and cue coordinates must be inside the grid');
      return point[1] * width + point[0];
    }
    function links(index) {
      if (!neighbors.has(index)) neighbors.set(index, [-1, -1, -1, -1]);
      return neighbors.get(index);
    }
    let work = 0;
    for (const path of paths) {
      check(Array.isArray(path) && integer(path.length, 2, 16384), 'a route needs at least two grid points');
      let a = address(path[0]);
      for (let j = 1; j < path.length; j++) {
        const b = address(path[j]), x = b % width - a % width, y = Math.floor(b / width) - Math.floor(a / width);
        check((x === 0) !== (y === 0), 'route segments must be nonzero and orthogonal');
        const d = x > 0 ? 1 : x < 0 ? 3 : y > 0 ? 2 : 0, stride = dx[d] + dy[d] * width;
        work += Math.abs(x || y);
        check(work <= 65536, 'routes exceed the segment budget');
        for (; a !== b; a += stride) {
          links(a)[d] = a + stride;
          links(a + stride)[(d + 2) % 4] = a;
        }
      }
    }

    const stamps = K.pixelStamps, art = new Map(), oriented = new Map();
    function readArt(key, template) {
      if (art.has(key)) return art.get(key);
      const spec = Object.hasOwn(clips, key) ? clips[key] :
        stamps.clip('tile-' + style + '-' + template.kind, { swatches });
      check(spec?.width === size && spec.height === size && Array.isArray(spec.frames) &&
        integer(spec.frames.length, 4, 32), 'each clip needs 4–32 cels on the declared square grid');
      const { entries, palette: colors } = stamps.prepare(spec);
      const durations = entries.map(({ duration }) => duration);
      check(durations.every(d => d >= .0001 && d <= 3600), 'cel holds must be from .0001 to 3600 seconds');
      const frames = entries.map(({ slots }) => {
        checkSockets(slots, size, key);
        return stamps.image({ width: size, height: size, slots, palette: colors }, palette).rgba;
      });
      const result = { frames, durations };
      art.set(key, result);
      return result;
    }
    function tile(mask, incoming, ports) {
      const code = mask * 5 + incoming + 1;
      if (oriented.has(code)) return oriented.get(code);
      const choices = variants.get(mask);
      const orientation = choices.find(choice => choice.entry === incoming) ?? choices[0];
      const { template } = orientation, exact = Object.hasOwn(clips, ports);
      const { frames, durations } = readArt(exact ? ports : template.ports, template);
      const result = {
        durations, kind: template.kind,
        images: exact ? frames : frames.map(frame => rotate(frame, size, orientation))
      };
      oriented.set(code, result);
      return result;
    }
    const cells = [...neighbors].sort(([a], [b]) => a - b).map(([index, links]) => {
      const mask = links.reduce((value, next, d) => value | (next < 0 ? 0 : 1 << d), 0);
      const ports = names(mask), base = tile(mask, -1, ports), { kind, durations } = base;
      const hold = kind === 'fork' || kind === 'cross' ? forkHold : 0;
      const active = durations.slice(1).map((duration, i) => ({ frame: i + 1, duration: duration + (i === 1 ? hold : 0) }));
      return {
        index, links, x: index % width, y: Math.floor(index / width), ports, kind,
        images: [base.images, ...links.map((next, d) => next < 0 ? base.images : tile(mask, d, ports).images)],
        clock: SpriteCels.playback(active, 12, 'once'),
        release: active[0].duration + active[1].duration,
        duration: active.reduce((sum, cel) => sum + cel.duration, 0)
      };
    });
    const byIndex = new Map(cells.map(cell => [cell.index, cell])), routes = new Map();

    function arrivals(first) {
      if (routes.has(first)) return routes.get(first);
      const offsets = new Float64Array(count).fill(Infinity), from = new Int8Array(count).fill(-1);
      // A wave visits each reachable cell once, even on closed paths.
      const queue = new ProceduralHeap((a, b) => a.time < b.time || (a.time === b.time && a.index < b.index));
      offsets[first] = 0;
      queue.push({ time: 0, index: first });
      while (queue.size) {
        const { time, index } = queue.pop();
        if (time !== offsets[index]) continue;
        const cell = byIndex.get(index), exit = time + cell.release;
        for (const [d, next] of cell.links.entries()) {
          if (next < 0 || exit + epsilon >= offsets[next]) continue;
          offsets[next] = exit;
          from[next] = (d + 2) % 4;
          queue.push({ time: exit, index: next });
        }
      }
      const result = { offsets, from };
      routes.set(first, result);
      return result;
    }
    const schedule = Array.from(cues, cue => {
      check(record(cue), 'each cue needs a cell and a time');
      const { at, time = 0, period } = cue, first = address(at);
      check(byIndex.has(first) && Number.isFinite(time) &&
        (period === undefined || Number.isFinite(period) && period >= .0001),
      'cues must start on a route at a finite time with a positive optional period');
      return { ...arrivals(first), time, period };
    });
    const w = width * size, h = height * size;

    function state(cell, time) {
      let age = Infinity, entry = -1;
      for (const { offsets, from, time: start, period } of schedule) {
        const elapsed = (time - start) - offsets[cell.index];
        if (!(elapsed >= -epsilon && Number.isFinite(elapsed))) continue;
        let since = Math.max(0, elapsed);
        if (period !== undefined) {
          since %= period;
          if (period - since <= epsilon) since = 0;
        }
        if (since >= age) continue;
        age = since;
        entry = from[cell.index];
      }
      const idle = age === Infinity || (after === 'idle' && age + epsilon >= cell.duration);
      return { frame: idle ? 0 : cell.clock(age + epsilon), age: age === Infinity ? null : age, entry };
    }
    function raster(time = 0) {
      check(Number.isFinite(time), 'sample time must be finite');
      const rgba = new Uint8Array(w * h * 4);
      for (const cell of cells) {
        const { frame, entry } = state(cell, time);
        const image = cell.images[frame === 0 ? 0 : entry + 1][frame];
        for (let y = 0; y < size; y++) {
          const start = y * size * 4;
          rgba.set(image.subarray(start, start + size * 4), ((cell.y * size + y) * w + cell.x * size) * 4);
        }
      }
      return { w, h, rgba };
    }

    return Object.freeze({
      w, h, raster,
      cells: Object.freeze(cells.map(({ x, y, ports, kind }) => Object.freeze({ x, y, ports, kind }))),
      sample(x, y, time = 0) {
        check(Number.isFinite(time), 'sample time must be finite');
        const cell = byIndex.get(address([x, y]));
        if (!cell) return null;
        const { frame, age, entry } = state(cell, time);
        return { frame, age, from: sides[entry] ?? null };
      }
    });
  }

  K.pixelTiles = Object.freeze({ create });
})(KIT);
