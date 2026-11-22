/* Cue-wide arrangement lanes share the existing beat clock and production render. */
(function (P) {
  const {fields,record,finite,integer,id,check,hash}=P.musicInstruments;
  const eps=1e-8, round=n=>Number(n.toFixed(9));
  const names=['density','register','harmony','silence','room','level','eq','tail','depth'];
  const fieldsFor={density:['parts','value','keep'],register:['parts','semitones'],
    harmony:['chords','every'],silence:['parts','mode'],room:['parts','send'],level:['parts','gainDb','fadeSeconds'],eq:['parts','hz','q','gainDb','fadeSeconds'],
    tail:['parts','seconds','fadeSeconds'],depth:['parts','cutoffHz','send','fadeSeconds']};
  const byStart=(a,b)=>a.from-b.from;
  function list(raw,max,label) {
    check(Array.isArray(raw) && raw.length<=max,'Invalid cue '+label+' list');
    return raw;
  }
  function unique(rows,label) {
    check(new Set(rows.map(row=>row.id)).size===rows.length,'Cue '+label+' IDs must be unique');
    return rows;
  }

  function compile(spec,plan,tracks,clock,seed) {
    check(fields(spec,['groups','landmarks','foreground',...names]) && record(tracks),'Invalid cue map');
    const beats=plan.sections.at(-1).end, time=beat=>clock.timeAt({beat:round(beat)});
    const trackNames=Object.keys(tracks);
    const pitched=trackNames.filter(name=>plan.parts[name] && plan.parts[name].role!=='percussion');
    const text=raw=>raw===undefined || typeof raw==='string' && raw.trim() && raw.length<=160;
    function window(row) {
      check(finite(row.from,0,beats) && finite(row.to,row.from+1e-5,beats),'Cue ranges need increasing beats inside the cue');
      return {...row,startTime:time(row.from),endTime:time(row.to)};
    }
    function scope(raw,available=trackNames) {
      if (raw===undefined) return available;
      check(Array.isArray(raw) && raw.length && new Set(raw).size===raw.length &&
        Array.from(raw).every(part=>available.includes(part)),'Cue lane needs distinct applicable production tracks');
      return raw.slice();
    }
    const groups=unique(Array.from(list(spec.groups ?? [],128,'group'),row=>{
      check(fields(row,['id','label','parent','from','to']) && id(row.id) && text(row.label) &&
        (row.parent===undefined || id(row.parent)),'Invalid cue group');
      return window(row);
    }),'group').sort(byStart);
    const groupIndex=new Map(groups.map(row=>[row.id,row]));
    for (const group of groups) if (group.parent!==undefined) {
      const parent=groupIndex.get(group.parent);
      check(parent && group.from>=parent.from && group.to<=parent.to &&
        (group.from>parent.from || group.to<parent.to),'A cue group must fit strictly inside its parent');
    }
    const landmarks=unique(Array.from(list(spec.landmarks ?? [],256,'landmark'),row=>{
      check(fields(row,['id','beat','kind','label','parts']) && id(row.id) && id(row.kind) &&
        text(row.label) && finite(row.beat,0,beats),'Invalid cue landmark');
      return {...row,...(row.parts!==undefined && {parts:scope(row.parts)}),time:time(row.beat),
        groups:groups.filter(span=>row.beat>=span.from && row.beat<span.to).map(span=>span.id)};
    }),'landmark').sort((a,b)=>a.beat-b.beat);
    const foreground=unique(Array.from(list(spec.foreground ?? [],128,'foreground'),raw=>{
      check(fields(raw,['id','label','from','to','parts','protect']) && id(raw.id) && text(raw.label) &&
        Array.isArray(raw.parts) && raw.parts.length>0,'A foreground needs a name, beat range and playable parts');
      const row=window(raw), parts=scope(raw.parts);
      const protect=raw.protect===undefined || Array.isArray(raw.protect) && !raw.protect.length ? [] : scope(raw.protect);
      check(protect.every(part=>!parts.includes(part)),'Foreground and protected parts must be distinct');
      return {...row,parts,protect};
    }),'foreground').sort(byStart);
    const lanes=Object.fromEntries(names.map(key=>[key,Array.from(list(spec[key] ?? [],128,key),raw=>{
      check(fields(raw,['from','to',...fieldsFor[key]]),'Invalid cue '+key+' range');
      const row=window(raw);
      if (key==='harmony') {
        check(Array.isArray(raw.chords) && integer(raw.chords.length,1,32) && Array.from(raw.chords)
          .every(chord=>id(chord) && Object.hasOwn(plan.score.harmonies,chord)) &&
          finite(raw.every,.125,64),'Cue harmony needs known chords and a beat interval');
        return row;
      }
      row.parts=scope(raw.parts,key==='register' ? pitched : trackNames);
      if (key==='density') {
        const keep=raw.keep ?? [];
        check(finite(raw.value,0,1) && Array.from(list(keep,128,'protected beat')).every(n=>
          finite(n,row.from,row.to) && n<row.to),'Invalid cue density or protected beat');
        row.keep=keep.slice();
      }
      if (key==='register') check(integer(raw.semitones,-48,48),'Cue register needs an integer semitone offset');
      if (key==='silence') {
        check(['ring','cut'].includes(raw.mode ?? 'ring'),'Cue silence must ring or cut');
        row.mode=raw.mode ?? 'ring';
      }
      if (key==='room') {
        const values=Array.isArray(raw.send) ? Array.from(raw.send) : [raw.send,raw.send];
        check(values.length===2 && values.every(value=>finite(value,0,1)),'Cue room needs a send level or pair of levels');
        row.send=values;
      }
      if (key==='tail') {
        check(finite(raw.seconds,.005,8) && finite(raw.fadeSeconds ?? .025,.001,1),'Cue tail needs a release cap and fade in seconds');
        row.fadeSeconds=Math.min(raw.fadeSeconds ?? .025,row.seconds);
      }
      if (key==='depth') {
        check((raw.cutoffHz!==undefined || raw.send!==undefined) &&
          finite(raw.cutoffHz ?? 24000,100,24000) && finite(raw.send ?? 0,0,1) &&
          finite(raw.fadeSeconds ?? .06,0,2),'Cue depth needs a cutoff or room send and an optional fade');
        row.fadeSeconds=Math.min(raw.fadeSeconds ?? .06,(row.endTime-row.startTime)*.5);
      }
      if (key==='level' || key==='eq') {
        const fade=raw.fadeSeconds ?? .02;
        check(finite(fade,0,2) && (key==='level' ? finite(raw.gainDb,-60,18) :
          finite(raw.hz,20,24000) && finite(raw.q ?? 1,.35,12) && finite(raw.gainDb,-24,24)),
        'Invalid cue '+key+' gain, fade or band');
        row.fadeSeconds=Math.min(fade,(row.endTime-row.startTime)*.5);
      }
      return row;
    }).sort(byStart)]));
    const disjoint=(rows,key)=>check(rows.every((row,i)=>i===0 || row.from>=rows[i-1].to),
      'Cue '+key+' windows overlap on the same track');
    disjoint(lanes.harmony,'harmony');
    disjoint(foreground,'foreground');
    const perTrack=Object.fromEntries(trackNames.map(name=>{
      const local=Object.fromEntries(names.filter(key=>key!=='harmony').map(key=>{
        const rows=lanes[key].filter(row=>row.parts.includes(name));
        disjoint(rows,key);
        return [key,rows];
      }));
      return [name,{...local,cuts:local.silence.filter(row=>row.mode==='cut')}];
    }));
    // The shared room is cleared when every contributing track is in a hard cut.
    const cutEdges=[...new Set(trackNames.flatMap(name=>perTrack[name].cuts.flatMap(row=>[row.startTime,row.endTime])))]
      .sort((a,b)=>a-b);
    const roomCuts=cutEdges.slice(0,-1).flatMap((startTime,i)=>trackNames.every(name=>
      perTrack[name].cuts.some(row=>startTime>=row.startTime && startTime<row.endTime)) ?
      [{startTime,endTime:cutEdges[i+1]}] : []);
    return {beats,seed,groups,landmarks,foreground,lanes,perTrack,roomCuts,time};
  }

  function harmonize(cue,score) {
    const spans=cue.lanes.harmony;
    if (!spans.length) return score;
    const base=P.musicScore.compile(score), changes=new Map(base.events.filter(row=>
      !spans.some(span=>row.time>=span.startTime-eps && row.time<span.endTime-eps))
      .map(({id,time,harmony})=>[time,{id,time,harmony}]));
    const taken=new Set(base.events.map(row=>row.id));
    let count=0;
    function add(time,harmony) {
      let id;
      do id='cue-chord-'+count++; while (taken.has(id));
      check(count<=2048 && changes.size<1024,'Cue harmonic rhythm exceeds its change budget');
      changes.set(time,{id,time,harmony});
    }
    for (const [i,span] of spans.entries()) {
      for (let step=0;;step++) {
        const beat=round(span.from+step*span.every);
        if (beat>=span.to-eps) break;
        add(cue.time(beat),span.chords[step%span.chords.length]);
      }
      if (span.endTime<base.duration-eps && Math.abs((spans[i+1]?.from ?? Infinity)-span.to)>eps &&
          ![...changes.keys()].some(t=>Math.abs(t-span.endTime)<=eps)) {
        const original=base.events.findLast(row=>row.time<=span.endTime+eps);
        check(original,'Cue harmony needs an underlying chord to resume');
        add(span.endTime,original.harmony);
      }
    }
    return {...score,changes:[...changes.values()].sort((a,b)=>a.time-b.time)};
  }

  const within=(rows,beat)=>rows.find(row=>beat>=row.from-eps && beat<row.to-eps);
  function shape(cue,name,rows) {
    const local=cue.perTrack[name], removed=new Set();
    for (const span of local.density) {
      if (span.value===1) continue;
      const groups=new Map(), keep=new Set(span.keep.map(round));
      for (const row of rows) {
        if (row.midi===null || !row.velocity || !row.frequency) continue;
        const beat=round(row.beat);
        if (beat<span.from-eps || beat>=span.to-eps) continue;
        if (!groups.has(beat)) groups.set(beat,{beat,rows:[],priority:0});
        const group=groups.get(beat);
        group.rows.push(row);
        group.priority=Math.max(group.priority,row.velocity);
      }
      const candidates=[...groups.values()].filter(group=>!keep.has(group.beat));
      const tie=group=>hash([cue.seed,name,group.beat]);
      candidates.sort((a,b)=>b.priority-a.priority || tie(a)-tie(b) || a.beat-b.beat);
      const target=Math.round(groups.size*span.value)-(groups.size-candidates.length);
      for (const group of candidates.slice(Math.max(0,target))) for (const row of group.rows) removed.add(row);
    }
    return rows.filter(row=>!removed.has(row)).map(row=>{
      const offset=within(local.register,row.beat)?.semitones;
      if (!offset || row.midi===null) return row;
      const midi=row.midi+offset;
      check(integer(midi,0,127),'Cue register moves '+name+' outside the MIDI range');
      return {...row,midi,frequency:row.frequency*2**(offset/12)};
    });
  }

  function cursor(rows) {
    if (!rows.length) return null;
    let index=0;
    return time=>{
      while (index<rows.length && time>=rows[index].endTime-eps) index++;
      const row=rows[index];
      return row && time>=row.startTime-eps ? row : null;
    };
  }

  function equalizer(rows,rate) {
    if (!rows.length) return null;
    let index=0, filter;
    const pair=[0,0];
    const make=row=>P.audioParametric.band('peak',rate,
      ()=>Math.min(rate*.48,row.hz),()=>row.q ?? 1,()=>row.gainDb);
    return {
      snapshot:()=>({index,filter:filter?.snapshot()}),
      restore(state){
        index=state.index;
        filter=state.filter && make(rows[index]);
        filter?.restore(state.filter);
      },
      reset(){filter=null;},
      tick(left,right,frame,time) {
        while (index<rows.length && time>=rows[index].endTime-eps) {
          index++;
          filter=null;
        }
        const row=rows[index];
        if (!row || row.gainDb===0 || time<row.startTime-.35) return null;
        filter ??= make(row);
        filter(left,right,frame,pair);
        if (time<row.startTime-eps) return null;
        const edge=Math.min(time-(row.fadeFrom ?? row.startTime),(row.fadeTo ?? row.endTime)-time);
        if (row.fadeSeconds) {
          const wet=Math.max(0,Math.min(1,edge/row.fadeSeconds));
          pair[0]=left+(pair[0]-left)*wet;
          pair[1]=right+(pair[1]-right)*wet;
        }
        return pair;
      }
    };
  }

  // Release-only edits address tails already ringing when a new moment begins.
  function tailLimit(rows,release,end) {
    if (end<=release) return null;
    for (const row of rows) {
      if (row.endTime<=release) continue;
      if (row.startTime>=end) break;
      const trigger=Math.max(release,row.startTime), stop=trigger+row.seconds;
      if (stop<end) return {stop,fade:row.fadeSeconds};
    }
    return null;
  }

  function report(music) {
    const cue=music.cue,{events,program}=music;
    const audible=Object.entries(events).map(([name,rows])=>[name,rows.filter(row=>row.velocity>0 &&
      (music.tracks[name].external || music.tracks[name].play.prepare(row,48000,row.gate).duration>0))]);
    const summary=(from,to)=>Object.fromEntries(audible.map(([name,rows])=>{
      const sounding=rows.filter(row=>row.time>=from-eps && row.time<to-eps);
      const low=music.arrangement.parts[name].role==='percussion' ? [] : sounding.map(row=>row.midi);
      return [name,{onsets:sounding.length,first:sounding[0]?.time ?? null,firstBeat:sounding[0]?.beat ?? null,
        register:low.length ? [Math.min(...low),Math.max(...low)] : null}];
    }));
    return P.data.freeze(P.data.clone({beats:cue.beats,duration:music.end,seed:cue.seed,
      groups:cue.groups.map(row=>({...row,tracks:summary(row.startTime,row.endTime)})),landmarks:cue.landmarks,
      ...(cue.foreground.length && {foreground:cue.foreground.map(row=>({...row,tracks:summary(row.startTime,row.endTime)}))}),
      lanes:cue.lanes,harmony:program.events.map(({id,harmony,beat,time})=>({id,harmony,beat:round(beat),time})),
      tracks:summary(0,music.end),roomCuts:cue.roomCuts}));
  }
  P.musicCueMap=Object.freeze({compile,harmonize,shape,cursor,equalizer,tailLimit,report});
})(KIT.procedural);
