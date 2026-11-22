/* Bounded spectral measurements for editable instruments. */
(function (P) {
  const S=P.mediaGraphSupport, {check,clamp}=P.musicInstruments;
  const round=(value,digits=6)=>Number(value.toFixed(digits));
  const mean=rows=>rows.reduce((sum,value)=>sum+value,0)/rows.length;
  const max=rows=>rows.reduce((best,value)=>Math.max(best,value),0);
  const midi=hz=>69+12*Math.log2(hz/440);
  const bounded=(value,low,high)=>Math.max(low,Math.min(high,value));
  const bands=[[45,520],[520,2200],[2200,6000],[6000,16000]];

  function isolate(pcm) {
    const {samples,channels,sampleRate}=pcm, frames=samples.length/channels, power=[0,0];
    for (let i=0;i<samples.length;i++) power[i%channels]+=samples[i]**2;
    const channel=power[1]>power[0] ? 1 : 0;
    const original=Float64Array.from({length:frames},(_,i)=>samples[i*channels+channel]);
    const dc=mean(original);
    const stride=Math.max(1,Math.round(.005*sampleRate));
    const blocks=Array.from({length:Math.ceil(frames/stride)},(_,i)=>{
      const start=i*stride, end=Math.min(start+stride,frames);
      let energy=0;
      for (let j=start;j<end;j++) energy+=(original[j]-dc)**2;
      return Math.sqrt(energy/(end-start));
    });
    const level=max(blocks);
    check(level>=1e-7,'Instrument fitting needs an audible recording');
    const floor=level*.045;
    const firstSample=Math.max(0,(blocks.findIndex(value=>value>=floor)-1)*stride);
    const endSample=Math.min(frames,(blocks.findLastIndex(value=>value>=floor)+2)*stride);
    const body=original.subarray(firstSample,endSample);
    const peak=body.reduce((largest,x)=>Math.max(largest,Math.abs(x-dc)),0);
    const signal=Float64Array.from(body,x=>(x-dc)*.85/peak);
    return {signal,sampleRate,channel,firstSample,endSample,sourcePeak:peak};
  }

  function scans(signal,sampleRate) {
    const size=2**Math.ceil(Math.log2(sampleRate*.058)), plan=S.fftSetup({sampleRate},{size},size,1);
    const step=sampleRate/size, bins=Math.min(size/2+1,Math.floor(16000/step)+1);
    const real=new Float64Array(size), imag=new Float64Array(size);
    const sample=i=>signal[i] ?? 0;
    const rows=Array.from({length:17},(_,index)=>{
      const phase=index/16, at=Math.round(phase*(signal.length-1));
      const spectrum=new Float64Array(bins);
      S.spectrumFrom(sample,0,at-size/2,plan,real,imag,spectrum);
      return {phase,at,spectrum};
    });
    return {rows,step};
  }

  function localPeak(spectrum,at) {
    const a=Math.log(spectrum[at-1]+1e-12), b=Math.log(spectrum[at]+1e-12), c=Math.log(spectrum[at+1]+1e-12);
    const curve=a-2*b+c;
    const offset=curve<0 ? bounded(.5*(a-c)/curve,-.5,.5) : 0;
    return {bin:at+offset,level:Math.exp(b-.25*(a-c)*offset)};
  }

  function decay(levels,duration) {
    const highest=max(levels), first=levels.indexOf(highest), points=[];
    for (let i=first;i<levels.length && levels[i]>=highest*.06;i++)
      points.push([(i-first)*duration/(levels.length-1),Math.log(levels[i]/highest)]);
    if (points.length<3 || points.at(-1)[1]>-.54) return null;
    const cx=mean(points.map(row=>row[0])), cy=mean(points.map(row=>row[1]));
    const xx=points.reduce((sum,[x])=>sum+(x-cx)**2,0), yy=points.reduce((sum,[,y])=>sum+(y-cy)**2,0);
    const xy=points.reduce((sum,[x,y])=>sum+(x-cx)*(y-cy),0);
    return xy<0 && xx>0 && yy>0 && xy**2/(xx*yy)>.62 ? bounded(-Math.log(1000)*xx/xy,.035,3) : null;
  }

  function stableModes(rows,step,duration,limit,rootHz) {
    const average=Float64Array.from(rows[0].spectrum,(_,i)=>Math.sqrt(mean(rows.map(row=>row.spectrum[i]**2))));
    const top=max(average), found=[], lo=Math.max(5,Math.ceil(Math.max(45,rootHz*.125)/step));
    const hi=Math.min(average.length-6,Math.floor(Math.min(11000,rootHz*32)/step));
    for (let bin=lo;bin<=hi;bin++) {
      const strength=average[bin];
      if (strength<top*.047 || strength<.0006 || strength<=average[bin-1] || strength<=average[bin+1]) continue;
      const flanks=(average[bin-5]+average[bin-4]+average[bin+4]+average[bin+5])*.25;
      if (strength<2.8*flanks) continue;
      const levels=rows.map(({spectrum})=>Math.max(spectrum[bin-1],spectrum[bin],spectrum[bin+1]));
      const active=max(levels);
      const hits=rows.filter(({spectrum},i)=>levels[i]>active*.13 &&
        levels[i]>2.6*(spectrum[bin-4]+spectrum[bin+4])*.5).length;
      if (hits<3) continue;
      const peak=localPeak(average,bin), hz=bounded(peak.bin*step,rootHz*.125,rootHz*32);
      found.push({bin,hz,strength:peak.level,hits,levels,decay:decay(levels,duration)});
    }
    return found.sort((a,b)=>b.strength-a.strength).slice(0,limit);
  }

  function pitchedFrames(rows,track,root,noteHz) {
    track=track.filter(row=>row.confidence>=.75);
    return rows.map(row=>{
      if (!root || !track.length) return noteHz;
      const i=track.findIndex(point=>point.sample>=row.at);
      const a=track[Math.max(0,i-1)], b=track[i];
      const observed=i<0 ? track.at(-1).hz : i===0 ? b.hz :
        a.hz+(b.hz-a.hz)*(row.at-a.sample)/(b.sample-a.sample);
      const detune=bounded(midi(observed)-midi(root.hz),-16,16);
      return root.hz*2**(detune/12);
    });
  }

  function harmonics(rows,step,trajectory,count,evidence) {
    const candidates=Array.from({length:Math.min(12,count*2)},(_,i)=>{
      const index=i+1, bins=trajectory.map(hz=>Math.round(hz*index/step));
      const levels=rows.map(({spectrum},i)=>{
        const bin=bins[i];
        if (bin<2 || bin>=spectrum.length-3 || evidence && !evidence[i]) return 0;
        return Math.max(spectrum[bin-1],spectrum[bin],spectrum[bin+1]);
      });
      return {index,bins,levels,strength:Math.sqrt(mean(levels.map(value=>value**2)))};
    });
    const peak=max(candidates.map(row=>row.strength));
    return candidates.filter(row=>row.strength>Math.max(peak*.04,.0008))
      .sort((a,b)=>b.strength-a.strength).slice(0,count).sort((a,b)=>a.index-b.index);
  }

  function noiseBands(rows,step,partials,modes) {
    return bands.flatMap(([low,high],index)=>{
      const levels=rows.map(({spectrum},i)=>{
        const peaks=[...partials.filter(row=>row.levels[i]>.001).map(row=>row.bins[i]),...modes.map(row=>row.bin)];
        let power=0, weighted=0;
        for (let bin=Math.ceil(low/step);bin<Math.min(spectrum.length,Math.ceil(high/step));bin++) {
          if (peaks.some(peak=>Math.abs(bin-peak)<=2)) continue;
          const energy=spectrum[bin]**2/3;
          power+=energy;
          weighted+=energy*Math.log(bin*step);
        }
        return {power,weighted};
      });
      const total=levels.reduce((sum,row)=>sum+row.power,0);
      if (total<1e-6) return [];
      const centroid=Math.exp(levels.reduce((sum,row)=>sum+row.weighted,0)/total);
      return [{index,low,high,center:centroid,q:bounded(centroid/(high-low),.5,2),
        levels:levels.map(row=>Math.sqrt(row.power))}];
    });
  }

  function measure(pcm,{analysis,root:override,partials,modes,pitchTrack}) {
    const source=isolate(pcm), {sampleRate,signal}=source, duration=signal.length/sampleRate;
    const reference=S.analyzeInstrumentBank({fit:{samples:signal,channels:1,sampleRate}},analysis).takes.fit;
    const tracked=pitchTrack?.filter(row=>row.confidence>=.75 && row.sample>=source.firstSample && row.sample<source.endSample)
      .map(row=>({...row,sample:row.sample-source.firstSample,hz:P.musicInstruments.hz(row.midi)}));
    const useTrack=tracked?.length>=3;
    const voiced=useTrack ? tracked.map(row=>row.midi).sort((a,b)=>a-b) : null;
    const trackedRoot=voiced?.[voiced.length>>1];
    const tuned=useTrack ? {hz:P.musicInstruments.hz(trackedRoot),suggestedNote:Math.round(trackedRoot)} :
      reference.voicedFraction>=.42 && reference.root && reference.root.confidence>=.32 ? reference.root : null;
    const key=override ?? bounded(tuned?.suggestedNote ?? 60,0,127), rootHz=P.musicInstruments.hz(key);
    const {rows,step}=scans(signal,sampleRate);
    const observed=pitchedFrames(rows,useTrack ? tracked : reference.pitchTrack,tuned,rootHz);
    const resonances=stableModes(rows,step,duration,modes,rootHz);
    let modalPower=0, inharmonicPower=0;
    for (const mode of resonances) {
      const power=mode.strength**2;
      modalPower+=power;
      if (tuned) {
        const harmonic=Math.max(1,Math.round(mode.hz/tuned.hz));
        if (Math.abs(mode.hz-harmonic*tuned.hz)>Math.max(step*1.5,.014*mode.hz)) inharmonicPower+=power;
      }
    }
    // A ringing strike can fool a period detector into jumping between a
    // shared subharmonic and the strongest mode as the quieter modes decay.
    const jump=reference.pitchTrack.some((point,i,track)=>i>0 &&
      point.sample-track[i-1].sample<=sampleRate*.055 && Math.abs(midi(point.hz)-midi(track[i-1].hz))>7);
    const ringing=resonances.filter(mode=>mode.decay!==null).length>=2;
    const pitched=useTrack || tuned && inharmonicPower<=modalPower*.13 && !(ringing && jump);
    const evidence=useTrack ? rows.map(row=>tracked.some(point=>Math.abs(point.sample-row.at)<=sampleRate*.05)) : null;
    const tones=pitched ? harmonics(rows,step,observed,partials,evidence) : [];
    const trajectory=tuned && override!==undefined ? observed.map(hz=>hz*rootHz/tuned.hz) : observed;
    const residual=noiseBands(rows,step,tones,tones.length ? [] : resonances.slice(0,Math.min(3,partials)));
    const amplitude=rows.map(({phase,at})=>{
      const half=Math.max(1,Math.round(duration*sampleRate/32)), low=Math.max(0,at-half), high=Math.min(signal.length,at+half+1);
      let power=0;
      for (let i=low;i<high;i++) power+=signal[i]**2;
      return [phase,Math.sqrt(power/Math.max(1,high-low))];
    });
    const maxLevel=max(amplitude.map(([,level])=>level));
    const shape=amplitude.map(([phase,level])=>[phase,round(clamp(level/maxLevel))]);
    return {...source,duration,reference,key,rootHz,trajectory,tones,resonances,residual,shape,maxLevel,tuned,binHz:step};
  }

  S.instrumentFitAnalysis=Object.freeze({measure,round,max});
})(KIT.procedural);
