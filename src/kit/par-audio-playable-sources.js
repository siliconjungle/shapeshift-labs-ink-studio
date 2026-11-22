/* Audition different source instruments before committing a score to one of them. */
(function (P) {
  const A=P.mediaGraph, S=P.mediaGraphSupport, I=P.musicInstruments, T=S.playableSoundProbe;
  const {fields,record,check,finite,integer,id,db}=I;
  const format='ink-studio/sound-discovery', round=n=>Number(n.toFixed(8));
  const scale=(audio,gain)=>gain===1 ? audio : {...audio,samples:Float32Array.from(audio.samples,value=>value*gain)};
  const pcm=input=>{
    const source=S.instrumentAudio(input);
    return {...source,samples:Float32Array.from(source.samples)};
  };
  const text=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;
  const audioSlice=(audio,first,end)=>({...audio,samples:audio.samples.slice(first*audio.channels,end*audio.channels)});
  const isCell=cell=>fields(cell,['id','key','velocity']) && id(cell.id) &&
    integer(cell.key,0,127) && finite(cell.velocity,.05,1);

  const compile=(patch,assets)=>{
    const {performance,echo,...voice}=patch;
    return I.compile(voice,assets);
  };
  const releaseOf=patch=>Math.max(.5,patch?.tail ?? 0,patch?.env?.release ?? 0);

  function held(patch,assets,cell,seed,rate,gate,play={}) {
    const tempo=60, beats=Math.max(1,gate);
    const probe={tempo,beats,notes:[{id:'held',beat:0,duration:gate,transpose:0,velocity:1,play}]};
    const {value}=T.probePrint(probe,cell,patch,assets,rate,Math.ceil((gate+releaseOf(patch)+.1)*rate),seed);
    const {samples,channels}=value;
    let peak=0;
    for (const sample of samples) peak=Math.max(peak,Math.abs(sample));
    // Include the native gate, plus any sounding release inside the probe.
    let end=samples.length/channels;
    while (end>Math.ceil(gate*rate) && Math.max(Math.abs(samples[2*(end-1)]),Math.abs(samples[2*(end-1)+1]))<peak*.001)
      end--;
    return scale(audioSlice(value,0,Math.min(end+Math.ceil(rate*.015),samples.length/channels)),1/Math.max(1,peak));
  }

  function prepare(row,assets,seed,anchor,rate) {
    check(fields(row,['id','label','family','root','gate','patch','source','build']) && id(row.id) && id(row.family) &&
      text(row.label ?? row.id,120) && finite(row.gate ?? 1.18,.04,5.5) &&
      (row.patch===undefined ? record(row.source) : record(row.patch) && row.source===undefined && row.build===undefined),
    'Sound candidates need a label and family with either a native patch or one source');
    const seedForSource=I.hash([seed,row.id,'source']);
    const gate=row.gate ?? 1.18;
    if (row.patch) {
      const patch={...row.patch,performance:row.patch.performance ?? T.performance}, bank=T.patchAssets(patch,assets);
      const library=Object.fromEntries(Object.entries(bank).map(([key,value])=>[key,pcm(value)]));
      const root=row.root===undefined ? anchor.key : T.midi(row.root);
      compile(patch,library);
      return {patch,root,gate,library,source:held(patch,library,{...anchor,key:root},seed,rate,gate),
        origin:{kind:'patch',type:patch.type}};
    }
    const ref=row.source;
    check(fields(ref,['asset']) && id(ref.asset) && Object.hasOwn(assets,ref.asset) ||
      fields(ref,['gesture']) && record(ref.gesture),'Choose a source WAV asset or a procedural gesture');
    check(fields(row.build ?? {},['fit','analysis','trackPitch','variant']),
      'Choose source fitting and one playable build');
    const generated=ref.gesture && A.synthesizeGesture({seed:seedForSource,sampleRate:rate,...ref.gesture});
    const source=pcm(generated?.value ?? assets[ref.asset]);
    const {variant={},fit={},...options}=row.build ?? {};
    check(record(variant) && variant.id===undefined,'Name a build family and its editable settings');
    const built=A.playableSound.build(source,{...options,id:row.id,seed,
      fit:{...fit,...(row.root!==undefined && {root:row.root})},variants:[{family:'sample',...variant,id:'voice'}]});
    const candidate=built.value.candidates.voice, patch={...candidate.patch,performance:T.performance};
    const library=Object.fromEntries(Object.entries(T.patchAssets(patch,built.assets)).map(([key,value])=>[key,pcm(value)]));
    return {patch,root:built.value.root,gate:row.gate ?? built.value.referenceGate,
      source,library,origin:generated ? {kind:'gesture',recipe:generated.report,build:candidate.family} :
        {kind:'asset',asset:ref.asset,build:candidate.family}};
  }

  function audition(spec,input={}) {
    check(fields(spec,['id','seed','candidates','settings']) && id(spec.id ?? 'discovery') &&
      Number.isSafeInteger(spec.seed ?? 0) && Array.isArray(spec.candidates) && integer(spec.candidates.length,1,24) &&
      new Set(spec.candidates.map(row=>row?.id)).size===spec.candidates.length && record(input),
    'Give the discovery session one to twenty-four distinct source instruments');
    const {id:name='discovery',seed=0,settings={}}=spec;
    check(fields(settings,['performance','sampleRate','keys','velocities','anchor','target','ceiling','gapSeconds','releaseSeconds']) &&
      integer(settings.sampleRate ?? 24000,8000,48000) && fields(settings.anchor ?? {},['key','velocity']) &&
      finite(settings.target ?? -20,-35,-10) && finite(settings.ceiling ?? -2,-10,-.1) &&
      finite(settings.gapSeconds ?? .26,0,1) && finite(settings.releaseSeconds ?? .5,.15,6),'Invalid source discovery listening settings');
    const {sampleRate=24000,target=-20,ceiling=-2,gapSeconds=.26,velocities=[.44,.86]}=settings;
    const performance=T.scoreProbe(settings.performance ?? T.diagnostic);
    const keys=Array.from(settings.keys ?? [48,60,72],T.midi);
    check(Array.isArray(settings.keys ?? []) && integer(keys.length,1,9) &&
      new Set(keys).size===keys.length && keys.every(key=>performance.notes.every(note=>integer(key+note.transpose,0,127))) &&
      Array.isArray(velocities) && integer(velocities.length,1,5) && new Set(velocities).size===velocities.length &&
      Array.from(velocities).every(value=>finite(value,.05,1)),'Choose distinct probe keys and velocities');
    const cells=keys.flatMap(key=>velocities.map((velocity,i)=>({id:'k'+key+'-v'+(i+1),key,velocity})));
    const defaultKey=keys.reduce((a,b)=>Math.abs(b-60)<Math.abs(a-60) ? b : a);
    const key=T.midi(settings.anchor?.key ?? defaultKey), velocity=settings.anchor?.velocity ?? Math.max(...velocities);
    const anchor=cells.find(cell=>cell.key===key && cell.velocity===velocity);
    check(anchor,'Use a probe key and velocity for the common listening anchor');
    const gateEnd=Math.max(...performance.notes.map(note=>note.beat+note.duration))*60/performance.tempo;
    const seconds=performance.beats*60/performance.tempo;
    const requestedTail=Math.max(settings.releaseSeconds ?? .5,...spec.candidates.map(row=>releaseOf(row?.patch)));
    // The window is fixed across the bank. Leave space for the release even
    // when the final written note ends at the last beat of a custom probe.
    const frames=Math.ceil(Math.max(seconds,gateEnd+requestedTail+.12)*sampleRate);
    const renderedCount=cells.length*spec.candidates.length;
    check(Number.isFinite(requestedTail) && requestedTail<=6 && renderedCount<=112 &&
      frames*renderedCount*2<=22e6 && (frames/sampleRate+gapSeconds)*spec.candidates.length<=90,
    'Source discovery exceeds its listening budget. Narrow the keys, dynamics or candidates');
    const rows=[], libraries={};
    let sourceSamples=0;
    for (const row of spec.candidates) {
      const {patch,source,library,root,gate,origin}=prepare(row,input,seed,anchor,sampleRate);
      sourceSamples+=source.samples.length+Object.values(library).reduce((sum,clip)=>sum+clip.samples.length,0);
      check(sourceSamples<=28e6,'Sound discovery exceeds its source audio budget');
      const takes=cells.map(cell=>{
        const result=T.probePrint(performance,cell,patch,library,sampleRate,frames,seed);
        const metrics=P.musicProduction.meters(result.value,true);
        const last=result.events.reduce((end,note)=>Math.max(end,note.startSample+note.gateSamples),0);
        const tail=P.musicProduction.meters(audioSlice(result.value,Math.min(frames,last),frames));
        return {...cell,pcm:result.value,events:result.events,...metrics,releaseRms:tail.rms};
      });
      const first=takes.find(cell=>cell.id===anchor.id);
      const peak=Math.max(...takes.map(cell=>cell.truePeak));
      const max=20*Math.log10(db(ceiling)/Math.max(peak,1e-9));
      rows.push({id:row.id,label:row.label ?? row.id,family:row.family,patch,root,gate,origin,takes,
        anchorLufs:first.lufs,headroomDb:Math.min(18,max)});
      libraries[row.id]={source,assets:library};
    }
    const audible=rows.filter(row=>row.anchorLufs!==null);
    check(audible.length,'No candidate sounds at the common audition anchor');
    const common=Math.min(target,...audible.map(row=>row.anchorLufs+row.headroomDb));
    const clips={}, candidates={};
    const report=rows.map(({takes,anchorLufs,headroomDb,patch,...row})=>{
      const gainDb=anchorLufs===null ? Math.min(0,headroomDb) : common-anchorLufs;
      const gain=db(gainDb);
      clips[row.id]=Object.fromEntries(takes.map(({id,pcm})=>[id,scale(pcm,gain)]));
      candidates[row.id]={...row,patch,gainDb};
      const {gate,...details}=row;
      return {...details,gainDb:round(gainDb),anchorLufs:anchorLufs===null ? null : round(common),
        cells:takes.map(({pcm,...cell})=>({...cell,playbackLufs:cell.lufs===null ? null : round(cell.lufs+gainDb)}))};
    });
    const reel=A.gestureBank.audition(rows.map(({id})=>({id,value:clips[id][anchor.id]})),
      {sampleRate,gapSeconds,peakDb:Math.max(-12,ceiling),targetRmsDb:-10,maxGainDb:0,levelMatch:'shared'});
    const bank=P.data.freeze(P.data.clone({format,version:1,id:name,seed,performance,frames,sampleRate,anchor,cells,candidates}));
    return {value:reel.value,bank,libraries,clips,report:{id:name,anchor,performance,sampleRate,frames,lufs:round(common),
      candidates:report,reel:reel.report}};
  }

  function keep(bank,libraries,selection) {
    check(fields(bank,['format','version','id','seed','performance','frames','sampleRate','anchor','cells','candidates']) &&
      bank.format===format && bank.version===1 && id(bank.id) && Number.isSafeInteger(bank.seed) &&
      integer(bank.sampleRate,8000,48000) && integer(bank.frames,1,bank.sampleRate*31) &&
      Array.isArray(bank.cells) && integer(bank.cells.length,1,45) && Array.from(bank.cells).every(isCell) &&
      isCell(bank.anchor) && bank.cells.some(cell=>cell.id===bank.anchor.id && cell.key===bank.anchor.key &&
        cell.velocity===bank.anchor.velocity) && record(bank.candidates) && record(libraries) &&
      fields(selection,['candidate','from','reason','trigger','slice','range','analysis','projection','resample']) &&
      id(selection.candidate) && Object.hasOwn(bank.candidates,selection.candidate) &&
      Object.hasOwn(libraries,selection.candidate) && text(selection.reason,1200) &&
      ['performed','source','slice'].includes(selection.from ?? 'performed') &&
      typeof (selection.resample ?? false)==='boolean','Choose an auditioned instrument and say why it works');
    const from=selection.from ?? 'performed';
    const row=bank.candidates[selection.candidate], library=libraries[selection.candidate], {sampleRate:rate,seed}=bank;
    check(fields(row,['id','label','family','patch','root','gate','origin','gainDb']) && row.id===selection.candidate &&
      integer(row.root,0,127) && finite(row.gate,.02,6) && finite(row.gainDb,-160,18+1e-8) &&
      fields(library,['source','assets']) && record(library.assets),'The discovery bank needs its editable patch and source assets');
    const performance=T.scoreProbe(bank.performance);
    const assets=T.patchAssets(row.patch,library.assets), trigger=selection.trigger ?? {};
    check(fields(trigger,['key','velocity','gate','play']) && finite(trigger.velocity ?? bank.anchor.velocity,.05,1) &&
      finite(trigger.gate ?? row.gate,.02,6) && record(trigger.play ?? {}) &&
      (from==='performed' || selection.trigger===undefined) &&
      (from==='slice' ? fields(selection.slice,['cell','fromSample','toSample']) : selection.slice===undefined),
    'Choose a held trigger, original source or addressed section of an audition cell');
    const key=T.midi(trigger.key ?? (from==='performed' ? bank.anchor.key : row.root));
    let reference, address, tonic=key;
    if (from==='source') {
      reference=pcm(library.source);
      address={fromSample:0,toSample:reference.samples.length/reference.channels};
    } else if (from==='slice') {
      const {cell,fromSample,toSample}=selection.slice;
      const played=bank.cells.find(item=>item.id===cell);
      check(played && integer(fromSample,0,bank.frames-1) &&
        integer(toSample,fromSample+Math.ceil(rate*.02),Math.min(bank.frames,fromSample+6*rate)),
      'Choose an audition cell and twenty milliseconds to six seconds on its sample clock');
      check(performance.notes.every(note=>integer(played.key+note.transpose,0,127)),
        'This cell must fit the saved performance');
      const print=T.probePrint(performance,played,row.patch,assets,rate,bank.frames,seed);
      reference=scale(audioSlice(print.value,fromSample,toSample),db(row.gainDb));
      tonic=played.key;
      address={cell,fromSample,toSample};
    } else {
      const velocity=trigger.velocity ?? bank.anchor.velocity, gate=trigger.gate ?? row.gate;
      reference=held(row.patch,assets,{key,velocity},seed,rate,gate,trigger.play);
      address={key,velocity,gate,play:trigger.play ?? {},fromSample:0,toSample:reference.samples.length/reference.channels};
    }
    const profile=S.timbreGesture.extract(reference,{...selection.analysis,id:row.id});
    const motif=S.timbreGesture.project(profile,{tonic,...selection.projection});
    let patch=row.patch, used=assets;
    if (selection.resample) {
      const name='discovery-resample';
      used={[name]:reference};
      patch={type:'sample',zones:[{root:tonic,samples:[name],oneShot:false}],
        env:{attack:.004,decay:.15,sustain:1,release:.12},performance:T.performance};
    }
    if (selection.range!==undefined) {
      const range=selection.range;
      check(fields(range,['low','high','velocity']) && patch.type!=='zoned',
        'Choose a key and velocity range for a single native or resampled voice');
      const {performance,echo,...instrument}=patch;
      patch={type:'zoned',instruments:{voice:instrument},zones:[{instrument:'voice',low:T.midi(range.low),
        high:T.midi(range.high),velocity:range.velocity ?? [0,1]}],...(performance && {performance}),...(echo && {echo})};
    }
    compile(patch,used);
    return {patch,assets:used,motif,reference,report:{id:bank.id,candidate:row.id,family:row.family,label:row.label,
      from,reason:selection.reason,origin:row.origin,sampleRate:reference.sampleRate,address,tonic,resampled:selection.resample ?? false,
      tested:bank.cells.map(({key,velocity})=>({key,velocity})),profile}};
  }

  A.soundDiscovery=Object.freeze({audition,keep});
})(KIT.procedural);
