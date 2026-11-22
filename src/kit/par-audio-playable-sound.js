/* Audition source-derived instruments on one performance and keep playable zones. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,I=P.musicInstruments,H=P.musicHarmony;
  const {fields,record,check,finite,integer,id,db}=I;
  const format='ink-studio/playable-sound', round=n=>Number(n.toFixed(8));
  const performance={connect:{gap:.085,interval:12,fade:.022},repeatGap:.17,rules:[{when:'legato',glide:.064}]};
  const diagnostic={tempo:128,beats:8,notes:[
    {id:'soft',beat:.22,duration:.56,transpose:0,velocity:.45,play:{breath:.24}},
    {id:'strike',beat:1.34,duration:.24,transpose:0,velocity:1,play:{contact:.4}},
    {id:'repeat',beat:1.72,duration:.25,transpose:0,velocity:.82,play:{contact:.57}},
    {id:'connect-from',beat:2.35,duration:.53,transpose:0,velocity:.83},
    {id:'connect-to',beat:2.88,duration:.69,transpose:3,velocity:.78,play:{pressure:.68}},
    {id:'release',beat:4.27,duration:1.42,transpose:0,velocity:.93,
      play:{curves:{breath:[[0,.28],[.41,.76],[1,.18]],damping:[[0,.12],[1,.62]]}}}
  ]};
  const families=['sample','attack','contour','modal','handoff'];
  const defaults=[
    {id:'sample',family:'sample',label:'Recorded source'},
    {id:'attack',family:'attack',label:'Recorded attack and modeled body'},
    {id:'contour',family:'contour',label:'Fitted pitch and breath'},
    {id:'air-tail',family:'handoff',label:'Fitted body to filtered breath',tail:'breath'},
    {id:'wire-tail',family:'handoff',label:'Fitted body to ringing wire',tail:'wire'}
  ];
  const own=(table,key)=>Object.hasOwn(table,key) ? table[key] : undefined;
  const midi=value=>{
    const key=H.midi(value);
    check(integer(key,0,127),'Use a MIDI key or note name');
    return key;
  };
  const pcm=(sampleRate,channels,samples)=>({sampleRate,channels,samples});

  function scoreProbe(probe) {
    check(fields(probe,['tempo','beats','notes']) && finite(probe.tempo,40,240) &&
      finite(probe.beats,1,16) && Array.isArray(probe.notes) && integer(probe.notes.length,1,24),
    'Give the playable sound workshop a short clocked performance');
    check(new Set(probe.notes.map(row=>row?.id)).size===probe.notes.length &&
      Array.from(probe.notes).every(row=>fields(row,['id','beat','duration','transpose','velocity','play']) && id(row.id) &&
        finite(row.beat,0,probe.beats-1e-5) && finite(row.duration,.005,probe.beats-row.beat) &&
        integer(row.transpose,-24,24) && finite(row.velocity,.02,1) && record(row.play ?? {})),
    'Invalid note or timing in the audition performance');
    return probe;
  }

  function handoff(patch,voice,phase,width,level) {
    const crossing=Array.from({length:9},(_,i)=>phase-width*.5+width*i/8);
    const fade=(towardTail)=>({type:'curve',points:[[0,towardTail ? 0 : 1],...crossing.map((at,i)=>
      [round(at),round(Math.sin(Math.PI*.5*(towardTail ? i : 8-i)/8))]),[1,towardTail ? 1 : 0]]});
    const tailShape={type:'envelope',env:{attack:.012,decay:.42,sustain:voice==='wire' ? .43 : .65,release:.51}};
    const other=voice==='wire' ? {
      'tail-carrier':{type:'oscillator',wave:'sine',ratio:1.001},
      'tail-color':{type:'oscillator',wave:'sine',ratio:2.714,detune:-.021},
      'tail-skew':{type:'gain',input:'tail-color',amount:.26},
      'tail-voice':{type:'mix',inputs:['tail-carrier','tail-skew']}
    } : {
      'tail-air':{type:'noise'},
      'tail-voice':{type:'filter',input:'tail-air',mode:'bandpass',cutoff:{base:670,by:{breath:1120,key:480}},resonance:1.25}
    };
    return {...patch,tail:Math.max(.61,patch.tail),output:'phase-voice',nodes:{...patch.nodes,...other,
      'tail-envelope':tailShape,
      'tail-shape':{type:'gain',input:'tail-voice',amount:{base:0,from:{'tail-envelope':db(level)}}},
      'body-fade':fade(false),'tail-fade':fade(true),
      'body-bus':{type:'gain',input:patch.output,amount:{base:0,from:{'body-fade':1}}},
      'tail-bus':{type:'gain',input:'tail-shape',amount:{base:0,from:{'tail-fade':1}}},
      'phase-voice':{type:'mix',inputs:['body-bus','tail-bus']}
    }};
  }

  function withMotion(patch,strength) {
    if (!patch.nodes.pitch || strength===1) return patch;
    const pitch=patch.nodes.pitch;
    return {...patch,nodes:{...patch.nodes,pitch:{...pitch,
      points:pitch.points.map(([phase,value])=>[phase,round(Math.min(48,Math.max(-48,value*strength)))])}}};
  }

  function build(input,settings={}) {
    check(fields(settings,['id','seed','fit','analysis','variants','performance','trackPitch']) && id(settings.id ?? 'sound') &&
      Number.isSafeInteger(settings.seed ?? 0) && typeof (settings.trackPitch ?? true)==='boolean' && fields(settings.fit ?? {},['root','analysis','partials','modes','attackMs']) &&
      integer(settings.fit?.partials ?? 2,1,2),'Invalid workshop settings. Use up to two fitted partials and edit the resulting nodes');
    const name=settings.id ?? 'sound', seed=settings.seed ?? 0, source=S.instrumentAudio(input);
    const profile=S.timbreGesture.extract(source,{...settings.analysis,id:name});
    const track=profile.pitchTrack.filter((row,i,all)=>[all[i-1],all[i+1]].some(other=>other &&
      Math.abs(row.midi-other.midi)<4 && Math.abs(row.sample-other.sample)<=source.sampleRate*.053));
    const pitchTrack=settings.trackPitch!==false && track.length>=5 ? track : undefined;
    const fitted=A.instrumentFit.fit(source,{partials:2,...settings.fit,pitchTrack});
    const {active,tail}=profile;
    const measuredPhase=(tail.fromSample-active.fromSample)/(active.toSample-active.fromSample);
    const variants=settings.variants ?? defaults;
    check(Array.isArray(variants) && integer(variants.length,1,12),'Choose one to twelve instrument builds');
    const candidates={}, assets={'workshop-source':source,'source-active':fitted.reference,...fitted.assets};
    for (const row of variants) {
      check(fields(row,['id','label','family','motion','tail','phase','blend','tailDb']) && id(row.id) &&
        !Object.hasOwn(candidates,row.id) && families.includes(row.family) &&
        typeof (row.label ?? row.id)==='string' && (row.label ?? row.id).length<=120 &&
        finite(row.motion ?? 1,0,1.75) && ['breath','wire'].includes(row.tail ?? 'breath') &&
        finite(row.phase ?? .65,.22,.88) && finite(row.blend ?? .22,.02,.22) &&
        finite(row.tailDb ?? -21,-42,-10) &&
        (row.family==='handoff' || row.tail===undefined && row.phase===undefined && row.blend===undefined && row.tailDb===undefined) &&
        (row.motion===undefined || ['contour','attack','handoff'].includes(row.family)),
      'Invalid playable sound variant');
      let patch, phase;
      const {family, motion=1}=row, {patches,root}=fitted.value;
      if (family==='sample') patch={type:'sample',zones:[{samples:['source-active'],root,oneShot:false}],
        env:{attack:.002,decay:.15,sustain:1,release:.13}};
      if (family==='modal') {
        check(patches.modal,'The source did not yield a usable modal fit');
        patch=patches.modal;
      }
      if (family==='attack') {
        const attackSeconds=fitted.report.particulars.attackSamples/fitted.report.sampleRate;
        const start=attackSeconds-Math.min(attackSeconds*.5,.014);
        patch=withMotion({...patches.hybrid,nodes:{...patches.hybrid.nodes,
          'body-blend':{type:'curve',clock:'seconds',points:[[0,0],[start,0],[attackSeconds,1]]}}},motion);
      }
      if (family==='contour') patch=withMotion(patches.synth,motion);
      if (family==='handoff') {
        const center=row.phase ?? Math.max(.48,Math.min(.79,measuredPhase));
        const spread=row.blend ?? .18, voice=row.tail ?? 'breath', level=row.tailDb ?? (voice==='wire' ? -23 : -16);
        phase={at:round(center),width:spread,voice,levelDb:level};
        patch=handoff(withMotion(patches.synth,motion),voice,center,spread,level);
      }
      I.compile(patch,assets);
      candidates[row.id]={label:row.label ?? row.id,family,patch,...(phase && {handoff:phase})};
    }
    const value=P.data.freeze(P.data.clone({format,version:1,id:name,seed,root:fitted.value.root,
      referenceGate:fitted.value.referenceGate,profile,performance:scoreProbe(settings.performance ?? diagnostic),candidates}));
    return {value,assets,report:{id:name,source:profile.source,trackedPitchFrames:pitchTrack?.length ?? 0,fit:fitted.report,
      candidates:Object.entries(candidates).map(([id,{family,handoff}])=>({id,family,...(handoff && {handoff})}))}};
  }

  function validate(workshop,assets) {
    check(fields(workshop,['format','version','id','seed','root','referenceGate','profile','performance','candidates']) &&
      workshop.format===format && workshop.version===1 && id(workshop.id) && Number.isSafeInteger(workshop.seed) &&
      integer(workshop.root,0,127) && finite(workshop.referenceGate,.02,6) && record(workshop.candidates) &&
      integer(Object.keys(workshop.candidates).length,1,12) && record(assets) &&
      Object.hasOwn(assets,'workshop-source'),'Expected a playable sound workshop and its source assets');
    const profile=S.timbreGesture.validate(workshop.profile);
    check(Object.entries(workshop.candidates).every(([name,row])=>id(name) &&
      fields(row,['label','family','patch','handoff']) && typeof row.label==='string' && families.includes(row.family) &&
      record(row.patch) && ['sample','graph'].includes(row.patch.type)),'Invalid instrument build in workshop');
    const source=S.instrumentAudio(assets['workshop-source']);
    check(source.sampleRate===profile.source.sampleRate && source.channels===profile.source.channels &&
      source.samples.length===profile.source.frames*profile.source.channels,'Workshop source does not match its profile');
    scoreProbe(workshop.performance);
    return source;
  }

  function patchAssets(patch,assets) {
    return Object.fromEntries([...new Set(I.assetNames(patch))].map(name=>{
      check(Object.hasOwn(assets,name),'Missing workshop asset '+name);
      return [name,S.instrumentAudio(assets[name])];
    }));
  }

  function measure({samples}) {
    let peak=0, power=0;
    for (const value of samples) {
      peak=Math.max(peak,Math.abs(value));
      power+=value*value;
    }
    check(Number.isFinite(peak) && Number.isFinite(power),'Instrument workshop produced nonfinite audio');
    return {peak,rms:Math.sqrt(power/Math.max(1,samples.length))};
  }
  const scale=(audio,gain)=>gain===1 ? audio : {...audio,samples:Float64Array.from(audio.samples,value=>value*gain)};
  const keyStarts=(notes,key)=>notes.every(row=>integer(key+row.transpose,0,127));

  function probePrint(probe,{key,velocity},patch,assets,rate,frames,seed) {
    const {tempo}=probe, bars=Math.ceil((frames+1)/rate*tempo/240);
    const notes=probe.notes.map(({transpose,velocity:accent,...note})=>
      ({...note,midi:key+transpose,velocity:round(velocity*accent)}));
    const source={seed,arrangement:{
      score:{key:{root:'C4'},tempoMap:{tempo},endFade:0,harmonies:{home:{root:'C4',quality:'unison'}}},
      motifs:{guide:{length:1,events:[{id:'guide',beat:0,duration:.1,midi:60,velocity:0}]}},
      parts:{voice:{role:'lead',material:'guide'}},sections:[{id:'probe',bars,harmony:'home'}]
    },patches:{sound:{...patch,performance:patch.performance ?? performance}},tracks:{voice:{patch:'sound',gain:-6,
      clips:[{id:'probe',beat:0,length:4*bars,voices:[{id:'player',notes}]}]}}};
    const compiled=P.musicProduction.compile(source,assets);
    const result=P.musicProduction.renderCompiled(compiled,{sampleRate:rate,end:{numerator:frames,denominator:rate}});
    const events=compiled.events.voice.map(row=>({id:row.note,midi:row.midi,velocity:row.velocity,kind:row.performance.kind,
      startSample:Math.ceil((row.start ?? row.time)*rate-1e-7),gateSamples:Math.round(row.gate*rate)}));
    return {value:result.value,events};
  }

  // A single held trigger supplies new material rather than re-transcribing the
  // written audition phrase.
  function trigger(patch,assets,{key,velocity,seed,gate,rate}) {
    const note={midi:key,velocity,gate,time:0,frequency:I.hz(key),play:{},salt:I.hash([seed,'workshop-trigger']),roundRobin:0};
    const sound=I.compile(patch,assets).prepare(note,rate,gate), channels=sound.stereo ? 2 : 1;
    const frames=Math.max(1,Math.ceil(sound.duration*rate));
    const result=pcm(rate,channels,Float64Array.from({length:frames*channels},(_,i)=>{
      const frame=Math.floor(i/channels);
      return sound.signal(frame/rate,frame,i%channels);
    }));
    return scale(result,1/Math.max(1,measure(result).peak));
  }
  const pitchSpan=profile=>{
    const track=profile?.pitchTrack.map(row=>row.midi).sort((a,b)=>a-b);
    if (!track || track.length<3) return null;
    const trim=Math.floor(track.length*.08);
    return round((track[track.length-1-trim]-track[trim])*100);
  };

  function motionError(reference,comparison) {
    const progress=(profile,fraction)=>{
      const {fromSample,toSample}=profile.active, span=toSample-fromSample;
      const at=fromSample+span*fraction;
      const row=profile.pitchTrack.reduce((nearest,point)=>
        !nearest || Math.abs(point.sample-at)<Math.abs(nearest.sample-at) ? point : nearest,null);
      return row && Math.abs(row.sample-at)<span*.09 ? row.midi : null;
    };
    const points=Array.from({length:13},(_,index)=>{
      const fraction=(index+1)/14;
      return [progress(reference,fraction),progress(comparison,fraction)];
    }).filter(([a,b])=>a!==null && b!==null);
    if (points.length<4) return null;
    const [a0,b0]=points[0];
    return round(100*Math.sqrt(points.reduce((sum,[a,b])=>sum+(a-a0-(b-b0))**2,0)/points.length));
  }

  function audition(workshop,assets,settings={}) {
    const source=validate(workshop,assets), {root,seed,performance:probe,candidates}=workshop;
    check(fields(settings,['pitches','velocities','anchor','candidates','sampleRate','match','gapSeconds','targetRmsDb']) &&
      integer(settings.sampleRate ?? 24000,8000,96000) && ['build','shared'].includes(settings.match ?? 'build') &&
      finite(settings.gapSeconds ?? .22,0,1) && finite(settings.targetRmsDb ?? -20,-48,-10) &&
      fields(settings.anchor ?? {},['key','velocity']),
    'Invalid playable sound audition settings');
    const {sampleRate:rate=24000,match='build',gapSeconds=.22,targetRmsDb=-20}=settings;
    const names=settings.candidates ?? Object.keys(candidates), offsets=probe.notes.map(row=>row.transpose);
    const low=Math.max(0,-Math.min(...offsets)), high=Math.min(127,127-Math.max(...offsets));
    const anchorDefault=Math.min(high,Math.max(low,root));
    const keys=Array.isArray(settings.pitches) ? settings.pitches.map(midi) : [...new Set([-5,0,5].map(offset=>
      Math.min(high,Math.max(low,anchorDefault+offset))))];
    const velocities=settings.velocities ?? [.43,.84];
    check((settings.pitches===undefined || Array.isArray(settings.pitches)) && integer(keys.length,1,9) &&
      new Set(keys).size===keys.length && keys.every(key=>keyStarts(probe.notes,key)) &&
      Array.isArray(velocities) && integer(velocities.length,1,5) && new Set(velocities).size===velocities.length &&
      velocities.every(value=>finite(value,.05,1)) &&
      Array.isArray(names) && integer(names.length,1,12) && new Set(names).size===names.length && names.every(name=>own(candidates,name)),
    'Choose available builds, keys that fit the probe and distinct velocities');
    const cells=keys.flatMap(key=>velocities.map((velocity,i)=>({id:'k'+key+'-v'+(i+1),key,velocity})));
    const anchorKey=settings.anchor?.key===undefined ? keys.reduce((a,b)=>Math.abs(b-root)<Math.abs(a-root) ? b : a) :
      midi(settings.anchor.key);
    const anchorVelocity=settings.anchor?.velocity ?? Math.max(...velocities);
    const anchor=cells.find(cell=>cell.key===anchorKey && cell.velocity===anchorVelocity);
    check(anchor,'The listening anchor must be one of the tested key and velocity pairs');
    const release=Math.max(...names.map(name=>candidates[name].patch.tail ?? .13));
    const duration=Math.max(probe.beats*60/probe.tempo,Math.max(...probe.notes.map(note=>note.beat+note.duration))*
      60/probe.tempo+release+.025);
    const frames=Math.ceil(duration*rate);
    check(cells.length*names.length<=72 && frames*cells.length*names.length*2<=14e6 &&
      duration*names.length+source.samples.length/source.sampleRate/source.channels+(names.length+1)*gapSeconds<=90,
    'Audition exceeds its render budget. Test fewer builds, keys or velocities at a time');
    const raws={}, summaries=[], profiles=[], target=db(targetRmsDb);
    const levelGain=rms=>match==='build' && rms>1e-9 ? Math.max(.25,Math.min(5,target/rms)) : 1;
    const sourceLevel=measure(source), sourceGain=levelGain(sourceLevel.rms);
    let masterPeak=sourceLevel.peak*sourceGain;
    for (const name of names) {
      const row=candidates[name], bank=patchAssets(row.patch,assets);
      const rendered=cells.map(cell=>{
        const {value,events}=probePrint(probe,cell,row.patch,bank,rate,frames,seed);
        return {...cell,value,events,...measure(value)};
      });
      const reference=rendered.find(cell=>cell.id===anchor.id);
      const gain=levelGain(reference.rms);
      masterPeak=Math.max(masterPeak,...rendered.map(cell=>cell.peak*gain));
      raws[name]={gain,rendered};
      const isolated=trigger(row.patch,bank,{...anchor,seed,gate:workshop.referenceGate,rate});
      const isolatedLevel=measure(isolated);
      const profile=isolatedLevel.rms>1e-5 && isolatedLevel.peak>2e-5 ? S.timbreGesture.extract(isolated,{id:name}) : null;
      if (profile) profiles.push(profile);
      summaries.push({id:name,label:row.label,family:row.family,gain,pitchSpanCents:pitchSpan(profile),
        contourErrorCents:profile ? motionError(workshop.profile,profile) : null,
        attacks:profile?.attacks.length ?? 0,handoff:row.handoff ?? null,
        cells:rendered.map(({value,...cell})=>cell)});
    }
    const headroom=Math.min(1,db(-2)/Math.max(1e-9,masterPeak));
    const clips=Object.fromEntries(names.map(name=>{
      const {gain,rendered}=raws[name];
      return [name,Object.fromEntries(rendered.map(cell=>[cell.id,scale(cell.value,gain*headroom)]))];
    }));
    const rows=[{id:'original-gesture',value:scale(source,sourceGain*headroom)},...names.map(name=>
      ({id:name,value:clips[name][anchor.id]}))];
    const reel=A.gestureBank.audition(rows,{sampleRate:rate,gapSeconds,targetRmsDb,levelMatch:'shared'});
    const shapes=profiles.length ? S.timbreGesture.compare(workshop.profile,profiles) : [];
    return {value:reel.value,clips,report:{id:workshop.id,match,anchor,cells,headroom,performance:probe,
      source:{pitchSpanCents:pitchSpan(workshop.profile),attacks:workshop.profile.attacks.length,gain:sourceGain},
      phaseMatches:shapes,candidates:summaries,reel:reel.report}};
  }

  function keep(workshop,assets,selection) {
    const source=validate(workshop,assets), {candidates,root,seed}=workshop;
    check(fields(selection,['candidate','zones','fallback','trigger','from','projection','analysis']) &&
      own(candidates,selection.candidate) && (selection.fallback===undefined || own(candidates,selection.fallback)) &&
      ['performed','source'].includes(selection.from ?? 'performed') &&
      fields(selection.trigger ?? {},['key','velocity','sampleRate','gate']),
    'Choose a build and a gesture to project');
    const chosen=selection.candidate, settings=selection.trigger ?? {};
    const key=midi(settings.key ?? root), {velocity=.76,sampleRate:rate=24000,gate=workshop.referenceGate}=settings;
    check(finite(velocity,.05,1) && integer(rate,8000,96000) && finite(gate,.02,6),'Invalid held-note projection settings');
    const zones=selection.zones ?? [{id:'main',candidate:chosen,low:0,high:127,velocity:[0,1]}];
    check(Array.isArray(zones) && integer(zones.length,1,96) && new Set(zones.map(row=>row?.id)).size===zones.length,
      'Supply unique labels for the kept key and velocity zones');
    const kept=zones.map(row=>{
      check(fields(row,['id','label','candidate','low','high','velocity','gainDb']) && id(row.id) &&
        own(candidates,row.candidate) && typeof (row.label ?? row.id)==='string' && (row.label ?? row.id).length<=120,
      'A kept zone must name a build and key range');
      return {id:row.id,label:row.label ?? row.id,instrument:row.candidate,low:midi(row.low),high:midi(row.high),
        velocity:row.velocity ?? [0,1],...(row.gainDb!==undefined && {gainDb:row.gainDb})};
    });
    const instruments=Object.fromEntries([...new Set([...kept.map(row=>row.instrument),
      ...(selection.fallback!==undefined ? [selection.fallback] : [])])].map(name=>[name,candidates[name].patch]));
    const raw={type:'zoned',instruments,zones:kept.map(({id,label,...zone})=>zone),
      ...(selection.fallback!==undefined && {fallback:selection.fallback})};
    const pcmBank=patchAssets(raw,assets);
    I.compile(raw,pcmBank);
    const from=selection.from ?? 'performed', candidate=candidates[chosen].patch;
    const reference=from==='source' ? source : trigger(candidate,patchAssets(candidate,assets),{key,velocity,seed,gate,rate});
    const profile=from==='source' && selection.analysis===undefined ? workshop.profile :
      S.timbreGesture.extract(reference,{...selection.analysis,id:workshop.id});
    const motif=S.timbreGesture.project(profile,{tonic:key,...selection.projection});
    return {value:{patch:{...raw,performance},zones:kept,motif},assets:pcmBank,reference,
      report:{id:workshop.id,candidate:chosen,from,trigger:{key,velocity,gate,sampleRate:rate},profile}};
  }

  S.playableSoundProbe=Object.freeze({performance,diagnostic,scoreProbe,patchAssets,probePrint,midi});
  A.playableSound=Object.freeze({build,audition,keep});
})(KIT.procedural);
