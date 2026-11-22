/* Project committed evidence into a separate, read-only presentation track. */
(function(K) {
  const W=K.world,{check,id,record,read:at,selector}=W.data,{freeze}=K.procedural.data;
  const T=K.procedural.takeTime;
  const planFormat='ink-studio/presentation-cue-plan',format='ink-studio/presentation-cues',version=1;
  const maxCues=4096, maxRules=128;
  const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const seconds=value=>Number.isFinite(value)&&value>=0;
  const tick=value=>Number.isSafeInteger(value)&&value>=0&&value<=W.runtime.maxTick;
  const story=value=>typeof value==='string'&&value.split('/').length===2&&value.split('/').every(id);
  const label=value=>typeof value==='string'&&value.length<=1024;
  const eventRef=row=>fields(row,['world','branch','id','tick','kind','system','timecode'])&&
    [row.world,row.branch,row.id,row.kind,row.system].every(id)&&tick(row.tick)&&
    (row.timecode===undefined||seconds(T.seconds(T.read(row.timecode))));
  const header=row=>fields(row,['world','dt','from','to','coverage','dropped'])&&id(row.world)&&
    Number.isFinite(row.dt)&&row.dt>0&&row.dt<=1&&tick(row.from)&&tick(row.to)&&row.from<=row.to&&
    ['complete','retained'].includes(row.coverage)&&Number.isSafeInteger(row.dropped)&&row.dropped>=0&&
    (row.coverage!=='complete'||row.dropped===0);
  const timecode=(value,time)=>fields(value,['numerator','denominator'])&&T.seconds(T.read(value))===time;

  function cueDetails(row) {
    return id(row.kind)&&(row.label===undefined||label(row.label))&&
      (row.target===undefined||label(row.target)&&row.target.trim())&&(row.detail===undefined||record(row.detail));
  }

  function read(sheet) {
    check(fields(sheet,['format','version','id','source','cues'])&&sheet.format===format&&sheet.version===version&&
      id(sheet.id)&&(sheet.source===undefined||header(sheet.source))&&Array.isArray(sheet.cues)&&sheet.cues.length<=maxCues,
    'Expected a version 1 presentation cue sheet');
    const ids=new Set();
    for(const row of sheet.cues) {
      check(fields(row,['id','time','timecode','kind','label','target','detail','rule','source'])&&id(row.id)&&!ids.has(row.id)&&
        seconds(row.time)&&(row.timecode===undefined||timecode(row.timecode,row.time))&&cueDetails(row)&&(row.rule===undefined||id(row.rule))&&
        (row.source===undefined||eventRef(row.source)&&(!sheet.source||row.source.world===sheet.source.world&&
          row.source.tick>=sheet.source.from&&row.source.tick<=sheet.source.to)),'Invalid or duplicate presentation cue');
      ids.add(row.id);
    }
    return sheet;
  }

  function prepare(plan) {
    check(fields(plan,['format','version','id','rules'])&&plan.format===planFormat&&plan.version===version&&
      id(plan.id)&&record(plan.rules)&&Object.keys(plan.rules).length<=maxRules,'Expected a version 1 presentation cue plan');
    return Object.entries(plan.rules).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([rule,row])=>{
      check(id(rule)&&fields(row,['on','cue'])&&fields(row.on,['kind','system','branch','story','stage','where'])&&
        id(row.on.kind)&&['system','branch','stage'].every(key=>row.on[key]===undefined||id(row.on[key]))&&
        (row.on.story===undefined||story(row.on.story)),'Invalid presentation cue filter '+rule);
      W.query.condition(row.on.where,undefined);
      const authored=row.cue;
      check(fields(authored,['kind','label','target','detail','delay','bindings'])&&cueDetails(authored)&&
        (authored.delay===undefined||seconds(authored.delay))&&
        (authored.bindings===undefined||record(authored.bindings)&&Object.keys(authored.bindings).length<=32),
      'Invalid presentation cue template '+rule);
      const {delay=0,bindings={},detail={},...cue}=authored;
      const mappings=Object.entries(bindings).map(([path,source])=>{
        const into=selector(path), from=selector(source);
        check(at(detail,into)!==undefined,'Presentation binding needs an existing detail field '+path);
        return {into,from};
      });
      check(mappings.every(({into},i)=>mappings.every(({into:other},j)=>i===j||
        other.length>into.length||!other.every((key,k)=>into[k]===key))),
      'Presentation bindings need distinct detail fields');
      return {rule,on:row.on,cue,delay:T.read(delay),detail,mappings};
    });
  }

  function project(recording,plan) {
    check(record(recording)&&recording.format===W.storyEvents.envelopeFormat&&recording.version===version&&
      Array.isArray(recording.events)&&recording.events.length<=110000,'Presentation cues need committed event envelopes');
    const {world,dt,from,to,coverage,dropped,events}=recording, source={world,dt,from,to,coverage,dropped};
    check(header(source),'Invalid committed event source coverage');
    const rules=prepare(plan), byKind=new Map(), cues=[], seen=new Set(), step=T.period(dt,recording.simulationRate);
    for(const rule of rules) {
      const kind=rule.on.kind;
      if (!byKind.has(kind)) byKind.set(kind,[]);
      byKind.get(kind).push(rule);
    }
    let last=from;
    for(const event of events) {
      check(record(event),'Invalid committed event envelope');
      const {id,tick,kind,system,world:eventWorld,branch}=event, ref={id,tick,kind,system,world:eventWorld,branch};
      const key=branch+'/'+id;
      check(event.version===version&&eventRef(ref)&&eventWorld===world&&tick>=last&&tick<=to&&
        !seen.has(key)&&record(event.payload)&&Array.isArray(event.subjects)&&Array.isArray(event.causes)&&
        (event.story===null||story(event.story))&&(event.stage===null||W.data.id(event.stage)),
      'Invalid, duplicate or unordered committed event envelope');
      seen.add(key);
      last=tick;
      for(const {rule,on,cue,delay,detail,mappings} of byKind.get(kind)??[]) {
        if (['system','branch','story','stage'].some(key=>on[key]!==undefined&&on[key]!==event[key])||
          !W.query.condition(on.where,event)) continue;
        check(cues.length<maxCues,'Presentation cue budget exceeded. Narrow the rules or event range.');
        const edits=mappings.map(({into,from})=>{
          const value=at(event,from);
          check(value!==undefined,'Presentation cue '+rule+' needs event value '+from.join('/'));
          return {op:'set',path:into,value};
        });
        const commit=T.mul(T.read(tick),step), timing=T.add(commit,delay), time=T.seconds(timing);
        check(seconds(time),'Presentation cue time exceeds its range');
        const nativeTime=W.timedEvents.timeOf(event.payload);
        const original=nativeTime===undefined?commit:T.read(nativeTime);
        const data=W.data.copy(detail);
        cues.push({id:'cue-'+(cues.length+1),time,timecode:T.pack(timing),...cue,
          detail:edits.length?W.apply(data,edits,{validate:null}).world:data,rule,source:{...ref,timecode:T.pack(original)}});
      }
    }
    cues.sort((a,b)=>a.time-b.time);
    return freeze({format,version,id:plan.id,source,cues});
  }

  W.presentationCues=Object.freeze({format,planFormat,read,project});
})(KIT);
