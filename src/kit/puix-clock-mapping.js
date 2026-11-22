/* Project original media and simulation addresses through an exact editorial cut list. */
(function(K){
  const W=K.world,T=K.procedural.takeTime,{check,id,record,copy}=W.data,{freeze}=K.procedural.data;
  const links=W.inspectionLinks;
  const format='ink-studio/clock-map',reportFormat='ink-studio/clock-map-report';
  const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const min=(a,b)=>T.compare(a,b)<=0?a:b, max=(a,b)=>T.compare(a,b)>=0?a:b;
  const tick=value=>Number.isSafeInteger(value)&&value>=0&&value<=W.runtime.maxTick;
  const before=(a,b)=>T.compare(a,b)<0;
  const contains=(clip,time)=>!before(time,clip.from)&&before(time,clip.to);
  const describe=T.describe;
  function point(clock,address) {
    const value=T.position(clock,address), time=T.seconds(value);
    check(Number.isFinite(time)&&time>=0&&time<=1e9,'Clock map address must be between 0 and 1e9 seconds');
    return value;
  }

  function source(name,row) {
    check(id(name)&&fields(row,['clock','events','words'])&&(row.clock===undefined||record(row.clock))&&
      (row.words===undefined||Array.isArray(row.words)&&row.words.length<=16384),'Invalid clock map source '+name);
    const input=row.events, settings={...row.clock}, events=[], words=new Map();
    if (input!==undefined) {
      check(record(input)&&input.format===W.storyEvents.envelopeFormat&&input.version===1&&id(input.world)&&
        Number.isFinite(input.dt)&&input.dt>0&&input.dt<=1&&Array.isArray(input.events)&&input.events.length<=16384,
      'Clock map events need committed event envelopes for '+name);
      settings.simulationRate??=input.simulationRate??T.pack(T.div(T.read(1),T.period(input.dt)));
    }
    const clock=T.create(settings);
    if (input) {
      check(clock.dt===input.dt,'Clock map simulation rate differs from its event source '+name);
      const seen=new Set();
      for(const event of input.events) {
        check(record(event)&&event.version===1&&id(event.id)&&id(event.branch)&&id(event.kind)&&id(event.system)&&event.world===input.world&&
          tick(event.tick)&&record(event.payload),'Invalid committed event in clock map source '+name);
        const key=event.branch+'/'+event.id;
        check(!seen.has(key),'Duplicate clock map event '+key);
        seen.add(key);
        const timed=W.timedEvents.timeOf(event.payload);
        const time=point(clock,timed??{tick:event.tick});
        events.push({id:event.id,branch:event.branch,world:event.world,kind:event.kind,system:event.system,tick:event.tick,
          beatId:links.identify(event),time});
      }
    }
    for(const word of row.words??[]) {
      check(fields(word,['id','text','from','to'])&&id(word.id)&&!words.has(word.id)&&
        typeof word.text==='string'&&word.text.trim()&&word.text.length<=256,'Invalid or duplicate dialogue word');
      const from=point(clock,word.from), to=point(clock,word.to);
      check(before(from,to),'Dialogue word needs an increasing source interval');
      words.set(word.id,{id:word.id,text:word.text,from,to});
    }
    return {clock,events,words};
  }

  function map(plan) {
    check(fields(plan,['format','version','id','clock','sources','clips','cues'])&&plan.format===format&&plan.version===1&&
      id(plan.id)&&record(plan.clock)&&record(plan.sources??{})&&Object.keys(plan.sources??{}).length<=64&&
      Array.isArray(plan.clips??[])&&(plan.clips??[]).length<=256&&record(plan.cues??{})&&Object.keys(plan.cues??{}).length<=4096,
    'Expected a version 1 clock map');
    const clock=T.create(plan.clock), sources=new Map(Object.entries(plan.sources??{}).map(([name,row])=>[name,source(name,row)]));
    const clips=new Map();
    for(const row of plan.clips??[]) {
      check(fields(row,['id','source','in','out','at','duration'])&&id(row.id)&&!clips.has(row.id)&&sources.has(row.source),
        'Invalid or duplicate clock map clip');
      const original=sources.get(row.source).clock;
      const from=point(original,row.in), to=point(original,row.out), at=point(clock,row.at);
      const duration=row.duration===undefined?T.sub(to,from):point(clock,row.duration), end=T.add(at,duration);
      check(before(from,to)&&before(at,end)&&T.seconds(end)<=1e9,'Clock map clip needs positive source and edited durations');
      clips.set(row.id,{id:row.id,source:row.source,from,to,at,end,
        project:time=>T.affine(time,from,to,at,end)});
    }
    const events=[],words=[],cues=[],issues=[];
    const budget=()=>check(events.length+words.length+cues.length<100000,'Clock map exceeds its placement budget');
    for(const clip of clips.values()) {
      const input=sources.get(clip.source), origin=time=>describe(input.clock,time), edited=time=>describe(clock,clip.project(time));
      for(const {time,...event} of input.events) if(contains(clip,time)) {
        budget();
        events.push({source:clip.source,clip:clip.id,beatId:event.beatId,event,original:origin(time),edited:edited(time)});
      }
      for(const word of input.words.values()) {
        const from=max(word.from,clip.from), to=min(word.to,clip.to);
        if (!before(from,to)) continue;
        budget();
        words.push({source:clip.source,clip:clip.id,word:word.id,text:word.text,
          original:{from:origin(word.from),to:origin(word.to)},visible:{from:T.pack(from),to:T.pack(to)},
          edited:{from:edited(from),to:edited(to)}});
      }
    }
    const bySource=new Map();
    for(const clip of clips.values()) {
      if(!bySource.has(clip.source))bySource.set(clip.source,[]);
      bySource.get(clip.source).push(clip);
    }
    function addCue(value,time) {
      budget();
      cues.push({...value,at:describe(clock,time)});
    }
    for(const [name,row] of Object.entries(plan.cues??{})) {
      check(id(name)&&fields(row,['source','clip','at','preset'])&&id(row.preset)&&row.at!==undefined&&
        (row.source===undefined||sources.has(row.source))&&
        (row.clip===undefined||row.source!==undefined&&clips.get(row.clip)?.source===row.source),'Invalid clock map cue '+name);
      const cue={id:name,preset:row.preset};
      if(row.source===undefined) {
        addCue(cue,point(clock,row.at));
        continue;
      }
      const input=sources.get(row.source), spec=row.at;
      let time,anchor,issue;
      const byBeat=fields(spec,['beatId'])&&spec.beatId!==undefined;
      if(byBeat||fields(spec,['event','branch'])&&id(spec.event)&&(spec.branch===undefined||id(spec.branch))) {
        check(!byBeat||links.parse(spec.beatId),'Invalid clock map beat ID');
        const matches=input.events.filter(event=>byBeat?event.beatId===spec.beatId:
          event.id===spec.event&&(spec.branch===undefined||spec.branch===event.branch));
        if(matches.length!==1) issue=matches.length?'ambiguous-event':'unknown-event';
        else {
          const {time:original,...event}=matches[0];
          time=original;
          anchor={event};
        }
      } else if(fields(spec,['word','edge'])&&id(spec.word)&&[undefined,'start','end'].includes(spec.edge)) {
        const word=input.words.get(spec.word), edge=spec.edge??'start';
        if(!word) issue='unknown-word';
        else {
          time=edge==='start'?word.from:word.to;
          anchor={word:word.id,edge};
        }
      } else time=point(input.clock,spec);
      const selected=(row.clip===undefined?bySource.get(row.source)??[]:[clips.get(row.clip)])
        .filter(clip=>time&&contains(clip,time));
      if(!selected.length) issues.push({cue:name,source:row.source,reason:issue??'outside-clip',anchor:copy(spec)});
      else for(const clip of selected) addCue({...cue,source:row.source,clip:clip.id,anchor,
        ...(anchor?.event&&{beatId:anchor.event.beatId}),
        original:describe(input.clock,time)},clip.project(time));
    }
    const byTime=coordinate=>(a,b)=>T.compare(T.read(coordinate(a).timecode),T.read(coordinate(b).timecode));
    events.sort(byTime(row=>row.edited));
    words.sort(byTime(row=>row.edited.from));
    cues.sort(byTime(row=>row.at));
    return freeze({format:reportFormat,version:1,id:plan.id,clock:copy(plan.clock),clips:[...clips.values()].map(clip=>{
      const origin=sources.get(clip.source).clock;
      return {id:clip.id,source:clip.source,original:{from:describe(origin,clip.from),to:describe(origin,clip.to)},
        edited:{from:describe(clock,clip.at),to:describe(clock,clip.end)}};
    }),events,words,cues,issues});
  }

  function read(report) {
    check(record(report)&&report.format===reportFormat&&report.version===1&&id(report.id)&&
      record(report.clock)&&Array.isArray(report.cues)&&report.cues.length<=100000&&Array.isArray(report.issues),
    'Expected a version 1 clock map report');
    const clock=T.create(report.clock);
    const cues=report.cues.map(row=>{
      check(record(row)&&id(row.id)&&id(row.preset)&&record(row.at)&&row.at.timecode!==undefined&&
        (row.clip===undefined||id(row.clip))&&(row.source===undefined||id(row.source)),'Invalid clock map cue result');
      const time=point(clock,row.at.timecode), at=describe(clock,time);
      check(W.data.equal(at,row.at),'Clock map cue coordinates differ from its exact time');
      const event=row.anchor?.event, beatId=event&&links.identify(event);
      check(row.beatId===undefined||row.beatId===beatId,'Clock map cue beat ID differs from its event');
      return beatId?{...row,beatId}:row;
    });
    return {clock,cues};
  }

  function timeline(report) {
    const {cues}=read(report);
    check(cues.length<=4096,'Clock map timeline exceeds its cue budget');
    return freeze({presentationCues:{format:W.presentationCues.format,version:1,id:report.id,
      cues:cues.map((cue,index)=>{
        const {original,clip,anchor}=cue, event=anchor?.event;
        return {id:'clock-cue-'+(index+1),time:cue.at.seconds,timecode:copy(cue.at.timecode),kind:'show-cue',
          ...(cue.beatId&&{beatId:cue.beatId}),
          label:cue.id,target:cue.preset,detail:{preset:cue.preset,showFrame:cue.at.showFrame,
            ...(clip&&{clip}),...(original&&{original:copy(original)}),...(anchor&&{anchor:copy(anchor)})},
          ...(event&&original&&{source:{...event,timecode:copy(original.timecode)}})};
      })}});
  }

  W.clockMapping=Object.freeze({format,reportFormat,map,read,timeline});
})(KIT);
