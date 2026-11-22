/* Exercise seeded paths with the native score renderer and retain representative joins. */
(function (P) {
  const A=P.musicProduction, R=A.rehearsal, L=P.musicTimeline, E=P.adaptiveRehearsalEvidence;
  const {fields,finite,integer,id,check,record}=P.musicInstruments;
  const round=n=>Number(n.toFixed(6));
  const str=n=>String(n).padStart(2,'0');
  const families=['early-hook-return','exhausted-dwell','hook-collision','clipping','waveform-step',
    'quiet-at-join','unfilled-segment-gap','level-change','exit-source-jump','quantization-wait','reversed-before-boundary'];

  function seeded(score,scenarios,seed=0) {
    check(Array.isArray(scenarios) && integer(scenarios.length,1,32) &&
      new Set(scenarios.map(row=>row?.id)).size===scenarios.length && Number.isSafeInteger(seed),
    'Give regression named route scenarios and a safe-integer seed');
    const bounds=range=>Array.isArray(range) ? range : [range,range];
    const window=(range,min,max)=>{
      const [from,to]=bounds(range);
      return bounds(range).length===2 && finite(from,min,max) && finite(to,from,max);
    };
    let total=0;
    return Array.from(scenarios,scenario=>{
      check(fields(scenario,['id','count','end','updates','worldEvents']) && id(scenario.id) &&
        integer(scenario.count,1,512) && (total+=scenario.count)<=512 && window(scenario.end,.05,300) &&
        Array.isArray(scenario.updates ?? []) && (scenario.updates?.length ?? 0)<=96 &&
        Array.isArray(scenario.worldEvents ?? []) && (scenario.worldEvents?.length ?? 0)<=96,
      'Route scenarios need up to 512 total runs with bounded time windows');
      const endMin=bounds(scenario.end)[0];
      const updates=Array.from(scenario.updates ?? [],row=>{
        check(fields(row,['time','parameters','emotions','cues']) && window(row.time,0,endMin-1e-6),
          'Route updates need fixed times or jitter ranges within every run');
        return row;
      });
      const hits=Array.from(scenario.worldEvents ?? [],row=>{
        check(fields(row,['cue','time','strength','duration']) && window(row.time,0,endMin-1e-6),
          'World cues need fixed times or jitter ranges within every run');
        return row;
      });
      return Array.from({length:scenario.count},(_,index)=>{
        const routeSeed=P.data.hash(JSON.stringify([seed,scenario.id,index]))>>>0;
        let state=routeSeed;
        const at=range=>{
          const [from,to]=bounds(range);
          state=(Math.imul(state,1664525)+1013904223)>>>0;
          return round(from+(to-from)*state/2**32);
        };
        const time=rows=>rows.map(row=>({...row,time:at(row.time)})).sort((a,b)=>a.time-b.time);
        const trace=R.captureScore(score,time(updates),{id:scenario.id.slice(0,43)+'-'+(index+1),
          end:at(scenario.end),worldEvents:time(hits)});
        return {...trace,origin:{kind:'seeded-route',scenario:scenario.id,seed,routeSeed,index}};
      });
    }).flat();
  }

  function policies(raw,sources,timeline,assets) {
    check(fields(raw,['hooks','dwells']) && ['hooks','dwells'].every(key=>Array.isArray(raw[key] ?? []) &&
      (raw[key]?.length ?? 0)<=16),'Regression policies need named hook and dwell checks');
    const names=(values,known)=>Array.isArray(values) && integer(values.length,1,16) &&
      new Set(values).size===values.length && Array.from(values).every(value=>id(value) && (!known || Object.hasOwn(known,value)));
    const checkTracks=tracks=>tracks===undefined || names(tracks);
    const validateRepair=row=>{if (row.repair!==undefined) R.revise(sources,timeline,row.repair,assets);};
    const hooks=Array.from(raw.hooks ?? [],row=>{
      check(fields(row,['id','segments','sources','tracks','minGap','repair']) && id(row.id) &&
        names(row.segments,timeline.segments) && (row.sources===undefined || names(row.sources,sources)) &&
        checkTracks(row.tracks) && finite(row.minGap,.1,300),'Hook checks need a named passage and a minimum time between attacks');
      validateRepair(row);
      return row;
    });
    const dwells=Array.from(raw.dwells ?? [],row=>{
      check(fields(row,['id','segment','tracks','maxConsecutive','repair']) && id(row.id) &&
        Object.hasOwn(timeline.segments,row.segment) && checkTracks(row.tracks) &&
        integer(row.maxConsecutive,1,48),'Dwell checks need a segment and a repeat limit');
      validateRepair(row);
      return row;
    });
    for (const group of [hooks,dwells])
      check(new Set(group.map(row=>row.id)).size===group.length,'Name distinct checks within each regression category');
    return {hooks,dwells};
  }

  function placedEvidence(scheduled,checks,watchTracks,rate) {
    const {markers,segments}=scheduled;
    const clips=scheduled.placements.filter(row=>row.kind==='segment' && row.gain>0);
    const onsets=new Map();
    const attack=(clip,tracks)=>E.placementAttack(scheduled,clip,tracks ?? watchTracks,onsets,rate);
    const flags=[];
    for (const rule of checks.hooks) {
      let last=null;
      for (const clip of clips) {
        if (!rule.segments.includes(clip.segment) || rule.sources && !rule.sources.includes(clip.source)) continue;
        const time=attack(clip,rule.tracks);
        if (time===null) continue;
        const gap=last && round(time-last.time);
        if (gap!==null && gap<rule.minGap) {
          const edge=markers.find(row=>Math.abs(row.time-clip.at)<1e-8);
          flags.push({family:'early-hook-return',group:rule.id,time,severity:round(1+4*(1-gap/rule.minGap)),
            evidence:{time,segment:clip.segment,source:clip.source,previous:last,gap,minimum:rule.minGap,
              ...(edge && {edge:{from:edge.from,to:edge.to}})},...(rule.repair && {repair:rule.repair})});
        }
        last={time,segment:clip.segment,source:clip.source};
      }
    }
    for (const rule of checks.dwells) {
      let last=null,count=0,boundary=null,first=0;
      const sceneAt=time=>markers.findLast(row=>row.time<=time+1e-8)?.time ?? 0;
      for (const clip of clips) {
        if (clip.segment!==rule.segment) continue;
        if (clip.from>segments[clip.segment].start+1e-8 && sceneAt(clip.at)!==clip.at) continue;
        const time=attack(clip,rule.tracks);
        if (time===null) continue;
        const dwell=sceneAt(clip.at);
        if (clip.source!==last || dwell!==boundary) {
          last=clip.source; boundary=dwell; count=0; first=time;
        }
        count++;
        if (count===rule.maxConsecutive+1)
          flags.push({family:'exhausted-dwell',group:rule.id,time,severity:3,
            evidence:{time,first,segment:clip.segment,source:clip.source,count,maximum:rule.maxConsecutive},
            ...(rule.repair && {repair:rule.repair})});
      }
    }
    return flags;
  }

  function atJoin(report,timeline) {
    return report.cases.flatMap(row=>row.issues.map(issue=>{
      let group=row.from && row.to ? row.from+'>'+row.to : row.segment ?? row.cue ?? row.kind;
      let repair;
      if (row.kind==='stinger') {
        group=[row.section,row.resource,row.linked ? 'linked' : 'standalone'].join('/');
        if (issue.kind==='hook-collision' && id(row.resource) && !timeline.stingerRules?.some(rule=>
          rule.resource===row.resource && rule.section===row.section &&
            (rule.linked===undefined || rule.linked===Boolean(row.linked))))
          repair={id:'clear-stinger',stingerRules:[{section:row.section,resource:row.resource,linked:Boolean(row.linked)}]};
      }
      return {family:issue.kind,group,time:issue.kind==='hook-collision' ? row.attack ?? row.time : row.time,
        severity:issue.weight,evidence:row,...(repair && {repair})};
    }));
  }

  function run(sources,timeline,settings,assets={},host) {
    check(fields(settings,['score','scenarios','seed','traces','variants','options']) && record(timeline?.segments) &&
      Number.isSafeInteger(settings.seed ?? 0) &&
      (settings.traces===undefined || Array.isArray(settings.traces) && settings.traces.length<=512) &&
      Array.isArray(settings.variants ?? []) && (settings.variants?.length ?? 0)<=4 &&
      Array.from(settings.variants ?? []).every(row=>record(row) && id(row.id) && row.id!=='reference') &&
      new Set((settings.variants ?? []).map(row=>row.id)).size===(settings.variants?.length ?? 0),
    'Regression needs traces or authored route scenarios, with up to four comparison edits');
    const options=settings.options ?? {}, {sampleRate=12000,before=1.3,after=1.5,radius=.18,target=-18,
      ceiling=-1.2,limit=8,world,maxAffected={},listenFor=families}=options;
    check(fields(options,['sampleRate','before','after','radius','target','ceiling','limit','world','watchTracks','checks','maxAffected','listenFor']) &&
      integer(sampleRate,8000,48000) && finite(before,0,8) && finite(after,.15,8) && finite(radius,.025,.75) &&
      finite(target,-35,-9) && finite(ceiling,-8,-.1) && integer(limit,1,16) &&
      (world===undefined || fields(world,['space','rhythms'])) &&
      Array.isArray(listenFor) && integer(listenFor.length,1,families.length) &&
      Array.from(listenFor).every(family=>families.includes(family)) && new Set(listenFor).size===listenFor.length &&
      record(maxAffected) && Object.entries(maxAffected).every(([family,n])=>families.includes(family) && integer(n,0,512)) &&
      (options.watchTracks===undefined || Array.isArray(options.watchTracks) && options.watchTracks.length<=8 &&
        Array.from(options.watchTracks).every(id) && new Set(options.watchTracks).size===options.watchTracks.length),
    'Invalid regression listening or failure limits');
    const prepared=policies(options.checks ?? {},sources,timeline,assets);
    const traces=[...Array.from(settings.traces ?? [],R.validateTrace),
      ...(settings.scenarios===undefined ? [] : seeded(settings.score,settings.scenarios,settings.seed))];
    const variants=settings.variants ?? [];
    check(integer(traces.length,1,512) && new Set(traces.map(trace=>trace.id)).size===traces.length &&
      traces.every(trace=>trace.entry===timeline.entry && trace.intents.length+trace.requests.length+trace.worldEvents.length<=1024) &&
      traces.reduce((total,trace)=>total+Math.ceil(trace.end*sampleRate),0)*(variants.length+1)<=144e6 &&
      limit*(variants.length+1)*(before+after)*sampleRate<=8e6,
    'Regression routes must share an entry and fit the trace, mixing and audition budgets');
    const watchTracks=options.watchTracks ?? [...new Set(Object.values(sources).flatMap(source=>
      Object.entries((source.arrangement?.definition ?? source.arrangement)?.parts ?? {})
        .filter(([,part])=>part.role==='lead').map(([name])=>name)))].slice(0,8);
    const versions=[{id:'reference',sources,timeline},...variants.map(revision=>({id:revision.id,
      ...R.revise(sources,timeline,revision,assets)}))].map(version=>({...version,study:L.study(version.sources,assets,host),
      groups:new Map(),families:new Map()}));
    const byTrace=new Map(traces.map(trace=>[trace.id,trace]));
    const familyLabel=trace=>trace.origin?.kind==='seeded-route' ? trace.origin.scenario : 'recorded';
    const groupKey=flag=>flag.family+':'+flag.group;
    function render(version,trace) {
      const spec={...version.timeline,end:trace.end}, scheduled=version.study.schedule(spec,trace.intents);
      const wave=version.study.render(scheduled,spec,{sampleRate,...(world && {world:{...world,events:trace.worldEvents}})});
      const observed=E.observe(trace,scheduled,wave,{watchTracks,radius,measureStingerAttack:true});
      const flags=[...placedEvidence(scheduled,prepared,watchTracks,sampleRate),...atJoin(observed,spec)];
      return {flags,wave:wave.value,transitions:scheduled.markers.length,peak:observed.peak};
    }
    const routes=traces.map(trace=>({id:trace.id,scenario:familyLabel(trace),end:trace.end,versions:versions.map(version=>{
      const {flags,transitions,peak}=render(version,trace);
      for (const flag of flags) {
        const key=groupKey(flag);
        const group=version.groups.get(key) ?? {family:flag.family,group:flag.group,occurrences:0,routes:new Set(),scenarios:new Map()};
        const scenario=familyLabel(trace);
        if (!group.routes.has(trace.id)) group.scenarios.set(scenario,(group.scenarios.get(scenario) ?? 0)+1);
        group.routes.add(trace.id);
        group.occurrences++;
        if (!group.representative || flag.severity>group.representative.severity)
          group.representative={trace:trace.id,time:flag.time,severity:flag.severity,evidence:flag.evidence,
            ...(flag.repair && {repair:flag.repair})};
        version.groups.set(key,group);
        if (!version.families.has(flag.family)) version.families.set(flag.family,new Set());
        version.families.get(flag.family).add(trace.id);
      }
      return {id:version.id,transitions,peak,flags:flags.length};
    })}));
    const keys=[...new Set(versions.flatMap(version=>[...version.groups.keys()]))];
    const groups=keys.map(key=>{
      const owner=versions.find(version=>version.groups.has(key)), row=owner.groups.get(key);
      return {key,family:row.family,group:row.group,priority:round(row.representative.severity*Math.sqrt(row.routes.size)),
        representative:{...row.representative,version:owner.id},versions:versions.map(version=>{
          const found=version.groups.get(key);
          return {id:version.id,routes:found?.routes.size ?? 0,occurrences:found?.occurrences ?? 0,scenarios:found ? Object.fromEntries(found.scenarios) : {}};
        })};
    }).sort((a,b)=>b.priority-a.priority || a.key.localeCompare(b.key));
    const audio={}, listening=groups.filter(group=>listenFor.includes(group.family)).slice(0,limit).map((group,index)=>{
      const trace=byTrace.get(group.representative.trace), {time}=group.representative;
      const endSample=E.sample(Math.min(trace.end,time+after),sampleRate);
      const firstSample=Math.min(endSample-1,E.sample(Math.max(0,time-before),sampleRate));
      const runs=versions.map(version=>render(version,trace));
      const comparison=E.matched(runs.map(({wave})=>({...wave,samples:wave.samples.slice(2*firstSample,2*endSample)})),target,ceiling);
      const id='join-'+str(index+1);
      audio[id]=Object.fromEntries(comparison.map((clip,i)=>[versions[i].id,clip.value]));
      return {id,key:group.key,trace:trace.id,time,firstSample,endSample,sampleRate,
        takes:comparison.map((clip,i)=>({id:versions[i].id,playback:clip.playback,
          issues:runs[i].flags.filter(flag=>groupKey(flag)===group.key &&
            flag.time>=firstSample/sampleRate && flag.time<endSample/sampleRate).map(({time,severity})=>({time,severity}))}))};
    });
    const gates=versions.map(version=>{
      const limits=Object.entries(maxAffected).map(([family,max])=>{
        const routes=version.families.get(family)?.size ?? 0;
        return {family,routes,max,pass:routes<=max};
      });
      return {id:version.id,pass:limits.every(row=>row.pass),limits};
    });
    return {report:{format:'ink-studio/adaptive-score-regression',version:1,seed:settings.seed ?? 0,
      sampleRate,count:traces.length,routes,groups,listening,gates},audio,traces};
  }

  P.musicProduction=Object.freeze({...A,rehearsal:Object.freeze({...R,seedTraces:seeded,regression:run})});
})(KIT.procedural);
