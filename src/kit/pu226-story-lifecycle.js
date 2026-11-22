/* Story offers, commitments and terminal outcomes at the world tick boundary. */
(function (K) {
  const W = K.world, { check, record, own, equal } = W.data, { freeze } = K.procedural.data;
  const destinations = Object.freeze({
    available: ['active', 'withdrawn', 'expired'],
    active: ['suspended', 'completed', 'failed', 'withdrawn', 'expired'],
    suspended: ['active', 'failed', 'withdrawn', 'expired'],
    completed: [], failed: [], withdrawn: [], expired: []
  });
  const limit = 64;
  const actions = Object.freeze(['story-transition', 'story-objective', 'story-choose', 'story-select']);
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
    for (const document of documents) for (const [story, definition] of Object.entries(document.stories)) {
      if (!definition.lifecycle) continue;
      const { activation = 'automatic' } = definition.lifecycle;
      const info = { document: document.id, story, storyKind: definition.kind, stage: definition.entry };
      check(entries.size < 256, 'World story lifecycle budget exceeds 256 definitions');
      const key = keyOf(info), stages = definition.lifecycle.progression ? definition.stages : undefined;
      const automatic = new Map();
      for (const [stage, spec] of Object.entries(stages ?? {})) {
        const branches = Object.keys(spec.next).filter(branch => spec.next[branch].auto).sort();
        if (branches.length) automatic.set(stage, branches);
        for (const child of spec.children?.open ?? []) parents.set(document.id + '/' + child, key);
      }
      entries.set(key, { info, activation, outcomes: definition.outcomes, triggers: definition.triggers,
        stages, automatic, evidence: compileEvidence(stages, key, document.objectiveTypes),
        feasibility: compileFeasibility(definition.lifecycle.feasibility, key),
        clock: W.storyDeadlines.compile(definition.lifecycle, world.dt),
        cleanup: W.storyCleanup.compile(definition.lifecycle.cleanup, systems, key) });
    }
    if (!entries.size) return null;
    const order = [...entries.keys()].sort();
    const autoOrder = order.filter(key => entries.get(key).automatic.size);
    const cleanupOrder = order.filter(key => entries.get(key).cleanup);
    const gateKeys = order.filter(key => entries.get(key).feasibility);
    const feasibility = gateKeys.length ? freeze(Object.fromEntries(gateKeys.map(key => [key,entries.get(key).feasibility]))) : undefined;

    function checkAction(action, args) {
      const extra = action === 'story-transition' ? ['to', 'outcome'] :
        action === 'story-choose' ? ['stage', 'visit', 'branch'] :
        ['stage', 'visit', 'objective', action === 'story-select' ? 'option' : 'result'];
      check(fields(args, ['document', 'story', 'reason', ...extra]) &&
        typeof args.document === 'string' && !args.document.includes('/') &&
        typeof args.story === 'string' && !args.story.includes('/'), 'Story transition needs document and story IDs');
      const def = entries.get(keyOf(args));
      check(def, 'Unknown story with lifecycle ' + keyOf(args));
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

    function validateEvidence(row, def, tick) {
      const source = row.source;
      if (!def.triggers) return source === undefined;
      if (!fields(source, ['trigger', 'evidence']) || !own(def.triggers, source.trigger)) return false;
      const rule = def.triggers[source.trigger], evidence = source.evidence;
      if (rule.event) return fields(evidence, ['kind', 'events']) && evidence.kind === 'event' &&
        Array.isArray(evidence.events) && evidence.events.length === (rule.count ?? 1) &&
        evidence.events.every(id => typeof id === 'string' && /^\d{1,8}\.\d{1,4}$/.test(id) &&
          Number(id.split('.')[0]) > 0 && Number(id.split('.')[0]) <= tick);
      return fields(evidence, ['kind', 'field', 'since', 'ticks']) && evidence.kind === 'state' && evidence.field === rule.state.field &&
        Number.isSafeInteger(evidence.since) && evidence.since >= 0 && Number.isSafeInteger(evidence.ticks) &&
        evidence.ticks >= 0 && evidence.since + evidence.ticks <= tick;
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
        check(fields(row, ['transitions', 'dropped', 'source', 'flow', 'deadlines', 'parent', 'cleanup']) &&
          Number.isSafeInteger(row.dropped) && row.dropped >= 0 &&
          Array.isArray(row.transitions) && row.transitions.length > 0 && row.transitions.length <= limit &&
          (!row.dropped || row.transitions.length === limit), message);
        let previous;
        for (const change of row.transitions) {
          check(fields(change, ['from', 'to', 'tick', 'reason', 'outcome', 'deadline']) &&
            (allowed(change.from, change.to) ||
              (change.from === null && change.to === 'expired' && change.deadline?.clock === 'world')) &&
            Number.isSafeInteger(change.tick) && change.tick > 0 && change.tick <= tick && reasonOK(change.reason) &&
            outcomeOK(def, change.to, change.outcome) &&
            (previous ? change.from === previous.to && change.tick >= previous.tick : (change.from === null) === (row.dropped === 0)), message);
          previous = change;
        }
        const cutOffBeforeOffer = previous.from === null && previous.to === 'expired';
        check(W.storyDeadlines.valid(def.clock, row, tick) && W.storyCleanup.valid(row.cleanup, def.cleanup, previous, tick) &&
          (cutOffBeforeOffer ? row.source === undefined : validateEvidence(row, def, tick)), message);
      }
      check(feasibility ? record(gates) && equal(Object.keys(gates).sort(),gateKeys) : gates === undefined,
        'Invalid story feasibility checkpoint table');
      for (const key of gateKeys) {
        const gate = gates[key], row = state[key], first = row?.transitions[0], def = entries.get(key), owner = parents.get(key);
        const message = 'Invalid saved story feasibility for ' + key;
        const offered = row && (row.dropped > 0 || first.to === 'available');
        const trigger = triggers?.[key]?.start;
        if (gate === null) {
          check(!offered && (tick===0 || owner || def.triggers&&!trigger || first?.to==='expired'),message);
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
          check(request.parent===undefined && validateEvidence(request,def,request.tick) &&
            (!def.triggers || trigger?.tick===request.tick && trigger.trigger===request.source?.trigger),message);
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
            id => gates?.[def.info.document + '/' + id]?.request.parent);
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

    function advance(previous, starts, commands, tick, emit, events, query, previousGates) {
      let state = previous, gates = previousGates, queuedOpens = [];
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
      function offer(key, source, parent, publish = emit) {
        const def = entries.get(key);
        if (def.feasibility) {
          const prior = gates[key];
          if (prior?.report.tick === tick) return;
          const request = prior?.request ?? {tick,...(source&&{source}),...(parent&&{parent})};
          const report = W.storyFeasibility.evaluate(def.feasibility,tick,query());
          if (gates === previousGates) gates = {...previousGates};
          gates[key] = {request,report};
          if (!report.ready) return;
          ({source,parent} = request);
        }
        const reason = parent ? 'parent-stage-opened' : source ? 'trigger-matched' : 'authored-offer';
        transition(key,'available',reason,undefined,{publish,source,parent});
        if (def.activation === 'automatic') transition(key,'active','automatic-activation',undefined,{publish});
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
        publish('story-stage-entered', { ...info, stage, visit, reason });
        const ids = def.stages[stage].children?.open;
        if (ids) {
          const parent = { document: info.document, story: info.story, stage, visit, tick };
          if (queuedOpens) queuedOpens.push({ ids, parent, publish });
          else openChildren(ids, parent, publish);
        }
      }
      function transition(key, to, reason, outcome, options = {}) {
        const prior = state[key], from = statusOf(prior), def = entries.get(key), { info, stages, clock } = def;
        const { publish = emit, source = prior?.source, deadline, parent = prior?.parent } = options;
        const started = from === 'available' && to === 'active';
        const flow = started && stages ? W.storyStages.initial(info.stage,tick) :
          to === 'suspended' ? W.storyStages.clearProgress(prior?.flow) : prior?.flow;
        const deadlines = W.storyDeadlines.transition(clock, prior?.deadlines, from, to, tick);
        const change = { from, to, tick, reason, ...(outcome !== undefined && { outcome }), ...(deadline && { deadline }) };
        const cleanup = W.storyCleanup.begin(def.cleanup, change);
        const transitions = [...(prior?.transitions ?? []), change];
        const overflow = Math.max(0, transitions.length - limit);
        save(key, { transitions: transitions.slice(overflow), dropped: (prior?.dropped ?? 0) + overflow,
          ...(source && { source }), ...(flow && { flow }), ...(deadlines && { deadlines }), ...(parent && {parent}),
          ...(cleanup && {cleanup}) });
        const stage = flow?.current ?? flow?.route.at(-1);
        const link = parent ? { parent } : {};
        publish('story-transition', { ...info, ...change, ...source, ...link, ...(stage && { stage:stage.stage, visit:stage.visit }) });
        if (started) {
          publish('story-started', { ...info, ...source, ...link });
          if (flow) enterStage(publish,def,flow,reason);
        }
      }
      function progress(key, def, row, result, publish) {
        const { stage, visit } = row.flow.current, step = { ...def.info, stage, visit };
        save(key, { ...row, flow:result.flow });
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
      for (const key of order) {
        const def = entries.get(key), before = previous[key], source = matched.get(key), status = statusOf(before);
        const { row: prior, expired } = W.storyDeadlines.advance(def.clock, before, status, tick);
        if (prior !== before) save(key, prior);
        if (expired) {
          transition(key, 'expired', expired.reason, undefined, { deadline: expired.receipt });
          continue;
        }
        if (status === 'active' && prior.flow?.current) {
          const { stage, visit } = prior.flow.current, rules = def.evidence.get(stage);
          if (rules) {
            const { flow, changes } = W.storyStages.confirm(prior.flow, rules, tick, eventsOf, query);
            if (flow !== prior.flow) {
              save(key, { ...prior, flow });
              for (const [objective, change] of Object.entries(changes))
                emit('story-objective-resolved', { ...def.info, stage, visit, objective, ...change });
            }
          }
        }
        if (prior === null && (gates?.[key] || !parents.has(key) && (!def.triggers || source)))
          offer(key,source);
      }
      const opens = queuedOpens;
      queuedOpens = null;
      for (const { ids, parent, publish } of opens) openChildren(ids, parent, publish);
      for (const { action, args, publish } of commands) {
        const { to, reason, outcome } = args, key = keyOf(args), from = statusOf(state[key]);
        if (action !== 'story-transition') {
          const def = entries.get(key), row = state[key];
          const result = from === 'active' ? W.storyStages.advance(action,def,row.flow,args,tick,readChild(def)) : { rejected:'story-not-active' };
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
        transition(key, to, reason, outcome, { publish });
      }
      for (const key of autoOrder) {
        const def = entries.get(key), row = state[key], current = row?.flow?.current;
        if (statusOf(row) !== 'active' || !current || current.enteredAt === tick) continue;
        const { stage, visit } = current;
        for (const branch of def.automatic.get(stage) ?? []) {
          const result = W.storyStages.advance('story-choose',def,row.flow,
            { stage, visit, branch, reason:'child-results-matched' },tick,readChild(def));
          if (!result.rejected) {
            progress(key,def,row,result,emit);
            break;
          }
        }
      }
      return {state:freeze(state),gates:gates&&freeze(gates)};
    }

    return { initial: () => freeze(Object.fromEntries(order.map(key => [key, null]))), validate, advance, checkAction,
      ...(feasibility&&{feasibility,initialFeasibility:()=>freeze(Object.fromEntries(gateKeys.map(key=>[key,null])))}),
      ...(cleanupOrder.length && {cleanup}) };
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

  W.storyLifecycle = Object.freeze({ compile, inspect, actions });
})(KIT);
