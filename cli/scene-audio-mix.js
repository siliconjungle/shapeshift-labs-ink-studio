/* Offline stereo resampling, panning, and stem summing on an absolute sample grid. */
const WAV = require('./wav.js');
const Binaural = require('../src/binaural-profile.js');
const Radiation = require('../src/spatial-radiation.js');
const {addRoomResponse} = require('./scene-room-response.js');

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

// An onset is the first mixer sample at which the voice has an admitted,
// positive feed. Source silence and authored attack fades still belong to it.
function playbackStart(voice, source, sampleRate, end, from = 0) {
  const p=placement(voice,source,sampleRate), length=source.samples.length/source.channels;
  const last=Math.min(end,p.end,p.loop ? Infinity : p.first+Math.ceil((length-p.sourceStart)/p.sourceStep));
  if (!length || !p.gain || last<=p.first) return null;
  const spans=voice.admissions ?? [{first:p.first,end:last}], points=p.points;
  if (!points?.length) {
    const span=spans.find(({first,end})=>Math.max(first,from)<Math.min(end,last));
    return span ? Math.max(span.first,from) : null;
  }
  let knot=0;
  for (const {first,end} of spans) {
    const stop=Math.min(end,last);
    for (let at=Math.max(first,from);at<stop;) {
      while (points[knot+1]?.sample<=at) knot++;
      const a=points[knot], b=points[knot+1];
      if (a.gain>0) return at;
      const rise=Math.max(at,a.sample+1);
      if (b?.gain>0 && rise<stop && rise<=b.sample) return rise;
      at=b?.sample ?? stop;
    }
  }
  return null;
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

function radiationFilter(points,rate,parametric) {
  if (!points?.some(point=>point.radiation)) return;
  const [lowHz,highHz]=Radiation.crossovers(rate), q=()=>Math.SQRT1_2;
  const output=new Float64Array(2), unity={low:0,mid:1,high:0};
  let lowDb=0, highDb=0;
  const low=parametric.band('low-shelf',rate,()=>lowHz,q,()=>lowDb);
  const high=parametric.band('high-shelf',rate,()=>highHz,q,()=>highDb);
  return (l,r,from,to,t)=>{
    const a=from??to??unity, b=to??a;
    lowDb=a.low+t*(b.low-a.low);
    highDb=a.high+t*(b.high-a.high);
    const trim=a.mid+t*(b.mid-a.mid);
    low(l,r,0,output);
    high(output[0],output[1],0,output);
    output[0]*=trim;output[1]*=trim;
    return output;
  };
}

// Taps inherit the source feed and its admission in the delayed sample range.
function* arrivals(voices) {
  for (const voice of voices) {
    yield voice;
    for (const {lag,point} of voice.reflections ?? []) {
      const admissions = voice.admissions?.map(span=>({...span,first:span.first+lag,end:span.end+lag,
        ...(span.fadeFrom!==undefined&&{fadeFrom:span.fadeFrom+lag})}));
      yield {...voice,first:voice.first+lag,end:voice.end===undefined?undefined:voice.end+lag,
        points:[point],admissions,reflection:true};
    }
  }
}

function sumVoices(voices, resolve, { start, end, sampleRate, gain = 1, cues, parametric, roomResponse, binaural, field }, buses = stereo) {
  const historyStart = Math.min(start,roomResponse?.path[0]?.sample??start), count = end-start;
  if (!Number.isSafeInteger(count) || count < 1 || (end-historyStart)*2 > WAV.maxSamples)
    throw new RangeError('Scene soundtrack exceeds its WAV sample budget');
  const stems = new Map(field ? [] : buses.map(name => [name, new Float32Array(count * 2)]));
  const statistics = Object.fromEntries(buses.map(name => [name, { voices: 0, peak: 0 }]));
  const roomInput=roomResponse && new Float32Array((end-historyStart)*2);
  let work = 0, binauralWork=0;
  for (const { stem, ...voice } of arrivals(voices)) {
    const spans = voice.admissions;
    const pinned=binaural&&voice.points?.some(point=>point.hrirAt);
    const wetStart = field?.roomHistory(stem) ?? (roomInput ? historyStart : undefined);
    const inputStart=pinned?Math.min(historyStart,binaural.path[0]?.sample??start):
      wetStart!==undefined&&voice.points?.some(point=>point.pan!==undefined)?wetStart:start;
    const tail=pinned?binaural.length-1:0;
    if (spans && !spans.some(span=>span.end+tail>inputStart&&span.end>span.first)) continue;
    if (voice.end !== undefined && voice.end+tail <= inputStart) continue;
    const source = resolve(voice.asset);
    if (!source.samples.length) continue;
    const p = placement(voice, source, sampleRate), bus = stems.get(stem);
    const first = Math.max(inputStart, p.first), last = Math.min(p.end, end), stop=Math.min(end,last+tail);
    if (stop <= first) continue;
    const points = p.points, filters = Boolean(points?.some(row => row.cutoff < 22000));
    const tone = contextualFilter(points, sampleRate, parametric), radiation=radiationFilter(points,sampleRate,parametric);
    // Restore the complete filter history for contextual audio when printing a crop.
    const begin = tone || radiation || (spans || field) && filters ? p.first : filters ? Math.max(p.first, first - Math.ceil(sampleRate / 3)) : first;
    const length = spans && !radiation ? spans.reduce((sum,span)=>sum+Math.max(0,Math.min(span.end,last)-Math.max(span.first,begin)),0) : last-begin;
    work += length * Math.max(2, source.channels) * (1 + (tone?.stages ?? 0) + (radiation?2:0));
    if (pinned) binauralWork+=Math.max(0,stop-begin)*binaural.length;
    if (binauralWork>2.4e9) throw new RangeError('Scene soundtrack exceeds its binaural processing budget');
    if (work > 240e6) throw new RangeError('Scene soundtrack exceeds its mixing work budget');
    if (stop>start && (inputStart===start||!spans||spans.some(span=>span.end+tail>start&&span.first<last))) {
      if (voice.reflection) statistics[stem].reflections=(statistics[stem].reflections??0)+1;
      else statistics[stem].voices++;
    }
    if (cues&&!voice.reflection) {
      const source=typeof voice.asset==='string' ? voice.asset : stem;
      for (const span of spans??[{first,end:last}]) {
        const fromSample=Math.max(start,first,span.first), toSample=Math.min(last,span.end);
        if(fromSample<toSample)cues.push({label:voice.cue??source,source,role:stem,fromSample,toSample});
      }
    }
    function spatial(sample,left,right){
      if (sample>=start) {
        const n=(sample-start)*2;
        bus[n]+=left;
        bus[n+1]+=right;
      }
      if (roomInput && sample>=historyStart) {
        const at=(sample-historyStart)*2;
        roomInput[at]+=left;
        roomInput[at+1]+=right;
      }
    }
    const unpanned = field?.foreground(stem);
    let knot = 0, low = 0, spanIndex = 0, listenerIndex=0, fir, priorAt, priorEar, priorDirection, hrirCutoff;
    for (let sample = begin; sample < stop; sample++) {
      let admission = 1;
      if (spans) {
        while (spans[spanIndex]?.end <= sample) spanIndex++;
        const span = spans[spanIndex];
        if ((pinned||radiation)&&(!span||sample<span.first)) admission=0;
        else {
          if (!span) break;
          sample = Math.max(sample,span.first);
          if (!pinned && sample>=last) break;
          if (span.fadeIn) admission = Math.min(1,(sample-span.first)/span.fadeIn);
          if (span.fadeFrom!==undefined && sample>=span.fadeFrom)
            admission *= (span.end-sample)/(span.end-span.fadeFrom);
        }
      }
      while (points && knot + 1 < points.length && points[knot + 1].sample <= sample) knot++;
      const a = points?.[knot], b = points?.[knot + 1];
      const u = b ? clamp((sample - a.sample) / (b.sample - a.sample), 0, 1) : 0;
      const level = a ? a.gain + u * ((b?.gain ?? a.gain) - a.gain) : 1;
      const pan = a?.pan === undefined ? undefined : a.pan + u * ((b?.pan ?? a.pan) - a.pan);
      const cutoff = a && a.cutoff + u * ((b?.cutoff ?? a.cutoff) - a.cutoff);
      if (pinned) {
        while (binaural.path[listenerIndex+1]?.sample<=sample) listenerIndex++;
        const ear=binaural.path[listenerIndex]?.ear, at=a.hrirAt??priorAt;
        if (!fir||at!==priorAt||ear!==priorEar) {
          const direction=Binaural.direction(ear,at);
          if (!fir || direction.some((n,i)=>Math.abs(n-priorDirection[i])>1e-8)) {
            const kernel=binaural.kernel(direction);
            if (fir) fir.set(kernel);
            else fir=Binaural.createFilter(kernel,binaural.transition,sampleRate);
            priorDirection=direction;
          }
          priorEar=ear;
          priorAt=at;
        }
        hrirCutoff=a.cutoff;
        if (sample>=last) {
          const [left,right]=fir.process(0,hrirCutoff);
          spatial(sample,left,right);
          continue;
        }
      }
      const delay = a && a.delay + u * ((b?.delay ?? a.delay) - a.delay);
      const elapsed = sample - (delay ?? 0) * sampleRate;
      if (a?.sourceTime !== undefined && elapsed < p.first) {
        if (fir) fir.process(0,hrirCutoff);
        continue;
      }
      const position = a?.sourceTime === undefined ? p.sourceStart + (elapsed - p.first) * p.sourceStep :
        (a.sourceTime + (elapsed - (a.propagated ? Math.max(p.first,a.sample) : a.sample)) * a.rate / sampleRate) * source.sampleRate;
      let l = stereoSource(source, position, p.loop, 0), r = stereoSource(source, position, p.loop, 1);
      if (radiation) [l,r]=radiation(l,r,a?.radiation,b?.radiation,u);
      if (tone) {
        const filtered = tone.process(a?.processing, l, r);
        l = filtered[0];
        r = filtered[1];
      }
      const fade = p.fade ? clamp(Math.min((sample - p.first) / p.fade, (p.end - sample) / p.fade), 0, 1) : 1;
      const n = (sample - start) * 2, scale = level * p.gain * gain * fade * admission;
      if (unpanned) {
        if (sample >= first) field.write(stem, sample, l * scale, r * scale, a, b, u, source.channels);
      } else if (fir) {
        const [left,right]=fir.process((l+r)*.5*scale,hrirCutoff);
        spatial(sample,left,right);
      } else if (pan !== undefined) {
        const mono = (l + r) * .5;
        low += (!filters || cutoff >= 22000 ? 1 : 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate)) * (mono - low);
        if (sample < first) continue;
        if (field) field.write(stem, sample, low * scale, low * scale, a, b, u, 1);
        else {
          const left=low*scale*Math.sqrt((1-pan)/2), right=low*scale*Math.sqrt((1+pan)/2);
          spatial(sample,left,right);
        }
      } else if (sample >= Math.max(first,start)) {
        if (field) field.write(stem, sample, l * scale, r * scale, a, b, u, source.channels);
        else {
          bus[n] += l * scale;
          bus[n + 1] += r * scale;
        }
      }
    }
  }
  if (roomResponse) {
    const name=stems.has('spatial')?'spatial':'effects';
    statistics[name].roomResponse=addRoomResponse(roomResponse,resolve,roomInput,stems.get(name),sampleRate,historyStart,start);
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

module.exports = { mix, sumVoices, playbackStart };
