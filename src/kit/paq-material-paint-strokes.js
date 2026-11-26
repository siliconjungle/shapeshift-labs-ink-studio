/* Chart coordinates and native brush coverage for material-channel paint. */
const MaterialPaintStrokes = (() => {
  const finite = Number.isFinite, num = (value, low, high) => finite(value) && value >= low && value <= high;
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const tuple = (value, n) => Array.isArray(value) && value.length === n && Array.from(value).every(finite);
  const name = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
    !['constructor', 'prototype', '__proto__'].includes(value);

  function projectors(charts) {
    return new Map(Object.entries(charts).map(([id, chart]) => {
      if (!name(id) || !fields(chart, ['space', 'projection', 'extent', 'offset']) ||
          !['world', 'rest'].includes(chart.space) || !record(chart.projection) ||
          !tuple(chart.extent, 2) || chart.extent.some(n => n <= 1e-8) ||
          chart.offset !== undefined && !tuple(chart.offset, 2))
        throw new TypeError('Paint chart needs world or rest space, a projection and positive UV spans');
      const project = SplatEffects.project(chart.projection), offset = chart.offset ?? [0, 0];
      return [id, { space: chart.space, at: point => project(point).map((n, i) => (n - offset[i]) / chart.extent[i]) }];
    }));
  }

  function samples(stroke, grid, charts) {
    const { space = 'texel', chart, samples } = stroke, { width, height } = grid;
    if (!['texel', 'uv', 'world', 'rest'].includes(space) ||
        !Array.isArray(samples) || !samples.length || samples.length > 4096)
      throw new RangeError('Material paint strokes need 1–4096 samples in texel, UV, world or rest space');
    const spatial = space === 'world' || space === 'rest', projection = charts.get(chart);
    if (spatial ? projection?.space !== space : chart !== undefined)
      throw new RangeError('Choose a named chart matching the stroke coordinate space');
    let last = 0;
    return Array.from(samples, (value, i) => {
      const row = Array.isArray(value) ? { at: value } : value;
      if (!fields(row, ['at', 'pressure', 'time']) || !tuple(row.at, spatial ? 3 : 2))
        throw new TypeError('Paint samples need finite chart coordinates');
      const { pressure = 1, time = Math.max(last, 16 * i) } = row;
      if (!num(pressure, 0, 1) || !num(time, last, Number.MAX_SAFE_INTEGER))
        throw new RangeError('Paint samples need pressure in [0,1] and ordered elapsed milliseconds');
      last = time;
      const uv = spatial ? projection.at(row.at) : row.at;
      const at = space === 'texel' ? uv : [uv[0] * width - .5, uv[1] * height - .5];
      if (!grid.contains(at, true)) throw new RangeError('Material paint sample projects outside its channel grid');
      return { at, pressure, time };
    });
  }

  function coverage(stroke, grid, charts, flows, emit, charge) {
    const { brush = {}, flow, velocity } = stroke;
    const { width, height } = grid;
    const rows = samples(stroke, grid, charts);
    if (velocity !== undefined && velocity !== 'stroke' && (!tuple(velocity, 2) || Math.hypot(...velocity) > 1000))
      throw new TypeError('Flow channel velocity needs a UV vector or stroke direction');
    if (brush.kind === 'tip') {
      if (!fields(brush, ['kind', 'definition']) || flow !== undefined || velocity === 'stroke')
        throw new TypeError('Indexed tips support fixed values and brush dynamics. Use a round brush for direction fields');
      const mapped = { ...grid, pixels(u, v, report) {
        grid.oriented(u, v, (p, sx, sy) => { charge(1); report(p); emit(p, 1, sx, sy, velocity); });
      }};
      // The material value supplies the paint. The indexed tip supplies its footprint and dynamics.
      PixelBrushes.dynamicStroke(width, height, brush.definition, rows, () => {}, mapped, true);
      return;
    }
    if (!fields(brush, ['kind', 'radius', 'hardness', 'aspect', 'angle', 'spacing']) ||
        brush.kind !== undefined && brush.kind !== 'round')
      throw new TypeError('Choose a round or indexed tip material paint brush');
    const { radius = 3, hardness = .72, aspect = 1, angle = 0, spacing = Math.max(.5, radius / 3) } = brush;
    if (!num(radius, .25, 1024) || !num(hardness, 0, 1) || !num(aspect, .05, 1) ||
        !num(angle, -360000, 360000) || !num(spacing, .25, 1024))
      throw new RangeError('Round brush radius, hardness, aspect, angle or spacing is out of range');
    const heading = flow === undefined ? null : flows.get(flow);
    if (flow !== undefined && !heading) throw new RangeError('Unknown material paint flow field ' + flow);
    const radians = angle * Math.PI / 180, first = rows[0], last = rows.at(-1);
    const mirrorCopies = stroke.symmetry?.mirrorX === undefined ? 1 : 2;
    const copies = mirrorCopies * (stroke.symmetry?.mirrorY === undefined ? 1 : 2);

    function dab(x, y, pressure, dx, dy) {
      charge(1);
      const size = radius * pressure, narrow = size * aspect;
      if (narrow < 1e-10) return;
      const u = (x + .5) / width, v = (y + .5) / height;
      const vector = heading?.(grid.wrapX ? (u % 1 + 1) % 1 : u, grid.wrapY ? (v % 1 + 1) % 1 : v);
      const turn = vector && Math.hypot(...vector) > 1e-10 ? Math.atan2(vector[1] * height, vector[0] * width) + radians : radians;
      const a = Math.cos(turn), b = Math.sin(turn);
      const extentX = Math.hypot(a * size, b * narrow), extentY = Math.hypot(b * size, a * narrow);
      const left = Math.ceil(x - extentX), right = Math.floor(x + extentX), top = Math.ceil(y - extentY), bottom = Math.floor(y + extentY);
      const rate = velocity === 'stroke' ? (() => {
        const du = dx / width, dv = dy / height, length = Math.hypot(du, dv);
        return length ? [du / length * (stroke.speed ?? 1), dv / length * (stroke.speed ?? 1)] : null;
      })() : velocity;
      if (velocity === 'stroke' && !rate) return;
      charge(Math.max(0, right - left + 1) * Math.max(0, bottom - top + 1) * copies);
      for (let py = top; py <= bottom; py++) for (let px = left; px <= right; px++) {
        const ox = px - x, oy = py - y;
        const d = Math.hypot((a * ox + b * oy) / size, (-b * ox + a * oy) / narrow);
        if (d > 1) continue;
        const edge = d <= hardness ? 1 : (1 - d) / (1 - hardness);
        const weight = edge * edge * (3 - 2 * edge);
        if (weight) grid.oriented(px, py, (p, sx, sy) => emit(p, weight, sx, sy, rate));
      }
    }

    let gap = 0, dx = 0, dy = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i], [x, y] = a.at, ex = b.at[0] - x, ey = b.at[1] - y;
      const length = Math.hypot(ex, ey);
      if (!length) continue;
      dx = ex; dy = ey;
      for (; gap < length; gap += spacing) {
        const t = gap / length;
        dab(x + dx * t, y + dy * t, a.pressure + (b.pressure - a.pressure) * t, dx, dy);
      }
      gap -= length;
    }
    if (rows.length === 1) dab(...first.at, first.pressure, 0, 0);
    else dab(...last.at, last.pressure, dx, dy);
  }

  return Object.freeze({ fields, name, num, tuple, projectors, coverage });
})();
