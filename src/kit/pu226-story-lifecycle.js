/* Story offers, commitments and terminal outcomes at the world tick boundary. */
(function (K) {
  const W = K.world, { check, record, own } = W.data, { freeze } = K.procedural.data;
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
    const entries = new Map();
    const compileEvidence = W.storyEvidence.compiler(world, systems);
    for (const document of documents) for (const [story, definition] of Object.entries(document.stories)) {
      if (!definition.lifecycle) continue;
      const { activation = 'automatic' } = definition.lifecycle;
      const info = { document: document.id, story, storyKind: definition.kind, stage: definition.entry };
      check(entries.size < 256, 'World story lifecycle budget exceeds 256 definitions');
      const key = keyOf(info), stages = definition.lifecycle.progression ? definition.stages : undefined;
      entries.set(key, { info, activation, outcomes: definition.outcomes, triggers: definition.triggers,
        stages, evidence: compileEvidence(stages, key, document.objectiveTypes),
        clock: W.storyDeadlines.compile(definition.lifecycle, world.dt) });
    }
    if (!entries.size) return null;
    const order = [...entries.keys()].sort();

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

    function validate(state, tick) {
      check(record(state) && Object.keys(state).length === entries.size, 'Malformed story lifecycle checkpoint');
      for (const [key, def] of entries) {
        check(own(state, key), 'Missing story lifecycle ' + key);
        const row = state[key];
        const message = 'Invalid saved story lifecycle for ' + key;
        if (row === null) {
          check(W.storyDeadlines.valid(def.clock, row, tick), message);
          continue;
        }
        check(fields(row, ['transitions', 'dropped', 'source', 'flow', 'deadlines']) && Number.isSafeInteger(row.dropped) && row.dropped >= 0 &&
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
        check(W.storyDeadlines.valid(def.clock, row, tick) &&
          (cutOffBeforeOffer ? row.source === undefined : validateEvidence(row, def, tick)), message);
        const hasFlow = Boolean(def.stages && row.transitions.some(change => change.to === 'active' || change.from === 'active' || change.from === 'suspended'));
        if (hasFlow) {
          const activated = row.transitions.find(change => change.from === 'available' && change.to === 'active');
          W.storyStages.validate(row.flow,def,previous,previous.deadline ? previous.tick - 1 : tick,activated?.tick,reasonOK,message);
        }
        else check(!own(row, 'flow'), message);
      }
    }

    function advance(previous, starts, commands, tick, emit, events, query) {
      let state = previous;
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
      function enterStage(publish, info, flow, reason) {
        const { stage, visit } = flow.current;
        publish('story-stage-entered', { ...info, stage, visit, reason });
      }
      function transition(key, to, reason, outcome, { publish = emit, source = state[key]?.source, deadline } = {}) {
        const prior = state[key], from = statusOf(prior), { info, stages, clock } = entries.get(key);
        const started = from === 'available' && to === 'active';
        const flow = started && stages ? W.storyStages.initial(info.stage,tick) :
          to === 'suspended' ? W.storyStages.clearProgress(prior?.flow) : prior?.flow;
        const deadlines = W.storyDeadlines.transition(clock, prior?.deadlines, from, to, tick);
        const change = { from, to, tick, reason, ...(outcome !== undefined && { outcome }), ...(deadline && { deadline }) };
        const transitions = [...(prior?.transitions ?? []), change];
        const overflow = Math.max(0, transitions.length - limit);
        save(key, { transitions: transitions.slice(overflow), dropped: (prior?.dropped ?? 0) + overflow,
          ...(source && { source }), ...(flow && { flow }), ...(deadlines && { deadlines }) });
        const stage = flow?.current ?? flow?.route.at(-1);
        publish('story-transition', { ...info, ...change, ...source, ...(stage && { stage:stage.stage, visit:stage.visit }) });
        if (started) {
          publish('story-started', { ...info, ...source });
          if (flow) enterStage(publish,info,flow,reason);
        }
      }
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
        if (prior === null && (!def.triggers || source)) {
          transition(key, 'available', source ? 'trigger-matched' : 'authored-offer', undefined, { source });
          if (def.activation === 'automatic') transition(key, 'active', 'automatic-activation');
        }
      }
      for (const { action, args, publish } of commands) {
        const { to, reason, outcome } = args, key = keyOf(args), from = statusOf(state[key]);
        if (action !== 'story-transition') {
          const def = entries.get(key), row = state[key];
          const result = from === 'active' ? W.storyStages.advance(action,def,row.flow,args,tick) : { rejected:'story-not-active' };
          const step = { ...def.info, stage:args.stage, visit:args.visit };
          if (result.rejected) {
            publish('story-progress-rejected', { ...step, action, reason:result.rejected, requestedReason:reason,
              ...(args.branch !== undefined && { branch:args.branch }), ...(args.objective !== undefined && { objective:args.objective }),
              ...(args.option !== undefined && { option:args.option }),
              ...(result.pending && { pending:result.pending }) });
            continue;
          }
          save(key, { ...row, flow:result.flow });
          if (result.objective) publish('story-objective-resolved', { ...step, ...result.objective });
          else {
            publish('story-branch-chosen', { ...step, ...result.branch });
            const end = result.branch.target.outcome;
            if (end === undefined) enterStage(publish,def.info,result.flow,reason);
            else transition(key,def.outcomes[end].status ?? 'completed',reason,end,{ publish });
          }
          continue;
        }
        if (!allowed(from, to)) {
          publish('story-transition-rejected', { ...entries.get(key).info, from, to, reason: 'transition-not-allowed', requestedReason: reason });
          continue;
        }
        transition(key, to, reason, outcome, { publish });
      }
      return freeze(state);
    }

    return { initial: () => freeze(Object.fromEntries(order.map(key => [key, null]))), validate, advance, checkAction };
  }

  function inspect(state, at) {
    return Object.fromEntries(Object.entries(state).map(([key, row]) => {
      if (!row) return [key, null];
      const end = row.transitions.at(-1), { tick, to, reason, outcome, deadline } = end;
      return [key, { status: to, since: tick, reason, ...(outcome !== undefined && { outcome }), ...row,
        ...(deadline && { deadline }),
        ...(row.deadlines && { deadlines: W.storyDeadlines.inspect(row.deadlines, end, at) }) }];
    }));
  }

  W.storyLifecycle = Object.freeze({ compile, inspect, actions });
})(KIT);
