/* Stable situation identities and recent-dispatch preferences for the storyteller. */
(function(K) {
  const W = K.world, Q = W.query, {check,equal,own,record} = W.data, {freeze,hash} = K.procedural.data;
  const axes = ['cast','location','family','situation'];
  const scopeNames = {cast:'character',location:'location',family:'family'};
  const compare = (a,b)=>a<b?-1:a>b?1:0;

  function policy(raw,place) {
    if (raw===undefined) return undefined;
    check(record(raw)&&Object.keys(raw).length>0&&Object.entries(raw).every(([axis,count])=>
      axes.includes(axis)&&Number.isSafeInteger(count)&&count>=1&&count<=32),
    place+' variety needs cast, location, family or situation windows of 1–32 dispatches');
    return Object.fromEntries(axes.filter(axis=>own(raw,axis)).map(axis=>[axis,raw[axis]]));
  }

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!record(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  }

  function recipe(definition,types) {
    const life = definition.lifecycle;
    if (!life) return undefined;
    const {progression,commitment,handoffs,settlement,feasibility,liveReferences,cleanup,deadlines} = life;
    let stages, mechanical = Boolean(commitment||settlement||feasibility);
    if (progression) {
      stages = Object.fromEntries(Object.entries(definition.stages).map(([id,stage])=>{
        const objectives = Object.fromEntries(Object.entries(stage.objectives??{}).map(([key,objective])=>{
          const rule = StoryDocument.objectiveRule(objective,types);
          if (rule) mechanical = true;
          const mechanics = rule?.options?{type:rule.type,options:Object.keys(rule.options).sort()}:rule;
          return [key,{optional:objective.optional??false,...mechanics}];
        }));
        if (stage.beat||stage.decision) mechanical = true;
        return [id,{next:stage.next,objectives,beat:stage.beat,decision:stage.decision}];
      }));
    }
    if (!mechanical) return undefined;
    const triggers = Object.values(definition.triggers??{}).map(rule=>JSON.stringify(canonical(rule))).sort();
    const outcomes = Object.fromEntries(Object.entries(definition.outcomes).map(([id,outcome])=>[id,outcome.status??'completed']));
    return JSON.stringify(canonical({triggers,entry:stages&&definition.entry,stages,outcomes,
      activation:life.activation??'automatic',commitment,handoffs,settlement,feasibility,liveReferences,cleanup,deadlines}));
  }

  function compile(documents) {
    const entries = [], signatures = new Map();
    for (const doc of documents) for (const [story,definition] of Object.entries(doc.stories)) {
      if (definition.kind!=='incident') continue;
      const authored = definition.incident?.variety, scopes = definition.lifecycle?.cooldown?.scopes;
      const identity = {};
      for (const axis of Object.keys(scopeNames)) {
        const ids = authored?.[axis]??scopes?.[scopeNames[axis]];
        if (ids) identity[axis] = [...ids].sort();
      }
      if (authored?.situation) identity.situation = {source:'authored',id:authored.situation};
      else {
        const signature = recipe(definition,doc.objectiveTypes);
        if (signature!==undefined) {
          const digest = hash(signature).toString(16).padStart(8,'0');
          if (!signatures.has(digest)) signatures.set(digest,new Map());
          const group = signatures.get(digest);
          if (!group.has(signature)) group.set(signature,[]);
          group.get(signature).push(identity);
        }
      }
      entries.push([doc.id+'/'+story,identity]);
    }
    // A collision gets distinct IDs. Only equal canonical recipes share an inferred situation.
    for (const [digest,group] of signatures) {
      [...group.keys()].sort().forEach((signature,index)=>{
        const id = group.size===1?digest:digest+'-'+(index+1);
        for (const identity of group.get(signature)) identity.situation = {source:'mechanics',id};
      });
    }
    const identities = Object.fromEntries(entries.filter(([,identity])=>Object.keys(identity).length)
      .sort(([a],[b])=>compare(a,b)));
    if (!Object.keys(identities).length) return null;
    const groups = new Map();
    for (const [incident,{situation}] of Object.entries(identities)) {
      if (!situation) continue;
      const key = situation.source+'/'+situation.id;
      if (!groups.has(key)) groups.set(key,{situation,incidents:[]});
      groups.get(key).incidents.push(incident);
    }
    const repeats = [...groups.values()].filter(group=>group.incidents.length>1);
    return freeze({identities,repeats});
  }

  function prior(state,tick,limit) {
    return Object.values(state).filter(row=>row.status==='dispatched'&&
      (row.terminal.tick<tick||row.terminal.tick===tick&&row.storyteller?.mode==='manual'))
      .sort((a,b)=>b.terminal.tick-a.terminal.tick||compare(a.candidate,b.candidate)).slice(0,limit)
      .map(row=>({candidate:row.candidate,tick:row.terminal.tick}));
  }

  function matches(axis,identity,other) {
    const value = identity?.[axis], recent = other?.[axis];
    if (!value||!recent) return false;
    return axis==='situation'?equal(value,recent):value.some(id=>recent.includes(id));
  }

  function rank(settings,model,state,eligible,tick) {
    const history = prior(state,tick,Math.max(...Object.values(settings)));
    const identity = key=>model?.identities[key];
    const considered = eligible.map(key=>state[key]).sort(W.incidentSelection.before).map(({candidate})=>{
      const repeated = {}, subject = identity(candidate);
      let total = 0;
      for (const [axis,limit] of Object.entries(settings)) {
        const same = history.slice(0,limit).flatMap((row,index)=>matches(axis,subject,identity(row.candidate))?[index]:[]);
        if (same.length) repeated[axis] = same;
        total += same.length;
      }
      return {candidate,repeated,score:{situation:repeated.situation?.length??0,total}};
    });
    const priority = (a,b)=>a.situation-b.situation||a.total-b.total;
    const best = considered.reduce((min,row)=>!min||priority(row.score,min)<0?row.score:min,null);
    return freeze({tick,history,considered,preferred:considered.filter(row=>priority(row.score,best)===0).map(row=>row.candidate)});
  }

  function deferred(receipt) {
    const preferred = new Set(receipt.preferred);
    return new Set(receipt.considered.filter(row=>!preferred.has(row.candidate)).map(row=>row.candidate));
  }

  function validate(settings,model,state,selectionFor,canSelect,cooldownAt) {
    const decisions = new Map(), rows = Object.values(state);
    for (const row of rows) {
      const receipt = row.variety, message = 'Invalid saved variety decision for '+row.candidate;
      if (!settings||row.storyteller?.mode!=='automatic') {
        check(receipt===undefined,message);
        continue;
      }
      const {tick} = row.terminal;
      check(record(receipt)&&Array.isArray(receipt.considered)&&receipt.considered.length<=rows.length,message);
      const eligible = new Set(receipt.considered.map(entry=>entry?.candidate));
      const pending = rows.filter(item=>item.queuedAt<=tick&&tick<item.expiresAt&&
        (!item.terminal||item.terminal.tick>tick||item===row));
      const pendingIds = new Set(pending.map(item=>item.candidate));
      check([...eligible].every(key=>pendingIds.has(key)),message);
      for (const item of pending) {
        const key = item.candidate, current = item.report.tick===tick;
        const cooling = (current?item.cooldown:cooldownAt(key,tick))?.ready===false;
        const possible = canSelect(key)&&selectionFor(key)?.weight!==0&&!cooling&&(!current||item.report.ready);
        if (!possible||current&&item.pressure?.ready!==false) check(eligible.has(key)===possible,message);
      }
      const expected = rank(settings,model,state,[...eligible],tick);
      check(equal(receipt,expected)&&expected.preferred.includes(row.candidate),message);
      decisions.set(tick,deferred(expected));
    }
    return decisions;
  }

  function inspect(model,settings,state,tick) {
    if (!model&&!settings) return Q.missing('World has no incident variety data','missing');
    const dispatches = Object.values(state??{}).filter(row=>row.variety).sort((a,b)=>a.terminal.tick-b.terminal.tick);
    const last = dispatches.at(-1);
    return Q.ok(freeze({tick,policy:settings??null,identities:model?.identities??{},repeats:model?.repeats??[],
      ...(last&&{last:{winner:last.candidate,...last.variety}})}));
  }

  W.incidentVariety = Object.freeze({policy,compile,rank,deferred,validate,inspect});
})(KIT);
