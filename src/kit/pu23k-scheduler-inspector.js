/* Explain a queue boundary without stepping the world or publishing its decisions. */
(function(K) {
  const W = K.world, Q = W.query, {check,own,record} = W.data, {freeze} = K.procedural.data;
  const source = Symbol('scheduler-inspection');
  const field = 'world/scheduler';
  const live = new Set(['available','active','suspended']);
  const closingTick = policy=>Math.min(policy.worldDeadlineTick??Infinity,policy.anchor?.window?.closesBefore??Infinity);

  function orderStatus(query,{system,agent,generation,sequence}) {
    const sample = query.probe(system+'/orders',undefined,{agent,generation});
    if (sample.status!=='ok') return {status:'unavailable',reason:sample.reason??sample.status};
    const book = sample.value;
    const groups = {active:[book.active],paused:book.paused,queued:book.queue,closed:book.outcomes};
    for (const [status,entries] of Object.entries(groups)) {
      const order = entries.find(row=>row?.sequence===sequence);
      if (order) return {status,task:order.task,phase:order.phase,...(order.reason&&{reason:order.reason})};
    }
    return {status:'unavailable',reason:'assignment-order-not-retained'};
  }

  function commitments(view,query,pressure,definitions) {
    const rows = [], releasing = new Map(W.storyCommitments.releases(view.storyCommitmentDefinitions,
      view.storyLifecycle??{},view.tick+1).map(({story,order})=>[story,order]));
    for (const [story,row] of Object.entries(view.storyLifecycle??{})) {
      if (!row) continue;
      const {to:status,tick:since} = row.transitions.at(-1);
      const isLive = live.has(status), release = releasing.get(story);
      if (!isLive&&!release) continue;
      const candidate = own(view.incidentCandidatePolicies,story), decision = row.commitment, current = row.flow?.current;
      const assignment = W.storyHandoffs.assignment(row);
      if (!candidate&&!assignment&&!decision&&!own(view.storyCommitmentDefinitions,story)) continue;
      const handoff = row.handoffs?.last;
      rows.push({story,title:definitions.get(story)?.title??story,status,since,
        ...(current&&{stage:current.stage,visit:current.visit}),
        ...(candidate&&{pressure:view.incidentCandidatePolicies[story].pressure??{}}),
        ...(assignment&&{assignment,order:orderStatus(query,assignment)}),
        ...(release&&{releaseAt:view.tick+1}),
        ...(decision&&decision.decision!=='accepted'&&{request:decision}),
        ...(handoff?.decision==='deferred'&&{handoff})});
    }
    return {capacity:pressure,stories:rows};
  }

  function pressureBlockers(report,holds) {
    return report?.blockers.map(({kind,id})=>{
      const {requested,remaining,limit} = kind==='commitments'?report.commitments:report.dimensions[id];
      const heldBy = holds.filter(row=>kind==='commitments'||row.pressure[id]>0).map(row=>row.candidate);
      return {code:kind==='commitments'?'commitment-capacity':'pressure-capacity',...(id!==undefined&&{dimension:id}),
        requested,remaining,limit,additionalNeeded:requested-remaining,fitsLimit:requested<=limit,heldBy};
    })??[];
  }

  function gates(row,policy,rules,holds) {
    const blockers = Object.entries(row.report.checks).filter(([,value])=>value.status!=='ready').map(([name,value])=>
      ({code:'feasibility',check:name,...value,requires:rules[name]}));
    blockers.push(...pressureBlockers(row.pressure,holds));
    if (row.cooldown?.ready===false)
      blockers.push({code:'recovery-cooldown',opensAt:row.cooldown.readyAt,windows:row.cooldown.blocks});
    if (row.anchor?.ready===false) {
      const {reason} = row.anchor;
      blockers.push({code:reason,...(reason==='before-anchor-window'&&{opensAt:policy.anchor.window.opensAt}),
        ...(reason==='anchor-condition-unmet'&&{requires:policy.anchor.state})});
    }
    return blockers;
  }

  function disposition(row) {
    return {status:row.status,...row.terminal,...(row.followUp&&{followUp:row.followUp}),
      ...(row.storyteller&&{mode:row.storyteller.mode}),
      ...(row.anchor&&{anchor:row.anchor}),
      ...(row.status==='expired'&&{lastChecks:{feasibility:row.report,...(row.pressure&&{pressure:row.pressure}),
        ...(row.cooldown&&{cooldown:row.cooldown})}}),
      ...(row.selection&&{pool:row.selection.pool})};
  }

  function recommend(row,policy,{view,projection,holds,admission,dispatched,draws,variety}) {
    const key = row.candidate, model = view.storyteller;
    if (policy.release!=='automatic') return {status:'manual-only',blockers:[]};
    const projected = projection.state[key], mode = policy.anchor?'anchor':'automatic';
    if (dispatched.has(key)) return {status:'would-dispatch',mode,...projected.terminal,
      ...(projected.selection&&{pool:projected.selection.pool}),blockers:[]};
    const blockers = [...admission];
    if (!policy.anchor) {
      const direction = view.storytellerCandidates?.[key], selection = direction?.selection??policy.selection;
      if (direction?.withinChallenge===false) blockers.push({code:'challenge',intensity:direction.intensity,
        maxIntensity:model.profiles[model.active].challenge.maxIntensity});
      if (selection?.weight===0) blockers.push({code:'zero-weight',selection});
    }
    const hold = projection.hold;
    if (hold&&(!policy.anchor||hold.code==='anchor-priority')) blockers.push(hold);
    if (!admission.length&&!blockers.length) {
      if (variety&&!variety.preferred.has(key)&&variety.rows.has(key)) {
        const {repeated,score} = variety.rows.get(key);
        blockers.push({code:'variety-preference',score,preferred:[...variety.preferred],
          repeated:Object.fromEntries(Object.entries(repeated).map(([axis,indices])=>
            [axis,indices.map(index=>projection.variety.history[index].candidate)]))});
      }
      const draw = draws.get(key);
      if (draw) blockers.push(draw);
      if (row.pressure?.ready&&projected.pressure?.ready===false)
        blockers.push(...pressureBlockers(projected.pressure,holds));
      if (!blockers.length&&dispatched.size) blockers.push({code:'automatic-beat-taken',candidates:[...dispatched]});
    }
    return {status:'held',mode,blockers};
  }

  function inspect(view,query,args) {
    check(record(args)&&Object.keys(args).every(key=>key==='incident')&&
      (args.incident===undefined||typeof args.incident==='string'&&args.incident.split('/').length===2&&
        args.incident.split('/').every(StoryDocument.isStoryId)),'Scheduler inspection expects a document/story incident filter');
    const {tick,storyteller:model,incidentPressure,incidentCandidatePolicies:policies={}} = view;
    const {incident} = args;
    if (incident!==undefined&&!own(policies,incident)) return Q.missing('Unknown queued incident '+incident,'missing');
    const {preview,triggers,documents} = view[source], nextTick = tick<W.runtime.maxTick?tick+1:null;
    const definitions = new Map(documents.flatMap(doc=>Object.entries(doc.stories).map(([story,def])=>[doc.id+'/'+story,def])));
    const current = view.incidentCandidates??{};
    const projection = nextTick!==null&&preview?preview(current,
      triggers?.(view.storyTriggers,[],nextTick,()=>query).starts??[],view.storyLifecycle,nextTick,query):null;
    const dispatched = new Set(projection?.dispatched);
    const pressure = incidentPressure?W.incidentPressure.begin(incidentPressure,view.storyLifecycle).snapshot():null;
    const holds = pressure?[...pressure.holds,...[...dispatched].map(candidate=>({candidate,pressure:policies[candidate].pressure??{}}))]:[];
    const draws = new Map();
    for (const winner of dispatched) {
      const selection = projection.state[winner].selection;
      if (!selection) continue;
      for (const contender of selection.candidates)
        if (contender.status==='eligible'&&contender.candidate!==winner)
          draws.set(contender.candidate,{code:'weighted-selection',pool:selection.pool,winner,weight:contender.weight});
    }
    const variety = projection?.variety&&{rows:new Map(projection.variety.considered.map(row=>[row.candidate,row])),
      preferred:new Set(projection.variety.preferred)};
    const nextOrdinaryAt = model?W.storyteller.nextAt(model,W.storyteller.lastAutomatic(current)):null;
    const candidates = Object.entries(policies).filter(([key])=>incident===undefined||key===incident).map(([key,policy])=>{
      const previous = current[key], row = projection?.checked[key];
      const cutoff = closingTick(policy);
      const base = {candidate:key,title:definitions.get(key)?.title??key,release:policy.anchor?'anchor':policy.release,
        observed:previous?{status:previous.status,...(previous.report&&{evaluatedAt:previous.report.tick})}:{status:'not-queued'},
        ...(Number.isFinite(cutoff)&&{closesBefore:cutoff})};
      if (previous?.terminal) return {...base,status:'closed',decision:disposition(previous)};
      if (row?.terminal) return {...base,status:'expiring',decision:disposition(row)};
      if (!row) {
        if (tick>=cutoff) return {...base,status:'closed',decision:{status:'expired',tick:cutoff,
          reason:cutoff===policy.worldDeadlineTick?'world-deadline':'anchor-window-missed'}};
        if (nextTick===null) return {...base,status:'held',admission:[{code:'world-tick-limit'}]};
        const triggers = definitions.get(key)?.triggers;
        if (triggers) return {...base,status:'waiting',admission:[{code:'awaiting-trigger',requires:triggers,
          progress:view.storyTriggers?.[key]?.progress??null}]};
        if (policy.anchor?.queueAt!==undefined) return {...base,status:'waiting',
          admission:[{code:'anchor-not-queued',opensAt:policy.anchor.queueAt}]};
        const incoming = Object.entries(policies).filter(([,other])=>other.onExpire===key)
          .map(([candidate])=>({candidate,status:current[candidate]?.status??'not-queued',
            ...(current[candidate]?.expiresAt!==undefined&&{expiresAt:current[candidate].expiresAt})}));
        return {...base,status:'waiting',admission:[{code:'awaiting-expiry-follow-up',incoming}]};
      }
      const admission = gates(row,policy,view.storyFeasibilityRules?.[key]??{},pressure?.holds??[]);
      const manual = policy.anchor?{eligible:false,blockers:[{code:'authored-anchor-managed'}]}:
        {eligible:!admission.length,blockers:admission};
      const automatic = recommend(row,policy,{view,projection,holds,admission,dispatched,draws,variety});
      return {...base,status:automatic.status==='would-dispatch'?'would-dispatch':manual.eligible&&policy.release==='manual'?'manual-ready':'held',
        queue:{queuedAt:row.queuedAt,expiresAt:row.expiresAt,origin:row.origin,...(row.source&&{source:row.source})},
        admission,manual,automatic};
    });
    const actual = Object.values(current).filter(row=>row.terminal?.tick===tick)
      .map(row=>({candidate:row.candidate,...disposition(row)}));
    return Q.ok(freeze({format:'ink-studio/scheduler-inspection',version:1,world:view.world.id,tick,
      actual,
      forecast:{tick:nextTick,basis:'published-state',profile:model?.active??null,nextOrdinaryAt,
        hold:projection?.hold??null,automatic:[...dispatched].map(candidate=>({candidate,...disposition(projection.state[candidate])})),
        manual:Object.values(projection?.checked??{}).filter(row=>row.status==='ready'&&!policies[row.candidate].anchor)
          .map(row=>row.candidate)},
      commitments:commitments(view,query,pressure,definitions),candidates}));
  }

  W.schedulerInspector = Object.freeze({field,source,inspect,orderStatus});
})(KIT);
