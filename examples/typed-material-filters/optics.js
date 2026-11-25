/* A native HDR fixture and a material graph shared by browser and CLI. */
const opticsWidth = 144, opticsHeight = 86;
const opticsProbe = [72, 41];
const opticsFilters = {
  gaussianBlur: { label: 'Gaussian blur', radius: 3 },
  directionalBlur: { label: 'Directional blur', radius: 7, angle: 24 },
  radialBlur: { label: 'Radial blur', radius: 9 },
  anisotropicBlur: { label: 'Anisotropic blur', radius: 8, angle: 29 },
  variableBlur: { label: 'Variable blur', radius: 5 },
  highPass: { label: 'High pass', radius: 3 },
  unsharpMask: { label: 'Unsharp mask', radius: 3 },
  sharpen: { label: 'Sharpen', radius: 1 },
  antialias: { label: 'Antialias', radius: .85 }
};

function opticsImages() {
  const width = opticsWidth, height = opticsHeight, data = new Float64Array(width * height * 4);
  const map = new Float64Array(width * height);
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    const dx = x - 71, dy = y - 41, ax = Math.abs(dx), ay = Math.abs(dy);
    const grain = (Math.imul(x + 11, 8297) ^ Math.imul(y + 19, 3719)) & 63;
    const tile = ax <= 58 && ay <= 32 && ax * .65 + ay < 53;
    const seam = ax > 54 || ay > 29 || ax * .65 + ay >= 50;
    const blade = ax * .84 + ay;
    let color = [1.35, .12, .38, 0];
    if (tile) {
      color = seam ? [.115, .175, .18, 1] : [.021 + grain / 5900, .062 + grain / 3300, .079, 1];
      if (seam && dy < 8) color = [.20, .29, .28, 1];
      if (!seam && (y % 8 === 0 || (x + Math.floor(y / 8) * 4) % 18 === 0)) color = [.014, .045, .060, 1];
      if (!seam && dx < -28 && dy > 16 && dy % 4 === 0) color = [.06, .28, .26, 1];
      if (!seam && dx > 28 && dy < -8 && dy % 7 === 0) color = [.28, .13, .06, 1];
      if (blade < 26) {
        const tier = Math.floor(blade / 4);
        color = [1.32 - tier * .13, .56 - tier * .065, .17 - tier * .018, 1];
        if (dx > 0) color = color.map((n, k) => k === 3 ? n : n * .76);
        if (blade <= 7) color = [2.8, 1.23, .42, 1];
        if ((dx === 1 || Math.abs(dy + dx * .2) < 1) && blade > 7) color = [.40, .135, .049, 1];
      }
      if (blade >= 26 && blade < 28) color = [.52, .21, .078, 1];
      else if (blade >= 28 && blade < 31) color = [.028, .043, .049, 1];
      if (ax > 39 && ay < 12 && (x % 7 === 0 || y % 5 === 0)) color = [.09, .26, .28, 1];
      if (Math.hypot(ax - 47, ay - 23) < 2.2) color = [.55, .32, .14, 1];
    }
    if (x >= 128 && y >= 37 && y < 45) {
      const bright = y === 38 || y === 43;
      color = bright ? [.13, .31, .30, 1] : [.038, .10, .12, 1];
    }
    data.set(color, i * 4);
    map[i] = x < 36 ? 0 : Math.min(1, (x - 36) / 85);
  }
  return { plate: { width, height, channels: 4, data }, radiusMap: { width, height, channels: 1, data: map } };
}

function opticsSettings(mode, controls = {}) {
  const { radius = opticsFilters[mode].radius, across = 2, angle = opticsFilters[mode].angle ?? 0, intensity = 1,
    border = 'clamp', precision = 'float64', radialMode = 'spin' } = controls;
  return { intensity, border, precision, outOfRange: 'clamp',
    ...(mode === 'anisotropicBlur' ? { radii: [radius, across], angle } : { radius }),
    ...(mode === 'directionalBlur' && { angle }),
    ...(mode === 'radialBlur' && { mode: radialMode, center: [.5, .48] }),
    ...(mode === 'highPass' && { bias: .14 }) };
}

function opticsGraph(mode = 'anisotropicBlur') {
  const op = (op, inputs) => ({ op, inputs });
  const link = node => ({ node });
  const input = input => ({ input });
  return {
    format: 'ink-studio/graph-project', version: 1,
    inputs: { plate: 'raster', radiusMap: 'raster', settings: { type: 'record', default: opticsSettings(mode) } },
    nodes: {
      source: op('image.declare', { source: input('plate'), descriptor: { intent: 'color', colorSpace: 'srgb-linear' } }),
      map: op('image.declare', { source: input('radiusMap'), descriptor: { intent: 'mask' } }),
      filtered: op('image.' + mode, { source: link('source'), options: input('settings'),
        ...(mode === 'variableBlur' && { radiusMap: link('map') }) }),
      before: op('image.toDisplay', { source: link('source') }),
      after: op('image.toDisplay', { source: link('filtered') })
    },
    outputs: { before: link('before'), after: link('after'), source: link('source'), filtered: link('filtered') },
    exports: { picture: { output: 'after', format: 'png' }, samples: { output: 'filtered', format: 'json' } }
  };
}

if (typeof module !== 'undefined') module.exports = { opticsImages, opticsGraph, opticsProbe };
