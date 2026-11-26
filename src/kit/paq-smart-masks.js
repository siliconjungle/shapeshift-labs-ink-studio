/* Geometry-driven material placement from aligned baked images. */
(function (P) {
  const record = P.graphTypes.validator('record');
  const maxPixels = 4_194_304;
  const clamp = n => Math.max(0, Math.min(1, n));
  const between = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const sampleMax = { unorm8: 255, unorm16: 65535 };
  const keys = new Set(['coverage', 'validity', 'convex', 'concave', 'cavity', 'ao', 'exposure',
    'normal', 'position', 'metalness', 'susceptibility', 'moisture', 'source', 'partId']);
  const neighbor = [[0, 1], [0, -1], [-1, 0], [1, 0], [-1, 1], [1, 1], [-1, -1], [1, -1]];
  const common = { amount: 1, breakup: 0, frequency: 24, seed: 0 };
  const threshold = { threshold: .35, softness: .25 };
  const curvature = { curvatureScale: 1 };
  const vertical = { up: [0, 1, 0] };

  function rising(value, center, width) {
    if (!width) return Number(value >= center);
    const t = clamp(.5 + (value - center) / width);
    return t * t * (3 - 2 * t);
  }

  function aligned(a, b) {
    const equal = (left, right) => !left || !right || left[0] === right[0] && left[1] === right[1];
    return a.raster.width === b.raster.width && a.raster.height === b.raster.height &&
      equal(a.raster.pivot, b.raster.pivot) && equal(a.descriptor.pixelPitchMm, b.descriptor.pixelPitchMm);
  }

  function scale(value) {
    return sampleMax[value.descriptor.precision] ?? 1;
  }

  function images(bakes, add, remove) {
    const I = P.graphImages;
    if (!record(bakes) || Object.keys(bakes).some(key => !keys.has(key)) || !Object.hasOwn(bakes, 'coverage'))
      throw new TypeError('Smart masks need a coverage image and recognized bake inputs');
    const base = bakes.coverage;
    if (!I.valid(base)) throw new TypeError('Smart mask coverage needs an aligned typed image');
    const inputs = { ...bakes, ...(add !== null && { add }), ...(remove !== null && { remove }) };
    for (const [name, value] of Object.entries(inputs)) {
      if (name !== 'coverage' && (!I.valid(value) || !aligned(base, value))) throw new TypeError('Smart mask ' + name + ' needs an aligned typed image');
      const { intent, units, alpha, precision } = value.descriptor;
      const { channels, data } = value.raster;
      let accepted;
      if (name === 'position') accepted = intent === 'data' && channels === 3 && !sampleMax[precision];
      else if (name === 'normal') accepted = intent === 'normal' && units === 'unitless' && value.descriptor.normalSpace === 'world';
      else if (name === 'partId') accepted = intent === 'data' && channels === 1 && units === 'id' && !sampleMax[precision] &&
        data.every(n => Number.isSafeInteger(n) && n >= 0);
      else if (name === 'convex' || name === 'concave') accepted = ['mask', 'data'].includes(intent) && channels === 1 &&
        ['unitless', 'inverse-shape-units'].includes(units) && data.every(n => n >= 0 && (units !== 'unitless' || n <= scale(value)));
      else accepted = ['mask', 'data'].includes(intent) && channels === 1 && units === 'unitless' &&
        (sampleMax[precision] || data.every(n => between(n, 0, 1)));
      if (!accepted || alpha !== 'none') throw new TypeError('Incompatible bake encoding for smart mask ' + name);
    }
    return inputs;
  }

  const number = (min, max) => n => between(n, min, max);
  const limits = {
    amount: number(0, 1), breakup: number(0, 1), frequency: number(1e-5, 1e6), seed: Number.isSafeInteger,
    threshold: number(0, 1), softness: number(0, 1), curvatureScale: number(1e-9, 1e9),
    minAngle: number(0, 180), maxAngle: number(0, 180), feather: number(0, 180),
    up: v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite) && Math.hypot(...v) > 0 &&
      Number.isFinite(Math.hypot(...v)),
    level: number(-1e12, 1e12), width: number(1e-9, 1e12), side: n => ['band', 'below', 'above'].includes(n),
    length: number(1e-9, 1e12), maxGap: n => n === null || between(n, 1e-9, 1e12)
  };

  const recipes = {
    edgeWear: { settings: { ...threshold, ...curvature, threshold: .28 }, ingredients: 'Convex curvature, modulated by exposure.',
      driver: r => { const v = r.need('convex'), expose = r.read('exposure', 1);
        return p => clamp(v(p) * r.options.curvatureScale) * (.45 + .55 * expose(p)); } },
    dirt: { settings: { ...threshold, ...curvature }, ingredients: 'Cavity or concavity, with ambient shelter.',
      driver: r => { r.any('cavity', 'concave');
        const cavity = r.read('cavity'), pocket = r.read('concave'), ao = r.read('ao', 1);
        return p => 1 - (1 - cavity(p)) * (1 - .8 * clamp(pocket(p) * r.options.curvatureScale)) * (1 - .65 * (1 - ao(p))); } },
    dust: { settings: { ...threshold, ...vertical, threshold: .5 }, ingredients: 'Upward-facing surfaces and optional baked exposure.',
      driver: r => { const facing = r.facing(), exposure = r.read('exposure', 1);
        return p => Math.max(0, facing(p)) * (.6 + .4 * exposure(p)); } },
    rust: { settings: { ...threshold, threshold: .3 }, ingredients: 'Ferrous susceptibility, moisture or cavity, and sheltered retention.',
      driver: r => { r.any('susceptibility', 'metalness'); r.any('moisture', 'cavity');
        const eligible = r.has('susceptibility') ? r.need('susceptibility') : r.need('metalness');
        const moisture = r.read('moisture'), cavity = r.read('cavity'), ao = r.read('ao', 1);
        return p => eligible(p) * Math.max(moisture(p), cavity(p)) * (.65 + .35 * (1 - ao(p))); } },
    leaks: { settings: { ...threshold, ...vertical, length: .9, maxGap: null, threshold: .36 },
      ingredients: 'Source or cavity marks drained downhill over neighboring baked positions.',
      driver: r => { r.any('source', 'cavity'); return r.has('source') ? r.need('source') : r.need('cavity'); } },
    slope: { settings: { ...vertical, minAngle: 40, maxAngle: 105, feather: 8 },
      ingredients: 'Slope angles measured from the world normal and the chosen up vector.',
      driver: r => { const facing = r.facing();
        return p => Math.acos(Math.max(-1, Math.min(1, facing(p)))) / Math.PI; } },
    waterline: { settings: { ...vertical, level: 0, width: .12, side: 'band' },
      ingredients: 'Distance above or below a plane in baked position units.',
      driver: r => {
        const height = r.elevation();
        const { level, width, side } = r.options;
        return p => {
          const distance = height(p) - level;
          if (side === 'band') return 1 - clamp(Math.abs(distance) / width);
          return clamp(.5 + (side === 'below' ? -distance : distance) / (2 * width));
        };
      } },
    exposure: { settings: { ...threshold, threshold: .5 }, ingredients: 'Baked directional exposure or hemispherical AO visibility.',
      driver: r => { r.any('exposure', 'ao'); return r.has('exposure') ? r.need('exposure') : r.need('ao'); } }
  };
  const names = Object.freeze(Object.keys(recipes));

  function configure(recipe, authored) {
    if (!Object.hasOwn(recipes, recipe) || !record(authored)) throw new TypeError('Choose a smart mask recipe and an options record');
    const defaults = { ...common, ...recipes[recipe].settings };
    for (const [key, value] of Object.entries(authored)) {
      if (!Object.hasOwn(defaults, key) || !limits[key](value)) throw new RangeError('Invalid ' + recipe + ' option ' + key);
    }
    const options = { ...defaults, ...authored };
    if (recipe === 'slope' && options.minAngle > options.maxAngle) throw new RangeError('Slope needs ordered angles');
    return options;
  }

  function readers(input, options) {
    const used = new Set();
    const has = name => Object.hasOwn(input, name);
    const need = name => {
      if (!has(name)) throw new TypeError('Smart mask needs ' + name);
      const value = input[name], data = value.raster.data, divisor = scale(value);
      used.add(name);
      return p => data[p] / divisor;
    };
    const read = (name, absent = 0) => has(name) ? need(name) : () => absent;
    const any = (...names) => {
      if (!names.some(has)) throw new TypeError('Smart mask needs ' + names.join(' or '));
    };
    const up = options.up && options.up.map(n => n / Math.hypot(...options.up));
    function facing() {
      need('normal');
      const read = P.graphImages.normals.reader(input.normal), xyz = [0, 0, 0];
      return p => {
        read(p, xyz);
        const length = Math.hypot(...xyz);
        if (length < 1e-7) throw new RangeError('Covered smart mask texel has no world normal');
        return (xyz[0] * up[0] + xyz[1] * up[1] + xyz[2] * up[2]) / length;
      };
    }
    function elevation() {
      const read = need('position');
      return p => {
        const i = p * 3, y = up[0] * read(i) + up[1] * read(i + 1) + up[2] * read(i + 2);
        if (!Number.isFinite(y)) throw new RangeError('Smart mask position exceeds its coordinate range');
        return y;
      };
    }
    return { options, used, has, need, read, any, facing, elevation, input };
  }

  function distance(read, a, b) {
    return Math.hypot(read(3 * a) - read(3 * b), read(3 * a + 1) - read(3 * b + 1), read(3 * a + 2) - read(3 * b + 2));
  }

  function typicalGap(active, id, read, width) {
    const lengths = [], stride = Math.max(1, Math.floor(active.length / 4096));
    function measure(p, q) {
      if (!active[q] || id(p) !== id(q)) return;
      const gap = distance(read, p, q);
      if (gap > 0 && Number.isFinite(gap)) lengths.push(gap);
    }
    for (let p = 0; p < active.length; p += stride) if (active[p]) {
      if (p % width < width - 1) measure(p, p + 1);
      if (p + width < active.length) measure(p, p + width);
    }
    lengths.sort((a, b) => a - b);
    return lengths.length ? Math.min(1e12, 3 * lengths[Math.floor(lengths.length / 2)]) : 0;
  }

  function drain(r, active, driver, width, height) {
    const count = active.length, raw = new Float32Array(count), drop = new Float64Array(count);
    const next = new Int32Array(count).fill(-1), pending = new Uint8Array(count), queue = new Int32Array(count);
    const elevation = r.elevation(), position = r.need('position'), id = r.read('partId');
    const maxGap = r.options.maxGap ?? typicalGap(active, id, position, width);
    for (let p = 0; p < count; p++) if (active[p]) {
      drop[p] = elevation(p);
      raw[p] = driver[p] * rising(driver[p], r.options.threshold, r.options.softness);
    }
    let routed = 0, head = 0, tail = 0;
    for (let p = 0; p < count; p++) if (active[p]) {
      const x = p % width, y = Math.floor(p / width);
      let steepest = 0, reach = Infinity;
      for (const [dx, dy] of neighbor) {
        const u = x + dx, v = y + dy, q = p + dx + dy * width;
        if (u < 0 || u >= width || v < 0 || v >= height || !active[q] || id(p) !== id(q)) continue;
        const fall = drop[p] - drop[q];
        if (!(fall > 1e-8 * maxGap)) continue;
        const step = distance(position, p, q);
        if (!(step > 0) || step > maxGap) continue;
        const grade = fall / step;
        if (grade > steepest + 1e-7 || Math.abs(grade - steepest) <= 1e-7 && step < reach) {
          steepest = grade;
          reach = step;
          next[p] = q;
        }
      }
      if (next[p] >= 0) { pending[next[p]]++; routed++; }
    }
    for (let p = 0; p < count; p++) if (active[p] && !pending[p]) queue[tail++] = p;
    while (head < tail) {
      const p = queue[head++], q = next[p];
      if (q < 0) continue;
      raw[q] = Math.max(raw[q], raw[p] - distance(position, p, q) / r.options.length);
      if (!--pending[q]) queue[tail++] = q;
    }
    return { data: raw, routed, maxGap };
  }

  function angleRange(angle, { minAngle, maxAngle, feather }) {
    if (!feather) return Number(angle >= minAngle && angle <= maxAngle);
    const lower = minAngle === 0 ? 1 : rising(angle, minAngle, feather);
    const upper = maxAngle === 180 ? 1 : rising(-angle, -maxAngle, feather);
    return lower * upper;
  }

  function breakupAt(r, width, height) {
    if (!r.options.breakup) return () => 1;
    const { frequency, seed, breakup } = r.options;
    const position = r.has('position') && r.need('position');
    const noise = P.namedNoise.create('perlin', { dimension: position ? 3 : 2, seed });
    return p => {
      const i = p * 3;
      const value = position ? noise(position(i) * frequency, position(i + 1) * frequency, position(i + 2) * frequency) :
        noise((p % width + .5) * frequency / width, (Math.floor(p / width) + .5) * frequency / height);
      return 1 - breakup * (1 - rising(value, .52, .56));
    };
  }

  function evaluate(recipe, bakes, options = {}, add = null, remove = null) {
    const spec = configure(recipe, options);
    const input = images(bakes, add, remove), info = recipes[recipe], r = readers(input, spec);
    const { raster: grid, descriptor } = input.coverage;
    const { width, height, pivot } = grid, count = width * height;
    if (count > maxPixels) throw new RangeError('Smart mask exceeds its four million texel budget');
    const coverage = r.need('coverage'), valid = r.read('validity', 1);
    const paint = r.read('add'), erase = r.read('remove');
    const ingredient = info.driver(r), variation = breakupAt(r, width, height);
    const driver = new Float32Array(count), raw = new Float32Array(count), result = new Float32Array(count);
    const domain = new Float32Array(count);
    let covered = 0, affected = 0, rawSum = 0, correctedSum = 0;
    for (let p = 0; p < count; p++) {
      domain[p] = coverage(p) * valid(p);
      if (domain[p]) { driver[p] = clamp(ingredient(p)); covered++; }
    }
    const flow = recipe === 'leaks' ? drain(r, domain, driver, width, height) : null;
    const shape = recipe === 'waterline' ? n => rising(n, .5, 1) : recipe === 'slope' ?
      n => angleRange(n * 180, spec) : n => n > 0 ? rising(n, spec.threshold, spec.softness) : 0;
    for (let p = 0; p < count; p++) if (domain[p]) {
      const value = clamp((flow ? flow.data[p] : shape(driver[p])) * spec.amount * variation(p));
      raw[p] = value * domain[p];
      result[p] = Math.max(value, paint(p)) * (1 - erase(p)) * domain[p];
      driver[p] *= domain[p];
      if (result[p] > 0) affected++;
      rawSum += raw[p];
      correctedSum += result[p];
    }
    const image = data => P.graphImages.declare({ width, height, channels: 1, data, pivot }, {
      intent: 'mask', sampling: descriptor.sampling, tiling: descriptor.tiling,
      pixelPitchMm: descriptor.pixelPitchMm, materialSeed: descriptor.materialSeed
    });
    return { evidence: image(driver), raw: image(raw), value: image(result),
      report: { recipe, settings: spec, ingredients: info.ingredients, inputs: [...r.used].sort(), covered, affected,
        rawMean: covered ? rawSum / covered : 0, mean: covered ? correctedSum / covered : 0,
        ...(r.used.has('position') && { positionUnits: input.position.descriptor.units }),
        ...(flow && { routed: flow.routed, maxGap: flow.maxGap }) } };
  }

  const optional = { type: 'any', default: null, description: 'Optional aligned unitless grayscale correction image.' };
  const operation = {
    description: 'Generate and inspect a wear or environment mask from aligned geometry bakes and authored corrections.',
    inputs: {
      recipe: 'string', bakes: { type: 'record', description: 'Named typed bakes for one UV grid.' },
      options: { type: 'record', default: {} }, add: optional, remove: optional
    },
    outputs: { value: 'grayImage', raw: 'grayImage', evidence: 'grayImage', report: 'record' },
    run({ recipe, bakes, options, add, remove }) { return evaluate(recipe, bakes, options, add, remove); }
  };
  P.smartMasks = Object.freeze({ names, evaluate, operations: Object.freeze({ 'material.smartMask': operation }) });
})(KIT.procedural);
