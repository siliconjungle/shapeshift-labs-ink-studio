/* Give a causal replay and an offline timeline the same recorded inputs. */
(function (K) {
  const P=K.procedural, A=P.musicProduction, R=A.rehearsal, L=P.musicTimeline;
  const {check,fields,finite,integer}=P.musicInstruments;
  const sample=P.adaptiveRehearsalEvidence.sample;
  const order=(a,b)=>a.intent.time-b.intent.time || (a.intent.serial ?? 0)-(b.intent.serial ?? 0);
  const span=(row)=>({from:row.from,target:row.target,startSample:row.startFrame,endSample:row.endFrame});
  const difference=(live,offline)=>live===null || offline===null ? null : live-offline;
  const status=(a,b)=>a===b ? 'same' : 'different';
  const rounded=value=>Number(value.toFixed(9));

  function capture() {
    const evidence=new Map(), layerOrder=[];
    function observe(kind,index,frame,detail) {
      if (!evidence.has(index)) evidence.set(index,{});
      const row=evidence.get(index);
      if (kind==='cue-voice') {
        const voices=row.voices ??= new Map();
        const {resource,segment,source,asset}=detail;
        const key=JSON.stringify([resource,segment,source]);
        if (!voices.has(key)) voices.set(key,{resource,segment,source,first:frame,assets:new Set()});
        if (asset) voices.get(key).assets.add(asset);
      } else if (kind==='score-accent') {
        row.accent={status:detail.status,resource:detail.resource,sample:frame,opening:detail.opening ?? null};
      } else if (kind==='transition') {
        const {from,to,entry,exit,carry,switchPoint,expectedFrame,lastVoiceFrame}=detail;
        row.transition={status:'landed',sample:frame,from,to,source:entry.source,phrase:entry.phrase ?? null,
          exitPosition:exit.played,entryPosition:entry.offset,expectedSample:expectedFrame,switchPoint:switchPoint?.id ?? null,
          tail:{authoredSeconds:exit.tail,directReleaseEndSample:lastVoiceFrame,held:carry.held,
            echoes:carry.echoes,roomLastInputSample:carry.roomLastInputFrame}};
      } else if (kind.startsWith('transition-')) {
        row.transition={status:kind==='transition-planned' ? 'pending' : kind.slice('transition-'.length),sample:null,
          ...(detail.reason && {reason:detail.reason}),...(detail.exitFrame!==undefined && {expectedSample:detail.exitFrame})};
      } else if (kind==='layer-gain' || kind==='layer-ignored') {
        if (kind==='layer-gain') layerOrder.push(index);
        row.layer=kind==='layer-gain' ? {status:'applied',...span(detail)} : {status:'ignored',reason:detail.reason};
      } else if (kind==='cue-decision') {
        row.cue=detail.status;
      } else if (kind==='cue-missed') {
        (row.missed ??= new Set()).add(detail.reason);
      }
    }
    return {observe,evidence,layerOrder};
  }

  function liveCue(row,absent) {
    const variants=[...row?.voices?.values() ?? []].map(({assets,first,...variant})=>({...variant,
      assets:[...assets].sort(),sample:first})).sort((a,b)=>a.resource.localeCompare(b.resource) ||
      (a.source ?? '').localeCompare(b.source ?? ''));
    const onset=variants.length ? Math.min(...variants.map(take=>take.sample)) : null;
    const misses=[...row?.missed ?? []].sort();
    const decision=row?.cue==='scheduled' ? 'silent' : row?.cue==='after-fade' ? 'pending' : row?.cue;
    return {status:onset!==null ? 'played' : misses.some(reason=>reason.endsWith('budget')) ? 'dropped' :
      decision ?? (row?.accent ? 'scoring-rule' : row?.missed ? 'missed' : absent),sample:onset,variants,
      ...(row?.accent && {accent:row.accent}),...(misses.length>0 && {misses})};
  }

  function window(value,first,end) {
    let peak=0,power=0,clippedChannelSamples=0;
    for (let i=2*first;i<2*end;i++) {
      const x=value.samples[i];
      peak=Math.max(peak,Math.abs(x));
      power+=x*x;
      clippedChannelSamples+=Number(Math.abs(x)>1);
    }
    return {firstSample:first,endSample:end,peak:rounded(peak),rms:rounded(Math.sqrt(power/(2*(end-first)))),
      clippedChannelSamples};
  }

  function tailWindows(value,at) {
    const block=Math.round(value.sampleRate*.08), frames=value.samples.length/2;
    return at===null ? [] : Array.from({length:3},(_,index)=>{
      const first=at+index*block,end=Math.min(first+block,frames);
      return end>first ? window(value,first,end) : null;
    }).filter(Boolean);
  }

  function compareSignal(live,offline) {
    let error=0, peak=0, unequalSamples=0;
    for (let i=0;i<live.samples.length;i++) {
      const delta=live.samples[i]-offline.samples[i];
      error+=delta*delta;
      peak=Math.max(peak,Math.abs(delta));
      unequalSamples+=Number(delta!==0);
    }
    const frames=live.samples.length/2;
    return {live:window(live,0,frames),offline:window(offline,0,frames),unequalSamples,
      peakDelta:rounded(peak),rmsDelta:rounded(Math.sqrt(error/live.samples.length))};
  }

  function offlineCurve(events,initial,factors,rate,frames) {
    const gains=P.musicLayerGain.curves(initial,factors), decisions=new Map(), latest=new Map();
    for (const {intent,index} of events) {
      if (intent.kind!=='music-layer') continue;
      const {part,gain,ramp=.05,serial,time,factor=null}=intent, first=sample(time,rate);
      if (first>=frames) continue;
      const key=JSON.stringify([part,factor]), previous=latest.get(key);
      if (previous?.time===time && serial!==undefined && previous.serial!==undefined && serial<=previous.serial) {
        decisions.set(index,{status:'ignored',reason:'stale-intent'});
        continue;
      }
      latest.set(key,intent);
      decisions.set(index,{status:'applied',...span(gains.start(part,factor,gain,first,first+Math.round(ramp*rate)))});
    }
    return {gains,decisions};
  }

  async function compare(sources,timeline,input,options={}) {
    check(fields(options,['live','traceOptions','world']), 'Invalid audio path comparison options');
    const liveOptions=options.live ?? {}, {sampleRate:rate=48000,assets={}}=liveOptions;
    check(integer(rate,8000,96000) && !liveOptions.startTime && liveOptions.clock===undefined,
      'Audio comparison needs a sample rate from 8000 to 96000 and a recorded zero-origin clock');
    const trace=input?.format===P.adaptiveRehearsalTrace.format ? R.validateTrace(input) : null;
    check(trace ? trace.entry===timeline?.entry : input && Array.isArray(input.events) && input.format===undefined,
      'Use a captured trace or live route with the timeline entry');
    const traceOptions=options.traceOptions ?? {};
    check(fields(traceOptions,['arrivalOffset','worldCues']) && finite(traceOptions.arrivalOffset ?? 0,0,60),
      'Invalid audio comparison trace settings');
    const route=trace ? A.live.fromTrace(trace,{...traceOptions,arrivalOffset:0}) : input;
    check(finite(route.end,.001,300) && route.events.length<=8192 &&
      Array.from(route.events).every(row=>fields(row,['intent','observedAt']) &&
        finite(row.intent?.time,0,route.end) && finite(row.observedAt,0,1e9) &&
        ['music-transition','music-cue','music-layer','music-ambience'].includes(row.intent.kind) &&
        (row.intent.kind!=='music-layer' || K.music.layerIntent(row.intent))),
    'Use bounded audio inputs with intent and arrival times');
    const frames=sample(route.end,rate);
    const events=route.events.map(({intent,observedAt},index)=>({index,intent,
      observedAt:observedAt+(trace ? traceOptions.arrivalOffset ?? 0 : 0)}));
    const playback={...route,events:events.map(({intent,observedAt})=>({intent,observedAt:Math.min(route.end,observedAt)}))};
    const chronological=events.slice().sort(order);
    const offlineEvents=chronological.filter(({intent})=>['music-transition','music-cue'].includes(intent.kind) && intent.time<route.end);
    const initial={...liveOptions.layerGains,...route.layerGains};
    const factors=P.adaptiveRehearsalTrace.mergeLayerFactors(liveOptions.layerFactors,route.layerFactors);
    const {gains,decisions}=offlineCurve(chronological,initial,factors,rate,frames);
    const {scoring, ...offlineSpec}=timeline;
    const notices=[];
    if (scoring) notices.push('offline-does-not-run-live-scoring-rules');
    if (options.world?.rhythms?.length || options.world?.space?.length)
      notices.push('live-does-not-run-offline-world-score-rules');
    const matched=(offlineSpec.transitions ?? []).filter(edge=>edge.switchPoints!==undefined);
    if (matched.length) {
      offlineSpec.transitions=offlineSpec.transitions.map(edge=>edge.switchPoints===undefined ? edge :
        {from:edge.from,to:edge.to,fadeIn:edge.fadeIn});
      notices.push('offline-matched-performances-use-normal-splices');
    }
    if (route.ambienceGains || liveOptions.ambienceGains) notices.push('offline-pcm-stems-use-unfiltered-ambience');
    offlineSpec.end=route.end;
    const planned={cues:new Map(),exits:new Map(),entries:new Map(),streams:new Set(Object.keys(liveOptions.streams ?? {}))};
    const captured=capture();
    const live=await A.live.replay(sources,timeline,playback,liveOptions,captured.observe,frames);
    const scheduled=L.schedule(sources,offlineSpec,offlineEvents.map(row=>row.intent),assets,undefined,new Map(),planned);
    const placements=new Map();
    const world=options.world && {...options.world,events:trace ? trace.worldEvents.map(({beatId,...row})=>row) :
      chronological.flatMap(({intent})=>intent.kind==='music-cue' ? [{cue:intent.cue ?? intent.resource,time:intent.time,
        strength:finite(intent.data?.strength,0,1) ? intent.data.strength : 1}] : [])};
    const offline=L.renderScheduled(scheduled,offlineSpec,{sampleRate:rate,...(world && {world})},undefined,{gain:gains,placements});
    const pcm=await P.musicComparisonPCM.mix(offline.value,scheduled,liveOptions,offlineSpec,gains,offlineEvents);
    Object.assign(offline.report,A.meters(offline.value));
    const offlineCues=new Map(), offlineJoins=new Map();
    for (const row of scheduled.cueDecisions) {
      const placement=planned.cues.get(row.eventIndex), sound=placements.get(placement);
      offlineCues.set(offlineEvents[row.eventIndex].index,{status:sound ? 'played' : row.status==='played' ? 'silent' : row.status,
        sample:sound?.first ?? null,variants:sound ? [{resource:row.resource,segment:placement.segment,source:placement.source,
          assets:sound.assets,sample:sound.first}] : [],...pcm.get(row.eventIndex)});
    }
    for (const [i,row] of scheduled.markers.entries()) {
      const at=sample(row.time,rate);
      if (at>=frames) continue;
      const placement=planned.exits.get(row.eventIndex), entry=planned.entries.get(row.eventIndex);
      offlineJoins.set(offlineEvents[row.eventIndex].index,{status:'landed',sample:at,from:row.from,to:row.to,
        source:entry.source,phrase:entry.phrase ?? row.to,exitPosition:placement?.to ?? null,entryPosition:row.entry,
        tail:{authoredSeconds:row.tail,directReleaseEndSample:Math.max(at,placements.get(placement)?.end ?? at),
          held:offline.report.performers?.joins[i].held ?? {}}});
    }
    const liveGain=P.musicLayerGain.curves(initial,factors);
    for (const index of captured.layerOrder) {
      const {intent}=events[index], {from,target,startSample,endSample}=captured.evidence.get(index).layer;
      liveGain.append(intent.part,intent.factor ?? null,{from,target,startFrame:startSample,endFrame:endSample});
    }
    const cues=[],transitions=[],layers=[],ambience=[];
    for (const {index,intent,observedAt} of events) {
      const observed=captured.evidence.get(index);
      const requestedSample=sample(intent.time,rate), arrivalSample=Math.round(observedAt*rate);
      const base={input:index,requestedSample,arrivalSample,
        ...(intent.beatId && {beatId:intent.beatId}),...(intent.serial!==undefined && {serial:intent.serial})};
      const absent=arrivalSample>=frames ? 'not-arrived' : requestedSample>=frames ? 'outside-window' : 'unresolved';
      if (intent.kind==='music-cue') {
        const a=liveCue(observed,absent), b=offlineCues.get(index) ?? {status:'outside-window',sample:null,variants:[]};
        const variants=value=>JSON.stringify(value.variants.map(({sample,...take})=>take));
          cues.push({...base,cue:intent.cue ?? intent.resource,resource:intent.resource ?? intent.cue,live:a,offline:b,
          onsetDeltaSamples:difference(a.sample,b.sample),variantStatus:status(variants(a),variants(b)),
          outcomeStatus:status(a.status,b.status)});
      } else if (intent.kind==='music-transition') {
        const a=observed?.transition ?? {status:absent,sample:null};
        const b=offlineJoins.get(index) ?? {status:'outside-window',sample:null};
        const liveTail=tailWindows(live.value,a.sample), offlineTail=tailWindows(offline.value,b.sample);
        const release=value=>value.tail ? Math.min(frames,value.tail.directReleaseEndSample)-value.sample : null;
        transitions.push({...base,from:intent.from,to:intent.to,live:a,offline:b,
          onsetDeltaSamples:difference(a.sample,b.sample),outcomeStatus:status(a.status,b.status),
          variantStatus:status(JSON.stringify([a.source,a.phrase]),JSON.stringify([b.source,b.phrase])),
          tail:{directReleaseDeltaSamples:difference(release(a),release(b)),live:liveTail,offline:offlineTail,
            rmsDeltas:liveTail.slice(0,offlineTail.length).map((row,i)=>rounded(row.rms-offlineTail[i].rms))}});
      } else if (intent.kind==='music-layer') {
        const a=observed?.layer ?? {status:absent}, b=decisions.get(index) ?? {status:'outside-window'};
        const readLive=liveGain.read(intent.part), readOffline=gains.read(intent.part);
        const points=new Set([requestedSample]);
        for (const row of [a,b]) if (row.status==='applied') {
          points.add(row.startSample);
          points.add(Math.floor((row.startSample+row.endSample)/2));
          points.add(row.endSample);
        }
        const effectiveGains=[...points].filter(at=>at<frames).sort((x,y)=>x-y).map(at=>{
          const left=readLive?.(at) ?? 1, right=readOffline?.(at) ?? 1;
          return {sample:at,live:rounded(left),offline:rounded(right),delta:rounded(left-right)};
        });
        layers.push({...base,part:intent.part,factor:intent.factor ?? null,live:a,offline:b,effectiveGains,
          outcomeStatus:status(a.status,b.status),rampStatus:status(JSON.stringify(a),JSON.stringify(b))});
      } else if (intent.kind==='music-ambience') {
        ambience.push({...base,part:intent.part,offline:'unfiltered-stems'});
      }
    }
    const summary={
      cueOnsets:cues.filter(row=>row.onsetDeltaSamples || row.outcomeStatus==='different').length,
      cueVariants:cues.filter(row=>row.variantStatus==='different').length,
      transitions:transitions.filter(row=>row.onsetDeltaSamples || row.outcomeStatus==='different' || row.variantStatus==='different' ||
        row.live.entryPosition!==row.offline.entryPosition || row.live.exitPosition!==row.offline.exitPosition).length,
      layerGains:layers.filter(row=>row.rampStatus==='different' || row.effectiveGains.some(at=>at.delta)).length,
      releaseTails:transitions.filter(row=>row.tail.directReleaseDeltaSamples).length
    };
    return {value:{live:live.value,offline:offline.value},liveReport:live.report,offlineReport:offline.report,
      report:{format:'ink-studio/music-path-comparison',version:1,sampleRate:rate,firstSample:0,endSample:frames,
        input:{kind:trace ? 'captured-trace' : 'live-route',...(trace && {id:trace.id,origin:trace.origin}),
          count:events.length,worldCueCount:trace?.worldEvents.length ?? 0,
          unmappedWorldCues:trace?.worldEvents.filter(row=>!Object.hasOwn(traceOptions.worldCues ?? {},row.cue))
            .map(({cue,time,beatId})=>({cue,requestedSample:sample(time,rate),...(beatId && {beatId})})) ?? []},
        initialGains:{layers:initial,factors},
        notices,summary,cues,transitions,layers,ambience,audio:compareSignal(live.value,offline.value)}};
  }

  P.musicProduction=Object.freeze({...A,rehearsal:Object.freeze({...R,compare})});
})(KIT);
