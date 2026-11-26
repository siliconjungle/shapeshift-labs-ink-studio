/* Retained finish channels shared by the sculpt bake and headless lighting. */
const PaintFinish = (() => {
  let space, area;
  try { space = ColorSpace; area = AreaLights; }
  catch { space = require('./color-space.js'); area = require('./area-lights.js'); }
  const toLinear = space.prepare('srgb', 'srgb-linear'), toDisplay = space.prepare('srgb-linear', 'srgb');
  const stride = 13;
  const channels = ['tint', 'hueShift', 'roughness', 'coating', 'emission'];
  const keys = Object.freeze(['opacity', ...channels]);
  const clamp = n => Math.max(0, Math.min(1, n));
  const range = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
  const fields = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => keys.includes(key));
  function color(value) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Finish colors need #rrggbb');
    return toLinear([1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255));
  }
  function prepare(raw) {
    if (raw === undefined) return;
    if (!fields(raw, keys) || !channels.some(key => raw[key] !== undefined))
      throw new TypeError('A finish needs tint, hueShift, roughness, coating or emission');
    const { opacity = 1, tint, hueShift, roughness, coating, emission } = raw;
    if (!range(opacity, 0, 1) || hueShift !== undefined && !range(hueShift, -360, 360) ||
        roughness !== undefined && !range(roughness, 0, 1))
      throw new RangeError('Finish opacity and roughness must be in 0–1 and hueShift in −360–360 degrees');
    const plan = { opacity, hueShift, roughness };
    if (tint !== undefined) {
      if (!fields(tint, ['color', 'strength']) || !range(tint.strength ?? 1, 0, 1))
        throw new TypeError('Finish tint needs a color and strength in 0–1');
      plan.tint = { rgb: color(tint.color), strength: tint.strength ?? 1 };
    }
    if (coating !== undefined) {
      if (!fields(coating, ['weight', 'roughness']) || !range(coating.weight, 0, 1) || !range(coating.roughness ?? .18, 0, 1))
        throw new TypeError('Finish coating needs weight and roughness in 0–1');
      plan.coating = { weight: coating.weight, roughness: coating.roughness ?? .18 };
    }
    if (emission !== undefined) {
      if (!fields(emission, ['color', 'strength', 'spill']) || !range(emission.strength ?? 1, 0, 64))
        throw new TypeError('Finish emission needs a color and strength in 0–64');
      const { strength = 1, spill } = emission;
      plan.emission = color(emission.color).map(n => n * strength);
      if (spill !== undefined && spill !== false) {
        if (!fields(spill, ['intensity', 'radius', 'lift', 'shadows']) || !range(spill.intensity, 0, 64) ||
            !range(spill.radius, .001, 100) || !range(spill.lift ?? .2, .02, 100) || typeof (spill.shadows ?? true) !== 'boolean')
          throw new TypeError('Finish spill needs intensity, radius, optional surface lift and a shadow switch');
        if (opacity && plan.emission.some(Boolean) && spill.intensity)
          plan.spill = { ...spill, color: emission.color, lift: spill.lift ?? .2, shadows: spill.shadows ?? true };
      }
    }
    return plan;
  }

  function add(row, plan, w) {
    row ??= [0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const { tint, hueShift, roughness, coating, emission } = plan;
    const over = (lane, n) => row[lane] = row[lane] * (1 - w) + n * w;
    if (tint || hueShift) {
      row[0] |= 1;
      if (tint) for (let i = 0; i < 3; i++) row[i + 1] *= 1 + (tint.rgb[i] - 1) * w * tint.strength;
      row[4] = (row[4] + (hueShift ?? 0) * w) % 360;
    }
    if (roughness !== undefined) {
      row[0] |= 2;
      over(5, 1);
      over(6, roughness);
    }
    if (coating) {
      row[0] |= 4;
      over(7, 1);
      over(8, coating.weight);
      over(9, coating.roughness);
    }
    if (emission?.some(Boolean)) {
      row[0] |= 8;
      for (let i = 0; i < 3; i++) row[10 + i] = Math.min(64, row[10 + i] + emission[i] * w);
    }
    return row;
  }

  function hue(rgb, degrees) {
    const [r, g, b] = rgb, hi = Math.max(r, g, b), lo = Math.min(r, g, b), c = hi - lo;
    if (!c || !degrees) return rgb;
    const h = hi === r ? (g - b) / c : hi === g ? 2 + (b - r) / c : 4 + (r - g) / c;
    const at = ((h + degrees / 60) % 6 + 6) % 6, half = c * (1 - Math.abs(at % 2 - 1));
    const sectors = [[c, half, 0], [half, c, 0], [0, c, half], [0, half, c], [half, 0, c], [c, 0, half]];
    return sectors[Math.floor(at)].map(n => n + lo);
  }

  function gradeLinear(row, rgb) {
    if (!(row?.[0] & 1)) return rgb;
    const tinted = rgb.map((value, i) => clamp(value * row[i + 1]));
    return row[4] ? toLinear(hue(toDisplay(tinted), row[4])) : tinted;
  }
  function display(row, rgb, emission) {
    if (!(row[0] & 1) && !emission) return rgb;
    const out = gradeLinear(row, toLinear(rgb.map(clamp)));
    return toDisplay(emission ? out.map((v, i) => clamp(v + emission[i])) : out);
  }
  const roughness = (row, base) => row?.[0] & 2 ? base * (1 - row[5]) + row[6] : base;
  const coat = (row, base, rough) => row?.[0] & 4 ?
    [base * (1 - row[7]) + row[8], rough * (1 - row[7]) + row[9]] : [base, rough];
  const emission = row => row?.[0] & 8 ? [row[10], row[11], row[12]] : undefined;
  const at = (rows, i) => rows?.[i * stride] ? rows.subarray(i * stride, (i + 1) * stride) : undefined;

  function spillLights(sources, { x, y, z, alpha }, normalAt) {
    const lights = (sources ?? []).flatMap(({ id, spill, rows }) => {
      const position = [0, 0, 0], normal = [0, 0, 0];
      let count = 0, coverage = 0;
      for (let r = 0; r < rows.length; r += 2) {
        const i = rows[r], opacity = Math.min(1, alpha[i]);
        if (!(opacity > 0)) continue;
        const w = rows[r + 1] * opacity, n = normalAt(i);
        position[0] += x[i] * w;
        position[1] += y[i] * w;
        position[2] += z[i] * w;
        if (n) for (let k = 0; k < 3; k++) normal[k] += n[k] * w;
        count += opacity;
        coverage += w;
      }
      if (!coverage) return [];
      const len = Math.hypot(...normal), n = len > 1e-9 ? normal.map(v => v / len) : [0, 0, 1];
      return [{ id, at: position.map((v, i) => v / coverage + n[i] * spill.lift), normal: n,
        size: [.14, .14], sampleGrid: 2, twoSided: true, visible: false, reflection: false, color: spill.color,
        intensity: spill.intensity * coverage / count, radius: spill.radius, shadows: spill.shadows }];
    });
    return lights.flatMap(light => area.prepare([light])).map(light => ({ ...light, paintedFinish: true }));
  }
  return Object.freeze({ stride, keys, prepare, add, at, gradeLinear, display, roughness, coat, emission, spillLights });
})();
if (typeof module !== 'undefined') module.exports = PaintFinish;
