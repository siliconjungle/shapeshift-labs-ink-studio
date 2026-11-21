/* Spectral flux detects attacks, then a local waveform pass places each cue on the sample grid. */
(function (P) {
  const A = P.mediaGraph;
  const { int, range, layout, sampler, fftSetup } = P.mediaGraphSupport;

  function flux(source, scan, channels, hop, count) {
    const { n, weights, transform, total } = scan, bins = n / 2 + 1;
    const sample = sampler(source), real = new Float64Array(n), imaginary = real.slice();
    const spectra = channels.map(() => new Float64Array(bins));
    const strength = new Float64Array(count), strongest = new Uint8Array(count);
    for (let frame = 0; frame < count; frame++) {
      const start = frame * hop - n / 2;
      for (let c = 0; c < channels.length; c++) {
        const channel = channels[c], prior = spectra[c];
        imaginary.fill(0);
        for (let i = 0; i < n; i++) real[i] = sample(start + i, channel) * weights[i];
        transform(real, imaginary, 0, 1, -1);
        let rise = 0;
        for (let k = 1; k < bins; k++) {
          const magnitude = Math.sqrt(real[k] ** 2 + imaginary[k] ** 2) * (k === bins - 1 ? 1 : 2) / total;
          const level = Math.log1p(8 * magnitude), delta = Math.max(0, level - prior[k]);
          rise += delta * delta;
          prior[k] = level;
        }
        const value = Math.sqrt(rise);
        if (value > strength[frame]) {
          strength[frame] = value;
          strongest[frame] = c;
        }
      }
    }
    return { strength, strongest };
  }

  function attacks(strength, history, minStrength, sensitivity) {
    const output = [], sum = new Float64Array(strength.length + 1);
    for (let i = 0; i < strength.length; i++) sum[i + 1] = sum[i] + strength[i];
    for (let i = 0; i < strength.length; i++) {
      const value = strength[i], first = Math.max(0, i - history), end = Math.max(first, i - 2);
      const baseline = (sum[end] - sum[first]) / Math.max(1, end - first);
      if (value > (strength[i - 1] ?? 0) && value >= (strength[i + 1] ?? 0) &&
          value >= minStrength + sensitivity * baseline) output.push(i);
    }
    return output;
  }

  function refine(source, sample, channel, center, hop, n) {
    const frames = source.samples.length / source.channels;
    const step = Math.max(1, Math.round(source.sampleRate * .0015));
    const first = Math.max(0, center - 2 * hop), end = Math.min(frames, center + n / 2 + 1);
    const accent = i => Math.abs(sample(i, channel) - .75 * sample(i - 1, channel));
    function energy(a, b) {
      let power = 0;
      for (let i = a; i < b; i++) power += accent(i) ** 2;
      return Math.sqrt(power / Math.max(1, b - a));
    }
    const baseline = energy(first - n / 2, first), envelope = [];
    let peak = baseline;
    for (let i = first; i < end; i += step) {
      const level = energy(i, Math.min(i + step, end));
      peak = Math.max(peak, level);
      envelope.push(level);
    }
    const fallback = Math.max(0, Math.min(frames - 1, center));
    // Right padding can add spectral bins as a sustained sound ends. A tail
    // cue needs a measured increase in the source waveform.
    if (peak < baseline * 1.45 + .001) return center + n / 2 > frames ? null : fallback;
    const block = envelope.findIndex(level => level >= baseline + (peak - baseline) * .16);
    if (block < 0) return fallback;
    const start = first + block * step, threshold = Math.max(.001, baseline * 1.65, peak * .045);
    for (let i = start; i < Math.min(start + step, end); i++) if (accent(i) >= threshold) return i;
    return start;
  }

  function detectTransients(input, settings = {}) {
    const source = A.audio(input), { sampleRate } = source;
    const defaultSize = Math.max(64, Math.min(8192, 2 ** Math.round(Math.log2(sampleRate * .023))));
    const { size = defaultSize, hop = size / 4, minGap = .075, minStrength = .035, sensitivity = 2.5,
      channel = 'all', name = 'Hit' } = settings;
    if (!int(size, 16, 8192) || (size & (size - 1)) || !int(hop, 1, size / 2) ||
        !range(minGap, 0, 10) || !range(minStrength, .000001, 100) || !range(sensitivity, 0, 20) ||
        typeof name !== 'string' || !name.trim() || name.length > 120 || /[\u0000-\u001f]/.test(name))
      throw new RangeError('Invalid transient detection settings');
    const channels = layout(source, channel), frames = source.samples.length / source.channels;
    const count = frames ? Math.ceil(frames / hop) + 1 : 0;
    if (count > 600000 || count * channels.length * size * Math.log2(size) > 1.8e9)
      throw new RangeError('Transient scan exceeds its transform budget');
    const plan = fftSetup(source, { size }, size, channels.length), sample = sampler(source);
    const { strength, strongest } = flux(source, plan, channels, hop, count);
    const candidates = attacks(strength, Math.max(4, Math.round(.24 * sampleRate / hop)), minStrength, sensitivity);
    // Refine before suppressing nearby peaks so the separation is measured in source samples.
    const points = candidates.flatMap(i => {
      const channel = channels[strongest[i]], onset = refine(source, sample, channel, i * hop, hop, size);
      return onset === null ? [] : [{ sample: onset, sampleRate, strength: strength[i], channel }];
    }).sort((a, b) => a.sample - b.sample || b.strength - a.strength);
    const selected = [], gap = Math.max(1, Math.ceil(minGap * sampleRate));
    for (const point of points) {
      const last = selected.at(-1);
      if (!last || point.sample - last.sample >= gap) selected.push(point);
      else if (point.strength > last.strength) selected[selected.length - 1] = point;
    }
    const value = A.makeMusicalEvents(selected.map(point => ({
      id: 'hit-' + point.sample, name, timecode: { numerator: point.sample, denominator: sampleRate }, detected: point
    })));
    return { value, events: value.events, report: { sampleRate, size, hop, frames: count, count: value.events.length } };
  }

  A.detectTransients = detectTransients;
})(KIT.procedural);
