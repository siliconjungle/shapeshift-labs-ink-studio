/* Fractional delay lines and deterministic playback effects for mixer strips. */
(function (P) {
  const S=P.mediaGraphSupport,T=P.takeTime;
  const {fields,finite,integer,check,db,hash}=P.musicInstruments, tau=2*Math.PI;
  function cubic(a,b,c,d,u) {
    const second=c-a, third=2*a-5*b+4*c-d, fourth=3*(b-c)+d-a;
    return b+.5*u*(second+u*(third+u*fourth));
  }
  function delayLine(frames) {
    const length=Math.max(4,frames), samples=[new Float64Array(length),new Float64Array(length)];
    const state={next:0};
    function read(ch,at,mode='linear') {
      const first=Math.floor(at), u=at-first, data=samples[ch];
      const a=first<0 ? 0 : data[first%length], b=first+1<0 ? 0 : data[(first+1)%length];
      if (mode==='linear') return a+(b-a)*u;
      return cubic(first<1 ? 0 : data[(first-1)%length],a,b,first+2<0 ? 0 : data[(first+2)%length],u);
    }
    function write(l,r) {
      const slot=state.next++%length;
      samples[0][slot]=l; samples[1][slot]=r;
    }
    return {read,write,cells:[state,...samples]};
  }
  function repeats(feedback) {
    return feedback===0 ? 1 : 1+Math.ceil(Math.log(.001)/Math.log(feedback));
  }
  function tempoDelay(raw,rate,time) {
    check(fields(raw,['type','wet','beats','feedback','lowHz','highHz','driveDb','crossfeed']),
      'Unknown tempo delay parameter');
    const beats=T.seconds(T.read(raw.beats ?? .75)), clock=time.beatClock();
    check(finite(beats,1/64,8),'Tempo delay needs a beat division from 1/64 to 8');
    const maximum=clock.maxFrames(beats);
    check(maximum<=8*rate,'Tempo delay exceeds eight seconds on this tempo map');
    const fb=time.lane(raw.feedback,.4,0,.9,'delay feedback');
    const low=time.lane(raw.lowHz,140,20,12000,'feedback high-pass');
    const high=time.lane(raw.highHz,4000,100,24000,'feedback low-pass');
    check(low.max<high.min,'The tempo delay feedback filters need separated cutoffs');
    const drive=time.lane(raw.driveDb,0,0,24,'feedback drive');
    const cross=time.lane(raw.crossfeed,0,0,1,'delay crossfeed');
    return {tail:maximum*repeats(fb.max),cost:22,make() {
      const line=delayLine(maximum+4), highState=new Float64Array(2), lowState=new Float64Array(2), loop=[0,0];
      const feedback=fb.reader(), highpass=low.reader(), lowpass=high.reader(), driveDb=drive.reader(), stereo=cross.reader();
      return P.audioCheckpoint((l,r,kl,kr,t,out)=>{
        const at=Math.min(t-1,clock.sampleAt(clock.beatAt(t)-beats));
        const hi=S.sampleKitMix.poleAt(highpass(t),rate), lo=S.sampleKitMix.poleAt(lowpass(t),rate);
        const gain=feedback(t), dbValue=driveDb(t), amount=db(dbValue), x=stereo(t);
        for (let ch=0;ch<2;ch++) {
          const echo=line.read(ch,at);
          out[ch]=echo;
          highState[ch]+=(echo-highState[ch])*hi;
          lowState[ch]+=(echo-highState[ch]-lowState[ch])*lo;
          loop[ch]=dbValue===0 ? lowState[ch] : Math.tanh(lowState[ch]*amount)/amount;
        }
        line.write(l+gain*(loop[0]+(loop[1]-loop[0])*x),r+gain*(loop[1]+(loop[0]-loop[1])*x));
      },highState,lowState,...line.cells);
    }};
  }
  function modulation(raw,rate,time) {
    check(fields(raw,['type','wet','mode','rateHz','delayMs','depthMs','feedback','spread']),
      'Unknown modulation parameter');
    const {mode='chorus',spread=.25}=raw;
    const presets={chorus:[14,3,.43,0],flanger:[3,1.15,.23,.45],vibrato:[8,2.5,4.8,0]};
    check(Object.hasOwn(presets,mode) && finite(spread,0,1),'Invalid modulation mode or stereo phase');
    const [center,depth,speed,feedback]=presets[mode], extra=raw.delayMs ?? center;
    check(finite(extra,.5,80),'Invalid modulation center delay');
    const width=time.lane(raw.depthMs,depth,0,Math.max(0,extra-3000/rate),'modulation depth');
    check(width.max<extra && (extra-width.max)*rate/1000>=2,'Modulation depth must leave interpolation room');
    const freq=time.lane(raw.rateHz,speed,.025,28,'modulation rate');
    const fb=time.lane(raw.feedback,feedback,-.85,.85,'modulation feedback');
    const maximum=Math.ceil(rate*(extra+width.max)/1000)+2;
    return {tail:maximum*repeats(Math.max(Math.abs(fb.min),Math.abs(fb.max))),cost:16,make() {
      const line=delayLine(maximum+3), depth=width.reader(), speed=freq.reader(), feedback=fb.reader();
      const state={phase:0};
      return P.audioCheckpoint((l,r,kl,kr,t,out)=>{
        const excursion=depth(t), gain=feedback(t), {phase}=state;
        out[0]=line.read(0,t-rate*(extra+excursion*Math.sin(phase))/1000,'cubic');
        out[1]=line.read(1,t-rate*(extra+excursion*Math.sin(phase+tau*spread))/1000,'cubic');
        line.write(l+out[0]*gain,r+out[1]*gain);
        state.phase=(phase+tau*speed(t)/rate)%tau;
      },state,...line.cells);
    }};
  }
  function tape(raw,rate,time) {
    check(fields(raw,['type','wet','wowHz','wowCents','flutterHz','flutterCents','spread','seed']),
      'Unknown tape drift parameter');
    const {wowHz=.54,flutterHz=6.1,spread=.08,seed=0}=raw;
    check(finite(wowHz,.08,3) && finite(flutterHz,3,28) && finite(spread,0,1) &&
      integer(seed,-2147483648,2147483647),'Invalid tape rates, spread or seed');
    const wow=time.lane(raw.wowCents,18,0,120,'wow depth');
    const flutter=time.lane(raw.flutterCents,4,0,48,'flutter depth');
    const excursion=(cents,hz)=>(2**(cents/1200)-1)*rate/(tau*hz);
    const reach=Math.ceil(excursion(wow.max,wowHz)+excursion(flutter.max,flutterHz));
    const latency=reach+3, phase=(hash([seed,'tape'])>>>0)/4294967296*tau;
    return {latency,tail:reach+2,cost:17,make() {
      const line=delayLine(2*latency+4), slow=wow.reader(), fast=flutter.reader();
      let cursor=0;
      return (l,r,kl,kr,t,out)=>{
        const a=excursion(slow(t),wowHz), b=excursion(fast(t),flutterHz);
        const v=t*tau/rate*wowHz+phase, w=t*tau/rate*flutterHz-phase, offset=spread*tau;
        const at=cursor++-latency;
        out[0]=line.read(0,at-a*Math.sin(v)-b*Math.sin(w),'cubic');
        out[1]=line.read(1,at-a*Math.sin(v+offset)-b*Math.sin(w+offset),'cubic');
        line.write(kl,kr);
      };
    }};
  }
  S.soundDesign=(raw,rate,time,asset)=>{
    switch (raw?.type) {
      case 'tempo-delay': return tempoDelay(raw,rate,time);
      case 'modulation': return modulation(raw,rate,time);
      case 'tape-drift': return tape(raw,rate,time);
      case 'convolution': return S.soundConvolution(raw,rate,time,asset);
      case 'spectral-freeze': return S.spectralFreeze(raw,rate,time);
      case 'granular': return S.granularPlayback(raw,rate,time);
      case 'retro-sampler': return S.retroSampler(raw,rate,time);
      default: return null;
    }
  };
  S.soundCubic=cubic;
})(KIT.procedural);
