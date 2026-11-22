/* Editable synthesis stages for seeded one-shots. */
(function (P) {
  const S = P.mediaGraphSupport;
  const { check, fields, finite, integer, noise, clamp } = P.musicInstruments;
  const synthKeys = ['pitchSweep', 'pitchSteps', 'pulseWidth', 'retrigger', 'noise', 'filter', 'punch'];

  function readPitchSweep(raw) {
    check(fields(raw, ['fromSemitones', 'toSemitones', 'curve']), 'Invalid one-shot pitch sweep');
    const { fromSemitones = 0, toSemitones = 0, curve = 1 } = raw;
    check(finite(fromSemitones, -24, 24) && finite(toSemitones, -24, 24) && finite(curve, .25, 4),
      'Pitch sweep requires offsets of up to 24 semitones and a curve from 0.25 to 4');
    return { fromSemitones, toSemitones, curve };
  }

  function readPitchSteps(raw) {
    check(Array.isArray(raw) && integer(raw.length, 1, 32), 'Use one to 32 pitch steps');
    let previous = -1;
    return Array.from(raw, (row, index) => {
      check(fields(row, ['at', 'semitones']) && finite(row.at, 0, 1) &&
        row.at < 1 && (index ? row.at > previous : row.at === 0) && finite(row.semitones, -24, 24),
      'Pitch steps need increasing positions starting at zero and offsets of up to 24 semitones');
      previous = row.at;
      return { at: row.at, semitones: row.semitones };
    });
  }

  function readRetrigger(raw) {
    check(fields(raw, ['positions', 'gate']), 'Invalid one-shot retrigger');
    const { positions, gate = .8 } = raw;
    check(Array.isArray(positions) && integer(positions.length, 2, 16) && finite(gate, .1, 1),
      'Use two to 16 retrigger positions and a gate from 0.1 to 1');
    let previous = -1;
    for (const at of positions) {
      check(finite(at, 0, 1) && at < 1 && (previous < 0 ? at === 0 : at > previous),
        'Retrigger positions must increase from zero and stay below one');
      previous = at;
    }
    return { positions: [...positions], gate };
  }

  function normalizeSynth(raw, rate) {
    check(fields(raw, synthKeys), 'Unknown one-shot synth control');
    const { pitchSweep, pitchSteps, pulseWidth, retrigger, noise: bed, filter, punch } = raw;
    const synth = {};
    if (pitchSweep !== undefined) synth.pitchSweep = readPitchSweep(pitchSweep);
    if (pitchSteps !== undefined) synth.pitchSteps = readPitchSteps(pitchSteps);
    if (pulseWidth !== undefined) {
      check(finite(pulseWidth, .05, .95), 'Pulse width must be between 0.05 and 0.95');
      synth.pulseWidth = pulseWidth;
    }
    if (retrigger !== undefined) synth.retrigger = readRetrigger(retrigger);
    if (bed !== undefined) {
      check(fields(bed, ['color', 'level']), 'Invalid one-shot noise');
      const { color = 'white', level = .4 } = bed;
      check(['white', 'pink', 'brown'].includes(color) && finite(level, 0, 1), 'Invalid one-shot noise color or level');
      synth.noise = { color, level };
    }
    if (filter !== undefined) {
      check(fields(filter, ['type', 'fromHz', 'toHz']), 'Invalid one-shot filter sweep');
      const { type = 'lowpass', fromHz, toHz } = filter, maximum = rate * .49;
      check(['lowpass', 'highpass'].includes(type) && finite(fromHz, 20, maximum) && finite(toHz, 20, maximum),
        'Filter sweep cutoffs must be between 20 Hz and 49% of the render rate');
      synth.filter = { type, fromHz, toHz };
    }
    if (punch !== undefined) {
      check(fields(punch, ['amount', 'decayMs']), 'Invalid one-shot envelope punch');
      const { amount = 1, decayMs = 24 } = punch;
      check(finite(amount, 0, 3) && finite(decayMs, 1, 120), 'Invalid punch amount or decay time');
      synth.punch = { amount, decayMs };
    }
    return synth;
  }

  function normalizeRetro(raw, rate) {
    check(fields(raw, ['type', 'rateHz', 'bits', 'interpolation', 'wet']) &&
      (raw.type === undefined || raw.type === 'retro-sampler'), 'Expected a retro-sampler insert');
    const { rateHz = rate, bits = 0, interpolation = 'hold', wet = 1 } = raw;
    check(finite(rateHz, 100, rate) && (bits === 0 || integer(bits, 2, 24)) &&
      ['hold', 'linear', 'cubic'].includes(interpolation) && finite(wet, 0, 1),
    'Invalid retro capture rate, bit depth, interpolation or wet level');
    return { type: 'retro-sampler', rateHz, bits, interpolation, wet };
  }

  function windows(frames, retrigger, lowerBound = false) {
    if (!retrigger) return [{ start: 0, frames }];
    const { positions, gate } = retrigger;
    return positions.map((at, index) => {
      const until = at + ((positions[index + 1] ?? 1) - at) * gate;
      const start = Math.round(at * frames);
      const end = Math.round(until * frames);
      return { start, frames: lowerBound ? Math.floor(until * frames - at * frames) : end - start };
    });
  }

  function pitchMotion(synth) {
    const { pitchSweep, pitchSteps } = synth;
    if (!pitchSweep && !pitchSteps) return null;
    const { fromSemitones = 0, toSemitones = 0, curve = 1 } = pitchSweep ?? {};
    const maxStep = pitchSteps ? Math.max(...pitchSteps.map(row => row.semitones)) : 0;
    const steps = pitchSteps ?? [{ at: 0, semitones: 0 }];
    let index = 0;
    return {
      maxRatio: 2 ** ((Math.max(fromSemitones, toSemitones) + maxStep) / 12),
      ratio(progress) {
        while (steps[index + 1]?.at <= progress) index++;
        const sweep = fromSemitones + (toSemitones - fromSemitones) * progress ** curve;
        return 2 ** ((sweep + steps[index].semitones) / 12);
      }
    };
  }

  function pulseWeights(width, brightness) {
    return Array.from({ length: 24 }, (_, index) => {
      const harmonic = index + 1;
      return 2 * Math.sin(Math.PI * harmonic * width) / (Math.PI * harmonic) * brightness ** Math.min(index, 3);
    });
  }

  function noiseBed(color, rate, salt) {
    if (color === 'white') return i => noise(i, salt);
    // Mix normalized low-pass bands for approximate pink noise and a single integration pole for brown.
    const bands = (color === 'pink' ? [75, 420, 2200, 11000] : [145]).map(hz => {
      const pole = S.sampleKitMix.poleAt(hz, rate);
      return { pole, gain: Math.sqrt((2 - pole) / pole), state: 0 };
    });
    return i => {
      const white = noise(i, salt);
      let sum = 0;
      for (const band of bands) {
        band.state += (white - band.state) * band.pole;
        sum += band.state * band.gain;
      }
      return sum / bands.length;
    };
  }

  function finishHit(samples, synth, rate) {
    const { filter, punch } = synth;
    const last = samples.length - 1;
    if (filter) {
      const { fromHz, toHz, type } = filter;
      const ratio = toHz / fromHz, release = Math.max(1, Math.min(.002 * rate, last * .1));
      let low = 0;
      for (let i = 0; i <= last; i++) {
        const pole = S.sampleKitMix.poleAt(fromHz * ratio ** (i / last), rate);
        const input = samples[i];
        low += (input - low) * pole;
        samples[i] = (type === 'lowpass' ? low : input - low) * clamp((last - i) / release);
      }
    }
    if (punch?.amount) {
      const length = Math.min(last + 1, Math.ceil(punch.decayMs * rate / 1000));
      const duration = punch.decayMs * rate / 1000;
      for (let i = 0; i < length; i++) samples[i] *= 1 + punch.amount * (1 - i / duration) ** 2;
    }
  }

  function retroPrint(input, insert) {
    const mix = P.mediaGraph.mixer.render({
      id: 'one-shot-retro', sampleRate: input.sampleRate, output: 'out', tail: 'cut',
      strips: { out: { clips: [{ id: 'source', source: 'source' }], inserts: ['retro'] } },
      processors: { retro: insert }
    }, { source: input });
    const samples = Float32Array.from(input.samples, (_, i) => mix.value.samples[2 * i]);
    return { samples, report: { ...mix.report.strips.out.inserts[0]?.details,
      latencySamples: mix.report.latencySamples, headroom: mix.report.headroom } };
  }

  S.oneShotControls = { normalizeSynth, normalizeRetro, windows, pitchMotion, pulseWeights, noiseBed, finishHit, retroPrint };
})(KIT.procedural);
