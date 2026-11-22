/* Versioned one-shots for the typed Ink audio graph. */
(function (P) {
  const { check, fields, id, integer, finite, noise, hash, clamp } = P.musicInstruments;
  const format = 'ink-studio/sound-recipe', tau = Math.PI * 2;
  const wavEncodings = Object.freeze(['pcm16', 'pcm24', 'float32']);
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

  function normalize(source) {
    check(fields(source, ['format', 'version', 'id', 'family', 'seed', 'render']) &&
      source.format === format && source.version === 1 && typeof source.family === 'string' &&
      Object.hasOwn(families, source.family) && (source.id === undefined || id(source.id)) && Number.isSafeInteger(source.seed),
    'Expected a version 1 sound recipe with a known family and an integer seed');
    const settings = source.render === undefined ? {} : source.render;
    check(fields(settings, ['sampleRate', 'duration', 'peak', 'encoding']), 'Invalid sound recipe render settings');
    const { sampleRate = 48000, duration = families[source.family].duration, peak = .75, encoding = 'pcm24' } = settings;
    check(integer(sampleRate, 8000, 96000) && finite(duration, .04, 4) && finite(peak, .01, 1) &&
      wavEncodings.includes(encoding), 'Sound recipes need a bounded duration, sample rate, peak and WAV encoding');
    return { format, version: 1, id: source.id ?? source.family, family: source.family, seed: source.seed,
      render: { sampleRate, duration, peak, encoding } };
  }

  function oscillator(voice, rate, salt) {
    const [from, to] = voice.pitch, tuning = 2 ** (noise(0, salt) * .075);
    const weights = spectra[voice.color].map((gain, index) =>
      (index + 1) * Math.max(from, to) * tuning < .45 * rate ? gain : 0);
    let phase = 0;
    return progress => {
      const hz = from * (to / from) ** (progress ** voice.motion) * tuning;
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
    for (const [layer, voice] of families[family].voices.entries()) {
      const salt = hash([format, 1, seed, family, layer]), tone = voice.pitch !== undefined;
      const sample = tone ? oscillator(voice, sampleRate, salt) : coloredNoise(voice, sampleRate, salt);
      const first = Math.round(frames * voice.span[0]), end = Math.round(frames * voice.span[1]);
      const length = end - first, attack = Math.max(1, Math.min(length * .085, sampleRate * (family === 'impact' ? .0018 : .006)));
      const gain = voice.gain * (1 + noise(1, salt) * .11);
      for (let i = 0; i < length; i++) {
        const progress = i / Math.max(1, length - 1), tail = 1 - progress;
        const shape = voice.swell ?
          (.25 + .75 * progress) * clamp(tail * 12) * (.72 + .28 * Math.cos(tau * (2 * progress + 7 * progress ** 2))) :
          tail ** (voice.decay ?? 1.18);
        samples[first + i] += gain * sample(tone ? progress : i) * shape * clamp(i / attack);
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
      report: { frames, seconds: frames / sampleRate, peak: Math.fround(target), rms: Math.sqrt(energy / frames) } };
  }

  P.mediaGraph.soundRecipe = Object.freeze({ format, normalize, render, families: Object.freeze(Object.keys(families)) });
})(KIT.procedural);
