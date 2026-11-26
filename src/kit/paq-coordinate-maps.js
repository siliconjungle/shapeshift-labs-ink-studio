/* Build inverse maps from destination UV to source UV. Image coordinates have Y down. */
const TypedImageSpatialGeometry = (() => {
  const finite = n => Number.isFinite(n) && Math.abs(n) <= 1e9;
  const tuple = (values, count, valid = finite) =>
    Array.isArray(values) && values.length === count && Array.from(values).every(valid);
  const identity = [[1, 0, 0], [0, 1, 0]];
  const unitQuad = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const tau = 2 * Math.PI;
  const axes = ({ width, height }) => [width, height];
  const inUnit = n => n >= -1e-12 && n <= 1 + 1e-12;
  const clamp = n => Math.max(0, Math.min(1, n));

  function optionUnits({ units = 'pixels' }) {
    if (!['pixels', 'normalized'].includes(units)) throw new RangeError('Image coordinates need pixels or normalized units');
    return units;
  }

  function matrixMap([a, b, c, d, e, f, g, h, i], clip = false) {
    return (u, v, out) => {
      const w = g * u + h * v + i;
      if (Math.abs(w) <= Number.EPSILON * (Math.abs(g * u) + Math.abs(h * v) + Math.abs(i))) return false;
      const x = (a * u + b * v + c) / w, y = (d * u + e * v + f) / w;
      if (!finite(x) || !finite(y) || clip && (!inUnit(x) || !inUnit(y))) return false;
      out[0] = clip ? clamp(x) : x;
      out[1] = clip ? clamp(y) : y;
      return true;
    };
  }

  function inverse([a, b, c, d, e, f, g, h, i]) {
    const adjugate = [
      e * i - f * h, c * h - b * i, b * f - c * e,
      f * g - d * i, a * i - c * g, c * d - a * f,
      d * h - e * g, b * g - a * h, a * e - b * d
    ];
    const terms = [a * adjugate[0], b * adjugate[3], c * adjugate[6]];
    const determinant = terms[0] + terms[1] + terms[2];
    if (Math.abs(determinant) <= 1e-12 * terms.reduce((sum, term) => sum + Math.abs(term), 0))
      throw new RangeError('Image transform matrix must be invertible');
    // The adjugate already represents the inverse map in homogeneous coordinates.
    return adjugate;
  }

  function transform(grid, options) {
    const units = optionUnits(options), [sx, sy] = units === 'pixels' ? axes(grid) : [1, 1];
    const { matrix = identity, rotation = 0, scale = 1, offset = [0, 0],
      pivot = grid.pivot ? [grid.pivot[0] * sx / grid.width, grid.pivot[1] * sy / grid.height] : [sx / 2, sy / 2] } = options;
    const factors = typeof scale === 'number' ? [scale, scale] : scale;
    if (!tuple(matrix, 2, row => tuple(row, 3)) || !finite(rotation) ||
        !tuple(factors, 2, n => finite(n) && Math.abs(n) >= 1e-9) || !tuple(pivot, 2) || !tuple(offset, 2))
      throw new RangeError('Image transform needs a 2 by 3 affine matrix, finite rotation, nonzero scale, pivot and offset');
    const [[a, b, c], [d, e, f]] = matrix, [fx, fy] = factors, [px, py] = pivot;
    const rad = rotation % 360 * Math.PI / 180;
    const clean = n => Math.abs(n) < 1e-15 ? 0 : n;
    const cos = clean(Math.cos(rad)), sin = clean(Math.sin(rad));
    const aa = cos * fx * a - sin * fy * d, bb = cos * fx * b - sin * fy * e;
    const dd = sin * fx * a + cos * fy * d, ee = sin * fx * b + cos * fy * e;
    const tx = cos * fx * c - sin * fy * f + px + offset[0] - aa * px - bb * py;
    const ty = sin * fx * c + cos * fy * f + py + offset[1] - dd * px - ee * py;
    const forward = [aa, bb * sy / sx, tx / sx, dd * sx / sy, ee, ty / sy, 0, 0, 1];
    return { map: matrixMap(inverse(forward)), linear: [forward[0], forward[1], forward[3], forward[4]] };
  }

  function crop(grid, options) {
    const units = optionUnits(options), [sx, sy] = units === 'pixels' ? axes(grid) : [1, 1];
    const { rect = [0, 0, sx, sy] } = options;
    if (!tuple(rect, 4) || rect[2] <= 0 || rect[3] <= 0)
      throw new RangeError('Image crop needs [x, y, width, height] with positive sides');
    const [x, y, width, height] = rect, span = [width / sx, height / sy];
    return { cropOrigin: [x / sx, y / sy], span, map: matrixMap([span[0], 0, x / sx, 0, span[1], y / sy, 0, 0, 1]) };
  }

  function symmetry(_grid, { axis = 'x', side = 'low', pivot = [.5, .5] }) {
    if (!['x', 'y', 'both'].includes(axis) || !['low', 'high'].includes(side) ||
        !tuple(pivot, 2, n => Number.isFinite(n) && n >= 0 && n <= 1))
      throw new RangeError('Image symmetry needs x, y or both, a low or high side and a normalized pivot');
    const [x, y] = pivot, sign = side === 'low' ? -1 : 1;
    return { map(u, v, out) {
      out[0] = axis === 'y' ? u : x + sign * Math.abs(u - x);
      out[1] = axis === 'x' ? v : y + sign * Math.abs(v - y);
      return true;
    } };
  }

  function polar(grid, { mode = 'toPolar', center = [.5, .5], radius = .5, rotation = 0 }, output) {
    if (!['toPolar', 'fromPolar'].includes(mode) || !tuple(center, 2) || !finite(radius) || radius <= 0 || !finite(rotation))
      throw new RangeError('Image polar mapping needs a direction, center, positive radius and finite rotation');
    const [cx, cy] = center, phase = rotation % 360 / 360;
    const [width, height] = axes(mode === 'toPolar' ? grid : output);
    const short = Math.min(width, height);
    const sx = short / width, sy = short / height;
    if (mode === 'toPolar') return { map(u, v, out) {
      const angle = tau * (u + phase), length = radius * v;
      out[0] = cx + sx * length * Math.cos(angle);
      out[1] = cy + sy * length * Math.sin(angle);
      return finite(out[0]) && finite(out[1]);
    } };
    return { angularU: true, map(u, v, out, clip = true) {
      const x = (u - cx) / sx, y = (v - cy) / sy;
      const length = Math.hypot(x, y) / radius;
      if (!finite(length) || clip && length > 1) return false;
      const turn = (x || y ? Math.atan2(y, x) / tau : 0) - phase;
      out[0] = turn - Math.floor(turn);
      out[1] = length;
      return true;
    } };
  }

  function perspective(_grid, options, output) {
    const { corners = unitQuad, clip = true } = options;
    const units = optionUnits({ units: 'normalized', ...options });
    if (!tuple(corners, 4, point => tuple(point, 2)) || typeof clip !== 'boolean')
      throw new RangeError('Image perspective needs four destination corners and a clip switch');
    const points = units === 'pixels' ? corners.map(([x, y]) => [x / output.width, y / output.height]) : corners;
    const edge = (a, b) => [b[0] - a[0], b[1] - a[1]];
    const sides = points.map((point, index) => edge(point, points[(index + 1) % 4]));
    if (sides.some(([x, y], index) => {
      const [u, v] = sides[(index + 1) % 4];
      return x * v - y * u <= 1e-12 * Math.hypot(x, y) * Math.hypot(u, v);
    })) throw new RangeError('Perspective corners must be convex and ordered top-left, top-right, bottom-right, bottom-left');
    // Map the unit square to the quad, then invert without fixing the homogeneous origin.
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = points;
    const dx1 = x1 - x2, dx2 = x3 - x2, ax = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, ay = y0 - y1 + y2 - y3;
    const det = dx1 * dy2 - dx2 * dy1;
    const g = (ax * dy2 - dx2 * ay) / det, h = (dx1 * ay - ax * dy1) / det;
    const matrix = inverse([x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
      y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]);
    const map = matrixMap(matrix), clipped = matrixMap(matrix, clip);
    return { map: (u, v, out, inside = true) => (inside ? clipped : map)(u, v, out) };
  }

  return { transform, crop, symmetry, polar, perspective };
})();
