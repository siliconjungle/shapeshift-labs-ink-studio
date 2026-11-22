/* Derive recovery windows from terminal lifecycle receipts at the queue boundary. */
(function(K) {
  const W = K.world, Q = W.query, {check,record} = W.data, {freeze} = K.procedural.data;
  const {cooldownScopes,cooldownId} = StoryDocument;
  const scopes = ['world',...cooldownScopes];
  const scopeKey = (scope,id) => id===undefined?scope:scope+'/'+id;

  function compile(documents,dt) {
    const entries = [];
    for (const document of documents) for (const [story,definition] of Object.entries(document.stories)) {
      const raw = definition.lifecycle?.cooldown;
      if (!raw) continue;
      const ids = Object.fromEntries(cooldownScopes.filter(scope=>raw.scopes?.[scope])
        .map(scope=>[scope,[...raw.scopes[scope]].sort()]));
      const ticks = Object.fromEntries(scopes.filter(scope=>raw.for?.[scope]!==undefined).map(scope=>
        [scope,Math.max(1,W.storyTriggers.ticks(raw.for[scope],dt,Math.ceil,'Incident cooldown exceeds the world tick budget'))]));
      entries.push([document.id+'/'+story,{scopes:ids,ticks,on:raw.on??['completed','failed']}]);
    }
    if (!entries.length) return null;
    return freeze(Object.fromEntries(entries.sort(([a],[b])=>a<b?-1:a>b?1:0)));
  }

  function windows(policy,source,change,tick) {
    if (!change || !policy.on.includes(change.to)) return [];
    const from = change.tick+1;
    if (tick!==undefined&&tick<from) return [];
    return Object.entries(policy.ticks).flatMap(([scope,ticks])=>{
      const until = from+ticks;
      if (tick!==undefined&&tick>=until) return [];
      return (scope==='world'?[undefined]:policy.scopes[scope]).map(id=>
        ({scope,...(id!==undefined&&{id}),source,status:change.to,closedAt:change.tick,from,until}));
    });
  }

  function active(policies,lifecycle,tick) {
    const live = new Map();
    for (const [key,policy] of Object.entries(policies)) {
      for (const row of windows(policy,key,lifecycle[key]?.transitions.at(-1),tick)) {
        const slot = scopeKey(row.scope,row.id), previous = live.get(slot);
        if (!previous||row.until>previous.until) live.set(slot,row);
      }
    }
    return live;
  }

  function assess(policies,live,key,tick) {
    const ids = policies[key]?.scopes;
    const blocks = [live.get('world'),...Object.entries(ids??{}).flatMap(([scope,values])=>
      values.map(id=>live.get(scopeKey(scope,id))))].filter(Boolean);
    return freeze({tick,ready:!blocks.length,blocks,...(blocks.length&&{readyAt:Math.max(...blocks.map(row=>row.until))})});
  }

  function publish(policies,lifecycle,tick,emit) {
    for (const [source,policy] of Object.entries(policies)) {
      const change = lifecycle[source]?.transitions.at(-1);
      if (change?.tick!==tick) continue;
      const rows = windows(policy,source,change);
      if (!rows.length) continue;
      const [document,story] = source.split('/');
      emit('story-cooldown-started',{document,story,source,windows:rows});
    }
  }

  function inspect(policies,lifecycle,tick,args) {
    check(record(args)&&Object.keys(args).every(key=>['scope','id'].includes(key))&&
      (args.scope===undefined||scopes.includes(args.scope))&&
      (args.id===undefined||cooldownId(args.id)&&args.scope!=='world'),'Invalid incident cooldown filters');
    if (!policies) return Q.missing('World has no incident cooldown policy','missing');
    const rows = [...active(policies,lifecycle,tick).entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,row])=>row);
    const scheduled = Object.entries(policies).flatMap(([key,policy])=>{
      const change = lifecycle[key]?.transitions.at(-1);
      return change?.tick===tick?windows(policy,key,change):[];
    });
    const matches = row => (args.scope===undefined||row.scope===args.scope)&&(args.id===undefined||row.id===args.id);
    return Q.ok(freeze({tick,active:rows.filter(matches),scheduled:scheduled.filter(matches)}));
  }

  W.incidentCooldowns = Object.freeze({compile,active,assess,publish,inspect});
})(KIT);
