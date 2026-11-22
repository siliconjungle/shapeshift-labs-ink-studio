/* Capture a performer's controls on the score clock and retain them across note boundaries. */
(function (P) {
  const I=P.musicInstruments, {fields,record,finite,integer,id,check}=I;
  const limits={pressure:[0,1],breath:[0,1],damping:[0,1],contact:[0,1],
    pitchCents:[-1200,1200],roughness:[0,1],gainDb:[-60,12],amplitude:[0,1],cutoffHz:[40,24000]};
  const eps=1e-8;
  const noteKey=({clip,voice,note})=>JSON.stringify([clip,voice,note]);
  const round=n=>Number(n.toFixed(10));
  const order=(a,b)=>a-b;

  function sample(points,time) {
    if (time<=points[0][0]) return points[0][1];
    let lo=0,hi=points.length;
    while (hi-lo>1) {
      const mid=(lo+hi)>>>1;
      if (points[mid][0]<=time) lo=mid; else hi=mid;
    }
    const [at,a]=points[lo], next=points[hi];
    return next ? a+(next[1]-a)*((time-at)/(next[0]-at)) : a;
  }

  function parse(raw,total,clock,notes) {
    check(fields(raw,['id','from','to','drivers','mapping','notes','sources']) && id(raw.id) &&
      finite(raw.from,0,total) && finite(raw.to,raw.from+1e-5,total) && record(raw.drivers) &&
      integer(Object.keys(raw.drivers).length,1,8) && Object.keys(raw.drivers).every(id) &&
      fields(raw.mapping,Object.keys(limits)) && Object.keys(raw.mapping).length>0 &&
      Array.isArray(raw.notes ?? []) && (raw.notes?.length ?? 0)<=64, 'Invalid phrase performance or score range');
    const drivers=Object.fromEntries(Object.entries(raw.drivers).sort(([a],[b])=>a.localeCompare(b)).map(([name,rows])=>{
      const ids=new Set();
      check(Array.isArray(rows) && integer(rows.length,1,192),'A phrase driver needs up to 192 addressed knots');
      const points=Array.from(rows,(row,i)=>{
        check(fields(row,['id','beat','value']) && id(row.id) && !ids.has(row.id) &&
          finite(row.beat,raw.from,raw.to) && (!i || row.beat>rows[i-1].beat+eps) && finite(row.value,0,1),
        'A phrase driver needs distinct, ordered knots with values between zero and one');
        ids.add(row.id);
        return [clock.timeAt({beat:row.beat}),row.value];
      });
      return [name,points];
    }));
    const from=clock.timeAt({beat:raw.from}),to=clock.timeAt({beat:raw.to});
    const mapping=Object.fromEntries(Object.entries(raw.mapping).sort(([a],[b])=>a.localeCompare(b)).map(([target,row])=>{
      check(fields(row,['base','from']) && finite(row.base,...limits[target]) && record(row.from) &&
        Object.keys(row.from).length>0 && Object.entries(row.from).every(([name,amount])=>
          Object.hasOwn(drivers,name) && finite(amount,-24000,24000)), 'Invalid gesture mapping for '+target);
      return [target,{base:row.base,from:Object.fromEntries(Object.entries(row.from).sort(([a],[b])=>a.localeCompare(b)))}];
    }));
    const lanes=Object.fromEntries(Object.entries(mapping).map(([name,{base,from:routes}])=>{
      const at=[...new Set([from,to,...Object.keys(routes).flatMap(key=>drivers[key].map(point=>point[0]))])].sort(order);
      const points=at.map(time=>[time,round(Object.entries(routes).reduce((value,[driver,amount])=>
        value+sample(drivers[driver],time)*amount,base))]);
      check(points.every(row=>finite(row[1],...limits[name])), 'Mapped phrase values exceed the range for '+name);
      return [name,points];
    }));
    const overrides=new Map();
    for (const row of raw.notes ?? []) {
      const address=noteKey(row ?? {}), event=notes.get(address);
      check(fields(row,['clip','voice','note','delay','accent','gate','articulation']) &&
        event && event.beat>=raw.from-eps && event.beat<raw.to-eps && !overrides.has(address) &&
        finite(row.delay ?? 0,-.125,.125) && finite(row.accent ?? 1,.02,2) && finite(row.gate ?? 1,.1,3) &&
        (row.articulation===undefined || id(row.articulation)) && (!event.ties || row.gate===undefined),
      'Phrase note edits need a distinct written attack and valid performance settings');
      overrides.set(address,row);
    }
    if (raw.sources!==undefined) validateSources(raw.sources,raw);
    return {raw,drivers,mapping,lanes,overrides};
  }

  function validateSources(sources,span) {
    check(Array.isArray(sources) && integer(sources.length,2,16) && Array.from(sources,(row,i)=>
      fields(row,['take','from','to','blend']) && id(row.take) && Number.isFinite(row.from) &&
      row.from===(i===0 ? span.from : sources[i-1]?.to) &&
      finite(row.to,row.from+1e-5,span.to) && finite(row.blend ?? 0,0,Math.min(.5,(row.to-row.from)/2)) &&
      (i>0 || !row.blend)).every(Boolean) && sources.at(-1).to===span.to,
    'Phrase comp sections must be contiguous with an optional short blend into each take');
  }

  function authored(track) {
    return new Map([...(track.clips?.notes ?? []),...(track.clips?.extra ?? [])].map(row=>[noteKey(row),row]));
  }

  function compile(raw,total,clock,track) {
    if (raw===undefined) return [];
    check(Array.isArray(raw) && raw.length<=32 && !track.external &&
      new Set(raw.map(row=>row?.id)).size===raw.length,'Use distinct phrase performances on a native instrument lane');
    const notes=authored(track);
    const all=Array.from(raw,row=>parse(row,total,clock,notes)).sort((a,b)=>a.raw.from-b.raw.from);
    check(all.every((row,i)=>!i || row.raw.from>=all[i-1].raw.to-eps),'Phrase performance ranges must be disjoint');
    return all;
  }

  function at(all,beat) {
    let lo=0,hi=all.length;
    while (lo<hi) {
      const mid=(lo+hi)>>>1;
      if (all[mid].raw.from<=beat+eps) lo=mid+1; else hi=mid;
    }
    const entry=all[lo-1];
    return entry && beat<entry.raw.to-eps ? entry : null;
  }

  function bind(note,phrase,release) {
    const start=note.start ?? note.time, stop=Math.min(note.choke ?? Infinity,note.time+note.gate+release);
    const lanes=Object.fromEntries(Object.entries(phrase.lanes).map(([name,points])=>{
      const chosen=[[0,sample(points,start)],...points.filter(([time])=>time>start+eps && time<stop)
        .map(([time,value])=>[round(time-start),value])];
      if (points.at(-1)[0]>stop && stop-start>chosen.at(-1)[0]+eps)
        chosen.push([round(stop-start),sample(points,stop)]);
      return [name,chosen];
    }));
    note.phrase={id:phrase.raw.id,lanes};
    return Object.values(lanes).reduce((sum,points)=>sum+points.length,0);
  }

  function comp(id,sections,phrases,track,clock) {
    const first=phrases[0];
    const span={from:first.raw.from,to:first.raw.to};
    validateSources(sections,span);
    const keys=Object.keys(first.drivers);
    check(phrases.every(row=>row.raw.from===span.from && row.raw.to===span.to &&
      JSON.stringify(Object.keys(row.drivers))===JSON.stringify(keys) &&
      JSON.stringify(row.mapping)===JSON.stringify(first.mapping)),
    'Comp takes must share phrase bounds, gesture inputs and their mapping');
    const drivers=Object.fromEntries(keys.map(name=>{
      const points=[];
      for (const [i,section] of sections.entries()) {
        const {from,to}=section, blend=i ? section.blend ?? Math.min(.04,(to-from)/2) : 0;
        const fade=from+blend, current=phrases[i];
        const read=(phrase,beat)=>sample(phrase.drivers[name],clock.timeAt({beat}));
        const add=(beat,value)=>{
          const row={id:'p-'+points.length,beat,value:round(value)};
          if (points.at(-1)?.beat===beat) row.id=points.pop().id;
          points.push(row);
        };
        if (i && blend) add(from,read(phrases[i-1],from));
        if (i && !blend && points.at(-1).value!==round(read(current,from))) {
          const prior=Math.max(points.at(-2)?.beat ?? from-1e-5,from-1e-5);
          if (from-prior>eps) {
            points.pop();
            add(prior,read(phrases[i-1],prior));
          }
        }
        add(fade,read(current,fade));
        for (const knot of current.raw.drivers[name]) if (knot.beat>fade+eps && knot.beat<to-eps) add(knot.beat,knot.value);
        add(to,read(current,to));
      }
      check(points.length<=192,'Comp exceeds its driver knot budget');
      return [name,points];
    }));
    const region=beat=>Math.max(0,sections.findLastIndex(row=>row.from<=beat+eps));
    const notes=[...authored(track)].flatMap(([key,note])=>{
      if (note.beat<span.from-eps || note.beat>=span.to-eps) return [];
      const entry=phrases[region(note.beat)].overrides.get(key);
      const exit=phrases[region(clock.sample(note.end).beat-eps*2)].overrides.get(key);
      if (entry?.delay===undefined && entry?.accent===undefined && entry?.articulation===undefined && exit?.gate===undefined) return [];
      const {clip,voice,note:name}=note, {delay,accent,articulation}=entry ?? {};
      return [{clip,voice,note:name,...(delay!==undefined && {delay}),...(accent!==undefined && {accent}),
        ...(articulation!==undefined && {articulation}),...(exit?.gate!==undefined && {gate:exit.gate})}];
    });
    return {id,...span,drivers,mapping:first.mapping,notes,sources:sections};
  }

  P.musicPhrasePerformance=Object.freeze({compile,at,bind,noteKey,comp});
})(KIT.procedural);
