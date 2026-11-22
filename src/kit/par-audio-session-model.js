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
        if (send===undefined && ['inputGain','fader','pan'].includes(parameter)) target=strips[strip];
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
      const [low,high]=parameter==='pan' ? [-1,1] : parameter==='fader' ? [0,4] : parameter==='inputGain' ? [0,1] : send ? [0,2] : [-1e9,1e9];
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
    check(fields(session,['format','version','id','sampleRate','production','takes','audio','comp','pins','mixer','automation','editorial']) &&
      session.format===format && session.version===1 && id(session.id) && record(session.production) &&
      integer(session.sampleRate,8000,96000),'Expected a version 1 music edit session');
    const {production,sampleRate:rate}=session, revisions=table(session.takes ?? {},15,'score takes');
    const baseline=A.compile(production,instruments(assets,production),host);
    const map=baseline.arrangement.score.tempoMap ?? {}, time=S.mixerTime(rate,map);
    const scoreFrames=time.frame(time.position({bar:baseline.arrangement.report.bars}));
    const producers=new Map([[reference,{source:production,score:baseline}]]);
    for (const [name,revision] of revisions) {
      check(name!==reference && record(revision) && revision.unpin===undefined,'Score takes need a revision and respect production pins');
      const bank=instruments(assets,production,revision), source=A.revise(production,revision,bank);
      const score=A.compile(source,instruments(assets,source),host);
      check(signature(Object.keys(score.tracks))===signature(Object.keys(baseline.tracks)),
        'Score takes share the same tracks');
      producers.set(name,{source,score});
    }
    const editorial=session.editorial;
    let editorialClock;
    if (editorial!==undefined) {
      check(fields(editorial,['picture','world','clockMap']),'Invalid shared session editorial clock');
      editorialClock=S.editorialClock({...editorial,map,sampleRate:rate});
    }
    const frames=Math.max(scoreFrames,editorialClock?.end ?? 0);
    check(integer(frames,1,rate*1800),'Music edit sessions can span up to thirty minutes');
    const editorialDoc=row=>({format:'ink-studio/audio-editorial',version:1,id:session.id,sampleRate:rate,
      ...editorial,map,sourceEdits:row.sourceEdits ?? {},clips:row.clips});
    const audioRows=table(session.audio ?? {},12,'audio lanes');
    const scoreNames=Object.keys(baseline.tracks), audio=new Map(), placed=new Map();
    check(!scoreNames.includes(room),'The score-room lane is reserved');
    for (const [name,row] of audioRows) {
      check(!scoreNames.includes(name) && name!==room && fields(row,['take','takes']) && id(row.take),
        'Audio lanes need their own name and an active take');
      const takes=new Map(table(row.takes,16,'audio takes'));
      check(takes.has(row.take),'Choose an existing audio take on '+name);
      for (const [take,source] of takes) {
        const shared=editorial!==undefined && fields(source,['clips','sourceEdits','track']) && Array.isArray(source.clips) &&
          (source.track===undefined || id(source.track));
        const valid=shared || fields(source,['silence']) && source.silence===true || fields(source,['asset','at','fromSample','toSample']) && id(source.asset) ||
          fields(source,['editorial','track','at']) && record(source.editorial) && (source.track===undefined || id(source.track)) ||
          fields(source,['kit','performance','at']) && record(source.kit) && record(source.performance) ||
          fields(source,['motif','at']) && fields(source.motif,['source','score','plan','role']) &&
            id(source.motif.source) && id(source.motif.score) && record(source.motif.plan) &&
            ['raw','lead','accent','texture'].includes(source.motif.role);
        check(valid,'Invalid audio take '+name+'/'+take);
        if (shared) placed.set(name+'/'+take,S.prepareSessionEditorial(editorialDoc(source),assets,source.track));
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
      fields(row,['inserts','inputGain','fader','pan','sends','output'])),'Place audio on session lanes and use a separate master strip');
    for (const name of sourceLanes) strips[name] ??= {};
    table(processors,64,'processors');
    automation(session,strips,processors,time);
    return {session,rate,map,frames,at,range,choice,choices,lanes,sourceLanes,audio,producers,pins,
      mixer:{...desk,id:session.id,sampleRate:rate,map,strips,processors},placed,editorialDoc,editorialClock};
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

  function keepRelease(plan,row) {
    check(fields(row,['op','lane','take','clip','voice','note','to','fadeSamples']) &&
      [row.lane,row.take,row.clip,row.voice,row.note].every(id),'Choose a score take and a written note for the release');
    const pick=take=>{
      const score=plan.producers.get(take)?.score, track=get(score?.tracks ?? {},row.lane);
      const events=track && score.events[row.lane].filter(note=>
        note.clip===row.clip && note.voice===row.voice && note.note===row.note);
      check(events?.length===1 && !track.external,'Release needs an unambiguous native note in both takes');
      return {score,track,note:events[0]};
    };
    const release=({note})=>Math.ceil((note.time+note.gate)*plan.rate);
    const alternate=pick(row.take), base=pick(reference);
    const from=Math.max(release(alternate),release(base)), {score,track,note}=alternate;
    const end=A.prepareVoice(track,note,score.end,plan.rate,score.cue?.perTrack[row.lane].tail).last;
    const to=row.to===undefined ? Math.min(end,plan.frames) : plan.at(row.to);
    check(to<=end,'Release selection extends past the alternate note');
    const fadeSamples=row.fadeSamples ?? Math.max(0,Math.min(Math.round(plan.rate*.012),Math.floor((to-from-1)/2)));
    return plan.choice({lane:row.lane,take:row.take,from:samples(from),to:samples(to),fadeSamples});
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
      } else if (row?.op==='keep-release') {
        next.comp=saveChoices(replace(plan.choices,keepRelease(plan,row)));
      } else if (row?.op==='picture') {
        check(next.editorial && fields(row,['op','picture']) && record(row.picture),
          'Replace the shared picture cut with an addressed shot list');
        next.editorial.picture=clone(row.picture);
      } else if (row?.op==='world-spot') {
        const world=next.editorial?.world;
        check(world && fields(row,['op','alias','event']) && typeof row.alias==='string' &&
          Object.hasOwn(world.aliases ?? {},row.alias) && world.events.some(event=>event.id===row.event),
          'Rebind an existing spot alias to an event in the committed ledger');
        world.aliases[row.alias]=row.event;
      } else if (row?.op==='pin') {
        check(fields(row,['op','lane','mode']) && plan.lanes.includes(row.lane) && [null,'all','pitch'].includes(row.mode),
          'Invalid lane pin edit');
        next.pins ??= {};
        if (row.mode===null) delete next.pins[row.lane];
        else next.pins[row.lane]=row.mode;
      } else if (row?.op==='revise-score') {
        check(fields(row,['op','revision']) && record(row.revision) && row.revision.unpin===undefined,
          'Supply a production revision that respects session pins');
        next.production=clone(A.revise(next.production,row.revision,instruments(assets,next.production,row.revision)));
      } else if (row?.op==='audio-select') {
        const lane=get(next.audio ?? {},row.lane);
        check(fields(row,['op','lane','take']) && id(row.lane) && id(row.take) && lane && get(lane.takes,row.take) &&
          (plan.pins[row.lane]!=='all' || lane.take===row.take),'Choose an existing take on an editable audio lane');
        lane.take=row.take;
      } else if (row?.op==='pad-events') {
        check(fields(row,['op','lane','take','edits']) && id(row.lane) && id(row.take) &&
          plan.pins[row.lane]!=='all','Address an editable kit take');
        const lane=get(next.audio ?? {},row.lane), take=lane && get(lane.takes,row.take);
        check(take?.kit,'Unknown sample kit take');
        take.performance=M.padPattern.edit(take.performance,row.edits);
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
        const take=source && get(source,row.take);
        check(take?.editorial || plan.placed.has(row.lane+'/'+row.take),'Unknown editorial take');
        const revised=M.audioEditorial.revise(take.editorial ?? plan.editorialDoc(take),assets,row.edits).value;
        if (take.editorial) take.editorial=revised;
        else take.clips=revised.clips;
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
      if (row.op==='revise-score') {
        const before=plan.producers.get(reference), after=updated.producers.get(reference);
        check(signature(Object.keys(before.score.tracks))===signature(Object.keys(after.score.tracks)) &&
          plan.frames===updated.frames && signature(plan.map)===signature(updated.map),
        'A session score revision must keep its tracks and clock');
        for (const [lane,mode] of Object.entries(plan.pins)) if (Object.hasOwn(before.score.tracks,lane)) {
          const track=before.source.tracks[lane], revised=after.source.tracks[lane];
          const pitches=score=>addressed(score,lane).map(({address,midi,beat})=>[address,beat,midi])
            .sort((a,b)=>signature(a[0]).localeCompare(signature(b[0])));
          const voice=entry=>{
            const {score}=entry, duck=score.tracks[lane].mix.duck;
            return [score.events[lane],score.cue?.perTrack[lane],score.gain,score.room,score.cue?.roomCuts,
              score.arrangement.score.endFade,duck && score.events[duck.from].map(({time,velocity})=>[time,velocity])];
          };
          check(mode==='pitch' ? signature(pitches(before.score))===signature(pitches(after.score)) :
            signature([track,before.source.patches[track.patch],voice(before)])===
              signature([revised,after.source.patches[revised.patch],voice(after)]),
          'Revision changes pinned score material on '+lane);
        }
      }
      if (row.op==='editorial') check(plan.pins[row.lane]!=='all','Lane is pinned '+row.lane);
      if (row.op==='picture' || row.op==='world-spot') for (const lane of plan.audio.keys()) {
        if (plan.pins[lane]!=='all') continue;
        for (const take of plan.audio.get(lane).takes.keys()) {
          const key=lane+'/'+take, before=plan.placed.get(key), after=updated.placed.get(key);
          if (before) check(signature(before.fingerprint(0,plan.frames))===signature(after.fingerprint(0,plan.frames)),
            'Edit changes pinned editorial material on '+lane);
        }
      }
      plan=updated;
    }
    return P.data.freeze(next);
  }
  S.musicSessionModel=Object.freeze({compile,edits,instruments,replace,addressed,addressing,phraseTake,reference,room,signature,samples});
})(KIT.procedural);
