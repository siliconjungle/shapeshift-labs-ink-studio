/* Portable story definition validation shared by the CLI and world runtime. */
const StoryDocument = (() => {
  const format = 'ink-studio/story';
  const version = 1;
  const kinds = new Set(['incident', 'questlet', 'arc']);
  const objectiveKinds = new Set(['reach', 'acquire', 'deliver', 'protect', 'observe', 'build', 'maintain', 'survive', 'negotiate', 'choose']);
  const safeId = value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,99}$/i.test(value) &&
    !['constructor', 'prototype', '__proto__'].includes(value);

  function invalid(at, message, code = 'invalid-document') {
    throw Object.assign(new TypeError(`${at}: ${message}`), { storyIssue: { code, path:at, message, severity:'error' } });
  }

  function record(value, at) {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(at, 'expected an object');
  }

  function fields(value, at, required, optional = []) {
    record(value, at);
    for (const key of Object.keys(value))
      if (!required.includes(key) && !optional.includes(key)) invalid(`${at}.${key}`, 'unknown field');
    for (const key of required)
      if (!Object.hasOwn(value, key)) invalid(`${at}.${key}`, 'required field');
  }

  function entries(value, at, required = false) {
    record(value, at);
    const rows = Object.entries(value);
    if (required && !rows.length) invalid(at, 'expected at least one entry');
    for (const [key] of rows) if (!safeId(key)) invalid(at, `invalid ID ${JSON.stringify(key)}`);
    return rows;
  }

  function text(value, at) {
    if (typeof value !== 'string' || !value.trim()) invalid(at, 'expected nonempty text');
  }

  function link(value, table, at, label, report) {
    if (safeId(value) && table && Object.hasOwn(table, value)) return true;
    const message = `unknown ${label} ${JSON.stringify(value)}`;
    if (!report) invalid(at, message, 'missing-reference');
    report({ code:'missing-reference', path:at, message, severity:'error' });
    return false;
  }

  function links(values, table, at, label, report) {
    if (!Array.isArray(values)) invalid(at, 'expected an array of IDs');
    const seen = new Set();
    for (const [index, value] of values.entries()) {
      const item = `${at}[${index}]`;
      link(value, table, item, label, report);
      if (seen.has(value)) invalid(item, `duplicate ${label} ${JSON.stringify(value)}`);
      seen.add(value);
    }
  }

  function labelsAndRefs(value, at, references, report) {
    text(value.title, `${at}.title`);
    if (Object.hasOwn(value, 'summary')) text(value.summary, `${at}.summary`);
    if (Object.hasOwn(value, 'refs')) links(value.refs, references, `${at}.refs`, 'reference', report);
  }

  function dataPath(path, at) {
    const safeKey = key => typeof key === 'string' && key.length > 0 && !['constructor', 'prototype', '__proto__'].includes(key);
    const parts = typeof path === 'string' && path.startsWith('/') && !/~(?![01])/u.test(path) ?
      path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~')) : path;
    if (!Array.isArray(parts) || !parts.length || parts.length > 64 || Array.from(parts).some(key =>
      !(safeKey(key) || Number.isSafeInteger(key) && key >= 0))) invalid(at, 'expected a valid path array or JSON Pointer');
    return parts;
  }

  function roleToken(token, at, qualified = false) {
    fields(token, at, qualified ? ['$role', 'story'] : ['$role'], ['path']);
    if (!safeId(token.$role)) invalid(`${at}.$role`, 'expected a role ID');
    if (qualified && (typeof token.story !== 'string' || token.story.split('/').length !== 2 ||
      !token.story.split('/').every(safeId))) invalid(`${at}.story`, 'expected document/story IDs');
    return Object.hasOwn(token, 'path') ? dataPath(token.path, `${at}.path`) : [];
  }

  function mapRoleValues(value, at, replace) {
    if (!value || typeof value !== 'object') return value;
    if (Object.hasOwn(value, '$role')) return replace(value, at);
    if (Array.isArray(value)) {
      const rows = value.map((item, i) => mapRoleValues(item, `${at}[${i}]`, replace));
      return rows.some((item, i) => item !== value[i]) ? rows : value;
    }
    let result = value;
    for (const key of Object.keys(value)) {
      const item = mapRoleValues(value[key], `${at}.${key}`, replace);
      if (item !== value[key]) {
        if (result === value) result = { ...value };
        Object.defineProperty(result, key, { value:item, writable:true, configurable:true, enumerable:true });
      }
    }
    return result;
  }

  function roleUses(value, roles, at, report) {
    let used = false;
    mapRoleValues(value, at, (token, location) => {
      roleToken(token, location);
      link(token.$role, roles, `${location}.$role`, 'role', report);
      used = true;
      return token;
    });
    return used;
  }

  function condition(rule, at, depth = 0) {
    record(rule, at);
    if (depth >= 16) invalid(at, 'condition nesting exceeds 16 levels');
    const logical = ['all', 'any', 'not'].find(key => Object.hasOwn(rule, key));
    if (logical) {
      fields(rule, at, [logical]);
      const next = `${at}.${logical}`, value = rule[logical];
      if (logical === 'not') return condition(value, next, depth + 1);
      if (!Array.isArray(value) || !value.length || value.length > 128) invalid(next, 'expected 1–128 conditions');
      for (let i = 0; i < value.length; i++) condition(value[i], `${next}[${i}]`, depth + 1);
      return;
    }
    fields(rule, at, [], ['path', 'op', 'value']);
    const { path, op = 'eq', value } = rule;
    if (Object.hasOwn(rule, 'path')) dataPath(path, `${at}.path`);
    if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'exists'].includes(op)) invalid(`${at}.op`, 'unknown condition operator');
    if (op === 'exists') {
      if (Object.hasOwn(rule, 'value')) invalid(`${at}.value`, 'exists takes no value');
    } else if (value === undefined || ['lt', 'lte', 'gt', 'gte'].includes(op) && !Number.isFinite(value) ||
      op === 'in' && !Array.isArray(value)) invalid(`${at}.value`, 'expected a value for ' + op);
  }

  const worldName = value => typeof value === 'string' && /^[a-z0-9_][a-z0-9_.-]{0,95}$/i.test(value) &&
    !['constructor', 'prototype', '__proto__'].includes(value);
  const qualified = value => typeof value === 'string' && value.split('/').length === 2 && value.split('/').every(worldName);
  const transferAmount = value => Number.isFinite(value) && value > 0 ||
    Array.isArray(value) && [2,3].includes(value.length) && Array.from(value).every(Number.isFinite) && value.some(n => n !== 0);
  const point = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);

  function eventSource(rule, at) {
    fields(rule, at, ['kind'], ['system', 'where']);
    const { kind, system, where } = rule;
    if (!worldName(kind) || ['story-started', 'event-action-scheduled'].includes(kind))
      invalid(`${at}.kind`, 'expected a source event kind');
    if (Object.hasOwn(rule, 'system') && !worldName(system)) invalid(`${at}.system`, 'invalid system ID');
    if (Object.hasOwn(rule, 'where')) condition(where, `${at}.where`);
  }

  function stateSource(rule, location, selectable = false) {
    fields(rule, location, ['field', 'when'], ['at', 'args', ...(selectable ? ['select'] : [])]);
    const { field, when, args, at, select } = rule;
    if (typeof field !== 'string' || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(field) || field === 'world/story-triggers')
      invalid(`${location}.field`, 'expected a qualified world query field');
    if (Object.hasOwn(rule, 'args')) record(args, `${location}.args`);
    if (Object.hasOwn(rule, 'select')) dataPath(select, `${location}.select`);
    if (Object.hasOwn(rule, 'at')) {
      if (!point(at)) {
        if (at && Object.hasOwn(at, 'point')) {
          fields(at, `${location}.at`, ['point']);
          if (!point(at.point)) invalid(`${location}.at.point`, 'expected a finite XYZ point');
        } else {
          fields(at, `${location}.at`, ['entity'], ['socket']);
          if (!worldName(at.entity) || Object.hasOwn(at, 'socket') && !worldName(at.socket))
            invalid(`${location}.at`, 'invalid entity or socket ID');
        }
      }
    }
    condition(when, `${location}.when`);
  }

  function evidence(rule, at) {
    record(rule, at);
    if (Object.hasOwn(rule, 'event')) {
      fields(rule, at, ['event']);
      eventSource(rule.event, `${at}.event`);
    } else {
      fields(rule, at, ['state']);
      stateSource(rule.state, `${at}.state`, true);
    }
  }

  function objectiveTypes(types) {
    const at = 'story.objectiveTypes', rows = entries(types, at);
    if (rows.length > 64) invalid(at, 'a document supports up to 64 custom objective types');
    for (const [type, spec] of rows) {
      const location = `${at}.${type}`;
      if (objectiveKinds.has(type)) invalid(location, 'built-in objective type');
      fields(spec, location, ['evidence'], ['match']);
      roleUses(spec.evidence, {}, `${location}.evidence`);
      evidence(spec.evidence, `${location}.evidence`);
      if (Object.hasOwn(spec, 'match')) {
        const matches = entries(spec.match, `${location}.match`, true);
        if (matches.length > 16) invalid(`${location}.match`, 'expected up to 16 match parameters');
        for (const [name, path] of matches) dataPath(path, `${location}.match.${name}`);
      }
    }
  }

  function typedParams({type, params}, types, at, report, roles) {
    const location = `${at}.params`;
    const templated = roleUses(params, roles, location, report);
    if (!objectiveKinds.has(type)) {
      if (!link(type, types, `${at}.type`, 'objective type', report)) return;
      if (templated) return;
      fields(params ?? {}, location, Object.keys(types[type].match ?? {}));
      return;
    }
    if (templated) {
      if (type === 'choose') invalid(location, 'choice options must use authored IDs and labels');
      return;
    }
    const worldId = name => {
      if (!worldName(params[name])) invalid(`${location}.${name}`, 'expected a world ID');
    };
    const positive = name => {
      if (!Number.isFinite(params[name]) || params[name] <= 0) invalid(`${location}.${name}`, 'expected a positive finite number');
    };
    const account = name => {
      const value = params[name], parts = typeof value === 'string' ? value.split('/') : [];
      if (parts.length !== 2 || !parts.every(worldName)) invalid(`${location}.${name}`, 'expected a qualified account ID');
    };
    switch (type) {
      case 'reach':
        fields(params, location, ['system', 'agent', 'min', 'max'], ['generation']);
        worldId('system');
        worldId('agent');
        if (!point(params.min) || !point(params.max) || params.min.some((value, i) => value > params.max[i]))
          invalid(location, 'expected ordered finite XYZ bounds');
        if (Object.hasOwn(params, 'generation') && (!Number.isSafeInteger(params.generation) || params.generation < 1))
          invalid(`${location}.generation`, 'expected a positive agent generation');
        break;
      case 'acquire':
        fields(params, location, ['account', 'amount']);
        account('account');
        positive('amount');
        break;
      case 'deliver':
        fields(params, location, ['from', 'to', 'amount'], ['system']);
        account('from');
        account('to');
        if (params.from === params.to) invalid(location, 'expected two distinct transfer accounts');
        if (Object.hasOwn(params, 'system')) worldId('system');
        positive('amount');
        break;
      case 'observe':
        evidence(params, location);
        break;
      case 'build':
        fields(params, location, ['system']);
        worldId('system');
        break;
      case 'negotiate':
        fields(params, location, ['system', 'offer']);
        worldId('system');
        worldId('offer');
        break;
      case 'protect':
      case 'maintain':
      case 'survive':
        fields(params, location, ['state', 'for']);
        stateSource(params.state, `${location}.state`, true);
        positive('for');
        break;
      case 'choose':
        fields(params, location, ['options']);
        for (const [name, label] of entries(params.options, `${location}.options`, true)) text(label, `${location}.options.${name}`);
        if (Object.keys(params.options).length > 64) invalid(`${location}.options`, 'expected up to 64 options');
        break;
    }
  }

  function objectiveRule(objective, types) {
    const {type, params = {}, evidence} = objective;
    if (type === undefined) return evidence;
    const {system, agent, generation, min, max, account, from, to, amount, offer, state, options} = params;
    const equals = (path, value) => ({path, value});
    const atLeast = (path, value) => ({path, op: 'gte', value});
    switch (type) {
      case 'reach': return {type, state: {field: system + '/position', args: {agent, ...(generation !== undefined && {generation})},
        when: {all: min.flatMap((value, i) => [atLeast([i], value), {path: [i], op: 'lte', value: max[i]}])}}};
      case 'acquire': return {type, state: {field: 'world/account', args: {account}, when: atLeast('/balance', amount)}};
      case 'deliver': return {type, event: {kind: 'transfer', ...(system !== undefined && {system}),
        where: {all: [equals('/from', from), equals('/to', to), atLeast('/applied', amount)]}}};
      case 'observe': return {type, ...params};
      case 'build': return {type, event: {kind: 'construction-built', system}};
      case 'negotiate': return {type, event: {kind: 'offer-completed', system, where: equals('/offer', offer)}};
      case 'maintain':
      case 'protect':
      case 'survive': return {type, state, hold: params.for, failOnViolation: type !== 'maintain'};
      case 'choose': return {type, options};
      default: {
        const spec = types[type], source = spec.evidence.event ? 'event' : 'state';
        const filter = source === 'event' ? 'where' : 'when';
        const base = spec.evidence[source];
        const clauses = Object.keys(spec.match ?? {}).sort().map(name => equals(spec.match[name], params[name]));
        if (!clauses.length) return {type, ...spec.evidence};
        return {type, [source]: {...base, [filter]: {all: [...(base[filter] === undefined ? [] : [base[filter]]), ...clauses]}}};
      }
    }
  }

  function triggers(story, at, roles, report) {
    const table = `${at}.triggers`;
    for (const [name, rule] of entries(story.triggers, table, true)) {
      const location = `${table}.${name}`;
      record(rule, location);
      if (roleUses(rule, roles, location, report)) continue;
      if (Object.hasOwn(rule, 'event')) {
        fields(rule, location, ['event'], ['count', 'within']);
        eventSource(rule.event, `${location}.event`);
        const { count = 1, within } = rule;
        if (!Number.isInteger(count) || count < 1 || count > 128) invalid(`${location}.count`, 'expected an integer from 1 to 128');
        if (count > 1 && !(Number.isFinite(within) && within > 0) || count === 1 && Object.hasOwn(rule, 'within'))
          invalid(`${location}.within`, 'supply a positive window in seconds for counts greater than one');
      } else {
        fields(rule, location, ['state'], ['hold']);
        stateSource(rule.state, `${location}.state`);
        if (Object.hasOwn(rule, 'hold') && !(Number.isFinite(rule.hold) && rule.hold > 0))
          invalid(`${location}.hold`, 'expected a positive duration in seconds');
      }
    }
  }

  function feasibility(rules, at, roles, report) {
    const rows = entries(rules, at, true);
    if (rows.length > 16) invalid(at, 'expected up to 16 feasibility checks');
    const generation = value => Number.isSafeInteger(value) && value > 0;
    function agent(spec, location, extra, optional) {
      fields(spec, location, ['system', 'agent', ...extra], ['generation', ...optional]);
      if (!worldName(spec.system) || !worldName(spec.agent) || Object.hasOwn(spec, 'generation') && !generation(spec.generation))
        invalid(location, 'expected a roster and agent ID with an optional positive generation');
    }
    function pin(value, location) {
      if (point(value)) return;
      record(value, location);
      if (Object.hasOwn(value, 'agent')) {
        fields(value, location, ['agent'], ['socket']);
        fields(value.agent, location + '.agent', ['system', 'id'], ['generation']);
        const {system, id, generation:serial} = value.agent;
        if (!worldName(system) || !worldName(id) || Object.hasOwn(value.agent, 'generation') && !generation(serial))
          invalid(location, 'invalid agent pin');
      } else {
        fields(value, location, ['entity'], ['socket']);
        if (!worldName(value.entity)) invalid(location, 'invalid entity pin');
      }
      if (Object.hasOwn(value, 'socket') && !worldName(value.socket)) invalid(location + '.socket', 'invalid socket ID');
    }
    for (const [id, rule] of rows) {
      const location = at + '.' + id;
      fields(rule, location, [], ['route', 'transfer', 'work', 'state']);
      if (Object.keys(rule).length !== 1) invalid(location, 'expected one feasibility check type');
      if (roleUses(rule, roles, location, report)) continue;
      const [[type, spec]] = Object.entries(rule), place = location + '.' + type;
      if (type === 'route') {
        agent(spec, place, ['to'], ['from']);
        pin(spec.to, place + '.to');
        if (Object.hasOwn(spec, 'from')) pin(spec.from, place + '.from');
      } else if (type === 'transfer') {
        fields(spec, place, ['from', 'to', 'amount'], ['requester']);
        const {from, to, amount, requester} = spec;
        if (!qualified(from) || !qualified(to) || from === to || !transferAmount(amount) ||
          Object.hasOwn(spec, 'requester') && !worldName(requester)) invalid(place, 'invalid transfer accounts, amount, or requester');
      } else if (type === 'work') {
        fields(spec, place, ['site', 'workers'], ['batch']);
        if (!qualified(spec.site) || Object.hasOwn(spec, 'batch') && !generation(spec.batch) ||
            !Array.isArray(spec.workers) || spec.workers.length < 1 || spec.workers.length > 64)
          invalid(place, 'expected a qualified worksite, optional positive batch, and 1–64 workers');
        const seen = new Set();
        for (const [i, worker] of spec.workers.entries()) {
          const next = place + '.workers[' + i + ']';
          agent(worker, next, ['task'], ['params', 'targets']);
          const key = worker.system + '/' + worker.agent;
          if (!worldName(worker.task) || seen.has(key)) invalid(next, 'expected a task ID and distinct worker');
          seen.add(key);
          if (Object.hasOwn(worker, 'params')) record(worker.params, next + '.params');
          if (Object.hasOwn(worker, 'targets')) record(worker.targets, next + '.targets');
        }
      } else {
        stateSource(spec, place, true);
        if (spec.field === 'world/story-feasibility') invalid(place + '.field', 'recursive feasibility query');
      }
    }
  }

  function liveReferences(rules, at, roles, report) {
    const rows = entries(rules, at, true);
    if (rows.length > 16) invalid(at, 'expected up to 16 live references');
    const causes = ['died', 'missing', 'replaced', 'inaccessible', 'faction-changed', 'moved'];
    function actor(value, at) {
      fields(value, at, ['system', 'agent'], ['generation']);
      if (!worldName(value.system) || !worldName(value.agent) ||
          Object.hasOwn(value, 'generation') && (!Number.isSafeInteger(value.generation) || value.generation < 1))
        invalid(at, 'expected a roster and agent ID with an optional positive generation');
    }
    for (const [id, rule] of rows) {
      const place = at + '.' + id;
      fields(rule, place, ['target'], ['moveTolerance', 'factionPath', 'identityPath', 'death', 'access', 'on']);
      if (roleUses(rule, roles, place, report)) continue;
      record(rule.target, place + '.target');
      if (Object.hasOwn(rule.target, 'agent')) {
        fields(rule.target, place + '.target', ['agent']);
        actor(rule.target.agent, place + '.target.agent');
        if (Object.hasOwn(rule, 'identityPath')) invalid(place + '.identityPath', 'agents use their native generation');
      } else {
        fields(rule.target, place + '.target', ['entity'], ['socket']);
        if (!worldName(rule.target.entity) || Object.hasOwn(rule.target, 'socket') && !worldName(rule.target.socket))
          invalid(place + '.target', 'expected an entity ID and optional socket');
      }
      for (const key of ['identityPath', 'factionPath']) if (Object.hasOwn(rule, key)) dataPath(rule[key], place + '.' + key);
      if (Object.hasOwn(rule, 'moveTolerance') && (!Number.isFinite(rule.moveTolerance) || rule.moveTolerance < 0))
        invalid(place + '.moveTolerance', 'expected a nonnegative finite distance');
      if (Object.hasOwn(rule, 'death')) {
        fields(rule.death, place + '.death', ['event','target']);
        eventSource(rule.death.event, place + '.death.event');
        dataPath(rule.death.target, place + '.death.target');
      }
      if (Object.hasOwn(rule, 'access')) {
        fields(rule.access, place + '.access', [], ['routeFrom','state']);
        if (Object.keys(rule.access).length !== 1) invalid(place + '.access', 'expected one access check');
        if (Object.hasOwn(rule.access,'routeFrom')) actor(rule.access.routeFrom, place + '.access.routeFrom');
        else {
          stateSource(rule.access.state, place + '.access.state', true);
          if (['world/story-references','world/story-reference-target'].includes(rule.access.state.field))
            invalid(place + '.access.state.field', 'recursive live reference access query');
        }
      }
      if (Object.hasOwn(rule, 'on')) {
        fields(rule.on, place + '.on', [], causes);
        for (const [cause, action] of Object.entries(rule.on))
          if (!['track','suspend','fail','withdraw',...(cause==='replaced'?['adopt']:[])].includes(action) ||
              cause==='died' && !rule.death) invalid(place + '.on.' + cause, 'invalid live reference response or missing death event');
      }
    }
  }

  function commitment(value, at, roles, report) {
    fields(value, at, ['actor','order'], ['activity','terms','consider']);
    if (roleUses(value,roles,at,report)) return;
    const {actor, order, activity, terms, consider} = value;
    fields(actor,at+'.actor',['system','agent'],['generation']);
    if (!worldName(actor.system) || !worldName(actor.agent) || Object.hasOwn(actor,'generation') &&
        (!Number.isSafeInteger(actor.generation) || actor.generation<1)) invalid(at+'.actor','invalid actor handle');
    record(order,at+'.order');
    if (!worldName(order.task)) invalid(at+'.order.task','expected an agent order task ID');
    if (Object.hasOwn(value,'activity') && !worldName(activity)) invalid(at+'.activity','expected an activity ID');
    if (Object.hasOwn(value,'terms')) record(terms,at+'.terms');
    if (Object.hasOwn(value,'consider')) {
      const rules = entries(consider,at+'.consider',true);
      if (rules.length>16) invalid(at+'.consider','expected up to 16 consideration rules');
      for (const [id,rule] of rules) {
        const place=at+'.consider.'+id;
        fields(rule,place,['when','otherwise']);
        condition(rule.when,place+'.when');
        if (!['defer','refuse'].includes(rule.otherwise)) invalid(place+'.otherwise','expected defer or refuse');
      }
    }
  }

  function settlement(table,at,story,roles,report) {
    fields(table,at,[],['costs','outcomes']);
    if (!Object.keys(table).length) invalid(at,'expected costs or outcome effects');
    function effects(rows,location,costs) {
      const list = entries(rows,location,true);
      if (list.length>16) invalid(location,'expected up to 16 settlement effects');
      for (const [name,effect] of list) {
        const place = location+'.'+name;
        fields(effect,place,[],['transfer','claim','work','access','reputation','obligation']);
        if (Object.keys(effect).length!==1) invalid(place,'expected one settlement effect');
        const [[type,value]] = Object.entries(effect);
        if (type==='claim'&&!story.lifecycle.commitment) invalid(place,'access costs require a story commitment');
        if (type==='work'&&(costs||story.lifecycle.progression!==true)) invalid(place,'work receipts require a progressing outcome');
        if (roleUses(effect,roles,place,report)) continue;
        if (type==='transfer') {
          fields(value,place,['from','to','amount']);
          if (!qualified(value.from)||!qualified(value.to)||value.from===value.to||!transferAmount(value.amount))
            invalid(place,'expected two distinct transfer accounts and a valid quantity');
        } else if (type==='claim') {
          fields(value,place,['board','pool'],['units']);
          if (!worldName(value.board)||!worldName(value.pool)||Object.hasOwn(value,'units')&&
              (!Number.isSafeInteger(value.units)||value.units<1)) invalid(place,'invalid reservation claim selector');
        } else if (type==='work') {
          fields(value,place,['stage','objective','site','batch'],['actor']);
          if (!Number.isSafeInteger(value.batch)||value.batch<1||!qualified(value.site))
            invalid(place,'expected a worksite and positive batch');
          if (link(value.stage,story.stages,place+'.stage','stage',report))
            link(value.objective,story.stages[value.stage]?.objectives??{},place+'.objective','objective',report);
          if (Object.hasOwn(value,'actor')) {
            fields(value.actor,place+'.actor',['system','agent','generation']);
            if (!worldName(value.actor.system)||!worldName(value.actor.agent)||!Number.isSafeInteger(value.actor.generation)||value.actor.generation<1)
              invalid(place+'.actor','invalid worker handle');
          }
        } else if (type==='access') fields(value,place,['board','job'],['at','holder','metadata','leaseTicks','expires']);
        else if (type==='reputation') fields(value,place,['ledger','subject','faction','delta']);
        else fields(value,place,['ledger','obligation','debtor','creditor','terms']);
      }
    }
    if (Object.hasOwn(table,'costs')) effects(table.costs,at+'.costs',true);
    if (Object.hasOwn(table,'outcomes')) for (const [outcome,rows] of entries(table.outcomes,at+'.outcomes',true)) {
      link(outcome,story.outcomes,at+'.outcomes.'+outcome,'outcome',report);
      effects(rows,at+'.outcomes.'+outcome,false);
    }
  }

  function lifecycle(value, at, roles, report) {
    fields(value, at, [], ['activation', 'offerFor', 'progression', 'deadlines', 'cleanup', 'feasibility', 'liveReferences', 'commitment', 'handoffs', 'settlement']);
    if (Object.hasOwn(value, 'activation') && !['automatic', 'manual'].includes(value.activation))
      invalid(`${at}.activation`, 'expected automatic or manual');
    if (Object.hasOwn(value, 'offerFor') &&
      (value.activation !== 'manual' || !Number.isFinite(value.offerFor) || value.offerFor <= 0))
      invalid(`${at}.offerFor`, 'expected a positive offer duration in seconds for manual activation');
    if (Object.hasOwn(value, 'progression') && typeof value.progression !== 'boolean')
      invalid(`${at}.progression`, 'expected a boolean');
    if (Object.hasOwn(value, 'deadlines')) {
      const location = `${at}.deadlines`;
      fields(value.deadlines, location, [], ['world', 'offer', 'work']);
      if (!Object.keys(value.deadlines).length) invalid(location, 'expected at least one clock');
      for (const [clock, spec] of Object.entries(value.deadlines)) {
        const field = clock === 'world' ? 'at' : 'for', place = `${location}.${clock}`;
        fields(spec, place, [field]);
        if (!Number.isFinite(spec[field]) || spec[field] <= 0)
          invalid(`${place}.${field}`, 'expected positive finite seconds');
        if (clock === 'offer' && (value.activation !== 'manual' || Object.hasOwn(value, 'offerFor')))
          invalid(place, 'an offer deadline requires manual activation and a single offer window');
      }
    }
    if (Object.hasOwn(value, 'feasibility')) feasibility(value.feasibility, at + '.feasibility', roles, report);
    if (Object.hasOwn(value, 'liveReferences')) liveReferences(value.liveReferences, at + '.liveReferences', roles, report);
    if (Object.hasOwn(value, 'commitment')) commitment(value.commitment,at+'.commitment',roles,report);
  }

  const terminalStates = ['completed', 'failed', 'withdrawn', 'expired'];

  function cleanup(rules, outcomes, at, report, roles) {
    const rows = entries(rules, at, true);
    if (rows.length > 32) invalid(at, 'expected up to 32 cleanup rules');
    const targets = {
      claim: ['system', 'agent', 'generation', 'sequence'],
      offer: ['system', 'offer', 'revision'],
      site: ['system', 'process']
    };
    const statuses = Object.fromEntries(terminalStates.map(status => [status, true]));
    for (const [id, rule] of rows) {
      const place = `${at}.${id}`;
      fields(rule, place, [], [...Object.keys(targets), 'keepOn', 'keepOutcomes']);
      const kinds = Object.keys(targets).filter(kind => Object.hasOwn(rule, kind));
      if (kinds.length !== 1) invalid(place, 'expected exactly one claim, offer, or site target');
      const [kind] = kinds, target = rule[kind], location = `${place}.${kind}`;
      if (!roleUses(target, roles, location, report)) {
        fields(target, location, targets[kind]);
        for (const [key, value] of Object.entries(target)) {
          if (['generation', 'sequence', 'revision'].includes(key)) {
            if (!Number.isSafeInteger(value) || value <= 0) invalid(`${location}.${key}`, 'expected a positive integer');
          } else if (!worldName(value)) invalid(`${location}.${key}`, 'expected a world ID');
        }
      }
      if (Object.hasOwn(rule, 'keepOn')) links(rule.keepOn, statuses, `${place}.keepOn`, 'terminal status', report);
      if (Object.hasOwn(rule, 'keepOutcomes')) links(rule.keepOutcomes, outcomes, `${place}.keepOutcomes`, 'outcome', report);
    }
  }

  function childList(values, table, at, report) {
    if (!Array.isArray(values) || !values.length || values.length > 64) invalid(at, 'expected 1–64 child questlet IDs');
    links(values, table, at, 'child questlet', report);
  }

  function childStages(rows, stories, owner, owners, at, report) {
    const children = Object.create(null);
    for (const [stage, definition] of rows) {
      record(definition, `${at}.stages.${stage}`);
      if (!Object.hasOwn(definition, 'children')) continue;
      const location = `${at}.stages.${stage}.children`, { children: spec } = definition;
      fields(spec, location, [], ['open', 'wait']);
      if (!Object.keys(spec).length) invalid(location, 'expected open or wait');
      if (!Object.hasOwn(spec, 'open')) continue;
      childList(spec.open, stories, `${location}.open`, report);
      for (const id of spec.open) {
        if (!safeId(id) || !Object.hasOwn(stories, id)) continue;
        const target = stories[id];
        if (target?.kind !== 'questlet' || !target.lifecycle || Object.hasOwn(target, 'triggers'))
          invalid(`${location}.open`, `child ${id} needs a questlet lifecycle and takes its start from the arc`);
        if (owners.has(id) && owners.get(id) !== owner) invalid(`${location}.open`, `child ${id} already has an owning arc`);
        owners.set(id, owner);
        children[id] = target;
      }
    }
    for (const [stage, definition] of rows) {
      if (!definition.children || !Object.hasOwn(definition.children, 'wait')) continue;
      const { wait } = definition.children, location = `${at}.stages.${stage}.children.wait`;
      fields(wait, location, [], ['any', 'all']);
      if (Object.keys(wait).length !== 1) invalid(location, 'expected exactly one of any or all');
      const [mode] = Object.keys(wait);
      childList(wait[mode], children, `${location}.${mode}`, report);
    }
    return children;
  }

  function childConditions(conditions, children, at, report) {
    const rows = entries(conditions, at, true);
    if (rows.length > 64) invalid(at, 'expected up to 64 child conditions');
    for (const [id, condition] of rows) {
      const place = `${at}.${id}`;
      const known = link(id, children, place, 'child questlet', report);
      fields(condition, place, [], ['status', 'outcome']);
      if (!Object.keys(condition).length) invalid(place, 'expected a terminal status or outcome');
      if (Object.hasOwn(condition, 'status') && !terminalStates.includes(condition.status))
        invalid(`${place}.status`, 'expected a terminal story status');
      if (Object.hasOwn(condition, 'outcome')) {
        if (known) link(condition.outcome, children[id].outcomes, `${place}.outcome`, 'child outcome', report);
        if (['withdrawn', 'expired'].includes(condition.status))
          invalid(place, 'only completed or failed questlets record named outcomes');
      }
    }
  }

  function validate(document, report) {
    fields(document, 'story', ['format', 'version', 'id', 'stories'], ['title', 'references', 'objectiveTypes']);
    if (document.format !== format) invalid('story.format', `expected ${format}`);
    if (document.version !== version) invalid('story.version', `unsupported version ${JSON.stringify(document.version)}; expected ${version}`);
    if (!safeId(document.id)) invalid('story.id', 'invalid document ID');
    if (Object.hasOwn(document, 'title')) text(document.title, 'story.title');
    const references = Object.hasOwn(document, 'references') ? document.references : {};
    const types = Object.hasOwn(document, 'objectiveTypes') ? document.objectiveTypes : {};
    objectiveTypes(types);
    const { stories } = document, owners = new Map();
    for (const [id, reference] of entries(references, 'story.references')) {
      const at = `story.references.${id}`;
      fields(reference, at, ['kind', 'id']);
      if (!safeId(reference.kind)) invalid(`${at}.kind`, 'invalid reference kind');
      if (typeof reference.id !== 'string' || reference.id.length > 512 || !reference.id.split('/').every(safeId))
        invalid(`${at}.id`, 'expected an ID or slash-separated qualified ID');
    }
    for (const [id, story] of entries(stories, 'story.stories', true)) {
      const at = `story.stories.${id}`;
      fields(story, at, ['kind', 'title', 'entry', 'stages', 'outcomes'], ['summary', 'refs', 'roles', 'triggers', 'lifecycle']);
      if (!kinds.has(story.kind)) invalid(`${at}.kind`, 'expected incident, questlet or arc');
      labelsAndRefs(story, at, references, report);
      const roles = Object.hasOwn(story, 'roles') ? story.roles : {};
      if (Object.hasOwn(story, 'lifecycle')) lifecycle(story.lifecycle, `${at}.lifecycle`, roles, report);
      const { stages, outcomes } = story;
      if (Object.hasOwn(story.lifecycle??{},'settlement'))
        settlement(story.lifecycle.settlement,at+'.lifecycle.settlement',story,roles,report);
      if (Object.hasOwn(story.lifecycle ?? {}, 'handoffs')) {
        const location = at+'.lifecycle.handoffs', rows = entries(story.lifecycle.handoffs,location,true);
        if (!story.lifecycle.commitment || rows.length>16) invalid(location,'expected an initial commitment and up to 16 handoff proposals');
        for (const [name,handoff] of rows) {
          const place = location+'.'+name;
          fields(handoff,place,['commitment'],['stage','requires']);
          commitment(handoff.commitment,place+'.commitment',roles,report);
          if (Object.hasOwn(handoff,'requires')&&!Object.hasOwn(handoff,'stage'))
            invalid(place+'.requires','requires a stage');
          if (Object.hasOwn(handoff,'stage')) {
            if (story.lifecycle.progression!==true) invalid(place+'.stage','requires stage progression');
            if (link(handoff.stage,stages,place+'.stage','stage',report)&&Object.hasOwn(handoff,'requires'))
              links(handoff.requires,stages[handoff.stage]?.objectives??{},place+'.requires','objective',report);
          }
        }
      }
      for (const [name, role] of entries(roles, `${at}.roles`)) {
        const location = `${at}.roles.${name}`;
        fields(role, location, ['kind'], ['ref', 'required']);
        if (!safeId(role.kind)) invalid(`${location}.kind`, 'invalid role kind');
        if (Object.hasOwn(role, 'required') && typeof role.required !== 'boolean')
          invalid(`${location}.required`, 'expected a boolean');
        if (Object.hasOwn(role, 'ref')) {
          if (link(role.ref, references, `${location}.ref`, 'reference', report) && references[role.ref].kind !== role.kind)
            invalid(`${location}.ref`, `reference kind must match ${JSON.stringify(role.kind)}`);
        }
      }
      if (Object.hasOwn(story, 'triggers')) triggers(story, at, roles, report);
      const stageRows = entries(stages, `${at}.stages`, true);
      const progression = story.lifecycle?.progression === true;
      const nesting = progression && story.kind === 'arc';
      const children = nesting ? childStages(stageRows, stories, id, owners, at, report) : {};
      link(story.entry, stages, `${at}.entry`, 'stage', report);
      for (const [name, outcome] of entries(outcomes, `${at}.outcomes`, true)) {
        const location = `${at}.outcomes.${name}`;
        fields(outcome, location, ['title'], ['summary', 'refs', ...(progression ? ['status'] : [])]);
        if (Object.hasOwn(outcome, 'status') && !['completed', 'failed'].includes(outcome.status))
          invalid(`${location}.status`, 'expected completed or failed');
        labelsAndRefs(outcome, location, references, report);
      }
      if (story.lifecycle && Object.hasOwn(story.lifecycle, 'cleanup'))
        cleanup(story.lifecycle.cleanup, outcomes, `${at}.lifecycle.cleanup`, report, roles);
      for (const [name, stage] of stageRows) {
        const location = `${at}.stages.${name}`;
        fields(stage, location, ['title', 'next'], ['summary', 'roles', 'refs', 'story',
          ...(progression ? ['objectives'] : []), ...(nesting ? ['children'] : [])]);
        labelsAndRefs(stage, location, references, report);
        if (Object.hasOwn(stage, 'roles')) links(stage.roles, roles, `${location}.roles`, 'role', report);
        if (Object.hasOwn(stage, 'story')) link(stage.story, stories, `${location}.story`, 'story', report);
        const objectives = Object.hasOwn(stage, 'objectives') ? stage.objectives : {};
        const objectiveRows = entries(objectives, `${location}.objectives`);
        if (objectiveRows.length > 64) invalid(`${location}.objectives`, 'a stage supports up to 64 objectives');
        for (const [name, objective] of objectiveRows) {
          const place = `${location}.objectives.${name}`;
          fields(objective, place, ['title'], ['summary', 'refs', 'optional', 'evidence', 'type', 'params']);
          labelsAndRefs(objective, place, references, report);
          if (Object.hasOwn(objective, 'optional') && typeof objective.optional !== 'boolean')
            invalid(`${place}.optional`, 'expected a boolean');
          if (Object.hasOwn(objective, 'evidence') && !roleUses(objective.evidence, roles, `${place}.evidence`, report))
            evidence(objective.evidence, `${place}.evidence`);
          if (Object.hasOwn(objective, 'type')) {
            if (Object.hasOwn(objective, 'evidence')) invalid(place, 'typed objectives define their evidence through params');
            if (Object.hasOwn(objective, 'params')) record(objective.params, `${place}.params`);
            typedParams(objective, types, place, report, roles);
          } else if (Object.hasOwn(objective, 'params')) invalid(`${place}.params`, 'requires an objective type');
        }
        for (const [choice, target] of entries(stage.next, `${location}.next`, true)) {
          const edge = `${location}.next.${choice}`;
          fields(target, edge, [], ['stage', 'outcome', ...(progression ? ['requires', 'requiresFailed', 'requiresChoice'] : []),
            ...(nesting ? ['requiresChildren', 'auto'] : [])]);
          const hasStage = Object.hasOwn(target, 'stage'), hasOutcome = Object.hasOwn(target, 'outcome');
          if (hasStage === hasOutcome) {
            const message = 'expected exactly one stage or outcome target';
            if (!report) invalid(edge, message, hasStage ? 'ambiguous-transition-target' : 'missing-transition-target');
            report({ code:hasStage?'ambiguous-transition-target':'missing-transition-target', path:edge, message, severity:'error' });
          }
          if (hasStage) link(target.stage, stages, `${edge}.stage`, 'stage', report);
          if (hasOutcome) link(target.outcome, outcomes, `${edge}.outcome`, 'outcome', report);
          if (Object.hasOwn(target, 'requires')) links(target.requires, objectives, `${edge}.requires`, 'objective', report);
          if (Object.hasOwn(target, 'requiresFailed')) {
            links(target.requiresFailed, objectives, `${edge}.requiresFailed`, 'objective', report);
            for (const id of target.requiresFailed) {
              if (!safeId(id) || !Object.hasOwn(objectives, id)) continue;
              if (!['protect', 'survive'].includes(objectives[id].type) || target.requires?.includes(id))
                invalid(`${edge}.requiresFailed`, `expected a failing objective outside requires, received ${id}`);
            }
          }
          if (Object.hasOwn(target, 'requiresChoice')) {
            for (const [id, option] of entries(target.requiresChoice, `${edge}.requiresChoice`, true)) {
              if (!link(id, objectives, `${edge}.requiresChoice.${id}`, 'objective', report)) continue;
              if (objectives[id].type !== 'choose') invalid(`${edge}.requiresChoice.${id}`, 'expected a choose objective');
              link(option, objectives[id].params.options, `${edge}.requiresChoice.${id}`, 'choice option', report);
            }
          }
          if (Object.hasOwn(target, 'requiresChildren')) childConditions(target.requiresChildren, children, `${edge}.requiresChildren`, report);
          if (Object.hasOwn(target, 'auto') && (typeof target.auto !== 'boolean' ||
            (target.auto && !stage.children?.wait && !target.requiresChildren)))
            invalid(`${edge}.auto`, 'expected a boolean and a child wait or outcome condition for an automatic branch');
        }
      }
    }
    return document;
  }

  const validateStoryDocument = document => validate(document);

  function inspectStoryDocument(document) {
    const diagnostics = [];
    try {
      validate(document, issue => diagnostics.push(issue));
      return { shapeValid:true, diagnostics };
    } catch (error) {
      if (!error.storyIssue) throw error;
      return { shapeValid:false, diagnostics:[...diagnostics,error.storyIssue] };
    }
  }

  return Object.freeze({ validateStoryDocument, inspectStoryDocument, objectiveRule, mapRoleValues, roleToken });
})();
if (typeof module !== 'undefined') module.exports = StoryDocument;
