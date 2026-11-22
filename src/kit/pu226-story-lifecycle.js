/* Story offers, commitments and terminal outcomes at the world tick boundary. */
(function (K) {
  const W = K.world, { check, record, own, equal, id } = W.data, { freeze } = K.procedural.data;
  const destinations = Object.freeze({
    available: ['active', 'withdrawn', 'expired'],
    active: ['suspended', 'completed', 'failed', 'withdrawn', 'expired'],
    suspended: ['active', 'failed', 'withdrawn', 'expired'],
    completed: [], failed: [], withdrawn: [], expired: []
  });
  const limit = 64;
  const actions = Object.freeze(['story-transition', 'story-objective', 'story-choose', 'story-select', 'story-handoff',
    'story-cancel-handoff', 'story-start']);
  const reasonOK = value => typeof value === 'string' && value.length <= 256 && value.trim().length > 0;
  const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const allowed = (from, to) => from === null ? to === 'available' : own(destinations, from) && destinations[from].includes(to);
  const keyOf = ({ document, story }) => document + '/' + story;
  const statusOf = row => row?.transitions.at(-1).to ?? null;
  const outcomeOK = (def, to, outcome) => outcome === undefined ||
    (to === 'completed' || to === 'failed') && typeof outcome === 'string' && own(def.outcomes, outcome);

  function compile(documents, world, systems) {
    const entries = new Map(), parents = new Map();
    const compileEvidence = W.storyEvidence.compiler(world, systems);
    const compileFeasibility = W.storyFeasibility.compiler(world, systems);
    const compileConsequences = W.storyConsequences.compiler(world,systems);
    for (const document of documents) for (const [story, definition] of Object.entries(document.stories)) {
      if (!definition.lifecycle) continue;
      const { activation = 'automatic' } = definition.lifecycle;
      const info = { document: document.id, story, storyKind: definition.kind, stage: definition.entry,
        ...(definition.incident&&{incident:definition.incident}) };
      check(entries.size < 256, 'World story lifecycle budget exceeds 256 definitions');
      const candidate = definition.lifecycle.candidate;
      const key = keyOf(info), stages = definition.lifecycle.progression ? definition.stages : undefined;
      const automatic = new Map();
      for (const [stage, spec] of Object.entries(stages ?? {})) {
        const branches = Object.keys(spec.next).filter(branch => spec.next[branch].auto).sort();
        if (branches.length) automatic.set(stage, branches);
        for (const child of spec.children?.open ?? []) parents.set(document.id + '/' + child, key);
      }
      entries.set(key, { info, activation, candidate, outcomes: definition.outcomes, triggers: definition.triggers,
        stages, automatic, beats:W.storyBeats.compile(stages,world.dt), decisions:W.storyDecisions.compile(stages,world.dt), evidence: compileEvidence(stages, key, document.objectiveTypes),
        feasibility: compileFeasibility(definition.lifecycle.feasibility, key),
        liveReferences: definition.lifecycle.liveReferences,
        commitment: definition.lifecycle.commitment,
        handoffs: definition.lifecycle.handoffs,
        settlement: definition.lifecycle.settlement,
        consequences: compileConsequences(definition.outcomes,key),
        clock: W.storyDeadlines.compile(definition.lifecycle, world.dt),
        cleanup: W.storyCleanup.compile(definition.lifecycle.cleanup, systems, key) });
    }
    if (!entries.size) return null;
    const hasConsequences = [...entries.values()].some(row=>row.consequences);
    const order = [...entries.keys()].sort();
    const autoOrder = order.filter(key => entries.get(key).automatic.size);
    const interventionOrder = autoOrder.filter(key=>Object.values(entries.get(key).decisions).some(policy=>policy.mode==='intervene'));
    const decisionKeys = order.filter(key=>Object.keys(entries.get(key).decisions).length);
    const decisions = decisionKeys.length?freeze(Object.fromEntries(decisionKeys.map(key=>[key,entries.get(key).decisions]))):undefined;
    const beatOrder = order.filter(key=>Object.keys(entries.get(key).beats).length);
    const beats = beatOrder.length?freeze(Object.fromEntries(beatOrder.map(key=>[key,entries.get(key).beats]))):undefined;
    const cleanupOrder = order.filter(key => entries.get(key).cleanup);
    const gateKeys = order.filter(key => entries.get(key).feasibility);
    const commitmentKeys = order.filter(key => entries.get(key).commitment);
    const handoffKeys = order.filter(key => entries.get(key).handoffs);
    const feasibility = gateKeys.length ? freeze(Object.fromEntries(gateKeys.map(key => [key,entries.get(key).feasibility]))) : undefined;
    function validSource(key,source,tick) {
      const def = entries.get(key);
      if (!own(source,'launch')) return W.storyTriggers.validEvidence(def.triggers,source,tick);
      return !parents.has(key)&&!def.candidate&&fields(source,['launch'])&&fields(source.launch,['tick','reason'])&&
        Number.isSafeInteger(source.launch.tick)&&source.launch.tick>0&&source.launch.tick<=tick&&reasonOK(source.launch.reason);
    }

    function checkAction(action, args) {
      const handoff = action==='story-handoff'||action==='story-cancel-handoff';
      const extra = action==='story-start' ? [] : handoff ? ['revision',...(action==='story-handoff'?['proposal']:[])] : action === 'story-transition' ? ['to', 'outcome'] :
        action === 'story-choose' ? ['stage', 'visit', 'branch'] :
        ['stage', 'visit', 'objective', action === 'story-select' ? 'option' : 'result'];
      check(fields(args, ['document', 'story', 'reason', ...extra]) &&
        typeof args.document === 'string' && !args.document.includes('/') &&
        typeof args.story === 'string' && !args.story.includes('/'), 'Story transition needs document and story IDs');
      const def = entries.get(keyOf(args));
      check(def, 'Unknown story with lifecycle ' + keyOf(args));
      if (action==='story-start') {
        check(reasonOK(args.reason),'Story start needs a reason');
        check(!parents.has(keyOf(args)),'Start the owning arc to open a child questlet');
        check(!def.candidate,'Use world/dispatch-candidate to release an eligible queued incident');
        return;
      }
      if (handoff) {
        check(def.handoffs&&Number.isSafeInteger(args.revision)&&args.revision>=0&&reasonOK(args.reason)&&
          (action==='story-cancel-handoff'||typeof args.proposal==='string'&&own(def.handoffs,args.proposal)),
          'Story handoff needs an authored proposal, current assignment revision and a reason');
        return;
      }
      if (action !== 'story-transition') {
        check(def.stages && reasonOK(args.reason), 'Story progress needs enabled stage progression and a reason');
        W.storyStages.checkAction(action, def.stages, args);
        return;
      }
      check(typeof args.to === 'string' && own(destinations, args.to) && args.to !== 'available' && reasonOK(args.reason) &&
        outcomeOK(def, args.to, args.outcome), 'Story transition needs a destination, reason, and any valid outcome ID');
      check(!def.stages || args.to !== 'completed' && args.outcome === undefined,
        'Select an ending branch to resolve a story with stage progression');
    }

    function validateParent(parent, owner, child, route, tick, message) {
      const parentDef = entries.get(owner);
      check(fields(parent, ['document', 'story', 'stage', 'visit', 'tick']) &&
        parent.document === parentDef.info.document && parent.story === parentDef.info.story &&
        Number.isSafeInteger(parent.visit) && parent.visit > 0 && typeof parent.stage === 'string' &&
        own(parentDef.stages, parent.stage) && parentDef.stages[parent.stage].children?.open?.includes(child) &&
        Number.isSafeInteger(parent.tick) && parent.tick > 0 && parent.tick <= tick && Array.isArray(route?.route), message);
      const opening = route.current?.visit === parent.visit ? route.current : route.route.find(visit => visit?.visit === parent.visit);
      check(opening ? opening.stage === parent.stage && opening.enteredAt === parent.tick : parent.visit <= route.dropped, message);
    }

    function validReference(change, def) {
      const reference = change.reference;
      if (reference===undefined) return true;
      if (!fields(reference,['reference','cause','action']) || !own(def.liveReferences,reference.reference) ||
          def.liveReferences[reference.reference].on?.[reference.cause]!==reference.action) return false;
      if (reference.action==='suspend') return change.to==='suspended'&&change.reason==='live-reference-suspended' ||
        change.from==='suspended'&&change.to==='active'&&change.reason==='live-reference-restored';
      return change.to==='withdrawn'&&change.reason==='live-reference-withdrawn'&&
        (reference.action==='withdraw'||reference.action==='fail'&&change.from==='available') ||
        change.to==='failed'&&change.reason==='live-reference-failed'&&reference.action==='fail';
    }

    function validate(state, tick, gates, triggers) {
      check(record(state) && Object.keys(state).length === entries.size, 'Malformed story lifecycle checkpoint');
      for (const [key, def] of entries) {
        check(own(state, key), 'Missing story lifecycle ' + key);
        const row = state[key];
        const message = 'Invalid saved story lifecycle for ' + key;
        if (row === null) {
          check(W.storyDeadlines.valid(def.clock, row, tick), message);
          continue;
        }
        check(fields(row, ['transitions', 'dropped', 'source', 'flow', 'deadlines', 'parent', 'cleanup', 'commitment', 'handoffs',
          'settlements', 'consequences']) &&
          Number.isSafeInteger(row.dropped) && row.dropped >= 0 &&
          Array.isArray(row.transitions) && row.transitions.length > 0 && row.transitions.length <= limit &&
          (!row.dropped || row.transitions.length === limit), message);
        let previous;
        for (const change of row.transitions) {
          check(fields(change, ['from', 'to', 'tick', 'reason', 'outcome', 'deadline', 'reference']) &&
            (allowed(change.from, change.to) ||
              (change.from === null && change.to === 'expired' && change.deadline?.clock === 'world')) &&
            Number.isSafeInteger(change.tick) && change.tick > 0 && change.tick <= tick && reasonOK(change.reason) &&
            outcomeOK(def, change.to, change.outcome) && validReference(change,def) &&
            (change.reason!=='live-reference-restored'||!change.reference||
              (previous ? equal(previous.reference,change.reference) : row.dropped>0)) &&
            (previous ? change.from === previous.to && change.tick >= previous.tick : (change.from === null) === (row.dropped === 0)), message);
          previous = change;
        }
        const cutOffBeforeOffer = previous.from === null && previous.to === 'expired';
        check(W.storyDeadlines.valid(def.clock, row, tick) && W.storyCleanup.valid(row.cleanup, def.cleanup, previous, tick) &&
          W.storyCommitments.valid(def.commitment,row,tick) &&
          W.storyHandoffs.valid(def.handoffs,row,tick,reasonOK) &&
          W.storySettlement.valid(def.settlement,row,tick) &&
          W.storyConsequences.valid(row.consequences,def.consequences,key,previous,id=>state[def.info.document+'/'+id]) &&
          (cutOffBeforeOffer ? row.source === undefined : validSource(key,row.source,tick)) &&
          (!row.source?.launch||row.dropped>0||row.transitions[0].reason==='explicit-start'), message);
      }
      check(feasibility ? record(gates) && equal(Object.keys(gates).sort(),gateKeys) : gates === undefined,
        'Invalid story feasibility checkpoint table');
      for (const key of gateKeys) {
        const gate = gates[key], row = state[key], first = row?.transitions[0], def = entries.get(key), owner = parents.get(key);
        const message = 'Invalid saved story feasibility for ' + key;
        const offered = row && (row.dropped > 0 || first.to === 'available');
        const trigger = triggers?.[key]?.start;
        if (gate === null) {
          check(!offered && (tick===0 || owner || def.candidate || def.triggers&&!trigger || first?.to==='expired'),message);
          continue;
        }
        check(fields(gate,['request','report']) && fields(gate.request,['tick','source','parent']),message);
        const {request, report} = gate;
        check(Number.isSafeInteger(request.tick) && request.tick>0 && request.tick<=tick &&
          W.storyFeasibility.validReport(report,def.feasibility,request.tick,tick) && report.ready===Boolean(offered),message);
        if (owner) {
          validateParent(request.parent,owner,def.info.story,state[owner]?.flow,request.tick,message);
          check(request.parent.tick===request.tick && request.source===undefined,message);
        } else {
          const launch = request.source?.launch;
          check(request.parent===undefined && validSource(key,request.source,request.tick) &&
            (launch ? launch.tick===request.tick : !def.triggers || trigger?.tick===request.tick && trigger.trigger===request.source?.trigger),message);
        }
        if (offered) check((row.dropped || report.tick===first.tick) &&
          equal(request.source,row.source) && equal(request.parent,row.parent),message);
        else check(row ? request.tick<first.tick && report.tick<first.tick : report.tick===tick,message);
      }
      for (const [key, def] of entries) {
        const row = state[key];
        if (!row) continue;
        const owner = parents.get(key), first = row.transitions[0], previous = row.transitions.at(-1);
        const message = 'Invalid saved story lifecycle for ' + key;
        if (owner && !(first.from === null && first.to === 'expired')) {
          validateParent(row.parent,owner,def.info.story,state[owner]?.flow,first.tick,message);
          check(row.dropped || first.reason === 'parent-stage-opened' && (def.feasibility || row.parent.tick === first.tick),message);
        } else check(row.parent === undefined, message);
        const hasFlow = Boolean(def.stages && row.transitions.some(change => change.to === 'active' || change.from === 'active' || change.from === 'suspended'));
        if (hasFlow) {
          const activated = row.transitions.find(change => change.from === 'available' && change.to === 'active');
          W.storyStages.validate(row.flow,def,previous,previous.deadline ? previous.tick - 1 : tick,activated?.tick,
            reasonOK,message,id => state[def.info.document + '/' + id],
            id => gates?.[def.info.document + '/' + id]?.request.parent,
            def.handoffs ? tick=>W.storyHandoffs.creditAt(row,tick) : undefined);
        }
        else check(!own(row, 'flow'), message);
      }
    }

    function cleanup(previous, tick, apply, emit) {
      let state = previous;
      for (const key of cleanupOrder) {
        const row = previous[key], def = entries.get(key), ending = row?.transitions.at(-1);
        const next = W.storyCleanup.advance(row?.cleanup, def.cleanup, tick, apply, result =>
          emit('story-cleanup-resolved', { document:def.info.document, story:def.info.story,
            endedAs:ending.to, ...(ending.outcome !== undefined && {outcome:ending.outcome}), ...result }));
        if (next === row?.cleanup) continue;
        if (state === previous) state = { ...previous };
        state[key] = { ...row, cleanup:next };
      }
      return state;
    }

    function advance(previous, starts, commands, tick, emit, events, query, previousGates, references, dispatch, settleStory, released,
      publishConsequences) {
      let state = previous, gates = previousGates, queuedOpens = [];
      const requests = new Map(), handoffRequests = new Map(), H = W.storyHandoffs;
      const launches = new Map(), offeredByLaunch = new Set();
      for (const command of commands) if (command.action==='story-start'&&!launches.has(keyOf(command.args)))
        launches.set(keyOf(command.args),command);
      const sourceLength = events.length;
      let indexed;
      const eventsOf = kind => (indexed ??= W.storyEvidence.index(events, sourceLength)).get(kind) ?? [];
      const matched = new Map();
      for (const start of starts) {
        const key = keyOf(start);
        if (entries.has(key)) matched.set(key, { trigger: start.trigger, evidence: start.evidence });
        else emit('story-started', start);
      }
      function save(key, row) {
        if (state === previous) state = { ...previous };
        state[key] = row;
      }
      function noteHandoff(key,report,publish = emit) {
        const row = state[key], prior = row.handoffs?.last;
        save(key,H.update(row,report));
        if (report.decision!=='deferred'||prior?.decision!=='deferred'||!equal(H.blockers(prior),H.blockers(report)))
          publish('story-handoff-decision',{...entries.get(key).info,...report});
      }
      function noteSettlement(key,phase,outcome,report,publish) {
        const row = state[key], prior = row.settlements?.blocked;
        save(key,W.storySettlement.note(row,phase,outcome,report));
        if (report.status==='applied'||prior?.phase!==phase||prior.outcome!==outcome||!equal(prior.blocker,report.blocker))
          publish(report.status==='applied'?'story-settlement':'story-settlement-blocked',
            {...entries.get(key).info,phase,...(outcome!==undefined&&{outcome}),...report});
      }
      function settle(key,phase,outcome,publish) {
        const spec = entries.get(key).settlement;
        const effects = phase==='costs'?spec?.costs:own(spec?.outcomes,outcome)?spec.outcomes[outcome]:undefined;
        if (!effects) return true;
        const row = state[key], report = settleStory(effects,row,H.assignment(row));
        noteSettlement(key,phase,outcome,report,publish);
        return report.status==='applied';
      }
      function activate(key,reason,publish = emit) {
        if (!settle(key,'costs',undefined,publish)) return false;
        transition(key,'active',reason,undefined,{publish});
        return true;
      }
      const policy = key => W.storyReferences.decision(references?.[key]);
      function applyReference(key,publish = emit) {
        if (!entries.get(key).liveReferences) return true;
        const from = statusOf(state[key]);
        if (!W.storyReferences.open.has(from)) return true;
        const reference = policy(key);
        if (reference) {
          const {action} = reference;
          const to = action==='suspend' ? (from==='active'?'suspended':null) :
            action==='fail'&&from!=='available' ? 'failed' : 'withdrawn';
          if (to) transition(key,to,'live-reference-'+to,undefined,{publish,reference});
          return false;
        }
        const last = state[key].transitions.at(-1);
        if (from==='suspended'&&last.reference?.action==='suspend')
          transition(key,'active','live-reference-restored',undefined,{publish,reference:last.reference});
        return true;
      }
      function requestStart(key,reason,publish) {
        const status = statusOf(state[key]);
        if (status==='active'||status===null&&gates?.[key]?.request.source?.launch) return;
        const reference = status==='available'?policy(key):undefined;
        if (status!=='available'||reference) {
          publish('story-start-rejected',{...entries.get(key).info,from:status,
            reason:reference?'live-reference-blocked':'story-not-available',requestedReason:reason,...(reference&&{reference})});
          return;
        }
        if (entries.get(key).commitment) {
          if (!requests.has(key)) requests.set(key,{reason,publish});
        } else activate(key,reason,publish);
      }
      function offer(key, source, parent, publish = emit, candidate) {
        const def = entries.get(key);
        if (def.feasibility) {
          const prior = gates[key];
          if (prior?.report.tick === tick) return;
          const replace = source?.launch&&!prior?.request.source?.launch;
          const request = (!replace&&prior?.request) || {tick:candidate?.queuedAt??tick,...(source&&{source}),...(parent&&{parent})};
          const report = candidate?.report??W.storyFeasibility.evaluate(def.feasibility,tick,query());
          if (gates === previousGates) gates = {...previousGates};
          gates[key] = {request,report};
          if (!report.ready) return;
          ({source,parent} = request);
        }
        const reason = candidate ? 'candidate-dispatched' : parent ? 'parent-stage-opened' : source?.launch ? 'explicit-start' :
          source ? 'trigger-matched' : 'authored-offer';
        transition(key,'available',reason,undefined,{publish,source,parent});
        if (!applyReference(key,publish)) return;
        if (source?.launch) requestStart(key,source.launch.reason,publish);
        else if (def.activation === 'automatic' && !def.commitment) activate(key,'automatic-activation',publish);
      }
      function openChildren(ids, parent, publish) {
        for (const id of ids) {
          const child = parent.document + '/' + id;
          if (state[child] !== null) continue;
          offer(child,undefined,parent,publish);
        }
      }
      function enterStage(publish, def, flow, reason) {
        const { stage, visit } = flow.current;
        const { info } = def;
        const decision = own(def.decisions,stage)?def.decisions[stage]:undefined;
        publish('story-stage-entered', { ...info, stage, visit, reason, ...(decision&&{decision}) });
        if (flow.current.beat) publish('story-beat-entered',{...info,stage,visit,reason,beat:def.beats[stage]});
        const ids = def.stages[stage].children?.open;
        if (ids) {
          const parent = { document: info.document, story: info.story, stage, visit, tick };
          if (queuedOpens) queuedOpens.push({ ids, parent, publish });
          else openChildren(ids, parent, publish);
        }
      }
      function transition(key, to, reason, outcome, options = {}) {
        let prior = state[key];
        const from = statusOf(prior), def = entries.get(key), { info, stages, clock } = def;
        const { publish = emit, source = prior?.source, deadline, parent = prior?.parent, reference } = options;
        if (def.handoffs&&H.closed.has(to)) {
          const request = handoffRequests.get(key)?.request??(H.pending(prior)?prior.handoffs.last:undefined);
          if (request) {
            noteHandoff(key,H.cancel(request,tick,'story-closed'),publish);
            handoffRequests.delete(key);
            prior = state[key];
          }
        }
        const started = from === 'available' && to === 'active';
        const flow = started && stages ? W.storyStages.initial(info.stage,tick,def.beats) :
          to === 'suspended' ? W.storyStages.clearProgress(prior?.flow) : prior?.flow;
        const deadlines = W.storyDeadlines.transition(clock, prior?.deadlines, from, to, tick);
        const change = { from, to, tick, reason, ...(outcome !== undefined && { outcome }), ...(deadline && { deadline }),
          ...(reference && {reference}) };
        const cleanup = W.storyCleanup.begin(def.cleanup, change);
        const resultRules = own(def.consequences,outcome)?def.consequences[outcome]:undefined;
        const consequences = resultRules&&W.storyConsequences.capture(resultRules,key,outcome,to,tick,query(),
          id=>state[info.document+'/'+id]);
        const transitions = [...(prior?.transitions ?? []), change];
        const overflow = Math.max(0, transitions.length - limit);
        save(key, { transitions: transitions.slice(overflow), dropped: (prior?.dropped ?? 0) + overflow,
          ...(source && { source }), ...(flow && { flow }), ...(deadlines && { deadlines }), ...(parent && {parent}),
          ...(prior?.commitment && {commitment:prior.commitment}),
          ...(prior?.handoffs && {handoffs:prior.handoffs}),
          ...(prior?.settlements && {settlements:prior.settlements}),
          ...(cleanup && {cleanup}),...(consequences&&{consequences}) });
        const stage = flow?.current ?? flow?.route.at(-1);
        const link = parent ? { parent } : {};
        publish('story-transition', { ...info, ...change, ...source, ...link, ...(stage && { stage:stage.stage, visit:stage.visit }) });
        if (consequences) publishConsequences(W.storyConsequences.kind,{...info,outcome,consequences});
        if (started) {
          publish('story-started', { ...info, ...source, ...link,
            ...(prior.commitment?.order && {commitment:prior.commitment.order}) });
          if (flow) enterStage(publish,def,flow,reason);
        }
      }
      function progress(key, def, row, result, publish) {
        const { stage, visit } = row.flow.current, step = { ...def.info, stage, visit };
        const outcome = result.branch?.target.outcome;
        if (outcome!==undefined&&!settle(key,'outcome',outcome,publish)) return;
        save(key, { ...state[key], flow:result.flow });
        if (result.objective) {
          publish('story-objective-resolved', { ...step, ...result.objective });
          return;
        }
        const { target, reason } = result.branch;
        publish('story-branch-chosen', { ...step, ...result.branch });
        if (target.outcome === undefined) enterStage(publish,def,result.flow,reason);
        else transition(key,def.outcomes[target.outcome].status ?? 'completed',reason,target.outcome,{ publish });
      }
      const readChild = def => id => state[def.info.document + '/' + id];
      const credit = (def,row) => def.handoffs ? H.assignment(row) : undefined;
      for (const key of order) {
        const def = entries.get(key), before = previous[key], source = matched.get(key), status = statusOf(before);
        const { row: prior, expired } = W.storyDeadlines.advance(def.clock, before, status, tick);
        if (prior !== before) save(key, prior);
        if (expired) {
          transition(key, 'expired', expired.reason, undefined, { deadline: expired.receipt });
          continue;
        }
        if (prior !== null && !applyReference(key)) continue;
        const launch = prior?.source?.launch;
        if (status==='available' && !def.commitment &&
          (launch||(def.liveReferences||def.settlement?.costs)&&def.activation==='automatic')) {
          activate(key,launch?.reason??'automatic-activation');
          continue;
        }
        if (status === 'active' && prior.flow?.current) {
          const { stage, visit } = prior.flow.current, rules = def.evidence.get(stage);
          if (rules) {
            const { flow, changes } = W.storyStages.confirm(prior.flow, rules, tick, eventsOf, query,credit(def,prior));
            if (flow !== prior.flow) {
              save(key, { ...prior, flow });
              for (const [objective, change] of Object.entries(changes))
                emit('story-objective-resolved', { ...def.info, stage, visit, objective, ...change });
            }
          }
        }
        if (prior===null&&!def.candidate) {
          const command = launches.get(key);
          if (command) {
            offeredByLaunch.add(command);
            offer(key,{launch:{tick,reason:command.args.reason}},undefined,command.publish);
          } else if (gates?.[key] || !parents.has(key) && (!def.triggers || source)) offer(key,source);
        }
      }
      for (const [key,candidate] of Object.entries(released??{}))
        if (state[key]===null) offer(key,candidate.source,undefined,emit,candidate);
      const opens = queuedOpens;
      queuedOpens = null;
      for (const { ids, parent, publish } of opens) openChildren(ids, parent, publish);
      for (const key of interventionOrder) {
        const row = state[key], current = row?.flow?.current, def = entries.get(key);
        const policy = current&&def.decisions[current.stage];
        if (policy?.mode!=='intervene'||statusOf(previous[key])!=='active'||statusOf(row)!=='active'||current.enteredAt===tick) continue;
        const stage = def.stages[current.stage];
        const step = W.storyDecisions.advance(policy,current,tick,()=>def.automatic.get(current.stage).some(branch=>
          !W.storyStages.eligibility(stage,stage.next[branch],current.objectives,readChild(def)).rejected));
        if (!step) continue;
        save(key,{...row,flow:{...row.flow,current:{...current,intervention:step.window}}});
        if (step.event) emit(step.event,{...def.info,stage:current.stage,visit:current.visit,mode:policy.mode,
          window:W.storyDecisions.describeWindow(policy,step.window)});
      }
      for (const command of commands) {
        const {action,args,publish} = command;
        const { to, reason, outcome } = args, key = keyOf(args), from = statusOf(state[key]);
        if (action==='story-start') {
          if (!offeredByLaunch.has(command)) requestStart(key,reason,publish);
          continue;
        }
        if (action==='story-handoff'||action==='story-cancel-handoff') {
          const row = state[key], def = entries.get(key), cancel = action==='story-cancel-handoff';
          const queued = handoffRequests.get(key)?.request;
          let rejected;
          if (args.revision!==H.revision(row)) rejected = 'stale-assignment-revision';
          else if (!(from==='active'||cancel&&from==='suspended')) rejected = 'story-not-active';
          else if (cancel) {
            const pending = queued??(H.pending(row)?row.handoffs.last:undefined);
            if (!pending) rejected = 'handoff-not-pending';
            else {
              noteHandoff(key,H.cancel(pending,tick,reason),publish);
              handoffRequests.delete(key);
            }
          } else if (queued) rejected = 'handoff-already-pending';
          else {
            const request = H.request(row,args,def.handoffs[args.proposal],tick);
            rejected = request.rejected;
            if (!rejected) handoffRequests.set(key,{request,publish});
          }
          if (rejected) publish('story-handoff-rejected',{...def.info,action,reason:rejected,requestedReason:reason,
            revision:args.revision,...(args.proposal&&{proposal:args.proposal})});
          continue;
        }
        if (action !== 'story-transition') {
          const def = entries.get(key), row = state[key];
          const result = from === 'active' ? W.storyStages.advance(action,def,row.flow,args,tick,readChild(def),credit(def,row)) : { rejected:'story-not-active' };
          const step = { ...def.info, stage:args.stage, visit:args.visit };
          if (result.rejected) {
            publish('story-progress-rejected', { ...step, action, reason:result.rejected, requestedReason:reason,
              ...(args.branch !== undefined && { branch:args.branch }), ...(args.objective !== undefined && { objective:args.objective }),
              ...(args.option !== undefined && { option:args.option }),
              ...(result.pending && { pending:result.pending }),
              ...(result.pendingChildren && { pendingChildren:result.pendingChildren }),
              ...(result.mismatchedChildren && { mismatchedChildren:result.mismatchedChildren }) });
            continue;
          }
          progress(key,def,row,result,publish);
          continue;
        }
        if (!allowed(from, to)) {
          publish('story-transition-rejected', { ...entries.get(key).info, from, to, reason: 'transition-not-allowed', requestedReason: reason });
          continue;
        }
        const reference = to==='active' ? policy(key) : undefined;
        if (reference) {
          publish('story-transition-rejected', { ...entries.get(key).info, from, to, reason:'live-reference-blocked', requestedReason:reason, reference });
          continue;
        }
        if (from==='available'&&to==='active') {
          if (entries.get(key).commitment) {
            if (!requests.has(key)) requests.set(key,{reason,publish});
          } else activate(key,reason,publish);
          continue;
        }
        if (outcome!==undefined&&!settle(key,'outcome',outcome,publish)) continue;
        transition(key, to, reason, outcome, { publish });
      }
      const waiting = handoffKeys.flatMap(key=>{
        const queued = handoffRequests.get(key), row = state[key];
        if (queued) return [{key,...queued}];
        return H.pending(row)?[{key,request:row.handoffs.last,publish:emit}]:[];
      }).sort((left,right)=>left.request.requestedAt-right.request.requestedAt);
      for (const {key,request,publish} of waiting) {
        const row = state[key], spec = entries.get(key).handoffs[request.proposal];
        const report = H.attempt(row,request,spec,tick,query(),dispatch);
        noteHandoff(key,report,publish);
        if (report.decision==='accepted')
          publish('story-handoff-accepted',{...entries.get(key).info,...report,revision:report.revision+1});
      }
      const candidates = commitmentKeys.filter(key=>statusOf(state[key])==='available'&&!policy(key)&&
        (requests.has(key)||state[key].commitment||entries.get(key).activation==='automatic'));
      const age = key => state[key].commitment?.requestedAt??released?.[key]?.queuedAt??tick;
      candidates.sort((left,right)=>age(left)-age(right));
      for (const key of candidates) {
        const {info,commitment:spec} = entries.get(key), row = state[key], prior = row.commitment;
        const request = requests.get(key), publish = request?.publish??emit;
        const requestedAt = prior?.requestedAt??tick, requestReason = prior?.requestReason??request?.reason??'automatic-activation';
        const costs = entries.get(key).settlement?.costs;
        const report = W.storyCommitments.attempt(spec,tick,query(),(actor,order)=>{
          const attempt = dispatch(actor,order,undefined,costs&&((tx,owner)=>W.storySettlement.apply(costs,row,owner,tick,tx)));
          if (attempt.settlement) noteSettlement(key,'costs',undefined,attempt.settlement,publish);
          return attempt;
        });
        save(key,{...state[key],commitment:{...report,requestedAt,requestReason}});
        if (!prior||report.decision!==prior.decision||!equal(W.storyCommitments.reasons(prior),W.storyCommitments.reasons(report)))
          publish('story-commitment-decision',{...info,...report,requestedAt,requestReason,terms:spec.terms??{},task:spec.order.task});
        if (report.decision==='accepted') transition(key,'active',requestReason,undefined,{publish});
        else if (report.decision==='refused') transition(key,'withdrawn','actor-refused',undefined,{publish});
      }
      for (const key of autoOrder) {
        const def = entries.get(key), row = state[key], current = row?.flow?.current;
        if (statusOf(row) !== 'active' || !current || current.enteredAt === tick) continue;
        const { stage, visit } = current, policy = own(def.decisions,stage)?def.decisions[stage]:undefined;
        if (policy?.mode==='intervene'&&current.intervention?.closedAt===undefined) continue;
        const by = policy?.mode==='intervene'?'fallback':'autonomous';
        const reason = !policy?'child-results-matched':by==='fallback'?'intervention-window-elapsed':'automatic-branch-ready';
        for (const branch of def.automatic.get(stage) ?? []) {
          const result = W.storyStages.advance('story-choose',def,row.flow,
            { stage, visit, branch, reason },tick,readChild(def),undefined,by);
          if (!result.rejected) {
            progress(key,def,row,result,emit);
            break;
          }
        }
      }
      for (const key of beatOrder) {
        const def = entries.get(key), row = state[key], current = row?.flow?.current;
        if (!current?.beat||current.enteredAt===tick||statusOf(row)!=='active'||statusOf(previous[key])!=='active') continue;
        const {stage,visit} = current, spec = def.stages[stage];
        const update = W.storyBeats.step(def.beats[stage],current,
          branch=>!W.storyStages.eligibility(spec,spec.next[branch],current.objectives).rejected);
        if (update.beat!==current.beat) save(key,{...row,flow:{...row.flow,current:{...current,beat:update.beat}}});
        if (update.branch!==undefined) {
          const paced = state[key];
          const result = W.storyStages.advance('story-choose',def,paced.flow,
            {stage,visit,branch:update.branch,reason:update.reason},tick,readChild(def),undefined,update.by);
          progress(key,def,paced,result,emit);
        }
      }
      return {state:freeze(state),gates:gates&&freeze(gates)};
    }

    return { initial: () => freeze(Object.fromEntries(order.map(key => [key, null]))), validate, advance, checkAction,hasConsequences,
      ...(feasibility&&{feasibility,initialFeasibility:()=>freeze(Object.fromEntries(gateKeys.map(key=>[key,null])))}),
      ...(cleanupOrder.length && {cleanup}),...(decisions&&{decisions}),...(beats&&{beats}) };
  }

  function inspect(state, at, documents) {
    const stories = new Map(documents?.map(document => [document.id, document.stories]) ?? []);
    return Object.fromEntries(Object.entries(state).map(([key, row]) => {
      if (!row) return [key, null];
      const end = row.transitions.at(-1), { tick, to, reason, outcome, deadline } = end;
      const [document, story] = key.split('/'), current = row.flow?.current;
      const spec = current && stories.get(document)?.[story]?.stages[current.stage];
      const children = spec && W.storyChildren.inspect(spec, id => state[document + '/' + id]);
      return [key, { status: to, since: tick, reason, ...(outcome !== undefined && { outcome }), ...row,
        ...(deadline && { deadline }),
        ...(row.deadlines && { deadlines: W.storyDeadlines.inspect(row.deadlines, end, at) }),
        ...(children && { flow: { ...row.flow, current: { ...current, children } } }) }];
    }));
  }

  function objective(state,documents,args,tick) {
    const {story,objective}=args;
    const [document,name,...rest]=typeof story==='string'?story.split('/'):[];
    check(id(document)&&id(name)&&!rest.length&&id(objective),'Story objective needs a document/story and objective ID');
    const row=own(state,story)?state[story]:undefined, current=row?.flow?.current;
    if (row?.transitions.at(-1).to!=='active'||!current)
      return {status:'missing',reason:'story has no active stage'};
    const objectives=documents?.find(entry=>entry.id===document)?.stories[name]?.stages[current.stage]?.objectives;
    if (!own(objectives,objective)) return {status:'missing',reason:'objective is absent from the active stage'};
    const definition=objectives[objective], result=current.objectives[objective], progress=current.progress?.[objective];
    return {status:'ok',value:{story,stage:current.stage,visit:current.visit,objective,tick,enteredAt:current.enteredAt,
      title:definition.title,required:!definition.optional,status:result?.result??'pending',
      ...(definition.type!==undefined&&{type:definition.type}),...(result&&{result}),...(progress&&{progress})}};
  }

  W.storyLifecycle = Object.freeze({ compile, inspect, objective, actions });
})(KIT);
