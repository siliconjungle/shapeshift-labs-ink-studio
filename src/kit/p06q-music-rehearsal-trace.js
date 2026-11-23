/* Capture exact adaptive intents and pending choices from a world replay. */
(function (K) {
  const P=K.procedural, {fields,finite,integer,id,check,record}=P.musicInstruments;
  const format='ink-studio/adaptive-score-trace';
  const text=value=>typeof value==='string' && value.length>0 && value.length<=256;
  const round=value=>Number(value.toFixed(9));
  const limit=4096, tolerance=1e-8;
  const byTime=(a,b)=>a.time-b.time || (a.serial ?? 0)-(b.serial ?? 0);
  const frozen=value=>P.data.freeze(P.data.clone(value));
  const layerGains=value=>record(value) && Object.keys(value).length<=64 &&
    Object.entries(value).every(([part,gain])=>id(part) && finite(gain,0,1));
  function layerFactors(value) {
    if (!record(value) || Object.keys(value).length>64) return false;
    let count=0;
    for (const [part,group] of Object.entries(value)) {
      if (!id(part) || !record(group) || !integer(Object.keys(group).length,1,8)) return false;
      for (const [factor,gain] of Object.entries(group)) {
        if (++count>64 || !K.world.data.id(factor) || !finite(gain,0,1)) return false;
      }
    }
    return true;
  }
  const mergeLayerFactors=(first={},second={})=>Object.fromEntries(
    [...new Set([...Object.keys(first),...Object.keys(second)])].map(part=>[part,{
      ...(Object.hasOwn(first,part) && first[part]),...(Object.hasOwn(second,part) && second[part])
    }]));

  function validate(raw) {
    check(fields(raw,['format','version','id','label','entry','end','intents','worldEvents','requests','origin','layerGains','layerFactors']) &&
      raw.format===format && raw.version===1 && id(raw.id) && id(raw.entry) && finite(raw.end,.001,300) &&
      (raw.layerGains===undefined || layerGains(raw.layerGains)) &&
      (raw.layerFactors===undefined || layerFactors(raw.layerFactors)) &&
      (raw.label===undefined || text(raw.label)) && Array.isArray(raw.intents) && raw.intents.length<=2048 &&
      Array.from(raw.intents).every(row=>record(row) && finite(row.time,0,raw.end) && row.time<raw.end &&
        (row.serial===undefined || integer(row.serial,0,Number.MAX_SAFE_INTEGER)) &&
        (row.kind==='music-transition' ? id(row.from) && id(row.to) :
          row.kind==='music-cue' ? text(row.cue ?? row.resource) : K.music.layerIntent(row))),
    'Invalid adaptive score trace or recorded music intents');
    const worldEvents=raw.worldEvents ?? [], requests=raw.requests ?? [];
    check(Array.isArray(worldEvents) && worldEvents.length<=limit && Array.from(worldEvents).every(row=>
      fields(row,['cue','time','strength','duration']) && text(row.cue) && finite(row.time,0,raw.end) && row.time<raw.end &&
      finite(row.strength ?? 1,0,1) && (row.duration===undefined || finite(row.duration,0,300))) &&
      Array.isArray(requests) && requests.length<=limit && Array.from(requests).every(row=>
      fields(row,['id','time','due','from','to','rule','outcome','resolvedAt','serial']) && id(row.id) && id(row.from) &&
      id(row.to) && id(row.rule) && finite(row.time,0,raw.end) && finite(row.due,row.time,1e7) &&
      ['committed','cancelled','pending'].includes(row.outcome) &&
      (row.outcome==='pending' ? row.resolvedAt===undefined :
        finite(row.resolvedAt,row.time,raw.end+tolerance)) &&
      (row.serial===undefined || integer(row.serial,0,Number.MAX_SAFE_INTEGER))) &&
      new Set(requests.map(row=>row.id)).size===requests.length,'Invalid recorded world cues or pending transition history');
    return {...raw,intents:raw.intents.slice().sort(byTime),worldEvents:worldEvents.slice().sort(byTime),
      requests:requests.slice().sort(byTime)};
  }

  function collector({section:entry,layerGains,layerFactors},end) {
    const intents=[], worldEvents=[], requests=[];
    let pending;
    function observe(time,view,events,hits=[]) {
      if (time>end+tolerance) return;
      for (const event of events) if (event.time<end) intents.push(event);
      for (const hit of hits) if (hit.time<end) worldEvents.push(hit);
      const next=view.pendingTransition, rule=next?.rule;
      if (pending && (!next || rule!==pending.rule || Math.abs(pending.beat-next.beat)>tolerance)) {
        const commit=events.find(event=>event.kind==='music-transition' && event.rule===pending.rule);
        const {beat,...request}=pending;
        requests.push({...request,outcome:commit && commit.time<end ? 'committed' : time<end ? 'cancelled' : 'pending',
          ...(commit && commit.time<end ? {resolvedAt:Math.max(request.time,round(commit.time)),serial:commit.serial} :
            time<end ? {resolvedAt:Math.max(request.time,round(time))} : {})});
        pending=null;
      }
      if (!pending && next && time<end) {
        const choice=view.transitions.find(row=>row.rule===rule);
        pending={id:'request-'+(requests.length+1),time:round(time),due:Math.max(round(time),round(next.estimatedTime)),
          beat:next.beat,from:view.section,to:choice.to,rule};
      }
      check(intents.length<=2048 && worldEvents.length<=limit && requests.length<limit,'Adaptive trace exceeds its event budget');
    }
    function finish(options,origin) {
      if (pending) {
        const {beat,...request}=pending;
        requests.push({...request,outcome:'pending'});
      }
      return frozen(validate({format,version:1,id:options.id,...(options.label && {label:options.label}),entry,end,
        intents,worldEvents,requests,origin,...(layerGains && {layerGains}),...(layerFactors && {layerFactors})}));
    }
    return {observe,finish};
  }

  function captureWorld(log,options) {
    const W=K.world;
    check(fields(options,['id','system','end','label']) && id(options.id) && id(options.system ?? 'score') &&
      (options.label===undefined || text(options.label)) && log?.format===W.runtime.runFormat &&
      log.origin?.tick===0 && integer(log.end?.tick,1,24000),'Use a tick-zero world recording of up to 24000 ticks');
    const run=W.runtime.openRecording(log), {world}=run.view(), system=options.system ?? 'score';
    check(world.systems[system]?.kind==='adaptive-music','World trace needs an adaptive-music system');
    const view=query=>{
      const result=query.probe(system+'/state');
      check(result.status==='ok','Adaptive score state is unavailable');
      return result.value;
    };
    const end=options.end ?? round(log.end.tick*world.dt);
    check(finite(end,.001,Math.min(300,round(log.end.tick*world.dt))),'Trace end lies outside the recorded world');
    const saved=collector(view(run.query()),end);
    const timeOf=(event,time)=>W.timedEvents.timeOf(event) ?? event.time ?? time;
    run.advance(log.end.tick,{onTick(frame,query) {
      if (frame.time>end+tolerance) return;
      const events=run.events.filter(row=>row.system===system && ['music-transition','music-cue','music-layer'].includes(row.kind))
        .map(row=>({...row,time:timeOf(row,frame.time)}));
      const hits=run.events.filter(row=>row.kind==='audio-cue' && text(row.cue))
        .map(row=>({cue:row.cue,time:timeOf(row,frame.time),
          ...(row.strength!==undefined && {strength:row.strength}),...(row.duration!==undefined && {duration:row.duration})}));
      saved.observe(frame.time,view(query),events,hits);
    }});
    check(W.runtime.checkpointsEqual(run.checkpoint(),log.end),'World recording diverges at the final checkpoint');
    return saved.finish(options,{kind:'world-recording',scene:world.id,seed:world.seed,
      system,dt:world.dt,ticks:log.end.tick});
  }

  function captureScore(score,updates,options) {
    check(fields(options,['id','end','label','worldEvents']) && id(options.id) && finite(options.end,.001,300) &&
      (options.label===undefined || text(options.label)) && Array.isArray(updates) && updates.length<=4096 &&
      Array.from(updates).every(row=>fields(row,['time','emotions','parameters','cues']) && finite(row.time,0,options.end)),
    'Use bounded adaptive clock updates and a trace end');
    const machine=K.music.create(score);
    let state=machine.initial();
    const saved=collector(machine.inspect(state),options.end);
    for (const update of [...updates,{time:options.end}]) {
      const result=machine.advance(state,update);
      state=result.state;
      saved.observe(update.time,machine.inspect(state),result.intents);
    }
    const trace=saved.finish(options,{kind:'clock-updates'});
    return frozen(validate({...trace,worldEvents:options.worldEvents ?? []}));
  }
  P.adaptiveRehearsalTrace=Object.freeze({format,validate,captureWorld,captureScore,layerGains,layerFactors,mergeLayerFactors});
})(KIT);
