/* Versioned one-shots for the typed Ink audio graph. */
(function (P) {
  const { check, fields, id, integer, finite, noise, hash, clamp } = P.musicInstruments;
  const format = 'ink-studio/sound-recipe', tau = Math.PI * 2;
  const mutationFormat = 'ink-studio/sound-mutation';
  const wavEncodings = Object.freeze(['pcm16', 'pcm24', 'float32']);
  const shapeDefaults = { pitchSemitones: 0, sweep: 1, attack: 1, brightness: 1, noise: 1, decay: 1 };
  const controls = {
    pitchSemitones: [-9, 9], sweep: [.5, 1.4], attack: [.25, 3], brightness: [.25, 2],
    noise: [0, 2], decay: [.45, 2.5], duration: [.04, 4], peak: [.01, 1]
  };
  const defaultSpread = { pitchSemitones: .65, sweep: .18, attack: .3, brightness: .35, noise: .45, decay: .3 };
  const lockControls = { pitchContour: ['pitchSemitones', 'sweep'], duration: ['duration'], attack: ['attack'] };
  const spectra = {
    round: [1, .23, .08],
    bright: [1, .35, .19, .09],
    hollow: [1, 0, .28, 0, .11],
    bell: [1, .10, .23, .08]
  };
  const tone = (span, pitch, gain, color = 'round', motion = 1) => ({ span, pitch, gain, color, motion });
  const air = (span, filter, gain, decay) => ({ span, filter, gain, decay });
  const families = {
    confirm: { duration: .26, voices: [
      tone([0, .41], [520, 520], .61),
      tone([.32, 1], [785, 785], .78, 'bell'),
      air([0, .13], 2400, .16, 3)
    ] },
    warning: { duration: .58, voices: [
      tone([0, .29], [306, 298], .8, 'hollow'),
      tone([.34, .62], [306, 298], .8, 'hollow'),
      tone([.68, 1], [246, 218], 1, 'hollow')
    ] },
    pickup: { duration: .42, voices: [
      tone([0, .36], [655, 675], .73, 'bright'),
      tone([.18, .55], [878, 900], .70, 'bright'),
      tone([.36, .72], [1108, 1120], .65, 'bell'),
      tone([.55, 1], [1395, 1395], .60, 'bell')
    ] },
    impact: { duration: .31, voices: [
      tone([0, .64], [177, 51], .9, 'round', .32),
      tone([.01, .54], [270, 122], .32, 'hollow', .67),
      air([0, .54], 3700, .97, 3),
      air([0, 1], 740, .55, 3.7)
    ] },
    jump: { duration: .36, voices: [
      tone([0, .99], [165, 742], 1, 'hollow', .56),
      tone([.15, .76], [313, 1003], .18, 'round', .74),
      air([0, .45], 3050, .27, 2.3)
    ] },
    charge: { duration: .92, voices: [
      { ...tone([0, 1], [133, 521], .84, 'hollow', 1.65), swell: true },
      { ...tone([.13, 1], [270, 1044], .33, 'bright', 1.55), swell: true },
      tone([.82, 1], [780, 1120], .23, 'bell'),
      air([.11, .98], 4200, .17, .44)
    ] }
  };

  const voiceFrames = (voice, frames) => Math.round(frames * voice.span[1]) - Math.round(frames * voice.span[0]);

  function attackFrames(family, voice, rate, referenceFrames, scale) {
    const cap = rate * (family === 'impact' ? .0018 : .006);
    return Math.max(1, Math.min(voiceFrames(voice, referenceFrames) * .085, cap) * scale);
  }

  function attackFits(family, rate, duration, shape, ranges = false) {
    const frames = Math.round(rate * duration), reference = Math.round(rate * shape.attackReferenceDuration);
    return families[family].voices.every(voice => {
      const length = ranges ? Math.floor(frames * voice.span[1] - frames * voice.span[0]) : voiceFrames(voice, frames);
      return attackFrames(family, voice, rate, reference, shape.attack) < length - 1;
    });
  }
  const attackError = 'Attack needs to fit inside every layer. Shorten the attack or increase the duration.';

  function normalizeShape(raw, duration) {
    check(fields(raw, [...Object.keys(shapeDefaults), 'attackReferenceDuration']), 'Unknown sound recipe shape control');
    const shape = { ...shapeDefaults, attackReferenceDuration: duration, ...raw };
    check(finite(shape.attackReferenceDuration, ...controls.duration), 'Invalid attack reference duration');
    for (const key of Object.keys(shapeDefaults))
      check(finite(shape[key], ...controls[key]), 'Invalid sound recipe shape control ' + key);
    return shape;
  }

  function normalize(source) {
    check(fields(source, ['format', 'version', 'id', 'family', 'seed', 'render', 'shape']) &&
      source.format === format && source.version === 1 && typeof source.family === 'string' &&
      Object.hasOwn(families, source.family) && (source.id === undefined || id(source.id)) && Number.isSafeInteger(source.seed),
    'Expected a version 1 sound recipe with a known family and an integer seed');
    const settings = source.render === undefined ? {} : source.render;
    check(fields(settings, ['sampleRate', 'duration', 'peak', 'encoding']), 'Invalid sound recipe render settings');
    const { sampleRate = 48000, duration = families[source.family].duration, peak = .75, encoding = 'pcm24' } = settings;
    check(integer(sampleRate, 8000, 96000) && finite(duration, .04, 4) && finite(peak, .01, 1) &&
      wavEncodings.includes(encoding), 'Sound recipes need a bounded duration, sample rate, peak and WAV encoding');
    const shape = source.shape === undefined ? undefined : normalizeShape(source.shape, duration);
    if (shape) check(attackFits(source.family, sampleRate, duration, shape), attackError);
    return { format, version: 1, id: source.id ?? source.family, family: source.family, seed: source.seed,
      render: { sampleRate, duration, peak, encoding }, ...(shape && { shape }) };
  }

  function oscillator(voice, rate, salt, { pitchSemitones, sweep, brightness }) {
    const [from, to] = voice.pitch, tuning = 2 ** (noise(0, salt) * .075 + pitchSemitones / 12);
    const end = sweep === 1 ? to : from * (to / from) ** sweep;
    const weights = spectra[voice.color].map((gain, index) =>
      (index + 1) * Math.max(from, end) * tuning < .45 * rate ? gain * brightness ** index : 0);
    let phase = 0;
    return progress => {
      const hz = from * (to / from) ** (progress ** voice.motion * sweep) * tuning;
      phase = (phase + hz / rate) % 1;
      let value = 0;
      for (let i = 0; i < weights.length; i++) if (weights[i]) value += weights[i] * Math.sin(tau * phase * (i + 1));
      return value;
    };
  }

  function coloredNoise(voice, rate, salt) {
    const weight = 1 - Math.exp(-tau * Math.min(voice.filter, .42 * rate) / rate);
    let prior = 0;
    return index => {
      prior += (noise(index, salt) - prior) * weight;
      return prior;
    };
  }

  function render(source) {
    const recipe = normalize(source), { family, seed } = recipe;
    const { sampleRate, duration, peak: target } = recipe.render;
    const frames = Math.round(sampleRate * duration), samples = new Float32Array(frames);
    const shape = recipe.shape ?? shapeDefaults;
    const reference = recipe.shape ? Math.round(sampleRate * shape.attackReferenceDuration) : frames;
    const attacks = [];
    for (const [layer, voice] of families[family].voices.entries()) {
      const salt = hash([format, 1, seed, family, layer]), tone = voice.pitch !== undefined;
      const sample = tone ? oscillator(voice, sampleRate, salt, shape) : coloredNoise(voice, sampleRate, salt);
      const first = Math.round(frames * voice.span[0]), end = Math.round(frames * voice.span[1]);
      const length = end - first, attack = attackFrames(family, voice, sampleRate, reference, shape.attack);
      attacks.push(attack);
      const gain = voice.gain * (1 + noise(1, salt) * .11) * (tone ? 1 : shape.noise);
      for (let i = 0; i < length; i++) {
        const progress = i / Math.max(1, length - 1), tail = 1 - progress;
        const envelope = voice.swell ?
          (.25 + .75 * progress) * clamp(tail * 12) ** shape.decay * (.72 + .28 * Math.cos(tau * (2 * progress + 7 * progress ** 2))) :
          tail ** ((voice.decay ?? 1.18) * shape.decay);
        samples[first + i] += gain * sample(tone ? progress : i) * envelope * clamp(i / attack);
      }
    }
    let peak = 0, energy = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    const factor = target / peak;
    for (let i = 0; i < samples.length; i++) {
      samples[i] *= factor;
      energy += samples[i] ** 2;
    }
    return { value: { sampleRate, channels: 1, samples }, recipe,
      report: { frames, seconds: frames / sampleRate, attackFrames: attacks,
        peak: Math.fround(target), rms: Math.sqrt(energy / frames) } };
  }

  function variationBounds(base, authored, locks) {
    check(authored === undefined || fields(authored, Object.keys(controls)), 'Unknown sound mutation bound');
    const pinned = new Set(locks.flatMap(lock => lockControls[lock]));
    return Object.fromEntries(Object.entries(controls).map(([key, [min, max]]) => {
      const value = base[key];
      const spread = key === 'duration' ? value * .2 : defaultSpread[key] ?? 0;
      const fallback = authored ? [value, value] : [Math.max(min, value - spread), Math.min(max, value + spread)];
      const bounds = authored && Object.hasOwn(authored, key) ? authored[key] : fallback;
      check(Array.isArray(bounds) && bounds.length === 2 && finite(bounds[0], min, max) &&
        finite(bounds[1], bounds[0], max), 'Invalid sound mutation bound ' + key);
      check(!pinned.has(key) || !authored || finite(value, ...bounds), 'Sound mutation bound excludes locked ' + key);
      return [key, pinned.has(key) ? [value, value] : [...bounds]];
    }));
  }

  function mutate(source, options = {}) {
    const base = normalize(source), { family, render } = base;
    check(fields(options, ['format', 'version', 'seed', 'count', 'locks', 'bounds']) &&
      (options.format === undefined || options.format === mutationFormat) &&
      (options.version === undefined || options.version === 1), 'Expected version 1 sound mutation settings');
    const { seed = base.seed, count = 8, locks = [] } = options;
    check(Number.isSafeInteger(seed) && integer(count, 1, 32), 'Sound mutation needs an integer seed and 1 to 32 variations');
    check(Array.isArray(locks) && locks.length <= 3 && new Set(locks).size === locks.length &&
      Array.from(locks).every(lock => typeof lock === 'string' && Object.hasOwn(lockControls, lock)),
    'Sound mutation locks must be unique pitchContour, duration, or attack values');
    const shape = base.shape ?? { ...shapeDefaults, attackReferenceDuration: render.duration };
    const bounds = variationBounds({ ...render, ...shape }, options.bounds, locks);
    const fits = () => attackFits(family, render.sampleRate, bounds.duration[0],
      { ...shape, attack: bounds.attack[1] }, bounds.duration[0] !== bounds.duration[1]);
    if (options.bounds === undefined && !fits()) {
      bounds.duration[0] = render.duration;
      if (!fits()) bounds.attack[1] = shape.attack;
      if (!fits()) bounds.duration[1] = render.duration;
    }
    check(fits(), attackError);
    const value = Array.from({ length: count }, (_, index) => {
      const suffix = '-v' + String(index + 1).padStart(2, '0');
      const { duration, peak, ...variantShape } = Object.fromEntries(Object.entries(bounds).map(([key, [lo, hi]]) => {
        const draw = (noise(0, hash([mutationFormat, 1, seed, base.seed, family, index, key])) + 1) * .5;
        return [key, lo + (hi - lo) * draw];
      }));
      return normalize({ ...base, id: base.id.slice(0, 48 - suffix.length) + suffix,
        render: { ...render, duration, peak }, shape: { ...shape, ...variantShape } });
    });
    return { value, plan: { recipe: base, settings: { format: mutationFormat, version: 1, seed, count, locks: [...locks], bounds } } };
  }

  P.mediaGraph.soundRecipe = Object.freeze({
    format, mutationFormat, normalize, render, mutate, families: Object.freeze(Object.keys(families))
  });
})(KIT.procedural);
