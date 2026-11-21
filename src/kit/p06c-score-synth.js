/* Phase-continuous stereo synthesis on the shared score's absolute sample grid. */
(function (P) {
  const T = P.takeTime, { waveform } = P.musicScore, TAU = Math.PI*2;
  const clamp = value => Math.max(0,Math.min(1,value));
  const wrap = value => value-Math.floor(value);
  function blep(phase,width) {
    if (phase < width) {
      const t = phase/width;
      return t+t-t*t-1;
    }
    if (phase > 1-width) {
      const t = (phase-1)/width;
      return t*t+t+t+1;
    }
    return 0;
  }
  const highCut = relative => clamp((.5-relative)*12);
  function oscillator(voice,phase,frequency,sampleRate) {
    const width = frequency/sampleRate, gain = highCut(width);
    if (!gain) return 0;
    const { shape,duty } = voice;
    let value = waveform(shape,phase,duty);
    if (shape === 'saw') value -= blep(phase,width);
    if (shape === 'pulse') value += blep(phase,width)-blep(wrap(phase-duty),width);
    if (shape === 'triangle' && width > .08) {
      const blend = clamp((width-.08)*7);
      value = value*(1-blend)-Math.cos(phase*TAU)*blend;
    }
    value = Math.max(-1,Math.min(1,value))*gain;
    for (const [order,level] of voice.harmonics)
      value += Math.sin(TAU*wrap(phase*order))*level*highCut(order*width);
    return value;
  }

  function noise(index,salt) {
    let n = (index ^ salt) >>> 0;
    n = Math.imul(n ^ n >>> 16, 0x21f0aaad);
    n = Math.imul(n ^ n >>> 15, 0x735a2d97);
    return ((n ^ n >>> 15) >>> 0)/2147483648-1;
  }
  function strike(instrument,time,index,salt) {
    if (instrument === 'kick')
      return Math.sin(TAU*(48*time+119*(1-Math.exp(-52*time))/52))*Math.exp(-13*time);
    const grain = noise(index,salt), edge = grain-noise(index-1,salt);
    if (instrument === 'hat') return edge*.47*Math.exp(-33*time);
    return (.56*grain+.18*edge+.23*Math.sin(TAU*178*time)*Math.exp(-21*time))*Math.exp(-16*time);
  }

  function render(score, options = {}) {
    if (!options || ![Object.prototype,null].includes(Object.getPrototypeOf(options)) ||
      Object.keys(options).some(key => !['start','end','sampleRate','gain','stems'].includes(key)))
      throw new TypeError('Expected named score audio options');
    const { start = 0, end = score.end, sampleRate = 48000, gain = 1, stems = false } = options;
    if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      !Number.isFinite(gain) || gain < 0 || gain > 1 || typeof stems !== 'boolean')
      throw new RangeError('Invalid score audio rate, gain, or stem flag');
    const { voices,tracks,voiceAt,fadeEnd,windows,hitLevel } = score;
    const sampleOf = at => T.index(T.roundDown(T.mul(T.read(at),[BigInt(sampleRate),1n])));
    const begin = sampleOf(start), stop = sampleOf(end), count = stop-begin;
    if (begin < 0 || count < 1 || count*2*(stems ? voices.length+1 : 1) > 32000000 ||
      count*voices.reduce((sum,v) => sum + 1 + v.harmonics.length,0) > 100e6)
      throw new RangeError('Score audio exceeds its sample or synthesis budget');
    const samples = new Float32Array(count*2), buffers = {};
    const headroom = gain/Math.max(1,voices.reduce((sum,voice) =>
      sum + voice.gain*(1+voice.harmonics.reduce((sum,[,level]) => sum+level,0)),0));
    const finalSample = Math.min(stop,Math.ceil(score.end*sampleRate));
    for (const [i,voice] of voices.entries()) {
      const { id,pan } = voice, track = tracks[i];
      const hitWindows = finalSample > begin ? windows(voice,begin/sampleRate,finalSample/sampleRate) : [];
      const dry = stems ? new Float32Array(samples.length) : null;
      if (dry) buffers[id] = { sampleRate, channels: 2, samples: dry };
      const gainL = headroom*voice.gain*Math.sqrt((1-pan)/2), gainR = headroom*voice.gain*Math.sqrt((1+pan)/2);
      const salt = voice.id.split('').reduce((hash,char) => Math.imul(hash^char.charCodeAt(0),0x01000193),0x811c9dc5);
      const scratch = {};
      let segment = 0, hit = 0;
      for (let index = begin; index < finalSample; index++) {
        const time = index/sampleRate;
        while (segment+1 < track.length && track[segment+1].time <= time) segment++;
        let level = fadeEnd(time);
        let onset = track[segment].onset;
        if (hitWindows) {
          while (hit < hitWindows.length && hitWindows[hit].end <= time) hit++;
          const window = hitWindows[hit];
          if (!window || time < window.start) continue;
          level *= hitLevel(window,time);
          onset = window.start;
        }
        const state = voiceAt(track[segment],time,scratch);
        if (state.frequency <= 0 || state.level <= 0) continue;
        const wave = voice.instrument === 'tone' ? oscillator(voice,state.phase,state.frequency,sampleRate) :
          strike(voice.instrument,time-onset,index,salt);
        const sound = wave*level*state.level;
        const at = (index-begin)*2, l = sound*gainL, r = sound*gainR;
        samples[at] += l;
        samples[at+1] += r;
        if (dry) {
          dry[at] = l;
          dry[at+1] = r;
        }
      }
    }
    let peak = 0;
    for (const value of samples) peak = Math.max(Math.abs(value),peak);
    return { value: { sampleRate, channels: 2, samples }, stems: buffers,
      report: { sampleRate, channels: 2, firstSample: begin, endSample: stop, peak } };
  }
  P.musicScoreSynth = Object.freeze({ render });
})(KIT.procedural);
