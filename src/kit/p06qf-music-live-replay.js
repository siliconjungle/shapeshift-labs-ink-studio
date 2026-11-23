/* Reproduce recorded arrival times through the same renderer that drives the device. */
(function (P) {
  const A=P.musicProduction, {check,fields,record,finite,integer,id}=P.musicInstruments;
  const traceTools=P.adaptiveRehearsalTrace;
  function settings(value) {
    check(fields(value,['end','blockFrames','lookaheadFrames','events','layerGains','layerFactors']) && finite(value.end,.001,300) &&
      integer(value.blockFrames ?? 512,1,16384) &&
      (value.lookaheadFrames===undefined || integer(value.lookaheadFrames,1,96000*30)) &&
      (value.layerGains===undefined || traceTools.layerGains(value.layerGains)) &&
      (value.layerFactors===undefined || traceTools.layerFactors(value.layerFactors)) &&
      Array.isArray(value.events) && value.events.length<=8192,
    'Live replay needs a bounded end, block size, and event list');
  }
  async function replay(sources,spec,route,options={}) {
    settings(route);
    const {end,blockFrames=512,lookaheadFrames,events}=route;
    const {sampleRate=48000,startTime=0}=options, frames=Math.round(end*sampleRate);
    check(frames>=1 && frames*2<=32000000,'Live replay exceeds its PCM output budget');
    check(record(options) && (options.layerGains===undefined || record(options.layerGains)) &&
      (options.layerFactors===undefined || traceTools.layerFactors(options.layerFactors)), 'Invalid live score options');
    const score=A.live.open(sources,spec,{...options,
      ...(route.layerGains!==undefined && {layerGains:{...options.layerGains,...route.layerGains}}),
      ...(route.layerFactors!==undefined && {layerFactors:traceTools.mergeLayerFactors(options.layerFactors,route.layerFactors)})});
    const samples=new Float32Array(frames*2);
    const scheduled=events.map(event=>{
      check(fields(event,['observedAt','intent']) && finite(event.observedAt,startTime,startTime+end),
        'A live replay event needs its observed arrival time');
      return {...event,frame:Math.round((event.observedAt-startTime)*sampleRate)};
    }).sort((a,b)=>a.frame-b.frame);
    let cursor=0,event=0;
    while (cursor<frames) {
      while (event<scheduled.length && scheduled[event].frame<=cursor) {
        const row=scheduled[event++];
        score.dispatch(row.intent,{observedAt:row.observedAt});
      }
      const size=Math.min(blockFrames,frames-cursor,(scheduled[event]?.frame ?? frames)-cursor);
      if (options.streams && Object.keys(options.streams).length)
        await score.prefetch(lookaheadFrames ?? Math.max(size,(options.pageSize ?? 2048)*2));
      samples.set(score.pull(size).samples,cursor*2);
      cursor+=size;
    }
    const value={samples,sampleRate,channels:2}, report=score.inspect();
    const joins=report.joins.map(join=>({...join,audio:P.adaptiveRehearsalEvidence.audioEvidence(value,join.time)}));
    return {value,report:{...report,joins}};
  }
  function fromTrace(raw,{arrivalOffset=0,worldCues={}}={}) {
    const trace=traceTools.validate(raw);
    check(finite(arrivalOffset,0,60) && record(worldCues) &&
      Object.values(worldCues).every(id),'Invalid live rehearsal arrival offset or world cue mapping');
    const events=[...trace.intents,...trace.worldEvents.filter(row=>Object.hasOwn(worldCues,row.cue)).map(row=>({
      kind:'music-cue',time:row.time,cue:row.cue,resource:worldCues[row.cue],data:{strength:row.strength ?? 1}
    }))].map(intent=>({intent,observedAt:intent.time+arrivalOffset})).filter(row=>row.observedAt<trace.end);
    return {end:trace.end,events,...(trace.layerGains && {layerGains:trace.layerGains}),
      ...(trace.layerFactors && {layerFactors:trace.layerFactors})};
  }
  P.musicProduction=Object.freeze({...A,live:Object.freeze({...A.live,replay,fromTrace})});
})(KIT.procedural);
