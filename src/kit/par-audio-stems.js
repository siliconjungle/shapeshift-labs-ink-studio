/* Independent envelope followers, band levels, and replayable stem triggers. */
(function (P) {
  const A = P.mediaGraph, T = P.takeTime;
  const { int, plain, range, layout, sampler, fftSetup, spectrumFrom, bandPeak } = P.mediaGraphSupport;
  const nameOK = name => /^[A-Za-z][\w.-]{0,31}$/.test(name) && !['constructor', 'prototype'].includes(name);
  const only = (row, keys) => plain(row) && Object.keys(row).every(key => keys.includes(key));
  const maxTime = 1e9, maxTriggers = 65536, maxInteger = BigInt(Number.MAX_SAFE_INTEGER);
  const ratio = (n, d) => [BigInt(n), BigInt(d)];

  function follower(name, settings, extra) {
    if (!only(settings, ['attack', 'release', 'threshold', 'resetThreshold', extra]))
      throw new TypeError('Invalid stem follower settings for ' + name);
    const { attack = .01, release = .12, threshold, resetThreshold = threshold } = settings;
    if (!range(attack, 0, 60) || !range(release, 0, 60) ||
        threshold !== undefined && !range(threshold, .000001, 2) ||
        resetThreshold !== undefined && (threshold === undefined || !range(resetThreshold, .000001, threshold)))
      throw new RangeError('Invalid stem follower timing or thresholds for ' + name);
    return { name, attack, release, threshold, resetThreshold };
  }

  function prepare(name, input, settings, rate) {
    if (!only(settings, ['channel', 'offset', 'envelope', 'bands', 'fft']))
      throw new TypeError('Invalid analysis settings for stem ' + name);
    const source = A.audio(input), { sampleRate } = source;
    const { channel = 'all', offset = 0, envelope = {}, bands = {}, fft = {} } = settings;
    const start = T.read(offset), startSeconds = T.seconds(start);
    if (!range(startSeconds, -maxTime, maxTime) || !plain(bands) || Object.keys(bands).length > 24 ||
        !Object.keys(bands).every(key => key !== 'envelope' && nameOK(key)) || !only(fft, ['size', 'window']))
      throw new RangeError('Invalid stem offset, FFT settings or band names for ' + name);
    const lanes = [follower('envelope', envelope, 'measure'),
      ...Object.entries(bands).map(([key, row]) => follower(key, row, 'hz'))];
    const measure = envelope.measure ?? 'rms', channels = layout(source, channel);
    if (!['rms', 'peak'].includes(measure)) throw new RangeError('Stem envelope needs rms or peak measurement');
    const hz = Object.fromEntries(Object.entries(bands).map(([key, row]) => [key, row.hz]));
    const stepRate = Math.min(rate, sampleRate), frames = source.samples.length / source.channels;
    const count = Math.ceil(frames * stepRate / sampleRate), duration = ratio(frames, sampleRate);
    const endSeconds = T.seconds(T.add(start, duration));
    if (endSeconds > maxTime) throw new RangeError('Stem exceeds the media time range');
    const plan = lanes.length > 1 && fftSetup(source, { ...fft, bands: hz }, Math.ceil(sampleRate / stepRate), channels.length);
    const reads = channel === 'mix' ? source.channels : channels.length;
    const fftWork = plan ? plan.n * (reads + channels.length * Math.log2(plan.n)) + channels.length *
      plan.bandRows.reduce((sum, band) => sum + Math.max(0, band.hi - band.lo), 0) : 0;
    return { name, source, sampleRate, frames, start, startSeconds, duration, endSeconds,
      lanes, measure, channels, count, stepRate, plan, work: frames * reads + count * fftWork };
  }

  function envelopeAt(sample, channels, first, end, mode) {
    let level = 0;
    if (mode === 'peak') {
      for (const channel of channels) for (let i = first; i < end; i++)
        level = Math.max(level, Math.abs(sample(i, channel)));
      return level;
    }
    for (const channel of channels) for (let i = first; i < end; i++) level += sample(i, channel) ** 2;
    return Math.sqrt(level / ((end - first) * channels.length));
  }

  function analyze(stem, emit) {
    const { source, name, sampleRate, frames, start, startSeconds, duration, endSeconds, count, stepRate, measure, channels, plan } = stem;
    const sample = sampler(source);
    const lanes = stem.lanes.map(lane => ({ ...lane, values: new Float64Array(count + 1), gates: new Uint8Array(count + 1),
      rise: lane.attack ? -Math.expm1(-1 / (stepRate * lane.attack)) : 1,
      fall: lane.release ? -Math.expm1(-1 / (stepRate * lane.release)) : 1 }));
    const targets = new Float64Array(lanes.length);
    const real = plan && new Float64Array(plan.n), imaginary = plan && real.slice();
    const spectrum = plan && new Float64Array(plan.n / 2 + 1);
    let first = 0;
    for (let j = 1; j <= count; j++) {
      const end = j === count ? frames : Math.floor(j * sampleRate / stepRate);
      targets[0] = envelopeAt(sample, channels, first, end, measure);
      if (plan) {
        targets.fill(0, 1);
        for (const channel of channels) {
          spectrumFrom(sample, channel, end - plan.n, plan, real, imaginary, spectrum);
          plan.bandRows.forEach((band, i) => { targets[i + 1] = Math.max(targets[i + 1], bandPeak(spectrum, band)); });
        }
      }
      const dt = j === count ? frames / sampleRate - (j - 1) / stepRate : 1 / stepRate;
      lanes.forEach((lane, i) => {
        const previous = lane.values[j - 1], target = targets[i], rising = target > previous;
        const response = rising ? lane.attack : lane.release;
        const blend = j === count && response ? -Math.expm1(-dt / response) : rising ? lane.rise : lane.fall;
        const level = blend === 1 ? target : previous + (target - previous) * blend;
        const wasOpen = lane.gates[j - 1] !== 0;
        const gate = lane.threshold !== undefined && level >= (wasOpen ? lane.resetThreshold : lane.threshold);
        lane.values[j] = level;
        lane.gates[j] = Number(gate);
        if (!wasOpen && gate) {
          const point = T.add(start, j === count ? duration : ratio(j, stepRate));
          if (point[0] < 0n) return;
          const [n, d] = point, time = T.seconds(point);
          emit({ time, ...(n <= maxInteger && d <= maxInteger && { timecode: { numerator: Number(n), denominator: Number(d) } }),
            kind: 'pulse', channel: 'stem:' + name + ':' + lane.name, value: { stem: name, signal: lane.name, level } });
        }
      });
      first = end;
    }
    return { name, start, startSeconds, duration, endSeconds, count, stepRate, lanes };
  }

  function stepAt({ start, startSeconds, stepRate }, time) {
    const elapsed = (time - startSeconds) * stepRate, nearest = Math.round(elapsed);
    const precision = 4 * Number.EPSILON * Math.max(1, Math.abs(time) * stepRate, Math.abs(startSeconds) * stepRate);
    if (Math.abs(elapsed - nearest) > precision) return Math.floor(elapsed);
    // Around a boundary, compare the rounded absolute time of that tick.
    const boundary = T.seconds(T.add(start, ratio(nearest, stepRate)));
    return time < boundary ? nearest - 1 : nearest;
  }

  function sampleStem(stem, time, exact) {
    const { start, duration, endSeconds, count, stepRate } = stem;
    const elapsed = exact && T.sub(exact, start);
    const atEnd = elapsed ? T.compare(elapsed, duration) >= 0 : time >= endSeconds;
    const steps = atEnd ? count : elapsed ? T.index(T.roundDown(T.mul(elapsed, ratio(stepRate, 1)))) : stepAt(stem, time);
    const index = Math.max(0, Math.min(count, steps));
    const tail = atEnd ? Math.max(0, elapsed ? T.seconds(T.sub(elapsed, duration)) : time - endSeconds) : 0;
    const signals = stem.lanes.map(lane => {
      const recorded = lane.values[index];
      const level = !tail ? recorded : lane.release ? recorded * Math.exp(-tail / lane.release) : 0;
      return { name: lane.name, level, gate: Boolean(lane.gates[index]) && level >= lane.resetThreshold };
    });
    return {
      envelope: signals[0].level,
      bands: Object.fromEntries(signals.slice(1).map(row => [row.name, row.level])),
      gates: Object.fromEntries(signals.map(row => [row.name, row.gate]))
    };
  }

  function stemControls(stems, settings = {}, { rate = 60 } = {}) {
    if (!plain(stems) || !int(Object.keys(stems).length, 1, 16) || !Object.keys(stems).every(nameOK) ||
        !plain(settings) || !Object.keys(settings).every(key => Object.hasOwn(stems, key)) || !int(rate, 1, 240))
      throw new RangeError('Stem controls need 1 to 16 named stems, valid settings, and a fixed analysis rate');
    const prepared = Object.entries(stems).map(([name, source]) =>
      prepare(name, source, Object.hasOwn(settings, name) ? settings[name] : {}, rate));
    if (prepared.reduce((sum, stem) => sum + (1 + stem.count) * stem.lanes.length, 0) > 6e6 ||
        prepared.reduce((sum, stem) => sum + stem.work, 0) > 1.6e9)
      throw new RangeError('Stem controls exceed the analysis budget');
    const events = [], analyzed = prepared.map(stem => analyze(stem, row => {
      if (events.length >= maxTriggers) throw new RangeError('Stem controls exceed the trigger budget');
      events.push(row);
    }));
    const recording = A.recording({ events }), replay = A.inputReplay(recording);
    function sample(options = {}) {
      const { pulses, report } = replay.sample(options);
      const exact = options.take && T.sub(T.requireFrame(options.take).start, T.read(options.offset ?? 0));
      const value = Object.fromEntries(analyzed.map(stem => [stem.name, sampleStem(stem, report.sampleTime, exact)]));
      return { value, events: pulses, recording, report: { ...report, rate } };
    }
    return Object.freeze({ sample, recording });
  }

  A.stemControls = stemControls;
})(KIT.procedural);
