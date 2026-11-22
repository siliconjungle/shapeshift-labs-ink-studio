/* Snapshot checks for offers, shared by the lifecycle and read-only previews. */
(function(K) {
  const W = K.world, {check, copy, endpoint, equal, own, read, record, selector} = W.data;
  const {freeze} = K.procedural.data;
  const field = 'world/story-feasibility';
  const outcome = (status, reason, actual) => ({status, reason, ...(actual !== undefined && {actual})});
  const missing = (sample, reason) => outcome('unavailable', reason, {detail:sample.reason ?? sample.status});
  const asReady = (ok, reason, actual) => outcome(ok ? 'ready' : 'blocked', ok ? 'ready' : reason, actual);

  function route(query, {system, ...spec}) {
    const sample = query.probe(system+'/route-feasibility',undefined,spec);
    if (sample.status !== 'ok') return missing(sample,'route-unavailable');
    const {status} = sample.value;
    return status === 'budget' ? outcome('unavailable','route-budget',sample.value) :
      asReady(status === 'ok',status,sample.value);
  }

  function worker(query, spec, site, to, batch) {
    const {system, agent, generation, task, params} = spec;
    const sample = query.probe(system+'/agent',undefined,{agent,generation});
    if (sample.status !== 'ok') return missing(sample,'worker-unavailable');
    const catalogue = query.probe(system+'/order-tasks');
    if (catalogue.status !== 'ok') return missing(catalogue,'worker-task-unavailable');
    const order = own(catalogue.value,task) && catalogue.value[task];
    const hasWork = order && order.params.every(key => own(params,key)) &&
      order.steps.some(step => step.op === 'work' && (step.batch ?? 1) === batch &&
        (typeof step.site === 'string' ? step.site : params?.[step.site.param]) === site);
    if (!hasWork) return outcome('blocked','worker-task-mismatch',{task,batch});
    const availability = W.storyCasting.availability(sample.value);
    if (availability.state !== 'free') return outcome('blocked','worker-not-free',availability);
    return route(query,{system,agent,generation,to});
  }

  const checks = {
    route: (spec,query) => route(query,spec),
    transfer(spec,query) {
      const sample = query.probe('world/transfer-feasibility',undefined,spec);
      if (sample.status !== 'ok') return missing(sample,'transfer-unavailable');
      const value = sample.value;
      return asReady(value.status === 'full','transfer-blocked',value);
    },
    work({site, workers, batch},query) {
      const [system,process] = endpoint(site);
      const sample = query.probe(system+'/work-feasibility',undefined,{process,batch});
      if (sample.status !== 'ok') return missing(sample,'worksite-unavailable');
      const value = sample.value;
      const crew = value.position ? workers.map(spec => ({
        system:spec.system, agent:spec.agent, ...worker(query,spec,site,value.position,batch??value.batch)
      })) : [];
      const readyWorkers = crew.filter(row => row.status === 'ready').length;
      const actual = {...value, readyWorkers, workers:crew};
      if (value.status !== 'ready') return outcome('blocked','worksite-blocked',actual);
      if (readyWorkers >= value.minWorkers) return outcome('ready','ready',actual);
      const possible = readyWorkers + crew.filter(row => row.status === 'unavailable').length;
      return outcome(possible >= value.minWorkers ? 'unavailable' : 'blocked','insufficient-ready-workers',actual);
    },
    state({field, at, args, select, when},query) {
      const sample = query.probe(field,at,args);
      if (sample.status !== 'ok') return missing(sample,'query-unavailable');
      const value = select === undefined ? sample.value : read(sample.value,selector(select));
      if (value === undefined) return outcome('unavailable','query-value-unavailable',{field});
      const matched = W.query.condition(when,value);
      const observed = JSON.stringify(value);
      return asReady(matched,'condition-mismatch',{field,...(observed !== undefined && observed.length<=16384 ?
        {value:copy(value)} : {valueOmitted:true})});
    }
  };

  function compiler(world, systems) {
    let registry, count = 0;
    return function compile(rules, story) {
      if (!rules) return undefined;
      const weather = world.visual?.weatherTracks || world.visual?.environmentPreset;
      registry ??= W.query.create({world,...(weather && {weatherTrackState:{}})},systems);
      const hasField = (field, at) => check(registry.field(field),'Unknown feasibility field '+field+' in '+at);
      for (const [name, rule] of Object.entries(rules)) {
        const at = story+'/'+name, [[type, spec]] = Object.entries(rule);
        check(++count<=256,'World story feasibility budget exceeds 256 checks');
        if (type === 'route') hasField(spec.system+'/route-feasibility',at);
        else if (type === 'transfer') {
          const {requester, ...transfer} = spec;
          check(requester===undefined||requester==='world'||own(systems,requester),'Unknown feasibility transfer requester in '+at);
          try { W.transfers.bind(systems).validate(transfer); }
          catch (error) { throw new Error('Feasibility transfer in '+at+': '+error.message); }
        } else if (type === 'work') {
          const [system, process] = endpoint(spec.site);
          check(own(systems[system]?.worksites?.definitions,process),'Unknown feasibility worksite '+spec.site+' in '+at);
          hasField(system+'/work-feasibility',at);
          for (const worker of spec.workers) {
            const {system, agent, generation, task, params, targets} = worker;
            hasField(system+'/route-feasibility',at);
            hasField(system+'/order-tasks',at);
            try {
              systems[system].checkAction('issue-order',{agent,...(generation!==undefined&&{generation}),
                order:{task,...(params&&{params}),...(targets&&{targets})}});
            } catch(error) { throw new Error('Feasibility worker '+system+'/'+agent+' in '+at+': '+error.message); }
          }
        } else hasField(spec.field,at);
      }
      return rules;
    };
  }

  function evaluate(rules, tick, query) {
    const results = Object.fromEntries(Object.keys(rules).sort().map(name => {
      const [[type, spec]] = Object.entries(rules[name]);
      return [name,{type,...checks[type](spec,query)}];
    }));
    return freeze({tick,ready:Object.values(results).every(row=>row.status==='ready'),checks:results});
  }

  function validReport(report, rules, since, tick) {
    return record(report) && Object.keys(report).length===3 && Number.isSafeInteger(report.tick) &&
      report.tick>=since && report.tick<=tick && record(report.checks) && equal(Object.keys(report.checks).sort(),Object.keys(rules).sort()) &&
      Object.entries(report.checks).every(([name,row])=>record(row) && row.type===Object.keys(rules[name])[0] &&
        ['ready','blocked','unavailable'].includes(row.status) && typeof row.reason==='string' &&
        Object.keys(row).every(key=>['type','status','reason','actual'].includes(key))) &&
      report.ready===Object.values(report.checks).every(row=>row.status==='ready');
  }

  function inspect(definitions, state, tick, query, {story, preview = false}) {
    check(typeof preview==='boolean','Expected a boolean feasibility preview flag');
    function row(key) {
      const {request=null,report=null} = state?.[key] ?? {};
      return {request,report,...(preview&&{preview:evaluate(definitions[key],tick,query)})};
    }
    if (story !== undefined) return own(definitions,story) ? W.query.ok(row(story)) :
      W.query.missing('unknown story with feasibility checks','missing');
    return W.query.ok(Object.fromEntries(Object.keys(definitions ?? {}).map(key=>[key,row(key)])));
  }

  W.storyFeasibility = Object.freeze({field,compiler,evaluate,validReport,inspect});
})(KIT);
