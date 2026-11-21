/* Compose procedural coordinate transforms and authored UV maps before sampling color. */
(function (P) {
  const W = P.rasterWarp, { bounded, fieldFrom, fraction, size, tuple, view, wrap } = P.rasterWarpSupport;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const tau = 2 * Math.PI;
  const unit = n => n > 0 && n <= 4096 && Number.isFinite(n);
  function check(spec, keys) {
    if (!record(spec) || Object.keys(spec).some(key => key !== 'type' && !keys.includes(key)))
      throw new TypeError('Invalid texture transform settings');
  }

  function rotate(spec, width, height, time) {
    check(spec, ['turns', 'rate', 'pivot']);
    const { turns = 0, rate = 0, pivot = [.5, .5] } = spec;
    if (!bounded(turns) || !bounded(rate) || !tuple(pivot, 2, bounded)) throw new RangeError('Invalid texture rotation');
    const theta = wrap(turns + rate * time) * tau, c = Math.cos(theta), s = Math.sin(theta);
    const [cx, cy] = pivot, aspect = width / height;
    return out => {
      const x = (out[0] - cx) * aspect, y = out[1] - cy;
      out[0] = cx + (c * x + s * y) / aspect;
      out[1] = cy - s * x + c * y;
    };
  }

  function zoom(spec) {
    check(spec, ['scale', 'pivot']);
    const { scale = 1, pivot = [.5, .5] } = spec;
    const factor = Array.isArray(scale) ? scale : [scale, scale];
    if (!tuple(factor, 2, unit) || !tuple(pivot, 2, bounded)) throw new RangeError('Invalid texture zoom');
    const [cx, cy] = pivot, [sx, sy] = factor;
    return out => {
      out[0] = cx + (out[0] - cx) / sx;
      out[1] = cy + (out[1] - cy) / sy;
    };
  }

  function tunnel(spec, width, height, time) {
    check(spec, ['center', 'depth', 'inner', 'outer', 'turns', 'spinRate', 'scroll', 'travelRate', 'clockwise']);
    const { center = [.5, .5], depth = .25, inner = .02, outer = Infinity, turns = 0, spinRate = 0,
      scroll = 0, travelRate = 0, clockwise = true } = spec;
    if (!tuple(center, 2, bounded) || !unit(depth) || !unit(inner) ||
        (spec.outer !== undefined && !unit(outer)) || outer <= inner ||
        ![turns, spinRate, scroll, travelRate].every(bounded) || typeof clockwise !== 'boolean')
      throw new RangeError('Invalid polar tunnel mapping');
    const [cx, cy] = center, fit = Math.min(width, height), direction = clockwise ? 1 : -1;
    const angle = wrap(turns + spinRate * time), distance = scroll + travelRate * time;
    return out => {
      const x = (out[0] - cx) * width / fit, y = (out[1] - cy) * height / fit, radius = Math.hypot(x, y);
      if (radius < inner || radius > outer) { out[2] = 0; return; }
      out[0] = wrap(direction * Math.atan2(y, x) / tau + angle);
      out[1] = depth / radius + distance;
    };
  }

  function rows(spec, width, height, time) {
    check(spec, ['schedule']);
    const { schedule = [] } = spec;
    const plan = RasterSchedule.prepare({ schedule }), { registers } = RasterSchedule.table(plan, width, height, time);
    return out => {
      const x = out[0] * width, y = out[1] * height;
      const row = Math.max(0, Math.min(height - 1, Math.floor(y))) * 8;
      const sx = registers[row + 2], sy = registers[row + 3], anchor = registers[row + 4];
      const u = sx === 1 ? x : Math.floor(x / sx) * sx + .5;
      const v = sy === 1 ? y : anchor + Math.floor((y - anchor) / sy) * sy + .5;
      out[0] = (u + registers[row]) / width;
      out[1] = (v + registers[row + 1]) / height;
    };
  }

  function compose(width, height, steps) {
    return fieldFrom(width, height, 3, (u, v, _x, _y, _p, out) => {
      out[0] = u; out[1] = v; out[2] = 1;
      for (const step of steps) {
        if (!out[2]) break;
        step(out);
      }
    });
  }

  const types = { rotate, zoom, tunnel, rows };
  function addressField({ width, height, transforms = [], time = 0 } = {}) {
    size(width, height);
    if (!Array.isArray(transforms) || transforms.length > 32 || width * height * transforms.length > 32e6 || !bounded(time))
      throw new RangeError('Texture transform program exceeds its work budget or time range');
    const steps = Array.from(transforms, spec => {
      if (!Object.hasOwn(types, spec?.type)) throw new TypeError('Unknown texture transform: ' + spec?.type);
      return types[spec.type](spec, width, height, time);
    });
    return compose(width, height, steps);
  }

  function lookup(field, { filter, axes: [ax, ay] }) {
    const { width, height, channels, data } = view(field);
    if (channels !== 2 && channels !== 3) throw new RangeError('Texture map needs 2 or 3 UV channels');
    for (let i = 0; i < data.length; i += channels)
      if (!bounded(data[i]) || !bounded(data[i + 1]) || channels === 3 && !fraction(data[i + 2]))
        throw new RangeError('Invalid composed UV field coordinate or coverage');
    const result = new Float64Array(3);
    function add(x, y, weight) {
      const u = ax(x, width), v = ay(y, height);
      if (u < 0 || v < 0 || !weight) return;
      const i = (v * width + u) * channels, coverage = (channels === 3 ? data[i + 2] : 1) * weight;
      result[0] += data[i] * coverage;
      result[1] += data[i + 1] * coverage;
      result[2] += coverage;
    }
    return out => {
      const x = out[0] * width, y = out[1] * height;
      result.fill(0);
      if (filter === 'nearest') add(Math.floor(x), Math.floor(y), 1);
      else {
        const i = Math.floor(x - .5), j = Math.floor(y - .5), a = x - .5 - i, b = y - .5 - j;
        add(i, j, (1 - a) * (1 - b));
        add(i + 1, j, a * (1 - b));
        add(i, j + 1, (1 - a) * b);
        add(i + 1, j + 1, a * b);
      }
      out[2] *= Math.min(1, result[2]);
      out[0] = result[2] ? result[0] / result[2] : 0;
      out[1] = result[2] ? result[1] / result[2] : 0;
    };
  }

  function composeFields(fields, { width = fields?.[0]?.width, height = fields?.[0]?.height, ...options } = {}) {
    size(width, height);
    if (!Array.isArray(fields) || !fields.length || fields.length > 16 || width * height * fields.length > 16e6)
      throw new RangeError('Texture map composition needs 1 to 16 fields within its work budget');
    const settings = TextureAddress.settings({ edge: 'transparent', ...options });
    const steps = Array.from(fields, field => lookup(field, settings));
    return compose(width, height, steps);
  }

  Object.assign(W, { addressField, composeFields });
})(KIT.procedural);
