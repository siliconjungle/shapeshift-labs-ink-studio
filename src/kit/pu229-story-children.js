/* Child questlet waits and the terminal results observed by an arc. */
(function (K) {
  const W = K.world, { equal, own, record } = W.data;
  const terminal = new Set(['completed', 'failed', 'withdrawn', 'expired']);
  const waitIds = stage => stage.children?.wait?.any ?? stage.children?.wait?.all ?? [];
  const watched = (stage, branches) => [...new Set([
    ...(stage.children?.open ?? []), ...waitIds(stage), ...branches.flatMap(branch => Object.keys(branch.requiresChildren ?? {}))
  ])].sort();

  function status(row) {
    if (!row) return null;
    const { to, tick, reason, outcome } = row.transitions.at(-1);
    return { status: to, tick, reason, ...(outcome !== undefined && { outcome }) };
  }

  function result(row) {
    const observed = status(row);
    return terminal.has(observed?.status) ? observed : null;
  }

  function capture(stage, branch, read) {
    if (!stage.children && !branch.requiresChildren) return undefined;
    const ids = watched(stage, [branch]);
    if (!ids.length) return undefined;
    return Object.fromEntries(ids.map(id => [id, result(read(id))]).filter(([, value]) => value !== null));
  }

  function pendingWait(stage, results) {
    const ids = waitIds(stage), pending = ids.filter(id => !own(results, id));
    return stage.children?.wait?.any && pending.length < ids.length ? [] : pending;
  }

  function gate(stage, branch, results) {
    const pending = new Set(pendingWait(stage, results)), mismatched = [];
    for (const [id, condition] of Object.entries(branch.requiresChildren ?? {})) {
      if (!own(results, id)) pending.add(id);
      else if (Object.entries(condition).some(([key, expected]) => results[id][key] !== expected)) mismatched.push(id);
    }
    if (pending.size) return { rejected: 'children-pending', pendingChildren: [...pending].sort() };
    if (mismatched.length) return { rejected: 'child-outcome-mismatch', mismatchedChildren: mismatched.sort() };
    return null;
  }

  function validResults(stage, branch, row, read) {
    const { children, leftAt } = row;
    if (!stage.children && !branch.requiresChildren) return children === undefined;
    const ids = watched(stage, [branch]);
    if (!record(children) || Object.keys(children).some(id => !ids.includes(id))) return false;
    for (const id of ids) {
      const actual = result(read(id));
      if (own(children, id)) {
        if (!actual || actual.tick > leftAt || !equal(children[id], actual)) return false;
      } else if (actual && actual.tick < leftAt) return false;
    }
    return !gate(stage, branch, children);
  }

  function opened(stage, visit, read, request) {
    return (stage.children?.open ?? []).every(id => {
      const child = read(id), first = child?.transitions[0];
      const parent = child?.parent ?? request(id);
      return parent ? parent.visit <= visit.visit :
        first?.deadline?.clock === 'world' && first.from === null && first.tick <= visit.enteredAt;
    });
  }

  function inspect(stage, read) {
    const ids = watched(stage, Object.values(stage.next)), records = {};
    if (!ids.length) return undefined;
    for (const id of ids) records[id] = status(read(id));
    const terminalResults = Object.fromEntries(Object.entries(records).filter(([, row]) => terminal.has(row?.status)));
    const pending = pendingWait(stage, terminalResults);
    return { ...stage.children, ready: !pending.length, pending, stories: records };
  }

  W.storyChildren = Object.freeze({ capture, gate, validResults, opened, inspect });
})(KIT);
