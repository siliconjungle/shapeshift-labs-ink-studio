/* Portable world requests and numeric modulation from the procedural score. */
(function (K) {
  const W = K.world, P = K.procedural, { check,record } = W.data;
  const metrics = ['signal','phase','level','frequency','rate'];
  const budget = 1024, perTick = 128;
  function system(config) {
    const { score } = config;
    check(record(config) && Object.keys(config).length === 1 && record(score),
      'A procedural-score system needs one score definition');
    const compiled = P.musicScore.compile(score), cache = new WeakMap();
    const outputPorts = { beat: 'number', controls: 'record', intents: 'event',
      roughness: 'number', ratioFit: 'number', fifthDistance:'number' }, controlNames = [];
    for (const [name,value] of Object.entries(compiled.sample(0).bindings)) {
      if (typeof value !== 'number') continue;
      outputPorts['control.'+name] = 'number';
      controlNames.push(name);
    }
    for (const voice of score.voices) for (const metric of metrics) outputPorts[metric+'.'+voice.id] = 'number';

    function program(requests) {
      if (!requests.length) return compiled;
      if (!cache.has(requests)) cache.set(requests,P.musicScore.compile(score,{requests}));
      return cache.get(requests);
    }
    function request(args) {
      check(record(args) && Object.keys(args).every(key => key === 'harmony' || key === 'quantize'),
        'Score changes accept a harmony and optional quantization');
      compiled.schedule({ ...args,time: 0 });
      return { harmony: args.harmony, quantize: args.quantize ?? 'bar' };
    }
    const frame = state => program(state.requests).sample(state.time);
    return {
      contract: { emits: ['music-chord'] },
      inputs: { chords: 'event' }, outputs: outputPorts,
      initial: () => ({ time: 0, started: false, queued: [], requests: [], intents: [] }),
      checkAction(type,args) { request(args); },
      actions: {
        change(state,args) {
          check(state.queued.length < perTick,'Too many score changes on a world tick');
          return { ...state, queued: [...state.queued,request(args)] };
        }
      },
      step(state,ctx) {
        const next = [...state.queued,...ctx.input.chords.map(request)];
        check(next.length <= perTick,'Too many score changes on a world tick');
        const additions = ctx.time >= compiled.duration ? [] : next.map(row => ({ ...row,time: ctx.time }))
          .filter(row => compiled.schedule(row).time < compiled.duration);
        check(state.requests.length+additions.length <= budget,'Score change request budget exceeded');
        const requests = additions.length ? [...state.requests,...additions] : state.requests;
        const score = program(requests);
        const lower = state.started ? state.time : -1;
        const intents = score.events.filter(row => row.time > lower && row.time <= ctx.time)
          .map(row => ({ kind: 'music-chord', ...row }));
        for (const { kind,...detail } of intents) ctx.emit(kind,detail);
        return { time: ctx.time, started: true, queued: [], requests, intents };
      },
      validateState(state) {
        check(record(state) && Number.isFinite(state.time) && state.time >= 0 && typeof state.started === 'boolean' &&
          Array.isArray(state.queued) && state.queued.length <= perTick &&
          Array.isArray(state.requests) && state.requests.length <= budget &&
          Array.isArray(state.intents) && state.intents.length <= budget*2,
          'Invalid saved procedural score state');
        for (const row of state.queued) request(row);
        check(state.requests.every((row,i) => record(row) && Number.isFinite(row.time) && row.time <= state.time &&
          (!i || row.time >= state.requests[i-1].time)), 'Score requests must follow the recorded world clock');
        program(state.requests);
      },
      output(state) {
        const sample = frame(state), { bindings,voices } = sample;
        const { roughness,ratioFit,fifthDistance } = sample.analysis;
        const out = { beat: sample.beat, controls: bindings, intents: state.intents, roughness,ratioFit,fifthDistance };
        for (const [key,slot] of Object.entries(voices)) for (const metric of metrics) out[metric+'.'+key] = slot[metric];
        for (const key of controlNames) out['control.'+key] = bindings[key];
        return out;
      },
      fields: {
        state: { type: 'record', read: ({state}) => W.query.ok(frame(state)) },
        schedule: { type: 'record', read: ({state}) => W.query.ok({ score, requests: state.requests }) },
        intents: { type: 'records', read: ({state}) => W.query.ok(state.intents) }
      }
    };
  }

  W.runtime.register('procedural-score',system);
})(KIT);
