/* Launch finite note patterns on a continuous session clock and capture the played form. */
(function (P) {
  const M=P.mediaGraph,S=P.mediaGraphSupport,I=P.musicInstruments;
  const {check,fields,id,integer,finite,record}=I, {clone}=P.data;
  const own=(table,name)=>Object.hasOwn(table ?? {},name) ? table[name] : undefined;
  const unique=(table,prefix)=>{
    let name=prefix,n=1;
    while (Object.hasOwn(table,name)) name=prefix+'-'+(++n);
    return name;
  };
  const samplePosition=frame=>({samples:frame});

  function bankFor(source,raw) {
    check(fields(raw,['id','bars','quantize','clips','initial']) && id(raw.id ?? source.id) &&
      integer(raw.bars ?? 16,1,32) && ['beat','bar'].includes(raw.quantize ?? 'beat') &&
      record(raw.clips ?? {}) && record(raw.initial ?? {}),'Invalid clip jam bank');
    const {production}=source, authored=production.arrangement.definition ?? production.arrangement;
    const map={...authored.score.tempoMap,origin:0}, meter=map.beatsPerBar ?? 4, bars=raw.bars ?? 16;
    check(bars*meter<=256,'Choose a jam length of up to 256 beats');
    const supplied=raw.clips ?? Object.fromEntries(Object.entries(production.tracks)
      .filter(([,row])=>row.clips?.length).map(([lane,row])=>[lane,row.clips]));
    const banks=Object.fromEntries(Object.entries(supplied).map(([lane,rows])=>{
      const track=own(production.tracks,lane);
      check(track && production.patches[track.patch]?.type!=='clap' && Array.isArray(rows) &&
        integer(rows.length,1,16),'A jam lane needs a native score track and up to sixteen clips');
      const slots=rows.map(raw=>{
        const slot=P.musicNoteClips.clip({...raw,beat:0});
        check(slot.voices.every(voice=>!voice.notes[0]?.tie),'A launch clip needs its own first attack');
        return {...slot,length:slot.loopBeats ?? slot.length};
      });
      check(new Set(slots.map(row=>row.id)).size===slots.length,'Clip slot names must be unique on each track');
      return [lane,slots];
    }));
    check(Object.keys(banks).length>0 && Object.entries(raw.initial ?? {}).every(([lane,clip])=>
      own(banks,lane)?.some(row=>row.id===clip)), 'Choose at least one launch clip and valid initial slots');

    // The recorded pass starts a new score with the original clock, sounds and desk.
    const {key,harmonies,tuning,referenceHz}=authored.score;
    const harmony=authored.sections.find(row=>row.harmony)?.harmony ?? Object.keys(harmonies ?? {})[0];
    const score={tempoMap:map,endFade:0,...(key!==undefined && {key}),...(harmonies!==undefined && {harmonies}),
      ...(tuning!==undefined && {tuning}),...(referenceHz!==undefined && {referenceHz})};
    const parts=Object.fromEntries(Object.entries(authored.parts).map(([name,{material,...part}])=>[name,part]));
    const sections=[{id:'jam',bars,...(harmony && {harmony})}];
    const tracks=Object.fromEntries(Object.entries(production.tracks).map(([name,{clips,pad,phrases,gestures,groove,...track}])=>
      [name,{...track,send:0,clips:[]}]));
    const {patches,room,gain,seed}=production;
    const mixer=clone(source.mixer ?? {output:'master',strips:{master:{}}});
    mixer.processors ??= {};
    for (const lane of Object.keys(source.audio ?? {})) mixer.strips[lane] ??= {};
    const time=S.mixerTime(source.sampleRate,map);
    const automation=Object.values(source.automation ?? {});
    function initial(strip,send,parameter,fallback,max) {
      const authored=automation.find(row=>row.target.strip===strip && row.target.send===send && row.target.parameter===parameter);
      const existing=send ? mixer.strips[strip].sends[send].level : mixer.strips[strip][parameter];
      const lane=authored && {...authored,points:authored.points.map(({at,value})=>({at,value}))};
      if (lane) delete lane.target;
      return time.lane(lane ?? existing,fallback,0,max,parameter).reader()(0);
    }
    let returnBus;
    for (const lane of Object.keys(banks)) {
      const strip=mixer.strips[lane] ??= {};
      strip.inputGain=initial(lane,undefined,'inputGain',1,1);
      const sends=strip.sends ??= {};
      for (const to of Object.keys(sends)) sends[to].level=initial(lane,to,'level',1,2);
      if (!Object.keys(sends).length || production.tracks[lane].send>0) {
        if (!returnBus) {
          returnBus=unique(mixer.strips,'jam-room');
          const effect=unique(mixer.processors,'jam-room');
          mixer.processors[effect]={type:'reverb',size:Math.max(.3,room?.size ?? .9),
            decay:room?.decay ?? 1.15,damping:room?.damping ?? .62,wet:1};
          mixer.strips[returnBus]={inserts:[effect],fader:Math.min(1,10**((room?.gain ?? -12)/20))};
        }
        sends[returnBus]={level:production.tracks[lane].send ?? 0};
      }
    }
    const session={format:'ink-studio/music-edit-session',version:1,id:raw.id ?? source.id,sampleRate:source.sampleRate,
      production:{arrangement:{score,parts,sections,motifs:{}},patches,tracks,
        ...(room!==undefined && {room}),...(gain!==undefined && {gain}),...(seed!==undefined && {seed})},mixer};
    return {banks,bars,meter,map,time,session,initial:raw.initial ?? {},quantize:raw.quantize ?? 'beat'};
  }

  function valueAt(points,frame) {
    let lo=0,hi=points.length;
    while (lo+1<hi) {
      const index=(lo+hi)>>>1;
      if (points[index].at<=frame) lo=index;
      else hi=index;
    }
    const a=points[lo],b=points[lo+1];
    return b ? a.value+(b.value-a.value)*(frame-a.at)/(b.at-a.at) : a.value;
  }

  function open(editor,input,settings={}) {
    const {banks,bars,meter,time,session,initial,quantize}=bankFor(clone(input),settings);
    const rate=session.sampleRate, clock=time.beatClock(), endBeat=bars*meter;
    const atBeat=beat=>time.frame(time.position({beat})), maxFrames=atBeat(endBeat);
    const grid=Array.from({length:endBeat+1},(_,beat)=>atBeat(beat));
    let timeline=Object.fromEntries(Object.keys(banks).map(lane=>[lane,
      initial[lane] ? [{beat:0,frame:0,clip:initial[lane]}] : []]));
    let stop={beat:endBeat,frame:maxFrames}, finishing=false, done=false;
    const controls=new Map();
    const named=(lane,clip)=>own(banks,lane)?.find(row=>row.id===clip);
    const desktop=()=>session.mixer.strips;
    const readControl=(key,frame,base)=>{
      const row=controls.get(key);
      return row ? valueAt(row.points,frame) : base;
    };

    function score(schedule,until=endBeat,recorded=false) {
      const production=clone(session.production), arrangement=production.arrangement;
      if (recorded) arrangement.sections[0].bars=until/meter;
      for (const [lane,events] of Object.entries(schedule)) {
        const percussion=arrangement.parts[lane].role==='percussion';
        production.tracks[lane].clips=events.flatMap(({beat,clip},index)=>{
          if (!clip || beat>=until) return [];
          const stop=Math.min(until,events[index+1]?.beat ?? until), slot=named(lane,clip);
          return [{id:'b'+beat+'-'+slot.id.slice(0,39),beat,length:stop-beat,loopBeats:slot.length,voices:slot.voices,
            ...(percussion && {mode:'layer'}),timing:'played'}];
        });
      }
      const result={...session,production};
      if (recorded && controls.size) result.automation=Object.fromEntries([...controls.values()].map(({target,points},i)=>{
        const end=atBeat(until), knots=points.filter(row=>row.at<end);
        if (points.at(-1).at>=end) knots.push({at:end,value:valueAt(points,end)});
        return ['jam-control-'+(i+1),{target,unit:'samples',curve:'linear',
          points:knots.map((row,i)=>({id:'point-'+(i+1),...row}))}];
      }));
      return result;
    }

    const transport=editor.openPreparedTransport(editor.prepareLive(score(timeline)),
      {from:samplePosition(0),to:samplePosition(maxFrames),preroll:false},readControl);
    const head=()=>transport.state().frame;
    function boundary(frame,unit,min=0) {
      const step=unit==='bar' ? meter : 1;
      let beat=Math.max(min,Math.floor(clock.beatAt(frame)/step)*step);
      while (beat<endBeat && grid[beat]<frame) beat+=step;
      return {beat,frame:grid[beat]};
    }

    function launch({launches,quantize:unit=quantize}) {
      check(!done && Array.isArray(launches) && integer(launches.length,1,Object.keys(banks).length) &&
        ['beat','bar'].includes(unit) && new Set(launches.map(row=>row?.lane)).size===launches.length,
      'Choose a unique track per launch and a beat or bar boundary');
      const now=head(), target=boundary(now,unit);
      check(target.frame<stop.frame,'This pass has reached its last launch boundary');
      const next={...timeline};
      for (const row of launches) {
        check(fields(row,['lane','clip']) && own(banks,row.lane) &&
          (row.clip===null || named(row.lane,row.clip)),'Choose a clip slot or stop on a jam track');
        next[row.lane]=[...timeline[row.lane].filter(event=>event.frame<now),{...target,clip:row.clip}];
      }
      transport.applyPrepared(editor.prepareLive(score(next,stop.beat)));
      timeline=next;
      return target;
    }

    function move(row) {
      check(!done && fields(row,['lane','send','value','muted']) && own(banks,row.lane),
        'Choose a control on an active jam track');
      const {lane,send}=row, strip=desktop()[lane], now=head();
      const mute=send===undefined;
      check(mute ? typeof row.muted==='boolean' && row.value===undefined :
        own(strip.sends,send) && finite(row.value,0,2) && row.muted===undefined,'Choose mute or a send level');
      const key=mute ? lane : lane+'/'+send;
      const target=mute ? {strip:lane,parameter:'inputGain'} : {strip:lane,send,parameter:'level'};
      const base=mute ? strip.inputGain : strip.sends[send].level;
      const value=mute ? row.muted ? 0 : base || 1 : row.value;
      const prior=controls.get(key)?.points ?? [{at:0,value:base}];
      const current=valueAt(prior,now), points=prior.filter(point=>point.at<now);
      if (Math.abs(current-value)<1e-9 && prior.at(-1).value===value) return {frame:now,value};
      // Replace the unplayed part of a gesture if a new slider value arrives mid-ramp.
      if (points.at(-1)?.value!==current || points.length<2 || points.at(-2).value!==current)
        points.push({at:now,value:current});
      else points[points.length-1]={at:now,value:current};
      const end=Math.min(stop.frame,now+Math.round(rate*(mute ? .008 : .045)));
      check(points.length<2047 && end>now,'This control has reached the pass automation limit');
      points.push({at:end,value});
      controls.set(key,{target,points});
      return {frame:now,value};
    }

    function finish() {
      if (done || finishing) return {...stop};
      const target=boundary(head(),'bar',meter);
      transport.applyPrepared(editor.prepareLive(score(timeline,target.beat)));
      stop=target;
      finishing=true;
      if (head()>=stop.frame) done=true;
      return {...stop};
    }
    function pull(frames,options={}) {
      check(integer(frames,1,16384),'A jam audio pull needs 1 to 16384 frames');
      const first=head(), count=Math.min(frames,stop.frame-first);
      const start={frame:first,scoreSample:first,pass:0,loop:{from:0,to:stop.frame}};
      const result=count ? transport.pull(count,options) : undefined;
      if (head()>=stop.frame) done=true;
      const value=result?.value ?? {sampleRate:rate,channels:2,samples:new Float32Array(0)};
      return {value,taps:result?.taps ?? {},start,clippedFrames:result?.clippedFrames ?? transport.state().clippedFrames,done};
    }
    function state() {
      const frame=head(), beat=frame===stop.frame ? stop.beat : clock.beatAt(frame), lanes={};
      for (const [lane,slots] of Object.entries(banks)) {
        const strip=desktop()[lane], events=timeline[lane];
        lanes[lane]={slots:slots.map(({id,length})=>({id,length})),
          active:events.findLast(row=>row.frame<=frame)?.clip ?? null,
          pending:events.find(row=>row.frame>frame && row.frame<stop.frame) ?? null,
          muted:(controls.get(lane)?.points.at(-1).value ?? strip.inputGain)===0,
          sends:Object.fromEntries(Object.entries(strip.sends).map(([to,row])=>
            [to,controls.get(lane+'/'+to)?.points.at(-1).value ?? row.level]))};
      }
      return {id:session.id,sampleRate:rate,frame,beat,meter,beatSamples:grid,quantize,bars,stop,finishing,done,lanes};
    }
    function arrangement() {
      check(done,'Finish the pass before saving the arrangement');
      return score(timeline,stop.beat,true);
    }
    return Object.freeze({state,pull,launch,move,finish,arrangement});
  }

  M.musicSessionJam=Object.freeze({open});
})(KIT.procedural);
