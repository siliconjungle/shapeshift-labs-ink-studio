/* Terminal story resource policies applied once at the next world boundary. */
(function (K) {
  const W = K.world, { check, equal, own, record } = W.data;
  const terminal = new Set(['completed', 'failed', 'withdrawn', 'expired']);
  const hasKeys = (row, keys) => record(row) && equal(Object.keys(row).sort(), keys);

  function compile(spec, systems, story) {
    if (!spec) return null;
    return Object.keys(spec).sort().map(id => {
      const rule = spec[id], kind = ['claim', 'offer', 'site'].find(key => own(rule, key)), target = rule[kind];
      const provider = own(systems, target.system) && systems[target.system].storyCleanup?.[kind];
      check(provider && (!provider.accepts || provider.accepts(target)), 'Unknown story cleanup ' + kind + ' target in ' + story + '/' + id);
      return { id, kind, target, keepOn:rule.keepOn ?? [], keepOutcomes:rule.keepOutcomes ?? [] };
    });
  }

  const kept = (rule, change) => rule.keepOn.includes(change.to) || rule.keepOutcomes.includes(change.outcome);

  function begin(rules, change) {
    if (!rules || !terminal.has(change.to)) return undefined;
    return { dueTick:change.tick + 1, actions:Object.fromEntries(rules.map(rule =>
      [rule.id, {status:kept(rule, change) ? 'kept' : 'pending'}])) };
  }

  function advance(cleanup, rules, tick, apply, publish) {
    if (!cleanup || cleanup.dueTick !== tick) return cleanup;
    const actions = { ...cleanup.actions };
    for (const rule of rules) {
      if (actions[rule.id].status !== 'pending') continue;
      const {status, reason} = apply(rule);
      check((status === 'applied' || status === 'skipped') && W.data.id(reason), 'Invalid story cleanup result ' + rule.id);
      const change = { status, reason, tick };
      actions[rule.id] = change;
      publish({ rule:rule.id, resource:rule.kind, target:rule.target, ...change });
    }
    return { ...cleanup, actions };
  }

  function valid(cleanup, rules, end, tick) {
    if (!rules || !terminal.has(end.to)) return cleanup === undefined;
    if (!hasKeys(cleanup, ['actions','dueTick']) || cleanup.dueTick !== end.tick + 1 ||
      !hasKeys(cleanup.actions, rules.map(rule => rule.id))) return false;
    return rules.every(rule => {
      const entry = cleanup.actions[rule.id];
      if (kept(rule, end)) return equal(entry, {status:'kept'});
      if (tick < cleanup.dueTick) return equal(entry, {status:'pending'});
      return hasKeys(entry, ['reason','status','tick']) && (entry.status === 'applied' || entry.status === 'skipped') &&
        W.data.id(entry.reason) && entry.tick === cleanup.dueTick;
    });
  }

  W.storyCleanup = Object.freeze({ compile, begin, advance, valid });
})(KIT);
