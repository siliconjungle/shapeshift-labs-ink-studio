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

  function requirements(stage, branch) {
    const needed = Object.keys(stage.objectives ?? {}).filter(id => !stage.objectives[id].optional);
    return [...new Set([...needed, ...(branch.requires ?? [])])].sort();
  }

  function missing(stage, branch, objectives) {
    return requirements(stage, branch).filter(id => objectives[id]?.result !== 'completed');
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
    } else {
      check(isId(args.objective) && own(stage.objectives, args.objective) && ['completed', 'skipped'].includes(args.result),
        'Story objective needs a known objective and a completed or skipped result');
    }
  }

  function advance(action, definition, flow, args, tick) {
    const { current } = flow;
    if (args.stage !== current.stage || args.visit !== current.visit) return { rejected: 'stale-stage-visit' };
    const stage = definition.stages[current.stage], { reason } = args;
    if (action === 'story-objective') {
      const { objective, result } = args;
      if (own(current.objectives, objective)) return { rejected: 'objective-already-resolved' };
      if (result === 'skipped' && !stage.objectives[objective].optional) return { rejected: 'objective-required' };
      const change = { result, reason, tick };
      const next = { ...current, objectives: { ...current.objectives, [objective]: change } };
      return { flow: { ...flow, current: next }, objective: { objective, ...change } };
    }
    const branch = stage.next[args.branch], pending = missing(stage, branch, current.objectives);
    if (pending.length) return { rejected: 'objectives-pending', pending };
    const target = targetOf(branch), skipped = omitted(stage, current.objectives);
    const row = { ...current, branch: args.branch, reason, leftAt: tick, target, skipped };
    const route = [...flow.route, row], overflow = Math.max(0, route.length - limit);
    const next = own(target, 'stage') ? makeVisit(target.stage, current.visit + 1, tick) : null;
    return { flow: { current: next, route: route.slice(overflow), dropped: flow.dropped + overflow },
      branch: { branch: args.branch, reason, target, skipped } };
  }

  function validate(flow, definition, status, tick, firstActivation, reasonOK, message) {
    check(fields(flow, ['current', 'dropped', 'route']) && at(flow.dropped, 0, Number.MAX_SAFE_INTEGER - limit) &&
      Array.isArray(flow.route) && flow.route.length <= limit && (!flow.dropped || flow.route.length === limit), message);
    function visit(row, index, deadline, nextStage, after) {
      check(isId(row.stage) && own(definition.stages, row.stage) && (nextStage === undefined || row.stage === nextStage) &&
        row.visit === index && at(row.enteredAt, 1, deadline) && (after === undefined || row.enteredAt === after) && record(row.objectives), message);
      const stage = definition.stages[row.stage];
      for (const [id, change] of Object.entries(row.objectives)) {
        check(own(stage.objectives, id) && fields(change, ['reason', 'result', 'tick']) &&
          (change.result === 'completed' || change.result === 'skipped' && stage.objectives[id].optional) &&
          reasonOK(change.reason) && at(change.tick, row.enteredAt, deadline), message);
      }
      return stage;
    }
    let nextStage = flow.dropped ? undefined : definition.info.stage;
    let after = flow.dropped ? undefined : firstActivation, last;
    for (const [index, row] of flow.route.entries()) {
      check(fields(row, ['branch', 'enteredAt', 'leftAt', 'objectives', 'reason', 'skipped', 'stage', 'target', 'visit']) &&
        at(row.leftAt, 1, tick) && reasonOK(row.reason) && (!last || own(last.target, 'stage')), message);
      const stage = visit(row, flow.dropped + index + 1, row.leftAt, nextStage, after);
      check(isId(row.branch) && own(stage.next, row.branch), message);
      const branch = stage.next[row.branch];
      check(equal(targetOf(branch), row.target) && !missing(stage, branch, row.objectives).length &&
        equal(omitted(stage, row.objectives), row.skipped), message);
      nextStage = row.target.stage;
      after = row.leftAt;
      last = row;
    }
    if (flow.current === null) {
      const ending = last?.target.outcome;
      check(ending !== undefined && ending === status.outcome && last.leftAt === status.tick &&
        last.reason === status.reason && (definition.outcomes[ending].status ?? 'completed') === status.to, message);
    } else {
      check(fields(flow.current, ['enteredAt', 'objectives', 'stage', 'visit']) && (!last || own(last.target, 'stage')) &&
        status.to !== 'completed', message);
      visit(flow.current, flow.dropped + flow.route.length + 1, tick, nextStage, after);
    }
  }

  W.storyStages = Object.freeze({ initial, checkAction, advance, validate });
})(KIT);
