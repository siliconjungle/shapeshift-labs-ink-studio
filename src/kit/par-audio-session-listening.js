/* Repeatable two-stage listening rounds and evidence from the native session desk. */
(function (P) {
  const S=P.mediaGraphSupport,M=P.mediaGraph,R=P.musicCritiqueReferences,B=S.sessionListeningBallot;
  const {check,fields,id,integer,finite,record,db}=P.musicInstruments;
  const {freeze,clone}=P.data, kind='ink-studio/listening-round-ballot';
  const questions=['identity','groove','replay'];
  const prompts=['Which call do you remember after the gap?',
    'Which version has the strongest pocket between the players?',
    'Which return would you play again after hearing the approach and aftermath?'];
  const serial=JSON.stringify, stamp=value=>B.signature(value);
  const sample=samples=>({samples});
  const addressed=({from,to})=>({from:sample(from),to:sample(to)});
  const encloses=(outer,inner)=>outer.from<=inner.from && outer.to>=inner.to;
  const range=(plan,value)=>{
    check(fields(value,['from','to']),'Choose a listening range with two session addresses');
    return plan.range(value.from,value.to);
  };
  const clipRange=(pcm,context,{from,to})=>({...pcm,samples:pcm.samples.slice(2*(from-context.from),2*(to-context.from))});
  const normalizeBriefRow=row=>({id:row.id,family:row.family ?? row.id,label:row.label ?? row.id});
  const fingerprint=(name,session)=>stamp(['session',name,session]);
  const protectPerformance=(plan,lane)=>serial([...plan.producers.values()].map(({score})=>score.events[lane]
    .map(({beat,time,start,midi,frequency,gate,velocity,play,phrase})=>[beat,time,start,midi,frequency,gate,velocity,play,phrase])));

  function pickBallot(result) {
    const records=new Map(result.value.candidates.map(row=>[row.id,row]));
    const heard=result.value.shortlist.filter(row=>row.status==='heard');
    const picks=[], sounds=new Set(), pockets=new Set(), selected=[result.clips.reference];
    function add(row) {
      if (picks.length===3 || picks.includes(row) || selected.some(clip=>!B.distinct(clip,result.clips[row.id]))) return;
      const {sound,phrase}=records.get(row.id).axes;
      picks.push(row);
      selected.push(result.clips[row.id]);
      sounds.add(sound.family);
      pockets.add(phrase.family);
    }
    const disagreement=heard.find(row=>row.reason==='disagreement');
    if (disagreement) add(disagreement);
    for (const row of heard) {
      const {sound,phrase}=records.get(row.id).axes;
      if (!sounds.has(sound.family) && !pockets.has(phrase.family)) add(row);
    }
    for (const row of heard) add(row);
    return picks.map(row=>records.get(row.id));
  }

  function validChoices(rows,limit,allowed,accept) {
    return Array.isArray(rows) && integer(rows.length,1,limit) && new Set(rows.map(row=>row?.id)).size===rows.length &&
      Array.from(rows).every(row=>fields(row,['id','family','label',...allowed]) && id(row.id) && id(row.family ?? row.id) &&
        R.prose(row.label ?? row.id,120) && accept(row));
  }
  const editsAllowed=edits=>Array.isArray(edits) && edits.length<=128 &&
    Array.from(edits).every(row=>record(row) && row.op!=='pin');

  S.createListeningRound=({assets,compile,experiments})=>function round(session,brief) {
    check(fields(brief,['id','series','parent','seed','lead','roles','scout','focus','context','call','recall','groove',
      'sources','relationships','advance','integrity','targetLufs','ceilingDbTP','gapSeconds']) &&
      id(brief.id) && id(brief.series ?? brief.id) && Number.isSafeInteger(brief.seed ?? 0) &&
      (brief.parent===undefined || fields(brief.parent,['token','candidate','sessionHash']) &&
        id(brief.parent.token) && id(brief.parent.candidate) &&
        (brief.parent.sessionHash===undefined || brief.parent.sessionHash===fingerprint(brief.parent.candidate,session))) &&
      finite(brief.targetLufs ?? -18,-35,-9) && finite(brief.ceilingDbTP ?? -1.2,-9,-.5) &&
      finite(brief.gapSeconds ?? .8,.25,6),'Choose a named listening round with bounded levels and optional parent');
    const base=compile(session), {rate}=base, {lead,seed=0}=brief;
    const roles={hook:lead,...brief.roles};
    check(fields(brief.roles ?? {},['kick','bass']) && id(lead) &&
      base.producers.get('reference').score.tracks[lead] && base.pins[lead]!=='all',
    'Choose an editable score lead and optional kick and bass lanes');
    check(validChoices(brief.sources,64,['patch'],row=>record(row.patch) &&
      !['gestures','echo','performance'].some(key=>Object.hasOwn(row.patch,key))) &&
      validChoices(brief.relationships,24,['revision','edits'],row=>
        (row.revision===undefined || record(row.revision) && row.revision.unpin===undefined) &&
        (row.edits===undefined || editsAllowed(row.edits))),
    'Choose distinct instrument builds and ensemble relationships with native revisions or edits');
    const context=range(base,brief.context), focus=range(base,brief.focus ?? brief.recall), scout=range(base,brief.scout ?? brief.recall);
    const call=range(base,brief.call), recall=range(base,brief.recall), groove=range(base,brief.groove ?? brief.recall);
    check(call.to<=recall.from && [call,recall,groove,focus].every(span=>encloses(context,span)) &&
      encloses(focus,scout) && [call,recall,groove,scout].every(span=>span.to-span.from>=rate*.4) &&
      (context.to-context.from)/rate<=30,'Place call, recall, groove and the scout within a bounded context');
    const {sources:sourceLimit=6,context:contextLimit=8,disagreement=2}=brief.advance ?? {};
    check(fields(brief.advance ?? {},['sources','context','disagreement']) && integer(sourceLimit,1,16) &&
      integer(contextLimit,1,16) && integer(disagreement,0,contextLimit-1) &&
      sourceLimit*brief.relationships.length<=256,
    'Choose bounded instrument, context and disagreement budgets');
    const integrity=brief.integrity ?? {};
    const sourceRows=brief.sources.map(normalizeBriefRow);
    const soundById=new Map(brief.sources.map(row=>[row.id,row])), relationships=new Map(brief.relationships.map(row=>[row.id,row]));
    const sourceCache=new Map(), leadTrace=protectPerformance(base,lead);
    function instrument(name) {
      if (!sourceCache.has(name)) {
        const next=B.swap(base,lead,soundById.get(name).patch);
        check(protectPerformance(compile(next),lead)===leadTrace,'Instrument build changed the scheduled lead performance');
        sourceCache.set(name,next);
      }
      return sourceCache.get(name);
    }
    const scan=experiments.sweep(session,{
      id:'instruments',seed,focus:addressed(focus),scout:addressed(scout),context:addressed(focus),
      roles,screen:{integrity},axes:{sound:sourceRows},
      advance:{limit:sourceLimit,disagreement:Math.min(1,sourceLimit-1),diversity:['sound']}
    },{lockHook:true,build:instrument});
    const catalog=new Map(scan.value.candidates.map(row=>[row.id,row.axes.sound]));
    const advanced=scan.value.shortlist.filter(row=>row.status==='heard').map(row=>catalog.get(row.id));
    const sound=advanced;
    const heard={reference:session};
    let matrix, ballotRows=[];
    if (sound.length) {
      const selected=new Set(sound.map(row=>row.id));
      const fixedScore=(name,variants)=>{
        const fork=instrument(name), changed=experiments.apply(fork,[relationships.get(variants[1].id)]);
        check(selected.has(name) && protectPerformance(compile(changed),lead)===leadTrace,
          'The ensemble move changed the fixed lead performance');
        return changed;
      };
      matrix=experiments.sweep(session,{
        id:'ensemble',seed,focus:addressed(focus),scout:addressed(scout),context:addressed(context),roles,screen:{integrity},
        advance:{limit:contextLimit,disagreement,diversity:['phrase','sound']},
        axes:{sound,phrase:brief.relationships.map(normalizeBriefRow)}
      },{lockHook:true,build:fixedScore});
      Object.assign(heard,matrix.sessions);
      ballotRows=pickBallot(matrix);
    }
    const report={format:'ink-studio/listening-round',version:1,id:brief.id,series:brief.series ?? brief.id,
      ...(brief.parent && {parent:clone(brief.parent)}),rate,lead,ranges:{scout,focus,context,call,recall,groove},
      instrument:scan.value,ensemble:matrix?.value ?? null,instruments:advanced.map(row=>row.id),
      ballot:ballotRows.map(row=>({id:row.id,axes:row.axes}))};
    if (!ballotRows.length) return {value:freeze(report),sessions:heard,clips:matrix?.clips ?? {},ballot:null};
    const stages=['reference',...ballotRows.map(row=>row.id)], wave=[
      {stage:'reference',variant:'reference',change:'Reference session',clip:matrix.clips.reference},
      ...ballotRows.map(row=>({stage:row.id,variant:row.id,change:row.axes.sound.label+' / '+row.axes.phrase.label,
        clip:matrix.clips[row.id]}))
    ].map(row=>({...row,sessionHash:fingerprint(row.stage,heard[row.stage])}));
    const ballot=B.build(wave,context,[
      {id:'identity',prompt:prompts[0],ranges:[call,recall],gap:Math.round(rate*(brief.gapSeconds ?? .8))},
      {id:'groove',prompt:prompts[1],ranges:[groove],gap:0},
      {id:'replay',prompt:prompts[2],ranges:[context],gap:0}
    ],{rate,seed,name:brief.id,target:brief.targetLufs ?? -18,ceiling:brief.ceilingDbTP ?? -1.2,kind});
    const key={format:'ink-studio/listening-round-key',version:1,series:report.series,parent:brief.parent ?? null,
      assets:stamp(R.assetSignature(assets)),stages,ballot:ballot.key};
    return {value:freeze({...report,token:ballot.test.token}),sessions:heard,clips:matrix.clips,
      ballot:{...ballot,key:freeze({...key,seal:stamp(key)})}};
  };

  function archive(key,submission,audio) {
    check(fields(key,['format','version','series','parent','assets','stages','ballot','seal']) &&
      key.format==='ink-studio/listening-round-key' && key.version===1 && id(key.series) &&
      Array.isArray(key.stages) && integer(key.stages.length,2,4) && key.stages[0]==='reference' &&
      key.stages.every(id) && new Set(key.stages).size===key.stages.length,'Choose a private listening round key');
    const {seal,...body}=key;
    check(stamp(body)===seal,'Listening round key contents have changed');
    const accepted=B.archive(key.ballot,submission,audio,{kind,questions,stages:key.stages,flexible:true});
    const excerpts=Object.fromEntries(Object.entries(key.ballot.map).map(([question,rows])=>
      [question,Object.fromEntries(Object.entries(rows).map(([label,row])=>[label,row.audioHash]))]));
    const saved={...accepted,format:'ink-studio/listening-round-record',series:key.series,parent:key.parent,
      excerpts,submission:clone(submission)};
    return freeze({...saved,seal:stamp(saved)});
  }

  function keep(key,submission,audio,session,choice,assets={}) {
    const review=archive(key,submission,audio);
    check(fields(choice,['question','candidate']) && questions.includes(choice.question) && id(choice.candidate),
      'Choose a ballot question and one of its favored candidates');
    const answer=review.answers[choice.question], chosen=answer?.versions.find(row=>row.stage===choice.candidate);
    check(chosen && fingerprint(choice.candidate,session)===chosen.sessionHash &&
      key.assets===stamp(R.assetSignature(assets)),'Recover the exact favored session and source assets');
    const token=review.test.token, decision={format:R.decisionFormat,version:1,id:'round-'+stamp([token,choice.question,review.listener]),
      title:chosen.change.slice(0,160),tags:[choice.question,...(review.series===choice.question ? [] : [review.series])],
      reason:answer.reason,question:choice.question,listener:review.listener,token,series:review.series,parent:review.parent,
      candidate:choice.candidate,label:chosen.label,sessionHash:chosen.sessionHash,audioHash:chosen.audioHash,ranges:review.test.questions
        .find(row=>row.id===choice.question).sequence.map(row=>row.range),ties:answer.versions.map(row=>row.stage)};
    return freeze({session:clone(session),decision,next:{series:review.series,parent:{token,candidate:choice.candidate,sessionHash:chosen.sessionHash}}});
  }

  S.createListeningEvidence=({assets,compile,render,edit})=>{
    const source=session=>stamp([session,R.assetSignature(assets)]);
    function listen(session,request) {
      check(fields(request,['focus','context','solo','mute','repairs','ceilingDbTP']) &&
        finite(request.ceilingDbTP ?? -1,-10,-.1),'Choose listening evidence with valid context and ceiling');
      const base=compile(session), focus=range(base,request.focus), context=range(base,request.context ?? request.focus);
      const {solo=[],mute=[],repairs=[]}=request;
      check(encloses(context,focus) && context.to-context.from<=base.rate*30 &&
        [solo,mute].every(rows=>Array.isArray(rows) && rows.length<=4 && new Set(rows).size===rows.length &&
          Array.from(rows).every(name=>base.lanes.includes(name))) &&
        Array.isArray(repairs) && (!repairs.length || validChoices(repairs,6,['edits'],row=>editsAllowed(row.edits) && row.edits.length)) &&
        (context.to-context.from)*2*(2+solo.length+mute.length+repairs.length)<=20e6,
      'Choose bounded context, known lanes and addressed repair edits');
      const taps={...base.mixer.taps}, tapNames=new Map();
      for (const [i,lane] of solo.entries()) {
        let name='review-solo-'+i;
        while (Object.hasOwn(taps,name)) name+='x';
        taps[name]={strip:lane,tap:'post'};
        tapNames.set(lane,name);
      }
      const play=(plan,monitor)=>render({...plan,mixer:{...plan.mixer,taps}},
        {...addressed(context),...(monitor && {monitor})}).value;
      const original=play(base), clips={reference:original}, rows=[{id:'reference',range:context,kind:'mix'}], rejected=[];
      const add=(id,audio,range,kind,details={})=>{
        clips[id]=audio;
        rows.push({id,range,kind,...details});
      };
      if (context.from<focus.from) {
        const prior={from:context.from,to:focus.from};
        add('lead-in',clipRange(original,context,prior),prior,'lead-in');
      }
      for (const [i,lane] of solo.entries())
        add('solo-'+i,clipRange(play(base,{mode:'solo',tap:tapNames.get(lane)}),context,focus),focus,'solo',{lane});
      for (const [i,lane] of mute.entries()) add('mute-'+i,play(base,{mode:'mute',lane}),context,'true-mute',{lane});
      for (const row of repairs) {
        check(!Object.hasOwn(clips,row.id),'Repair ID overlaps a listening view');
        try {
          const revised=edit(session,row.edits), next=compile(revised);
          check(next.rate===base.rate && next.frames===base.frames && serial(next.map)===serial(base.map),
            'Keep repair auditions on the same clock');
          add(row.id,play(next),context,'repair',{label:row.label ?? row.id,edits:clone(row.edits),
            sessionHash:fingerprint(row.id,revised)});
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          rejected.push({id:row.id,reason:error.message});
        }
      }
      const peak=Math.max(...Object.values(clips).map(pcm=>S.mixerPeak.peak(pcm.samples,pcm.channels)));
      const gain=Math.min(1,db(request.ceilingDbTP ?? -1)/Math.max(peak,1e-10));
      if (gain!==1) for (const [name,pcm] of Object.entries(clips))
        clips[name]={...pcm,samples:pcm.samples.map(sample=>sample*gain)};
      const report={format:'ink-studio/listening-evidence',version:1,source:source(session),
        rate:base.rate,focus,context,gain,rejected,views:rows.map(row=>({...row,audioHash:R.excerptHash(clips[row.id].samples)}))};
      return {value:freeze({...report,token:stamp(report)}),clips};
    }
    function keep(session,report,choice,clip) {
      check(fields(choice,['take','reason']) && id(choice.take) && R.prose(choice.reason,2000) &&
        report?.format==='ink-studio/listening-evidence' && report.version===1,'Choose an auditioned repair and a listening reason');
      const {token,...content}=report;
      check(stamp(content)===token && content.source===source(session),'Repair review belongs to different material');
      const row=content.views.find(row=>row.id===choice.take && row.kind==='repair');
      const audio=M.audio(clip);
      check(row && audio.sampleRate===content.rate && audio.channels===2 &&
        audio.samples.length===2*(row.range.to-row.range.from) && R.excerptHash(audio.samples)===row.audioHash,
      'Choose the audio from the exact auditioned repair');
      const revised=edit(session,row.edits);
      check(fingerprint(row.id,revised)===row.sessionHash,'Repair no longer produces the auditioned session');
      return {value:revised,decision:freeze({format:R.decisionFormat,version:1,id:'repair-'+stamp([token,row.id]),
        title:row.label,tags:['repair'],reason:choice.reason.trim(),token,range:row.range,focus:content.focus,
        audioHash:row.audioHash,edits:clone(row.edits)})};
    }
    return {listen,keep};
  };

  function calibrationVotes(key,records) {
    check(Array.isArray(key?.cases) && key.cases.length<=32 && Array.isArray(records) && records.length<=512,
      'Choose listener cases and archived listening ballots');
    for (const entry of records) {
      const {seal,...body}=entry ?? {};
      check(body.format==='ink-studio/listening-round-record' && body.version===1 && stamp(body)===seal,
        'Use verified listening round records');
    }
    return Object.fromEntries(key.cases.flatMap(row=>{
      if (row.kind!=='preference' || !questions.includes(row.criterion) || !Array.isArray(row.excerptHashes) || row.channels!==2)
        return [];
      const [left,right]=row.excerptHashes, byListener=new Map();
      for (const entry of records) {
        if (entry.test.sampleRate!==row.sampleRate) continue;
        const answered=entry.answers[row.criterion];
        const hashes=Object.values(entry.excerpts[row.criterion] ?? {});
        if (!answered || left===right || hashes.filter(hash=>hash===left).length!==1 ||
            hashes.filter(hash=>hash===right).length!==1) continue;
        const chosen=answered.versions.map(row=>row.audioHash), a=chosen.includes(left), b=chosen.includes(right);
        if (!a && !b) continue;
        const label=a && b ? 'tie' : a ? 'left' : 'right';
        if (!byListener.has(entry.listener)) byListener.set(entry.listener,label);
        else if (byListener.get(entry.listener)!==label) byListener.set(entry.listener,null);
      }
      const votes=[...byListener.values()].filter(Boolean);
      return votes.length ? [[row.id,votes]] : [];
    }));
  }

  M.listeningRound=Object.freeze({archive,keep,calibrationVotes});
})(KIT.procedural);
