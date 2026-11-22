/* Observe story work at committed tick boundaries. */
(function(K) {
  const W = K.world, {check,record,id,equal,read,selector} = W.data;
  const maxSamples = 4096;
  const fields = (value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));

  function validate(spec) {
    check(fields(spec,['sampleEvery','baseline','systems','probes'])&&
      (spec.sampleEvery===undefined||Number.isSafeInteger(spec.sampleEvery)&&spec.sampleEvery>0)&&
      (spec.baseline===undefined||typeof spec.baseline==='string'&&spec.baseline.trim())&&
      (spec.baseline!==undefined||spec.systems===undefined&&spec.probes===undefined),
    'Invalid story budget sampling or unrelated baseline');
    if (spec.systems!==undefined) check(Array.isArray(spec.systems)&&spec.systems.every(id)&&
      new Set(spec.systems).size===spec.systems.length,'Unrelated story budget systems must be distinct IDs');
    if (spec.probes!==undefined) {
      check(record(spec.probes)&&Object.keys(spec.probes).length<=64,'Story budgets accept up to 64 unrelated probes');
      for (const [name,probe] of Object.entries(spec.probes)) {
        check(id(name)&&fields(probe,['field','at','args','select','tolerance'])&&typeof probe.field==='string'&&probe.field.length>0&&
          (probe.args===undefined||record(probe.args))&&
          (probe.tolerance===undefined||Number.isFinite(probe.tolerance)&&probe.tolerance>=0),
        'Invalid unrelated story budget probe '+name);
        if (probe.select!==undefined) selector(probe.select);
      }
    }
  }

  function peak(table,key,value,tick) {
    const old = table[key];
    table[key] = {initial:old?.initial??value,ending:value,peak:Math.max(old?.peak??value,value),
      peakAt:old&&old.peak>=value?old.peakAt:tick,netGrowth:value-(old?.initial??value)};
  }

  function clockMisses() {
    const byReason = {};
    let count = 0, first = null, last = null;
    return {add(reason,detail){
      count++;
      byReason[reason]=(byReason[reason]??0)+1;
      first??=detail;
      last=detail;
    },report:()=>({count,byReason,first,last})};
  }

  function create(spec,evaluation) {
    const queues = {}, retention = {}, phases = {}, samples = [];
    const storyDeadlines = clockMisses(), candidateDeadlines = clockMisses();
    const every = spec.sampleEvery??64;
    let latest, scheduledSamples = 0;
    function saveSample(row) {
      scheduledSamples++;
      if (samples.length<maxSamples) samples.push(row);
    }
    function observe(frame,timing) {
      const {tick,storyLifecycle,incidentCandidates,storyFeasibility,storyTriggers} = frame;
      const depth = {candidates:0,admissions:0,offers:0,commitments:0,handoffs:0,cleanup:0};
      const kept = {worldEvents:frame.history.length,transitions:0,closedVisits:0,candidateRecords:0,
        acceptedHandoffs:0,triggerWindowEvents:0};
      const dropped = {worldEvents:frame.dropped,transitions:0,closedVisits:0};
      for (const [story,row] of Object.entries(storyLifecycle??{})) {
        if (!row) {
          if (storyFeasibility?.[story]?.report.ready===false) depth.admissions++;
          continue;
        }
        const end = row.transitions.at(-1);
        if (end.to==='available') {
          if (row.commitment?.decision==='deferred') depth.commitments++;
          else depth.offers++;
        }
        if (row.handoffs?.last?.decision==='deferred') depth.handoffs++;
        for (const action of Object.values(row.cleanup?.actions??{})) if (action.status==='pending') depth.cleanup++;
        kept.transitions+=row.transitions.length;
        kept.closedVisits+=row.flow?.route.length??0;
        kept.acceptedHandoffs+=row.handoffs?.transfers.length??0;
        dropped.transitions+=row.dropped;
        dropped.closedVisits+=row.flow?.dropped??0;
        if (timing!==undefined&&end.to==='expired'&&end.tick===tick&&end.deadline)
          storyDeadlines.add(end.deadline.clock,{story,tick,reason:end.reason,deadline:end.deadline});
      }
      for (const [story,row] of Object.entries(incidentCandidates??{})) {
        kept.candidateRecords++;
        if (row.status==='blocked'||row.status==='ready') depth.candidates++;
        if (timing!==undefined&&row.status==='expired'&&row.terminal.tick===tick)
          candidateDeadlines.add(row.terminal.reason,{story,tick,reason:row.terminal.reason});
      }
      for (const row of Object.values(storyTriggers??{})) for (const window of Object.values(row.progress??{}))
        if (Array.isArray(window)) kept.triggerWindowEvents+=window.length;
      depth.requests=depth.admissions+depth.offers+depth.commitments+depth.handoffs+depth.cleanup;
      kept.storyRecords=kept.transitions+kept.closedVisits+kept.candidateRecords+kept.acceptedHandoffs+kept.triggerWindowEvents;
      for (const [name,count] of Object.entries(depth)) peak(queues,name,count,tick);
      for (const [name,count] of Object.entries(kept)) peak(retention,name,count,tick);
      let elapsedMs=0;
      if (timing!==undefined) {
        for (const [name,ms] of Object.entries(timing)) {
          const phase=phases[name]??{calls:0,totalMs:0,maxMs:0};
          phase.calls++;
          phase.totalMs+=ms;
          phase.maxMs=Math.max(phase.maxMs,ms);
          phases[name]=phase;
          elapsedMs+=ms;
        }
        evaluation.add({tick,elapsedMs});
      }
      latest = {tick,queues:depth,retained:kept,dropped,...(timing!==undefined&&{evaluationMs:elapsedMs})};
      if (tick%every===0) saveSample(latest);
    }
    function report() {
      // Keep the final committed point even after the sample buffer reaches its limit.
      const retainedSamples = samples.slice();
      if (retainedSamples.at(-1)?.tick!==latest.tick) {
        if (retainedSamples.length===maxSamples) retainedSamples.pop();
        retainedSamples.push(latest);
      }
      const sampledCount = scheduledSamples+Number(latest.tick%every!==0);
      return {scope:'committed-tick-boundaries',sampleEvery:every,queues,retention:{...retention,dropped:latest.dropped},
        evaluation:{...evaluation.summary(),phases},
        deadlines:{stories:storyDeadlines.report(),candidates:candidateDeadlines.report()},
        samples:retainedSamples,omittedSamples:sampledCount-retainedSamples.length};
    }
    return {observe,report};
  }

  function unrelated(spec,run,baseline) {
    const left = baseline.view().world, right = run.view().world, names = spec.systems??[];
    check(left.seed===right.seed&&left.dt===right.dt,'Unrelated baseline must use the same seed and timestep');
    for (const name of names)
      check(left.systems[name]&&right.systems[name]&&equal(left.systems[name],right.systems[name]),
        'Unrelated baseline system configuration differs for '+name);
    const probes = Object.entries(spec.probes??{}).map(([name,probe])=>{
      check(run.query().field(probe.field)&&baseline.query().field(probe.field),'Unknown unrelated budget field '+probe.field);
      return {name,...probe,path:probe.select===undefined?undefined:selector(probe.select),
        samples:0,availableSamples:0,changedSamples:0,firstDifference:null};
    });
    function probeValue(query,probe) {
      const sample = query.probe(probe.field,probe.at,probe.args);
      if (sample.status!=='ok'||probe.path===undefined) return sample;
      const value = read(sample.value,probe.path);
      return value===undefined?{status:'missing',reason:'Selected probe value is unavailable'}:{status:'ok',value};
    }
    let lastTick;
    function sample(tick) {
      if (!probes.length||lastTick===tick) return;
      lastTick=tick;
      const primaryQuery = run.query(), baselineQuery = baseline.query();
      for (const probe of probes) {
        const primary = probeValue(primaryQuery,probe), control = probeValue(baselineQuery,probe);
        const diff = primary.status==='ok'&&control.status==='ok'&&Number.isFinite(primary.value)&&Number.isFinite(control.value)
          ? primary.value-control.value : null;
        const result = {tick,primary,baseline:control,...(Number.isFinite(diff)&&{delta:diff})};
        const changed = diff!==null?Math.abs(diff)>(probe.tolerance??0):!equal(primary,control);
        probe.initial??=result;
        probe.ending=result;
        probe.samples++;
        if (primary.status==='ok'||control.status==='ok') probe.availableSamples++;
        if (changed) {
          probe.changedSamples++;
          probe.firstDifference??=result;
        }
      }
    }
    function report(timing,fault,complete) {
      const from = baseline.profile(), to = run.profile();
      const systems = Object.fromEntries(names.map(name=>{
        const zero={calls:0,ms:0,maxMs:0}, control=from[name]??zero, primary=to[name]??zero;
        return [name,{primary,baseline:control,callDelta:primary.calls-control.calls,
          callLoss:Math.max(0,control.calls-primary.calls),totalMsDelta:primary.ms-control.ms}];
      }));
      return {status:complete?'compared':'incomplete',baseline:{source:spec.baseline,world:left.id,seed:left.seed,
        completedSteps:baseline.view().tick,steps:timing,fault},
      systems,probes:Object.fromEntries(probes.map(({name,path,...body})=>[name,body])),
      ...(complete&&names.length&&{callLoss:Object.values(systems).reduce((total,row)=>total+row.callLoss,0)}),
      ...(complete&&probes.length&&probes.every(probe=>probe.availableSamples>0)&&{
        changedProbes:probes.filter(probe=>probe.changedSamples>0).length})};
    }
    return {sample,report};
  }

  W.storyBudgets = Object.freeze({validate,create,unrelated});
})(KIT);
