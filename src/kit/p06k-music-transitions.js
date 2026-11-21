/* Map quantized adaptive-score intents onto playable production windows. */
(function (P) {
  const A=P.musicProduction, I=P.musicInstruments, T=P.takeTime;
  const {record,fields,finite,integer,id,check,clamp,db}=I;
  const sample=(time,rate)=>T.index(T.roundDown(T.mul(T.read(time),[BigInt(rate),1n])));
  const numeric=(value,lo,hi,label)=>{
    check(finite(value,lo,hi),'Invalid transition '+label);
    return value;
  };
  function schedule(sources,spec,intents=[],assets={}) {
    check(record(sources) && Object.keys(sources).length<=32 && Object.keys(sources).every(id) &&
      fields(spec,['entry','segments','transitions','stingers','end','thematic']) && record(spec.segments) &&
      Object.keys(spec.segments).length<=64 && Object.keys(spec.segments).every(id) &&
      Array.isArray(intents) && intents.length<=2048,'Invalid production timeline');
    const end=numeric(spec.end,.001,300,'end'), compiled={};
    const load=name=>{
      check(Object.hasOwn(sources,name),'Unknown production source');
      return compiled[name] ??= A.compile(sources[name],assets);
    };
    const segments=Object.fromEntries(Object.entries(spec.segments).map(([name,raw])=>{
      check(fields(raw,['source','start','end','loop','layers','gain']) && Object.hasOwn(sources,raw.source),
        'Transition segment must name a production source');
      const cue=load(raw.source);
      const at=(value,fallback)=>P.musicTiming.isPosition(value) ? cue.clock.timeAt(value) : value ?? fallback;
      const start=numeric(at(raw.start,0),0,cue.end,'segment start');
      const end=numeric(at(raw.end,cue.end),start+.001,cue.end,'segment end');
      const {loop=true,layers={}}=raw;
      check(typeof loop==='boolean' && record(layers) && Object.keys(layers).every(key=>
        Object.hasOwn(cue.tracks,key) && finite(layers[key],0,1)),'Invalid transition layer levels');
      return [name,{source:raw.source,start,end,loop,layers,gain:db(numeric(raw.gain ?? 0,-60,12,'segment gain'))}];
    }));
    const known=name=>id(name) && Object.hasOwn(segments,name);
    const position=(segment,value,fallback)=>{
      const cue=compiled[segments[segment].source];
      return P.musicTiming.isPosition(value) ? cue.clock.timeAt(value) : value ?? fallback;
    };
    check(known(spec.entry),'Transition entry must name a segment');
    const thematic=spec.thematic;
    let memory;
    const routes=new Map(), decisions=[];
    if (thematic!==undefined) {
      check(fields(thematic,['maps','routes']) && record(thematic.maps) && record(thematic.routes ?? {}) &&
        Object.keys(thematic.maps).length<=32 && Object.keys(thematic.routes ?? {}).length<=64,'Invalid thematic timeline');
      for (const name of Object.keys(thematic.maps)) load(name);
      memory=P.musicThemes.createHistory(thematic.maps,end,compiled);
      const canonical=value=>value===null || typeof value!=='object' ? value :
        Array.isArray(value) ? value.map(canonical) :
          Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
      const grid=cue=>JSON.stringify(canonical({tempo:cue.arrangement.score.tempoMap ?? {},
        bars:cue.arrangement.sections.map(({id,bar,bars})=>[id,bar,bars])}));
      const vocabulary=memory.at(0);
      for (const [segment,choices] of Object.entries(thematic.routes ?? {})) {
        check(known(segment) && Array.isArray(choices) && choices.length>=1 && choices.length<=8,'Invalid thematic route');
        const base=compiled[segments[segment].source], signature=grid(base);
        const parsed=Array.from(choices,row=>{
          check(fields(row,['source','when']) && Object.hasOwn(thematic.maps,row.source) &&
            fields(row.when,['theme','stage','min']) && Object.hasOwn(vocabulary,row.when.theme) &&
            P.musicThemes.stages.includes(row.when.stage) && integer(row.when.min ?? 1,1,4096),
            'A thematic route needs a mapped source and listening requirement');
          const variant=load(row.source);
          check(variant.end===base.end && signature===grid(variant) &&
            Object.keys(base.tracks).every(track=>Object.hasOwn(variant.tracks,track)),
            'Thematic alternatives must share the segment grid and tracks');
          return row;
        });
        routes.set(segment,parsed);
      }
    }
    const edges=spec.transitions ?? [], stingers=spec.stingers ?? {};
    check(Array.isArray(edges) && edges.length<=128 && record(stingers) && Object.keys(stingers).length<=128 &&
      Object.entries(stingers).every(([key,value])=>id(key) && known(value)),'Invalid transition or stinger table');
    const rules=new Map();
    for (const edge of edges) {
      check(fields(edge,['from','to','exit','entry','tail','fadeIn','bridge','pickup']) && known(edge.from) &&
        known(edge.to) && (edge.bridge===undefined || known(edge.bridge)),'Invalid music transition edge');
      const key=edge.from+'>'+edge.to;
      check(!rules.has(key),'Duplicate music transition edge');
      const from=segments[edge.from], to=segments[edge.to];
      const exit=numeric(position(edge.from,edge.exit,from.end),from.start+.001,from.end,'exit marker');
      const entry=numeric(position(edge.to,edge.entry,to.start),to.start,to.end-.001,'entry marker');
      const tail=numeric(edge.tail ?? 0,0,4,'tail'), fadeIn=numeric(edge.fadeIn ?? 0,0,4,'fade in');
      const pickup=numeric(edge.pickup ?? 0,0,4,'pickup');
      check(!pickup || edge.bridge,'A pickup requires a transition bridge');
      rules.set(key,{exit,entry,tail,fadeIn,bridge:edge.bridge,pickup});
    }
    const eligible=intents.filter(intent=>intent?.kind==='music-transition' || intent?.kind==='music-cue');
    check(eligible.every(event=>finite(event.time,0,1e9)),'Music intents need nonnegative times');
    const events=eligible.filter(event=>event.time<end)
      .sort((a,b)=>a.time-b.time || (a.serial ?? 0)-(b.serial ?? 0));
    const placements=[], markers=[];
    function place(name,at,from,to,{tail=0,fadeIn=0,layers={},kind='segment',source=segments[name].source}={}) {
      if (to<=from+1e-8 || at>=end) return;
      check(placements.length<4096,'Music timeline exceeds its placement budget');
      const placement={segment:name,source,at,from,to,tail,
        fadeIn,layers:{...segments[name].layers,...layers},gain:segments[name].gain,kind};
      placements.push(placement);
      memory?.add(placement);
    }
    function playRegion(name,source,offset,at,stop,fadeIn,layers,rule) {
      const segment=segments[name];
      const first=placements.length;
      const span=stop-at;
      if (span<=0) return;
      if (rule && rule.exit<segment.end) {
        const exit=rule.exit;
        const finalLen=Math.min(exit-segment.start,span);
        const lead=stop-finalLen;
        playRegion(name,source,offset,at,lead,fadeIn,layers);
        place(name,lead,exit-finalLen,exit,{source,tail:rule.tail,fadeIn:lead===at ? fadeIn : Math.min(.008,finalLen/2),layers});
        return;
      }
      let time=at, cursor=offset;
      while (time<stop-1e-8) {
        const duration=Math.min(stop-time,segment.end-cursor);
        place(name,time,cursor,cursor+duration,{source,fadeIn:time===at ? fadeIn : 0,layers});
        time+=duration;
        if (!segment.loop || duration<=1e-8) break;
        cursor=segment.start;
      }
      if (rule && placements.length>first && Math.abs(time-stop)<1e-8) placements.at(-1).tail=rule.tail;
    }
    function choose(name,time) {
      const state=memory?.at(time), choices=routes.get(name);
      if (!choices) return segments[name].source;
      const match=choices.find(({when})=>state[when.theme].counts[when.stage]>=(when.min ?? 1));
      const source=match?.source ?? segments[name].source;
      decisions.push({segment:name,time,source,matched:match?.when ?? null,history:state});
      return source;
    }
    let name=spec.entry, start=0, offset=segments[name].start, fadeIn=0, layers={}, source=choose(name,0);
    for (const event of events) {
      if (event.kind==='music-cue') {
        const resource=event.resource ?? event.cue;
        const clip=Object.hasOwn(stingers,resource) && stingers[resource];
        if (clip) {
          const segment=segments[clip];
          place(clip,event.time,segment.start,segment.end,{kind:'stinger'});
        }
        continue;
      }
      check(event.from===name && known(event.to) && event.time>=start,'Adaptive intent does not follow the production timeline');
      const to=segments[event.to], from=segments[name];
      const edge=rules.get(name+'>'+event.to) ??
        {exit:from.end,entry:to.start,tail:0,fadeIn:0,pickup:0};
      playRegion(name,source,offset,start,event.time,fadeIn,layers,edge);
      if (edge.bridge) {
        const bridge=segments[edge.bridge], pickup=Math.min(edge.pickup,event.time-start);
        place(edge.bridge,event.time-pickup,bridge.start,bridge.end,{kind:'bridge'});
      }
      markers.push({time:event.time,beat:event.beat ?? null,from:name,to:event.to,rule:event.rule ?? null});
      name=event.to; start=event.time; offset=edge.entry; fadeIn=edge.fadeIn;
      source=choose(name,start);
      layers=event.layers ?? {};
      check(record(layers) && Object.values(layers).every(level=>finite(level,0,1)),'Invalid adaptive intent layer levels');
      layers=Object.fromEntries(Object.entries(layers).filter(([part])=>Object.hasOwn(compiled[source].tracks,part)));
    }
    playRegion(name,source,offset,start,end,fadeIn,layers);
    placements.sort((a,b)=>a.at-b.at);
    const themes=memory && {final:memory.at(end),decisions,appearances:memory.completed()};
    return {compiled,placements,markers,duration:end,themes};
  }

  function renderTimeline(sources,spec,intents,assets={},options={}) {
    check(fields(options,['sampleRate','start','end','stems','world']),'Invalid production timeline render options');
    const timeline=schedule(sources,spec,intents,assets);
    const {sampleRate=48000,start:beginPoint=0,end:endPoint=timeline.duration,stems=false}=options;
    const start=T.seconds(T.read(beginPoint)),end=T.seconds(T.read(endPoint));
    check(integer(sampleRate,8000,96000)&& finite(start,0,timeline.duration) &&
      finite(end,start,timeline.duration) && end>start && typeof stems==='boolean','Invalid production timeline range');
    const begin=sample(beginPoint,sampleRate),last=sample(endPoint,sampleRate),count=last-begin;
    check(count>0 && count<=16e6,'Production timeline exceeds its sample budget');
    const world=options.world===undefined ? null : P.musicWorldScore.prepare(options.world,timeline,spec,sampleRate,begin,last);
    const value={sampleRate,channels:2,samples:new Float32Array(count*2)}, buffers={}, cache=new Map();
    const envelopes=new Map();
    let cached=0, work=0;
    for (const clip of timeline.placements) {
      const first=sample(clip.at,sampleRate), span=sample(clip.to,sampleRate)-sample(clip.from,sampleRate);
      if (first>=last || first+span+Math.ceil(clip.tail*sampleRate)<=begin) continue;
      const additions=world?.additions.get(clip);
      const key=JSON.stringify([clip.source,clip.from,clip.to,clip.tail,clip.layers]);
      let tracks=additions ? undefined : cache.get(key);
      if (!tracks) {
        let music=timeline.compiled[clip.source];
        if (additions) {
          const events=Object.fromEntries(Object.entries(music.events).map(([name,notes])=>{
            const response=additions[name] ?? [];
            return [name,[...notes.map(note=>({...note})),...response.map((note,i)=>({...note,roundRobin:notes.length+i}))]
              .sort((a,b)=>a.time-b.time)];
          }));
          A.applyChokes(music.tracks,events);
          music={...music,events};
        }
        const render=A.renderCompiled(music,{start:clip.from,end:clip.to,sampleRate,tail:clip.tail,stems:true,layers:clip.layers});
        tracks=render.stems;
        cached+=Object.values(tracks).reduce((sum,stem)=>sum+stem.samples.length,0);
        check(cached<=48e6,'Production timeline exceeds its source audio budget');
        if (!additions) cache.set(key,tracks);
      }
      for (const [part,stem] of Object.entries(tracks)) {
        if (world && !envelopes.has(part)) envelopes.set(part,world.envelope(part));
        const envelope=envelopes.get(part);
        const level=clip.gain;
        if (!level) continue;
        if (stems && !Object.hasOwn(buffers,part)) {
          check((Object.keys(buffers).length+2)*count*2<=36e6,'Transition stems exceed their sample budget');
          buffers[part]={sampleRate,channels:2,samples:new Float32Array(count*2)};
        }
        const dry=buffers[part]?.samples;
        const stop=Math.min(stem.samples.length/2,last-first), low=Math.max(0,begin-first);
        check((work+=stop-low)<=72e6,'Production timeline exceeds its mixing budget');
        for (let i=low;i<stop;i++) {
          let gain=level;
          if (clip.fadeIn) gain*=Math.sin(Math.PI*.5*clamp(i/(clip.fadeIn*sampleRate)));
          if (i>=span && clip.tail) gain*=Math.cos(Math.PI*.5*clamp((i-span)/(clip.tail*sampleRate)));
          if (envelope) gain*=envelope.values[i+first-envelope.first] ?? 1;
          const at=(i+first-begin)*2, l=stem.samples[2*i]*gain, r=stem.samples[2*i+1]*gain;
          value.samples[at]+=l; value.samples[at+1]+=r;
          if (dry) {dry[at]+=l;dry[at+1]+=r;}
        }
      }
    }
    return {value,stems:buffers,report:{start,end,sampleRate,placements:timeline.placements,markers:timeline.markers,
      ...(timeline.themes && {themes:timeline.themes}),
      ...(world && {world:world.report}),
      ...(A.meters(value))}};
  }
  P.musicProduction=Object.freeze({...A,renderTimeline});
})(KIT.procedural);
