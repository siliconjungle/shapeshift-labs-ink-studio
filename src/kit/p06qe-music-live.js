/* A causal adaptive score on the output sample clock. */
(function (K) {
  const P=K.procedural, A=P.musicProduction, F=P.musicPhraseRoutes;
  const {check,fields,record,finite,integer,id,clamp,db}=P.musicInstruments;
  const onset=F.onset, eps=1e-8;
  const ordered=(a,b)=>a.frame-b.frame || a.intent.time-b.intent.time ||
    Number(b.intent.kind==='music-transition')-Number(a.intent.kind==='music-transition') ||
    (a.intent.serial ?? 0)-(b.intent.serial ?? 0) || a.order-b.order;
  function boundedPush(rows,value,limit) {
    if (rows.length===limit) rows.shift();
    rows.push(value);
  }

  function open(sources,spec,options={}) {
    check(fields(options,['assets','sampleRate','maxVoices','reservedVoices','foreground','priorities','traceLimit',
      'maxEvents','streams','readPage','pageSize','maxPages','masterGain','clock','startTime']),
    'Invalid live score options');
    const {assets={},sampleRate:rate=48000,maxVoices=32,reservedVoices=Math.min(4,maxVoices-1),
      foreground=[],priorities={},traceLimit=128,maxEvents=512,masterGain=-3,startTime=0}=options;
    check(integer(rate,8000,96000) && integer(maxVoices,1,128) && integer(reservedVoices,0,maxVoices) &&
      integer(traceLimit,1,2048) && integer(maxEvents,1,4096) && finite(masterGain,-60,6) &&
      finite(startTime,0,1e9) && Array.isArray(foreground) && foreground.every(id) &&
      new Set(foreground).size===foreground.length && record(priorities) &&
      Object.entries(priorities).every(([name,priority])=>id(name) && integer(priority,-100,100)),
    'Invalid live score clock or voice limits');
    const streams=P.musicLiveStreams.open(rate,options.streams,options.readPage,options.pageSize,options.maxPages);
    const {compiled,segments,known,memory,routes,phrasing,stingers,holds,rules}=
      P.musicTimeline.prepare(sources,spec,assets,undefined,new Map(),streams.streams);
    const musicNames=[...new Set([...Object.values(segments).map(row=>row.source),
      ...Object.values(spec.thematic?.routes ?? {}).flat().map(row=>row.source),
      ...Object.values(spec.phrasing?.routes ?? {}).flat().map(row=>row.source)])];
    const persistent=spec.performers && P.musicPersistentPerformers.prepare(spec.performers,
      {sources,compiled,segments,entry:spec.entry,placements:musicNames.map(source=>({source,kind:'segment'}))});
    const carries=new Set(persistent?.names);
    const entrySource=compiled[segments[spec.entry].source];
    const room=A.makeSessionRoom(persistent?.room ?? entrySource.room,rate);
    check([...streams.streams.keys()].every(name=>!Object.hasOwn(stingers,name)),
      'A live cue resource must name either a score segment or a PCM stream');
    const machine=options.clock && K.music.create(options.clock);
    let control=machine?.initial(startTime);
    const initial=control && machine.inspect(control);
    check(!initial || initial.section===spec.entry && Object.keys(options.clock.sections).every(known),
      'Live score and world clock must share an entry and use authored sections');
    const time=()=>frame/rate, snap=seconds=>Math.round(seconds*rate), inputFrame=seconds=>snap(seconds-startTime);
    const fg=new Set(foreground), scale=db(masterGain), edgeFade=Math.max(2,Math.round(rate*.008));
    const desk=new Map(), echoes=new Map(), indexes=new Map(), recentNotes=new Map();
    const intents=[], accents=[], voices=[], waiting=[], trace=[], joins=[], via=[], outcomes=new Map();
    const pair=[0,0], mixed=[0,0,0,0];
    const profile={transitions:0,cancellations:0,lateEvents:0,lateFrames:0,scheduled:0,
      starts:0,foregroundStarts:0,dropped:0,foregroundDropped:0,stolen:0,choked:0,delayed:0,latePickups:0,
      streamGaps:0,peakVoices:0,peakClips:0,peak:0,clippedFrames:0,blocks:0};
    let frame=0, order=0, clipId=0, incomingRule=null, active, pending, newest, lastBlock=null, roomLastInput=null;
    const log=(kind,detail)=>boundedPush(trace,{kind,frame,time:time(),...detail},traceLimit);
    for (const [source,score] of Object.entries(compiled)) {
      const parts=Object.entries(score.tracks);
      const rows=parts.flatMap(([part,track],rank)=>{
        check(!track.external,'Live adaptive playback needs a native instrument on '+source+'/'+part);
        return score.events[part].map(note=>({part,track,note,at:onset(note),rank}));
      }).sort((a,b)=>a.at-b.at || a.rank-b.rank);
      indexes.set(source,rows);
    }
    function choose(section,reason) {
      const choices=routes.get(section), state=memory?.at(time());
      const match=choices?.find(({when})=>state[when.theme].counts[when.stage]>=(when.min ?? 1));
      const source=match?.source ?? segments[section].source;
      const selected=phrasing.choose(section,time(),source,via,incomingRule,reason);
      return {...selected,themeMatch:match?.when ?? null};
    }
    function begin(section,position,layers={},fadeIn=0,kind='segment',reason='entry') {
      const segment=segments[section];
      const selection=kind==='segment' ? choose(section,reason) : {source:segment.source,phrase:null};
      const notes=indexes.get(selection.source);
      let low=0,high=notes.length;
      while (low<high) {
        const mid=(low+high)>>>1;
        if (notes[mid].at<position-eps) low=mid+1;
        else high=mid;
      }
      const clip={id:++clipId,section,segment,...selection,first:frame,position,kind,notes,next:low,
        stop:frame+Math.max(1,snap(segment.end-position)),layers:{...segment.layers,...layers},fadeIn,spoke:false};
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
    function finish(clip,tail=0) {
      if (clip.finished) return;
      clip.finished=true;
      if (clip.kind==='segment' && clip.spoke && clip.position<=clip.segment.start+eps && frame>=clip.stop)
        phrasing.heardPhrase(clip.phrase,clip.section,clip.source,time());
      memory?.finish(clip.id,time());
      const end=frame+(tail ? snap(tail) : edgeFade);
      for (const voice of voices) if (voice.clip===clip && !voice.persistent) retire(voice,end);
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
        row={strip:A.scoreStrip(source,part,rate),echo,track,key,l:0,r:0,until:0};
        desk.set(key,row);
      }
      if (row.clip!==clip) {
        row.clip=clip;
        row.strip.resetClock();
      }
      return row;
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
        choke:track.mix.choke ? (persistent ? 'live/' : clip.source+'/')+track.mix.choke : null};
      if (!clip.listen || clip.listen.includes(part)) clip.spoke=true;
      memory?.add({source:clip.source,segment:clip.section,instance:clip.id,at:time(),from:note.time,
        to:note.time+3*eps,gain:row.renderGain,layers:clip.layers,note:{part,midi:note.midi}});
      recentNotes.set(lane.key,{time:time(),velocity:note.velocity});
      return voice;
    }
    function start(request) {
      const voice=request.stream ? {...streams.voice(request.stream,frame),stream:request.stream} : addNote(request);
      if (!voice) return 'silent';
      const choked=voice.choke ? voices.filter(row=>row.choke===voice.choke && row.first<frame && row.last>frame) : [];
      for (const row of choked) retire(row,frame+edgeFade);
      profile.choked+=choked.length;
      voices.push({...voice,foreground:request.foreground,priority:request.priority,strength:request.strength ?? 1,fadeEnd:Infinity});
      profile.starts++;
      profile.foregroundStarts+=Number(request.foreground);
      profile.peakVoices=Math.max(profile.peakVoices,voices.length);
      return 'played';
    }
    function dismiss(request,reason) {
      profile.dropped++;
      profile.foregroundDropped+=Number(request.foreground);
      log('voice-dropped',{part:request.event?.part ?? request.stream?.name,reason,foreground:request.foreground});
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
        if (event.at>=clip.segment.end-eps || clip.first+snap(event.at-clip.position)>frame) break;
        if (!event.note.velocity || !event.track.mix.gain || clip.layers[event.part]===0) continue;
        admit({clip,event,foreground:fg.has(event.part),priority:priorities[event.part] ?? 0});
      }
    }
    function accent(section,kind) {
      if (accents.length>=maxVoices) {
        log('accent-skipped',{section,reason:'clip-budget'});
        return null;
      }
      const clip=begin(section,segments[section].start,{},0,kind);
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
    function cue(intent) {
      const resource=intent.resource ?? intent.cue;
      if (intent.transition!==undefined) {
        if (pending?.row.intent.rule===intent.transition && pending.row.intent.time===intent.time) {
          if (pending.cues.length<maxEvents) pending.cues.push(intent);
          else log('cue-skipped',{resource,reason:'queue-budget'});
          return;
        }
        const destination=outcomes.get(linkKey(intent.time,intent.transition));
        if (destination!==active.section) {
          log('cue-skipped',{resource,reason:'transition-did-not-land',trigger:intent});
          return;
        }
      }
      const stream=streams.streams.get(resource), segment=Object.hasOwn(stingers,resource) ? stingers[resource] : null;
      const withheld=(segment || stream) && holds.some(row=>row.resource===resource &&
        row.section===active.section && (row.linked===undefined || row.linked===(intent.transition!==undefined)));
      if (withheld || (!stream && !segment)) {
        log('cue-skipped',{resource,reason:withheld ? 'withheld' : 'unmapped'});
        return;
      }
      const strength=intent.data?.strength;
      const status=segment ? (accent(segment,'stinger') ? 'scheduled' : 'dropped') :
        strength===0 ? 'silent' : admit({stream,foreground:stream.foreground,
          priority:stream.priority,strength:finite(strength,0,1) ? strength : 1});
      log('cue',{resource,section:active.section,trigger:intent,status});
    }
    function cancel(reason) {
      if (!pending) return;
      profile.cancellations++;
      linkOutcome(pending.row.intent,null);
      for (const accessory of pending.accessories) if (accessory.playing) finish(accessory.playing,.08);
      for (const intent of pending.cues)
        log('cue-skipped',{resource:intent.resource ?? intent.cue,reason:'transition-did-not-land',trigger:intent});
      log('transition-cancelled',{target:pending.row.intent.to,trigger:pending.row.intent,reason});
      pending=null;
    }
    function nextExit(edge) {
      if (!edge.waitForExit) return frame;
      const first=active.first+snap(edge.exit-active.position), period=snap(active.segment.end-active.segment.start);
      if (first>=frame) return first;
      if (active.parked || !active.segment.loop) return frame;
      // The first partial pass can enter after its exit marker. The next pass starts at the loop head.
      const next=active.stop+snap(edge.exit-active.segment.start);
      return next>=frame ? next : next+Math.ceil((frame-next)/period)*period;
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
      const edge=rules.get(section+'>'+target) ??
        {exit:segments[section].end,entry:segments[target].start,tail:0,fadeIn:0,pickup:0};
      const at=nextExit(edge);
      pending={row,edge,at,cues:[],accessories:[
        [edge.bridge,'bridge',edge.pickup],
        [edge.commonTone?.segment,'common-tone',edge.commonTone?.pickup ?? 0]
      ].filter(([clip])=>clip).map(([clip,kind,pickup])=>{
        const requested=at-snap(pickup);
        if (requested<frame) profile.latePickups++;
        return {clip,kind,at:Math.max(frame,requested)};
      })};
      log('transition-planned',{trigger:row.intent,from:section,to:target,exitFrame:at,exit:edge.exit,entry:edge.entry});
    }
    function commit() {
      for (const accessory of pending.accessories) if (accessory.at===frame)
        accessory.playing=accent(accessory.clip,accessory.kind);
      if (pending.at!==frame) return;
      const {row,edge,cues}=pending, {intent}=row, outgoing=active;
      finish(outgoing,edge.tail);
      const hearing={phrases:phrasing.counts(),
        ...(memory && {themes:memory.at(time())})};
      via.push(outgoing.section);
      if (via.length>8) via.shift();
      incomingRule=intent.rule ?? null;
      active=begin(intent.to,edge.entry,intent.layers ?? {},edge.fadeIn);
      const held=voices.filter(voice=>voice.persistent && voice.last>frame).map(voice=>({
        part:voice.part,pitch:voice.pitch,phaseFrames:frame-voice.first,gateEndFrame:voice.off,releaseEndFrame:voice.last,
        state:frame<voice.off ? 'held' : 'release'
      }));
      const detail={frame,time:time(),trigger:intent,arrivalFrame:row.received,latencyFrames:frame-inputFrame(intent.time),
        from:outgoing.section,to:active.section,via:via.slice(),
        exit:{source:outgoing.source,authored:edge.waitForExit ? edge.exit : null,
          played:Math.min(outgoing.segment.end,outgoing.position+(frame-outgoing.first)/rate),tail:edge.tail},
        entry:{source:active.source,offset:edge.entry,phrase:active.phrase,themeMatch:active.themeMatch,fadeIn:edge.fadeIn},
        heard:hearing,carry:{held,echoes:[...echoes].filter(([,echo])=>echo.until>frame).map(([key])=>key),
          room:true,roomLastInputFrame:roomLastInput,bridge:edge.bridge ?? null,commonTone:edge.commonTone ?? null}};
      profile.transitions++;
      boundedPush(joins,detail,traceLimit);
      log('transition',detail);
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
      if (active.segment.loop) active=begin(active.section,active.segment.start,active.layers,0,'segment','repeat');
      else active.parked=true;
    }
    function step() {
      for (let i=voices.length-1;i>=0;i--) if (voices[i].last<=frame) voices.splice(i,1);
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
        else (cues ??= []).push(row.intent);
      }
      if (pending) commit();
      if (frame===active.stop) finish(active);
      repeat();
      if (cues) for (const request of cues) cue(request);
      while (waiting[0]?.at<=frame) admit(waiting.shift(),false);
      playNotes(active);
      for (const clip of accents) playNotes(clip);
    }
    active=begin(spec.entry,segments[spec.entry].start,initial?.layers ?? {});
    profile.peakClips=1;

    const token=value=>typeof value==='string' && value.length>0 && value.length<=256;
    function dispatch(intent,{observedAt=startTime+time()}={}) {
      check(record(intent) && finite(intent.time,0,1e9) && finite(observedAt,startTime,1e9) &&
        (intent.serial===undefined || integer(intent.serial,0,Number.MAX_SAFE_INTEGER)) &&
        (intent.kind==='music-transition' ? known(intent.from) && known(intent.to) &&
          record(intent.layers ?? {}) && Object.entries(intent.layers ?? {}).every(([key,level])=>id(key) && finite(level,0,1)) :
          intent.kind==='music-cue' && token(intent.resource ?? intent.cue)),
      'Invalid live adaptive score intent');
      check(intents.length<maxEvents,'Live adaptive event queue is full');
      const received=Math.max(frame,inputFrame(observedAt));
      intents.push({frame:Math.max(received,inputFrame(intent.time)),received,intent:P.data.clone(intent),order:++order});
      intents.sort(ordered);
      profile.scheduled++;
    }
    function update(input) {
      check(machine,'Live score needs a control clock to accept world inputs');
      const result=machine.advance(control,input);
      check(intents.length+result.intents.length<=maxEvents,'Live adaptive event queue is full');
      check(result.intents.every(intent=>intent.kind!=='music-transition' || known(intent.from) && known(intent.to)),
        'Control clock emitted an unknown live score section');
      for (const intent of result.intents) dispatch(intent);
      control=result.state;
      return machine.inspect(control);
    }
    function prefetch(ahead=streams.profile().pageSize*2,names=[]) {
      check(integer(ahead,1,rate*30) && Array.isArray(names) && names.every(name=>streams.streams.has(name)),
        'Invalid live PCM lookahead');
      const windows=voices.filter(row=>row.stream).map(row=>({source:row.stream,first:Math.max(0,frame-row.first),frames:ahead,active:true}));
      for (const row of intents) {
        if (row.frame>frame+ahead) break;
        const source=streams.streams.get(row.intent.resource ?? row.intent.cue);
        if (source) windows.push({source,first:0,frames:ahead});
      }
      for (const intent of pending?.cues ?? []) {
        const source=streams.streams.get(intent.resource ?? intent.cue);
        if (source) windows.push({source,first:0,frames:ahead});
      }
      for (const name of names) windows.push({source:streams.streams.get(name),first:0,frames:ahead});
      windows.sort((a,b)=>Number(b.source.foreground)-Number(a.source.foreground) || b.source.priority-a.source.priority);
      return streams.prefetch(windows);
    }
    function pull(count) {
      check(integer(count,1,16384),'Pull 1 to 16384 live audio frames');
      const firstFrame=frame,samples=new Float32Array(2*count);
      let peak=0,clipped=0,energy=0,blockVoices=0;
      for (let i=0;i<count;i++,frame++) {
        step();
        blockVoices=Math.max(blockVoices,voices.length);
        let l=0,r=0,sendL=0,sendR=0;
        for (const voice of voices) {
          const gap=voice.read(frame,pair);
          const gain=fadeAt(voice,frame)*voice.strength, vl=pair[0]*gain,vr=pair[1]*gain;
          if (gap) {
            profile.streamGaps++;
            log('stream-underrun',gap);
          }
          const lane=voice.lane;
          if (lane) {
            lane.l+=vl; lane.r+=vr;
            lane.until=frame+rate*.12;
          } else {
            l+=vl; r+=vr;
            sendL+=vl*voice.stream.send; sendR+=vr*voice.stream.send;
          }
        }
        for (const [key,lane] of desk) {
          if (frame>lane.until) {
            desk.delete(key);
            continue;
          }
          const {clip,strip,echo,track}=lane;
          const local=clip.position+(frame-clip.first)/rate;
          strip.tick(lane.l,lane.r,frame,mixed,local,
            track.mix.duck ? recentNotes.get(clip.source+'/'+track.mix.duck.from+(clip.kind==='segment' ? '' : '/accent')) ?? null : null);
          lane.l=lane.r=0;
          l+=mixed[0]; r+=mixed[1];
          sendL+=mixed[0]*mixed[2]; sendR+=mixed[1]*mixed[2];
          if (echo) {
            echo.l+=mixed[0]*mixed[3]; echo.r+=mixed[1]*mixed[3];
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
        const cut=Boolean(!active.finished && active.roomCut?.(active.position+(frame-active.first)/rate));
        if (cut) roomLastInput=null;
        else if (Math.max(Math.abs(sendL),Math.abs(sendR))>1e-7) roomLastInput=frame;
        const wet=room(sendL,sendR,cut);
        l=(l+wet[0])*scale; r=(r+wet[1])*scale;
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
      return {samples,sampleRate:rate,channels:2,firstFrame};
    }
    function inspect() {
      return P.data.clone({frame,time:time(),startTime,section:active.section,source:active.source,phrase:active.phrase,
        position:Math.min(active.segment.end,active.position+(frame-active.first)/rate),
        pending:pending ? {to:pending.row.intent.to,frame:pending.at,rule:pending.row.intent.rule ?? null} : null,
        clock:control ? machine.inspect(control) : null, heard:phrasing.counts(),
        ...(memory && {themes:memory.at(time())}),
        profile:{...profile,activeVoices:voices.length,queued:intents.length,waiting:waiting.length,
          maxVoices,reservedVoices,stream:streams.profile(),lastBlock},joins,trace});
    }
    return Object.freeze({dispatch,update,prefetch,pull,inspect});
  }

  P.musicProduction=Object.freeze({...A,live:Object.freeze({open})});
})(KIT);
