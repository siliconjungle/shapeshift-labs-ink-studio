/* Receipts from the original event batch or a query of the completed world tick. */
(function (K) {
  const W = K.world, { check, copy, equal, id, own, read, record, selector } = W.data;
  const receiptLimit = 16384;
  const matches = (source, event) => event.kind === source.kind &&
    (source.system === undefined || event.system === source.system) && W.query.condition(source.where, event);
  const queryTarget = ({ field, at, args, select }) => ({ field, ...(at !== undefined && { at }),
    ...(args !== undefined && { args }), ...(select !== undefined && { select }) });

  function compiler(world, systems) {
    let registry, count = 0;
    return function compile(stages, story) {
      const byStage = new Map();
      for (const [stage, definition] of Object.entries(stages ?? {})) {
        const rules = new Map();
        for (const objective of Object.keys(definition.objectives ?? {}).sort()) {
          const rule = definition.objectives[objective].evidence;
          if (!rule) continue;
          const location = [story, stage, objective].join('/');
          check(++count <= 256, 'World story objective evidence budget exceeds 256 rules');
          if (rule.event) {
            const { system } = rule.event;
            check(system === undefined || system === 'world' || own(systems, system),
              'Unknown objective evidence event source ' + system + ' in ' + location);
          } else {
            const weather = world.visual?.weatherTracks || world.visual?.environmentPreset;
            registry ??= W.query.create({ world, ...(weather && { weatherTrackState: {} }) }, systems);
            check(registry.field(rule.state.field), 'Unknown objective evidence query field ' + rule.state.field + ' in ' + location);
          }
          rules.set(objective, rule);
        }
        if (rules.size) byStage.set(stage, rules);
      }
      return byStage;
    };
  }

  function index(events, length) {
    const indexed = new Map();
    for (let i = 0; i < length; i++) {
      const row = events[i];
      if (!indexed.has(row.kind)) indexed.set(row.kind, []);
      indexed.get(row.kind).push(row);
    }
    return indexed;
  }

  function observe(rule, tick, eventsOf, query) {
    if (rule.event) {
      const event = eventsOf(rule.event.kind).find(row => matches(rule.event, row));
      if (event) return bounded({ kind: 'event', event });
      return;
    }
    const { state } = rule;
    const sample = query().probe(state.field, state.at, state.args);
    if (sample.status !== 'ok') return;
    const value = state.select === undefined ? sample.value : read(sample.value, selector(state.select));
    if (value !== undefined && W.query.condition(state.when, value))
      return bounded({ kind: 'state', tick, ...queryTarget(state), value: copy(value) });
  }

  function bounded(receipt) {
    check(JSON.stringify(receipt).length <= receiptLimit,
      'Story objective receipt exceeds 16384 characters. Narrow the query with select or use a smaller source event.');
    return receipt;
  }

  function valid(rule, receipt, tick) {
    if (!record(receipt) || JSON.stringify(receipt).length > receiptLimit) return false;
    if (rule.event) {
      const { event } = receipt;
      return receipt.kind === 'event' && Object.keys(receipt).length === 2 && record(event) &&
        event.tick === tick && typeof event.id === 'string' && /^\d{1,8}\.\d{1,4}$/.test(event.id) &&
        event.id.startsWith(tick + '.') &&
        id(event.system) && matches(rule.event, event);
    }
    return own(receipt, 'value') &&
      equal(receipt, { kind: 'state', tick, ...queryTarget(rule.state), value: receipt.value }) &&
      W.query.condition(rule.state.when, receipt.value);
  }

  W.storyEvidence = Object.freeze({ compiler, index, observe, valid });
})(KIT);
