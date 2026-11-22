/* Measure committed simulation work and replay its service times against a host cadence. */
(function(K){
  const W=K.world,{id,check,record,own}=W.data,{fields}=W.boundarySignals;
  const format='ink-studio/simulation-performance-plan',reportFormat='ink-studio/simulation-performance-report';
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const nonnegative=value=>Number.isFinite(value)&&value>=0;
  const positive=value=>nonnegative(value)&&value>0;
  const defaultNow=()=>typeof performance==='undefined'?Date.now():performance.now();
  const maxDetails=4096, maxSamples=1000000;
  const gates=['maxStepMs','maxRequestMs','maxBlockMs','maxMissedDeadlines','maxNativeMisses','maxPendingCommands',
    'maxQueuedEvents','maxQueueOverflows','maxPreparedBytes','maxTypedStateBytes','maxWorkPerBlock','maxRssBytes',
    'maxPendingStoryCandidates','maxPendingStoryRequests','maxRetainedStoryRecords','maxRetainedHistoryEvents',
    'maxStoryEvaluationMs','maxStoryDeadlineMisses','maxCandidateExpirations','maxUnrelatedCallLoss','maxUnrelatedChangedProbes'];

  function meter(detail,deadlineOverride){
    const durations=[], rows=[];
    let totalMs=0,debtMs=0,operationOverruns=0,missed=0,peakDebtMs=0,firstMiss=null;
    function add(row,periodMs){
      const {elapsedMs}=row;
      check(nonnegative(elapsedMs),'Performance clock must return finite monotonic times');
      totalMs+=elapsedMs;
      durations.push(elapsedMs);
      let details=row;
      if(periodMs!==undefined){
        const deadlineMs=deadlineOverride??periodMs, lagMs=debtMs;
        const latencyMs=lagMs+elapsedMs, latenessMs=Math.max(0,latencyMs-deadlineMs);
        if(elapsedMs>deadlineMs)operationOverruns++;
        debtMs=Math.max(0,latencyMs-periodMs);
        peakDebtMs=Math.max(peakDebtMs,debtMs);
        details={...row,periodMs,deadlineMs,lagMs,latenessMs};
        if(latenessMs>0){
          missed++;
          firstMiss??={index:durations.length-1,...details};
        }
      }
      if(detail&&rows.length<maxDetails)rows.push(details);
    }
    function summary(cadence=false){
      const sorted=durations.slice().sort((a,b)=>a-b), n=sorted.length;
      const at=q=>n?sorted[Math.ceil(n*q)-1]:null;
      return {count:n,totalMs,meanMs:n?totalMs/n:null,p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99),maxMs:at(1),
        ...(cadence&&{deadlines:{policy:deadlineOverride===undefined?'operation-period':'fixed',
          ...(deadlineOverride!==undefined&&{deadlineMs:deadlineOverride}),operationOverruns,missed,firstMiss,peakDebtMs}}),
        ...(detail&&{rows,omittedRows:n-rows.length})};
    }
    return {add,summary};
  }

  function memoryGauge(read){
    if(!read)return {sample(){},report:()=>null};
    const names=['rss','heapUsed','heapTotal','external','arrayBuffers'];
    let before=null,after=null,count=0;
    const sampledPeak={};
    function sample(){
      const measured=read();
      check(record(measured),'Invalid host memory sample');
      after={};
      for(const name of names)if(measured[name]!==undefined){
        const value=measured[name];
        check(integer(value,0,Number.MAX_SAFE_INTEGER),'Invalid host '+name+' bytes');
        after[name]=value;sampledPeak[name]=Math.max(sampledPeak[name]??0,value);
      }
      before??=after;
      count++;
    }
    return {sample,report:()=>({scope:'host-process',samples:count,before,after,sampledPeak})};
  }

  function queueGauge(){
    const queues={};
    function capture(current){
      for(const [name,{pending,capacity,unit,peak=pending,attemptedPeak=peak,overflows=0}] of Object.entries(current)){
        const old=queues[name];
        queues[name]={pending,capacity,unit,peak:Math.max(old?.peak??0,peak),attemptedPeak:Math.max(old?.attemptedPeak??0,attemptedPeak),overflows};
      }
    }
    const max=unit=>{
      const rows=Object.values(queues).filter(row=>row.unit===unit);
      return rows.length?Math.max(...rows.map(row=>row.peak)):null;
    };
    return {capture,report:()=>({queues,maxPendingCommands:max('commands'),maxQueuedEvents:max('events')})};
  }

  function processors(tree,prefix=''){
    return Object.fromEntries(Object.entries(tree).flatMap(([name,row])=>row.observed&&row.capacity&&row.memory?
      [[prefix+name,row]]:Object.entries(processors(row,prefix+name+'/'))));
  }

  function processorSummary(panels){
    const all=Object.values(panels),timed=all.map(row=>row.observed.peakMs).filter(nonnegative);
    const deadlines=all.filter(row=>row.capacity.deadlineMs!==undefined&&row.capacity.clockAvailable);
    return {preparedAllocatedBytes:all.reduce((sum,row)=>sum+row.memory.allocatedBytes,0),
      nativeMisses:deadlines.length?deadlines.reduce((sum,row)=>sum+row.observed.overruns.deadline,0):null,
      deadlineProcessors:deadlines.length,
      maxProcessorMs:timed.length?Math.max(...timed):null,
      peakWork:all.length===1?all[0].observed.peakWork:null,
      kernels:Object.fromEntries(Object.entries(panels).map(([name,row])=>[name,{
        ...row,workBound:{maxUnits:row.capacity.maxWork,baseUnitsAtEffectiveBlock:
          row.capacity.workPerBlock+row.capacity.workPerSample*row.capacity.effectiveMaxSamples}
      }]))};
  }

  function worldWork(plan,native){
    const declared=Object.fromEntries(Object.entries(plan.systems).flatMap(([name,lane])=>{
      const units=lane.resources.workPerStep;
      if(!units)return [];
      const maxScheduledVisits=Math.max(...lane.cadence.map(rate=>rate.substeps));
      const maxSegments=1+(lane.maxEventBoundaries??0);
      return [[name,{workPerStep:units,maxScheduledVisits,maxSegments,
        boundPerTick:Object.fromEntries(Object.entries(units).map(([unit,value])=>{
          const bound=value*maxScheduledVisits*maxSegments;
          return [unit,Number.isFinite(bound)?bound:null];
        }))}]];
    }));
    return {planned:plan.resources.work,declared,observedPeakPreparedUnits:native.peakWork};
  }

  function measuredWorld(source,spec,now,gauge,baselineSource){
    const storySpec=spec.stories, run=W.runtime.create(source,{profile:true,...(storySpec&&{storyClock:now})});
    const time=meter(spec.detail,spec.deadlineMs), queue=queueGauge(), initial=run.view();
    const world=initial.world, initialTick=initial.tick, period=world.dt*1000;
    const story=storySpec&&W.storyBudgets.create(storySpec,meter(spec.detail));
    const baseline=storySpec?.baseline===undefined?null:W.runtime.create(baselineSource,{profile:true});
    const comparison=baseline&&W.storyBudgets.unrelated(storySpec,run,baseline);
    const baselineTime=baseline&&meter(spec.detail,spec.deadlineMs), sampleEvery=storySpec?.sampleEvery??64;
    gauge.sample();
    queue.capture(run.queues());
    story?.observe(initial);
    comparison?.sample(initialTick);
    let fault=null, baselineFault=null, alignedTick=initialTick;
    for(let i=0;i<spec.steps;i++){
      const tick=initialTick+i+1, start=now();
      try{run.step();}catch(error){fault={tick,message:error.message};}
      const elapsedMs=now()-start;
      time.add({tick,elapsedMs,status:fault?'fault':'ok'},period);
      if(!fault){
        story?.observe(run.view(),run.storyTiming());
        if(baseline){
          const controlStart=now();
          try{baseline.step();}catch(error){baselineFault={tick,scope:'baseline',message:error.message};}
          baselineTime.add({tick,elapsedMs:now()-controlStart,status:baselineFault?'fault':'ok'},period);
          if(!baselineFault){
            alignedTick=tick;
            if(tick%sampleEvery===0||i+1===spec.steps)comparison.sample(tick);
          }
        }
      }
      queue.capture(run.queues());
      if((i+1)%64===0)gauge.sample();
      if(fault||baselineFault)break;
    }
    // The case can stop between scheduled samples. Only compare synchronized states.
    if(comparison&&run.view().tick===alignedTick)comparison.sample(alignedTick);
    const stories=story?.report();
    if(comparison)stories.unrelated=comparison.report(baselineTime.summary(true),baselineFault,!fault&&!baselineFault);
    gauge.sample();
    const plan=run.composition().execution, native=processorSummary(processors(run.processing()));
    return {clock:{dt:world.dt},steps:time.summary(true),completedSteps:run.view().tick-initialTick,initialTick,
      systems:run.profile(),queues:{scope:'committed-tick-boundaries',...queue.report(),overflows:null},
      work:worldWork(plan,native),
      memory:{...plan.resources.memory,preparedAllocatedBytes:native.preparedAllocatedBytes,host:gauge.report()},
      native,...(stories&&{stories}),fault:fault??baselineFault};
  }

  function measuredBlocks(source,spec,now,gauge){
    const host=meter(spec.detail,spec.deadlineMs), blocks=meter(spec.detail), queue=queueGauge(), events=spec.events??{};
    const {capacity=W.rates.maxEvents,drainEvery=1}=events;
    let largestBlock=0,completedBlocks=0,peakWork=null;
    const play=W.blockReview.playback(source,{path:spec.path??'live',retainEvents:true,eventCapacity:capacity,clock:now,
      onMeasure(row){
        blocks.add(row);
        if(row.status==='ok'||row.status==='deadline'){
          completedBlocks++;
          largestBlock=Math.max(largestBlock,row.samples);
        }
        if(nonnegative(row.work))peakWork=Math.max(peakWork??0,row.work);
      }});
    const dt=play.report().dt, pattern=spec.requests;
    gauge.sample();
    queue.capture(play.queues());
    let fault=null, callbacks=0, drainedEvents=0;
    while(play.cursor()<spec.samples){
      const startSample=play.cursor(), requested=Math.min(pattern[callbacks%pattern.length],spec.samples-startSample);
      const started=now();
      try{play.process(requested);}catch(error){fault={request:callbacks,startSample,atSample:play.cursor(),message:error.message};}
      const elapsedMs=now()-started;
      host.add({request:callbacks,startSample,endSample:play.cursor(),requestedSamples:requested,elapsedMs,status:fault?'fault':'ok'},
        requested*dt*1000);
      queue.capture(play.queues());
      callbacks++;
      if(!fault&&drainEvery&&callbacks%drainEvery===0)
        for(const rows of Object.values(play.drainEvents()))drainedEvents+=rows.length;
      if(callbacks%64===0)gauge.sample();
      if(fault)break;
    }
    queue.capture(play.queues());
    gauge.sample();
    const ending=play.report(), native=processorSummary(ending.processor?{kernel:ending.processor}:{});
    return {clock:{dt},path:spec.path??'live',requestedSamples:spec.samples,completedSamples:play.cursor(),
      requests:host.summary(true),blocks:{...blocks.summary(),completed:completedBlocks},
      work:{effectiveBlockSamples:ending.capacity,largestBlockSamples:largestBlock,
        observedPeakPreparedUnits:peakWork},queues:{scope:'completed-blocks',drainEvery,drainedEvents,
        ...queue.report(),overflows:ending.queueOverflows},
      memory:{...ending.memory,preparedAllocatedBytes:native.preparedAllocatedBytes,host:gauge.report()},native,fault};
  }

  function validate(plan){
    check(fields(plan,['format','version','id','cases'])&&plan.format===format&&plan.version===1&&id(plan.id)&&
      record(plan.cases)&&integer(Object.keys(plan.cases).length,1,16),'Expected a version 1 simulation performance plan');
    let total=0;
    for(const [name,row] of Object.entries(plan.cases)){
      check(id(name)&&record(row)&&['world','blocks'].includes(row.mode)&&typeof row.source==='string'&&row.source.length>0,
        'Invalid performance case '+name);
      const block=row.mode==='blocks', allowed=block?['samples','requests','path','events']:['steps','stories'];
      check(fields(row,['mode','source','deadlineMs','limits','detail',...allowed])&&
        (row.detail===undefined||typeof row.detail==='boolean')&&(row.deadlineMs===undefined||positive(row.deadlineMs))&&
        fields(row.limits??{},gates)&&Object.values(row.limits??{}).every(nonnegative),'Invalid budget or deadline on '+name);
      if(block){
        check(integer(row.samples,1,maxSamples)&&Array.isArray(row.requests)&&integer(row.requests.length,1,64)&&
          Array.from(row.requests).every(value=>integer(value,1,maxSamples))&&['live','offline'].includes(row.path??'live')&&
          fields(row.events??{},['capacity','drainEvery'])&&
          integer(row.events?.capacity??W.rates.maxEvents,1,W.rates.maxEvents)&&integer(row.events?.drainEvery??1,0,maxSamples),
        'Invalid block samples, request pattern or event consumer on '+name);
      }else{
        check(integer(row.steps,1,10000),'World performance case needs one to 10000 steps');
        if(row.stories!==undefined)W.storyBudgets.validate(row.stories);
      }
      total+=block?row.samples:row.steps*(row.stories?.baseline===undefined?1:2);
    }
    check(total<=4000000,'Performance suite exceeds its total step and sample budget');
  }

  function run(plan,{resolve,now=defaultNow,memory}={}){
    check(typeof resolve==='function'&&typeof now==='function'&&(memory===undefined||typeof memory==='function'),
      'Performance budgets need a source resolver and measurement clock');
    validate(plan);
    const cases=Object.fromEntries(Object.entries(plan.cases).map(([name,spec])=>{
      const source=resolve(spec.source,spec.mode), measure=spec.mode==='world'?measuredWorld:measuredBlocks;
      const baseline=spec.stories?.baseline===undefined?undefined:resolve(spec.stories.baseline,'world');
      const value=measure(source,spec,now,memoryGauge(memory),baseline);
      const {steps,requests,blocks,native,work,queues,memory:footprint,stories}=value;
      const metrics={maxStepMs:steps?.maxMs,maxRequestMs:requests?.maxMs,maxBlockMs:blocks?.maxMs??native.maxProcessorMs,
        maxMissedDeadlines:(steps??requests).deadlines.missed,maxNativeMisses:native.nativeMisses,
        maxPendingCommands:queues.maxPendingCommands,maxQueuedEvents:queues.maxQueuedEvents,maxQueueOverflows:queues.overflows,
        maxPreparedBytes:footprint.preparedAllocatedBytes,maxTypedStateBytes:footprint.typedStateBytes,
        maxWorkPerBlock:work.observedPeakPreparedUnits,maxRssBytes:footprint.host?.sampledPeak.rss,
        maxPendingStoryCandidates:stories?.queues.candidates.peak,maxPendingStoryRequests:stories?.queues.requests.peak,
        maxRetainedStoryRecords:stories?.retention.storyRecords.peak,maxRetainedHistoryEvents:stories?.retention.worldEvents.peak,
        maxStoryEvaluationMs:stories?.evaluation.maxMs,maxStoryDeadlineMisses:stories?.deadlines.stories.count,
        maxCandidateExpirations:stories?.deadlines.candidates.count,maxUnrelatedCallLoss:stories?.unrelated?.callLoss,
        maxUnrelatedChangedProbes:stories?.unrelated?.changedProbes};
      const limits=Object.fromEntries(Object.entries(spec.limits??{}).map(([key,max])=>{
        const actual=metrics[key]??null;
        return [key,{max,actual,available:actual!==null,passed:actual!==null&&actual<=max}];
      }));
      return [name,{mode:spec.mode,source:spec.source,passed:!value.fault&&Object.values(limits).every(row=>row.passed),limits,...value}];
    }));
    return {format:reportFormat,version:1,id:plan.id,passed:Object.values(cases).every(row=>row.passed),cases};
  }

  W.performanceBudgets=Object.freeze({format,reportFormat,run});
})(KIT);
