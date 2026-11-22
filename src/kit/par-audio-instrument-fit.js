/* Fit analysis measurements into ordinary, independently editable graph patches. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,I=P.musicInstruments,H=P.musicHarmony;
  const {fields,integer,finite,check,clamp,id}=I, {measure,round,max}=S.instrumentFitAnalysis;
  const format='ink-studio/recording-instrument-fit';
  const bounded=(value,low,high)=>Math.max(low,Math.min(high,value));
  const curve=(levels,scale=1)=>({type:'curve',points:levels.map((level,i)=>[i/(levels.length-1),round(level*scale)])});
  const gain=(input,amount)=>({type:'gain',input,amount});
  const mod=(name,depth=1)=>({base:0,from:{[name]:depth}});
  const envelope=env=>({type:'envelope',env});
  const patch=(nodes,output,tail,controls)=>({type:'graph',nodes,output,tail:round(tail),...(controls && {controls})});

  function spectral(body,modalPartials) {
    const {tones,residual,rootHz,trajectory,duration}=body, nodes={}, branches=[];
    const detune=trajectory.map(hz=>12*Math.log2(hz/rootHz));
    if (tones.length) nodes.pitch=curve(detune);
    for (const {index,levels} of tones) {
      const osc='harmonic-'+index, shape=osc+'-level', voice=osc+'-voice';
      nodes[osc]={type:'oscillator',wave:'sine',ratio:index,detune:mod('pitch')};
      nodes[shape]=curve(levels,.72);
      nodes[voice]=gain(osc,mod(shape));
      branches.push(voice);
    }
    for (const mode of modalPartials) {
      const name='stable-'+branches.length;
      nodes[name]={type:'oscillator',wave:'sine',ratio:round(mode.hz/rootHz)};
      nodes[name+'-level']=curve(mode.levels,.65);
      nodes[name+'-voice']=gain(name,mod(name+'-level'));
      branches.push(name+'-voice');
    }
    const noise=residual.slice().sort((a,b)=>max(b.levels)-max(a.levels)).slice(0,tones.length===5 ? 2 : 3);
    if (noise.length) nodes.noise={type:'noise'};
    for (const {index,center,q,levels} of noise) {
      const stage='air-'+index, shape=stage+'-level', voice=stage+'-voice';
      const expected=Math.sqrt(Math.PI*center/(3*q*32000));
      nodes[stage]={type:'filter',input:'noise',mode:'bandpass',
        cutoff:{base:round(center*.89,2),by:{breath:round(center*.32,2)}},resonance:round(q)};
      nodes[shape]=curve(levels,bounded(1/expected,.8,14));
      nodes[voice]=gain(stage,mod(shape));
      branches.push(voice);
    }
    if (!branches.length) {
      nodes.noise={type:'noise'};
      nodes.air={type:'filter',input:'noise',mode:'lowpass',cutoff:520};
      nodes['air-level']={type:'curve',points:body.shape};
      nodes['air-voice']=gain('air',mod('air-level',body.maxLevel));
      branches.push('air-voice');
    }
    const release=bounded(duration*.12,.026,.19);
    nodes.mix={type:'mix',inputs:branches};
    nodes.release=envelope({attack:.004,decay:.018,sustain:1,release:round(release)});
    nodes.voice=gain('mix',mod('release'));
    return patch(nodes,'voice',release,{breath:.34});
  }

  function resonant(body) {
    const {resonances,duration,rootHz,shape,maxLevel}=body;
    const measured=resonances.flatMap(row=>row.decay===null ? [] : [row.decay]).sort((a,b)=>a-b);
    const median=measured[Math.floor(measured.length/2)] ?? bounded(duration*.58,.07,.68);
    const decayTime=Math.max(median,(measured.at(-1) ?? 0)/2);
    const ringing=measured.length>=Math.ceil(resonances.length*.6) &&
      shape.slice(-5,-1).every(([,value])=>value<.53);
    const release=.065, peak=max(resonances.map(row=>row.strength));
    const amount={base:0,from:{excite:round(bounded(maxLevel*(ringing ? 2.5 : .96),.04,1.3))}};
    const nodes={
      noise:{type:'noise'},
      excite:ringing ? envelope({attack:.001,decay:.026,sustain:0,release}) : {type:'curve',points:shape},
      driver:gain('noise',amount),
      release:envelope({attack:.001,decay:.02,sustain:1,release}),
      gate:gain('driver',mod('release')),
      ring:{type:'resonator',input:'gate',decay:{base:round(decayTime),by:{damping:round(-decayTime*.75)}},
        modes:resonances.map(row=>({ratio:round(bounded(row.hz/rootHz,.125,32)),gain:round(.85*row.strength/peak),
          decay:round(bounded((row.decay ?? decayTime)/decayTime,.03,2))}))}
    };
    const tail=bounded((measured.at(-1) ?? decayTime)+release,.10,3.5);
    return {patch:patch(nodes,'ring',tail,{damping:0}),ringing};
  }

  function layered(base,attackTime) {
    const points=[[0,.48],[round(attackTime*.4),.56],[round(attackTime),1]];
    return patch({...base.nodes,
      attack:{type:'sample',zones:[{samples:['fitted-attack'],gain:-2}]},
      'body-blend':{type:'curve',clock:'seconds',points},
      body:gain(base.output,mod('body-blend')),
      hybrid:{type:'mix',inputs:['attack','body']}
    },'hybrid',Math.max(base.tail,attackTime),base.controls);
  }

  function presence(candidate,assets) {
    check(fields(candidate,['format','version','root','referenceGate','preferred','patches']) && candidate.format===format &&
      candidate.version===1 && integer(candidate.root,0,127) && finite(candidate.referenceGate,.02,6) &&
      fields(candidate.patches,['synth','modal','hybrid']) && Object.keys(candidate.patches).length &&
      Object.hasOwn(candidate.patches,candidate.preferred),'Invalid recording instrument fit');
    return Object.fromEntries(Object.entries(candidate.patches).map(([name,def])=>{
      check(def?.type==='graph','A fitted candidate must be an instrument graph patch');
      return [name,I.compile(def,assets)];
    }));
  }

  function fit(source,settings={}) {
    check(fields(settings,['analysis','root','partials','modes','attackMs','pitchTrack']) &&
      integer(settings.partials ?? 4,1,5) && integer(settings.modes ?? 6,1,8) &&
      finite(settings.attackMs ?? 55,8,180),'Invalid recording instrument fit settings');
    const {partials=4,modes=6,attackMs=55}=settings, pcm=S.instrumentAudio(source);
    check(finite(pcm.samples.length/pcm.channels/pcm.sampleRate,.02,6),'Fit a recording slice from 20 ms to 6 seconds');
    const {pitchTrack}=settings, frames=pcm.samples.length/pcm.channels;
    check(pitchTrack===undefined || Array.isArray(pitchTrack) && integer(pitchTrack.length,3,224) &&
      Array.from(pitchTrack).every((row,i)=>fields(row,['sample','midi','confidence']) &&
        integer(row.sample,0,frames-1) && finite(row.midi,0,160) && finite(row.confidence,0,1) &&
        (!i || row.sample>pitchTrack[i-1].sample)),'Invalid measured fit pitch track');
    const body=measure(pcm,{analysis:settings.analysis,partials,modes,pitchTrack,
      root:settings.root===undefined ? undefined : H.midi(settings.root)});
    const {sampleRate,signal}=body, attackFrames=Math.min(signal.length,Math.max(2,Math.round(sampleRate*attackMs/1000)));
    const attackTime=attackFrames/sampleRate, fade=Math.min(attackFrames/2,sampleRate*.014);
    const original={sampleRate,channels:pcm.channels,
      samples:pcm.samples.slice(body.firstSample*pcm.channels,body.endSample*pcm.channels)};
    const attack={sampleRate,channels:1,samples:Float64Array.from(signal.subarray(0,attackFrames),(value,i)=>
      value*clamp((attackFrames-i-1)/fade))};
    const picks=body.tones.length ? [] : body.resonances.slice(0,Math.min(3,partials));
    const patches={synth:spectral(body,picks)};
    let ringing=false;
    if (body.resonances.length) {
      const result=resonant(body);
      patches.modal=result.patch;
      ringing=result.ringing;
    }
    const preferred=patches.modal && !body.tones.length && ringing ? 'modal' : 'synth';
    patches.hybrid=layered(patches[preferred],attackTime);
    const value={format,version:1,root:body.key,referenceGate:round(Math.max(.02,body.duration)),preferred,patches};
    const assets={'fitted-attack':attack};
    presence(value,assets);
    const report={sampleRate,channel:body.channel,rangeSamples:[body.firstSample,body.endSample],particulars:{
      duration:round(body.duration),sourcePeak:round(body.sourcePeak),binHz:round(body.binHz),
      root:body.reference.root,voicedFraction:body.reference.voicedFraction,
      pitchCurve:body.tones.length ? body.trajectory.map(hz=>round(12*Math.log2(hz/body.rootHz),3)) : null,
      amplitude:body.shape,attackSamples:attackFrames,
      harmonics:body.tones.map(({index,strength})=>({harmonic:index,amplitude:round(strength)})),
      modes:body.resonances.map(({hz,strength,hits,decay})=>({hz:round(hz,2),amplitude:round(strength),supportFrames:hits,
        decayT60:decay===null ? null : round(decay,3)})),
      noiseBands:body.residual.map(({low,high,center,levels})=>({low,high,center:round(center,1),peakRms:round(max(levels))})),
      modalExciter:patches.modal ? ringing ? 'strike' : 'continuous' : null},
      candidates:Object.keys(patches),preferred};
    return {value,assets,reference:original,report};
  }

  function defaults(value) {
    const {root}=value, gate=Math.min(4,value.referenceGate), note=(shift=0)=>bounded(root+shift,0,127);
    return [
      {id:'match',midi:note(),velocity:.82,gate},
      {id:'low',midi:note(-7),velocity:.82,gate},
      {id:'high',midi:note(7),velocity:.82,gate},
      {id:'soft',midi:note(),velocity:.3,gate},
      {id:'held',midi:note(),velocity:.82,gate:Math.min(5.25,gate*1.65)}
    ];
  }

  function render(player,row,sampleRate) {
    const {midi,velocity,gate,play}=row;
    const note={midi,velocity,gate,time:0,frequency:I.hz(midi),play:play ?? {},salt:I.hash(['instrument-fit',row.id]),
      roundRobin:0};
    const instrument=player.prepare(note,sampleRate,gate);
    const channels=instrument.stereo ? 2 : 1;
    const samples=Float64Array.from({length:Math.max(1,Math.ceil(instrument.duration*sampleRate))*channels},(_,i)=>{
      const frame=Math.floor(i/channels);
      return instrument.signal(frame/sampleRate,frame,i%channels);
    });
    return {samples,channels,sampleRate};
  }

  function audition(value,assets,settings={},reference) {
    check(fields(settings,['cases','candidates','sampleRate','gapSeconds','levelMatch']) &&
      integer(settings.sampleRate ?? 32000,8000,96000) && finite(settings.gapSeconds ?? .14,0,1) &&
      ['candidate','shared'].includes(settings.levelMatch ?? 'candidate'),'Invalid recording instrument audition settings');
    check(I.record(assets) && Object.keys(assets).length<=24,'Expected fitted or edited instrument assets');
    let pcmCount=0;
    const bank=Object.fromEntries(Object.entries(assets).map(([name,input])=>{
      const pcm=S.instrumentAudio(input);
      pcmCount+=pcm.samples.length;
      check(id(name) && pcmCount<=8e6,'Fitted instrument assets exceed their PCM budget');
      return [name,pcm];
    }));
    const players=presence(value,bank);
    const {cases=defaults(value),candidates=Object.keys(players),sampleRate=32000,gapSeconds=.14,levelMatch='candidate'}=settings;
    check(Array.isArray(cases) && integer(cases.length,1,16) && Array.isArray(candidates) &&
      integer(candidates.length,1,3) && new Set(candidates).size===candidates.length &&
      Array.from(candidates).every(name=>Object.hasOwn(players,name)) &&
      cases.length*candidates.length+Number(reference!==undefined)<=32,'Invalid instrument fit audition candidates or cases');
    const keys=new Set();
    for (const row of cases) {
      check(fields(row,['id','midi','velocity','gate','play']) && id(row.id) && !keys.has(row.id) &&
        integer(row.midi,0,127) && finite(row.velocity,.02,1) && finite(row.gate,.02,6) &&
        fields(row.play ?? {},['breath','damping','pressure','contact','bend','curves','articulation']) &&
        ['breath','damping','pressure','contact'].every(key=>finite(row.play?.[key] ?? 0,0,1)) &&
        finite(row.play?.bend ?? 0,-2400,2400) &&
        (row.play?.articulation===undefined || id(row.play.articulation)),'Invalid instrument fit audition case');
      keys.add(row.id);
    }
    const source=reference===undefined ? undefined : S.instrumentAudio(reference);
    const total=candidates.reduce((sum,name)=>sum+cases.reduce((sub,row)=>
      sub+row.gate+(value.patches[name].tail ?? .35),sum),source ? source.samples.length/source.channels/source.sampleRate : 0);
    check(total+(cases.length*candidates.length+1)*gapSeconds<90 && total*sampleRate<=3e6,'Recording instrument audition exceeds its render budget');
    const rows=source ? [{id:'source',value:source}] : [];
    const detail=source ? [{id:'source'}] : [];
    function matchingRms(pcm,gate) {
      const first=Math.min(pcm.samples.length-1,Math.round(gate*.03*pcm.sampleRate)*pcm.channels);
      const end=Math.min(pcm.samples.length,Math.max(first+1,Math.round(gate*pcm.sampleRate)*pcm.channels));
      let power=0;
      for (let i=first;i<end;i++) power+=pcm.samples[i]**2;
      return Math.sqrt(power/(end-first));
    }
    const target=source ? matchingRms(source,value.referenceGate) : I.db(-22);
    for (const name of candidates) {
      const clips=cases.map(row=>render(players[name],row,sampleRate));
      const anchor=cases.findIndex(row=>row.id==='match'), index=Math.max(0,anchor);
      const active=matchingRms(clips[index],cases[index].gate);
      const adjustment=levelMatch==='candidate' && active ? bounded(target/active,.2,6) : 1;
      for (const [i,row] of cases.entries()) {
        const {id:key,...note}=row, clip=clips[i], id=name+'-'+key;
        const samples=Float64Array.from(clip.samples,x=>x*adjustment);
        rows.push({id,value:{...clip,samples}});
        detail.push({id,candidate:name,case:key,...note,adjustment});
      }
    }
    let peak=1;
    for (const {value:clip} of rows) for (const x of clip.samples) peak=Math.max(peak,Math.abs(x));
    const normalized=peak===1 ? rows : rows.map(({id,value})=>({id,
      value:{...value,samples:Float64Array.from(value.samples,x=>x/peak)}}));
    const print=A.gestureBank.audition(normalized,{sampleRate,gapSeconds,levelMatch:'shared'});
    return {value:print.value,report:{...print.report,levelMatch,preGain:1/peak,
      clips:print.report.clips.map((row,i)=>({...row,...detail[i]}))}};
  }

  A.instrumentFit=Object.freeze({fit,audition});
})(KIT.procedural);
