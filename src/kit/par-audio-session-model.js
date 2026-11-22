/* Editable score, recording and automation addresses on one session clock. */
(function (P) {
  const A=P.musicProduction, M=P.mediaGraph, S=P.mediaGraphSupport, F=P.musicPhrasePerformance;
  const {check,fields,record,id,integer,assetNames}=P.musicInstruments, {clone}=P.data;
  const reference='reference', room='score-room', format='ink-studio/music-edit-session';
  const table=(value,max,label)=>{
    check(record(value) && Object.keys(value).length<=max && Object.keys(value).every(id),'Invalid session '+label);
    return Object.entries(value);
  };
  const get=(value,name)=>Object.hasOwn(value,name) ? value[name] : undefined;
  const samples=value=>({samples:value});
  const signature=value=>JSON.stringify(value);
  function instruments(assets,production,revision) {
    const names=new Set([...Object.values(production.patches ?? {}),...Object.values(revision?.patches ?? {})].flatMap(assetNames));
    return Object.fromEntries([...names].filter(name=>get(assets,name)).map(name=>[name,assets[name]]));
  }
  function addressed(score,lane) {
    const used=new Map(), motif=new Map(score.arrangement.cues.filter(row=>row.part===lane).map(row=>[row.beat,row]));
    return score.events[lane].map(row=>{
      const cue=motif.get(row.beat);
      const address=row.clip ? [lane,row.clip,row.voice,row.note] :
        [lane,cue?.section ?? 'score',cue?.event ?? 'voice',row.beat,row.voice ?? 0];
      const key=signature(address), index=used.get(key) ?? 0;
      used.set(key,index+1);
      return {address:[...address,index],beat:row.beat,time:row.time,gate:row.gate,midi:row.midi,
        velocity:row.velocity,play:row.play,...(row.phrase && {phrase:row.phrase.id}),...(row.ties && {ties:row.ties})};
    });
  }
  function automation(session,strips,processors,time) {
    const occupied=new Set();
    for (const [name,row] of table(session.automation ?? {},128,'automation lanes')) {
      check(fields(row,['target','unit','curve','points']) && record(row.target) &&
        ['beats','seconds','samples'].includes(row.unit) && ['linear','hold'].includes(row.curve ?? 'linear') &&
        Array.isArray(row.points) && integer(row.points.length,1,2048),'Invalid automation lane '+name);
      const {strip,send,processor,parameter}=row.target;
      let target;
      if (fields(row.target,['strip','send','parameter']) && id(strip) && get(strips,strip)) {
        if (send===undefined && ['fader','pan'].includes(parameter)) target=strips[strip];
        if (id(send) && parameter==='level') target=get(strips[strip].sends ?? {},send);
      }
      if (fields(row.target,['processor','parameter']) && id(processor) && id(parameter) &&
          !['type','id'].includes(parameter)) target=get(processors,processor);
      const key=signature([strip,send,processor,parameter]), ids=new Set();
      check(target && !occupied.has(key),'Unknown or duplicate automation target '+name);
      occupied.add(key);
      const lane={unit:row.unit,curve:row.curve ?? 'linear',points:row.points.map(point=>{
        check(fields(point,['id','at','value']) && id(point.id) && !ids.has(point.id) && Number.isFinite(point.value),
          'Automation knots need a unique ID and finite value');
        ids.add(point.id);
        return {at:point.at,value:point.value};
      })};
      const [low,high]=parameter==='pan' ? [-1,1] : parameter==='fader' ? [0,4] : send ? [0,2] : [-1e9,1e9];
      time.lane(lane,0,low,high,'session automation '+name);
      target[parameter]=lane;
    }
  }
  function addressing(rate,map,frames,pins,lookup) {
    const time=S.mixerTime(rate,map), at=value=>time.frame(time.position(value));
    const range=(from,to)=>{
      const start=at(from),end=at(to);
      check(integer(start,0,frames-1) && integer(end,start+1,frames),'Choose a nonempty range within the score');
      return {from:start,to:end};
    };
    function choice(raw) {
      check(fields(raw,['lane','take','from','to','fadeSamples']) && id(raw.lane) && id(raw.take),
        'Comp selection needs a lane, take and range');
      const {lane,take,fadeSamples=0}=raw, span=range(raw.from,raw.to), track=lookup(lane);
      check(track?.has(take) && integer(fadeSamples,0,Math.floor((span.to-span.from-1)/2)),
        'Unknown take or fade exceeds the selection');
      if (take!==track.fallback) {
        check(pins[lane]!=='all','Lane is pinned '+lane);
        if (pins[lane]==='pitch') {
          const pitches=name=>track.pitches(name).filter(row=>{
            const onset=at({beat:row.beat});
            return onset>=span.from && onset<span.to;
          }).sort((a,b)=>a.beat-b.beat || String(a.voice ?? '').localeCompare(String(b.voice ?? '')))
            .map(row=>[row.voice ?? null,row.midi]);
          check(signature(pitches(reference))===signature(pitches(take)), 'Take changes pinned pitches on '+lane);
        }
      }
      return {lane,take,...span,fadeSamples};
    }
    return {at,range,choice};
  }
  function compile(session,assets,host) {
    check(fields(session,['format','version','id','sampleRate','production','takes','audio','comp','pins','mixer','automation']) &&
      session.format===format && session.version===1 && id(session.id) && record(session.production) &&
      integer(session.sampleRate,8000,96000),'Expected a version 1 music edit session');
    const {production,sampleRate:rate}=session, revisions=table(session.takes ?? {},15,'score takes');
    const baseline=A.compile(production,instruments(assets,production),host);
    const map=baseline.arrangement.score.tempoMap ?? {}, time=S.mixerTime(rate,map);
    const frames=time.frame(time.position({bar:baseline.arrangement.report.bars}));
    check(integer(frames,1,rate*180),'Music edit sessions can span up to three minutes');
    const producers=new Map([[reference,{source:production,score:baseline}]]);
    for (const [name,revision] of revisions) {
      check(name!==reference && record(revision) && revision.unpin===undefined,'Score takes need a revision and respect production pins');
      const bank=instruments(assets,production,revision), source=A.revise(production,revision,bank);
      const score=A.compile(source,instruments(assets,source),host);
      check(signature(Object.keys(score.tracks))===signature(Object.keys(baseline.tracks)),
        'Score takes share the same tracks');
      producers.set(name,{source,score});
    }
    const audioRows=table(session.audio ?? {},12,'audio lanes');
    const scoreNames=Object.keys(baseline.tracks), audio=new Map();
    check(!scoreNames.includes(room),'The score-room lane is reserved');
    for (const [name,row] of audioRows) {
      check(!scoreNames.includes(name) && name!==room && fields(row,['take','takes']) && id(row.take),
        'Audio lanes need their own name and an active take');
      const takes=new Map(table(row.takes,16,'audio takes'));
      check(takes.has(row.take),'Choose an existing audio take on '+name);
      for (const [take,source] of takes) {
        const valid=fields(source,['asset','at','fromSample','toSample']) && id(source.asset) ||
          fields(source,['editorial','track','at']) && record(source.editorial) && (source.track===undefined || id(source.track)) ||
          fields(source,['motif','at']) && fields(source.motif,['source','score','plan','role']) &&
            id(source.motif.source) && id(source.motif.score) && record(source.motif.plan) &&
            ['raw','lead','accent','texture'].includes(source.motif.role);
        check(valid,'Invalid audio take '+name+'/'+take);
      }
      audio.set(name,{take:row.take,takes});
    }
    const lanes=[...scoreNames,...audio.keys()], sourceLanes=[...lanes,room];
    const pins=Object.fromEntries(table(session.pins ?? {},32,'pins'));
    const sourceLocks=P.musicComposer.locks(baseline.arrangement);
    for (const lane of scoreNames) if (Object.hasOwn(sourceLocks,lane)) pins[lane]='all';
    for (const [lane,mode] of Object.entries(pins))
      check(lanes.includes(lane) && (mode==='all' || mode==='pitch' && scoreNames.includes(lane)), 'Invalid pin on '+lane);
    const {at,range,choice}=addressing(rate,map,frames,pins,lane=>{
      const track=audio.get(lane);
      if (!lanes.includes(lane)) return null;
      const takes=track?.takes ?? producers;
      return {fallback:track?.take ?? reference,has:take=>takes.has(take),pitches:take=>producers.get(take).score.events[lane]};
    });
    const comp=session.comp ?? [];
    check(Array.isArray(comp) && comp.length<=512,'Invalid session comp');
    const choices=Array.from(comp,choice).sort((a,b)=>a.lane.localeCompare(b.lane) || a.from-b.from);
    check(choices.every((row,i)=>i===0 || choices[i-1].lane!==row.lane || choices[i-1].to<=row.from),
      'Comp selections on one lane may not overlap');
    const desk=clone(session.mixer ?? {output:'master',strips:{master:{}}});
    check(fields(desk,['output','strips','processors','taps','tail','peakPolicy']) && id(desk.output),
      'Use a native mixer desk keyed by session lane names');
    const strips=Object.fromEntries(table(desk.strips,48,'mixer strips')), processors=desk.processors ?? {};
    check(get(strips,desk.output) && !sourceLanes.includes(desk.output) && Object.values(strips).every(row=>
      fields(row,['inserts','fader','pan','sends','output'])),'Place audio on session lanes and use a separate master strip');
    for (const name of sourceLanes) strips[name] ??= {};
    table(processors,64,'processors');
    automation(session,strips,processors,time);
    return {session,rate,map,frames,at,range,choice,choices,lanes,sourceLanes,audio,producers,pins,
      mixer:{...desk,id:session.id,sampleRate:rate,map,strips,processors}};
  }
  function replace(choices,selection) {
    const updates=[];
    for (const row of choices) {
      if (row.lane!==selection.lane || row.to<=selection.from || row.from>=selection.to) updates.push(row);
      else {
        if (row.from<selection.from) updates.push({...row,to:selection.from,
          fadeSamples:Math.min(row.fadeSamples,Math.floor((selection.from-row.from-1)/2))});
        if (row.to>selection.to) updates.push({...row,from:selection.to,
          fadeSamples:Math.min(row.fadeSamples,Math.floor((row.to-selection.to-1)/2))});
      }
    }
    return [...updates,selection].sort((a,b)=>a.lane.localeCompare(b.lane) || a.from-b.from);
  }
  function phraseTake(plan,lane,take,phrase) {
    return plan.producers.get(take)?.score.tracks[lane]?.phrases.find(entry=>entry.raw.id===phrase);
  }

  function editPhrase(next,row,plan) {
    const base=plan.producers.get(reference);
    const {lane,take}=row;
    check(id(lane) && id(take) && take!==reference && Object.hasOwn(base.score.tracks,lane) &&
      plan.pins[lane]!=='all','Choose a named phrase take on an unpinned score lane');
    const source=plan.producers.get(take) ?? base, original=source.source.tracks[lane];
    let phrase, use;
    if (row.op==='record-phrase') {
      check(fields(row,['op','lane','take','phrase']) && record(row.phrase) && id(row.phrase.id),
        'Record a performance with its phrase ID and addressed control trace');
      phrase=row.phrase;
    } else if (row.op==='phrase-point') {
      check(fields(row,['op','lane','take','phrase','driver','point','set']) && id(row.phrase) &&
        id(row.driver) && id(row.point) && (row.set===null || fields(row.set,['beat','value']) &&
        Object.keys(row.set).length),'Address a driver point and supply its edit or null');
      const saved=phraseTake(plan,lane,take,row.phrase);
      check(saved && Object.hasOwn(saved.raw.drivers,row.driver),'Unknown phrase or gesture driver');
      phrase=clone(saved.raw);
      const knots=phrase.drivers[row.driver], index=knots.findIndex(point=>point.id===row.point);
      if (row.set===null) {
        check(index>=0,'Unknown gesture point');
        knots.splice(index,1);
      } else if (index<0) {
        check(Number.isFinite(row.set.beat) && Number.isFinite(row.set.value),'A new gesture point needs a beat and value');
        knots.push({id:row.point,...row.set});
      } else Object.assign(knots[index],row.set);
      knots.sort((a,b)=>a.beat-b.beat);
    } else {
      check(fields(row,['op','lane','take','phrase','sections','activate','fadeSamples']) && id(row.phrase) &&
        Array.isArray(row.sections) && integer(row.sections.length,2,16) &&
        typeof (row.activate ?? true)==='boolean','Comp a named phrase from at least two addressed selections');
      const written=entry=>{
        const {phrases,...track}=entry.source.tracks[lane];
        const {definition}=entry.score.arrangement;
        return signature([track,entry.source.patches[track.patch],{...definition,pins:definition.pins ?? []},
          entry.source.cueMap,entry.source.grooveMap]);
      };
      const originalScore=written(base);
      const shared=entry=>entry && written(entry)===originalScore;
      const selected=Array.from(row.sections,pick=>{
        check(pick && id(pick.take) && pick.take!==take && shared(source) && shared(plan.producers.get(pick.take)),
          'Phrase comp needs source takes with the same written score, clock and instrument');
        const phrase=phraseTake(plan,lane,pick.take,row.phrase);
        check(phrase,'Each selected take needs the named phrase performance');
        return phrase;
      });
      phrase=F.comp(row.phrase,row.sections,selected,base.score.tracks[lane],base.score.clock);
      if (row.activate!==false) use={lane,take,from:{beat:phrase.from},to:{beat:phrase.to},fadeSamples:row.fadeSamples ?? 0};
    }
    next.takes ??= {};
    const rev=next.takes[take] ??= {};
    rev.tracks ??= {};
    rev.tracks[lane]={...rev.tracks[lane],phrases:[...(original.phrases ?? []).filter(row=>row.id!==phrase.id),clone(phrase)]};
    return use;
  }

  function saveChoices(choices) {
    return choices.map(({from,to,...rest})=>({...rest,from:samples(from),to:samples(to)}));
  }

  function edits(session,assets,changes,host) {
    check(Array.isArray(changes) && changes.length<=128,'Supply a list of session edits');
    let plan=compile(session,assets,host);
    const next=clone(session);
    for (const row of changes) {
      let activation;
      if (['record-phrase','phrase-point','comp-phrase'].includes(row?.op))
        activation=editPhrase(next,row,plan);
      else if (row?.op==='comp') {
        check(fields(row,['op','lane','take','from','to','fadeSamples']),'Invalid comp edit');
        const {op,...selection}=row;
        next.comp=saveChoices(replace(plan.choices,plan.choice(selection)));
      } else if (row?.op==='pin') {
        check(fields(row,['op','lane','mode']) && plan.lanes.includes(row.lane) && [null,'all','pitch'].includes(row.mode),
          'Invalid lane pin edit');
        next.pins ??= {};
        if (row.mode===null) delete next.pins[row.lane];
        else next.pins[row.lane]=row.mode;
      } else if (row?.op==='score-take') {
        check(fields(row,['op','take','revision']) && id(row.take) && row.take!==reference && record(row.revision),
          'Supply a named production revision');
        next.takes ??= {};
        next.takes[row.take]=clone(row.revision);
      } else if (row?.op==='audio-take') {
        check(fields(row,['op','lane','take','source']) && id(row.lane) && id(row.take) && record(row.source),
          'Supply a named recording or procedural take');
        next.audio ??= {};
        next.audio[row.lane] ??= {take:row.take,takes:{}};
        const lane=next.audio[row.lane];
        check(lane.take!==row.take || plan.pins[row.lane]!=='all','Lane is pinned '+row.lane);
        lane.takes[row.take]=clone(row.source);
      } else if (row?.op==='note') {
        check(fields(row,['op','take','lane','clip','voice','note','set']) &&
          [row.take,row.lane,row.clip,row.voice,row.note].every(id) &&
          fields(row.set,['beat','duration','midi','velocity','play','tie']),'Invalid addressed note edit');
        const production=plan.producers.get(row.take)?.source, {clip,voice,note}=row;
        const clips=P.musicNoteClips.edit(get(production?.tracks ?? {},row.lane)?.clips,{clip,voice,note},row.set);
        const spec=row.take===reference ? next.production : get(next.takes,row.take);
        spec.tracks ??= {};
        spec.tracks[row.lane]={...get(spec.tracks,row.lane),clips};
      } else if (row?.op==='keep-notes') {
        check(fields(row,['op','lane','take','into','notes']) && id(row.lane) && id(row.take) &&
          id(row.into ?? reference) && plan.producers.has(row.take) && plan.producers.get(reference).score.tracks[row.lane] &&
          Array.isArray(row.notes) && integer(row.notes.length,1,128),'Choose a score lane, source take and written clip notes');
        const into=row.into ?? reference, source=plan.producers.get(row.take).source;
        const destination=(plan.producers.get(into) ?? plan.producers.get(reference)).source;
        const clips=clone(destination.tracks[row.lane].clips ?? []), seen=new Set();
        const voice=(clips,address)=>clips?.find(row=>row.id===address.clip)?.voices.find(row=>row.id===address.voice);
        for (const address of row.notes) {
          check(fields(address,['clip','voice','note']) && [address.clip,address.voice,address.note].every(id) &&
            !seen.has(signature(address)),'Keep needs distinct clip, voice and note addresses');
          seen.add(signature(address));
          const pick=voice(source.tracks[row.lane].clips,address)?.notes.find(note=>note.id===address.note);
          const target=voice(clips,address)?.notes, index=target?.findIndex(note=>note.id===address.note);
          check(pick && target,'The written note or destination clip voice is missing');
          if (index<0) target.push(clone(pick));
          else target[index]=clone(pick);
        }
        next.takes ??= {};
        const spec=into===reference ? next.production : (next.takes[into] ??= {});
        spec.tracks ??= {};
        spec.tracks[row.lane]={...get(spec.tracks,row.lane),clips};
      } else if (row?.op==='automation') {
        check(fields(row,['op','lane','point','at','value']) && id(row.lane) && id(row.point) &&
          (row.at!==undefined || Number.isFinite(row.value)), 'Invalid addressed automation edit');
        const knot=get(next.automation ?? {},row.lane)?.points.find(point=>point.id===row.point);
        check(knot,'Unknown automation point');
        if (row.at!==undefined) knot.at=clone(row.at);
        if (row.value!==undefined) knot.value=row.value;
      } else if (row?.op==='editorial') {
        check(fields(row,['op','lane','take','edits']) && id(row.lane) && id(row.take),'Invalid editorial take edit');
        const source=get(next.audio ?? {},row.lane)?.takes;
        check(source && get(source,row.take)?.editorial,'Unknown editorial take');
        source[row.take].editorial=M.audioEditorial.revise(source[row.take].editorial,assets,row.edits).value;
      } else check(false,'Unknown session edit');
      let updated=compile(next,assets,host);
      if (activation) {
        next.comp=saveChoices(replace(updated.choices,updated.choice(activation)));
        updated=compile(next,assets,host);
      }
      // A pitch or complete pin also guards edits to the reference itself.
      const noteTake=row.op==='note' ? row.take : row.op==='keep-notes' ? row.into ?? reference : null;
      if (noteTake===reference && plan.pins[row.lane]) {
        const select=score=>addressed(score,row.lane);
        const before=select(plan.producers.get(reference).score), after=select(updated.producers.get(reference).score);
        const pitches=rows=>rows.map(({address,midi})=>[address,midi]).sort((a,b)=>signature(a[0]).localeCompare(signature(b[0])));
        const key=plan.pins[row.lane]==='pitch' ? pitches : rows=>rows;
        check(signature(key(before))===signature(key(after)), 'Edit changes pinned material on '+row.lane);
      }
      if (row.op==='editorial') check(plan.pins[row.lane]!=='all','Lane is pinned '+row.lane);
      plan=updated;
    }
    return P.data.freeze(next);
  }
  S.musicSessionModel=Object.freeze({compile,edits,instruments,replace,addressed,addressing,phraseTake,reference,room,signature,samples});
})(KIT.procedural);
