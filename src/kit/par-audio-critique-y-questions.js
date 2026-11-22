/* Ask for the listening judgments most likely to affect an unresolved decision. */
(function (P) {
  const M=P.musicCritiqueMemory, R=P.musicCritiqueReferences;
  const {fields,record,id,integer,finite,check}=P.musicInstruments;
  const round=n=>Number(n.toFixed(8));
  const entropy=counts=>{
    const total=counts.reduce((sum,n)=>sum+n,0);
    return -counts.reduce((sum,n)=>sum+(n/total)*Math.log(n/total),0);
  };

  // One prospective ballot can favor either side or report a tie.
  function information(votes) {
    const posterior=votes.map(n=>n+1), total=posterior.reduce((sum,n)=>sum+n,0);
    return entropy(posterior)-posterior.reduce((sum,n,i)=>sum+n/total*
      entropy(posterior.map((prior,j)=>prior+Number(i===j))),0);
  }

  function prioritize(blind,source,requests,memory,assets={},options={}) {
    check(Array.isArray(requests) && integer(requests.length,1,16) &&
      new Set(requests.map(row=>row?.id)).size===requests.length &&
      fields(options,['budget','seed','target','ceiling','minDifference']) &&
      integer(options.budget ?? 2,1,8) && Number.isSafeInteger(options.seed ?? 0) &&
      finite(options.target ?? -18,-35,-9) && finite(options.ceiling ?? -1.2,-8,-.1) &&
      finite(options.minDifference ?? .005,0,.25),'Prioritize up to sixteen listening questions with a bounded ballot budget');
    const queue=[], coverage=new Map(), previous=new Set(), audioKeys=new Set();
    const choices=Array.from(requests,row=>{
      check(fields(row,['id','plan','criterion','question','impacts','moves','later']) && id(row.id) && M.criteria.includes(row.criterion) &&
        R.prose(row.question,400) && record(row.impacts) && integer(Object.keys(row.impacts).length,1,12) &&
        Object.entries(row.impacts).every(([key,weight])=>id(key) && finite(weight,.1,10)) &&
        row.plan?.format==='ink-studio/critique-plan' && row.plan.version===1 &&
        Array.isArray(row.plan.session?.takes) && integer(row.plan.session.takes.length,2,8),
      'Give each listening question a plan, criterion and weighted downstream decisions');
      const names=row.plan.session.takes.map(take=>take.id), moves=row.moves ?? names;
      check(Array.isArray(moves) && integer(moves.length,2,names.length) &&
        new Set(moves).size===moves.length && Array.from(moves).every(name=>names.includes(name)),
      'The eligible moves must belong to the listening plan');
      const here=M.context(row.plan.listeningContext);
      const evidence=M.recall(memory,{context:here,criterion:row.criterion,moves});
      const ordered=moves.slice().sort();
      for (const [i,left] of ordered.entries()) for (const right of ordered.slice(i+1)) {
        const pair=evidence.pairs.find(value=>value.moves[0]===left && value.moves[1]===right);
        const votes=pair?.votes ?? [0,0,0];
        queue.push({request:row.id,context:here,moves:[left,right],votes,similarTests:pair?.tests ?? 0,
          information:round(information(votes)),impacts:row.impacts,criterion:row.criterion});
      }
      return row;
    });
    const tests={}, selected=[], skipped=[];
    const {budget=2,seed=0,target,ceiling,minDifference=.005}=options;
    const value=row=>Object.entries(row.impacts).reduce((sum,[name,w])=>sum+w/(1+3*(coverage.get(name) ?? 0)),0);
    let attempted=0, frames=0;
    while (queue.length && selected.length<budget && attempted<budget*4) {
      queue.sort((a,b)=>b.information*value(b)-a.information*value(a) || a.request.localeCompare(b.request) ||
        a.moves.join('/').localeCompare(b.moves.join('/')));
      const row=queue.shift(), request=choices.find(item=>item.id===row.request);
      const takes=request.plan.session.takes.filter(take=>row.moves.includes(take.id))
        .map(take=>[take.id,take.components.map(part=>part.revision)]);
      const key=JSON.stringify([row.context,row.criterion,takes,request.plan.evidence?.context,request.later]);
      if (previous.has(key)) continue;
      previous.add(key);
      const context=request.plan.evidence?.context;
      check(context && integer(context.firstSample,0,192e6) && integer(context.endSample,context.firstSample+1,192e6),
        'Listening plan needs an addressed comparison range');
      // The producer may also render the reference for a comparison of two edits.
      frames+=(context.endSample-context.firstSample)*3;
      check(frames<=20e6,'Prioritized listening exceeds the comparison render budget');
      attempted++;
      const pack=blind(source,request.plan,assets,{id:request.id,seed:P.data.hash(JSON.stringify([seed,row.request,row.moves])),
        moves:row.moves,criterion:row.criterion,question:request.question,later:request.later,...(target!==undefined && {target}),
        ...(ceiling!==undefined && {ceiling})});
      if (pack.test.sequence) {
        frames+=2*pack.test.sequence.at(-1).endFrame;
        check(frames<=20e6,'Prioritized listening exceeds the comparison render budget');
      }
      const [a,b]=Object.values(pack.audio).map(clip=>clip.samples);
      let error=0,power=0;
      for (let i=0;i<a.length;i++) {
        error+=(a[i]-b[i])**2;
        power+=(a[i]**2+b[i]**2)/2;
      }
      const difference=round(Math.sqrt(error/Math.max(power,1e-15)));
      const fingerprint=JSON.stringify([row.criterion,Object.values(pack.key.audioHashes).sort()]);
      if (difference<=minDifference || audioKeys.has(fingerprint)) {
        skipped.push({request:row.request,moves:row.moves,difference,reason:difference<=minDifference ?
          'negligible-rendered-difference' : 'same-rendered-pair'});
        continue;
      }
      audioKeys.add(fingerprint);
      const name='question-'+(selected.length+1);
      selected.push({id:name,...row,question:request.question,priority:round(row.information*value(row)),
        difference,range:pack.test.range,token:pack.test.token});
      tests[name]=pack;
      for (const impact of Object.keys(row.impacts)) coverage.set(impact,(coverage.get(impact) ?? 0)+1);
    }
    return {report:{format:'ink-studio/listening-question-queue',version:1,budget,attempted,selected,skipped,
      remaining:queue.length,covered:Object.fromEntries(coverage)},tests};
  }
  P.musicCritiqueQuestions=Object.freeze({prioritize});
})(KIT.procedural);
