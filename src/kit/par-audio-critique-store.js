/* Recall scoped preferences from completed blind listening tests. */
(function (P) {
  const R=P.musicCritiqueReferences, {fields,integer,finite,id,check}=P.musicInstruments;
  const format='ink-studio/listening-preference-memory', facets=['scene','moment','role','style','intent'];
  const criteria=Object.freeze(['groove','identity','shape','replay']);
  const round=n=>Number(n.toFixed(6));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function context(raw) {
    check(fields(raw,facets) && (raw.scene!==undefined || raw.moment!==undefined) &&
      Object.values(raw).every(id),'Listening context needs a scene or moment and named facets');
    return Object.fromEntries(facets.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,raw[key].toLowerCase()]));
  }

  function ballots(labels,trials,raw) {
    check(Array.isArray(raw) && integer(raw.length,1,256),'A listening decision needs up to 256 ballots');
    const choices=Object.keys(labels), moves=Object.values(labels);
    check(integer(choices.length,2,8) && choices.every(id) && moves.every(id) && new Set(moves).size===moves.length &&
      Array.isArray(trials) && integer(trials.length,1,28),'Invalid blind labels or trials');
    const trialIndex=new Map(), pairs=new Map(), counts=Object.fromEntries(choices.map(label=>
      [label,Object.fromEntries(criteria.map(name=>[name,0]))]));
    for (const trial of trials) {
      check(fields(trial,['id','takes']) && id(trial.id) && !trialIndex.has(trial.id) && Array.isArray(trial.takes) &&
        trial.takes.length===2 && trial.takes[0]!==trial.takes[1] &&
        Array.from(trial.takes).every(label=>Object.hasOwn(labels,label)),'Invalid or duplicate blind trial');
      const moves=trial.takes.map(label=>labels[label]).sort();
      const key=moves.join('/');
      check(!pairs.has(key),'Repeated pair in a blind test');
      const pair={moves,criteria:{}};
      pairs.set(key,pair);
      trialIndex.set(trial.id,{...trial,pair});
    }
    const seen=new Set(), votes=Array.from(raw,row=>{
      check(fields(row,['trial','listener','preferences','reason']) && id(row.trial) && id(row.listener) &&
        (row.reason===undefined || R.prose(row.reason,2000)) &&
        fields(row.preferences,criteria) && Object.keys(row.preferences).length,'A vote needs a trial, listener and preference');
      const trial=trialIndex.get(row.trial), mark=row.listener+':'+row.trial;
      check(trial && !seen.has(mark),'Vote once per listener and trial');
      seen.add(mark);
      for (const [criterion,label] of Object.entries(row.preferences)) {
        check(label==='tie' || trial.takes.includes(label),'Vote for either take in this pair or a tie');
        const tally=trial.pair.criteria[criterion] ??= [0,0,0];
        if (label==='tie') tally[2]++;
        else {
          tally[trial.pair.moves.indexOf(labels[label])]++;
          counts[label][criterion]++;
        }
      }
      return row;
    });
    const observed=[...pairs.values()].filter(pair=>Object.keys(pair.criteria).length).sort((a,b)=>
      a.moves.join('/').localeCompare(b.moves.join('/')));
    return {counts,votes,pairs:observed};
  }

  function heard(raw) {
    check(fields(raw,['context','test','pairs']) && id(raw.test) &&
      Array.isArray(raw.pairs) && integer(raw.pairs.length,1,28),'Only contextual blind listening evidence can enter memory');
    const seen=new Set(), ctx=context(raw.context);
    const pairs=Array.from(raw.pairs,row=>{
      const checkCounts=tally=>Array.isArray(tally) && tally.length===3 && Array.from(tally).every(num=>integer(num,0,256)) &&
        integer(tally[0]+tally[1]+tally[2],1,256);
      check(fields(row,['moves','criteria']) && Array.isArray(row.moves) && row.moves.length===2 &&
        Array.from(row.moves).every(id) && row.moves[0]<row.moves[1] &&
        !seen.has(row.moves.join('/')) && fields(row.criteria,criteria) && Object.keys(row.criteria).length &&
        Object.values(row.criteria).every(checkCounts),'Invalid contextual pairwise evidence');
      seen.add(row.moves.join('/'));
      return {moves:row.moves.slice(),criteria:Object.fromEntries(criteria.filter(key=>Object.hasOwn(row.criteria,key))
        .map(key=>[key,row.criteria[key].slice()]))};
    }).sort((a,b)=>a.moves.join('/').localeCompare(b.moves.join('/')));
    return {context:ctx,test:raw.test,pairs};
  }

  function entry(raw) {
    const addr=raw?.focus;
    check(fields(raw,['id','title','reason','token','selected','focus','listening','excerpt']) && id(raw.id) &&
      (raw.selected===null ? raw.excerpt!==undefined : id(raw.selected)) &&
      R.prose(raw.title,160) && R.prose(raw.reason,2000) && typeof raw.token==='string' && /^test-[a-z0-9]+-[a-z0-9]+$/.test(raw.token) &&
      fields(addr,['fromBeat','toBeat','firstSample','endSample','start','end']) &&
      finite(addr.fromBeat,0,65536) && finite(addr.toBeat,addr.fromBeat,65536) && addr.toBeat>addr.fromBeat &&
      integer(addr.firstSample,0,192e6) && integer(addr.endSample,addr.firstSample+1,192e6) &&
      finite(addr.start,0,3600) && finite(addr.end,addr.start,3600) && addr.end>addr.start,
    'Invalid blind preference provenance or passage');
    const listening=heard(raw.listening);
    check(raw.selected===null || listening.pairs.some(({moves,criteria})=>moves.includes(raw.selected) &&
      Object.values(criteria).some(tally=>tally[moves.indexOf(raw.selected)]>0)),
    'The kept move needs support from a blind vote');
    const excerpt=raw.excerpt;
    if (excerpt!==undefined) {
      check(fields(excerpt,['question','criterion','range','sampleRate','takes','votes','sequence']) &&
        R.prose(excerpt.question,400) && criteria.includes(excerpt.criterion) && integer(excerpt.sampleRate,8000,48000) &&
        fields(excerpt.range,['start','end','firstSample','endSample','fromBeat','toBeat']) &&
        integer(excerpt.range.firstSample,0,addr.firstSample) && integer(excerpt.range.endSample,addr.endSample,192e6) &&
        finite(excerpt.range.start,0,addr.start) && finite(excerpt.range.end,addr.end,3600) &&
        finite(excerpt.range.fromBeat,0,addr.fromBeat) && finite(excerpt.range.toBeat,addr.toBeat,65536) &&
        P.musicInstruments.record(excerpt.takes) && Object.keys(excerpt.takes).length===2 &&
        Object.entries(excerpt.takes).every(([label,take])=>id(label) && fields(take,['move','audioHash','change']) &&
          id(take.move) && /^[a-z0-9]+$/.test(take.audioHash ?? '') && R.prose(take.change,640)) &&
        Array.isArray(excerpt.votes) && excerpt.votes.every(vote=>Object.keys(vote?.preferences ?? {}).join()===excerpt.criterion),
      'Invalid listening question or excerpt provenance');
      if (excerpt.sequence!==undefined) sequenceFrames(excerpt.sequence,excerpt.range);
      const labels=Object.fromEntries(Object.entries(excerpt.takes).map(([label,take])=>[label,take.move]));
      const {pairs}=ballots(labels,[{id:'pair-1',takes:Object.keys(labels)}],excerpt.votes);
      check(same(listening.pairs,pairs),'The archived listening counts must match the excerpt ballots');
    }
    return {id:raw.id,title:raw.title,reason:raw.reason,token:raw.token,selected:raw.selected,
      focus:{fromBeat:addr.fromBeat,toBeat:addr.toBeat,firstSample:addr.firstSample,endSample:addr.endSample,
        start:addr.start,end:addr.end},listening,...(excerpt && {excerpt})};
  }

  function store(raw={format,version:1,entries:[]}) {
    check(fields(raw,['format','version','entries']) && raw.format===format && raw.version===1 &&
      Array.isArray(raw.entries) && raw.entries.length<=256,'Expected a version 1 listening preference memory');
    const entries=Array.from(raw.entries,entry);
    check(new Set(entries.map(row=>row.token)).size===entries.length,'A blind test can enter preference memory once');
    return entries.sort((a,b)=>a.token.localeCompare(b.token));
  }

  function remember(raw,reference) {
    check(reference?.format===R.decisionFormat && reference.version===1 && reference.listening &&
      Array.isArray(reference.votes) && integer(reference.votes.length,1,256),
    'Remember a kept blind decision with listening context');
    const {labels,trials,...listening}=reference.listening;
    check(P.musicInstruments.record(labels) && Object.hasOwn(labels,reference.take) && labels[reference.take]===reference.move,
      'The remembered move must match the private blind label');
    const {pairs}=ballots(labels,trials,reference.votes);
    const observed=heard(listening);
    check(same(observed.pairs,heard({...listening,pairs}).pairs),'The recorded pair counts must match the blind ballots');
    return append(raw,entry({id:reference.id,title:reference.title,reason:reference.reason,
      token:reference.token,selected:reference.move,focus:reference.focus,listening:observed}));
  }

  function append(raw,next) {
    const entries=store(raw), prior=entries.find(row=>row.token===next.token);
    check(!prior || same(next,prior),'This blind test is already archived with a different decision');
    check(prior || entries.length<256,'Listening preference memory exceeds its test budget');
    if (!prior) entries.push(next);
    return P.data.freeze({format,version:1,entries:entries.sort((a,b)=>a.token.localeCompare(b.token))});
  }

  function sequenceFrames(raw,context) {
    const length=context.endSample-context.firstSample;
    if (raw===undefined) return length;
    check(Array.isArray(raw) && raw.length===2 && Array.from(raw).every(row=>
      fields(row,['range','firstFrame','endFrame']) && fields(row.range,['start','end','firstSample','endSample','fromBeat','toBeat']) &&
      integer(row.firstFrame,0,3e6) && integer(row.endFrame,row.firstFrame+8,3e6) &&
      integer(row.range.firstSample,0,192e6) && integer(row.range.endSample,row.range.firstSample+8,192e6) &&
      row.range.endSample-row.range.firstSample===row.endFrame-row.firstFrame) &&
      raw[0].firstFrame===0 && raw[0].endFrame===length && same(raw[0].range,context) &&
      raw[1].firstFrame>length && raw[1].range.firstSample>=context.endSample,
    'Invalid linked listening excerpt timing');
    return raw[1].endFrame;
  }

  function rememberBallot(raw,key,decision,audio) {
    const {test,labels,session,listeningContext,audioHashes}=key ?? {};
    check(key?.format==='ink-studio/blind-listening-key' && key.version===1 && test?.format==='ink-studio/blind-listening' &&
      P.musicInstruments.record(labels) && P.musicInstruments.record(audioHashes) && fields(audio,Object.keys(labels)) &&
      test.trials?.length===1 &&
      test.trials[0]?.id==='pair-1' && test.criteria?.length===1 && Array.isArray(session?.takes) &&
      fields(decision,['token','reason','votes']) && decision.token===test.token && R.prose(decision.reason,2000),
    'Archive a focused listening question with its blind key and ballot reason');
    const {pairs,votes}=ballots(labels,test.trials,decision.votes);
    const frames=sequenceFrames(test.sequence,test.range);
    for (const label of Object.keys(labels)) {
      const clip=P.mediaGraph.audio(audio[label]);
      check(clip.sampleRate===test.sampleRate && clip.channels===2 &&
        clip.samples.length===2*frames &&
        R.excerptHash(clip.samples)===audioHashes[label],'The archived audio must match the blind listening excerpt');
    }
    const takes=Object.fromEntries(Object.entries(labels).map(([label,move])=>
      [label,{move,audioHash:audioHashes[label],change:session.takes.find(row=>row.id===move)?.hypothesis}]));
    return append(raw,entry({id:test.id,title:test.question?.slice(0,160),reason:decision.reason,
      token:test.token,selected:null,focus:test.focus,listening:{context:listeningContext,test:test.id,pairs},
      excerpt:{question:test.question,criterion:test.criteria[0],range:test.range,sampleRate:test.sampleRate,takes,votes,...(test.sequence && {sequence:test.sequence})}}));
  }

  function recall(raw,query) {
    check(fields(query,['context','criterion','moves']) && criteria.includes(query.criterion ?? 'identity') &&
      (query.moves===undefined || Array.isArray(query.moves) && integer(query.moves.length,1,8) &&
        Array.from(query.moves).every(id) && new Set(query.moves).size===query.moves.length),'Invalid listening preference query');
    const here=context(query.context), criterion=query.criterion ?? 'identity', entries=store(raw);
    const matching=entries.filter(row=>Object.entries(row.listening.context).every(([key,value])=>here[key]===value));
    const available=query.moves && new Set(query.moves);
    const groups=new Map();
    let suppressed=0;
    for (const row of matching) for (const pair of row.listening.pairs) {
      if (!Object.hasOwn(pair.criteria,criterion) || available && !pair.moves.every(move=>available.has(move))) continue;
      const key=pair.moves.join('/'), specificity=Object.keys(row.listening.context).length;
      const group=groups.get(key);
      if (group && group.specificity>specificity) {suppressed++;continue;}
      if (!group || group.specificity<specificity) {
        suppressed+=group?.observations.length ?? 0;
        groups.set(key,{moves:pair.moves,specificity,observations:[]});
      }
      groups.get(key).observations.push({row,tally:pair.criteria[criterion]});
    }
    const ranking=new Map(), used=new Set();
    const pairs=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([,group])=>{
      const totals=[0,0,0], rationale=[];
      let score=0;
      for (const {row,tally} of group.observations) {
        used.add(row.token);
        for (let i=0;i<3;i++) totals[i]+=tally[i];
        score+=(tally[0]-tally[1])/(tally[0]+tally[1]+tally[2]);
        rationale.push({id:row.id,test:row.listening.test,token:row.token,title:row.title,selected:row.selected,
          reason:row.reason,context:row.listening.context,focus:row.focus,votes:tally,
          ...(row.excerpt && {excerpt:row.excerpt})});
      }
      score=round(score);
      for (const [i,move] of group.moves.entries()) {
        const row=ranking.get(move) ?? {move,score:0,wins:0,losses:0,ties:0,tests:new Set()};
        row.score+=i===0 ? score : -score;
        row.wins+=totals[i];
        row.losses+=totals[1-i];
        row.ties+=totals[2];
        for (const item of rationale) row.tests.add(item.token);
        ranking.set(move,row);
      }
      return {moves:group.moves,specificity:group.specificity,tests:rationale.length,
        votes:totals,margin:score,rationale};
    });
    const ranked=[...ranking.values()].map(({tests,...row})=>({...row,tests:tests.size,score:round(row.score)}))
      .sort((a,b)=>b.score-a.score || a.move.localeCompare(b.move));
    const top=ranked[0];
    const preferred=top?.score>0 && top.score>(ranked[1]?.score ?? 0) ? top.move : null;
    return {context:here,criterion,matchingTests:matching.length,usedTests:used.size,suppressed,preferred,ranking:ranked,pairs};
  }

  P.musicCritiqueMemory=Object.freeze({context,criteria,ballots,remember,rememberBallot,recall,format});
})(KIT.procedural);
