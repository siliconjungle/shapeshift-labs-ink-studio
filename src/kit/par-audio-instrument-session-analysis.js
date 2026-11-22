/* Sample-addressed recording sessions and nondestructive marker suggestions. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,I=P.musicInstruments;
  const {check,record,fields,id,integer,finite}=I;
  const format='ink-studio/instrument-session';
  const bounded=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const round=(n,d=5)=>Number(n.toFixed(d));
  const median=rows=>rows.slice().sort((a,b)=>a-b)[Math.floor(rows.length/2)];
  const cellId=(key,dynamic,articulation)=>'key-'+key+'.'+dynamic+'.'+articulation;

  function clock(session,assets) {
    check(fields(session,['format','version','id','sampleRate','perspectives','analyze','range','registers','dynamics','articulations','takes']) &&
      session.format===format && session.version===1 && id(session.id) && integer(session.sampleRate,8000,96000) &&
      record(session.perspectives) && integer(Object.keys(session.perspectives).length,1,8) &&
      record(assets) && integer(Object.keys(assets).length,1,32),'Expected a version 1 instrument recording session');
    const {sampleRate:rate}=session, perspective=session.analyze ?? Object.keys(session.perspectives)[0];
    check(Object.hasOwn(session.perspectives,perspective),'Unknown analysis perspective');
    let pcmCount=0;
    const seen=new Set();
    const mics=Object.fromEntries(Object.entries(session.perspectives).map(([mic,row])=>{
      check(id(mic) && fields(row,['asset','offsetSamples']) && id(row.asset) && Object.hasOwn(assets,row.asset) &&
        integer(row.offsetSamples ?? 0,-rate*10,rate*10),'Invalid recording perspective or sync offset');
      const pcm=A.audio(assets[row.asset]);
      if (!seen.has(row.asset)) {
        pcmCount+=pcm.samples.length;
        seen.add(row.asset);
      }
      check(pcm.channels<=2 && pcm.sampleRate===rate && pcmCount<=32e6,
        'Perspectives need one shared sample rate and a bounded PCM bank');
      return [mic,{pcm,offset:row.offsetSamples ?? 0,asset:row.asset}];
    }));
    const {registers,dynamics,articulations,takes}=session;
    check(Array.isArray(registers) && integer(registers.length,1,12) &&
      Array.from(registers).every((key,i)=>integer(key,0,127) && (!i || key>registers[i-1])) &&
      Array.isArray(dynamics) && integer(dynamics.length,1,8) &&
      Array.from(dynamics).every((row,i)=>fields(row,['id','velocity']) && id(row.id) && finite(row.velocity,.02,1) &&
        (!i || row.velocity>dynamics[i-1].velocity)) && new Set(dynamics.map(row=>row.id)).size===dynamics.length &&
      Array.isArray(articulations) && integer(articulations.length,1,8) &&
      Array.from(articulations).every(name=>id(name) && name!=='key-up') && new Set(articulations).size===articulations.length &&
      registers.length*dynamics.length*articulations.length<=96,
      'Choose ordered register and dynamics anchors and up to 96 labeled coverage cells');
    const range=session.range ?? [registers[0],registers.at(-1)];
    check(Array.isArray(range) && range.length===2 && integer(range[0],0,registers[0]) &&
      integer(range[1],registers.at(-1),127),'Key range must include the recorded registers');
    const cells=articulations.flatMap(articulation=>registers.flatMap((key,i)=>dynamics.map(({id,velocity},j)=>({
      id:cellId(key,id,articulation),articulation,key,dynamic:id,velocity,
      low:i ? Math.floor((registers[i-1]+key)/2)+1 : range[0],
      high:i<registers.length-1 ? Math.floor((key+registers[i+1])/2) : range[1],
      band:[j ? round((dynamics[j-1].velocity+velocity)/2,8) : 0,
        j<dynamics.length-1 ? round((velocity+dynamics[j+1].velocity)/2,8) : 1]
    }))));
    const ids=new Set();
    let work=0;
    check(Array.isArray(takes) && integer(takes.length,1,128),'Choose one to 128 addressed gestures');
    for (const take of Array.from(takes)) {
      check(fields(take,['id','key','dynamic','articulation','fromSample','toSample','onsetSample','attackEndSample',
        'releaseSample','releaseEndSample','loop']) && id(take.id) && !ids.has(take.id) &&
        registers.includes(take.key) && dynamics.some(row=>row.id===take.dynamic) && articulations.includes(take.articulation) &&
        integer(take.fromSample,0,32e6) && integer(take.toSample,take.fromSample+Math.ceil(rate*.02),take.fromSample+rate*6),
      'Take needs a unique ID, known coverage cell and 20 ms to six seconds on the common clock');
      const {fromSample:from,toSample:to,onsetSample,attackEndSample,releaseSample,releaseEndSample,loop}=take;
      check((onsetSample===undefined || integer(onsetSample,from,to-2)) &&
        (attackEndSample===undefined || integer(attackEndSample,(onsetSample ?? from)+1,to)) &&
        (releaseSample===undefined || releaseSample===null || integer(releaseSample,attackEndSample===undefined ? (onsetSample ?? from)+2 : attackEndSample+1,to-1)) &&
        (releaseEndSample===undefined || integer(releaseSample,from+1,to-1) && integer(releaseEndSample,releaseSample+1,to)) &&
        (loop===undefined || loop===null || Array.isArray(loop) && loop.length===2 &&
          integer(loop[0],attackEndSample ?? (onsetSample ?? from)+1,to-1) &&
          integer(loop[1],loop[0]+Math.ceil(rate*.015),releaseSample ?? to)),
      'Take markers must be ordered within '+take.id);
      for (const {pcm,offset} of Object.values(mics)) check(from+offset>=0 && to+offset<=pcm.samples.length/pcm.channels,
        'Perspective does not cover the shared take range for '+take.id);
      work+=to-from;ids.add(take.id);
    }
    check(work<=rate*190,'Session analysis exceeds 190 seconds of gesture material');
    const slice=(mic,from,to)=>{
      const {pcm,offset}=mics[mic], {samples,channels}=pcm;
      const start=(from+offset)*channels, end=(to+offset)*channels;
      return {...pcm,samples:ArrayBuffer.isView(samples) ? samples.subarray(start,end) : samples.slice(start,end)};
    };
    return {rate,perspective,mics,cells,slice,takes};
  }

  function energy(pcm,from,to) {
    const {samples,channels,sampleRate}=pcm;
    let power=0, high=0, peak=0;
    const smooth=new Float64Array(channels), weight=1-Math.exp(-2*Math.PI*1700/sampleRate);
    for (let i=from;i<to;i++) for (let c=0;c<channels;c++) {
      const x=samples[i*channels+c];
      smooth[c]+=weight*(x-smooth[c]);
      power+=x*x;high+=(x-smooth[c])**2;peak=Math.max(peak,Math.abs(x));
    }
    return {rms:Math.sqrt(power/Math.max(1,(to-from)*channels)),brightness:Math.sqrt(high/(power || 1)),peak};
  }

  function loopFit(pcm,start,stop,hz) {
    if (!hz || stop-start<pcm.sampleRate*.20) return null;
    const {samples,sampleRate:rate,channels}=pcm, period=rate/hz, width=Math.max(12,Math.round(rate*.008));
    const first=start+Math.round((stop-start)*.16);
    const low=Math.round(Math.max(.075*rate,period*4)), high=Math.min(Math.round(.30*rate),stop-first-width);
    let best=null, score=Infinity;
    for (let cycles=Math.ceil(low/period);cycles*period+width<=high;cycles++) {
      const length=Math.round(cycles*period)+width;
      for (const fraction of [0,.18,.36,.57]) {
        const from=first+Math.floor((stop-first-length-width)*fraction);
        for (const offset of [-2,0,2]) {
          const to=from+length+offset;
          if (to>=stop) continue;
          let delta=0,power=0;
          for (let i=0;i<width;i+=2) for (let c=0;c<channels;c++) {
            const a=samples[(from+i)*channels+c], b=samples[(to-width+i)*channels+c];
            delta+=(a-b)**2;power+=a*a+b*b;
          }
          const cost=Math.sqrt(delta/Math.max(1e-12,power));
          if (cost<score) {score=cost;best=[from,to];}
        }
      }
    }
    return score<.62 ? {range:best,score:round(score)} : null;
  }

  function proposals(session,assets) {
    const model=clock(session,assets), {rate,perspective,slice}=model, marks=[], notes=[];
    for (const take of model.takes) {
      const {id,fromSample:from,toSample:to}=take, pcm=slice(perspective,from,to), count=to-from;
      const original=energy(pcm,0,count), hop=Math.max(1,Math.round(rate*.006)), blocks=[];
      for (let start=0;start<count;start+=hop) blocks.push({start,...energy(pcm,start,Math.min(start+hop,count))});
      const loud=Math.max(...blocks.map(row=>row.rms));
      const boundary=Math.min(take.releaseSample===undefined || take.releaseSample===null ? to : take.releaseSample-1,
        take.loop?.[0] ?? to);
      const eligible=Math.min(to-2,(take.attackEndSample ?? boundary)-1);
      const onset=take.onsetSample===undefined ? Math.min(eligible,from+(blocks.find(row=>row.rms>=Math.max(.001,loud*.09))?.start ?? 0))
        : take.onsetSample;
      const attackEnd=take.attackEndSample ?? Math.min(boundary,onset+Math.round(rate*.055));
      let release=take.releaseSample, releaseType=release===null ? 'disabled' : 'marked';
      if (release===undefined) {
        const sustained=blocks.filter(row=>row.start>=attackEnd-from && row.rms>=Math.max(.002,loud*.30));
        const last= sustained.at(-1)?.start ?? 0;
        const valid=sustained.length*hop>=rate*.15 && sustained.some(row=>row.start>(onset-from)+rate*.16);
        const after=blocks.find(row=>row.start>last && row.rms<=loud*.24);
        release=valid && after && from+after.start>attackEnd && after.rms>loud*.035 && after.start+rate*.045<count ? from+after.start : null;
        releaseType=release===null ? 'none' : 'inferred';
      }
      const finalRelease=release===null ? null : Math.min(to,take.releaseEndSample ?? release+Math.round(rate*.48));
      const bound=bounded(release ?? to,attackEnd,to), body=energy(pcm,attackEnd-from,bound-from);
      const fit=S.analyzeInstrumentBank({take:pcm},{lowHz:35,highHz:1500}).takes.take;
      const suggested=take.loop===undefined ? loopFit(pcm,attackEnd-from,bound-from,
        fit.root?.confidence>=.37 ? fit.root.hz : null) : null;
      const loop=take.loop===undefined ? suggested?.range.map(sample=>sample+from) ?? null : take.loop;
      const offsets=Object.fromEntries(Object.entries(model.mics).map(([name,row])=>
        [name,{asset:row.asset,fromSample:from+row.offset,toSample:to+row.offset}]));
      marks.push({...take,onsetSample:onset,attackEndSample:attackEnd,releaseSample:release,
        ...(finalRelease!==null && {releaseEndSample:finalRelease}),loop});
      const releaseEnergy=release===null ? 0 : energy(pcm,release-from,finalRelease-from).rms;
      notes.push({id,cell:cellId(take.key,take.dynamic,take.articulation),offsets,release:releaseType,
        loopError:suggested?.score ?? null,root:fit.root,peak:round(original.peak),bodyRms:round(body.rms),
        brightness:round(body.brightness),releaseRms:round(releaseEnergy),
        flags:[...(original.peak>=.999 ? ['near-full-scale'] : []),...(loud<.001 ? ['inaudible'] : []),
          ...(fit.root && Math.abs(fit.root.midi-take.key)>1.1 ? ['unexpected-pitch'] : []),
          ...(releaseType==='inferred' ? ['check-inferred-release'] : [])]});
    }
    return {value:P.data.clone({...session,takes:marks}),report:{sampleRate:rate,analysisPerspective:perspective,
      takes:notes,cells:model.cells.map(row=>({...row,takes:notes.filter(note=>note.cell===row.id).map(note=>note.id)}))}};
  }
  S.instrumentSessionAnalysis=Object.freeze({clock,proposals,energy,bounded,round,median});
})(KIT.procedural);
