/* Pull only requested output blocks, with checkpoints for the performance room and desk. */
(function (P) {
  const S=P.mediaGraphSupport, {check}=P.musicInstruments;
  const {signature,samples,reference}=S.musicSessionModel;
  const {createBlocks,blockFrames}=S.sessionBlocks;
  const rounded=length=>Math.ceil(length/blockFrames);
  const pcm=(sampleRate,samples)=>({sampleRate,channels:2,samples});

  function controlsInRange({points,curve},from,to) {
    let low=0,high=points.length;
    while (high-low>1) {
      const index=(low+high)>>>1;
      if (points[index].sample<=from) low=index;
      else high=index;
    }
    let end=low+1;
    while (end<points.length && points[end].sample<to) end++;
    if (curve==='linear' && end<points.length && points[end-1].sample<to-1) end++;
    return [curve,points.slice(low,end)];
  }

  S.createSessionRender=({assets,host,prepareAudio})=>{
    const store=createBlocks();
    function prepareSource(plan,lane,take) {
      const audio=plan.audio.get(lane);
      if (audio) {
        let sound;
        return store.audioSource(plan,audio.takes.get(take),(out,from,to)=>{
          sound ??= prepareAudio(plan,lane,take);
          sound.write(out,from,to);
        });
      }
      if (plan.producers.get(take).score.tracks[lane].external) return null;
      return store.scoreSource(plan,lane,take);
    }
    // A terminal limiter must see the complete unscaled stream, including its
    // lookahead and output verification. Upstream stages can still resume.
    function finishLimiter(plan,transport,preview,withSources) {
      const {mixer,rate,map,frames}=plan, strip=mixer.strips[mixer.output];
      const inserts=strip.inserts ?? [], last=inserts.at(-1);
      const id=typeof last==='string' ? last : last?.processor;
      const limiter=Object.hasOwn(mixer.processors,id) && mixer.processors[id];
      if (limiter?.type!=='limiter' || (strip.fader ?? 1)!==1 || (strip.pan ?? 0)!==0) return null;
      const straight=preview && (preview.passes ?? 1)===1 && !transport.switches.length;
      const run=straight ? {warmup:0,switches:[],segments:[{from:0,to:frames,choices:plan.choices}]} :
        {...transport,warmup:0};
      const upstream={...plan,mixer:{...mixer,strips:{...mixer.strips,[mixer.output]:{...strip,inserts:inserts.slice(0,-1)}}}};
      const printed=render(upstream,run,straight ? undefined : preview,withSources,true);
      if (!printed) return null;
      const time=S.mixerTime(rate,map);
      const clock=straight || !preview ? time : S.mixerTransport(time,run.segments);
      const processor=S.mixerProcessor(limiter,rate,clock,undefined,host);
      const finished=new Float64Array(printed.value.samples.length);
      const details=processor.block(printed.value.samples,finished);
      const taps=Object.fromEntries(Object.entries(printed.taps).map(([name,audio])=>{
        const spec=mixer.taps[name];
        return [name,spec.strip===mixer.output && spec.tap!=='input' ? pcm(rate,finished) : audio];
      }));
      let peak=0;
      for (const data of new Set([finished,...Object.values(taps).map(audio=>audio.samples)])) {
        for (const value of data) peak=Math.max(peak,Math.abs(value));
      }
      check(Number.isFinite(peak),'Session mixer produced nonfinite audio');
      check(peak<=1 || mixer.peakPolicy!=='error','Mixer output exceeds full scale');
      const headroom=1/Math.max(1,peak), first=transport.warmup;
      const stop=preview ? transport.segments.reduce((end,{from,to})=>end+to-from,0) : finished.length/2;
      const listen=data=>pcm(rate,Float64Array.from(data.subarray(2*first,2*stop),value=>value*headroom));
      const report=printed.report.mixer, output=report.strips[mixer.output];
      const operation={id,type:'limiter',latency:processor.latency,tail:0,outputLatency:processor.latency,mainDelay:0,details};
      return {...printed,value:listen(finished),taps:Object.fromEntries(Object.entries(taps)
        .map(([name,audio])=>[name,listen(audio.samples)])),
        report:{...printed.report,renderPath:'continuous',continuousStage:id,warmupSamples:first,frames:stop-first,
          segments:transport.segments.slice(first ? 1 : 0).map(({from,to})=>({from,to})),
          mixer:{...report,peak,headroom,latencySamples:processor.latency,strips:{...report.strips,
            [mixer.output]:{...output,latency:processor.latency,inserts:[...output.inserts,operation]}}}}};
    }
    function render(plan,transport,preview,withSources=false,raw=false) {
      const {rate,map,lanes,sourceLanes,mixer}=plan, {warmup,switches}=transport;
      const audition=preview!==undefined, straight=audition && (preview.passes ?? 1)===1 && !switches.length;
      const printGain=straight && !raw && mixer.peakPolicy!=='error';
      const length=transport.segments.reduce((sum,{from,to})=>sum+to-from,0);
      const sourceEnd=Math.max(plan.frames,length);
      const segments=transport.segments.slice();
      if (straight) segments[segments.length-1]={...segments.at(-1),to:printGain ? plan.frames :
        Math.min(plan.frames,rounded(length)*blockFrames)};
      const scoreTime=S.mixerTime(rate,map);
      const clock=segments.some((row,index)=>index && segments[index-1].to!==row.from) ?
        S.mixerTransport(scoreTime,segments) : scoreTime;
      const ends=Object.fromEntries(sourceLanes.map(name=>[name,sourceEnd]));
      const createDesk=()=>S.prepareSessionMixer({...mixer,end:samples(sourceEnd)},assets,clock,ends,host);
      let desk=createDesk();
      if (!desk) return raw ? null : finishLimiter(plan,transport,preview,withSources);
      const trackedTaps=Object.keys(desk.taps);
      const printTaps=1+trackedTaps.length, outputs=printTaps+(withSources ? sourceLanes.length : 0);
      const frames=!audition || printGain ? desk.report.frames : segments.reduce((sum,{from,to})=>sum+to-from,0);
      const stop=audition ? length : frames;
      check((stop-warmup)*outputs*2<=(withSources ? 96e6 : 48e6),'Session outputs exceed their PCM budget');

      const material=new Map(), cache={hits:0,misses:0};
      function source(lane,take) {
        const address=lane+'/'+take;
        if (material.has(address)) return material.get(address);
        const value=prepareSource(plan,lane,take);
        if (!value) return null;
        const key=value.key ?? value.keys.at(-1);
        if (store.takes.get(key)) cache.hits++;
        else {
          cache.misses++;
          store.takes.set(key,true,64);
        }
        material.set(address,{lane,...value});
        return material.get(address);
      }

      // Merge the warm-up with the first pass when no take changes at the
      // boundary. A straight seek then shares the print's exact block keys.
      const spans=[];
      for (const row of segments) {
        const prior=spans.at(-1);
        if (prior && prior.to===row.from && prior.choices===row.choices) prior.to=row.to;
        else spans.push({...row});
      }
      if (sourceEnd<frames) spans.push({from:sourceEnd,to:frames,choices:[],tail:true});
      const blocks=Array.from({length:rounded(frames)},()=>[]);
      let cursor=0;
      for (const span of spans) {
        const choices=Object.fromEntries(lanes.map(name=>[name,span.choices.filter(row=>row.lane===name)]));
        for (let from=span.from;from<span.to;) {
          const index=Math.floor(cursor/blockFrames), scoreBlock=Math.floor(from/blockFrames);
          const size=Math.min(span.to-from,(index+1)*blockFrames-cursor,(scoreBlock+1)*blockFrames-from);
          const to=from+size;
          const inputs=[];
          if (!span.tail) for (const lane of lanes) {
            const initial=plan.audio.get(lane)?.take ?? reference, ranges=choices[lane];
            const rows=ranges.filter(row=>row.from<to && row.to>from);
            let edge=from;
            const add=(begin,end,pick)=>{
              if (end<=begin) return true;
              const a=source(lane,pick?.take ?? initial);
              if (!a) return false;
              const alternate=pick?.fadeFrom ?? initial;
              const b=pick?.fadeSamples && pick.take!==alternate ? source(lane,alternate) : null;
              if (pick?.fadeSamples && pick.take!==alternate && !b) return false;
              inputs.push({lane,begin,end,pick,a,b});
              return true;
            };
            for (const row of rows) {
              const begin=Math.max(from,row.from), end=Math.min(to,row.to);
              if (!add(edge,begin) || !add(begin,end,row)) return null;
              edge=end;
            }
            if (!add(edge,to)) return null;
          }
          blocks[index].push({from,to,cursor,scoreBlock,inputs});
          cursor+=size;
          from=to;
        }
      }
      const dependency=(source,index)=>source ? source.keys?.[index] ?? source.key : null;
      const strips=Object.fromEntries(Object.entries(mixer.strips).map(([name,{fader,pan,sends={},...strip}])=>
        [name,{...strip,sends:Object.fromEntries(Object.entries(sends).map(([bus,{level,...route}])=>[bus,route]))}]));
      const controls=desk.controls;
      let prefix=store.identify(signature(['desk',rate,map,{...mixer,strips},sourceLanes,plan.frames,withSources]));
      const keys=blocks.map(parts=>{
        prefix=store.identify(signature([prefix,parts.map(({from,to,scoreBlock,inputs})=>[from,to,
          controls.map(lane=>controlsInRange(lane,from,to)),inputs.map(({lane,begin,end,pick,a,b})=>[lane,begin,end,dependency(a,scoreBlock),dependency(b,scoreBlock),
            b && [pick.from,pick.to,pick.fadeSamples,pick.fadeFrom!==undefined]])])]));
        return prefix;
      });

      const stats={blockFrames,processedFrames:0,resumedFrom:null,outputBlockHits:0};
      const read=store.sequence(keys,store.mixes,()=>{
        const next=desk ?? createDesk();
        desk=null;
        const feeds=Object.fromEntries(sourceLanes.map(name=>[name,[0,0]]));
        const effects=S.sessionEffects(rate,feeds);
        const nodes=new Map([...material.values()].map(value=>[value,effects.register(value.lane,value)]));
        const outputs=[next.output,...Object.values(next.taps),...(withSources ? sourceLanes.map(name=>feeds[name]) : [])];
        function add(feed,source,block,node,i,weight) {
          if (!weight) return;
          const l=block.dry[2*i]*weight, r=block.dry[2*i+1]*weight;
          feed[0]+=l;
          feed[1]+=r;
          const send=block.roomLevel?.[i] ?? source.send ?? 0;
          const drive=block.echoLevel?.[i] ?? source.echo?.send ?? 0;
          effects.add(node,l,r,send,drive,weight);
        }
        return {
          restore(snapshot){next.restore(snapshot.desk);effects.restore(snapshot.effects);},
          block(index,save) {
            const count=Math.min(blockFrames,frames-index*blockFrames);
            const audio=outputs.map((_,i)=>i<printTaps ? new Float64Array(count*2) : new Float32Array(count*2));
            for (const {from,to,cursor,scoreBlock,inputs} of blocks[index]) {
              const offset=scoreBlock*blockFrames;
              const prepared=inputs.map(row=>({...row,first:row.a.block(scoreBlock),second:row.b?.block(scoreBlock),
                feed:feeds[row.lane],firstNode:nodes.get(row.a),secondNode:nodes.get(row.b)}));
              for (let at=from;at<to;at++) {
                effects.start();
                for (const lane of lanes) feeds[lane][0]=feeds[lane][1]=0;
                const i=at-offset;
                for (const {begin,end,pick,a,b,first,second,feed,firstNode,secondNode} of prepared) {
                  if (at<begin || at>=end) continue;
                  const u=b ? Math.min(1,(at-pick.from)/pick.fadeSamples,
                    pick.fadeFrom===undefined ? (pick.to-1-at)/pick.fadeSamples : 1) : 1;
                  add(feed,a,first,firstNode,i,u);
                  if (b) add(feed,b,second,secondNode,i,1-u);
                }
                const frame=cursor+at-from, loc=(frame-index*blockFrames)*2;
                effects.finish(at,frame);
                next.process(frame,feeds);
                for (let i=0;i<outputs.length;i++) {
                  audio[i][loc]=outputs[i][0]; audio[i][loc+1]=outputs[i][1];
                }
              }
            }
            stats.processedFrames+=count;
            let peak=0;
            for (let channel=0;channel<printTaps;channel++) for (const value of audio[channel])
              peak=Math.max(peak,Math.abs(value));
            check(Number.isFinite(peak),'Session mixer produced nonfinite audio');
            store.peaks.set(keys[index],peak,64);
            const state=save ? {desk:next.snapshot(),effects:effects.snapshot()} : undefined;
            return {audio,state};
          }
        };
      },stats);
      const mixerReport=desk.report;
      const output=Array.from({length:outputs},(_,i)=>i<printTaps ?
        new Float64Array((stop-warmup)*2) : new Float32Array((stop-warmup)*2));
      for (let index=Math.floor(warmup/blockFrames);index<rounded(stop);index++) {
        const blockStart=index*blockFrames, from=Math.max(0,warmup-blockStart);
        const to=Math.min(stop-blockStart,blockFrames), {audio}=read(index);
        audio.forEach((data,i)=>output[i].set(data.subarray(from*2,to*2),2*Math.max(0,blockStart-warmup)));
      }
      let peak=0;
      if (printGain) {
        for (let index=0;index<blocks.length;index++) {
          let level=store.peaks.get(keys[index]);
          if (level===undefined) {
            read(index);
            level=store.peaks.get(keys[index]);
          }
          peak=Math.max(peak,level);
        }
      } else for (let channel=0;channel<printTaps;channel++) for (const value of output[channel])
        peak=Math.max(peak,Math.abs(value));
      check(raw || peak<=1 || mixer.peakPolicy!=='error','Mixer output exceeds full scale');
      const headroom=raw ? 1 : 1/Math.max(1,peak);
      if (headroom<1) for (let channel=0;channel<printTaps;channel++) {
        const data=output[channel];
        for (let i=0;i<data.length;i++) data[i]*=headroom;
      }
      return {value:pcm(rate,output[0]),
        taps:Object.fromEntries(trackedTaps.map((name,i)=>[name,pcm(rate,output[i+1])])),
        ...(withSources && {sources:Object.fromEntries(sourceLanes.map((name,i)=>[name,pcm(rate,output[printTaps+i])]))}),
        report:{sampleRate:rate,warmupSamples:warmup,frames:stop-warmup,comp:plan.choices,switches,cache,
          mixer:{...mixerReport,frames:stop,peak,headroom,tailFrames:audition ? 0 : mixerReport.tailFrames},
          renderPath:'incremental',blocks:stats,
          segments:transport.segments.slice(warmup ? 1 : 0).map(({from,to})=>({from,to}))}};
    }
    return Object.assign(render,{prepareSource});
  };
})(KIT.procedural);
