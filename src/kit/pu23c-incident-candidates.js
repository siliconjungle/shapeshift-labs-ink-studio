/* Hold triggered incident opportunities until released or expired at the world boundary. */
(function(K) {
  const W = K.world, Q = W.query, {check,own,record,equal} = W.data, {freeze} = K.procedural.data;
  const action = 'dispatch-candidate';
  const fields = (value,names) => record(value)&&Object.keys(value).every(key=>names.includes(key));
  const reasonOK = value => typeof value==='string'&&value.length<=256&&value.trim().length>0;
  const waiting = row => ['blocked','ready'].includes(row.status);
  const cutoff = ({policy}) => Math.min(policy.worldDeadlineTick??Infinity,policy.anchor?.window?.closesBefore??Infinity);
  const due = (spec,at) => Math.min(Math.max(at,spec.policy.anchor?.window?.opensAt??at)+spec.policy.windowTicks,cutoff(spec));
  const admissible = row => row.report.ready&&(row.pressure?.ready??true)&&(row.cooldown?.ready??true)&&(row.anchor?.ready??true);
  const expiryReason = (spec,row) => row.expiresAt===spec.policy.worldDeadlineTick?'world-deadline':
    row.expiresAt===spec.policy.anchor?.window?.closesBefore?'anchor-window-missed':'candidate-timeout';

  function compile(documents,world,systems,feasibility,cooldownPolicies,storyteller,varietyModel) {
    const {before,select,validate:validateSelections} = W.incidentSelection;
    const {dt,seed,incidentPressure:pressureConfig} = world;
    const compileAnchor = W.incidentAnchors.compiler(world,systems);
    const specs = new Map(), inbound = new Set();
    for (const document of documents) for (const [story,definition] of Object.entries(document.stories)) {
      const config = definition.lifecycle?.candidate;
      if (!config) continue;
      const key = document.id+'/'+story, {for:seconds,release='manual',onExpire,selection,pressure} = config;
      const windowTicks = Math.max(1,W.storyTriggers.ticks(seconds,dt,Math.ceil,'Candidate window exceeds the world tick budget'));
      const worldDeadlineTick = W.storyDeadlines.compile(definition.lifecycle,dt)?.world;
      const anchor = compileAnchor(config.anchor,worldDeadlineTick,key);
      const target = onExpire===undefined?undefined:onExpire.includes('/')?onExpire:document.id+'/'+onExpire;
      const info = {document:document.id,story,storyKind:definition.kind,...(definition.incident&&{incident:definition.incident})};
      const policy = {windowTicks,release,...(pressure&&{pressure}),...(selection&&{selection}),...(target&&{onExpire:target}),
        ...(worldDeadlineTick!==undefined&&{worldDeadlineTick}),...(anchor&&{anchor})};
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
    for (const [key,spec] of specs) {
      const anchor = spec.policy.anchor;
      check(spec.triggers||inbound.has(key)||anchor,'Candidate needs an authored trigger or an incoming follow-up: '+key);
      if (anchor&&!spec.triggers&&!inbound.has(key)) anchor.queueAt = anchor.window?.opensAt??1;
    }
    const policies = freeze(Object.fromEntries([...specs.keys()].sort().map(key=>[key,specs.get(key).policy])));
    const schedule = Object.entries(policies).filter(([,policy])=>policy.anchor);
    const anchors = schedule.length?freeze(Object.fromEntries(schedule.map(([key,policy])=>[key,
      {...policy.anchor,...(policy.worldDeadlineTick!==undefined&&{worldDeadlineTick:policy.worldDeadlineTick})}]))):undefined;

    const pressurePolicy = W.incidentPressure.compile(pressureConfig,policies);
    const direction = storyteller&&W.storyteller.candidates(storyteller,specs);
    const varietyPolicy = storyteller?.profiles[storyteller.active].variety;
    const selectionFor = key => direction?direction[key]?.selection:specs.get(key).policy.selection;
    const canSelect = key => !policies[key].anchor&&(!direction||direction[key]?.withinChallenge===true);

    function checkAction(args) {
      check(fields(args,['incident','reason'])&&specs.has(args.incident)&&reasonOK(args.reason),
        'Candidate dispatch needs a registered incident and a reason');
    }

    function cooldownReports(lifecycle) {
      let reportTick, live;
      return (key,tick) => {
        if (!cooldownPolicies) return undefined;
        if (reportTick!==tick) {
          reportTick = tick;
          live = W.incidentCooldowns.active(cooldownPolicies,lifecycle,tick);
        }
        return W.incidentCooldowns.assess(cooldownPolicies,live,key,tick);
      };
    }

    function advance(previous,starts,commands,tick,query,lifecycle,emit,capture) {
      const state = {...previous}, released = {}, normal = [];
      const budget = pressurePolicy&&W.incidentPressure.begin(pressurePolicy,lifecycle);
      const cooldownAt = cooldownReports(lifecycle);
      const previousAutomaticAt = storyteller?W.storyteller.lastAutomatic(previous):null;
      function checkReadiness(row,report) {
        const pressure = budget?.assess(row.candidate,tick);
        const cooldown = row.cooldown?.tick===tick?row.cooldown:cooldownAt(row.candidate,tick);
        const anchorPolicy = policies[row.candidate].anchor;
        const anchor = anchorPolicy&&(row.anchor?.tick===tick?row.anchor:W.incidentAnchors.gate(anchorPolicy,tick,query));
        const readiness = {report,...(pressure&&{pressure}),...(cooldown&&{cooldown}),...(anchor&&{anchor})};
        const status = admissible(readiness)?'ready':'blocked';
        const next = {...row,...readiness,status};
        state[row.candidate] = next;
        if (row.status!==status||!row.report||!equal(row.cooldown?.blocks,cooldown?.blocks)||row.anchor?.reason!==anchor?.reason)
          publish(emit,'checked',row,{status,...readiness});
        return next;
      }
      function publish(say,kind,row,details={}) {
        say('story-candidate-'+kind,{...specs.get(row.candidate).info,candidate:row.candidate,...details});
      }
      function canQueue(key) {
        return !own(state,key)&&!lifecycle[key]&&tick<cutoff(specs.get(key));
      }
      function enqueue(key,origin,source) {
        const row = {candidate:key,queuedAt:tick,expiresAt:due(specs.get(key),tick),origin,status:'blocked',...(source&&{source})};
        state[key] = row;
        publish(emit,'queued',row,{queuedAt:tick,expiresAt:row.expiresAt,origin,...(source&&{source})});
      }
      function dispatch(row,reason,say,mode,selection,variety) {
        const {candidate:key,queuedAt,source,report} = row;
        const terminal = {tick,reason};
        const pacing = storyteller&&{storyteller:W.storyteller.receipt(storyteller,mode,previousAutomaticAt,tick)};
        state[key] = {...row,status:'dispatched',terminal,...(selection&&{selection}),...(variety&&{variety}),...pacing};
        released[key] = {queuedAt,source,report};
        publish(say,'dispatched',row,{queuedAt,report,terminal,...(row.pressure&&{pressure:row.pressure}),
          ...(row.cooldown&&{cooldown:row.cooldown}),...(row.anchor&&{anchor:row.anchor}),...(variety&&{variety}),...pacing});
        if (budget) {
          budget.reserve(key);
          for (const pending of Object.values(state).filter(waiting).sort(before)) checkReadiness(pending,pending.report);
        }
      }
      for (const start of starts) {
        const key = start.document+'/'+start.story;
        if (!specs.has(key)) normal.push(start);
        else if (canQueue(key)) enqueue(key,{kind:'trigger'},{trigger:start.trigger,evidence:start.evidence});
      }
      for (const [key,policy] of schedule)
        if (policy.anchor.queueAt===tick&&canQueue(key)) enqueue(key,{kind:'anchor'});
      for (const row of Object.values(state).filter(waiting).sort(before)) {
        if (tick<row.expiresAt) continue;
        const spec = specs.get(row.candidate), target = spec.policy.onExpire;
        const followUp = target?{incident:target,status:canQueue(target)?'queued':own(state,target)?'already-queued':'closed'}:undefined;
        const terminal = {tick,reason:expiryReason(spec,row)};
        state[row.candidate] = {...row,status:'expired',terminal,...(followUp&&{followUp})};
        publish(emit,'expired',row,{queuedAt:row.queuedAt,terminal,...(followUp&&{followUp}),...(row.anchor&&{anchor:row.anchor})});
        if (followUp?.status==='queued') enqueue(target,{kind:'follow-up',incident:row.candidate});
      }
      const ready = [];
      for (const row of Object.values(state).filter(waiting).sort(before)) {
        const evaluated = checkReadiness(row,W.storyFeasibility.evaluate(specs.get(row.candidate).rules,tick,query()));
        if (evaluated.status==='ready'&&specs.get(row.candidate).policy.release==='automatic'&&canSelect(row.candidate))
          ready.push(row.candidate);
      }
      for (const {args,publish:say} of commands) {
        const row = state[args.incident];
        if (policies[args.incident].anchor) {
          publish(say,'rejected',{candidate:args.incident},{reason:'authored-anchor-managed',requestedReason:args.reason});
        } else if (row?.status==='ready') dispatch(row,args.reason,say,'manual');
        else {
          const feasible = row?.status==='blocked'&&row.report.ready;
          const cooling = feasible&&row.cooldown?.ready===false, overBudget = feasible&&row.pressure?.ready===false;
          const reason = cooling?'incident-cooling-down':overBudget?'pressure-budget-exhausted':
            row?'candidate-'+row.status:'candidate-not-queued';
          publish(say,'rejected',{candidate:args.incident},{reason,requestedReason:args.reason,
            ...(overBudget&&{pressure:row.pressure}),...(cooling&&{cooldown:row.cooldown})});
        }
      }
      if (capture) capture.checked = {...state};
      const pinned = schedule.map(([key])=>state[key]).filter(row=>row?.status==='ready')
        .sort((a,b)=>a.expiresAt-b.expiresAt||before(a,b))[0];
      if (pinned) {
        if (capture) capture.hold = {code:'anchor-priority',candidate:pinned.candidate};
        dispatch(pinned,W.incidentAnchors.reason,emit,'automatic');
        return {state:freeze(state),starts:normal,released};
      }
      if (storyteller) {
        const next = W.storyteller.nextAt(storyteller,previousAutomaticAt);
        if (next!==null&&tick<next) {
          if (capture) capture.hold = {code:'cadence',opensAt:next};
          return {state:freeze(state),starts:normal,released};
        }
        const reserved = anchors&&W.incidentAnchors.reservation(anchors,state,tick,W.storyteller.nextAt(storyteller,tick));
        if (reserved) {
          if (capture) capture.hold = {code:'anchor-reservation',...reserved};
          return {state:freeze(state),starts:normal,released};
        }
      }
      const variety = varietyPolicy&&W.incidentVariety.rank(varietyPolicy,varietyModel,state,
        ready.filter(key=>state[key].status==='ready'&&selectionFor(key)?.weight!==0),tick);
      const deferred = variety&&W.incidentVariety.deferred(variety);
      if (capture&&variety) capture.variety = variety;
      const eligible = deferred?key=>canSelect(key)&&!deferred.has(key):canSelect;
      function release(key,choice) {
        if (choice) publish(emit,'selected',state[key],{selection:choice});
        dispatch(state[key],choice?.reason??'automatic-release',emit,'automatic',choice,variety);
      }
      if (budget||storyteller) {
        const pools = new Set();
        // Reserve each release before testing the remaining pools for the next seat.
        while (true) {
          const contenders = Object.values(state).filter(row=>waiting(row)&&!pools.has(selectionFor(row.candidate)?.pool));
          const choices = select(seed,tick,contenders,selectionFor,eligible);
          const key = ready.find(id=>state[id].status==='ready'&&eligible(id)&&(!selectionFor(id)||choices.has(id)));
          if (key===undefined) break;
          const choice = choices.get(key);
          if (choice) pools.add(choice.pool);
          release(key,choice);
          if (storyteller) break;
        }
      } else {
        const choices = select(seed,tick,Object.values(state).filter(waiting),selectionFor,canSelect);
        for (const key of ready)
          if (state[key].status==='ready'&&(!selectionFor(key)||choices.has(key))) release(key,choices.get(key));
      }
      return {state:freeze(state),starts:normal,released};
    }

    function preview(previous,starts,lifecycle,tick,query) {
      const capture = {};
      const {state,released} = advance(previous,starts,[],tick,()=>query,lifecycle,()=>{},capture);
      return {...capture,state,dispatched:Object.keys(released)};
    }

    function validate(state,tick,triggers,lifecycle,gates) {
      check(record(state)&&Object.keys(state).length<=specs.size,'Invalid saved incident candidate queue');
      const cooldownAt = cooldownReports(lifecycle);
      const tickOK = value=>Number.isSafeInteger(value)&&value>0&&value<=tick;
      const placedAnchors = new Set();
      for (const [key,spec] of specs) {
        const row = state[key], start = triggers?.[key]?.start, story = lifecycle[key];
        const message = 'Invalid saved incident candidate '+key;
        const offered = Boolean(story&&(story.dropped||story.transitions[0].to==='available'));
        if (!own(state,key)) {
          check(!offered&&(!start||start.tick>=cutoff(spec))&&(spec.policy.anchor?.queueAt??Infinity)>tick,message);
          continue;
        }
        check(fields(row,['candidate','queuedAt','expiresAt','origin','source','status','report','pressure','cooldown','terminal','followUp','selection','storyteller','variety','anchor'])&&
          row.candidate===key&&tickOK(row.queuedAt)&&row.expiresAt===due(spec,row.queuedAt)&&row.expiresAt>row.queuedAt&&
          fields(row.origin,['kind','incident'])&&W.storyFeasibility.validReport(row.report,spec.rules,row.queuedAt,tick)&&
          W.incidentPressure.validReport(pressurePolicy,key,row.pressure,row.report.tick)&&
          equal(row.cooldown,cooldownAt(key,row.report.tick))&&
          W.incidentAnchors.valid(spec.policy.anchor,row.anchor,row.report.tick),message);
        if (spec.triggers) check(row.origin.kind==='trigger'&&row.origin.incident===undefined&&start?.tick===row.queuedAt&&
          start.trigger===row.source?.trigger&&W.storyTriggers.validEvidence(spec.triggers,row.source,row.queuedAt),message);
        else if (spec.policy.anchor?.queueAt!==undefined)
          check(row.origin.kind==='anchor'&&row.origin.incident===undefined&&row.source===undefined&&
            row.queuedAt===spec.policy.anchor.queueAt,message);
        else {
          const parent = state[row.origin.incident];
          check(row.origin.kind==='follow-up'&&row.source===undefined&&parent?.status==='expired'&&parent.terminal?.tick===row.queuedAt&&
            equal(parent.followUp,{incident:key,status:'queued'}),message);
        }
        check(offered===(row.status==='dispatched')&&
          (storyteller&&offered?record(row.storyteller):row.storyteller===undefined),message);
        if (waiting(row)) {
          check(row.expiresAt>tick&&row.report.tick===tick&&admissible(row)===(row.status==='ready')&&
            row.terminal===undefined&&row.followUp===undefined&&row.selection===undefined,message);
          continue;
        }
        check(fields(row.terminal,['tick','reason'])&&tickOK(row.terminal.tick)&&reasonOK(row.terminal.reason),message);
        if (row.status==='dispatched') {
          if (row.anchor) {
            check(row.terminal.reason===W.incidentAnchors.reason&&row.selection===undefined&&!placedAnchors.has(row.terminal.tick),message);
            placedAnchors.add(row.terminal.tick);
          }
          check(admissible(row)&&row.report.tick===row.terminal.tick&&row.terminal.tick<row.expiresAt&&row.followUp===undefined&&
            (story.dropped||story.transitions[0].tick===row.terminal.tick&&story.transitions[0].reason==='candidate-dispatched')&&
            equal(story.source,row.source)&&(!Object.keys(spec.rules).length||equal(gates?.[key]?.report,row.report)),message);
          continue;
        }
        check(row.status==='expired'&&row.terminal.tick===row.expiresAt&&row.report.tick===row.expiresAt-1&&
          row.terminal.reason===expiryReason(spec,row)&&row.selection===undefined,message);
        const target = spec.policy.onExpire, link = row.followUp;
        if (!target) check(link===undefined,message);
        else {
          const next = state[target], at = row.terminal.tick;
          check(fields(link,['incident','status'])&&link.incident===target&&
            (link.status==='queued'?next?.origin.incident===key&&next.queuedAt===at:
              link.status==='already-queued'?next&&next.queuedAt<=at:
                link.status==='closed'&&at>=cutoff(specs.get(target))),message);
        }
      }
      check(Object.keys(state).every(key=>specs.has(key)),'Unknown saved incident candidate');
      if (storyteller) W.storyteller.validate(storyteller,direction,state);
      const deferred = W.incidentVariety.validate(varietyPolicy,varietyModel,state,selectionFor,canSelect,cooldownAt);
      validateSelections(state,seed,selectionFor,cooldownAt,(key,tick)=>canSelect(key)&&!deferred.get(tick)?.has(key));
      if (pressurePolicy) W.incidentPressure.validate(pressurePolicy,lifecycle);
    }
    return {policies,pressure:pressurePolicy,anchors,direction,initial:()=>freeze({}),advance,preview,validate,checkAction};
  }

  function inspect(policies,state,tick,args) {
    check(fields(args,['incident']),'Invalid incident candidate filter');
    if (args.incident!==undefined&&!own(policies,args.incident)) return Q.missing('Unknown queued incident','missing');
    const ready = [], blocked = [], closed = [];
    for (const row of Object.values(state??{}).sort(W.incidentSelection.before)) {
      if (args.incident!==undefined&&args.incident!==row.candidate) continue;
      const list = row.status==='ready'?ready:row.status==='blocked'?blocked:closed;
      list.push(row);
    }
    return Q.ok({tick,ready,blocked,closed});
  }

  W.incidentCandidates = Object.freeze({action,compile,inspect});
})(KIT);
