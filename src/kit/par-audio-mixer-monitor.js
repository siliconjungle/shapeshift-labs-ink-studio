/* Analysis and audition after the master output, with shared gain for focus comparisons. */
(function (P) {
  const A=P.mediaGraph, S=P.mediaGraphSupport, {fields,finite,integer,check,db}=P.musicInstruments;
  const round=value=>value===null ? null : Number(value.toFixed(5));
  const level=value=>round(S.mixerPeak.levelDb(value));
  function pcm(input) {
    const audio=A.audio(input);
    check(audio.channels<=2 && integer(audio.sampleRate,8000,96000),'Monitoring needs mono or stereo PCM at 8000 to 96000 Hz');
    return audio;
  }
  function levels({samples,channels}) {
    let left=0,right=0,product=0,mono=0,peak=0;
    const frames=samples.length/channels;
    for (let i=0;i<samples.length;i+=channels) {
      const l=samples[i], r=channels===1 ? l : samples[i+1];
      peak=Math.max(peak,Math.abs(l),Math.abs(r));
      left+=l*l; right+=r*r; product+=l*r; mono+=((l+r)*.5)**2;
    }
    const rms=Math.sqrt((left+right)/(2*Math.max(1,frames))), folded=Math.sqrt(mono/Math.max(1,frames));
    return {peak,rms,folded,correlation:left && right ? Math.max(-1,Math.min(1,product/Math.sqrt(left*right))) : null};
  }
  const relative=(numerator,denominator)=>denominator>0 ? level(numerator/denominator) : null;
  function measure(audio,settings={}) {
    const {samples,channels,sampleRate}=audio, frames=samples.length/channels;
    check(fields(settings,['firstSample','endSample']),'Invalid mixer meter window');
    const {firstSample=0,endSample=frames}=settings;
    check(integer(firstSample,0,frames) && integer(endSample,firstSample,frames),'Mixer meter window is outside the source');
    const segment={sampleRate,channels,samples:firstSample===0 && endSample===frames ? samples :
      samples.slice(firstSample*channels,endSample*channels)};
    const stats=levels(segment);
    return {sampleRate,channels,firstSample,endSample,frames:endSample-firstSample,
      samplePeakDbFS:level(stats.peak),truePeakDbTP:level(S.mixerPeak.peak(segment.samples,channels)),
      rmsDbFS:level(stats.rms),crestDb:relative(stats.peak,stats.rms),
      integratedLufs:round(P.musicProduction.loudness(segment)),correlation:round(stats.correlation),
      monoLossDb:relative(stats.folded,stats.rms),monoSilent:stats.folded===0,oversample:8};
  }
  const meter=(input,settings)=>measure(pcm(input),settings);
  function preview(input,settings={},focus) {
    const source=pcm(input);
    check(fields(settings,['mode','lowHz','highHz']),'Invalid mixer monitor settings');
    const {mode='stereo',lowHz=260,highHz=Math.min(4600,.45*source.sampleRate)}=settings;
    check(['stereo','mono','small-speaker'].includes(mode) && (mode==='small-speaker' ?
      finite(lowHz,80,1200) && finite(highHz,Math.max(1500,lowHz*2),source.sampleRate*.48) :
      settings.lowHz===undefined && settings.highHz===undefined),'Invalid monitoring mode or speaker bandwidth');
    function audition({sampleRate,channels,samples}) {
      if (mode==='stereo') return {sampleRate,channels,samples:Float64Array.from(samples)};
      const output=new Float64Array(samples.length/channels);
      const fixed=x=>()=>x, out=[0,0], q=fixed(Math.SQRT1_2), zero=fixed(0);
      const high=mode==='small-speaker' && S.parametricBand('highpass',sampleRate,fixed(lowHz),q,zero);
      const low=mode==='small-speaker' && S.parametricBand('lowpass',sampleRate,fixed(highHz),q,zero);
      for (let i=0;i<output.length;i++) {
        const first=i*channels, x=channels===1 ? samples[first] : (samples[first]+samples[first+1])*.5;
        if (high) {high(x,x,i,out);low(out[0],out[1],i,out);}
        output[i]=high ? out[0] : x;
      }
      return {sampleRate,channels:1,samples:output};
    }
    const value=audition(source), stats=levels(source), heard=levels(value);
    const trim=1/Math.max(1,heard.peak);
    if (trim<1) for (let i=0;i<value.samples.length;i++) value.samples[i]*=trim;
    const report={mode,outputGainDb:level(trim),source:meter(source),monitor:meter(value),
      ...(mode==='small-speaker' && {bandwidth:{lowHz,highHz}})};
    if (focus!==undefined) {
      const stem=pcm(focus);
      check(stem.sampleRate===source.sampleRate && stem.samples.length/stem.channels===source.samples.length/source.channels,
        'Focus audio must match mix duration and sample rate');
      const original=levels(stem), monitored=levels(audition(stem));
      report.focus={
        originalRmsDbFS:level(original.rms),monitorRmsDbFS:level(monitored.rms*trim),
        changeDb:relative(monitored.rms*trim,original.rms),
        originalRelativeDb:relative(original.rms,stats.rms),monitorRelativeDb:relative(monitored.rms,heard.rms)
      };
    }
    return {value,report};
  }
  const scale=(audio,gain)=>({...audio,samples:audio.samples.map(x=>x*gain)});
  function prepareMatch(takes,settings) {
    check(fields(settings,['targetLufs','ceilingDbTP']),'Invalid audition settings');
    const {targetLufs=-18,ceilingDbTP=-1}=settings;
    check(finite(targetLufs,-36,-9) && finite(ceilingDbTP,-12,-.1),'Invalid audition loudness target or ceiling');
    const source=takes.map(take=>pcm(take.value)), {sampleRate,channels}=source[0];
    check(source.every(audio=>audio.sampleRate===sampleRate && audio.channels===channels),
      'Audition prints must share a sample format');
    const length=Math.max(...source.map(audio=>audio.samples.length));
    const tapes=source.map((audio,i)=>{
      const samples=new Float64Array(length), headroom=takes[i].report?.headroom ?? 1;
      for (let j=0;j<audio.samples.length;j++) samples[j]=audio.samples[j]/headroom;
      return {sampleRate,channels,samples};
    });
    const meters=tapes.map(audio=>measure(audio));
    const matching=meters.every(row=>row.integratedLufs!==null) ? 'integratedLufs' :
      meters.every(row=>row.rmsDbFS!==null) ? 'rmsDbFS' : null;
    // For a sub-gate phrase, retain the first print's RMS as the reference.
    const target=matching==='rmsDbFS' ? meters[0].rmsDbFS : targetLufs;
    const floor=matching ? Math.min(target,...meters.map(row=>row[matching]+ceilingDbTP-row.truePeakDbTP)) : null;
    const gains=meters.map(row=>matching ? floor-row[matching] :
      row.truePeakDbTP===null ? 0 : Math.min(0,ceilingDbTP-row.truePeakDbTP));
    return {sampleRate,channels,length,tapes,meters,matching,floor,gains,ceilingDbTP};
  }
  function match(takes,settings={}) {
    check(Array.isArray(takes) && integer(takes.length,1,9),'Match one to nine audition prints');
    const {sampleRate,channels,length,tapes,meters,matching,floor,gains,ceilingDbTP}=prepareMatch(takes,settings);
    const audio=tapes.map((take,i)=>scale(take,db(gains[i])));
    return {audio,report:{sampleRate,frames:length/channels,matching,ceilingDbTP,
      matchingLufs:matching==='integratedLufs' ? round(floor) : null,
      matchingRmsDbFS:matching==='rmsDbFS' ? round(floor) : null,
      takes:audio.map((take,i)=>({before:meters[i],gainDb:round(gains[i]),playback:measure(take)}))}};
  }
  function compare(dry,wet,settings={}) {
    const {sampleRate,channels,length,tapes,meters,matching,floor,gains,ceilingDbTP}=prepareMatch([dry,wet],settings);
    const subtract=(a,b)=>({...a,samples:a.samples.map((x,i)=>x-b.samples[i])});
    const peakTrim=audio=>db(ceilingDbTP)/Math.max(db(ceilingDbTP),S.mixerPeak.peak(audio.samples,channels));
    let [bypass,value]=tapes.map((take,i)=>scale(take,db(gains[i])));
    let difference=subtract(value,bypass);
    const trim=peakTrim(difference);
    if (trim<1) {
      bypass=scale(bypass,trim); value=scale(value,trim);
      difference=subtract(value,bypass);
    }
    const rawEffect=subtract(tapes[1],tapes[0]), effectTrim=peakTrim(rawEffect);
    const effect=scale(rawEffect,effectTrim);
    return {bypass,value,difference,effect,report:{sampleRate,frames:length/channels,matching,
      matchingLufs:matching==='integratedLufs' ? round(floor+level(trim)) : null,
      matchingRmsDbFS:matching==='rmsDbFS' ? round(floor+level(trim)) : null,ceilingDbTP,
      takes:Object.fromEntries(['bypass','rack'].map((name,i)=>[name,{before:meters[i],gainDb:round(gains[i]+level(trim))}])),
      difference:{polarity:'processed-minus-bypass',sharedGainDb:level(trim)},
      effect:{polarity:'processed-minus-bypass',gainDb:level(effectTrim)}}};
  }
  A.mixerMonitor=Object.freeze({meter,preview,match,compare});
})(KIT.procedural);
