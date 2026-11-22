/* Fit captured quiet tone to another quiet range with broad-band gains. */
(function (P) {
  const A=P.mediaGraph,{check,fields,integer,finite}=P.musicInstruments;
  const crossovers=[180,1800], minPower=1e-12;
  const db=(a,b)=>10*Math.log10(a/b);
  const bounded=(value,limit)=>Math.max(-limit,Math.min(limit,value));
  function analyze(input,selection,keep=false) {
    const source=A.audio(input),{samples,channels,sampleRate}=source, frames=samples.length/channels;
    check(channels<=2 && integer(sampleRate,8000,96000) && fields(selection,['fromSample','toSample']) &&
      integer(selection.fromSample,0,frames-1) && integer(selection.toSample,selection.fromSample+128,frames) &&
      selection.toSample-selection.fromSample<=sampleRate*20,'Choose a 128-sample to 20-second quiet room-tone range');
    const length=selection.toSample-selection.fromSample, power=[0,0,0];
    const bands=keep ? [0,1,2].map(()=>new Float64Array(length*channels)) : null;
    const alpha=crossovers.map(freq=>1-Math.exp(-2*Math.PI*freq/sampleRate));
    let energy=0;
    for (let ch=0;ch<channels;ch++) {
      let average=0;
      for (let i=selection.fromSample;i<selection.toSample;i++) average+=samples[i*channels+ch]/length;
      let low=samples[selection.fromSample*channels+ch]-average, wide=low;
      for (let i=0;i<length;i++) {
        const value=samples[(selection.fromSample+i)*channels+ch]-average;
        low+=alpha[0]*(value-low);
        wide+=alpha[1]*(value-wide);
        const middle=wide-low, high=value-wide;
        power[0]+=low*low; power[1]+=middle*middle; power[2]+=high*high;
        energy+=value*value;
        if (keep) {
          const at=i*channels+ch;
          bands[0][at]=low; bands[1][at]=middle; bands[2][at]=high;
        }
      }
    }
    const size=length*channels;
    return {sampleRate,channels,length,bands,power:power.map(value=>value/size),powerAll:energy/size};
  }
  function matchRoom(donor,reference,options) {
    check(fields(options,['donor','reference','frames','crossfadeSamples','maxBandDb','maxLevelDb','seed']),
      'Room match needs bounded donor and reference ranges');
    const base=analyze(donor,options.donor,true), target=analyze(reference,options.reference);
    const {sampleRate,channels,length,bands}=base;
    const {frames,crossfadeSamples=Math.min(Math.round(sampleRate*.05),(length-1)>>2),
      maxBandDb=9,maxLevelDb=18,seed=0}=options;
    check(integer(frames,1,Math.min(sampleRate*120,8e6/channels)) &&
      integer(crossfadeSamples,8,Math.floor(length/3)) && finite(maxBandDb,0,24) &&
      finite(maxLevelDb,0,36) && integer(seed,0,0xffffffff) &&
      base.powerAll>=minPower && target.powerAll>=minPower,'Invalid room length, match limits, or silent reference');
    const offsets=target.power.map((power,i)=>bounded(db(Math.max(minPower,power)/target.powerAll,
      Math.max(minPower,base.power[i])/base.powerAll),maxBandDb));
    const gains=offsets.map(value=>10**(value/20)), n=length*channels;
    let shaped=0;
    const template=new Float64Array(n);
    for (let i=0;i<n;i++) {
      template[i]=bands[0][i]*gains[0]+bands[1][i]*gains[1]+bands[2][i]*gains[2];
      shaped+=template[i]*template[i];
    }
    const period=length-crossfadeSamples;
    const data=new Float64Array(frames*channels);
    const rotate=seed ? (Math.imul(seed,0x9e3779b1)>>>0)%period : 0;
    let power=0,peak=0;
    for (let i=0;i<frames;i++) {
      const local=(i+rotate)%period;
      const joining=local<crossfadeSamples;
      const u=joining ? .5-.5*Math.cos(Math.PI*local/crossfadeSamples) : 1;
      for (let ch=0;ch<channels;ch++) {
        const head=template[local*channels+ch];
        const value=joining ? head*u+template[(period+local)*channels+ch]*(1-u) : head;
        data[i*channels+ch]=value;
        power+=value*value;
        peak=Math.max(peak,Math.abs(value));
      }
    }
    const achieved=power/data.length, desired=bounded(db(target.powerAll,Math.max(minPower,achieved)),maxLevelDb);
    const makeup=Math.min(10**(desired/20),1/Math.max(1e-12,peak));
    for (let i=0;i<data.length;i++) data[i]*=makeup;
    return {value:{sampleRate,channels,samples:data},report:{frames,sampleRate,channels,seed,crossfadeSamples,
      donor:options.donor,reference:options.reference,crossoversHz:crossovers.slice(),bandGainDb:offsets,
      makeupDb:20*Math.log10(makeup),donorDbFS:10*Math.log10(base.powerAll),referenceDbFS:10*Math.log10(target.powerAll),
      outputDbFS:10*Math.log10(Math.max(minPower,achieved*makeup*makeup)),shapedDbFS:10*Math.log10(shaped/n)}};
  }
  A.postProduction=Object.freeze({...A.postProduction,matchRoom});
})(KIT.procedural);
