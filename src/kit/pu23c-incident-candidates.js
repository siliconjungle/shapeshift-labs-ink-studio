/* Hold triggered incident opportunities until released or expired at the world boundary. */
(function(K) {
  const W = K.world, Q = W.query, {check,own,record,equal} = W.data, {freeze} = K.procedural.data;
  const action = 'dispatch-candidate';
  const fields = (value,names) => record(value)&&Object.keys(value).every(key=>names.includes(key));
  const reasonOK = value => typeof value==='string'&&value.length<=256&&value.trim().length>0;
  const before = (a,b) => a.queuedAt-b.queuedAt||(a.candidate<b.candidate?-1:a.candidate>b.candidate?1:0);
  const waiting = row => ['blocked','ready'].includes(row.status);
  const due = (spec,at) => Math.min(at+spec.policy.windowTicks,spec.policy.worldDeadlineTick??Infinity);
  const expiryReason = (spec,row) => row.expiresAt===spec.policy.worldDeadlineTick?'world-deadline':'candidate-timeout';

  function compile(documents,dt,feasibility) {
    const specs = new Map(), inbound = new Set();
    for (const document of documents) for (const [story,definition] of Object.entries(document.stories)) {
      const config = definition.lifecycle?.candidate;
      if (!config) continue;
      const key = document.id+'/'+story, {for:seconds,release='manual',onExpire} = config;
      const windowTicks = Math.max(1,W.storyTriggers.ticks(seconds,dt,Math.ceil,'Candidate window exceeds the world tick budget'));
      const worldDeadlineTick = W.storyDeadlines.compile(definition.lifecycle,dt)?.world;
      const target = onExpire===undefined?undefined:onExpire.includes('/')?onExpire:document.id+'/'+onExpire;
      const info = {document:document.id,story,storyKind:definition.kind,...(definition.incident&&{incident:definition.incident})};
      const policy = {windowTicks,release,...(target&&{onExpire:target}),...(worldDeadlineTick!==undefined&&{worldDeadlineTick})};
      specs.set(key,{policy,info,triggers:definition.triggers,rules:feasibility?.[key]??{}});
    }
    if (!specs.size) return null;
    const visiting = new Set(), visited = new Set();
    function visit(key) {
      if (visited.has(key)) return;
      check(!visiting.has(key),'Candidate follow-up cycle at '+key);
      visiting.add(key);
      const target = specs.get(key).policy.onExpire;
      if (target) {
        check(specs.has(target),'Unknown queued follow-up '+target+' for '+key);
        inbound.add(target);
        visit(target);
        check(!specs.get(target).triggers,'Candidate follow-up must use the expired candidate as its trigger: '+target);
      }
      visiting.delete(key);
      visited.add(key);
    }
    for (const key of specs.keys()) visit(key);
    for (const [key,spec] of specs)
      check(spec.triggers||inbound.has(key),'Candidate needs an authored trigger or an incoming follow-up: '+key);
    const policies = freeze(Object.fromEntries([...specs.keys()].sort().map(key=>[key,specs.get(key).policy])));

    function checkAction(args) {
      check(fields(args,['incident','reason'])&&specs.has(args.incident)&&reasonOK(args.reason),
        'Candidate dispatch needs a registered incident and a reason');
    }

    function advance(previous,starts,commands,tick,query,lifecycle,emit) {
      const state = {...previous}, released = {}, normal = [];
      function publish(say,kind,row,details={}) {
        say('story-candidate-'+kind,{...specs.get(row.candidate).info,candidate:row.candidate,...details});
      }
      function canQueue(key) {
        return !own(state,key)&&!lifecycle[key]&&tick<(specs.get(key).policy.worldDeadlineTick??Infinity);
      }
      function enqueue(key,origin,source) {
        const row = {candidate:key,queuedAt:tick,expiresAt:due(specs.get(key),tick),origin,status:'blocked',...(source&&{source})};
        state[key] = row;
        publish(emit,'queued',row,{queuedAt:tick,expiresAt:row.expiresAt,origin,...(source&&{source})});
      }
      function dispatch(row,reason,say) {
        const {candidate:key,queuedAt,source,report} = row;
        const terminal = {tick,reason};
        state[key] = {...row,status:'dispatched',terminal};
        released[key] = {queuedAt,source,report};
        publish(say,'dispatched',row,{queuedAt,report,terminal});
      }
      for (const start of starts) {
        const key = start.document+'/'+start.story;
        if (!specs.has(key)) normal.push(start);
        else if (canQueue(key)) enqueue(key,{kind:'trigger'},{trigger:start.trigger,evidence:start.evidence});
      }
      for (const row of Object.values(state).filter(waiting).sort(before)) {
        if (tick<row.expiresAt) continue;
        const spec = specs.get(row.candidate), target = spec.policy.onExpire;
        const followUp = target?{incident:target,status:canQueue(target)?'queued':own(state,target)?'already-queued':'closed'}:undefined;
        const terminal = {tick,reason:expiryReason(spec,row)};
        state[row.candidate] = {...row,status:'expired',terminal,...(followUp&&{followUp})};
        publish(emit,'expired',row,{queuedAt:row.queuedAt,terminal,...(followUp&&{followUp})});
        if (followUp?.status==='queued') enqueue(target,{kind:'follow-up',incident:row.candidate});
      }
      const ready = [];
      for (const row of Object.values(state).filter(waiting).sort(before)) {
        const report = W.storyFeasibility.evaluate(specs.get(row.candidate).rules,tick,query());
        const status = report.ready?'ready':'blocked', next = {...row,status,report};
        state[row.candidate] = next;
        if (row.status!==status||!row.report) publish(emit,'checked',row,{status,report});
        if (report.ready) ready.push(row.candidate);
      }
      for (const {args,publish:say} of commands) {
        const row = state[args.incident];
        if (row?.status==='ready') dispatch(row,args.reason,say);
        else publish(say,'rejected',{candidate:args.incident},{reason:row?'candidate-'+row.status:'candidate-not-queued',
          requestedReason:args.reason});
      }
      for (const key of ready) if (state[key].status==='ready'&&specs.get(key).policy.release==='automatic')
        dispatch(state[key],'automatic-release',emit);
      return {state:freeze(state),starts:normal,released};
    }

    function validate(state,tick,triggers,lifecycle,gates) {
      check(record(state)&&Object.keys(state).length<=specs.size,'Invalid saved incident candidate queue');
      const tickOK = value=>Number.isSafeInteger(value)&&value>0&&value<=tick;
      for (const [key,spec] of specs) {
        const row = state[key], start = triggers?.[key]?.start, story = lifecycle[key];
        const message = 'Invalid saved incident candidate '+key;
        const offered = Boolean(story&&(story.dropped||story.transitions[0].to==='available'));
        if (!own(state,key)) {
          check(!offered&&(!start||start.tick>=(spec.policy.worldDeadlineTick??Infinity)),message);
          continue;
        }
        check(fields(row,['candidate','queuedAt','expiresAt','origin','source','status','report','terminal','followUp'])&&
          row.candidate===key&&tickOK(row.queuedAt)&&row.expiresAt===due(spec,row.queuedAt)&&row.expiresAt>row.queuedAt&&
          fields(row.origin,['kind','incident'])&&W.storyFeasibility.validReport(row.report,spec.rules,row.queuedAt,tick),message);
        if (spec.triggers) check(row.origin.kind==='trigger'&&row.origin.incident===undefined&&start?.tick===row.queuedAt&&
          start.trigger===row.source?.trigger&&W.storyTriggers.validEvidence(spec.triggers,row.source,row.queuedAt),message);
        else {
          const parent = state[row.origin.incident];
          check(row.origin.kind==='follow-up'&&row.source===undefined&&parent?.status==='expired'&&parent.terminal?.tick===row.queuedAt&&
            equal(parent.followUp,{incident:key,status:'queued'}),message);
        }
        check(offered===(row.status==='dispatched'),message);
        if (waiting(row)) {
          check(row.expiresAt>tick&&row.report.tick===tick&&row.report.ready===(row.status==='ready')&&
            row.terminal===undefined&&row.followUp===undefined,message);
          continue;
        }
        check(fields(row.terminal,['tick','reason'])&&tickOK(row.terminal.tick)&&reasonOK(row.terminal.reason),message);
        if (row.status==='dispatched') {
          check(row.report.ready&&row.report.tick===row.terminal.tick&&row.terminal.tick<row.expiresAt&&row.followUp===undefined&&
            (story.dropped||story.transitions[0].tick===row.terminal.tick&&story.transitions[0].reason==='candidate-dispatched')&&
            equal(story.source,row.source)&&(!Object.keys(spec.rules).length||equal(gates?.[key]?.report,row.report)),message);
          continue;
        }
        check(row.status==='expired'&&row.terminal.tick===row.expiresAt&&row.report.tick===row.expiresAt-1&&
          row.terminal.reason===expiryReason(spec,row),message);
        const target = spec.policy.onExpire, link = row.followUp;
        if (!target) check(link===undefined,message);
        else {
          const next = state[target], at = row.terminal.tick;
          check(fields(link,['incident','status'])&&link.incident===target&&
            (link.status==='queued'?next?.origin.incident===key&&next.queuedAt===at:
              link.status==='already-queued'?next&&next.queuedAt<=at:
                link.status==='closed'&&at>=specs.get(target).policy.worldDeadlineTick),message);
        }
      }
      check(Object.keys(state).every(key=>specs.has(key)),'Unknown saved incident candidate');
    }
    return {policies,initial:()=>freeze({}),advance,validate,checkAction};
  }

  function inspect(policies,state,tick,args) {
    check(fields(args,['incident']),'Invalid incident candidate filter');
    if (args.incident!==undefined&&!own(policies,args.incident)) return Q.missing('Unknown queued incident','missing');
    const ready = [], blocked = [], closed = [];
    for (const row of Object.values(state??{}).sort(before)) {
      if (args.incident!==undefined&&args.incident!==row.candidate) continue;
      const list = row.status==='ready'?ready:row.status==='blocked'?blocked:closed;
      list.push(row);
    }
    return Q.ok({tick,ready,blocked,closed});
  }

  W.incidentCandidates = Object.freeze({action,compile,inspect});
})(KIT);
