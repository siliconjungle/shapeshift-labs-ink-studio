/* Turn mix measurements into editable comparisons, then remember an explicit listening decision. */
(function (P) {
  const A=P.musicProduction, E=P.musicCritiqueEvidence, R=P.musicCritiqueReferences, M=P.musicCritiqueMemory;
  const {fields,integer,finite,id,check,record}=P.musicInstruments;
  const planFormat='ink-studio/critique-plan', testFormat='ink-studio/blind-listening', keyFormat='ink-studio/blind-listening-key';
  const hookMoves=['mute-layer','move-register','mix-cut'], arrivalMoves=['delay-bass','empty-beat'];
  const {criteria}=M;
  const round=value=>Number(value.toFixed(8));
  const frozen=value=>P.data.freeze(P.data.clone(value));
  const active=(score,track,range)=>score.events[track].some(row=>row.velocity>0 &&
    row.time<range.end && row.time+row.gate>range.start);
  const pitched=role=>role==='pad' || role==='lead';

  function plan(source,brief,assets={}) {
    check(fields(brief,['section','goal','kind','lead','layer','bass','leadInBeats','focusBeats',
      'offsetBeats','withholdBeats','octave','cutDb','sampleRate','tags','references','listeningContext','memory',
      'criterion','takes']) && id(brief.section) &&
      R.prose(brief.goal,640) && ['hook','arrival','both','space','custom'].includes(brief.kind ?? 'both') &&
      (brief.memory===undefined || brief.listeningContext!==undefined) && criteria.includes(brief.criterion ?? 'identity') &&
      Array.isArray(brief.takes ?? []) && (brief.takes ?? []).length<=7 &&
      (brief.kind!=='custom' || (brief.takes ?? []).length>0) &&
      finite(brief.leadInBeats ?? 2,0,16) && finite(brief.focusBeats ?? 4,.25,16) &&
      finite(brief.offsetBeats ?? 0,0,64) && finite(brief.withholdBeats ?? 1,.125,8) &&
      [-12,12].includes(brief.octave ?? -12) && finite(brief.cutDb ?? -3,-12,-.25) &&
      integer(brief.sampleRate ?? 24000,8000,48000),'Invalid mix critique brief');
    const {section:name,goal,kind='both',leadInBeats=2,focusBeats=4,offsetBeats=0,
      withholdBeats=1,octave=-12,cutDb=-3,sampleRate=24000}=brief;
    const listeningContext=brief.listeningContext===undefined ? undefined : M.context(brief.listeningContext);
    const tags=R.tags(brief.tags ?? []), score=A.compile(source,assets);
    const references=R.search(brief.references ?? [],{tags,limit:8})
      .map(({entry,kind})=>({id:entry.id,title:entry.title,kind,tags:entry.tags,
        note:entry.note ?? entry.reason,...(entry.move && {move:entry.move})}));
    const section=score.arrangement.sections.find(row=>row.id===name);
    check(section && section.beat+offsetBeats<section.end,'Critique needs a focus inside a named section');
    const fromBeat=round(section.beat+offsetBeats), toBeat=round(Math.min(section.end,fromBeat+focusBeats));
    const focus=E.address(score,sampleRate,fromBeat,toBeat);
    const context=E.address(score,sampleRate,round(Math.max(0,fromBeat-leadInBeats)),toBeat);
    check(context.end-context.start<=30 && focus.endSample-focus.firstSample>=8,
      'Critique needs a render context of up to thirty seconds');
    const names=Object.keys(score.tracks), role=name=>score.arrangement.parts[name]?.role;
    const lead=brief.lead ?? names.find(name=>role(name)==='lead' && active(score,name,focus));
    const bass=brief.bass ?? names.find(name=>role(name)==='bass' && active(score,name,context));
    check((lead===undefined || names.includes(lead) && pitched(role(lead))) &&
      (bass===undefined || names.includes(bass) && role(bass)==='bass') &&
      (brief.layer===undefined || names.includes(brief.layer) && pitched(role(brief.layer)) && brief.layer!==lead),
    'Choose distinct existing lead, competing pitched layer and bass tracks');
    const rivals=names.filter(name=>name!==lead && active(score,name,focus));
    const measurement=E.measure(score,context,focus,lead,rivals,sampleRate);
    const focusRows=measurement.report.windows.filter(row=>row.range.fromBeat>=fromBeat && row.range.toBeat<=toBeat);
    const competing=Object.fromEntries(rivals.filter(name=>pitched(role(name))).map(name=>[name,
      focusRows.reduce((total,row)=>total+(row.masking.find(candidate=>candidate.track===name)?.overlap ?? 0),0)]));
    const layer=brief.layer ?? Object.keys(competing).sort((a,b)=>competing[b]-competing[a] || a.localeCompare(b))[0];
    const moves={hook:hookMoves,arrival:arrivalMoves,both:[...hookMoves,...arrivalMoves],space:['dry-drums'],custom:[]}[kind].slice();
    const custom=Array.from(brief.takes ?? [],row=>{
      check(fields(row,['id','hypothesis','revision']) && id(row.id) && row.id!=='reference' &&
        !moves.includes(row.id) && R.prose(row.hypothesis,640) && record(row.revision),
      'Custom blind takes need a portable move ID, listening hypothesis and production revision');
      return row;
    });
    check(new Set(custom.map(row=>row.id)).size===custom.length && moves.length+custom.length<=7,
      'Blind critique needs distinct moves and up to seven alternatives');
    const prior=brief.memory===undefined ? references.find(row=>moves.includes(row.move))?.move : undefined;
    if (prior) moves.unshift(...moves.splice(moves.indexOf(prior),1));
    const blocked=[], takes=[];
    const bounds={from:fromBeat,to:toBeat};
    const expect=(track,range)=>track && active(score,track,E.address(score,sampleRate,range.from,range.to));
    for (const move of moves) {
      let lane, row, hypothesis, track=layer;
      if (hookMoves.includes(move)) {
        if (!lead || !expect(lead,bounds) || !expect(layer,bounds)) {
          blocked.push({move,reason:'This comparison needs an active hook and competing track in the focus.'});
          continue;
        }
        if (move==='mute-layer') {
          lane='silence'; row={...bounds,parts:[layer],mode:'cut'};
          hypothesis='Cut '+layer+' in the focus to hear how exposed the hook can become.';
        } else if (move==='move-register') {
          lane='register'; row={...bounds,parts:[layer],semitones:octave};
          hypothesis='Move '+layer+' '+(octave<0 ? 'down' : 'up')+' an octave during the focus.';
          if (!score.events[layer].some(note=>note.beat>=fromBeat && note.beat<toBeat)) {
            blocked.push({move,reason:'Register edits require a note starting inside the focus.'});
            continue;
          }
        } else {
          lane='level'; row={...bounds,parts:[layer],gainDb:cutDb,fadeSeconds:.025};
          hypothesis='Reduce '+layer+' by '+Math.abs(cutDb)+' dB during the focus.';
        }
      } else if (move==='dry-drums') {
        const drums=names.filter(name=>role(name)==='percussion' && expect(name,bounds) &&
          score.tracks[name].mix.send>0 &&
          !(score.cue?.perTrack[name].depth ?? []).some(span=>span.send!==undefined && span.from<toBeat && span.to>fromBeat));
        if (!drums.length) {
          blocked.push({move,reason:'The focus needs playing drums with a shared-room send.'});
          continue;
        }
        lane='room';
        row={...bounds,parts:drums,send:0};
        hypothesis='Lower the shared room on the drums to bring the attacks closer.';
      } else if (move==='delay-bass') {
        track=bass;
        lane='silence'; row={from:context.fromBeat,to:round(Math.min(toBeat,fromBeat+withholdBeats)),parts:[bass],mode:'ring'};
        if (!expect(bass,row) || !score.events[bass].some(note=>note.time>=focus.start &&
            note.time<E.address(score,sampleRate,row.from,row.to).end)) {
          blocked.push({move,reason:'The bass needs an onset at the arrival for a delayed entry comparison.'});
          continue;
        }
        hypothesis='Withhold '+bass+' into the arrival and let the existing room ring.';
      } else {
        track=null;
        if (fromBeat-context.fromBeat<1-1e-8) {
          blocked.push({move,reason:'A full lead-in beat is needed for an empty-beat comparison.'});
          continue;
        }
        lane='silence'; row={from:round(fromBeat-1),to:fromBeat,mode:'cut'};
        const lastBeat=E.address(score,sampleRate,row.from,row.to);
        const first=(lastBeat.firstSample-context.firstSample)*2, end=(lastBeat.endSample-context.firstSample)*2;
        if (!measurement.value.samples.subarray(first,end).some(sample=>Math.abs(sample)>.0003)) {
          blocked.push({move,reason:'The final lead-in beat is already quiet in the rendered mix.'});
          continue;
        }
        hypothesis='Clear the final lead-in beat, including the room, before the full arrangement returns.';
      }
      const cueMap={...source.cueMap,[lane]:[...source.cueMap?.[lane] ?? [],row]};
      const revision={cueMap};
      try {
        A.revise(source,revision,assets);
        takes.push({id:move,hypothesis,components:[{id:move,summary:hypothesis,revision}]});
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        blocked.push({move,track,reason:error.message});
      }
    }
    for (const row of custom) {
      try {
        A.revise(source,row.revision,assets);
        takes.push({id:row.id,hypothesis:row.hypothesis,
          components:[{id:row.id,summary:row.hypothesis,revision:row.revision}]});
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        blocked.push({move:row.id,reason:error.message});
      }
    }
    const preference=brief.memory===undefined ? undefined : M.recall(brief.memory,
      {context:listeningContext,criterion:brief.criterion ?? 'identity',moves:['reference',...takes.map(row=>row.id)]});
    if (preference?.preferred && preference.preferred!=='reference') {
      const index=takes.findIndex(take=>take.id===preference.preferred);
      if (index>0) takes.unshift(...takes.splice(index,1));
    }
    const session=A.planProducer(source,{section:name,goal,strategies:[],takes},assets);
    return frozen({format:planFormat,version:1,session,tracks:{lead:lead ?? null,layer:layer ?? null,bass:bass ?? null,rivals},
      tags,references,blocked,evidence:measurement.report,...(listeningContext && {listeningContext}),
      ...(preference && {preference})});
  }

  function shuffle(rows,seed) {
    const result=rows.slice();
    let state=seed>>>0;
    for (let i=result.length-1;i>0;i--) {
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      const other=Math.floor(state/2**32*(i+1));
      [result[i],result[other]]=[result[other],result[i]];
    }
    return result;
  }

  function sequence(takes,score,assets,range,later,rate,target,ceiling) {
    const end=score.arrangement.sections.at(-1).end;
    check(fields(later,['fromBeat','toBeat','gapSeconds']) && finite(later.fromBeat,range.toBeat,end) &&
      finite(later.toBeat,later.fromBeat,end) && later.toBeat>later.fromBeat &&
      finite(later.gapSeconds ?? .45,.15,2),'Choose a later listening range and a short gap');
    const followup=E.address(score,rate,later.fromBeat,later.toBeat);
    const lengths=[range,followup].map(part=>part.endSample-part.firstSample);
    check(lengths.every(frames=>integer(frames,8,30*rate)) && (lengths[0]+lengths[1])*takes.length<=6e6,
      'Paired listening excerpts exceed the render budget');
    const next=lengths[0]+Math.round((later.gapSeconds ?? .45)*rate);
    const windows=[{range,firstFrame:0,endFrame:lengths[0]},
      {range:followup,firstFrame:next,endFrame:next+lengths[1]}];
    const waves=takes.map(take=>{
      const samples=new Float32Array((next+lengths[1])*2);
      for (const [i,{range,firstFrame}] of windows.entries()) {
        const start=score.clock.timeAt({beat:range.fromBeat}),end=score.clock.timeAt({beat:range.toBeat});
        const {value}=A.render(take.production,assets,{start,end,sampleRate:rate});
        check(value.samples.length===lengths[i]*2,'Later excerpts need the same score clock for every take');
        const fade=Math.min(Math.floor(lengths[i]/2),Math.round(.008*rate));
        for (let frame=0;frame<lengths[i];frame++) {
          const gain=Math.min(1,frame/fade,(lengths[i]-1-frame)/fade);
          samples[2*(firstFrame+frame)]=value.samples[frame*2]*gain;
          samples[2*(firstFrame+frame)+1]=value.samples[frame*2+1]*gain;
        }
      }
      return {samples,sampleRate:rate,channels:2};
    });
    const matched=P.adaptiveRehearsalEvidence.matched(waves,target,ceiling);
    return {windows,takes:takes.map((take,i)=>({...take,value:matched[i].value})),lufs:matched.find(row=>row.playback.lufs!==null)?.playback.lufs ?? null};
  }

  function blind(source,planned,assets={},options={}) {
    check(planned?.format===planFormat && planned.version===1 && Array.isArray(planned.session?.takes) &&
      planned.session.takes.length>=2 && fields(options,['id','seed','target','ceiling','moves','criterion','question','later']) &&
      id(options.id ?? 'listening-test') && Number.isSafeInteger(options.seed ?? 0) &&
      (options.moves===undefined || Array.isArray(options.moves) && options.moves.length===2 &&
        new Set(options.moves).size===2 && Array.from(options.moves).every(move=>planned.session.takes.some(row=>row.id===move))) &&
      (options.question===undefined && options.criterion===undefined || options.moves && criteria.includes(options.criterion) &&
        R.prose(options.question,400)) && (options.later===undefined || options.question),
    'Blind listening needs at least one editable alternative and a valid test ID and seed');
    const {id:name='listening-test',seed=0,target=-18,ceiling=-1.2,moves,criterion,question,later}=options;
    const {sampleRate,context,focus}=planned.evidence ?? {};
    const score=A.compile(source,assets), {lead,layer,bass,rivals}=planned.tracks ?? {};
    const endBeat=score.arrangement.sections.at(-1).end;
    check(integer(sampleRate,8000,48000) && [context,focus].every(row=>record(row) &&
      finite(row.fromBeat,0,endBeat) && finite(row.toBeat,row.fromBeat,endBeat) && row.toBeat>row.fromBeat) &&
      Array.isArray(rivals) && rivals.length<=8,'Invalid planned listening ranges or tracks');
    for (const part of [lead,layer,bass,...rivals]) check(!part || Object.hasOwn(score.tracks,part),'Unknown evidence track');
    const range=E.address(score,sampleRate,context.fromBeat,context.toBeat);
    const observed=E.address(score,sampleRate,focus.fromBeat,focus.toBeat);
    const sameAddress=(a,b)=>Object.keys(b).every(name=>a[name]===b[name]);
    check(sameAddress(context,range) && sameAddress(focus,observed) &&
      focus.start>=context.start && focus.end<=context.end && focus.end>focus.start,
    'The listening ranges must match the original score');
    const session=moves ? {...planned.session,takes:planned.session.takes.filter(row=>row.id==='reference' || moves.includes(row.id))} : planned.session;
    const {takes,report}=A.reviewProducer(source,session,assets,{start:score.clock.timeAt({beat:context.fromBeat}),
      end:score.clock.timeAt({beat:context.toBeat}),sampleRate,target,ceiling,focus:[]});
    const relevant=takes.filter(take=>!moves || moves.includes(take.id));
    const joined=later && sequence(relevant,score,assets,range,later,sampleRate,target,ceiling);
    const order=shuffle(joined?.takes ?? relevant,seed), labels=Object.fromEntries(order.map((row,i)=>[String.fromCharCode(97+i),row.id]));
    const keys=Object.keys(labels), pairs=keys.flatMap((first,i)=>keys.slice(i+1).map(second=>[first,second]));
    const trials=shuffle(pairs,seed^0x44f9d9).map((pair,i)=>({id:'pair-'+(i+1),takes:shuffle(pair,seed+i*307+19)}));
    const signature=R.assetSignature(assets);
    const listeningContext=planned.listeningContext===undefined ? undefined : M.context(planned.listeningContext);
    const stamp=JSON.stringify([name,seed,planned.session,context,focus,sampleRate,target,ceiling,signature,...(listeningContext ? [listeningContext] : []),
      ...(moves ? [moves,criterion ?? null,question ?? null] : []),...(joined ? [joined.windows] : [])]);
    const token='test-'+P.data.hash(stamp).toString(36)+'-'+P.data.hash(stamp,0x9e3779b9).toString(36);
    const audio=Object.fromEntries(keys.map((label,i)=>[label,order[i].value]));
    const measured=E.measure(score,context,focus,lead,rivals,sampleRate);
    const evidence=E.snippets(measured,lead,layer,bass);
    const test=frozen({format:testFormat,version:1,id:name,token,range,focus:observed,sampleRate,
      lufs:joined ? joined.lufs : report.target,criteria:criterion ? [criterion] : criteria,trials,labels:keys,
      ...(joined && {sequence:joined.windows}),
      ...(question && {question})});
    const key=frozen({format:keyFormat,version:1,test,labels,session,tags:planned.tags,assets:signature,
      ...(listeningContext && {listeningContext}),
      ...(question && {audioHashes:Object.fromEntries(keys.map(label=>[label,R.excerptHash(audio[label].samples)]))})});
    return {test,key,audio,evidence:{...evidence,report:measured.report}};
  }

  function keep(source,key,selection,assets={}) {
    check(fields(key,['format','version','test','labels','session','tags','assets','listeningContext','audioHashes']) && key.format===keyFormat &&
      key.version===1 && key.test?.format===testFormat && key.test.version===1 && record(key.labels) &&
      R.prose(key.session?.goal,640) && Array.isArray(key.session.takes) &&
      Array.isArray(key.test.trials) && key.test.trials.length<=28 && key.test.trials.every(row=>
        id(row.id) && row.takes?.length===2 && row.takes[0]!==row.takes[1] &&
        row.takes.every(label=>Object.hasOwn(key.labels,label))),
    'Open the private key from a blind listening test');
    const title=selection?.title ?? key.session.goal.slice(0,160);
    check(fields(selection,['token','take','reason','votes','tags','id','title','listeningContext']) && selection.token===key.test.token &&
      Object.hasOwn(key.labels,selection.take) && R.prose(selection.reason,2000) &&
      Array.isArray(selection.votes) && integer(selection.votes.length,1,256) &&
      id(selection.id ?? key.test.id) && R.prose(title,160),
    'Record the test token, chosen label, votes and a listening reason');
    check(JSON.stringify(key.assets)===JSON.stringify(R.assetSignature(assets)),'Recorded listening decision needs its original audio assets');
    const tags=R.tags(selection.tags ?? key.tags ?? []);
    const contextFromKey=key.listeningContext===undefined ? undefined : M.context(key.listeningContext);
    const contextFromDecision=selection.listeningContext===undefined ? undefined : M.context(selection.listeningContext);
    check(!contextFromKey || !contextFromDecision || JSON.stringify(contextFromKey)===JSON.stringify(contextFromDecision),
      'The listening context is fixed by the blind test');
    const listeningContext=contextFromKey ?? contextFromDecision;
    const {counts,votes,pairs}=M.ballots(key.labels,key.test.trials,selection.votes);
    check(Object.values(counts[selection.take]).some(value=>value>0),'The selected take needs at least one recorded preference');
    const move=key.labels[selection.take], chosen=key.session.takes.find(row=>row.id===move);
    check(chosen,'The chosen blind label has no producer take');
    const result=A.keepProducer(source,key.session,{keep:chosen.components.map(row=>({take:move,component:row.id})),
      reason:selection.reason,listened:[key.test.id]},assets);
    const reference=frozen({format:R.decisionFormat,version:1,id:selection.id ?? key.test.id,
      title,tags,reason:selection.reason,range:key.test.range,focus:key.test.focus,
      token:selection.token,move,take:selection.take,hypothesis:chosen.hypothesis,revision:result.revision,votes,counts,
      ...(listeningContext && {listening:{context:listeningContext,test:key.test.id,pairs,
        labels:key.labels,trials:key.test.trials}})});
    return {...result,producerReference:result.reference,reference};
  }

  P.musicProduction=Object.freeze({...A,critique:Object.freeze({plan,blind,keep,openAudio:P.musicCritiqueWorkbench.open,listener:P.musicCritiqueListener,applyEdit:P.musicCritiqueWorkbench.apply,tagReference:R.tag,findReferences:R.search,
    rememberPreference:M.remember,recallPreferences:M.recall,
    archiveBallot:M.rememberBallot,prioritize:(...args)=>P.musicCritiqueQuestions.prioritize(blind,...args)})});
})(KIT.procedural);
