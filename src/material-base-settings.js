/* Shared material defaults used by the graph runtime and authoring surfaces. */
const MaterialBaseSettings = (() => {
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const edges = ['clamp', 'transparent', 'wrap', 'mirror'];
  const positiveInteger = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;

  const keys = ['size', 'output', 'pixelSizeMm', 'pixelRatio', 'tiling', 'seed'];
  const own = Object.hasOwn;
  const positive = n => Number.isFinite(n) && n > 0;
  const pair = (value, test) => Array.isArray(value) && value.length === 2 && test(value[0]) && test(value[1]);

  function fields(value, keys, label) {
    if (!record(value) || Object.keys(value).some(key => !keys.includes(key)))
      throw new TypeError('Invalid material base ' + label);
  }

  function resolve(source = {}, { seed: defaultSeed = 0 } = {}) {
    fields(source, keys, 'settings');
    const { size = {}, output = {}, pixelSizeMm = 1, pixelRatio = [1, 1], tiling = {}, seed = defaultSeed } = source;
    fields(size, ['width', 'height', 'lock'], 'output size');
    fields(output, ['format', 'bitDepth'], 'output format');
    fields(tiling, ['u', 'v'], 'tiling');
    const { width = 256, height = 256, lock = false } = size;
    if (!positiveInteger(width, 8192) || !positiveInteger(height, 8192) || typeof lock !== 'boolean' ||
        width * (lock ? width : height) > 16777216)
      throw new RangeError('Material base size exceeds the raster budget or has an invalid lock');
    const { format = 'png', bitDepth = format === 'png' ? 8 : undefined } = output;
    if (format === 'png' ? ![8, 16].includes(bitDepth) : format !== 'json' || bitDepth !== undefined)
      throw new TypeError('Material base output needs PNG at 8 or 16 bits, or JSON');
    if (!Number.isFinite(pixelSizeMm) || pixelSizeMm <= 0 || !Array.isArray(pixelRatio) || pixelRatio.length !== 2 ||
        !positiveInteger(pixelRatio[0], 65535) || !positiveInteger(pixelRatio[1], 65535))
      throw new RangeError('Material base needs positive millimeters and a positive integer X:Y pixel ratio');
    const { u = 'wrap', v = 'wrap' } = tiling;
    if (!edges.includes(u) || !edges.includes(v)) throw new TypeError('Invalid per-axis material base tiling');
    if (!Number.isSafeInteger(seed)) throw new TypeError('Material base seed must be a safe integer');

    const settings = { size: { width, height: lock ? width : height, lock },
      output: { format, ...(bitDepth !== undefined && { bitDepth }) }, pixelSizeMm, pixelRatio: pixelRatio.slice(),
      tiling: { u, v }, seed };
    if (measure(settings).pixelsPerMeter.some(value => !positiveInteger(value, 0xffffffff)))
      throw new RangeError('Material base pixel pitch exceeds the supported physical density range');
    return settings;
  }

  function measure({ size, pixelSizeMm, pixelRatio }) {
    const pitchY = pixelSizeMm * (pixelRatio[1] / pixelRatio[0]);
    return {
      pixelPitchMm: [pixelSizeMm, pitchY],
      physicalSizeMm: [size.width * pixelSizeMm, size.height * pitchY],
      pixelsPerMeter: [Math.round(1000 / pixelSizeMm), Math.round(1000 / pitchY)]
    };
  }

  function checkRules(rules = {}) {
    fields(rules, keys, 'inheritance rules');
    for (const [key, rule] of Object.entries(rules)) {
      if (!record(rule) || !['absolute', 'parent', 'primary'].includes(rule.mode))
        throw new TypeError('Material base ' + key + ' needs absolute, parent or primary inheritance');
      const allowed = rule.mode === 'absolute' ? [] :
        key === 'size' ? ['scale', 'lock'] : key === 'seed' ? ['offset'] :
          key === 'pixelSizeMm' || key === 'pixelRatio' ? ['scale'] : [];
      fields(rule, ['mode', ...allowed], key + ' inheritance');
      if (own(rule, 'scale') && !(key === 'size' ? pair(rule.scale, positive) :
          key === 'pixelRatio' ? pair(rule.scale, n => positiveInteger(n, 65535)) : positive(rule.scale)) ||
          own(rule, 'lock') && typeof rule.lock !== 'boolean' ||
          own(rule, 'offset') && !Number.isSafeInteger(rule.offset))
        throw new RangeError('Invalid material base ' + key + ' adjustment');
    }
    return rules;
  }

  function checkContext(context = {}) {
    fields(context, ['parent', 'primary'], 'inheritance context');
    const result = {};
    for (const [mode, provider] of Object.entries(context)) {
      fields(provider, ['id', 'settings'], mode + ' provider');
      const { id, settings } = provider;
      if (typeof id !== 'string' || !id.trim() || id.length > 120 || !record(settings))
        throw new TypeError('Material base ' + mode + ' provider needs an ID and settings');
      const normalized = resolve(settings);
      result[mode] = { id, settings: Object.fromEntries(Object.keys(settings).map(key => [key, normalized[key]])) };
    }
    return result;
  }

  function reduceRatio(x, y) {
    let a = x, b = y;
    while (b) [a, b] = [b, a % b];
    return [x / a, y / a];
  }

  function ratioFromPitch([x, y]) {
    const ratio = x / y;
    if (ratio < 1 / 65535 || ratio > 65535) return;
    const tolerance = 1e-9 * ratio;
    for (let denominator = 1; denominator <= 65535; denominator++) {
      const numerator = Math.round(ratio * denominator);
      if (numerator > 65535) return;
      if (numerator && Math.abs(numerator / denominator - ratio) <= tolerance)
        return reduceRatio(numerator, denominator);
    }
  }

  function adjust(key, value, rule) {
    if (key === 'size') {
      const [x, y] = rule.scale ?? [1, 1];
      return { width: Math.max(1, Math.round(x * value.width)), height: Math.max(1, Math.round(y * value.height)),
        lock: rule.lock ?? value.lock };
    }
    if (key === 'pixelSizeMm') return value * (rule.scale ?? 1);
    if (key === 'pixelRatio' && rule.scale) return reduceRatio(value[0] * rule.scale[0], value[1] * rule.scale[1]);
    if (key === 'seed') return value + (rule.offset ?? 0);
    return value;
  }

  function inherit(source = {}, rules = {}, context = {}, { seed, seedOverride } = {}) {
    const local = resolve(source, { seed });
    const sources = checkContext(context);
    const policies = checkRules(rules);
    const provenance = {}, selections = {};
    for (const key of keys) {
      const rule = policies[key] ?? { mode: 'absolute' };
      const { mode, ...adjustment } = rule;
      if (key === 'seed' && seedOverride !== undefined) {
        selections.seed = seedOverride;
        provenance.seed = { mode: 'absolute', source: { kind: 'run-override' } };
        continue;
      }
      if (mode === 'absolute') {
        selections[key] = own(source, key) ? source[key] : local[key];
        provenance[key] = { mode, source: { kind: own(source, key) ? 'authored' : key === 'seed' && seed !== undefined ? 'graph-seed' : 'default' } };
        continue;
      }
      const provider = sources[mode];
      if (!provider || !own(provider.settings, key))
        throw new RangeError('Material base ' + key + ' needs a value from ' + (provider ? mode + ' ' + provider.id : 'the ' + mode));
      const from = provider.settings[key];
      selections[key] = adjust(key, from, rule);
      provenance[key] = { mode, source: { kind: mode, id: provider.id }, sourceValue: from,
        ...(Object.keys(adjustment).length && { adjustment }) };
    }
    const base = resolve(selections);
    for (const key of keys) provenance[key].value = base[key];
    return { base, provenance };
  }

  return Object.freeze({ resolve, measure, inherit, checkRules, checkContext, ratioFromPitch });
})();
if (typeof module !== 'undefined') module.exports = MaterialBaseSettings;
