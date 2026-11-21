/* Headless typed graphs with exposed inputs, reusable groups and inspectable cached outputs. */
(function (K) {
  const P = K.procedural;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const id = value => typeof value === 'string' && /^[a-zA-Z][\w.-]{0,99}$/.test(value) &&
    !['constructor', 'prototype', '__proto__'].includes(value);
  const {validator, compatible, description, conversion} = P.graphTypes;
  function schema(value) {
    if (!record(value)) throw new TypeError('Expected named graph sockets');
    return Object.fromEntries(Object.entries(value).map(([name, spec]) => {
      const config = typeof spec === 'string' ? { type: spec } : spec;
      const valid = validator(config?.type);
      if (!id(name) || !valid)
        throw new RangeError('Unknown graph socket ' + name);
      if (Object.hasOwn(config, 'default') && !valid(config.default))
        throw new TypeError('Wrong default type for graph socket ' + name);
      return [name, { ...config }];
    }));
  }

  function operationSchema(operation) {
    return { inputs: schema(operation.inputs || {}), outputs: schema(operation.outputs || { value: 'any' }) };
  }

  function create(source, { operations = {}, groups = {}, planOnly = false } = {}) {
    const stored = P.data.freeze(P.data.clone(source));
    const specInputs = schema(stored.inputs || {});
    if (!record(stored.nodes) || !record(stored.outputs) || Object.keys(stored.nodes).length > 2000)
      throw new RangeError('A graph needs named nodes and outputs within its node budget');
    const specs = stored.nodes, configs = new Map(), stack = new Set(), order = [];
    const marks = new Map();
    let awaiting = false;
    let placement, schedule;

    function binding(value) {
      function literal(value) {
        const type = ['number','boolean','string'].find(name => validator(name)(value)) ?? 'any';
        return { kind: 'value', value, type };
      }
      if (!record(value)) return literal(value);
      if (Object.hasOwn(value, 'value')) return literal(value.value);
      if (Object.hasOwn(value, 'input')) {
        if (!Object.hasOwn(specInputs, value.input)) throw new RangeError('Unknown graph input ' + value.input);
        return { kind: 'input', id: value.input, type: specInputs[value.input].type };
      }
      if (Object.hasOwn(value, 'node')) {
        visit(value.node);
        const config = configs.get(value.node), port = value.port || 'value';
        if (!Object.hasOwn(config.outputs, port)) throw new RangeError('Unknown graph output ' + value.node + '.' + port);
        return { kind: 'node', id: value.node, port, type: config.outputs[port].type };
      }
      if (Object.hasOwn(value, 'keys')) {
        const mode = value.mode || 'number';
        const track = K.anim.keyframeTrack.create({ value: mode }, value.keys.map(key => ({ ...key, value: { value: key.value } })));
        if (!track.keys.length) throw new RangeError('Animated graph parameters need at least one key');
        const v = track.keys[0].value.value;
        const type = ['number','vec2','vec3'].find(name => validator(name)(v)) ?? 'any';
        return { kind: 'track', track, type, mode };
      }
      return literal(value);
    }

    function visit(name) {
      if (configs.has(name)) return;
      if (stack.has(name)) throw new Error('Graph dependency cycle at ' + name);
      if (!id(name) || !Object.hasOwn(specs, name)) throw new RangeError('Unknown graph node ' + name);
      const spec = specs[name];
      if (!record(spec) || !id(spec.op)) throw new TypeError('Invalid graph node ' + name);
      const template = Object.hasOwn(operations, spec.op) ? operations[spec.op] :
        Object.hasOwn(groups, spec.op) ? groups[spec.op] : Object.hasOwn(P.graph.operations || {}, spec.op) ? P.graph.operations[spec.op] : null;
      const operation = template?.specialize ? template.specialize(spec,groups) : template;
      if (typeof operation?.run !== 'function' && typeof operation?.instantiate !== 'function')
        throw new TypeError('Unknown graph operation ' + spec.op);
      stack.add(name);
      const { inputs: sockets, outputs } = operationSchema(operation);
      const given = { ...spec.params, ...spec.inputs };
      for (const key of Object.keys(given)) if (!Object.hasOwn(sockets, key)) throw new RangeError('Unknown socket ' + name + '.' + key);
      const bindings = Object.entries(sockets).map(([key, socket]) => {
        if (!Object.hasOwn(given, key) && !Object.hasOwn(socket, 'default'))
          throw new RangeError('Missing graph socket ' + name + '.' + key);
        const link = binding(Object.hasOwn(given, key) ? given[key] : { value: socket.default });
        if (link.kind !== 'value' && (link.kind !== 'track' || planOnly) && !compatible(link.type,socket.type)) {
          const source = link.kind === 'node' ? link.id + '.' + link.port : link.kind === 'input' ? 'input ' + link.id : 'keyframes';
          const convert = conversion(link.type, socket.type);
          throw new TypeError('Incompatible graph socket ' + name + '.' + key + ': ' + source + ' provides ' +
            description(link.type) + ', expected ' + description(socket.type) + (convert ? '. Use ' + convert + '.' : '.'));
        }
        const valid=validator(socket.type);
        if (link.kind === 'value' && !valid(link.value))
          throw new TypeError('Wrong value for graph socket ' + name + '.' + key + ': expected ' + description(socket.type));
        return [key, socket, link, valid];
      });
      stack.delete(name);
      const run = planOnly ? undefined : operation.instantiate ? operation.instantiate() : operation.run;
      configs.set(name, { name, op: spec.op, group:spec.group, type:spec.type, run, outputs, bindings,
        clock: !!operation.time, seed: operation.seed, asset: operation.asset,
        stock: template === P.graph.operations?.[spec.op] && !operation.instantiate,
        local: operation.workerLocal === true && !operation.instantiate,
        nested: Object.hasOwn(groups, spec.op) && groups[spec.op] === template || operation.workerGroup === true });
      order.push(name);
    }
    for (const name of Object.keys(specs)) visit(name);
    const results = Object.entries(stored.outputs).map(([name, link]) => {
      if (!id(name)) throw new RangeError('Invalid graph output name ' + name);
      return [name, binding(link)];
    });

    const resolve = (link, values, time, pending) => {
      if (link.kind === 'value') return link.value;
      if (link.kind === 'input') return values[link.id];
      if (link.kind === 'track') return link.track.sample(time).value;
      return pending.get(link.id).outputs[link.port];
    };

    function parameters(input = {}) {
      if (!record(input)) throw new TypeError('Graph inputs must be named values');
      return Object.fromEntries(Object.entries(specInputs).map(([name, socket]) => {
        const value = Object.hasOwn(input, name) ? input[name] : socket.default;
        if (!validator(socket.type)(value))
          throw new TypeError('Wrong input value for graph socket ' + name + ': expected ' + description(socket.type));
        return [name, value];
      }));
    }

    function layout(workers) {
      if (placement === workers) return schedule;
      placement = workers;
      schedule = [];
      let block, depth;
      for (const name of order) {
        const config = configs.get(name);
        if (!workers.permits(config)) {
          schedule.push(name);
          block = undefined;
          continue;
        }
        if (!block) {
          block = { nodes: [], waves: [] };
          depth = new Map();
          schedule.push(block);
        }
        let level = 0;
        for (const [, , link] of config.bindings) if (link.kind === 'node' && depth.has(link.id))
          level = Math.max(level, depth.get(link.id) + 1);
        depth.set(name, level);
        block.nodes.push(name);
        (block.waves[level] ??= []).push(name);
      }
      return schedule;
    }

    function begin(input, { take, sequence, time = take?.start ?? 0, seed = 0, workers }) {
      if (take !== undefined) {
        P.takeTime.requireFrame(take);
        if (time !== take.start) throw new RangeError('Graph seconds must match the take frame start');
      }
      if (planOnly) throw new Error('A graph plan cannot be evaluated');
      if (!Number.isFinite(time) || !Number.isSafeInteger(seed)) throw new TypeError('Invalid graph run options');
      const values = parameters(input);
      const pending = new Map();
      function prepare(name) {
        const config = configs.get(name), { bindings, clock } = config;
        const entries = bindings.map(([key, socket, link, valid]) => {
          const value = resolve(link, values, time, pending);
          if (!valid(value))
            throw new TypeError('Wrong linked value for graph socket ' + name + '.' + key + ': expected ' + description(socket.type));
          return [key, value];
        });
        const previous = marks.get(name), comparable = entries.map(([, value]) => value);
        const reused = previous?.seed === seed && (!clock || previous.time === time && previous.take === take && previous.sequence === sequence) &&
          comparable.every((value, i) => {
            const prior = previous.values[i];
            return Object.is(value, prior) || bindings[i][2].kind === 'track' && Array.isArray(value) &&
              Array.isArray(prior) && value.length === prior.length && value.every((n, k) => Object.is(n, prior[k]));
          });
        const context = reused ? undefined : { time, ...(take !== undefined && { take }),
          ...(sequence !== undefined && { sequence }), seed: P.data.hash(name, seed), node: name };
        return { config, inputs: reused ? undefined : Object.fromEntries(entries), context, comparable, reused, previous };
      }
      function invoke(row, asynchronous = false) {
        const { config: { run, nested }, inputs, context } = row;
        if (asynchronous && run.async) return run.async(inputs, context);
        return nested && workers ? run(inputs, context, workers) : run(inputs, context);
      }
      function complete(row, ...answers) {
        const { config: { name, run, outputs }, comparable, reused, previous } = row;
        if (reused) pending.set(name, previous);
        else {
          const produced = answers.length ? answers[0] : invoke(row);
          if (produced?.then) {
            void Promise.resolve(produced).catch(() => {});
            throw new TypeError('Graph node ' + name + ' needs asynchronous evaluation');
          }
          if (!record(produced)) throw new TypeError('Graph node must return named outputs: ' + name);
          for (const [key, socket] of Object.entries(outputs))
            if (!Object.hasOwn(produced, key) || !validator(socket.type)(produced[key]))
              throw new TypeError('Wrong output from graph node ' + name + '.' + key);
          pending.set(name, { seed, time, take, sequence, values: comparable, outputs: produced, subgraph: run.inspect?.() });
        }
      }
      function finish() {
        const status = Object.fromEntries(order.map(name => [name, pending.get(name) === marks.get(name) ? 'cached' : 'evaluated']));
        const outputs = Object.fromEntries(results.map(([key, link]) => [key, resolve(link, values, time, pending)]));
        const snapshot = new Map(pending);
        for (const [name, item] of snapshot) marks.set(name, item);
        return { outputs, status, preview(node, port = 'value') {
          const [name, ...nested] = node.split('/');
          const result = snapshot.get(name);
          if (nested.length && result?.subgraph) return result.subgraph.preview(nested.join('/'), port);
          if (!result || !Object.hasOwn(result.outputs, port))
            throw new RangeError('Unknown graph preview output ' + node + '.' + port);
          return result.outputs[port];
        }, inspectGroup(name) { return snapshot.get(name)?.subgraph || null; } };
      }

      return { prepare, invoke, complete, finish, forget: name => pending.delete(name) };
    }

    function evaluate(input = {}, options = {}) {
      if (awaiting) throw new Error('An asynchronous graph evaluation is already running');
      const { workers } = options, { prepare, complete, finish, forget } = begin(input, options);
      if (!workers || !workers.enabled) for (const name of order) complete(prepare(name));
      else for (const item of layout(workers)) {
        if (typeof item === 'string') complete(prepare(item));
        else try {
          for (const wave of item.waves) {
            if (wave.length < 2) complete(prepare(wave[0]));
            else workers.runWave(wave.map(prepare), complete);
          }
        } catch {
          // Pure nodes can be replayed in serial order to surface the original graph error.
          workers.cancel();
          for (const name of item.nodes) forget(name);
          for (const name of item.nodes) complete(prepare(name));
        }
      }
      return finish();
    }

    async function evaluateAsync(input = {}, { profile = false, ...options } = {}) {
      if (awaiting) throw new Error('An asynchronous graph evaluation is already running');
      if (options.workers?.enabled) throw new TypeError('Asynchronous graph evaluation uses a serial schedule');
      awaiting = true;
      try {
        const { prepare, invoke, complete, finish } = begin(input, options);
        const timings = {};
        for (const name of order) {
          const start = profile ? performance.now() : 0;
          const row = prepare(name);
          if (row.reused) complete(row);
          else {
            const answer = invoke(row, true);
            complete(row, answer?.then ? await answer : answer);
          }
          if (profile) timings[name] = performance.now() - start;
        }
        return { ...finish(), ...(profile && { timings }) };
      } finally {
        awaiting = false;
      }
    }

    function plan({ bindings: detailed = false } = {}) {
      function describe(link) {
        const { kind, id, port, type } = link;
        if (kind === 'track') return { kind, type, mode:link.mode, keyCount:link.track.keys.length,
          ...(detailed && { keys:link.track.keys }) };
        if (kind === 'value') return { kind, type, ...(detailed && { value:link.value }) };
        return { kind, type, id, ...(port !== undefined && {port}) };
      }
      return P.data.clone({
        inputs: specInputs,
        nodes: order.map(name => {
          const {op,group,type,outputs,bindings,clock,seed,asset} = configs.get(name);
          return {id:name,op,...(group!==undefined && {group}),...(type!==undefined && {type}),time:clock,outputs,
            ...(detailed && seed !== undefined && {seed}), ...(detailed && asset !== undefined && {asset}),
            inputs:Object.fromEntries(bindings.map(([key,socket,link]) => [key,{type:socket.type,source:describe(link)}]))};
        }),
        outputs: Object.fromEntries(results.map(([name,link]) => [name,describe(link)]))
      });
    }

    function sockets(node) {
      const config = configs.get(node);
      if (!config) throw new RangeError('Unknown graph node ' + node);
      return P.data.clone({ inputs: Object.fromEntries(config.bindings.map(([key, socket]) => [key, socket])),
        outputs: config.outputs, time: config.clock });
    }

    return Object.freeze({ spec: stored, evaluate, evaluateAsync, parameters, plan, sockets, clear() {
      if (awaiting) throw new Error('Cannot clear a graph during asynchronous evaluation');
      marks.clear();
      for (const config of configs.values()) config.run?.clear?.();
    } });
  }

  function group(spec, { operations, groups, outputs } = {}) {
    const inputTypes = schema(spec.inputs || {});
    const outputTypes = schema(outputs || Object.fromEntries(Object.keys(spec.outputs || {}).map(name => [name, 'any'])));
    return { inputs: inputTypes, outputs: outputTypes, expandedNodes:Object.keys(spec.nodes ?? {}).length, time: true, instantiate() {
      const graph = create(spec, { operations, groups });
      let latest;
      const run = (inputs, context, workers) => {
        latest = graph.evaluate(inputs, workers ? { ...context, workers } : context);
        return latest.outputs;
      };
      run.async = async (inputs, context) => {
        latest = await graph.evaluateAsync(inputs, context);
        return latest.outputs;
      };
      run.inspect = () => latest;
      run.clear = () => graph.clear();
      return run;
    } };
  }

  function repeat(value, times, apply, { seed = 0, limit = 4096 } = {}) {
    if (!Number.isSafeInteger(times) || times < 0 || times > limit || limit > 100000 ||
        typeof apply !== 'function' || !Number.isSafeInteger(seed)) throw new RangeError('Invalid repeat zone');
    for (let index = 0; index < times; index++) value = apply(value, { index, seed: P.data.hash(String(index), seed) });
    return value;
  }

  function each(elements, apply, { seed = 0, limit = 100000 } = {}) {
    if (!Array.isArray(elements) || elements.length > limit || limit > 250000 ||
        typeof apply !== 'function' || !Number.isSafeInteger(seed)) throw new RangeError('Invalid per-element zone');
    const seen = new Set();
    return elements.map((value, index) => {
      const id = value?.id ?? index;
      if ((typeof id !== 'string' && !Number.isSafeInteger(id)) || seen.has(id))
        throw new RangeError('Per-element items need unique string or integer IDs');
      seen.add(id);
      return apply(value, { id, index, seed: P.data.hash(typeof id + '/' + id, seed) });
    });
  }

  function simulation({ initial, step, dt = 1 / 60, checkpoint = 15, cache = 32, maxSteps = 10000,
    clone = P.data.clone, seed = 0 } = {}) {
    if (typeof step !== 'function' || typeof clone !== 'function' || !Number.isFinite(dt) || dt <= 0 ||
        ![checkpoint, cache, maxSteps].every(n => Number.isSafeInteger(n) && n > 0 && n <= 100000) ||
        !Number.isSafeInteger(seed)) throw new RangeError('Invalid simulation zone');
    let revision, root, frames = new Map();
    function sample(time, { inputs, version = 0 } = {}) {
      const frame = Math.floor(time / dt + 1e-8);
      if (!Number.isFinite(time) || frame < 0 || frame > maxSteps) throw new RangeError('Simulation time exceeds its step budget');
      if (!Object.is(revision, version) || root === undefined) {
        root = clone(typeof initial === 'function' ? initial(inputs, seed) : initial);
        revision = version;
        frames = new Map([[0, root]]);
      }
      let start = 0;
      for (const key of frames.keys()) if (key <= frame && key > start) start = key;
      let result = clone(frames.get(start) ?? root);
      for (let i = start + 1; i <= frame; i++) {
        result = step(result, { index: i, time: i * dt, dt, inputs, seed: P.data.hash(String(i), seed) });
        if (i % checkpoint === 0 || i === frame) {
          frames.set(i, clone(result));
          if (frames.size > cache + 1) frames.delete([...frames.keys()].find(key => key !== 0));
        }
      }
      return { frame, time: frame * dt, state: result, steps: frame - start, checkpoints: [...frames.keys()].sort((a, b) => a - b) };
    }
    return { sample, clear() { root = undefined; frames.clear(); } };
  }

  P.graph = { create, group, repeat, each, simulation, operationSchema };
})(KIT);
