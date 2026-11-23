/* Offline stereo resampling, panning, and stem summing on an absolute sample grid. */
const WAV = require('./wav.js');

const stereo = ['timeline', 'spatial', 'music', 'tracks'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function stereoSource(source, position, loop, side) {
  const { samples, channels } = source, length = samples.length / channels;
  const i = Math.floor(position), fraction = position - i;
  function sample(index) {
    const at = loop ? ((index % length) + length) % length : index;
    if (at < 0 || at >= length) return 0;
    if (channels === 1) return samples[at];
    let sum = 0;
    for (let c = side; c < channels; c += 2) sum += samples[at * channels + c];
    return sum / Math.ceil((channels - side) / 2);
  }
  return sample(i) * (1 - fraction) + sample(i + 1) * fraction;
}

function placement({ asset, first, end, offset = 0, rate = 1, gain = 1, loop = false, fade = 0, points }, source, sampleRate) {
  const sourceStep = source.sampleRate * rate / sampleRate;
  const sourceStart = offset * source.sampleRate;
  end ??= loop ? Number.MAX_SAFE_INTEGER :
    first + Math.max(0, Math.ceil((source.samples.length / source.channels - sourceStart) / sourceStep));
  return { asset, first, end, sourceStep, sourceStart, gain, loop, fade, points };
}

function contextualFilter(points, rate, parametric) {
  const plans = points?.flatMap(point => point.processing ? [point.processing] : []);
  if (!plans?.length) return;
  const limit = rate * .49, smoothing = -Math.expm1(-1 / (rate * .025));
  const stages = [], out = new Float64Array(2);
  const next = (old, target) => old === undefined || Math.abs(target - old) < .001 ?
    target : old + smoothing * (target - old);
  function add(mode, frequency, width, level, bypass) {
    let hz, q, gainDb;
    const band = parametric.band(mode, rate, () => hz, () => q, () => gainDb);
    stages.push((plan, l, r) => {
      hz = next(hz, frequency(plan));
      q = next(q, width(plan));
      gainDb = next(gainDb, level(plan));
      if (bypass?.(hz)) {
        out[0] = l;
        out[1] = r;
      } else band(l, r, 0, out);
    });
  }
  const butterworth = () => Math.SQRT1_2, unity = () => 0;
  if (plans.some(plan => plan.highpass > 0))
    add('highpass', plan => Math.min(plan?.highpass ?? 0, limit), butterworth, unity, hz => hz === 0);
  for (let slot = 0; slot < 4; slot++) {
    const first = plans.find(plan => plan.peaks[slot])?.peaks[slot];
    if (!first) break;
    add('peak', plan => Math.min(plan?.peaks[slot]?.hz ?? first.hz, limit),
      plan => plan?.peaks[slot]?.q ?? first.q, plan => plan?.peaks[slot]?.gainDb ?? 0);
  }
  if (plans.some(plan => plan.lowpass < 22000))
    add('lowpass', plan => plan && plan.lowpass < 22000 ? Math.min(plan.lowpass, limit) : limit,
      butterworth, unity, hz => hz === limit);
  if (!stages.length) return;
  return { stages:stages.length, process(plan, l, r) {
    out[0] = l;
    out[1] = r;
    for (const stage of stages) stage(plan, out[0], out[1]);
    return out;
  }};
}

function sumVoices(voices, resolve, { start, end, sampleRate, gain = 1, cues, parametric }, buses = stereo) {
  const count = end - start;
  if (!Number.isSafeInteger(count) || count < 1 || count * 2 > WAV.maxSamples)
    throw new RangeError('Scene soundtrack exceeds its WAV sample budget');
  const stems = new Map(buses.map(name => [name, new Float32Array(count * 2)]));
  const statistics = Object.fromEntries(buses.map(name => [name, { voices: 0, peak: 0 }]));
  let work = 0;
  for (const { stem, ...voice } of voices) {
    if (voice.end !== undefined && voice.end <= start) continue;
    const source = resolve(voice.asset);
    if (!source.samples.length) continue;
    const p = placement(voice, source, sampleRate), bus = stems.get(stem);
    const first = Math.max(start, p.first), last = Math.min(p.end, end);
    if (last <= first) continue;
    const points = p.points, filters = Boolean(points?.some(row => row.cutoff < 22000));
    const tone = contextualFilter(points, sampleRate, parametric);
    // Restore the complete filter history for contextual audio when printing a crop.
    const begin = tone ? p.first : filters ? Math.max(p.first, first - Math.ceil(sampleRate / 3)) : first;
    work += (last - begin) * Math.max(2, source.channels) * (1 + (tone?.stages ?? 0));
    if (work > 240e6) throw new RangeError('Scene soundtrack exceeds its mixing work budget');
    statistics[stem].voices++;
    if (cues) {
      const source=typeof voice.asset==='string' ? voice.asset : stem;
      cues.push({label:voice.cue ?? source,source,role:stem,fromSample:first,toSample:last});
    }
    let knot = 0, low = 0;
    for (let sample = begin; sample < last; sample++) {
      while (points && knot + 1 < points.length && points[knot + 1].sample <= sample) knot++;
      const a = points?.[knot], b = points?.[knot + 1];
      const u = b ? clamp((sample - a.sample) / (b.sample - a.sample), 0, 1) : 0;
      const level = a ? a.gain + u * ((b?.gain ?? a.gain) - a.gain) : 1;
      const pan = a?.pan === undefined ? undefined : a.pan + u * ((b?.pan ?? a.pan) - a.pan);
      const cutoff = a && a.cutoff + u * ((b?.cutoff ?? a.cutoff) - a.cutoff);
      const delay = a && a.delay + u * ((b?.delay ?? a.delay) - a.delay);
      const elapsed = sample - (delay ?? 0) * sampleRate;
      if (a?.sourceTime !== undefined && elapsed < p.first) continue;
      const position = a?.sourceTime === undefined ? p.sourceStart + (elapsed - p.first) * p.sourceStep :
        (a.sourceTime + (elapsed - a.sample) * a.rate / sampleRate) * source.sampleRate;
      let l = stereoSource(source, position, p.loop, 0), r = stereoSource(source, position, p.loop, 1);
      if (tone) {
        const filtered = tone.process(a?.processing, l, r);
        l = filtered[0];
        r = filtered[1];
      }
      const fade = p.fade ? clamp(Math.min((sample - p.first) / p.fade, (p.end - sample) / p.fade), 0, 1) : 1;
      const n = (sample - start) * 2, scale = level * p.gain * gain * fade;
      if (pan !== undefined) {
        const mono = (l + r) * .5;
        low += (!filters || cutoff >= 22000 ? 1 : 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate)) * (mono - low);
        if (sample < first) continue;
        bus[n] += low * scale * Math.sqrt((1 - pan) / 2);
        bus[n + 1] += low * scale * Math.sqrt((1 + pan) / 2);
      } else if (sample >= first) {
        bus[n] += l * scale;
        bus[n + 1] += r * scale;
      }
    }
  }
  return {stems,statistics};
}

function mix(voices, resolve, options) {
  const {start,end,sampleRate,capture=false}=options, count=end-start;
  const {stems,statistics}=sumVoices(voices,resolve,options);
  const sum = new Float32Array(count * 2);
  let peak = 0;
  for (const [name, bus] of stems) {
    for (let i = 0; i < bus.length; i++) {
      statistics[name].peak = Math.max(statistics[name].peak, Math.abs(bus[i]));
      sum[i] += bus[i];
    }
  }
  for (const value of sum) peak = Math.max(peak, Math.abs(value));
  const maximum = Math.max(peak, ...Object.values(statistics).map(row => row.peak));
  const headroom = maximum > 1 ? 1 / maximum : 1;
  const report = {sampleRate,channels:2,firstSample:start,endSample:end,frames:count,headroom,peak,stems:statistics};
  if (capture) {
    if (headroom < 1) for (let i = 0; i < sum.length; i++) sum[i] *= headroom;
    return {value:{samples:sum,channels:2,sampleRate},report};
  }
  const waves = Object.fromEntries([...stems, ['mix', sum]].map(([name, samples]) => {
    if (headroom < 1) for (let i = 0; i < samples.length; i++) samples[i] *= headroom;
    return [name, WAV.encode({ samples, channels: 2, sampleRate }, { encoding: 'pcm24' })];
  }));
  return { waves, report };
}

module.exports = { mix, sumVoices };
