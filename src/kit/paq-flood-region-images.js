/* Region packets and derived material maps, with local charts on periodic images. */
const TypedImageRegions = ({ measure, validImage, descriptor, wrap, fields, borders, alignedGrid, resample, hash01 }) => {
  const format = 'ink-studio/region-field', version = 1, maxPixels = 4e6;
  const { four, eight, labelComponents } = PixelPaintTools;
  const finite = Number.isFinite, integer = Number.isSafeInteger;
  const mod = (n, size) => (n % size + size) % size;
  const pair = (values, valid) => Array.isArray(values) && values.length === 2 && Array.from(values).every(valid);
  const shapes = {
    id: ['r', 'region-id'], area: ['r', 'texels'], orientation: ['r', 'radians'],
    center: ['rg', 'art-px'], bounds: ['rgba', 'art-px'], position: ['rg', 'art-px'],
    localUV: ['rg', 'unitless'], randomValue: ['r', 'unitless'], randomColor: ['rgba', 'unitless'],
    gradient: ['r', 'unitless']
  };

  function mapImage(grid, source, data, layout, units, color = false) {
    const { width, height, pivot } = grid;
    const out = { width, height, pivot, data, channels: layout.length };
    const precision = color ? 'unorm8' : data instanceof Float32Array ? 'float32' : 'float64';
    return wrap(out, descriptor(out, {
      intent: color ? 'color' : 'data', layout, units, precision, tiling: source.tiling,
      pixelPitchMm: source.pixelPitchMm, materialSeed: source.materialSeed
    }));
  }

  function measurement(width, height, wrapX, wrapY, chart, positions) {
    function xAt(p) { return chart.x && !chart.winding[0] ? chart.x[p] : p % width; }
    function yAt(p) { return chart.y && !chart.winding[1] ? chart.y[p] : Math.floor(p / width); }
    return ({ id, area, seed }, queue) => {
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity, u = 0, v = 0;
      for (let i = 0; i < area; i++) {
        const p = queue[i], x = xAt(p), y = yAt(p);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        u += x;
        v += y;
      }
      u /= area;
      v /= area;
      const x = wrapX ? mod(left, width) : left, y = wrapY ? mod(top, height) : top;
      const offX = x - left, offY = y - top;
      let xx = 0, yy = 0, xy = 0;
      for (let i = 0; i < area; i++) {
        const p = queue[i], a = xAt(p), b = yAt(p), dx = a - u, dy = b - v;
        xx += dx * dx;
        yy += dy * dy;
        xy += dx * dy;
        positions[p * 2] = a + offX + .5;
        positions[p * 2 + 1] = b + offY + .5;
      }
      const chartCenter = [u + offX + .5, v + offY + .5];
      const center = [wrapX ? mod(chartCenter[0], width) : chartCenter[0],
        wrapY ? mod(chartCenter[1], height) : chartCenter[1]];
      const bounds = { x, y, width: right - left + 1, height: bottom - top + 1 };
      const tolerance = 1e-12 * (xx + yy);
      const angle = Math.abs(2 * xy) <= tolerance ? (yy - xx > tolerance ? Math.PI / 2 : 0) :
        Math.fround(.5 * Math.atan2(2 * xy, xx - yy));
      return Object.freeze({ id, area, seed: Object.freeze(seed), bounds: Object.freeze(bounds),
        center: Object.freeze(center), chartCenter: Object.freeze(chartCenter), angle,
        crosses: Object.freeze([chart.winding[0] || x + bounds.width > width,
          chart.winding[1] || y + bounds.height > height]),
        winding: Object.freeze(chart.winding.slice()) });
    };
  }

  function floodRegions(source, options = {}, graphSeed = 0) {
    if (!fields(options, ['connectivity', 'channel', 'threshold', 'invert', 'minArea', 'border', 'seed']))
      throw new TypeError('Unknown flood region option');
    const { grid, spec, width, height, sample } = measure(source, options, maxPixels);
    const { connectivity = 4, threshold = .5, invert = false, minArea = 1, border = {},
      seed = spec.materialSeed ?? graphSeed } = options;
    if (width * height > maxPixels || ![4, 8].includes(connectivity) || !finite(threshold) ||
        typeof invert !== 'boolean' || !integer(minArea) || minArea < 1 || !integer(seed))
      throw new RangeError('Flood regions need a bounded grid, valid connectivity, threshold, area and seed');
    const tiling = borders(border, spec.tiling), { u, v } = tiling;
    const wrapX = u === 'wrap', wrapY = v === 'wrap', count = width * height;
    const positions = new Float32Array(count * 2);
    const chart = { x: wrapX ? new Int32Array(count) : null, y: wrapY ? new Int32Array(count) : null, winding: [false, false] };
    const describe = measurement(width, height, wrapX, wrapY, chart, positions);
    const split = labelComponents(width, height, connectivity === 4 ? four : eight, p => {
      const value = sample(p);
      if (!finite(value)) throw new RangeError('Flood regions need finite decoded samples');
      return (value >= threshold) !== invert;
    }, { wrapX, wrapY, stable: true, minArea, chart: wrapX || wrapY ? chart : undefined, describe });
    const target = { ...spec, tiling };
    return Object.freeze({ format, version, seed, regions: Object.freeze(split.regions),
      labels: mapImage(grid, target, Float32Array.from(split.labels), 'r', 'region-id'),
      positions: mapImage(grid, target, positions, 'rg', 'art-px') });
  }

  function valid(value) {
    if (!fields(value, ['format', 'version', 'seed', 'regions', 'labels', 'positions']) ||
        value.format !== format || value.version !== version || !integer(value.seed) ||
        !Array.isArray(value.regions) || value.regions.length > 32768 ||
        !validImage(value.labels, 'data') || !validImage(value.positions, 'data') ||
        !alignedGrid(value.labels, value.positions) || value.labels.descriptor.layout !== 'r' ||
        value.labels.descriptor.units !== 'region-id' || value.positions.descriptor.layout !== 'rg' ||
        value.positions.descriptor.units !== 'art-px') return false;
    const { width, height, data } = value.labels.raster, count = width * height;
    const xy = value.positions.raster.data;
    if (count > maxPixels) return false;
    const rows = new Map();
    let previous = 0;
    for (const row of value.regions) {
      if (!fields(row, ['id', 'area', 'seed', 'bounds', 'center', 'chartCenter', 'angle', 'crosses', 'winding']) ||
          !integer(row.id) || row.id <= previous || row.id > count || !integer(row.area) || row.area < 1 || row.area > count ||
          !pair(row.seed, integer) || row.seed[0] !== (row.id - 1) % width || row.seed[1] !== Math.floor((row.id - 1) / width) ||
          !pair(row.center, finite) || !pair(row.chartCenter, finite) || !finite(row.angle) || Math.abs(row.angle) > Math.fround(Math.PI / 2) ||
          !pair(row.crosses, x => typeof x === 'boolean') || !pair(row.winding, x => typeof x === 'boolean') ||
          !fields(row.bounds, ['x', 'y', 'width', 'height'])) return false;
      const { x, y, width: w, height: h } = row.bounds;
      if (![x, y, w, h].every(integer) || x < 0 || x >= width || y < 0 || y >= height ||
          w < 1 || h < 1 || w > count || h > count || data[row.id - 1] !== row.id ||
          row.center[0] < 0 || row.center[0] >= width || row.center[1] < 0 || row.center[1] >= height ||
          row.chartCenter[0] <= x || row.chartCenter[0] >= x + w ||
          row.chartCenter[1] <= y || row.chartCenter[1] >= y + h) return false;
      previous = row.id;
      rows.set(row.id, row.bounds);
    }
    for (let p = 0; p < count; p++) {
      const id = data[p];
      if (!id) continue;
      const box = rows.get(id);
      if (!box || p < id - 1 || xy[p * 2] <= box.x || xy[p * 2] >= box.x + box.width ||
          xy[p * 2 + 1] <= box.y || xy[p * 2 + 1] >= box.y + box.height) return false;
    }
    return true;
  }

  function requireRegion(source) {
    if (!valid(source)) throw new TypeError('Expected a versioned flood region field');
    const { labels, positions, regions } = source;
    return { grid: labels.raster, spec: labels.descriptor, xy: positions.raster.data,
      rows: new Map(regions.map(row => [row.id, row])) };
  }

  function rangeOfGradient({ grid: { data }, rows, xy }, angle, align) {
    const ranges = new Map();
    for (const [id, { angle: orientation, chartCenter: [x, y] }] of rows) {
      const theta = angle % 360 * Math.PI / 180 + (align === 'orientation' ? orientation : 0);
      const snap = n => Math.abs(n) < 1e-14 ? 0 : n;
      ranges.set(id, { dx: snap(Math.cos(theta)), dy: snap(Math.sin(theta)), x, y, low: Infinity, high: -Infinity });
    }
    const project = ({ dx, dy, x, y }, p) => dx * (xy[p * 2] - x) + dy * (xy[p * 2 + 1] - y);
    for (let p = 0; p < data.length; p++) if (data[p]) {
      const range = ranges.get(data[p]), value = project(range, p);
      range.low = Math.min(range.low, value);
      range.high = Math.max(range.high, value);
    }
    return (id, p) => {
      const range = ranges.get(id), span = range.high - range.low;
      return span <= 1e-12 ? .5 : (project(range, p) - range.low) / span;
    };
  }

  function localCoordinates(box, x, y, out, i) {
    out[i] = (x - box.x) / box.width;
    out[i + 1] = (y - box.y) / box.height;
  }

  function regionMap(source, kind, options = {}) {
    const field = requireRegion(source), { grid, spec, xy, rows } = field;
    if (!Object.hasOwn(shapes, kind) || !fields(options, ['units', 'angle', 'align', 'seed', 'palette']))
      throw new TypeError('Unknown flood region map kind or option');
    const { units = 'pixels', angle = 0, align = 'tile', seed = source.seed, palette } = options;
    if (!['pixels', 'normalized'].includes(units) || !finite(angle) || !['tile', 'orientation'].includes(align) || !integer(seed) ||
        palette !== undefined && (!Array.isArray(palette) || palette.length < 1 || palette.length > 256 ||
          !Array.from(palette).every(entry => typeof entry === 'string')))
      throw new RangeError('Invalid region map units, angle, alignment, seed or palette');
    if (kind === 'id') return source.labels;
    if (kind === 'position' && units === 'pixels') return source.positions;
    const [layout, unit] = shapes[kind], { width, height, data: labels } = grid;
    const { length: channels } = layout, color = kind === 'randomColor';
    const data = new (color ? Uint8Array : kind === 'randomValue' ? Float64Array : Float32Array)(labels.length * channels);
    const colors = palette && Array.from(palette, entry => DrawingPrimitives.color(entry));
    const norm = units === 'normalized', sx = norm ? width : 1, sy = norm ? height : 1;
    const values = new Map();
    const gradient = kind === 'gradient' && rangeOfGradient(field, angle, align);
    const random = (id, slot) => hash01('region/' + seed + '/' + id + '/' + slot);
    for (const [id, { center, bounds, area, angle }] of rows) {
      if (kind === 'center') values.set(id, [center[0] / sx, center[1] / sy]);
      if (kind === 'bounds') values.set(id, [bounds.x / sx, bounds.y / sy, bounds.width / sx, bounds.height / sy]);
      if (kind === 'area') values.set(id, [area]);
      if (kind === 'orientation') values.set(id, [angle]);
      if (kind === 'randomValue') values.set(id, [random(id, 'value')]);
      if (color) values.set(id, colors ? colors[Math.floor(random(id, 'palette') * colors.length)] :
        [...['red', 'green', 'blue'].map(slot => Math.floor(random(id, slot) * 256)), 255]);
    }
    for (let p = 0, i = 0; p < labels.length; p++, i += channels) {
      const id = labels[p];
      if (!id) continue;
      if (kind === 'gradient') data[i] = gradient(id, p);
      else if (kind === 'localUV') localCoordinates(rows.get(id).bounds, xy[p * 2], xy[p * 2 + 1], data, i);
      else if (kind === 'position') {
        data[i] = xy[p * 2] / sx;
        data[i + 1] = xy[p * 2 + 1] / sy;
      } else data.set(values.get(id), i);
    }
    return mapImage(grid, spec, data, layout, norm && unit === 'art-px' ? 'unitless' : unit, color);
  }

  function regionLookup(source, texture, options = {}) {
    const { grid, spec, xy, rows } = requireRegion(source), { width, height, data, pivot } = grid;
    if (!fields(options, ['coordinates', 'filter', 'border'])) throw new TypeError('Unknown region lookup option');
    const { coordinates = 'localUV', ...sampling } = options;
    if (!['localUV', 'center', 'seed', 'position'].includes(coordinates)) throw new RangeError('Unknown region lookup coordinates');
    const result = resample(texture, { ...sampling, width, height }, 'region lookup', [], () => ({ map(u, v, out) {
      const p = Math.floor(v * height) * width + Math.floor(u * width), id = data[p];
      if (!id) return false;
      const region = rows.get(id);
      if (coordinates === 'localUV') localCoordinates(region.bounds, xy[p * 2], xy[p * 2 + 1], out, 0);
      else if (coordinates === 'center') {
        out[0] = region.center[0] / width;
        out[1] = region.center[1] / height;
      } else if (coordinates === 'seed') {
        out[0] = (region.seed[0] + .5) / width;
        out[1] = (region.seed[1] + .5) / height;
      } else {
        out[0] = xy[p * 2] / width;
        out[1] = xy[p * 2 + 1] / height;
      }
      return true;
    } }));
    const output = { ...result.raster, pivot };
    return wrap(output, descriptor(output, { ...result.descriptor, tiling: spec.tiling, pixelPitchMm: spec.pixelPitchMm }));
  }

  return Object.freeze({ valid, floodRegions, regionMap, regionLookup });
};
