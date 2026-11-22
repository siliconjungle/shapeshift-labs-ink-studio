/* Explainable casting over snapshot queries and authored story role bindings. */
(function(K) {
  const W = K.world, {copy, check, id, endpoint, own, read, record, selector, vector} = W.data;
  const field = 'world/story-candidates';
  const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const ids = value => Array.isArray(value) && value.length > 0 && value.length <= 128 &&
    value.every(id) && new Set(value).size === value.length;
  const nonnegative = value => Number.isFinite(value) && value >= 0;
  const result = (status, reason, actual) => ({status, reason, ...(actual !== undefined && {actual})});
  const unavailable = (reason, actual) => result('unavailable', reason, actual);
  const compared = (matches, actual, failure = 'condition-mismatch') => result(
    matches ? 'pass' : 'fail', matches ? 'matched' : failure, actual);
  const site = value => vector(value) || keys(value, ['point']) && vector(value.point) ||
    keys(value, ['entity', 'socket']) && id(value.entity) && (value.socket === undefined || id(value.socket));

  function tags(name, rule) {
    check(keys(rule, ['all', 'path']) && ids(rule.all), 'Expected a nonempty list of distinct IDs in all');
    const path = selector(rule.path ?? ['metadata', name]);
    return candidate => {
      const actual = read(candidate, path);
      if (!Array.isArray(actual) || !actual.every(id)) return unavailable('missing-or-invalid-tags', actual);
      const missing = rule.all.filter(tag => !actual.includes(tag));
      return missing.length ? {...compared(false, actual, 'missing-required-tags'), missing} : compared(true, actual);
    };
  }
  function condition(rule) {
    check(record(rule), 'Expected a world query condition');
    W.query.condition(rule, undefined);
    return value => W.query.condition(rule, value);
  }
  function availability(candidate) {
    const {orders, travelPlan, formationDriven, mode, task, position, goal} = candidate;
    if (mode === 'dormant') return {state:'unavailable', reason:'dormant'};
    if (orders?.active || orders?.paused?.length || orders?.queue?.length || own(orders, 'priorTask'))
      return {state:'busy', reason:'agent-orders'};
    if (travelPlan) return {state:'busy', reason:'shared-travel'};
    if (formationDriven) return {state:'busy', reason:'formation'};
    if (task != null) return {state:'busy', reason:'assigned-task'};
    if (mode !== 'rest' && vector(position) && vector(goal) && position.some((value, axis) => value !== goal[axis]))
      return {state:'busy', reason:'destination-assigned'};
    return {state:'free', reason:'no-assignment'};
  }

  const criteria = {
    traits: rule => tags('traits', rule),
    capabilities: rule => tags('capabilities', rule),
    faction(rule) {
      check(keys(rule, ['is', 'path']) && id(rule.is), 'Expected a faction ID in is');
      const path = selector(rule.path ?? '/metadata/faction');
      return candidate => {
        const actual = read(candidate, path);
        return id(actual) ? compared(actual === rule.is, actual, 'different-faction') :
          unavailable('missing-or-invalid-faction', actual);
      };
    },
    relationship(rule) {
      check(keys(rule, ['with', 'when', 'path']) && id(rule.with), 'Expected a relationship counterpart ID in with');
      const matches = condition(rule.when), path = [...selector(rule.path ?? '/metadata/relationships'), rule.with];
      return candidate => {
        const actual = read(candidate, path);
        return actual === undefined ? unavailable('missing-relationship') : compared(matches(actual), actual);
      };
    },
    inventory(rule, query) {
      check(keys(rule, ['accountPath', 'atLeast']) && nonnegative(rule.atLeast),
        'Expected an accountPath and a nonnegative atLeast quantity');
      const path = selector(rule.accountPath);
      return candidate => {
        const account = read(candidate, path);
        if (typeof account !== 'string') return unavailable('missing-or-invalid-account', account);
        const sample = query.probe('world/account', undefined, {account});
        if (sample.status !== 'ok') return unavailable('account-unavailable', {account, reason:sample.reason});
        const {balance, resource, units} = sample.value;
        const actual = {account, balance, resource, units};
        return Number.isFinite(balance) ? compared(balance >= rule.atLeast, actual, 'insufficient-balance') :
          unavailable('expected-scalar-balance', actual);
      };
    },
    proximity(rule, query) {
      check(keys(rule, ['at', 'within']) && site(rule.at) && nonnegative(rule.within),
        'Expected a point or entity/socket in at and a nonnegative within distance');
      const point = query.target(rule.at)?.point;
      return candidate => {
        if (!point) return unavailable('target-unavailable');
        if (!vector(candidate.position)) return unavailable('candidate-position-unavailable');
        const distance = Math.hypot(...candidate.position.map((value, axis) => value - point[axis]));
        return Number.isFinite(distance) ? compared(distance <= rule.within, {distance, point}, 'outside-radius') :
          unavailable('distance-out-of-range');
      };
    },
    availability(rule) {
      check(['free', 'busy', 'unavailable'].includes(rule), 'Expected free, busy or unavailable');
      return candidate => {
        const actual = availability(candidate);
        return compared(actual.state === rule, actual, 'different-availability');
      };
    },
    where(rule) {
      const matches = condition(rule);
      const path = rule.path === undefined ? null : selector(rule.path);
      return candidate => compared(matches(candidate), path ? read(candidate, path) : undefined);
    },
    query(rule, query) {
      check(keys(rule, ['field', 'at', 'args', 'bind', 'select', 'when']) && rule.field !== field &&
        (rule.at === undefined || rule.at === 'candidate' || site(rule.at)) && record(rule.args ?? {}),
        'Expected a world field, optional args, and a point, entity/socket or candidate in at');
      endpoint(rule.field);
      const matches = condition(rule.when), selected = rule.select === undefined ? null : selector(rule.select);
      const bindings = projections(rule.bind ?? {});
      check(bindings.every(([key]) => !own(rule.args, key)), 'A bound query argument cannot also be supplied in args');
      return candidate => {
        const args = {...rule.args};
        for (const [key, path] of bindings) {
          const value = read(candidate, path);
          if (value === undefined) return unavailable('missing-query-argument', {argument:key});
          args[key] = value;
        }
        const at = rule.at === 'candidate' ? candidate.position : rule.at;
        if (rule.at === 'candidate' && !vector(at)) return unavailable('candidate-position-unavailable');
        const sample = query.probe(rule.field, at, args);
        const evidence = {field:rule.field, args, ...(at !== undefined && {at})};
        if (sample.status !== 'ok') return unavailable('query-unavailable', {...evidence, reason:sample.reason});
        const value = selected ? read(sample.value, selected) : sample.value;
        if (value === undefined) return unavailable('query-value-unavailable', evidence);
        return compared(matches(value), {...evidence, value});
      };
    }
  };
  function projections(table) {
    check(record(table) && Object.keys(table).length <= 32, 'Expected a projection table with up to 32 paths');
    return Object.entries(table).map(([key, path]) => {
      check(id(key), 'Invalid projection key ' + key);
      return [key, selector(path)];
    });
  }
  function prepareBinding(spec, query) {
    if (spec === undefined) return null;
    check(keys(spec, ['kind', 'story', 'role', 'select']), 'Invalid casting binding');
    let {kind, story, role, select} = spec;
    if (kind === undefined) {
      endpoint(story);
      check(id(role), 'A casting binding needs a story role ID');
      const sample = query.probe('world/story-roles', undefined, {story, role});
      check(sample.status === 'ok', 'Unknown casting story role ' + story + '/' + role);
      kind = sample.value.kind;
    } else {
      check(id(kind) && story === undefined && role === undefined, 'Use a binding kind or a story and role');
    }
    select ??= {system:'/system', agent:'/agent', generation:'/generation'};
    const map = record(select), paths = map ? projections(select) : [['value', selector(select)]];
    return {
      kind,
      project(candidate) {
        const entries = paths.map(([key, path]) => [key, read(candidate, path)]);
        const missing = entries.filter(([, value]) => value === undefined).map(([key]) => key);
        return missing.length ? {bindingMissing:missing} : {binding:{kind, value:map ?
          Object.fromEntries(entries) : entries[0][1]}};
      }
    };
  }

  function cast(input, query, {tick, time}) {
    check(keys(input, ['rosters', 'requirements', 'binding', 'limit']), 'Invalid casting query');
    const spec = copy(input), {rosters, requirements = {}, limit = 100} = spec;
    check(ids(rosters) && rosters.length <= 32, 'Casting needs 1 to 32 distinct roster IDs');
    check(record(requirements) && Object.keys(requirements).length <= 32, 'Casting accepts up to 32 named requirements');
    check(Number.isSafeInteger(limit) && limit >= 0 && limit <= 10000, 'Casting limit must be between 0 and 10000');
    const rules = Object.entries(requirements).map(([key, requirement]) => {
      check(id(key) && record(requirement) && Object.keys(requirement).length === 1, 'Invalid casting requirement ' + key);
      const [type, value] = Object.entries(requirement)[0];
      check(own(criteria, type), 'Unknown casting criterion ' + type + ' in ' + key);
      try {
        return [key, criteria[type](value, query)];
      } catch (error) {
        throw new Error('Casting requirement ' + key + ': ' + error.message);
      }
    });
    const binding = prepareBinding(spec.binding, query);
    const qualified = [], rejected = [];
    let considered = 0, qualifiedCount = 0;
    const sources = rosters.sort().map(system => {
      const sample = query.probe(system + '/agents');
      check(sample.status === 'ok' && record(sample.value), 'Casting roster is unavailable: ' + system);
      return [system, sample.value];
    });
    for (const [system, rows] of sources) {
      for (const agent of Object.keys(rows).sort()) {
        const row = rows[agent];
        check(record(row) && id(agent) && Number.isSafeInteger(row.generation) && row.generation > 0,
          'Invalid casting roster entry ' + system + '/' + agent);
        const candidate = {...row, system, agent};
        const checks = Object.fromEntries(rules.map(([key, test]) => [key, test(candidate)]));
        const projection = binding?.project(candidate);
        const qualifies = !projection?.bindingMissing && Object.values(checks).every(check => check.status === 'pass');
        const group = qualifies ? qualified : rejected;
        considered++;
        if (qualifies) qualifiedCount++;
        if (group.length < limit) {
          const {generation, name, entity} = candidate;
          group.push({system, agent, generation, ...(name !== undefined && {name}), ...(entity !== undefined && {entity}),
            qualifies, checks, ...(qualifies || projection?.bindingMissing ? projection : {})});
        }
      }
    }
    const candidates = qualified.concat(rejected).slice(0, limit);
    return {tick, time, rosters, requirements, ...(binding && {binding:{...spec.binding, kind:binding.kind}}),
      considered, qualified:qualifiedCount, omitted:considered - candidates.length, candidates};
  }
  W.storyCasting = Object.freeze({field, cast});
})(KIT);
