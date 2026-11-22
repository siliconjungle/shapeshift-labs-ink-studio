/* Reasoned branch selection and objective progress within a story stage visit. */
(function (K) {
  const W = K.world, { check, equal, own, record } = W.data;
  const limit = 64;
  const fields = (row, keys) => record(row) && equal(Object.keys(row).sort(), keys);
  const isId = id => typeof id === 'string';
  const at = (value, first, last) => Number.isSafeInteger(value) && value >= first && value <= last;
  const makeVisit = (stage, visit, tick) => ({ stage, visit, enteredAt: tick, objectives: {} });
  const initial = (stage, tick) => ({ current: makeVisit(stage, 1, tick), route: [], dropped: 0 });

  function targetOf(rule) {
    return own(rule, 'stage') ? { stage: rule.stage } : { outcome: rule.outcome };
  }

  function missing(stage, branch, objectives) {
    const failed = branch.requiresFailed ?? [], choices = branch.requiresChoice ?? {};
    const pending = failed.filter(id => objectives[id]?.result !== 'failed');
    for (const [id, option] of Object.entries(choices))
      if (objectives[id]?.receipt?.option !== option) pending.push(id);
    for (const id of Object.keys(stage.objectives ?? {}))
      if ((!stage.objectives[id].optional && !failed.includes(id) || branch.requires?.includes(id)) &&
        objectives[id]?.result !== 'completed') pending.push(id);
    return [...new Set(pending)].sort();
  }

  function omitted(stage, objectives) {
    return Object.keys(stage.objectives ?? {}).filter(id => !own(objectives, id)).sort();
  }

  function checkAction(action, stages, args) {
    check(isId(args.stage) && own(stages, args.stage) && at(args.visit, 1, Number.MAX_SAFE_INTEGER),
      'Story progress needs a known stage and positive visit number');
    const stage = stages[args.stage];
    if (action === 'story-choose') {
      check(isId(args.branch) && own(stage.next, args.branch), 'Unknown branch for story stage ' + args.stage);
      return;
    }
    check(isId(args.objective) && own(stage.objectives, args.objective), 'Story progress needs a known objective');
    const objective = stage.objectives[args.objective];
    if (action === 'story-select') {
      check(objective.type === 'choose' && isId(args.option) && own(objective.params.options, args.option),
        'Story choice requires a known option on a choose objective');
      return;
    }
    check(['completed', 'skipped'].includes(args.result), 'Story objective needs a completed or skipped result');
    check(args.result !== 'completed' || (!objective.evidence && objective.type === undefined),
      objective.type === 'choose' ? 'Use story-select to complete a choice objective' :
        'Story objective requires world evidence to complete: ' + args.objective);
  }

  function confirm(flow, rules, tick, eventsOf, query) {
    const changes = {}, progress = { ...flow.current.progress };
    for (const [id, rule] of rules) {
      if (rule.options || own(flow.current.objectives, id)) continue;
      const result = W.storyEvidence.observe(rule, tick, eventsOf, query, progress[id]);
      if (result.change) changes[id] = result.change;
      if (result.progress) progress[id] = result.progress;
      else delete progress[id];
    }
    if (!Object.keys(changes).length && equal(progress, flow.current.progress ?? {})) return { flow, changes };
    return { flow: withObjectives(flow, changes, progress), changes };
  }

  function withObjectives(flow, changes, progress) {
    const current = { ...flow.current, objectives: { ...flow.current.objectives, ...changes } };
    if (Object.keys(progress).length) current.progress = progress;
    else delete current.progress;
    return { ...flow, current };
  }

  function clearProgress(flow) {
    if (!flow?.current?.progress) return flow;
    return withObjectives(flow, {}, {});
  }

  function advance(action, definition, flow, args, tick, readChild) {
    const { current } = flow;
    if (args.stage !== current.stage || args.visit !== current.visit) return { rejected: 'stale-stage-visit' };
    const stage = definition.stages[current.stage], { reason } = args;
    if (action !== 'story-choose') {
      const { objective, option } = args, selected = action === 'story-select';
      const { type, optional } = stage.objectives[objective], result = selected ? 'completed' : args.result;
      if (own(current.objectives, objective)) return { rejected: 'objective-already-resolved' };
      if (result === 'skipped' && !optional) return { rejected: 'objective-required' };
      const change = { result, reason, tick, ...(type !== undefined && { type }),
        ...(selected && { receipt: {kind:'choice', option, tick} }) };
      const progress = { ...current.progress };
      delete progress[objective];
      return { flow: withObjectives(flow, { [objective]: change }, progress), objective: { objective, ...change } };
    }
    const branch = stage.next[args.branch], pending = missing(stage, branch, current.objectives);
    if (pending.length) return { rejected: 'objectives-pending', pending };
    const children = W.storyChildren.capture(stage, branch, readChild);
    if (children) {
      const blocked = W.storyChildren.gate(stage, branch, children);
      if (blocked) return blocked;
    }
    const target = targetOf(branch), skipped = omitted(stage, current.objectives);
    const { progress, ...visit } = current;
    const row = { ...visit, branch: args.branch, reason, leftAt: tick, target, skipped, ...(children && {children}) };
    const route = [...flow.route, row], overflow = Math.max(0, route.length - limit);
    const next = own(target, 'stage') ? makeVisit(target.stage, current.visit + 1, tick) : null;
    return { flow: { current: next, route: route.slice(overflow), dropped: flow.dropped + overflow },
      branch: { branch: args.branch, reason, target, skipped, ...(children && {children}) } };
  }

  function validate(flow, definition, status, tick, firstActivation, reasonOK, message, readChild) {
    check(fields(flow, ['current', 'dropped', 'route']) && at(flow.dropped, 0, Number.MAX_SAFE_INTEGER - limit) &&
      Array.isArray(flow.route) && flow.route.length <= limit && (!flow.dropped || flow.route.length === limit), message);
    function visit(row, index, deadline, nextStage, after) {
      check(isId(row.stage) && own(definition.stages, row.stage) && (nextStage === undefined || row.stage === nextStage) &&
        row.visit === index && at(row.enteredAt, 1, deadline) && (after === undefined || row.enteredAt === after) && record(row.objectives), message);
      const stage = definition.stages[row.stage];
      check(W.storyChildren.opened(stage, row, readChild), message);
      const rules = definition.evidence.get(row.stage);
      for (const [id, change] of Object.entries(row.objectives)) {
        const objective = own(stage.objectives, id) && stage.objectives[id];
        const rule = rules?.get(id), failed = change?.result === 'failed';
        const proof = change?.result === 'skipped' ? undefined : rule;
        const keys = ['reason', ...(proof ? ['receipt'] : []), 'result', 'tick', ...(rule?.type ? ['type'] : [])];
        check(objective && fields(change, keys) && change.type === rule?.type &&
          (change.result === 'completed' || change.result === 'skipped' && objective.optional || failed && rule?.failOnViolation) &&
          reasonOK(change.reason) && at(change.tick, row.enteredAt, deadline), message);
        if (proof?.options) {
          const option = change.receipt?.option;
          check(isId(option) && own(proof.options, option) && equal(change.receipt, {kind:'choice', option, tick:change.tick}), message);
        } else if (proof) {
          check(change.reason === (failed ? 'condition-violated' : 'evidence-confirmed') && change.tick > row.enteredAt &&
            W.storyEvidence.valid(proof, change.receipt, change.tick, row.enteredAt, failed), message);
        }
      }
      if (own(row, 'progress')) {
        check(record(row.progress) && Object.keys(row.progress).length > 0, message);
        for (const [id, window] of Object.entries(row.progress)) {
          const duration = rules?.get(id)?.duration;
          check(duration !== undefined && !own(row.objectives, id) && fields(window, ['since','tick']) &&
            at(window.since, row.enteredAt + 1, window.tick) && at(window.tick, window.since, deadline) &&
            window.tick - window.since < duration, message);
        }
      }
      return stage;
    }
    let nextStage = flow.dropped ? undefined : definition.info.stage;
    let after = flow.dropped ? undefined : firstActivation, last;
    for (const [index, row] of flow.route.entries()) {
      check(fields(row, ['branch', ...(own(row, 'children') ? ['children'] : []), 'enteredAt', 'leftAt', 'objectives',
        'reason', 'skipped', 'stage', 'target', 'visit']) &&
        at(row.leftAt, 1, tick) && reasonOK(row.reason) && (!last || own(last.target, 'stage')), message);
      const stage = visit(row, flow.dropped + index + 1, row.leftAt, nextStage, after);
      check(isId(row.branch) && own(stage.next, row.branch), message);
      const branch = stage.next[row.branch];
      check(equal(targetOf(branch), row.target) && !missing(stage, branch, row.objectives).length &&
        equal(omitted(stage, row.objectives), row.skipped) && W.storyChildren.validResults(stage, branch, row, readChild), message);
      nextStage = row.target.stage;
      after = row.leftAt;
      last = row;
    }
    if (flow.current === null) {
      const ending = last?.target.outcome;
      check(ending !== undefined && ending === status.outcome && last.leftAt === status.tick &&
        last.reason === status.reason && (definition.outcomes[ending].status ?? 'completed') === status.to, message);
    } else {
      check(fields(flow.current, ['enteredAt', 'objectives', ...(own(flow.current, 'progress') ? ['progress'] : []), 'stage', 'visit']) &&
        (!last || own(last.target, 'stage')) &&
        status.to !== 'completed', message);
      visit(flow.current, flow.dropped + flow.route.length + 1, tick, nextStage, after);
    }
  }

  W.storyStages = Object.freeze({ initial, checkAction, advance, validate, confirm, clearProgress });
})(KIT);
