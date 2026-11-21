/* Source-row deformation with an invertible vertical curve and registered asset planes. */
(function (P) {
  const W = P.rasterWarp, { fieldFrom, size, tuple, bounded, int, view } = P.rasterWarpSupport;
  const record = P.graphTypes.validator('record');
  const tau = 2 * Math.PI;
  const identity = row => ({ row, y: row, dx: 0, scale: 1 });

  function prepare(keys, height) {
    if (!Array.isArray(keys) || keys.length > 4096) throw new TypeError('Scanline deformation needs a bounded key list');
    let previous = -1;
    const curve = Array.from(keys, key => {
      if (!record(key) || Object.keys(key).some(name => !['row', 'offset', 'scale'].includes(name)))
        throw new TypeError('Invalid scanline deformation key');
      const { row, offset = [0, 0], scale = 1 } = key;
      if (!int(row, 0, height) || row <= previous || !tuple(offset, 2, n => bounded(n) && Math.abs(n) <= 8192) ||
          !Number.isFinite(scale) || scale < 1 / 16 || scale > 16)
        throw new RangeError('Scanline keys need increasing source rows, bounded XY offsets and positive scale');
      previous = row;
      return { row, y: row + offset[1], dx: offset[0], scale };
    });
    if (!curve.length) return [identity(0), identity(height)];
    const first = curve[0], last = curve.at(-1);
    if (first.row > 0) curve.unshift({ ...first, row: 0, y: first.y - first.row });
    if (last.row < height) curve.push({ ...last, row: height, y: last.y + height - last.row });
    if (curve.some((key, i) => i > 0 && key.y <= curve[i - 1].y))
      throw new RangeError('Scanline vertical offsets must keep the destination rows strictly increasing');
    return curve;
  }

  function segment(keys, axis, coordinate) {
    let low = 0, high = keys.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (keys[middle][axis] <= coordinate) low = middle;
      else high = middle;
    }
    return low;
  }

  function scanlines(source, { rows = [], wave = {}, pivot, pin = false, padding = [0, 0, 0, 0],
    horizontal = 'linear', filter = 'nearest', time = 0, anchors = {}, maps = {} } = {}) {
    const { width: w, height: h } = view(source);
    const center = pivot ?? source.pivot ?? [w / 2, h / 2];
    if (!tuple(center, 2, bounded) || !tuple(padding, 4, n => int(n, 0, 8192)) || typeof pin !== 'boolean' ||
        !['linear', 'step'].includes(horizontal) || !bounded(time) || !['nearest', 'linear'].includes(filter) ||
        !record(wave) || Object.keys(wave).some(key => !['amplitude', 'period', 'rate', 'phase'].includes(key)))
      throw new TypeError('Invalid scanline deformation registration, filter, clock or wave');
    const { amplitude = 0, period = 32, rate = 0, phase = 0 } = wave;
    if (!bounded(amplitude) || Math.abs(amplitude) > 8192 || !bounded(period) || period < 1 / 256 ||
        !bounded(rate) || !bounded(phase)) throw new RangeError('Scanline wave needs finite controls and a positive row period');
    const [left, top, right, bottom] = padding, { width, height } = size(w + left + right, h + top + bottom);
    if (!record(anchors) || Object.keys(anchors).length > 8192 || !Object.entries(anchors).every(([name, point]) =>
      name.trim() && tuple(point, 2, bounded)) || !record(maps) || Object.keys(maps).length > 8 ||
      width * height * (1 + Object.keys(maps).length) > 8e6)
      throw new RangeError('Scanline deformation needs bounded named anchors and aligned maps');
    const planes = Object.entries(maps).map(([name, input]) => {
      const read = view(input);
      if (read.width !== w || read.height !== h) throw new RangeError('Registered scanline map must match the source: ' + name);
      return [name, read];
    });

    const curve = prepare(rows, h), phaseAt = (phase + rate * time) % 1;
    function across(index, y, out) {
      const a = curve[index], b = curve[index + 1];
      const t = horizontal === 'step' ? Number(y >= b.row) :
        Math.max(0, Math.min(1, (y - a.row) / (b.row - a.row)));
      out[0] = a.dx + (b.dx - a.dx) * t + amplitude * Math.sin(tau * (y / period + phaseAt));
      out[1] = a.scale + (b.scale - a.scale) * t;
    }
    const row = [0, 1];
    function place(point) {
      const [x, y] = point, index = segment(curve, 'row', y), a = curve[index], b = curve[index + 1];
      const t = Math.max(0, Math.min(1, (y - a.row) / (b.row - a.row)));
      across(index, y, row);
      return [center[0] + (x - center[0]) * row[1] + row[0], y + (a.y - a.row) * (1 - t) + (b.y - b.row) * t];
    }
    const anchor = place(center);
    const xShift = left + (pin ? center[0] - anchor[0] : 0), yShift = top + (pin ? center[1] - anchor[1] : 0);
    const output = point => {
      const [x, y] = place(point);
      return [x + xShift, y + yShift];
    };
    const outputPivot = output(center);
    const registered = Object.fromEntries(Object.entries(anchors).map(([name, point]) => [name, output(point)]));
    const addresses = new Float64Array(height * 3);
    for (let y = 0; y < height; y++) {
      const target = y + .5 - yShift;
      if (target < curve[0].y || target >= curve.at(-1).y) continue;
      const index = segment(curve, 'y', target), a = curve[index], b = curve[index + 1];
      const sample = a.row + (target - a.y) / (b.y - a.y) * (b.row - a.row);
      across(index, sample, row);
      addresses.set([sample, row[0], row[1]], y * 3);
    }
    const field = fieldFrom(width, height, 3, (_u, _v, x, y, _p, out) => {
      const i = y * 3, scale = addresses[i + 2];
      out[0] = scale ? (center[0] + (x + .5 - xShift - center[0] - addresses[i + 1]) / scale) / w : 0;
      out[1] = scale ? addresses[i] / h : 0;
      out[2] = Number(Boolean(scale));
    });
    const value = { ...W.sample(source, field, { filter, edge: 'transparent' }), pivot: outputPivot };
    const remapped = Object.fromEntries(planes.map(([name, input]) => {
      const { data, channels } = input;
      const Type = data instanceof Uint8Array ? Uint8Array : ArrayBuffer.isView(data) ? data.constructor : Float64Array;
      const samples = new Type(width * height * channels);
      for (let i = 0, to = 0; i < field.data.length; i += 3, to += channels) {
        if (!field.data[i + 2]) continue;
        const x = Math.floor(field.data[i] * w), y = Math.floor(field.data[i + 1] * h);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const from = (y * w + x) * channels;
        for (let c = 0; c < channels; c++) samples[to + c] = data[from + c];
      }
      return [name, { width, height, channels, data: samples, pivot: outputPivot.slice() }];
    }));
    return { value, field, anchors: registered, maps: remapped };
  }

  W.scanlines = scanlines;
})(KIT.procedural);
