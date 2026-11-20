/* Retained discrete automata on stable, authored graph connections. */
const GraphCellular = (() => {
  const { clone, freeze, hash } = KIT.procedural.data;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const name = (value, limit = 180) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
  const weightOK = value => Number.isFinite(value) && value > 0 && value <= 1e6;
  const record = value => value != null && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const sequence = value => Array.isArray(value) || ArrayBuffer.isView(value) && Number.isSafeInteger(value.length);
  const order = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const check = (ok, message) => { if (!ok) throw new RangeError('Graph automaton: ' + message); };
  const maxNodes = 65536, maxEdges = 262144, maxWork = 32000000;
  const format = 'ink-studio/graph-automaton';
  const ruleStates = new WeakMap();

  function pulse({ threshold = 1, refractory = 4 } = {}) {
    check(weightOK(threshold) && integer(refractory, 0, 254), 'pulse needs a positive threshold and 0–254 refractory ticks');
    const states = refractory + 2;
    const update = ({ state, inputs }) => {
      if (state > 0) return (state + 1) % states;
      let weight = 0;
      for (const input of inputs) {
        if (input.state !== 1) continue;
        weight += input.edge.weight;
        if (weight >= threshold) return 1;
      }
      return 0;
    };
    ruleStates.set(update, states);
    return Object.freeze(update);
  }

  function topology(rawNodes, rawEdges, stateOK) {
    check(Array.isArray(rawNodes) && integer(rawNodes.length, 1, maxNodes) &&
      Array.isArray(rawEdges) && rawEdges.length <= maxEdges, 'expected a bounded node and edge list');
    const sorted = Array.from(rawNodes, raw => {
      const spec = typeof raw === 'string' ? { id: raw } : raw;
      const { id, type = 'cell', data = {}, state, locked = false } = spec ?? {};
      check(record(spec) && name(id) && name(type) && (state === undefined || stateOK(state)) && typeof locked === 'boolean',
        'nodes need an ID, optional type, and valid state and lock');
      return { id, state, locked, node: freeze({ id, type, data: clone(data) }) };
    }).sort(order);
    const nodes = Object.freeze(sorted.map(item => item.node));
    const indices = new Map(nodes.map(({ id }, i) => [id, i]));
    check(indices.size === nodes.length, 'node IDs must be unique');
    const edges = Array.from(rawEdges, raw => {
      const { from, to, type = 'link', id, bidirectional = false, weight = 1, delay = 1, data = {} } = raw ?? {};
      check(record(raw) && indices.has(from) && indices.has(to) && name(type) &&
        (id === undefined || name(id, 4096)) && typeof bidirectional === 'boolean' && weightOK(weight) && integer(delay, 1, 64),
      'edges need valid endpoints, positive weight and delay of 1–64 ticks');
      const ids = bidirectional && from > to ? [to, from] : [from, to];
      const key = id ?? JSON.stringify([bidirectional, ...ids, type]);
      return freeze({ id: key, from: ids[0], to: ids[1], type, bidirectional, weight, delay, data: clone(data) });
    }).sort(order);
    check(new Set(edges.map(edge => edge.id)).size === edges.length, 'edge IDs must be unique');
    const incoming = nodes.map(() => []);
    let historySize = 1, work = nodes.length;
    for (const edge of edges) {
      const from = indices.get(edge.from), to = indices.get(edge.to);
      incoming[to].push({ index: from, node: nodes[from], edge });
      work++;
      if (edge.bidirectional && from !== to) {
        incoming[from].push({ index: to, node: nodes[to], edge });
        work++;
      }
      historySize = Math.max(historySize, edge.delay);
    }
    return { sorted, nodes, indices, edges: Object.freeze(edges), incoming, work, historySize };
  }

  function create({ nodes: rawNodes, edges: rawEdges = [], states, initial = 0, rule, seed = 0 } = {}) {
    function ruleInfo(update) { return ruleStates.get(update) ?? CellularRules.info(update)?.states; }
    states ??= ruleInfo(rule) ?? 2;
    check(integer(states, 2, 256) && Number.isSafeInteger(seed) &&
      (typeof initial === 'function' || integer(initial, 0, states - 1)), 'expected 2–256 states and a valid seed and initializer');
    const stateOK = value => integer(value, 0, states - 1);
    function checkRule(update) {
      const known = CellularRules.info(update);
      check(typeof update === 'function' && !known?.line, 'graph needs a neighborhood rule');
      const expected = ruleInfo(update);
      check(expected === undefined || expected === states, 'rule alphabet must match graph states');
    }
    if (rule !== undefined) checkRule(rule);
    const { sorted, nodes, edges, incoming, indices, work, historySize } = topology(rawNodes, rawEdges, stateOK);
    const idSeeds = nodes.map(({ id }) => hash(id));
    const initialScope = hash('cellular-graph/initial', seed);
    const start = Uint8Array.from(sorted, ({ id, node, state }, i) => {
      const value = state ?? (typeof initial === 'function' ? initial({ id, node, random: KIT.grow.dice(initialScope ^ idSeeds[i]) }) : initial);
      check(stateOK(value), 'initial state is outside the alphabet');
      return value;
    });
    const pins = Uint8Array.from(sorted, item => Number(item.locked));
    const signature = hash(JSON.stringify([states, seed, nodes, edges]));
    const ring = () => { const entries = new Array(historySize); entries[0] = start; return entries; };
    let history = ring(), locked = pins, tick = 0, revision = 0, busy = false, previous;
    const available = () => check(!busy, 'cannot edit the graph during a rule');
    const lookup = id => {
      check(indices.has(id), 'unknown node ' + String(id));
      return indices.get(id);
    };
    const read = (entries, i, at) => at < 0 ? 0 : entries[at % historySize][i];
    function commit(entries, at, locks = locked) {
      history = entries; tick = at; locked = locks; revision++; previous = undefined;
    }

    function step(count = 1, update = rule) {
      available();
      checkRule(update);
      check(integer(count, 1, 10000) && count * work <= maxWork && tick + count <= Number.MAX_SAFE_INTEGER,
        'step exceeds the work or tick budget');
      const draft = history.slice();
      busy = true;
      try {
        for (let j = 1; j <= count; j++) {
          const time = tick + j, before = draft[(time - 1) % historySize], next = before.slice();
          const scope = hash('cellular-graph/rule/' + time, seed);
          for (let i = 0; i < nodes.length; i++) {
            if (locked[i]) continue;
            const node = nodes[i];
            const inputs = incoming[i].map(({ index, node, edge }) => {
              const sampledTick = time - edge.delay;
              return { id: node.id, node, edge, sampledTick, state: read(draft, index, sampledTick) };
            });
            const neighbors = inputs.map(input => input.state);
            const state = update({ id: node.id, node, state: before[i], tick: time, inputs, neighbors,
              random: KIT.grow.dice(scope ^ idSeeds[i]) });
            check(stateOK(state), 'a rule must return a valid cell state');
            next[i] = state;
          }
          draft[time % historySize] = next;
        }
      } finally { busy = false; }
      commit(draft, tick + count);
      return tick;
    }

    function edit(changes) {
      available();
      check(Array.isArray(changes) && changes.length <= maxNodes, 'expected a bounded edit list');
      const plan = Array.from(changes, item => {
        check(record(item) && Object.keys(item).every(key => ['id', 'state', 'locked'].includes(key)) &&
          (item.state !== undefined || item.locked !== undefined) && (item.state === undefined || stateOK(item.state)) &&
          (item.locked === undefined || typeof item.locked === 'boolean'), 'edits need a node ID and valid state or lock');
        return { i: lookup(item.id), state: item.state, lock: item.locked };
      });
      if (!plan.length) return;
      const next = history[tick % historySize].slice(), locks = locked.slice(), draft = history.slice();
      for (const { i, state, lock } of plan) {
        if (state !== undefined) next[i] = state;
        if (lock !== undefined) locks[i] = Number(lock);
      }
      draft[tick % historySize] = next;
      commit(draft, tick, locks);
    }

    function frame() {
      if (previous) return previous;
      const entries = history, at = tick, locks = locked;
      previous = Object.freeze({ tick: at, nodes, states, historySize,
        get(id, age = 0) {
          check(integer(age, 0, historySize - 1), 'requested age exceeds retained edge history');
          return read(entries, lookup(id), at - age);
        },
        isLocked: id => Boolean(locks[lookup(id)]), data: () => entries[at % historySize].slice()
      });
      return previous;
    }

    function checkpoint() {
      const first = Math.max(0, tick - historySize + 1);
      return { format, version: 1, signature, tick, locked: Array.from(locked),
        history: Array.from({ length: tick - first + 1 }, (_, i) => Array.from(history[(first + i) % historySize])) };
    }
    function restore(saved) {
      available();
      check(saved?.format === format && saved.version === 1 && saved.signature === signature &&
        integer(saved.tick, 0, Number.MAX_SAFE_INTEGER) && Array.isArray(saved.history) &&
        saved.history.length === Math.min(saved.tick + 1, historySize), 'checkpoint is incompatible');
      function pack(values, valid) {
        check(sequence(values) && values.length === nodes.length, 'checkpoint planes must match the graph');
        return Uint8Array.from(values, value => {
          check(valid(value), 'checkpoint contains an invalid state or lock');
          return value;
        });
      }
      const locks = pack(saved.locked, n => n === 0 || n === 1), entries = new Array(historySize);
      const first = saved.tick - saved.history.length + 1;
      for (let i = 0; i < saved.history.length; i++) entries[(first + i) % historySize] = pack(saved.history[i], stateOK);
      commit(entries, saved.tick, locks);
      return tick;
    }

    return Object.freeze({ nodes, edges, states, historySize, step, edit, frame, checkpoint, restore,
      get(id) { return read(history, lookup(id), tick); },
      get tick() { return tick; }, get revision() { return revision; },
      reset() { available(); commit(ring(), 0, pins); }
    });
  }
  return Object.freeze({ create, rules: Object.freeze({ pulse }) });
})();
