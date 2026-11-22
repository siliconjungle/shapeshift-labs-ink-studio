/* An arranged cue with independent performance, instrumentation and mix. */
(function (P) {
  const C=P.musicComposer, H=P.musicHarmony, T=P.takeTime, I=P.musicInstruments, G=P.musicGestures,Q=P.musicCueMap;
  const N=P.musicNoteClips,R=P.performanceGroove;
  const {record,fields,finite,integer,id,check,clamp,db,hash}=I;
  const epsilon=1e-8;
  const number=(raw,key,fallback,low,high)=>{
    const value=raw[key] ?? fallback;
    check(finite(value,low,high),'Invalid production '+key);
    return value;
  };
  const round=value=>Number(value.toFixed(9));
  const json=value=>JSON.parse(JSON.stringify(value));
  const pc=value=>((value%12)+12)%12;
  function table(raw,max,label) {
    check(record(raw) && Object.keys(raw).length<=max && Object.keys(raw).every(id),'Invalid '+label+' table');
    return Object.entries(raw);
  }
  function groove(raw={}) {
    check(fields(raw,['step','timing','accents','offset']),'Invalid groove profile');
    const step=number(raw,'step',.25,.0625,4), offset=number(raw,'offset',0,-.1,.1);
    const {timing=[0],accents=[1]}=raw;
    check(Array.isArray(timing) && Array.isArray(accents) && [timing,accents].every(row=>row.length>=1 && row.length<=128) &&
      Array.from(timing).every(v=>finite(v,-.05,.05)) && Array.from(accents).every(v=>finite(v,0,2)),
      'Groove profiles need bounded timing and accent tables');
    return {step,timing:timing.slice(),accents:accents.slice(),offset};
  }
  function grooveAt(profile,beat) {
    const step=Math.floor((beat+epsilon)/profile.step);
    return {delay:profile.offset+profile.timing[step%profile.timing.length],
      accent:profile.accents[step%profile.accents.length]};
  }

  function pad(raw,sections) {
    check(fields(raw,['voices','low','high','anchor','spread','tie','rhythm','brightness',...(sections ? ['sections'] : [])]),
      'Invalid pad voicing');
    const {voices=3,low='A3',high='E5',anchor='C5',tie=true,rhythm}=raw;
    const min=H.midi(low), max=H.midi(high), top=H.midi(anchor);
    check(integer(voices,1,5) && max>=min && max-min<=48 && top>=min && top<=max &&
      typeof tie==='boolean' && (rhythm===undefined || fields(rhythm,['every','length','offset','velocity'])), 'Invalid pad register or rhythm');
    const spread=number(raw,'spread',0,0,.2);
    const pattern=rhythm && {every:number(rhythm,'every',2,.125,64),length:number(rhythm,'length',1.5,.05,64),
      offset:number(rhythm,'offset',0,0,64),velocity:number(rhythm,'velocity',.72,0,1)};
    check(!pattern || pattern.offset<pattern.every && pattern.length<=pattern.every,'Pad rhythm needs bounded pulses');
    const brightness=raw.brightness===undefined ? undefined : number(raw,'brightness',.5,0,1);
    const base={voices,min,max,top,spread,tie,pattern,brightness};
    if (!sections) return base;
    const {sections:overrides={},...defaults}=raw;
    return {...base,sections:Object.fromEntries(table(overrides,64,'pad section').map(([name,value])=>{
      check(sections.some(section=>section.id===name) && record(value),'Unknown pad section');
      return [name,pad({...defaults,...value})];
    }))};
  }

  function eventAt(events,time) {
    let hi=events.length, lo=0;
    while(lo<hi) {
      const mid=(lo+hi)>>>1;
      if (events[mid].time<=time+epsilon) lo=mid+1;
      else hi=mid;
    }
    return events[lo-1];
  }
  function voiceChord(config,spec,previous) {
    if (!spec) return previous;
    const {root,notes}=spec;
    const rootMidi=H.midi(root);
    const classes=[...new Set(notes.map(pc))];
    const candidates=[];
    for (let bottom=config.min;bottom<=config.max;bottom++) {
      if (!classes.includes(pc(bottom))) continue;
      const row=[bottom];
      for (let pitch=bottom+1;pitch<=config.max && row.length<config.voices;pitch++)
        if (classes.includes(pc(pitch))) row.push(pitch);
      if (row.length===config.voices) candidates.push(row);
    }
    check(candidates.length,'Pad register cannot fit its chord voicing');
    const cost=row=>Math.abs(row.at(-1)-config.top)*.65+
      (previous ? row.reduce((sum,n,i)=>sum+Math.abs(n-previous[i]),0)*.9 : 0)+
      (row.includes(rootMidi) || row.some(n=>pc(n)===pc(rootMidi)) ? 0 : 2.2);
    candidates.sort((a,b)=>cost(a)-cost(b));
    return candidates[0];
  }

  function scoreRows(plan,program,clock,name,voicing) {
    const part=plan.parts[name];
    const tag=new Map(plan.cues.filter(row=>row.part===name).map(row=>[row.beat,row]));
    let rows=part.voice.sequence.flatMap(note=>{
      const start=clock.timeAt({beat:note.beat}), end=clock.timeAt({beat:round(note.beat+note.duration)});
      const positions=note.offset===undefined && note.midi===undefined && !voicing ?
        [start,...program.events.filter(row=>row.time>start+epsilon && row.time<end-epsilon).map(row=>row.time),end] : [start,end];
      return positions.slice(0,-1).map((time,index)=>({beat:clock.sample(time).beat,time,end:positions[index+1],
        velocity:note.level ?? 1,play:tag.get(note.beat)?.play ?? {},...program.pitch(name,time)}));
    });
    if (!voicing) return rows;
    if (voicing.pattern || Object.values(voicing.sections).some(value=>value.pattern)) {
      const patterns=plan.sections.filter(section=>(voicing.sections[section.id] ?? voicing).pattern);
      rows=rows.flatMap(row=>{
        const kept=[];
        let at=row.time;
        for (const section of patterns) {
          if (section.endTime<=at || section.time>=row.end) continue;
          if (section.time>at) kept.push({...row,time:at,end:section.time});
          at=section.endTime;
        }
        if (at<row.end) kept.push({...row,time:at});
        return kept;
      });
      rows.push(...patterns.flatMap(section=>{
        if (!plan.materials[name].some(row=>row.section===section.id && (row.value || row.sustain))) return [];
        const {every,length,offset,velocity}=(voicing.sections[section.id] ?? voicing).pattern;
        const pulses=Math.max(0,Math.ceil((section.end-section.beat-offset)/every));
        check(pulses<=4096,'Pad pulses exceed their event budget');
        return Array.from({length:pulses},(_,index)=>{
          const beat=round(section.beat+offset+index*every);
          return {beat,time:clock.timeAt({beat}),end:clock.timeAt({beat:round(Math.min(beat+length,section.end))}),
            velocity,play:{}};
        });
      }));
      rows.sort((a,b)=>a.time-b.time);
    }
    const maxVoices=Math.max(voicing.voices,...Object.values(voicing.sections).map(value=>value.voices));
    check(rows.length*maxVoices<=16384,'Pad voicing exceeds its event budget');
    const result=[], active=[];
    let previous;
    const boundaries=[...new Set([...program.events.map(change=>change.time),...plan.sections.map(s=>s.time)])]
      .sort((a,b)=>a-b);
    for (const row of rows) {
      const changes=boundaries.filter(time=>time>row.time+epsilon && time<row.end-epsilon);
      const cues=[row.time,...changes,row.end];
      for (let index=0;index<cues.length-1;index++) {
        const at=cues[index], end=cues[index+1], harmony=eventAt(program.events,at);
        if (!harmony) continue;
        const section=plan.sections.findLast(section=>section.time<=at+epsilon);
        const settings=voicing.sections[section?.id] ?? voicing;
        const spec=plan.score.harmonies[harmony.harmony];
        const notes=spec.notes ? spec.notes.filter(note=>note!==null).map(H.midi) :
          H.chord(harmony.root,harmony.quality,spec.inversion);
        const pitches=voiceChord(settings,{root:harmony.root,notes:notes.length?notes:[H.midi(harmony.root)]},
          settings.voices===previous?.length ? previous : null);
        for (const [voice,midi] of pitches.entries()) {
          const last=active[voice];
          if (settings.tie && last?.midi===midi && Math.abs(last.end-at)<epsilon) {
            last.end=end;
            continue;
          }
          const time=at+settings.spread*voice;
          if (time>=end) continue;
          const play=settings.brightness===undefined ? row.play : {brightness:settings.brightness,...row.play};
          const entry={...row,time,end,midi,play,frequency:program.chordPitch(midi,at),
            beat:clock.sample(at).beat,voice};
          active[voice]=entry;
          result.push(entry);
        }
        previous=pitches;
      }
    }
    return result;
  }

  function compile(source,assets={},host) {
    check(fields(source,['arrangement','patches','tracks','room','gain','seed','cueMap','grooveMap']) &&
      Number.isSafeInteger(source.seed ?? 0), 'A production needs an arrangement, patches and tracks');
    const written=source.arrangement?.format==='ink-studio/phrase-arrangement' ?
      C.compose(source.arrangement.definition) : C.compose(source.arrangement);
    const clock=P.musicTiming.compile(written.score.tempoMap);
    const cue=source.cueMap===undefined ? null : Q.compile(source.cueMap,written,source.tracks,clock,source.seed ?? 0);
    const score=cue ? Q.harmonize(cue,written.score) : written.score;
    const plan=score===written.score ? written : P.data.freeze({...written,score});
    const program=P.musicScore.compile(plan.score);
    const assetMap=Object.fromEntries(table(assets,128,'instrument asset').map(([name,asset])=>{
      const audio=P.mediaGraph.audio(asset);
      check(audio.channels<=2 && audio.samples.length>0 && audio.samples.length/audio.channels/audio.sampleRate<=60,
        'Sample assets need up to two channels and sixty seconds');
      return [name,audio];
    }));
    check(Object.values(assetMap).reduce((sum,asset)=>sum+asset.samples.length,0)<=32e6,'Instrument samples exceed their budget');
    const patches=Object.fromEntries(table(source.patches,64,'patch').map(([name,patch])=>[name,G.patch(patch,assetMap)]));
    const gain=db(number(source,'gain',0,-48,12));
    const roomSpec=source.room ?? {};
    check(fields(roomSpec,['gain','size','decay','damping']),'Invalid production room');
    const room={gain:db(number(roomSpec,'gain',-10,-60,6)),size:number(roomSpec,'size',.8,.2,2),
      decay:number(roomSpec,'decay',.42,.05,2),damping:number(roomSpec,'damping',.65,0,1)};
    const tracks=Object.fromEntries(table(source.tracks,8,'production track').map(([name,raw])=>{
      check(name!=='room' && Object.hasOwn(plan.parts,name) &&
        fields(raw,['patch','gain','pan','highpass','lowpass','send','groove','pad','choke','duck','gestures','clips']) &&
        Object.hasOwn(patches,raw.patch) && (raw.choke===undefined || id(raw.choke)), 'Track needs a score part and an instrument patch');
      check(raw.clips===undefined || plan.parts[name].role!=='percussion' ||
        Array.isArray(raw.clips) && raw.clips.every(clip=>clip?.mode==='layer'),
      'Percussion tracks accept additive note clips');
      check(raw.duck===undefined || fields(raw.duck,['from','depth','release']),'Invalid ducking settings');
      const duck=raw.duck && {from:raw.duck.from,depth:number(raw.duck,'depth',4,0,18),
        release:number(raw.duck,'release',.1,.015,1)};
      check(!duck || Object.hasOwn(source.tracks,duck.from) && duck.from!==name,'Ducking needs a different production track');
      const mix={gain:db(number(raw,'gain',0,-60,18)), pan:number(raw,'pan',0,-1,1),
        highpass:number(raw,'highpass',0,0,4000),lowpass:number(raw,'lowpass',20000,80,24000),
        send:number(raw,'send',0,0,1),choke:raw.choke,duck};
      const patch=patches[raw.patch];
      return [name,{patch:raw.patch,play:patch.player,external:patch.external,performance:patch.performance,mix,echo:patch.echo,color:patch.color,
        gestures:G.score(raw.gestures,patch,plan,clock),
        clips:raw.clips===undefined ? null : N.rows(raw.clips,clock,program,plan.sections.at(-1).end),
        groove:groove(raw.groove),pad:raw.pad===undefined ? null : pad(raw.pad,plan.sections)}];
    }));
    check(Object.keys(tracks).length>0,'A production needs at least one track');
    const names=Object.keys(tracks), end=program.duration;
    const articulations=source.grooveMap?.ensemble && Object.fromEntries(names.map(name=>
      [name,I.articulationNames(source.patches[tracks[name].patch])]));
    const performance=source.grooveMap===undefined ? null : R.compile(source.grooveMap,plan,names,articulations);
    const ensemble=performance?.ensemble, events=Object.fromEntries(names.map(name=>[name,[]]));
    function prepare(name) {
      const track=tracks[name], scoreNotes=N.overlay(scoreRows(plan,program,clock,name,track.pad),track.clips,clock);
      const rows=cue ? Q.shape(cue,name,scoreNotes) : scoreNotes;
      const silence=cue?.perTrack[name].silence ?? [], cuts=cue?.perTrack[name].cuts ?? [];
      const silent=time=>silence.some(window=>time>=window.startTime-epsilon && time<window.endTime-epsilon);
      const drafts=[];
      for (const row of rows) {
        if (row.midi===null || !row.frequency || !row.velocity) continue;
        const beat=round(row.beat), beatStyle=grooveAt(track.groove,row.beat);
        const style=G.perform(track.gestures,row.beat,row.play,track.color), play=style.play;
        const inherited=performance?.style(name,play.articulation,beat,clock);
        const phrasing=ensemble?.style(name,beat,row.midi,clock);
        const authored=row.time+beatStyle.delay+(play.delay ?? 0)+(inherited?.delay ?? 0)+(phrasing?.delay ?? 0);
        const proposed=performance?.anchor(row.beat) ? row.time : Math.max(0,authored);
        const velocity=clamp(row.velocity*beatStyle.accent*style.accent*(inherited?.accent ?? 1)*(phrasing?.accent ?? 1));
        const audible=proposed<end && !silent(round(proposed)) && velocity>0;
        drafts.push({row,style,inherited,phrasing,authored,proposed,audible,velocity,adjustment:0});
      }
      return {drafts,silence,cuts,silent};
    }
    const prepared=ensemble && Object.fromEntries(names.map(name=>[name,prepare(name)]));
    const matches=ensemble?.couple(prepared,clock,performance.anchor), references={};
    let eventCount=0;
    for (const name of performance?.order ?? names) {
      const track=tracks[name], follow=performance?.driver(name,events,clock);
      const {drafts,silence,cuts,silent}=prepared ? prepared[name] : prepare(name);
      const next=(rows,time)=>rows.find(window=>window.startTime>time+epsilon);
      const notes=[], last=new Map(), lastNotes=new Map(), hits=[];
      for (const {row,style,inherited,phrasing,authored,velocity,adjustment} of drafts) {
        let play=phrasing?.articulation ? {...style.play,articulation:phrasing.articulation} : style.play;
        const proposed=authored+adjustment;
        const time=Math.max(0,performance?.anchor(row.beat) ? row.time : follow ? follow(proposed,row.beat) : proposed);
        const connection=round(time);
        if (silent(connection)) continue;
        const writtenGate=(row.end-row.time)*(row.ties ? 1 : play.gate ?? 1), length=inherited?.gate;
        let shapedGate=writtenGate+(length && !row.ties ? (length.target-writtenGate)*length.strength : 0);
        if (phrasing && !row.ties) {
          const takeGate=phrasing.gate;
          if (takeGate) shapedGate+=(takeGate.target-shapedGate)*takeGate.strength;
          shapedGate*=phrasing.length;
        }
        const gate=Math.max(.001,shapedGate);
        const voice=row.voice ?? 0, retrigger=row.ties ? 1 : play.retrigger ?? 1, fromFrequency=last.get(voice);
        const previous=lastNotes.get(voice);
        const connected=!track.performance && style.legato && velocity>0 && plan.parts[name].role!=='percussion' &&
          !track.pad && previous?.velocity>0 && connection<end && connection>previous.time+.005 &&
          connection-previous.time-previous.gate<=.14 &&
          (next(silence,previous.time)?.startTime ?? Infinity)>connection;
        if (connected) {
          previous.gate=connection-previous.time;
          previous.choke=Math.min(previous.choke ?? Infinity,connection+.012);
          if (play.glide===undefined) play={...play,glide:.05};
        }
        last.set(voice,row.frequency);
        for (let r=0;r<retrigger;r++) {
          const onset=round(time+r*gate/retrigger);
          if (onset>=end || silent(onset) ||
              (next(silence,connection)?.startTime ?? Infinity)<=onset) continue;
          const salt=hash([source.seed ?? 0,name,round(row.beat),voice,r]);
          const stop=next(silence,onset)?.startTime ?? Infinity;
          const note={part:name,beat:round(row.beat),time:onset,gate:Math.min(gate/retrigger,stop-onset),midi:row.midi,
            frequency:row.frequency,velocity,play,fromFrequency,salt,roundRobin:notes.length,
            ...(row.clip && {clip:row.clip,voice:row.voice,note:row.note,...(row.ties && {ties:row.ties})}),
            ...(track.performance && !row.clip && row.voice!==undefined && {voice:row.voice}),
            ...(style.gesture && {gesture:style.gesture}),...(connected && r===0 && {connected:true})};
          const cut=next(cuts,onset)?.startTime;
          if (cut!==undefined && (track.external || track.performance || onset+track.play.prepare(note,48000,note.gate).duration>cut))
            note.choke=cut;
          notes.push(note);
          if (r===0 && phrasing?.reference) hits.push({beat:note.beat,midi:note.midi,time:note.time,...phrasing.reference});
          lastNotes.set(voice,note);
          check(++eventCount<=32768,'Production exceeds its event budget');
        }
      }
      notes.sort((a,b)=>a.time-b.time);
      if (track.performance) P.musicPhrasing.apply(track.performance,notes,silence,plan.parts[name].role==='percussion');
      events[name]=notes;
      if (hits.length) references[name]=hits;
    }
    applyChokes(tracks,events);
    for (const name of names) if (tracks[name].performance) P.musicPhrasing.releases(events[name]);
    const locks=cue || performance ? Object.keys(C.locks(written)) : [];
    if (locks.length) {
      const {cueMap,grooveMap,...plain}=source, base=compile(plain,assets);
      for (const name of locks) {
        const moments=[...base.program.events,...program.events,...written.cues.filter(row=>row.part===name)];
        check(tracks[name] ? JSON.stringify(base.events[name])===JSON.stringify(events[name]) &&
          (!cue || cue.perTrack[name].room.every(row=>row.send.every(value=>value===tracks[name].mix.send)) &&
          !cue.perTrack[name].cuts.length && !cue.perTrack[name].tail.length && !cue.perTrack[name].depth.length &&
          [...cue.perTrack[name].level,...cue.perTrack[name].eq]
            .every(row=>row.gainDb===0)) :
          moments.every(row=>JSON.stringify(base.program.pitch(name,row.time))===JSON.stringify(program.pitch(name,row.time))),
        (cue ? 'Cue map or groove changes pinned part ' : 'Groove changes pinned part ')+name);
      }
    }
    let evidence;
    if (ensemble) {
      const onsets=Object.fromEntries(names.map(name=>[name,new Map(events[name].filter(note=>note.velocity>0).slice()
        .reverse().map(note=>[note.beat,note.time]))]));
      for (const match of matches) {
        const [a,b]=match.tracks.map((track,i)=>onsets[track].get(match.beats[i]));
        match.realizedSeconds=a===undefined || b===undefined ? null : round(b-a);
      }
      evidence={id:ensemble.id,matches,references};
    }
    return {arrangement:plan,events,end,program,clock,tracks,room,gain,cue,host,...(evidence && {ensemble:evidence})};
  }

  function applyChokes(tracks,events) {
    const chokeGroups=new Map();
    for (const [name,track] of Object.entries(tracks)) if (track.mix.choke) {
      const group=track.mix.choke, rows=chokeGroups.get(group) ?? [];
      rows.push(...events[name]);
      chokeGroups.set(group,rows);
    }
    for (const rows of chokeGroups.values()) {
      const onset=note=>note.start ?? note.time;
      rows.sort((a,b)=>onset(a)-onset(b));
      let next=Infinity;
      for (let i=rows.length-1;i>=0;i--) {
        const at=onset(rows[i]);
        if (rows[i+1] && onset(rows[i+1])>at) next=onset(rows[i+1]);
        if (next!==Infinity) rows[i].choke=Math.min(rows[i].choke ?? next,next);
      }
    }
  }

  function sampleAt(time,rate) {
    return T.index(T.roundDown(T.mul(T.read(time),[BigInt(rate),1n])));
  }
  const roomTimes=[.019,.029,.043,.057,.073,.097,.117,.149,.183,.211,.254,.287,.331,.383,.449];
  function roomTaps(room,rate) {
    return roomTimes.map((seconds,i)=>{
      const time=seconds*room.size;
      return {samples:Math.max(1,Math.round(time*rate)),
        gain:room.gain*Math.exp(-3*time/room.decay)*(i%3===1?-.31:.28), cross:i%2===0};
    });
  }
  const roomSmoothing=room=>.06+.39*(1-room.damping);
  function makeSessionRoom(room,rate) {
    const taps=roomTaps(room,rate), smoothing=roomSmoothing(room);
    const length=1+Math.max(...taps.map(row=>row.samples)), ring=new Float32Array(length*2);
    const state={index:0,history:0,left:0,right:0};
    const out=[0,0];
    return P.audioCheckpoint((inputL,inputR,cut)=>{
      let {index,history,left,right}=state;
      if (cut) {history=0; left=right=0;}
      let l=0,r=0;
      for (const tap of taps) {
        if (tap.samples>history) continue;
        const at=2*((index+length-tap.samples)%length);
        l+=ring[at+Number(tap.cross)]*tap.gain;
        r+=ring[at+Number(!tap.cross)]*tap.gain;
      }
      left+=(l-left)*smoothing; right+=(r-right)*smoothing;
      ring[2*index]=inputL; ring[2*index+1]=inputR;
      if (++index===length) index=0;
      if (!cut) history=Math.min(length,history+1);
      state.index=index; state.history=history; state.left=left; state.right=right;
      out[0]=left;out[1]=right;
      return out;
    },state,ring);
  }
  function prepareVoice(track,note,gateEnd,sampleRate,tails) {
    const start=note.start ?? note.time;
    const first=Math.ceil(start*sampleRate-1e-7);
    const gate=Math.min(note.gate,gateEnd-note.time)+note.time-start;
    const nativeGate=note.start===undefined ? Math.min(note.gate,gateEnd-note.time) : gate;
    const cropped=note.performance?.release && gateEnd<note.time+note.gate-1e-8;
    const sound=track.play.prepare(cropped ? {...note,suppressRelease:true} : note,sampleRate,nativeGate);
    const naturalEnd=Math.min(note.choke ?? Infinity,start+sound.duration);
    const shortened=tails?.length ? Q.tailLimit(tails,note.time+note.gate,naturalEnd) : null;
    const endTime=shortened?.stop ?? naturalEnd;
    const last=Math.ceil(endTime*sampleRate);
    const placementGain=note.renderGain ?? 1, entryFade=note.renderFade;
    return {first,last,write(data,from,to) {
      for (let at=first;at<Math.min(last,to);at++) {
        const t=Math.max(0,at/sampleRate-start);
        const remaining=endTime-at/sampleRate;
        const fade=shortened ? Math.sin(clamp(remaining/shortened.fade)*Math.PI/2) :
          note.choke!==endTime ? 1 : note.chokeFade ?
            Math.sin(clamp(remaining/note.chokeFade)*Math.PI/2) : clamp(remaining*250);
        const frame=at-first;
        const placement=entryFade ? placementGain*Math.sin(Math.PI*.5*
          clamp((at/sampleRate-entryFade.at)/entryFade.duration)) : placementGain;
        const left=sound.signal(t,frame,0)*fade*placement;
        data[2*(at-from)]+=left;
        data[2*(at-from)+1]+=sound.stereo ? sound.signal(t,frame,1)*fade*placement : left;
      }
    }};
  }
  function scoreStrip(music,name,sampleRate,{end=music.end,withEcho=false,layer=1}={}) {
    const track=music.tracks[name], local=music.cue?.perTrack[name];
    const desk=track.mix, panL=Math.sqrt((1-desk.pan)/2), panR=Math.sqrt((1+desk.pan)/2);
    const automation=G.automate(track.gestures,{gain:0,pan:desk.pan,cutoff:desk.lowpass,echo:track.echo?.send ?? 0},sampleRate);
    let echo=withEcho ? G.tapeEcho(track.echo,sampleRate) : null;
    const cut=Q.cursor(local?.cuts ?? []);
    const roomSend=Q.cursor(local?.room ?? []);
    const level=Q.cursor(local?.level ?? []);
    const eq=Q.equalizer(local?.eq ?? [],sampleRate), depth=Q.cursor(local?.depth ?? []);
    const coefficient=frequency=>1-Math.exp(-2*Math.PI*Math.min(sampleRate*.49,frequency)/sampleRate);
    const high=coefficient(desk.highpass), low=coefficient(desk.lowpass);
    const state={lowL:0,lowR:0,highL:0,highR:0,cutting:false,depthRow:null,farL:0,farR:0,farCutoff:1};
    let hit=0;
    const anchors=desk.duck && music.events[desk.duck.from].filter(note=>note.time<end);
    const gain=desk.gain*music.gain*layer;
    return {
      roomAutomation:Boolean(roomSend || depth), echoAutomation:Boolean(track.echo && automation),
      snapshot:()=>({state:{...state},eq:eq?.snapshot(),automation:automation?.snapshot()}),
      restore(snapshot) {
        Object.assign(state,snapshot.state);
        eq?.restore(snapshot.eq);
        automation?.restore(snapshot.automation);
      },
      tick(l,r,i,out) {
        const time=i/sampleRate;
        if (cut?.(time)) {
          if (!state.cutting) {
            state.cutting=true;
            state.lowL=state.lowR=state.highL=state.highR=0;
            eq?.reset();
            state.depthRow=null;
            if (withEcho) echo=G.tapeEcho(track.echo,sampleRate);
          }
          out[0]=out[1]=out[2]=out[3]=0;
          return;
        }
        state.cutting=false;
        const settings=automation?.(time), cutoff=settings ? coefficient(settings.cutoff) : low;
        let volume=gain;
        const ride=level?.(time);
        if (ride) {
          const edge=Math.min(time-(ride.fadeFrom ?? ride.startTime),(ride.fadeTo ?? ride.endTime)-time);
          volume*=db(ride.gainDb*(ride.fadeSeconds ? clamp(edge/ride.fadeSeconds) : 1));
        }
        state.highL+=(l-state.highL)*high; state.highR+=(r-state.highR)*high;
        state.lowL+=(l-state.highL-state.lowL)*cutoff; state.lowR+=(r-state.highR-state.lowR)*cutoff;
        if (anchors?.length) {
          while (hit+1<anchors.length && anchors[hit+1].time<=time) hit++;
          const dt=time-anchors[hit].time;
          if (dt>=0 && dt<6*desk.duck.release)
            volume*=db(-desk.duck.depth*anchors[hit].velocity*clamp(dt/.005)*Math.exp(-dt/desk.duck.release));
        }
        if (settings) {
          volume*=db(settings.gain);
          l=state.lowL*volume*Math.sqrt((1-settings.pan)/2);
          r=state.lowR*volume*Math.sqrt((1+settings.pan)/2);
        } else {
          l=state.lowL*volume*panL; r=state.lowR*volume*panR;
        }
        const shaped=eq?.tick(l,r,i,time);
        if (shaped) [l,r]=shaped;
        const space=depth?.(time);
        let amount=0;
        if (space) {
          const edge=Math.min(time-(space.fadeFrom ?? space.startTime),(space.fadeTo ?? space.endTime)-time);
          amount=space.fadeSeconds ? clamp(edge/space.fadeSeconds) : 1;
          if (space.cutoffHz!==undefined) {
            if (state.depthRow!==space.startTime) {
              state.depthRow=space.startTime;
              state.farL=l; state.farR=r; state.farCutoff=coefficient(space.cutoffHz);
            }
            state.farL+=(l-state.farL)*state.farCutoff; state.farR+=(r-state.farR)*state.farCutoff;
            l+=(state.farL-l)*amount; r+=(state.farR-r)*amount;
          }
        }
        if (echo) {
          const wet=echo(i,l,r,settings?.echo ?? track.echo.send);
          l+=wet[0]; r+=wet[1];
        }
        const span=roomSend?.(time);
        let send=span ? span.send[0]+(span.send[1]-span.send[0])*
          clamp((time-span.startTime)/(span.endTime-span.startTime)) : desk.send;
        if (space?.send!==undefined) send+=(space.send-send)*amount;
        out[0]=l; out[1]=r; out[2]=send; out[3]=settings?.echo ?? track.echo?.send ?? 0;
      }
    };
  }
  function renderCompiled(music,options={},sessionSource=false,performanceEnd) {
    check(fields(options,['start','end','sampleRate','stems','tail','layers']),'Invalid production render options');
    const {start:beginPoint=0,end:endPoint=music.end,sampleRate=48000,stems=false,tail=0,layers={}}=options;
    const start=T.seconds(T.read(beginPoint)),end=T.seconds(T.read(endPoint));
    check(finite(start,0,music.end) && finite(end,start,music.end) && end>start &&
      integer(sampleRate,8000,96000) && typeof stems==='boolean' && finite(tail,0,8), 'Invalid production export range');
    const begin=sampleAt(beginPoint,sampleRate), stop=sampleAt(tail ? end+tail : endPoint,sampleRate), n=stop-begin;
    const gateEnd=performanceEnd ?? end, names=Object.keys(music.tracks);
    check(record(layers) && Object.entries(layers).every(([name,level])=>names.includes(name) &&
      finite(level,0,1)), 'Invalid production layer levels');
    const stereoFrames=sessionSource ? stop+n*2 : stop*2+n*(stems ? names.length+2 : 1);
    check(n>0 && stereoFrames*2<=36e6 && stop*names.length<=48e6,'Production exceeds its sample budget');
    const buffers={}, mix=sessionSource ? null : new Float32Array(n*2), feed=sessionSource ? null : new Float32Array(stop*2);
    const data=new Float32Array(stop*2);
    const instruments={};
    const fadeDuration=tail ? 0 : music.arrangement.score.endFade ?? .09;
    for (const name of names) {
      const track=music.tracks[name], local=music.cue?.perTrack[name];
      const tails=local?.tail;
      data.fill(0);
      const onset=note=>note.start ?? note.time;
      const events=track.performance ? music.events[name].slice().sort((a,b)=>onset(a)-onset(b)) : music.events[name];
      if (track.external) {
        const rendered=P.musicClap.render(music,track.external,events,{end,gateEnd,stop,sampleRate,tails});
        data.set(rendered.pcm);
        instruments[name]=rendered.info;
      }
      for (const note of track.external ? [] : events) {
        if (onset(note)>=end) break;
        const voice=prepareVoice(track,note,gateEnd,sampleRate,tails);
        if (voice.first>=stop) break;
        voice.write(data,0,stop);
      }
      const strip=scoreStrip(music,name,sampleRate,{end,withEcho:!sessionSource,layer:layers[name] ?? 1});
      const dry=stems ? new Float32Array(n*2) : null;
      const roomLevel=sessionSource && strip.roomAutomation ? new Float32Array(n) : null;
      const echoLevel=sessionSource && strip.echoAutomation ? new Float32Array(n) : null;
      const out=[0,0,0,0];
      for (let i=0;i<stop;i++) {
        const index=i*2,time=i/sampleRate;
        strip.tick(data[index],data[index+1],i,out);
        const [l,r,send]=out;
        if (sessionSource) {
          const fade=fadeDuration ? clamp((music.end-time)/fadeDuration) : 1;
          dry[index]=l*fade; dry[index+1]=r*fade;
          if (roomLevel) roomLevel[i]=send;
          if (echoLevel) echoLevel[i]=out[3];
          continue;
        }
        feed[index]+=l*send; feed[index+1]+=r*send;
        if (i<begin) continue;
        const at=2*(i-begin);
        if (dry) { dry[at]=l; dry[at+1]=r; }
        mix[at]+=l; mix[at+1]+=r;
      }
      if (sessionSource) return {dry:{sampleRate,channels:2,samples:dry},roomLevel,echoLevel};
      if (dry) buffers[name]={sampleRate,channels:2,samples:dry};
    }
    const wet=stems ? new Float32Array(n*2) : null;
    let left=0,right=0;
    const taps=roomTaps(music.room,sampleRate), smoothing=roomSmoothing(music.room);
    const cutRoom=Q.cursor(music.cue?.roomCuts ?? []);
    let history=0;
    let peak=0,power=0,clipped=0;
    for (let i=0;i<stop;i++) {
      let l=0,r=0;
      if (cutRoom?.(i/sampleRate)) {
        history=i+1;
        left=right=0;
      }
      for (const tap of taps) {
        const at=(i-tap.samples)*2;
        if (at<history*2) continue;
        l+=feed[at+Number(tap.cross)]*tap.gain;
        r+=feed[at+Number(!tap.cross)]*tap.gain;
      }
      left+=(l-left)*smoothing; right+=(r-right)*smoothing;
      if (i<begin) continue;
      const at=2*(i-begin);
      const fade=fadeDuration ? clamp((music.end-i/sampleRate)/fadeDuration) : 1;
      if (wet) { wet[at]=left*fade; wet[at+1]=right*fade; }
      mix[at]=(mix[at]+left)*fade; mix[at+1]=(mix[at+1]+right)*fade;
      if (stems && fade<1) for (const name of names) {
        buffers[name].samples[at]*=fade;
        buffers[name].samples[at+1]*=fade;
      }
      const p=Math.max(Math.abs(mix[at]),Math.abs(mix[at+1]));
      peak=Math.max(peak,p); clipped+=Number(p>1);
      power+=mix[at]**2+mix[at+1]**2;
    }
    if (wet) buffers.room={sampleRate,channels:2,samples:wet};
    return {value:{sampleRate,channels:2,samples:mix},stems:buffers,
      report:{sampleRate,firstSample:begin,endSample:stop,peak,rms:Math.sqrt(power/(2*n)),clipped,...(Object.keys(instruments).length && {instruments})}};
  }

  function render(source,assets,options,host) {return renderCompiled(compile(source,assets,host),options);}
  function mapCue(source,map,assets) {
    const production={...source,cueMap:P.data.clone(map)}, music=compile(production,assets);
    return {production:P.data.freeze(P.data.clone(production)),report:Q.report(music)};
  }
  function mapGroove(source,map,assets) {
    const production={...source,grooveMap:P.data.clone(map)}, after=compile(production,assets);
    const {grooveMap,...plain}=source, before=compile(plain,assets);
    const identity=note=>JSON.stringify([note.beat,note.midi,note.voice ?? 0]);
    const tracks=Object.fromEntries(Object.entries(after.events).map(([name,rows])=>{
      const groups=new Map();
      for (const note of before.events[name]) {
        const key=identity(note);
        if (!groups.has(key)) groups.set(key,{rows:[],index:0});
        groups.get(key).rows.push(note);
      }
      let moved=0, accented=0, resized=0, matched=0, maxShift=0;
      for (const note of rows) {
        const group=groups.get(identity(note)), old=group && group.rows[group.index++];
        if (!old) continue;
        matched++;
        const shift=Math.abs(note.time-old.time);
        maxShift=Math.max(maxShift,shift);
        moved+=Number(shift>epsilon);
        accented+=Number(Math.abs(note.velocity-old.velocity)>epsilon);
        resized+=Number(Math.abs(note.gate-old.gate)>epsilon);
      }
      return [name,{notes:rows.length,moved,accented,resized,
        added:rows.length-matched,dropped:before.events[name].length-matched,maxShiftSeconds:round(maxShift)}];
    }));
    return {production:P.data.freeze(P.data.clone(production)),
      report:{id:map.template?.id ?? after.ensemble.id,anchors:map.anchors ?? [],links:map.links ?? [],tracks,
        ...(after.ensemble && {ensemble:after.ensemble})}};
  }
  function inspect(source,assets) {
    const compiled=compile(source,assets),{arrangement,events,end,tracks,cue,ensemble}=compiled;
    const gestures=Object.fromEntries(Object.entries(tracks).filter(([,track])=>track.gestures.length).map(([name,track])=>
      [name,track.gestures.map(({curves,mixers,...placement})=>placement)]));
    return P.data.freeze({arrangement,events:json(events),duration:end,
      ...(Object.keys(gestures).length && {gestures}),...(cue && {cueMap:Q.report(compiled)}),...(ensemble && {ensemble})});
  }
  function renderSessionSource(score,lane,sampleRate) {
    return renderCompiled({...score,tracks:{[lane]:score.tracks[lane]}},{sampleRate,stems:true},true);
  }
  P.musicProduction=Object.freeze({compile,renderCompiled,render,inspect,mapCue,mapGroove,grooveAt,applyChokes,
    renderSessionSource,makeSessionRoom,prepareVoice,scoreStrip});
})(KIT.procedural);
