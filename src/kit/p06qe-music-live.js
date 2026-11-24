/* A causal adaptive score on the output sample clock. */
(function (K) {
  const P=K.procedural, A=P.musicProduction, F=P.musicPhraseRoutes, B=P.musicHarmonicBridge, R=P.musicMotifRecall;
  const {check,fields,record,finite,integer,id,clamp,db,hash}=P.musicInstruments;
  const {layerFactors:validLayerFactors,mergeLayerFactors}=P.adaptiveRehearsalTrace;
  const onset=F.onset, eps=1e-8, gainAtFrame=P.musicLayerGain.at;
  const ordered=(a,b)=>a.frame-b.frame || a.intent.time-b.intent.time ||
    Number(b.intent.kind==='music-transition')-Number(a.intent.kind==='music-transition') ||
    (a.intent.serial ?? 0)-(b.intent.serial ?? 0) || a.order-b.order;
  function boundedPush(rows,value,limit) {
    if (rows.length===limit) rows.shift();
    rows.push(value);
  }

  function open(sources,spec,options={},observe) {
    check(fields(options,['assets','sampleRate','maxVoices','reservedVoices','foreground','priorities','traceLimit',
      'maxEvents','streams','readPage','pageSize','maxPages','masterGain','clock','startTime','layerGains','layerFactors','stemGroups','ambienceGains','performanceTrace']),
    'Invalid live score options');
    const {assets={},sampleRate:rate=48000,maxVoices=32,reservedVoices=Math.min(4,maxVoices-1),
      foreground=[],priorities={},traceLimit=128,maxEvents=512,masterGain=-3,startTime=0,layerGains={},layerFactors={}}=options;
    check(integer(rate,8000,96000) && integer(maxVoices,1,128) && integer(reservedVoices,0,maxVoices) &&
      integer(traceLimit,1,2048) && integer(maxEvents,1,4096) && finite(masterGain,-60,6) &&
      finite(startTime,0,1e9) && record(layerGains) && Array.isArray(foreground) && foreground.every(id) &&
      new Set(foreground).size===foreground.length && record(priorities) &&
      Object.entries(priorities).every(([name,priority])=>id(name) && integer(priority,-100,100)),
    'Invalid live score clock or voice limits');
    const tracePerformance=options.performanceTrace ?? false;
    check(typeof tracePerformance==='boolean','Live audio performance tracing needs a boolean');
    const streams=P.musicLiveStreams.open(rate,options.streams,options.readPage,options.pageSize,options.maxPages);
    const stemGroups=streams.stemGroups(options.stemGroups);
    const {compiled,segments,known,memory,routes,recalls,phrasing,stingers,holds,rules}=
      P.musicTimeline.prepare(sources,spec,assets,undefined,new Map(),streams.streams);
    const versions=memory?.versions;
    const hasBridges=[...rules.values()].some(edge=>edge.harmonicBridge);
    const musicNames=[...new Set([...Object.values(segments).map(row=>row.source),
      ...Object.values(spec.thematic?.routes ?? {}).flat().map(row=>row.source),
      ...Object.values(spec.phrasing?.routes ?? {}).flat().map(row=>row.source)])];
    const persistent=spec.performers && P.musicPersistentPerformers.prepare(spec.performers,
      {sources,compiled,segments,entry:spec.entry,placements:musicNames.map(source=>({source,kind:'segment'}))});
    const carries=new Set(persistent?.names);
    const parts=new Set(Object.values(compiled).flatMap(score=>Object.keys(score.tracks)));
    for (const group of stemGroups) for (const {part} of group.parts) parts.add(part);
    const entrySource=compiled[segments[spec.entry].source];
    const roomSpec=persistent?.room ?? entrySource.room, room=A.makeSessionRoom(roomSpec,rate);
    check([...streams.streams.keys()].every(name=>!Object.hasOwn(stingers,name)),
      'A live cue resource must name either a score segment or a PCM stream');
    const machine=options.clock && K.music.create(options.clock);
    let control=machine?.initial(startTime);
    const initial=control && machine.inspect(control);
    check(!initial || initial.section===spec.entry && Object.keys(options.clock.sections).every(known),
      'Live score and world clock must share an entry and use authored sections');
    const initialLayers=Object.entries({...initial?.layerGains,...layerGains});
    check(initialLayers.every(([part,gain])=>parts.has(part)&&finite(gain,0,1)),
      'Initial live layer gains need known score parts and values from zero to one');
    check(validLayerFactors(layerFactors),'Invalid live layer factors');
    const initialFactors=mergeLayerFactors(initial?.layerFactors,layerFactors);
    check(validLayerFactors(initialFactors) && Object.keys(initialFactors).every(part=>parts.has(part)),
      'Initial live layer factors need known score parts and bounded factor levels');
    const fixedGain=gain=>({from:gain,target:gain,startFrame:0,endFrame:0});
    const layers=new Map(initialLayers.map(([part,gain])=>[part,{base:fixedGain(gain)}]));
    for (const [part,factors] of Object.entries(initialFactors)) {
      const layer=layers.get(part) ?? {};
      layer.factors=new Map(Object.entries(factors).map(([factor,gain])=>[factor,fixedGain(gain)]));
      layers.set(part,layer);
    }
    const time=()=>frame/rate, snap=seconds=>Math.round(seconds*rate), inputFrame=seconds=>snap(seconds-startTime);
    const fg=new Set(foreground), scale=db(masterGain), edgeFade=Math.max(2,Math.round(rate*.008));
    const desk=new Map(), echoes=new Map(), indexes=new Map(), recentNotes=new Map(), patchKeys=new Map();
    const intents=[], accents=[], voices=[], waiting=[], trace=[], joins=[], via=[], outcomes=new Map();
    const pair=[0,0], mixed=[0,0,0,0];
    const profile={transitions:0,cancellations:0,lateEvents:0,lateFrames:0,scheduled:0,
      starts:0,foregroundStarts:0,dropped:0,foregroundDropped:0,stolen:0,choked:0,delayed:0,latePickups:0,
      streamGaps:0,peakVoices:0,peakClips:0,peak:0,clippedFrames:0,blocks:0};
    let frame=0, order=0, clipId=0, incomingRule=null, active, pending, newest, lastBlock=null, roomLastInput=null;
    const observedInputs=observe && new WeakMap();
    function evidence(kind,intent,detail) {
      if (!observedInputs || !intent || !observedInputs.has(intent)) return;
      observe(kind,observedInputs.get(intent),frame,detail);
    }
    const diagnostics=P.musicLiveDiagnostics.create(Math.min(traceLimit,256));
    function missed(intent,resource,reason,part) {
      evidence('cue-missed',intent,{resource,reason});
      diagnostics.issue('missed-audio-cue',frame,frame+1,{cue:intent.cue ?? resource,resource,reason,
        requestedSample:inputFrame(intent.time),...(part!==undefined && {part})},intent);
    }
    function log(kind,detail) {
      boundedPush(trace,{kind,frame,time:time(),...detail},traceLimit);
      if (kind==='layer-gain' || kind==='layer-ignored' || kind==='score-accent' || kind==='transition-cancelled' ||
          kind==='transition-ignored' || kind==='transition-planned')
        evidence(kind,detail.trigger,detail);
      if (kind==='score-accent' && detail.status==='dropped' && detail.reason==='queue-budget')
        missed(detail.trigger,detail.resource,detail.reason);
    }
    const ambience=options.ambienceGains===undefined ? null : P.musicAmbience.open(rate,options.ambienceGains,stemGroups,log);
    function gainAt(row) {
      return gainAtFrame(row,frame);
    }
    function layerGain(part) {
      const layer=layers.get(part);
      let gain=gainAt(layer?.base);
      if (layer?.factors) for (const row of layer.factors.values()) gain*=gainAt(row);
      return gain;
    }
    const knowsLayer=({part,factor})=>parts.has(part) &&
      (factor===undefined || layers.get(part)?.factors?.has(factor));
    function setLayer(intent) {
      const {part,factor,gain:target,ramp=.05}=intent, layer=layers.get(part) ?? {};
      const previous=factor===undefined ? layer.base : layer.factors.get(factor);
      const address={part,...(factor!==undefined && {factor})};
      const last=previous?.intent;
      if (last && (intent.time<last.time || (intent.time===last.time && intent.serial!==undefined &&
        last.serial!==undefined && intent.serial<=last.serial))) {
        log('layer-ignored',{...address,reason:'stale-intent',trigger:intent});
        return;
      }
      const from=gainAt(previous), startFrame=frame, endFrame=frame+snap(ramp);
      const row={from,target,startFrame,endFrame,intent};
      if (factor===undefined) layer.base=row;
      else layer.factors.set(factor,row);
      layers.set(part,layer);
      log('layer-gain',{...address,from,target,startFrame,endFrame,trigger:intent});
    }
    for (const [source,score] of Object.entries(compiled)) {
      const parts=Object.entries(score.tracks);
      if (hasBridges) patchKeys.set(source,new Map(parts.map(([part,track])=>[part,F.signature(sources[source].patches[track.patch])])));
      const rows=parts.flatMap(([part,track],rank)=>{
        check(!track.external,'Live adaptive playback needs a native instrument on '+source+'/'+part);
        return score.events[part].map(note=>({part,track,note,at:onset(note),rank}));
      }).sort((a,b)=>a.at-b.at || a.rank-b.rank);
      indexes.set(source,rows);
    }
    function choose(section,reason,path=via,rule=incomingRule) {
      const choices=routes.get(section), state=memory?.at(time());
      const match=choices?.find(({when})=>state[when.theme].counts[when.stage]>=(when.min ?? 1));
      const source=match?.source ?? segments[section].source;
      const selected=phrasing.choose(section,time(),source,path,rule,reason);
      return {...selected,themeMatch:match?.when ?? null};
    }
    const frameAt=(phase,position)=>phase.frame+snap(position-phase.position);
    const playhead=clip=>clip.phase.position+(frame-clip.phase.frame)/rate;
    const scoring=spec.scoring===undefined ? null : P.musicLiveScoring.open(spec.scoring,{
      segments,compiled,stingers,streams:streams.streams,rate,maxEvents,frameAt,inputFrame,log,
      play:(resource,intent)=>playCue(resource,intent,true)
    });
    const foleyRoom=scoring?.hasSpace ? A.makeSessionRoom(roomSpec,rate) : null;
    function begin(section,position,layers={},fadeIn=0,kind='segment',reason='entry',phase={frame,position},selected) {
      const segment=segments[section];
      const selection=selected ?? (kind==='segment' ? choose(section,reason) : {source:segment.source,phrase:null});
      let notes=indexes.get(selection.source), recall;
      const config=kind==='segment'&&reason!=='repeat'&&recalls.get(section);
      if(config){
        memory.at(time());
        const score=compiled[selection.source], levels={...segment.layers,...layers};
        const result=R.realize(config,versions.select(config),score,position,segment.end,levels);
        recall=result.report;
        if(result.notes.length)notes=[...notes,...result.notes.map((note,i)=>({note,part:config.part,
          track:score.tracks[config.part],at:note.time,recall:recall.notes[i]}))].sort((a,b)=>a.at-b.at);
      }
      let low=0,high=notes.length;
      while (low<high) {
        const mid=(low+high)>>>1;
        if (notes[mid].at<position-eps) low=mid+1;
        else high=mid;
      }
      const clip={id:++clipId,section,segment,...selection,first:frame,position,phase,kind,notes,next:low,
        stop:Math.max(frame+1,frameAt(phase,segment.end)),layers:{...segment.layers,...layers},fadeIn,spoke:false,
        ...(recall&&{recall})};
      clip.visit={first:frame,position,phase,stop:clip.stop};
      clip.listen=phrasing.tracks(section);
      clip.roomCut=P.musicCueMap.cursor(compiled[clip.source].cue?.roomCuts ?? []);
      return clip;
    }
    function retire(voice,end) {
      if (voice.fadeEnd<=end) return;
      voice.fadeGain=fadeAt(voice,frame);
      voice.fadeFirst=frame;
      voice.fadeEnd=end;
      voice.last=Math.min(voice.last,end);
    }
    function releaseDeparting(clip,tail) {
      const end=frame+(tail ? snap(tail) : edgeFade);
      for (const voice of voices) if ((voice.owner ?? voice.clip)===clip && !voice.persistent) retire(voice,end);
    }
    function finish(clip,tail=0,keepVoices=false) {
      if (clip.finished) return;
      clip.finished=true;
      for(const note of clip.recall?.notes??[])if(note.status===undefined||note.status==='after-fade')note.status='departed';
      if (clip.kind==='segment' && clip.spoke && clip.position<=clip.segment.start+eps && frame>=clip.stop)
        phrasing.heardPhrase(clip.phrase,clip.section,clip.source,time());
      memory?.finish(clip.id,time());
      if (!keepVoices) releaseDeparting(clip,tail);
    }
    function fadeAt(voice,at) {
      return voice.fadeEnd===Infinity ? 1 : voice.fadeGain*clamp((voice.fadeEnd-at)/(voice.fadeEnd-voice.fadeFirst));
    }
    function layerFor(clip,part) {
      const source=compiled[clip.source], key=clip.source+'/'+part+(clip.kind==='segment' ? '' : '/accent');
      let row=desk.get(key);
      if (!row) {
        const track=source.tracks[part], echoKey=carries.has(part) && clip.kind==='segment' ? part : key;
        let echo=echoes.get(echoKey);
        if (!echo && track.echo) {
          const decay=track.echo.feedback ? Math.ceil(Math.log(1e-7)/Math.log(track.echo.feedback)) : 0;
          echo={tick:null,spec:track.echo,tailFrames:Math.ceil(rate*(track.echo.delay+.012)*(2+decay)),
            l:0,r:0,send:track.mix.send,until:-1};
          echoes.set(echoKey,echo);
        }
        row={strip:A.scoreStrip(source,part,rate),echo,track,key,part,l:0,r:0,until:0};
        desk.set(key,row);
      }
      if (row.clip!==clip) {
        row.clip=clip;
        row.strip.resetClock();
      }
      return row;
    }
    function creditNote(voice,from,gain,velocity,clip=voice.clip){
      const {part,lane,pitch}=voice;
      if (!clip.finished) {
        if (!clip.listen || clip.listen.includes(part)) clip.spoke=true;
        memory?.add({source:clip.source,segment:clip.section,instance:clip.id,at:time(),from,
          to:from+3*eps,gain,layers:clip.layers,note:{part,midi:pitch}});
      }
      recentNotes.set(lane.key,{time:time(),velocity});
      voice.unheard=undefined;
    }
    function addNote(request) {
      const {clip,event}=request;
      if (clip.finished) return null;
      const {part,note,track,at}=event, delta=time()-at, shift=value=>value+delta;
      const local=compiled[clip.source].cue?.perTrack[part];
      const cut=local?.cuts.find(row=>row.endTime>at+eps);
      if (cut?.startTime<=at+eps) return null;
      const row={...note,time:shift(note.time)};
      if (note.start!==undefined) row.start=time();
      if (note.clipEnd!==undefined) row.clipEnd=shift(note.clipEnd);
      const choke=Math.min(note.choke ?? Infinity,cut?.startTime ?? Infinity);
      if (choke<Infinity) row.choke=shift(choke);
      const shortened=local?.tail?.map(row=>({...row,startTime:shift(row.startTime),endTime:shift(row.endTime)}));
      row.renderGain=clip.segment.gain*(clip.layers[part] ?? 1);
      if (clip.fadeIn) row.renderFade={at:clip.first/rate,duration:clip.fadeIn};
      const tone=A.prepareVoice(track,row,Infinity,rate,shortened);
      if (tone.last<=frame || tone.first!==frame) return null;
      const lane=layerFor(clip,part);
      const persistent=carries.has(part) && clip.kind==='segment';
      const voice={...tone,part,clip,lane,persistent,off:snap(row.time+row.gate),pitch:note.midi,
        ...(hasBridges && {frequency:note.frequency*2**((note.play.bend ?? 0)/1200),articulation:note.play.articulation}),
        choke:track.mix.choke ? (persistent ? 'live/' : clip.source+'/')+track.mix.choke : null};
      if (clip.kind==='harmonic-bridge') return voice;
      if(event.recall){
        if(layerGain(part)>0&&(!clip.listen||clip.listen.includes(part)))clip.spoke=true;
        return voice;
      }
      const heard=versions?.matches(clip.source,part,note);
      if(heard?.length)voice.motif={hits:heard,first:layerGain(part)>0?frame:null};
      if (clip.kind==='segment' && layerGain(part)===0)
        voice.unheard={from:note.time,gain:row.renderGain,velocity:note.velocity};
      else creditNote(voice,note.time,row.renderGain,note.velocity);
      return voice;
    }
    function start(request) {
      const voice=request.stream ? {...streams.voice(request.stream,frame),stream:request.stream,
        scoreAccent:request.scoreAccent,trigger:request.trigger} : addNote(request);
      if (!voice) return 'silent';
      if(request.event?.recall){
        voice.recall=request.event.recall;
        voice.recall.status='admitted';
      }
      const choked=voice.choke ? voices.filter(row=>row.choke===voice.choke && row.first<frame && row.last>frame) : [];
      for (const row of choked) retire(row,frame+edgeFade);
      profile.choked+=choked.length;
      if (observedInputs) {
        const clip=voice.clip, trigger=request.trigger ?? clip?.trigger;
        if (trigger) {
          const resource=request.stream?.name ?? clip.resource;
          evidence('cue-voice',trigger,{resource,segment:clip?.section ?? null,source:clip?.source ?? null,
            asset:voice.asset ?? request.stream?.name ?? null});
        }
      }
      voices.push({...voice,foreground:request.foreground,priority:request.priority,strength:request.strength ?? 1,fadeEnd:Infinity});
      profile.starts++;
      profile.foregroundStarts+=Number(request.foreground);
      profile.peakVoices=Math.max(profile.peakVoices,voices.length);
      return 'played';
    }
    function dismiss(request,reason) {
      profile.dropped++;
      if(request.event?.recall)request.event.recall.status='dropped';
      profile.foregroundDropped+=Number(request.foreground);
      log('voice-dropped',{part:request.event?.part ?? request.stream?.name,reason,foreground:request.foreground});
      if (request.trigger) missed(request.trigger,request.stream.name,reason);
      else if (request.clip?.trigger && !request.clip.missedNote) {
        const {trigger,resource}=request.clip;
        missed(trigger,resource,reason,request.event.part);
        request.clip.missedNote=true;
      }
      return 'dropped';
    }
    function admit(request,canWait=true) {
      if (request.clip?.finished) return 'departed';
      const background=voices.reduce((n,voice)=>n+Number(!voice.foreground),0);
      if (voices.length<maxVoices && (request.foreground || background<maxVoices-reservedVoices)) {
        return start(request);
      }
      let victim;
      for (const voice of voices) {
        if (voice.foreground || voice.replacement || (!request.foreground && voice.priority>=request.priority)) continue;
        if (!victim || voice.priority<victim.priority || voice.priority===victim.priority && voice.first<victim.first)
          victim=voice;
      }
      if (victim && canWait && waiting.length<maxVoices) {
        retire(victim,frame+edgeFade);
        victim.replacement=true;
        waiting.push({...request,at:victim.last});
        waiting.sort((a,b)=>a.at-b.at || Number(b.foreground)-Number(a.foreground) || b.priority-a.priority);
        profile.stolen++;
        profile.delayed++;
        return 'after-fade';
      }
      return dismiss(request,'voice-budget');
    }
    function playNotes(clip) {
      if (clip.finished || frame>=clip.stop) return;
      for (;clip.next<clip.notes.length;clip.next++) {
        const event=clip.notes[clip.next];
        if (event.at>=clip.segment.end-eps || frameAt(clip.phase,event.at)>frame) break;
        if (!event.note.velocity || !event.track.mix.gain || clip.layers[event.part]===0) continue;
        if (clip.tied?.has(event)) {
          const held=clip.tied.get(event);
          if (held.last>frame && !held.replacement && held.fadeEnd===Infinity) {
            if (layerGain(event.part)>0) creditNote(held,event.note.time,clip.segment.gain*(clip.layers[event.part] ?? 1),event.note.velocity,clip);
            continue;
          }
        }
        if (clip.kind==='harmonic-bridge') {
          event.audit.status=layerGain(event.part)>0 ? admit({clip,event,foreground:false,priority:-100},false) : 'muted';
        } else {
          const status=admit({clip,event,foreground:fg.has(event.part),priority:priorities[event.part] ?? 0});
          if(event.recall)event.recall.status=status==='played'?'admitted':status;
        }
      }
    }
    function accent(section,kind,trigger,resource) {
      if (accents.length>=maxVoices) {
        log('accent-skipped',{section,reason:'clip-budget'});
        if (trigger) missed(trigger,resource,'clip-budget');
        return null;
      }
      const clip=begin(section,segments[section].start,{},0,kind);
      if (trigger) Object.assign(clip,{trigger,resource});
      accents.push(clip);
      profile.peakClips=Math.max(profile.peakClips,accents.length+1);
      return clip;
    }
    const linkKey=(time,rule)=>JSON.stringify([time,rule]);
    function linkOutcome(intent,destination) {
      if (intent.rule===undefined) return;
      const key=linkKey(intent.time,intent.rule);
      if (outcomes.has(key)) outcomes.delete(key);
      if (outcomes.size===traceLimit) outcomes.delete(outcomes.keys().next().value);
      outcomes.set(key,destination);
    }
    function playCue(resource,intent,scoreAccent=false) {
      const stream=streams.streams.get(resource), segment=Object.hasOwn(stingers,resource) ? stingers[resource] : null;
      if (!stream && !segment) {
        missed(intent,resource,'unmapped');
        return 'unmapped';
      }
      if (holds.some(row=>row.resource===resource && row.section===active.section &&
        (row.linked===undefined || row.linked===(intent.transition!==undefined)))) return 'withheld';
      const strength=intent.data?.strength;
      if (segment) return accent(segment,'stinger',intent,resource) ? 'scheduled' : 'dropped';
      if (strength===0) return 'silent';
      return admit({stream,scoreAccent,trigger:intent,foreground:stream.foreground,priority:stream.priority,
        strength:finite(strength,0,1) ? strength : 1},!scoreAccent);
    }
    function cue(intent) {
      const resource=intent.resource ?? intent.cue;
      if (intent.transition!==undefined) {
        if (pending?.row.intent.rule===intent.transition && pending.row.intent.time===intent.time) {
          if (pending.cues.length<maxEvents) pending.cues.push(intent);
          else {
            log('cue-skipped',{resource,reason:'queue-budget'});
            missed(intent,resource,'queue-budget');
          }
          return;
        }
        const destination=outcomes.get(linkKey(intent.time,intent.transition));
        if (destination!==active.section) {
          evidence('cue-decision',intent,{resource,status:'transition-did-not-land'});
          log('cue-skipped',{resource,reason:'transition-did-not-land',trigger:intent});
          return;
        }
      }
      const rule=scoring?.ruleFor(intent);
      if (rule) {
        scoring.offer(rule,intent,frame);
        if (!rule.passThrough) {
          evidence('cue-decision',intent,{resource,status:'scoring-rule'});
          return;
        }
      }
      const status=playCue(resource,intent);
      evidence('cue-decision',intent,{resource,status});
      if (status==='unmapped' || status==='withheld') log('cue-skipped',{resource,reason:status});
      else log('cue',{resource,section:active.section,trigger:intent,status});
    }
    function cancel(reason) {
      if (!pending) return;
      profile.cancellations++;
      linkOutcome(pending.row.intent,null);
      for (const accessory of pending.accessories) if (accessory.playing) finish(accessory.playing,.08);
      if (pending.harmonic) {
        finish(pending.harmonic,.035);
        for (const note of pending.pickup.notes) if (note.status==='scheduled') note.status='cancelled';
      }
      for (const intent of pending.cues) {
        const resource=intent.resource ?? intent.cue;
        evidence('cue-decision',intent,{resource,status:'transition-did-not-land'});
        log('cue-skipped',{resource,reason:'transition-did-not-land',trigger:intent});
      }
      log('transition-cancelled',{target:pending.row.intent.to,trigger:pending.row.intent,reason,
        ...(pending.cadence && {cadence:pending.cadence})});
      pending=null;
    }
    function nextExit(edge) {
      if (!edge.waitForExit) return frame;
      const first=frameAt(active.phase,edge.exit), period=snap(active.segment.end-active.segment.start);
      if (first>=frame) return first;
      if (active.parked || !active.segment.loop) return frame;
      // The first partial pass can enter after its exit marker. The next pass starts at the loop head.
      const next=active.stop+snap(edge.exit-active.segment.start);
      return next>=frame ? next : next+Math.ceil((frame-next)/period)*period;
    }
    function nextSwitch(points) {
      if (active.parked) return null;
      const {start,loop}=active.segment;
      let selected=null;
      for (const point of points) {
        let at=frameAt(active.phase,point.position);
        if (point.position<active.position || at<frame) {
          if (!loop) continue;
          // The active pass still owns its original boundary after a matched switch.
          at=active.stop+snap(point.position-start);
        }
        if (!selected || at<selected.at) selected={point,at};
      }
      return selected;
    }
    function expectedExit(edge,intent,planned) {
      const requested=inputFrame(intent.time), {visit,segment}=active;
      if (requested>=frame || requested<visit.first) return planned;
      if (!edge.waitForExit) return requested;
      const period=snap(segment.end-segment.start);
      const points=edge.switchPoints?.map(point=>point.position) ?? [edge.exit];
      let expected=Infinity;
      for (const position of points) {
        const first=frameAt(visit.phase,position);
        if (position>=visit.position && first>=requested) expected=Math.min(expected,first);
        else if (segment.loop) {
          const next=visit.stop+snap(position-segment.start);
          expected=Math.min(expected,next+Math.max(0,Math.ceil((requested-next)/period))*period);
        }
      }
      return Math.min(planned,expected===Infinity && !edge.switchPoints ? requested : expected);
    }
    function selectCadence(variants,landingFrame) {
      const {segment,source,visit,phrase}=active, clock=compiled[source].clock;
      const position=Math.min(segment.end,Math.max(segment.start,playhead(active)));
      const beat=clock.sample(position).beat, first=clock.sample(segment.start).beat, last=clock.sample(segment.end).beat;
      const phase=clamp((beat-first)/(last-first)), dwellFrames=frame-visit.first, availableFrames=landingFrame-frame;
      let selected;
      const candidates=variants.map(row=>{
        const durationFrames=snap(row.duration), [low,high]=row.phase, reasons=[];
        if (row.phrase!==undefined && row.phrase!==phrase) reasons.push('phrase');
        if (phase<low-eps || high<1 && phase>=high-eps) reasons.push('phase');
        if (dwellFrames<snap(row.minDwell)) reasons.push('dwell');
        if (durationFrames>availableFrames) reasons.push('time');
        const candidate={id:row.id,segment:row.segment,durationFrames,reasons};
        if (!reasons.length && (!selected || durationFrames>selected.durationFrames)) selected=candidate;
        return candidate;
      });
      return {id:selected?.id ?? null,segment:selected?.segment ?? null,status:selected ? 'scheduled' : 'no-fit',
        startFrame:selected ? landingFrame-selected.durationFrames : null,landingFrame,availableFrames,dwellFrames,
        phrase,beat,phase,candidates};
    }
    function plan(row) {
      const {intent}=row, target=intent.to, section=active.section;
      if (newest && (intent.time<newest.time ||
        intent.time===newest.time && intent.serial!==undefined && newest.serial!==undefined && intent.serial<=newest.serial)) {
        log('transition-ignored',{target,reason:'stale-intent',trigger:intent});
        return;
      }
      newest=intent;
      if (pending?.row.intent.to===target) {
        log('transition-ignored',{target,reason:'already-pending',trigger:row.intent});
        return;
      }
      cancel(target===section ? 'reversal' : 'superseded');
      if (target===section) {
        log('transition-ignored',{target,reason:'already-playing',trigger:row.intent});
        return;
      }
      let edge=rules.get(section+'>'+target) ??
        {exit:segments[section].end,entry:segments[target].start,tail:0,fadeIn:0,pickup:0};
      const matched=edge.switchPoints && nextSwitch(edge.switchPoints);
      if (edge.switchPoints && !matched) {
        log('transition-ignored',{target,reason:'no-compatible-switch',trigger:intent});
        return;
      }
      if (matched) edge={...edge,exit:matched.point.position,entry:matched.point.position};
      const nominal=matched?.at ?? nextExit(edge);
      const lead=edge.harmonicBridge ? snap(edge.harmonicBridge.lead) : 0;
      const immediate=edge.harmonicBridge && !edge.waitForExit ? lead : 0;
      const at=nominal+immediate;
      const cadence=edge.cadences && selectCadence(edge.cadences,at);
      const accessories=[
        [edge.bridge,'bridge',edge.pickup],
        [edge.commonTone?.segment,'common-tone',edge.commonTone?.pickup ?? 0]
      ].filter(([clip])=>clip).map(([clip,kind,pickup])=>{
        const requested=at-snap(pickup);
        if (requested<frame) profile.latePickups++;
        return {clip,kind,at:Math.max(frame,requested)};
      });
      if (cadence?.id) accessories.push({clip:cadence.segment,kind:'cadence',at:cadence.startFrame});
      pending={row,edge,at,expectedFrame:expectedExit(edge,intent,nominal)+immediate,
        ...(lead && {pickupFrame:Math.max(frame,at-lead)}),switchPoint:matched?.point,cues:[],accessories,cadence};
      log('transition-planned',{trigger:row.intent,from:section,to:target,exitFrame:at,exit:edge.exit,entry:edge.entry,
        ...(matched && {switchPoint:matched.point}),...(cadence && {cadence})});
    }
    function sounding(clip) {
      return voices.filter(voice=>voice.clip?.kind==='segment' && ((voice.owner ?? voice.clip)===clip || voice.persistent) &&
        voice.first<frame && voice.off>=frame && voice.last>frame && voice.fadeEnd===Infinity && !voice.replacement &&
        !voice.unheard && voice.lastSound>=frame-snap(.04) && layerGain(voice.part)>0 && voice.clip.layers[voice.part]!==0 &&
        compiled[voice.clip.source].arrangement.parts[voice.part].role!=='percussion');
    }

    function startHarmonicPickup(plan) {
      const {row,edge,at}=plan, {intent}=row, config=edge.harmonicBridge, part=config.track;
      if (at-frame<snap(.045) || accents.length>=maxVoices || layerGain(part)===0 ||
        (intent.layers?.[part] ?? segments[intent.to].layers[part])===0) return;
      const held=sounding(active);
      if (!held.length) return;
      const choice=choose(intent.to,'harmonic-bridge',[...via.slice(-7),active.section],intent.rule ?? null);
      const score=compiled[choice.source], target=B.chord(score,edge.entry);
      if (!target) return;
      const pitches=B.line(held,target,config);
      if (!pitches.length) return;
      const length=(at-frame)/rate, beat=score.clock.sample(edge.entry).beat;
      const clip=begin(intent.to,edge.entry,intent.layers ?? {},0,'harmonic-bridge','pickup',undefined,choice);
      clip.stop=at;
      clip.segment={...clip.segment,end:edge.entry+length};
      clip.next=0;
      const period=Math.floor((at-frame)/pitches.length);
      clip.notes=pitches.map((midi,i)=>{
        const first=frame+i*period, end=first+Math.max(1,Math.round(period*.78)), local=edge.entry+(first-frame)/rate;
        const audit={midi,firstFrame:first,gateEndFrame:end,status:'scheduled'};
        const note={part,beat,time:local,gate:(end-first)/rate,midi,frequency:score.program.chordPitch(midi,edge.entry),
          velocity:config.velocity,roundRobin:i,play:{},salt:hash([active.section,intent.to,first,midi])};
        return {part,note,track:score.tracks[part],at:local,audit};
      });
      plan.harmonic=clip;
      plan.selection=choice;
      plan.pickup={track:part,source:choice.source,chord:target.name,firstFrame:frame,landingFrame:at,
        sounding:[...new Set(held.map(voice=>voice.pitch))].sort((a,b)=>a-b),notes:clip.notes.map(event=>event.audit)};
      accents.push(clip);
      profile.peakClips=Math.max(profile.peakClips,accents.length+1);
      log('harmonic-pickup',{from:active.section,to:intent.to,pickup:plan.pickup});
    }

    function carryHarmony(outgoing,incoming,entry) {
      const target=B.chord(compiled[incoming.source],entry);
      if (!target) return {chord:null,held:[]};
      const shared=sounding(outgoing).filter(voice=>target.classes.has(B.pitchClass(voice.pitch)) &&
        incoming.layers[voice.part]!==0);
      const available=new Set(shared);
      const held=shared.map(voice=>({part:voice.part,pitch:voice.pitch,firstFrame:Math.max(0,voice.first),
        fromGateEndFrame:voice.off,gateEndFrame:voice.off,openingAttackReused:false}));
      const details=new Map(shared.map((voice,i)=>[voice,held[i]]));
      incoming.tied=new Map();
      const openingEnd=Math.min(incoming.segment.end,target.until,entry+.04);
      for (let i=incoming.next;i<incoming.notes.length;i++) {
        const event=incoming.notes[i], {note,part}=event;
        if (event.at>=openingEnd) break;
        if (!note.velocity || !soundingTrack(incoming,part)) continue;
        const frequency=note.frequency*2**((note.play.bend ?? 0)/1200);
        const patch=patchKeys.get(incoming.source).get(part);
        const voice=[...available].find(voice=>voice.part===part && voice.pitch===note.midi &&
          patchKeys.get(voice.clip.source).get(part)===patch && voice.articulation===note.play.articulation && Math.abs(1200*Math.log2(voice.frequency/frequency))<3);
        if (!voice) continue;
        const first=frameAt(incoming.phase,event.at);
        const gate=frameAt(incoming.phase,Math.min(note.time+note.gate,note.choke ?? Infinity));
        if (gate<=first || voice.last<=first) continue;
        if (gate>voice.off) {
          const last=voice.extend?.(gate);
          if (last==null) continue;
          voice.off=gate;
          voice.last=last;
        }
        if (voice.last<gate) continue;
        available.delete(voice);
        incoming.tied.set(event,voice);
        const detail=details.get(voice);
        detail.gateEndFrame=voice.off;
        detail.openingAttackReused=true;
      }
      for (const voice of shared) voice.owner=incoming;
      return {chord:target.name,held};
    }
    function soundingTrack(clip,part) {
      return clip.layers[part]!==0 && layerGain(part)>0;
    }

    function commit() {
      if (pending.pickupFrame===frame) startHarmonicPickup(pending);
      for (const accessory of pending.accessories) if (accessory.at===frame) {
        accessory.playing=accent(accessory.clip,accessory.kind);
        if (accessory.kind==='cadence') {
          pending.cadence={...pending.cadence,status:accessory.playing ? 'started' : 'clip-budget'};
          log('cadence-start',{from:active.section,to:pending.row.intent.to,cadence:pending.cadence});
        }
      }
      if (pending.at!==frame) return;
      const {row,edge,cues,switchPoint,expectedFrame}=pending, {intent}=row, outgoing=active;
      finish(outgoing,edge.tail,Boolean(switchPoint || edge.harmonicBridge));
      const hearing={phrases:phrasing.counts(),
        ...(memory && {themes:memory.at(time())})};
      via.push(outgoing.section);
      if (via.length>8) via.shift();
      incomingRule=intent.rule ?? null;
      const phase=switchPoint && frame<outgoing.stop ? outgoing.phase : undefined;
      active=begin(intent.to,edge.entry,intent.layers ?? {},edge.fadeIn,'segment','entry',phase,pending.selection);
      const harmony=edge.harmonicBridge && carryHarmony(outgoing,active,edge.entry);
      if (harmony) releaseDeparting(outgoing,edge.tail);
      const held=voices.filter(voice=>voice.last>frame && (voice.persistent || voice.owner===active || (switchPoint && voice.clip===outgoing))).map(voice=>({
        part:voice.part,pitch:voice.pitch,phaseFrames:frame-voice.first,gateEndFrame:voice.off,releaseEndFrame:voice.last,
        state:frame<voice.off ? 'held' : 'release',...(switchPoint && {source:voice.clip.source})
      }));
      const detail={frame,time:time(),trigger:intent,arrivalFrame:row.received,expectedFrame,latencyFrames:frame-inputFrame(intent.time),
        from:outgoing.section,to:active.section,via:via.slice(),
        exit:{source:outgoing.source,authored:edge.waitForExit ? edge.exit : null,
          played:Math.min(outgoing.segment.end,playhead(outgoing)),tail:edge.tail},
        entry:{source:active.source,offset:edge.entry,phrase:active.phrase,themeMatch:active.themeMatch,fadeIn:edge.fadeIn,
          ...(active.recall&&{recall:active.recall})},
        ...(switchPoint && {switchPoint}),heard:hearing,carry:{held,echoes:[...echoes].filter(([,echo])=>echo.until>frame).map(([key])=>key),
          room:true,roomLastInputFrame:roomLastInput,bridge:edge.bridge ?? null,commonTone:edge.commonTone ?? null,
          ...(pending.cadence && {cadence:pending.cadence}),
          ...(harmony && {harmonicBridge:{...harmony,pickup:pending.pickup ?? null}})}};
      profile.transitions++;
      boundedPush(joins,detail,traceLimit);
      if (frame>expectedFrame) diagnostics.issue('late-musical-join',expectedFrame,frame+1,{
        from:detail.from,to:detail.to,requestedSample:inputFrame(intent.time),expectedSample:expectedFrame,
        arrivalSample:row.received,actualSample:frame,lateBySamples:frame-expectedFrame,
        ...(switchPoint && {switchPoint:switchPoint.id})
      },intent);
      log('transition',detail);
      if (observedInputs) {
        const lastVoiceFrame=voices.reduce((last,voice)=>(voice.owner ?? voice.clip)===outgoing && !voice.persistent ? Math.max(last,voice.last) : last,frame);
        evidence('transition',intent,{...detail,lastVoiceFrame});
      }
      pending=null;
      linkOutcome(intent,active.section);
      for (const linked of cues) cue(linked);
    }
    function expireAccents() {
      for (let i=accents.length-1;i>=0;i--) if (accents[i].finished || frame>=accents[i].stop) {
        finish(accents[i]);
        accents.splice(i,1);
      }
    }
    function repeat() {
      if (!active.finished || active.parked) return;
      if (active.segment.loop) {
        const {visit}=active;
        active=begin(active.section,active.segment.start,active.layers,0,'segment','repeat');
        active.visit=visit;
      }
      else active.parked=true;
    }
    function step() {
      for (let i=voices.length-1;i>=0;i--) if (voices[i].last<=frame) {
        if (voices[i].stream) diagnostics.close(voices[i],frame);
        voices.splice(i,1);
      }
      expireAccents();
      // A request observed at the exit can still choose or cancel that exit.
      let cues;
      while (intents[0]?.frame<=frame) {
        const row=intents.shift(), late=Math.max(0,row.received-inputFrame(row.intent.time));
        if (late) {
          profile.lateEvents++;
          profile.lateFrames=Math.max(profile.lateFrames,late);
          log('late-event',{framesLate:late,trigger:row.intent});
        }
        if (row.intent.kind==='music-transition') plan(row);
        else if (row.intent.kind==='music-layer') setLayer(row.intent);
        else if (row.intent.kind==='music-ambience') ambience.update(row.intent,frame);
        else (cues ??= []).push(row.intent);
      }
      if (pending) commit();
      if (frame===active.stop) finish(active);
      repeat();
      if (cues) for (const request of cues) cue(request);
      scoring?.step(frame,active);
      while (waiting[0]?.at<=frame) admit(waiting.shift(),false);
      playNotes(active);
      for (const clip of accents) playNotes(clip);
    }
    active=begin(spec.entry,segments[spec.entry].start,initial?.layers ?? {});
    profile.peakClips=1;

    const token=value=>typeof value==='string' && value.length>0 && value.length<=256;
    function dispatch(intent,{observedAt=startTime+time()}={},comparisonInput) {
      check(record(intent) && finite(intent.time,0,1e9) && finite(observedAt,startTime,1e9) &&
        (intent.beatId===undefined || K.world.inspectionLinks.parse(intent.beatId)) &&
        (intent.serial===undefined || integer(intent.serial,0,Number.MAX_SAFE_INTEGER)) &&
        (intent.kind==='music-transition' ? known(intent.from) && known(intent.to) &&
          record(intent.layers ?? {}) && Object.entries(intent.layers ?? {}).every(([key,level])=>id(key) && finite(level,0,1)) :
          intent.kind==='music-layer' ? K.music.layerIntent(intent) && knowsLayer(intent) :
          intent.kind==='music-ambience' ? ambience && P.musicAmbience.validIntent(intent) && ambience.knows(intent) :
          intent.kind==='music-cue' && token(intent.resource ?? intent.cue)),
      'Invalid live adaptive score intent');
      check(intents.length<maxEvents,'Live adaptive event queue is full');
      const received=Math.max(frame,inputFrame(observedAt));
      const copy=P.data.clone(intent);
      if (observedInputs && comparisonInput!==undefined) observedInputs.set(copy,comparisonInput);
      intents.push({frame:Math.max(received,inputFrame(intent.time)),received,intent:copy,order:++order});
      intents.sort(ordered);
      profile.scheduled++;
    }
    function update(input) {
      check(machine,'Live score needs a control clock to accept world inputs');
      const result=machine.advance(control,input);
      check(intents.length+result.intents.length<=maxEvents,'Live adaptive event queue is full');
      check(result.intents.every(intent=>intent.kind!=='music-transition' || known(intent.from) && known(intent.to)),
        'Control clock emitted an unknown live score section');
      check(result.intents.every(intent=>intent.kind!=='music-layer' || knowsLayer(intent)),
        'Control clock emitted an unknown live score part or factor');
      for (const intent of result.intents) dispatch(intent);
      control=result.state;
      return machine.inspect(control);
    }
    function prefetch(ahead=streams.profile().pageSize*2,names=[]) {
      check(integer(ahead,1,rate*30) && Array.isArray(names) && names.every(name=>streams.streams.has(name)),
        'Invalid live PCM lookahead');
      const windows=voices.filter(row=>row.stream).map(row=>({source:row.stream,first:Math.max(0,frame-row.first),frames:ahead,active:true}));
      streams.prefetchStems(stemGroups,frame,ahead,windows);
      function prime(resource) {
        const source=streams.streams.get(resource);
        if (source) windows.push({source,first:0,frames:ahead});
      }
      function primeCue(intent) {
        const rule=scoring?.ruleFor(intent);
        if (!rule || rule.passThrough) prime(intent.resource ?? intent.cue);
        if (rule?.accent) prime(rule.accent.resource);
      }
      for (const row of intents) {
        if (row.frame>frame+ahead) break;
        if (row.intent.kind==='music-cue') primeCue(row.intent);
      }
      for (const intent of pending?.cues ?? []) primeCue(intent);
      for (const resource of scoring?.resources() ?? []) prime(resource);
      for (const name of names) prime(name);
      windows.sort((a,b)=>Number(b.source.foreground)-Number(a.source.foreground) || b.source.priority-a.source.priority);
      return streams.prefetch(windows);
    }
    const voiceRoster=()=>voices.map(voice=>({
      ...(voice.part!==undefined && {part:voice.part}), ...(voice.pitch!==undefined && {pitch:voice.pitch}),
      ...(voice.stream && {resource:voice.stream.name}), ...(voice.clip && {section:voice.clip.section,source:voice.clip.source}),
      firstSample:voice.first, ...(voice.trigger?.beatId && {beatId:voice.trigger.beatId}),
      ...(voice.trigger?.cue && {cue:voice.trigger.cue})
    }));
    function pull(count) {
      check(integer(count,1,16384),'Pull 1 to 16384 live audio frames');
      const firstFrame=frame,samples=new Float32Array(2*count);
      let peak=0,clipped=0,energy=0,blockVoices=0,roster,rosterSample=firstFrame,omittedGaps=0;
      const gaps=tracePerformance ? [] : null;
      function traceGap(gap,source) {
        if (!gaps) return;
        if (gaps.length===32) { omittedGaps++; return; }
        gaps.push({sample:frame,resource:gap.name,sourceSample:gap.frame,recovered:Boolean(gap.recovered),
          ...(source.trigger?.beatId && {beatId:source.trigger.beatId}),
          ...(source.part!==undefined && {part:source.part}),voices:voiceRoster()});
      }
      for (let i=0;i<count;i++,frame++) {
        step();
        if (voices.length>blockVoices) {
          blockVoices=voices.length;
          if (tracePerformance) { roster=voiceRoster(); rosterSample=frame; }
        }
        let l=0,r=0,sendL=0,sendR=0,foleyL=0,foleyR=0,foleySendL=0,foleySendR=0;
        for (const voice of voices) {
          const gap=voice.read(frame,pair);
          const gain=fadeAt(voice,frame)*voice.strength, vl=pair[0]*gain,vr=pair[1]*gain;
          if (hasBridges && voice.clip?.kind==='segment' && Math.max(Math.abs(vl),Math.abs(vr))>1e-6)
            voice.lastSound=frame;
          if(voice.motif||voice.recall){
            const level=layerGain(voice.part);
            if(voice.motif){
              const {clip,motif}=voice;
              if(clip.finished)voice.motif=null;
              else if(!level)motif.first=null;
              else if(Math.max(Math.abs(vl),Math.abs(vr))>1e-6){
                const first=motif.first??frame, local=playhead(clip)+(first-frame)/rate;
                versions.record(clip.source,clip.section,clip.id,motif.hits,first/rate,local,
                  local+Math.max(0,Math.min(voice.off,voice.last)-first)/rate);
                voice.motif=null;
              }
            }
            if(voice.recall&&level>0&&Math.max(Math.abs(vl),Math.abs(vr))>1e-6){
              Object.assign(voice.recall,{status:'played',firstFrame:frame});
              voice.recall=null;
            }
          }
          if (gap) {
            diagnostics.stream(voice,gap,frame,undefined,voice.trigger);
            if (tracePerformance) traceGap(gap,voice);
            if (!gap.recovered) {
              profile.streamGaps++;
              log('stream-underrun',{name:gap.name,sourceFrame:gap.frame});
            }
          }
          const lane=voice.lane;
          if (lane) {
            if (voice.unheard && layerGain(voice.part)>0) {
              const {from,gain,velocity}=voice.unheard;
              creditNote(voice,from,gain,velocity);
            }
            lane.l+=vl; lane.r+=vr;
            lane.until=frame+rate*.12;
          } else if (foleyRoom && !voice.scoreAccent) {
            foleyL+=vl; foleyR+=vr;
            foleySendL+=vl*voice.stream.send; foleySendR+=vr*voice.stream.send;
          } else {
            l+=vl; r+=vr;
            sendL+=vl*voice.stream.send; sendR+=vr*voice.stream.send;
          }
        }
        for (const group of stemGroups) {
          const position=group.position(frame);
          for (const stem of group.parts) {
            const gap=stem.read(position,pair);
            if (gap) {
              diagnostics.stream(stem,gap,frame,{group:group.name,part:stem.part});
              if (tracePerformance) traceGap(gap,stem);
              if (!gap.recovered) {
                profile.streamGaps++;
                log('stream-underrun',{name:gap.name,sourceFrame:gap.frame,group:group.name,
                  part:stem.part,positionFrame:position});
              }
            }
            const ambient=ambience?.process(stem.part,frame,pair);
            const gain=layerGain(stem.part);
            const left=pair[0]*gain, right=pair[1]*gain;
            if (ambient && foleyRoom) {
              foleyL+=left; foleyR+=right;
              foleySendL+=left*stem.source.send; foleySendR+=right*stem.source.send;
            } else {
              l+=left; r+=right;
              sendL+=left*stem.source.send; sendR+=right*stem.source.send;
            }
          }
        }
        for (const [key,lane] of desk) {
          if (frame>lane.until) {
            desk.delete(key);
            continue;
          }
          const {clip,strip,echo,track,part}=lane;
          const local=playhead(clip);
          strip.tick(lane.l,lane.r,frame,mixed,local,
            track.mix.duck ? recentNotes.get(clip.source+'/'+track.mix.duck.from+(clip.kind==='segment' ? '' : '/accent')) ?? null : null);
          lane.l=lane.r=0;
          const level=clip.kind==='segment'||clip.kind==='harmonic-bridge'?layerGain(part):1;
          const dryL=mixed[0]*level, dryR=mixed[1]*level;
          l+=dryL; r+=dryR;
          sendL+=dryL*mixed[2]; sendR+=dryR*mixed[2];
          if (echo) {
            echo.l+=dryL*mixed[3]; echo.r+=dryR*mixed[3];
            if (Math.max(Math.abs(echo.l),Math.abs(echo.r))>1e-7) {
              echo.until=frame+echo.tailFrames;
              echo.send=mixed[2];
            }
          }
        }
        for (const echo of echoes.values()) {
          if (frame>echo.until && Math.max(Math.abs(echo.l),Math.abs(echo.r))<=1e-7) {
            echo.tick=null;
            echo.l=echo.r=0;
            continue;
          }
          echo.tick ??= P.musicGestures.tapeEcho(echo.spec,rate);
          const wet=echo.tick(frame,echo.l,echo.r,1);
          echo.l=echo.r=0;
          l+=wet[0]; r+=wet[1];
          sendL+=wet[0]*echo.send; sendR+=wet[1]*echo.send;
        }
        const cut=Boolean(!active.finished && active.roomCut?.(playhead(active)));
        if (cut) roomLastInput=null;
        else if (Math.max(Math.abs(sendL),Math.abs(sendR))>1e-7) roomLastInput=frame;
        const wet=room(sendL,sendR,cut);
        if (foleyRoom) {
          const gain=scoring.level(frame), foleyWet=foleyRoom(foleySendL,foleySendR,false);
          l=((l+wet[0])*gain+foleyL+foleyWet[0])*scale;
          r=((r+wet[1])*gain+foleyR+foleyWet[1])*scale;
        } else {
          l=(l+wet[0])*scale; r=(r+wet[1])*scale;
        }
        samples[2*i]=l; samples[2*i+1]=r;
        const magnitude=Math.max(Math.abs(l),Math.abs(r));
        peak=Math.max(peak,magnitude);
        energy+=(l*l+r*r)*.5;
        clipped+=Number(magnitude>1);
      }
      profile.peak=Math.max(profile.peak,peak);
      profile.clippedFrames+=clipped;
      profile.blocks++;
      lastBlock={firstFrame,frames:count,peak,rms:Math.sqrt(energy/count),clippedFrames:clipped,peakVoices:blockVoices};
      return {samples,sampleRate:rate,channels:2,firstFrame,...(tracePerformance && {performance:{
        firstSample:firstFrame,endSample:frame,peakVoices:blockVoices,rosterSample,voices:roster ?? [],
        stems:stemGroups.flatMap(group=>group.parts.map(stem=>({group:group.name,part:stem.part,resource:stem.source.name}))),
        gaps,omittedGaps
      }})};
    }
    function inspect() {
      const layerGains={}, layerFactors={};
      const describe=row=>({gain:gainAt(row),target:row.target,startFrame:row.startFrame,endFrame:row.endFrame});
      for (const [part,{base,factors}] of layers) {
        if (base) layerGains[part]=describe(base);
        if (factors) {
          const target=[...factors.values()].reduce((gain,row)=>gain*row.target,base?.target ?? 1);
          layerFactors[part]={gain:layerGain(part),target,
            factors:Object.fromEntries([...factors].map(([name,row])=>[name,describe(row)]))};
        }
      }
      return P.data.clone({format:'ink-studio/music-live-report',version:1,sampleRate:rate,firstSample:0,endSample:frame,
        audioDiagnostics:diagnostics.inspect(frame),frame,time:time(),startTime,section:active.section,source:active.source,phrase:active.phrase,
        position:Math.min(active.segment.end,playhead(active)),
        pending:pending ? {to:pending.row.intent.to,frame:pending.at,rule:pending.row.intent.rule ?? null,
          ...(pending.switchPoint && {switchPoint:pending.switchPoint}),...(pending.cadence && {cadence:pending.cadence})} : null,
        clock:control ? machine.inspect(control) : null, heard:phrasing.counts(),
        ...(memory && {themes:memory.at(time())}),
        ...(versions&&{themeVersions:versions.inspect()}),
        ...(active.recall&&{recall:active.recall}),
        ...(Object.keys(layerGains).length && {layerGains}),
        ...(Object.keys(layerFactors).length && {layerFactors}),
        ...(scoring && {scoring:scoring.inspect(frame)}),
        ...(ambience && {ambienceGains:ambience.inspect(frame)}),
        ...(stemGroups.length && {stemGroups:Object.fromEntries(stemGroups.map(group=>[group.name,{
          frames:group.frames,phaseFrames:group.phaseFrames,positionFrame:group.position(frame),
          parts:Object.fromEntries(group.parts.map(({part,source,start})=>[part,{stream:source.name,startFrame:start}]))
        }]))}),
        profile:{...profile,activeVoices:voices.length,queued:intents.length,waiting:waiting.length,
          maxVoices,reservedVoices,stream:streams.profile(),lastBlock},joins,trace});
    }
    return Object.freeze({dispatch,update,prefetch,pull,inspect});
  }

  P.musicProduction=Object.freeze({...A,live:Object.freeze({open})});
})(KIT);
