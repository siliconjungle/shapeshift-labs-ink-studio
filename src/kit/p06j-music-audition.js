/* Level-matched takes, using K-weighted gated loudness and oversampled peak estimates. */
(function (P) {
  const A=P.musicProduction, I=P.musicInstruments;
  const {fields,finite,integer,id,check,db}=I;
  const powerDb=value=>10*Math.log10(value);
  const rounded=value=>Number(value.toFixed(6));

  function kFilters(rate) {
    const q=.7071752369554196, k=Math.tan(Math.PI*1681.974450955533/rate);
    const vh=db(3.999843853973347), vb=vh**.4996667741545416, a=1+k/q+k*k;
    const shelf=[(vh+vb*k/q+k*k)/a,2*(k*k-vh)/a,(vh-vb*k/q+k*k)/a,
      2*(k*k-1)/a,(1-k/q+k*k)/a];
    const kh=Math.tan(Math.PI*38.13547087602444/rate), qq=.5003270373238773, ah=1+kh/qq+kh*kh;
    return [shelf,[1,-2,1,2*(kh*kh-1)/ah,(1-kh/qq+kh*kh)/ah]];
  }
  function filter([b0,b1,b2,a1,a2]) {
    let z1=0,z2=0;
    return x=>{
      const y=x*b0+z1;
      z1=x*b1+z2-a1*y;
      z2=x*b2-a2*y;
      return y;
    };
  }
  function loudness({samples,sampleRate,channels}) {
    const coeff=kFilters(sampleRate), filters=Array.from({length:channels},()=>coeff.map(filter));
    const hop=Math.max(1,Math.round(sampleRate/10)), hops=[];
    let energy=0, whole=0, frames=samples.length/channels;
    for (let i=0;i<frames;i++) {
      for (let ch=0;ch<channels;ch++) {
        const [shelf,high]=filters[ch], weighted=high(shelf(samples[i*channels+ch]));
        energy+=weighted**2;
      }
      if ((i+1)%hop===0) {hops.push(energy/hop); whole+=energy; energy=0;}
    }
    const blocks=[];
    for (let i=3;i<hops.length;i++) blocks.push((hops[i-3]+hops[i-2]+hops[i-1]+hops[i])/4);
    if (!blocks.length) blocks.push((whole+energy)/Math.max(1,frames));
    const absolute=blocks.filter(value=>-.691+powerDb(value)>=-70);
    if (!absolute.length) return null;
    const relative=absolute.reduce((sum,value)=>sum+value,0)/absolute.length/10;
    const gated=absolute.filter(value=>value>=relative);
    return -.691+powerDb(gated.reduce((sum,value)=>sum+value,0)/gated.length);
  }
  const sinc=x=>Math.abs(x)<1e-9 ? 1 : Math.sin(Math.PI*x)/(Math.PI*x);
  const taps=Array.from({length:3},(_,phase)=>{
    const weights=Array.from({length:16},(_,i)=>{
      const x=(phase+1)/4-(i-7);
      return sinc(x)*sinc(x/8);
    });
    const sum=weights.reduce((a,b)=>a+b,0);
    return weights.map(weight=>weight/sum);
  });
  function meters(audio,oversample=false) {
    const {samples,channels}=audio, frames=samples.length/channels;
    let peak=0,power=0;
    for (const x of samples) {peak=Math.max(peak,Math.abs(x));power+=x*x;}
    const rms=Math.sqrt(power/Math.max(1,samples.length));
    if (!oversample) return {peak:rounded(peak),rms:rounded(rms)};
    let estimate=peak;
    for (let frame=-1;frame<frames;frame++) for (let c=0;c<channels;c++) {
      let best=0;
      for (let i=Math.max(0,frame-7);i<Math.min(frames,frame+9);i++) best=Math.max(best,Math.abs(samples[i*channels+c]));
      if (best<estimate*.45) continue;
      for (const weights of taps) {
        let value=0;
        for (let i=0;i<16;i++) {
          const index=frame+i-7;
          if (index>=0 && index<frames) value+=samples[index*channels+c]*weights[i];
        }
        estimate=Math.max(estimate,Math.abs(value));
      }
    }
    const lufs=loudness(audio);
    return {peak:rounded(peak),rms:rounded(rms),truePeak:rounded(estimate),lufs:lufs===null ? null : rounded(lufs)};
  }
  const scale=(audio,gain)=>({...audio,samples:audio.samples.map(sample=>sample*gain)});
  function audition(source,variants,assets={},options={}) {
    check(Array.isArray(variants) && variants.length>=1 && variants.length<=8 &&
      fields(options,['start','end','sampleRate','target','ceiling']), 'Audition needs one to eight production variants');
    const baseline=A.compile(source,assets), {start=0,end=Math.min(baseline.end,start+20),sampleRate=48000,
      target=-17,ceiling=-1}=options;
    check(finite(start,0,baseline.end) && finite(end,start,baseline.end) && end>start && end-start<=30 &&
      integer(sampleRate,8000,48000) && finite(target,-35,-9) && finite(ceiling,-8,-.1),'Invalid production audition window or target');
    check((end-start)*sampleRate*variants.length*(Object.keys(baseline.tracks).length+2)*2<=60e6,
      'Production audition exceeds its combined sample budget');
    const used=new Set();
    const takes=variants.map(revision=>{
      check(id(revision?.id) && !used.has(revision.id),'Audition IDs must be unique');
      used.add(revision.id);
      const production=Object.keys(revision).length===1 ? source : A.revise(source,revision,assets);
      const {value,stems,report}=A.render(production,assets,{start,end,sampleRate,stems:true});
      return {id:revision.id,production,value,stems,report,before:meters(value,true)};
    });
    const threshold=db(ceiling);
    const common=Math.min(target,...takes.map(take=>take.before.lufs===null ? target :
      take.before.lufs+20*Math.log10(threshold/take.before.truePeak)));
    for (const take of takes) {
      const gain=take.before.lufs===null ? 1 : db(common-take.before.lufs);
      take.value=scale(take.value,gain);
      take.stems=Object.fromEntries(Object.entries(take.stems).map(([name,stem])=>[name,scale(stem,gain)]));
      const {peak,rms}=meters(take.value);
      take.report={...take.report,peak,rms,clipped:0,lufs:take.before.lufs===null ? null : rounded(common),
        gain:rounded(gain),truePeak:rounded(take.before.truePeak*gain),
        stems:Object.fromEntries(Object.entries(take.stems).map(([name,stem])=>[name,meters(stem)]))};
    }
    return {takes,report:{start,end,sampleRate,target:common,takes:takes.map(take=>({id:take.id,...take.report}))}};
  }
  P.musicProduction=Object.freeze({...A,audition,meters});
})(KIT.procedural);
