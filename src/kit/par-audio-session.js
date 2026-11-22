/* Render editable take lanes into one continuous mixing and audition transport. */
(function (P) {
  const M=P.mediaGraph,S=P.mediaGraphSupport,A=P.musicProduction;
  const {check,fields,record,id,integer}=P.musicInstruments;
  const {compile,edits,replace,addressed,reference,room,signature,samples}=S.musicSessionModel;
  const cacheBudget=160*1024*1024, pcmBudget=32e6;
  const audio=(sampleRate,samples)=>({sampleRate,channels:2,samples});
  const byteSize=pcm=>pcm?.samples.byteLength ?? 0;
  function monitorSelection(spec,taps) {
    check(fields(spec,['mode','tap']) && ['solo','subtract'].includes(spec.mode) && id(spec.tap) &&
      Object.hasOwn(taps,spec.tap),'Choose a mixer tap to solo or subtract');
    return {...spec};
  }
  S.sessionMonitor=monitorSelection;
  function create(input={},host) {
    check(record(input) && Object.keys(input).length<=128 && Object.keys(input).every(id),'Expected named session audio assets');
    let count=0;
    const assets=Object.fromEntries(Object.entries(input).map(([name,raw])=>{
      const pcm=M.audio(raw);
      count+=pcm.samples.length;
      check(pcm.channels<=2 && pcm.samples.length>0 && count<=pcmBudget,'Session asset PCM budget exceeded');
      return [name,{...pcm,samples:Float64Array.from(pcm.samples)}];
    }));
    const load=name=>{
      check(Object.hasOwn(assets,name),'Missing session asset '+name);
      return assets[name];
    };
    const cache=new Map();
    let bytes=0;
    function reuse(key,job,counts) {
      const prior=cache.get(key);
      if (prior) {
        counts.hits++;
        cache.delete(key);
        cache.set(key,prior);
        return prior.value;
      }
      counts.misses++;
      const value=job(), size=byteSize(value.dry)+byteSize(value.room)+(value.roomLevel?.byteLength ?? 0)+
        (value.echoLevel?.byteLength ?? 0)+key.length*2;
      if (size<=cacheBudget) {
        while (bytes+size>cacheBudget) {
          const oldest=cache.keys().next().value;
          bytes-=cache.get(oldest).size;
          cache.delete(oldest);
        }
        cache.set(key,{value,size});
        bytes+=size;
      }
      return value;
    }
    function scoreTake(plan,lane,take,counts,live=false) {
      const {score,source}=plan.producers.get(take), track=score.tracks[lane];
      const {roomCuts,perTrack}=score.cue ?? {};
      const duck=track.mix.duck?.from;
      const patch=source.patches[track.patch], events=score.events[lane];
      const hasRoom=track.mix.send>0 || perTrack?.[lane].room.some(row=>row.send.some(level=>level>0)) ||
        perTrack?.[lane].depth.some(row=>row.send>0);
      const key=signature([live ? 'live-score' : 'score',lane,plan.rate,plan.map,score.end,source.tracks[lane],patch,score.gain,hasRoom && score.room,
        score.arrangement.score.endFade,perTrack?.[lane],roomCuts,events,duck && score.events[duck]]);
      return reuse(key,()=>{
        if (live) return {...A.renderSessionSource(score,lane,plan.rate),send:track.mix.send,echo:track.echo,
          roomSpec:hasRoom ? score.room : null,roomCuts,trackCuts:perTrack?.[lane].cuts};
        const result=A.renderCompiled({...score,tracks:{[lane]:track}},{sampleRate:plan.rate,stems:true});
        return {dry:result.stems[lane],room:hasRoom ? result.stems.room : undefined};
      },counts);
    }
    function prepareAudio(plan,lane,take) {
      const row=plan.audio.get(lane).takes.get(take);
      let pcm, fallback=0;
      if (row.motif) {
        const {source,score,plan:saved,role}=row.motif;
        const {stem,report}=M.sampleMotif.render(saved,load(source),load(score),role);
        pcm=stem;
        fallback=Math.floor(report.firstSample*plan.rate/report.sampleRate);
      } else if (row.editorial) {
        const {value,stems}=M.audioEditorial.render(row.editorial,assets,{stems:row.track!==undefined});
        pcm=row.track===undefined ? value : stems[row.track];
        check(pcm,'Unknown track in editorial take '+lane+'/'+take);
      } else pcm=load(row.asset);
      const step=pcm.sampleRate/plan.rate, frames=pcm.samples.length/pcm.channels;
      const first=row.fromSample ?? 0, last=row.toSample ?? frames;
      const from=row.at===undefined ? fallback : plan.at(row.at);
      check(integer(first,0,frames-1) && integer(last,first+1,frames) &&
        integer(from,0,plan.frames-1) && step>=1/128 && step<=16,'Invalid audio take placement or range');
      const duration=Math.min(plan.frames-from,Math.ceil((last-first)/step));
      const reader=S.pcmReader(pcm,first,last,step);
      check(duration*reader.cost<=80e6,'Audio take exceeds its resampling budget');
      return {from,duration,write(out,start,end) {
        const pair=[0,0];
        for (let at=Math.max(start,from);at<Math.min(end,from+duration);at++) {
          reader.read(first+(at-from)*step,pair);
          const i=(at-start)*2;
          out[i]=pair[0]; out[i+1]=pair[1];
        }
      }};
    }
    function audioTake(plan,lane,take,counts) {
      const row=plan.audio.get(lane).takes.get(take);
      const key=signature(['audio',plan.rate,plan.frames,plan.map,row]);
      return reuse(key,()=>{
        const {from,duration,write}=prepareAudio(plan,lane,take);
        const out=new Float32Array(duration*2);
        write(out,from,from+duration);
        return {dry:audio(plan.rate,out),from};
      },counts);
    }
    const incremental=S.createSessionRender({assets,host,prepareAudio});
    function inspect(session,plan=compile(session,assets,host)) {
      return {id:session.id,sampleRate:plan.rate,frames:plan.frames,pins:plan.pins,comp:plan.choices,
        lanes:Object.fromEntries(plan.lanes.map(lane=>{
          const row=plan.audio.get(lane);
          if (row) return [lane,{kind:'audio',take:row.take,takes:Object.fromEntries(row.takes)}];
          return [lane,{kind:'score',take:reference,takes:Object.fromEntries([...plan.producers].map(([take,{score}])=>
            [take,addressed(score,lane)]))}];
        })),automation:session.automation ?? {}};
    }
    function playback(plan,preview) {
      if (preview===undefined) return {warmup:0,segments:[{from:0,to:plan.frames,choices:plan.choices}],switches:[]};
      check(fields(preview,['from','to','passes','switches','monitor','context']) && integer(preview.passes ?? 1,1,8),
        'Preview needs a loop range and up to eight passes');
      const focus=plan.range(preview.from,preview.to), passes=preview.passes ?? 1;
      const context=preview.context ?? {}, {beforeSamples=0,afterSamples=0}=context;
      check(fields(context,['beforeSamples','afterSamples']) && integer(beforeSamples,0,plan.frames) &&
        integer(afterSamples,0,plan.frames),'Choose nonnegative preview context in samples');
      const from=Math.max(0,focus.from-beforeSamples), to=Math.min(plan.frames,focus.to+afterSamples), length=to-from;
      const raw=preview.switches ?? [];
      check(Array.isArray(raw) && raw.length<=128,'Invalid preview switch list');
      const switches=Array.from(raw,row=>{
        check(fields(row,['pass','at','lane','take','fadeSamples']) && integer(row.pass,0,passes-1),
          'Switch needs a loop pass, playhead address, lane and take');
        const at=plan.at(row.at);
        check(integer(at,from,to-1),'Switch playhead is outside the loop');
        const selection=plan.choice({lane:row.lane,take:row.take,from:row.at,to:samples(to),fadeSamples:row.fadeSamples ?? 0});
        return {...selection,pass:row.pass,at:at-from+row.pass*length};
      }).sort((a,b)=>a.at-b.at);
      const active=new Map(), segments=from ? [{from:0,to:from,choices:plan.choices}] : [];
      const unique=new Set();
      for (const row of switches) {
        const key=signature([row.at,row.lane]);
        check(!unique.has(key),'One switch per lane at the same playhead');
        unique.add(key);
      }
      for (let pass=0;pass<passes;pass++) {
        let choices=plan.choices;
        for (const row of active.values())
          choices=replace(choices,plan.choice({lane:row.lane,take:row.take,from:samples(from),to:samples(to)}));
        for (const row of switches) if (row.pass===pass) {
          const previous=choices.find(pick=>pick.lane===row.lane && pick.from<=row.from && pick.to>row.from);
          const fadeFrom=previous?.take ?? plan.audio.get(row.lane)?.take ?? reference;
          choices=replace(choices,{...row,fadeFrom});
          active.set(row.lane,row);
        }
        segments.push({from,to,choices});
      }
      return {warmup:from,segments,switches,focus};
    }
    function mixerInput(plan,segments,counts) {
      const frames=segments.reduce((n,row)=>n+row.to-row.from,0);
      check(frames*plan.sourceLanes.length*2<=pcmBudget,'Session preview or render exceeds its PCM budget');
      const mixed=Object.fromEntries(plan.sourceLanes.map(lane=>[lane,new Float32Array(frames*2)]));
      const local=new Map();
      let held=0;
      const get=(lane,take)=>{
        const key=lane+'/'+take;
        if (!local.has(key)) {
          const value=plan.audio.has(lane) ? audioTake(plan,lane,take,counts) : scoreTake(plan,lane,take,counts);
          held+=(byteSize(value.dry)+byteSize(value.room))/4;
          check(held<=pcmBudget*2,'Selected takes exceed the active PCM budget');
          local.set(key,value);
        }
        return local.get(key);
      };
      const add=(target,reader,at,value,blend)=>{
        if (!reader) return;
        target[at]+=(reader[value] ?? 0)*blend;
        target[at+1]+=(reader[value+1] ?? 0)*blend;
      };
      let cursor=0;
      for (const {from,to,choices} of segments) {
        for (const lane of plan.lanes) {
          const initial=plan.audio.get(lane)?.take ?? reference;
          const ranges=choices.filter(row=>row.lane===lane && row.from<to && row.to>from);
          const edges=[from,...ranges.flatMap(row=>[Math.max(from,row.from),Math.min(to,row.to)]),to];
          const dry=mixed[lane], wet=mixed[room];
          for (let edge=0;edge<edges.length-1;edge++) {
            const begin=edges[edge], end=edges[edge+1];
            if (end<=begin) continue;
            const pick=edge%2 ? ranges[(edge-1)/2] : null;
            const other=pick?.fadeFrom ?? initial;
            const a=get(lane,pick?.take ?? initial), b=pick?.fadeSamples && pick.take!==other ? get(lane,other) : null;
            for (let i=begin;i<end;i++) {
              const at=(cursor+i-from)*2, delta=(i-(a.from ?? 0))*2;
              const u=b ? Math.min(1,(i-pick.from)/pick.fadeSamples,
                pick.fadeFrom===undefined ? (pick.to-1-i)/pick.fadeSamples : 1) : 1;
              add(dry,a.dry.samples,at,delta,u);
              add(wet,a.room?.samples,at,i*2,u);
              if (b && u<1) {
                add(dry,b.dry.samples,at,(i-(b.from ?? 0))*2,1-u);
                add(wet,b.room?.samples,at,i*2,1-u);
              }
            }
          }
        }
        cursor+=to-from;
      }
      const strips={...plan.mixer.strips}, material={...assets};
      for (const [index,lane] of plan.sourceLanes.entries()) {
        let name='session-input-'+index, peak=1;
        const pcm=mixed[lane];
        let first=0,last=pcm.length;
        while (first<last && pcm[first]===0 && pcm[first+1]===0) first+=2;
        while (last>first && pcm[last-2]===0 && pcm[last-1]===0) last-=2;
        if (last===first) continue;
        const trimmed=pcm.subarray(first,last);
        while (Object.hasOwn(material,name)) name+='x';
        for (const value of trimmed) peak=Math.max(peak,Math.abs(value));
        if (peak>1) for (let i=0;i<trimmed.length;i++) trimmed[i]/=peak;
        material[name]=audio(plan.rate,trimmed);
        strips[lane]={...strips[lane],clips:[{id:lane,source:name,at:samples(first/2),gainDb:20*Math.log10(peak)}]};
      }
      return {recipe:{...plan.mixer,strips,end:samples(frames)},material};
    }
    function render(session,preview) {
      return renderPlan(compile(session,assets,host),preview);
    }
    function renderPlan(plan,preview) {
      const transport=playback(plan,preview);
      const result=incremental(plan,transport,preview) ?? continuous(plan,transport,preview);
      if (preview?.context) result.report.focus=transport.focus;
      if (preview?.monitor) {
        const monitor=monitorSelection(preview.monitor,result.taps);
        const source=result.taps[monitor.tap];
        const value=monitor.mode==='solo' ? source : difference(result.value,source);
        return {...result,value,report:{...result.report,monitor}};
      }
      return result;
    }
    function continuous(plan,transport,preview) {
      const {segments,warmup,switches}=transport, counts={hits:0,misses:0};
      const straight=preview && (preview.passes ?? 1)===1 && !switches.length;
      const {recipe,material}=mixerInput(plan,straight ? playback(plan).segments : segments,counts);
      const printed=preview===undefined || straight ? M.mixer.render(recipe,material,host) :
        S.renderMixerTransport({...recipe,tail:'cut'},material,segments,host);
      const end=straight ? segments.at(-1).to : printed.report.frames;
      const cut=pcm=>({...pcm,samples:pcm.samples.slice(warmup*2,end*2)});
      return {value:cut(printed.value),taps:Object.fromEntries(Object.entries(printed.taps).map(([name,pcm])=>[name,cut(pcm)])),
        report:{sampleRate:plan.rate,warmupSamples:warmup,frames:end-warmup,
          comp:plan.choices,switches,cache:counts,mixer:printed.report,renderPath:'continuous',
          segments:segments.slice(warmup ? 1 : 0).map(({from,to})=>({from,to}))}};
    }
    function difference(a,b) {
      return audio(a.sampleRate,Float64Array.from(a.samples,(sample,i)=>sample-b.samples[i]));
    }
    function compare(before,after,preview) {
      check(preview!==undefined,'Choose a score range to compare');
      const first=render(before,preview), second=render(after,preview);
      check(first.report.sampleRate===second.report.sampleRate && first.report.warmupSamples===second.report.warmupSamples &&
        first.report.frames===second.report.frames && signature(first.report.segments)===signature(second.report.segments),
        'Comparison takes must share the same sample timeline');
      const gain=Math.min(first.report.mixer.headroom,second.report.mixer.headroom);
      const level=({value,report})=>gain===report.mixer.headroom ? value :
        audio(value.sampleRate,Float64Array.from(value.samples,sample=>sample*(gain/report.mixer.headroom)));
      const a=level(first), b=level(second);
      return {before:a,after:b,difference:difference(b,a),report:{before:first.report,after:second.report,headroom:gain}};
    }
    function handoff(session) {
      const plan=compile(session,assets,host), transport=playback(plan);
      const streamed=incremental(plan,transport,undefined,true);
      if (streamed) return S.musicHandoff(plan,plan.mixer,{},{
        ...streamed,report:streamed.report.mixer});
      const counts={hits:0,misses:0}, {recipe,material}=mixerInput(plan,transport.segments,counts);
      return S.musicHandoff(plan,recipe,material,M.mixer.render(recipe,material,host));
    }
    const edit=(session,changes)=>edits(session,assets,changes,host);
    const experiments=S.createSessionExperiment({compile:session=>compile(session,assets,host),render:renderPlan,edit,assets});
    function prepareTransport(session,mode='buffered') {
      const plan=compile(session,assets,host);
      const native=[...plan.producers.values()].every(({score})=>Object.values(score.tracks).every(track=>!track.external));
      if (native && mode==='deferred') return {session,incremental:true};
      const blocks=native && mode==='blocks';
      const {rate,map,frames,lanes,sourceLanes,mixer,pins,choices}=plan;
      const cache={hits:0,misses:0}, unique=new Set();
      let prepared=0;
      const media=Object.fromEntries(lanes.map(lane=>{
        const track=plan.audio.get(lane), names=[...(track?.takes ?? plan.producers).keys()];
        return [lane,{fallback:track?.take ?? reference,materials:Object.fromEntries(names.map(name=>{
          const value=blocks ? incremental.prepareSource(plan,lane,name) :
            track ? audioTake(plan,lane,name,cache) : scoreTake(plan,lane,name,cache,true);
          if (!blocks && !unique.has(value)) {
            unique.add(value);
            prepared+=value.dry.samples.length+(value.roomLevel?.length ?? 0)+(value.echoLevel?.length ?? 0);
            check(prepared<=48e6,'Prepared live takes exceed the session PCM budget');
          }
          const pitches=pins[lane]==='pitch' ? plan.producers.get(name).score.events[lane].map(({beat,voice,midi})=>
            ({beat,voice,midi})) : [];
          return [name,{value,pitches}];
        }))}];
      }));
      return {session,rate,map,frames,lanes,sourceLanes,mixer,pins,choices,media,cache,report:inspect(session,plan)};
    }
    const prepareLive=session=>prepareTransport(session,'deferred');
    const materialize=prepared=>prepared.incremental ? prepareTransport(prepared.session,'blocks') : prepared;
    const openPreparedTransport=(prepared,options)=>S.openSessionTransport(materialize(prepared),options,
      {assets,edit,prepareLive,materialize});
    const open=(session,options)=>openPreparedTransport(prepareLive(P.data.freeze(P.data.clone(session))),options);
    return Object.freeze({inspect,edit,render,compare,handoff,experiment:experiments.run,keepExperiment:experiments.keep,
      open,prepareTransport,prepareLive,openPreparedTransport});
  }
  M.musicSession=Object.freeze({create});
})(KIT.procedural);
