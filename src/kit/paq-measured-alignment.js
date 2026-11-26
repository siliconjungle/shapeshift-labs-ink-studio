/* Fit calibration targets in normalized coordinates before resampling the capture. */
const MeasuredAlignment = (() => {
  const finite = Number.isFinite;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const tuple = (value, count, valid = finite) => Array.isArray(value) && value.length === count && Array.from(value).every(valid);

  function fit(basis, values, label) {
    const n = basis[0].length;
    const count = values[0].length;
    const system = Array.from({ length: n }, () => new Float64Array(n + count));
    for (const [index, row] of basis.entries()) {
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) system[a][b] += row[a] * row[b];
        for (let b = 0; b < count; b++) system[a][n + b] += row[a] * values[index][b];
      }
    }
    const largest = Math.max(...system.map((row, i) => row[i]));
    for (let a = 0; a < n; a++) {
      let pivot = a;
      for (let b = a + 1; b < n; b++) if (Math.abs(system[b][a]) > Math.abs(system[pivot][a])) pivot = b;
      const scale = system[pivot][a];
      if (Math.abs(scale) <= largest * 1e-9) throw new RangeError(label + ' is underdetermined');
      [system[pivot], system[a]] = [system[a], system[pivot]];
      for (let j = a; j < n + count; j++) system[a][j] /= scale;
      for (let b = 0; b < n; b++) {
        if (b === a) continue;
        const f = system[b][a];
        for (let j = a; j < n + count; j++) system[b][j] -= f * system[a][j];
      }
    }
    return Array.from({ length: count }, (_, i) => system.map(row => row[n + i]));
  }

  function stats(errors) {
    return { rms: Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length), max: Math.max(...errors) };
  }

  const bounded = (value, min, max) => finite(value) && min <= value && value <= max;
  const identity = (x, y, out) => { out[0] = x; out[1] = y; };
  const center = size => (size - 1) / 2;
  function registration(landmarks, target, source, tolerance) {
    if (landmarks === undefined) {
      if (target.some((n, i) => n !== source[i])) throw new RangeError('A capture with a different extent needs registration landmarks');
      return { map: identity, jacobian(_x, _y, out) { out[0] = out[3] = 1; out[1] = out[2] = 0; },
        report: { landmarks: 0, rmsPx: 0, maxPx: 0 } };
    }
    const inGrid = (point, size) => tuple(point, 2) && point.every((n, i) => bounded(n, 0, size[i] - 1));
    if (!Array.isArray(landmarks) || !bounded(landmarks.length, 4, 64) || !Array.from(landmarks).every(pair =>
      fields(pair, ['target', 'source']) && inGrid(pair.target, target) && inGrid(pair.source, source)))
      throw new TypeError('Registration needs 4–64 target and source pixel landmark pairs');
    const tc = target.map(center), sc = source.map(center), rows = [], goals = [];
    for (const pair of landmarks) {
      const [x, y] = pair.target.map((n, i) => n / tc[i] - 1);
      const [u, v] = pair.source.map((n, i) => n / sc[i] - 1);
      rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]);
      goals.push([u], [v]);
    }
    const [[a, b, c, d, e, f, g, h]] = fit(rows, goals, 'Landmark registration');
    const det = a * (e - f * h) - b * (d - f * g) + c * (d * h - e * g);
    if (Math.abs(g) + Math.abs(h) >= .999 || det <= 1e-9)
      throw new RangeError('Landmark registration folds, mirrors, or collapses the target');
    function map(x, y, out) {
      x = x / tc[0] - 1;
      y = y / tc[1] - 1;
      const z = 1 + g * x + h * y;
      out[0] = ((a * x + b * y + c) / z + 1) * sc[0];
      out[1] = ((d * x + e * y + f) / z + 1) * sc[1];
    }
    function jacobian(x, y, out) {
      x = x / tc[0] - 1;
      y = y / tc[1] - 1;
      const z = 1 + g * x + h * y, u = (a * x + b * y + c) / z, v = (d * x + e * y + f) / z;
      out[0] = (a - u * g) / z * sc[0] / tc[0];
      out[1] = (b - u * h) / z * sc[0] / tc[1];
      out[2] = (d - v * g) / z * sc[1] / tc[0];
      out[3] = (e - v * h) / z * sc[1] / tc[1];
    }
    const out = [0, 0], errors = landmarks.map(({ target: [x, y], source: [u, v] }) => {
      map(x, y, out);
      return Math.hypot(out[0] - u, out[1] - v);
    });
    const { rms, max } = stats(errors);
    if (max > tolerance) throw new RangeError('Landmark registration residual ' + max.toFixed(3) + ' px exceeds ' + tolerance + ' px');
    return { map, jacobian, report: { landmarks: landmarks.length, rmsPx: rms, maxPx: max } };
  }

  // Gather four samples without extending data outside the photographed surface.
  function footprint(x, y, width, height) {
    if (x < -1e-6 || y < -1e-6 || x > width - 1 + 1e-6 || y > height - 1 + 1e-6) return null;
    x = Math.max(0, Math.min(width - 1, x));
    y = Math.max(0, Math.min(height - 1, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const a = y0 * width + x0, b = a + Number(tx !== 0), c = a + (ty ? width : 0);
    return [[a, (1 - tx) * (1 - ty)], [b, tx * (1 - ty)], [c, (1 - tx) * ty], [c + (b - a), tx * ty]];
  }

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function calibration(value) {
    if (value === undefined) return { apply: color => color, report: { patches: 0 } };
    if (!fields(value, ['patches', 'black', 'maxResidual']) || !Array.isArray(value.patches) ||
        !bounded(value.patches.length, 3, 96)) throw new TypeError('Color calibration needs 3–96 measured RGB patches');
    const { patches, black = [0, 0, 0], maxResidual = .05 } = value;
    if (!bounded(maxResidual, 1e-6, 1) || !tuple(black, 3, n => bounded(n, 0, 1)) ||
        !Array.from(patches).every(row => fields(row, ['measured', 'reference']) &&
          tuple(row.measured, 3, (n) => bounded(n, -4, 16)) && tuple(row.reference, 3, (n) => bounded(n, -4, 16))))
      throw new RangeError('Color calibration needs finite linear RGB readings and a valid residual tolerance');
    const subtract = rgb => rgb.map((n, i) => n - black[i]);
    const matrix = fit(patches.map(({ measured }) => subtract(measured)), patches.map(({ reference }) => reference), 'Color calibration');
    if (matrix.flat().some(n => Math.abs(n) > 32)) throw new RangeError('Color calibration is unstable');
    const apply = rgb => {
      const corrected = subtract(rgb);
      return matrix.map(row => dot(row, corrected));
    };
    const { rms, max } = stats(patches.map(({ measured, reference }) =>
      Math.hypot(...apply(measured).map((n, c) => n - reference[c]))));
    if (max > maxResidual) throw new RangeError('Color calibration residual ' + max.toFixed(4) + ' exceeds ' + maxResidual);
    return { apply, report: { patches: patches.length, matrix, black, rms, max } };
  }

  return { registration, calibration, fields, tuple, bounded, dot, footprint };
})();
