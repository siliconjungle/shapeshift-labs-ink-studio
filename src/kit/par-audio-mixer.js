/* Offline channel strips with compensated output, send and sidechain routing. */
(function (P) {
  const A=P.mediaGraph, S=P.mediaGraphSupport;
  const {fields,record,integer,finite,id,check,db}=P.musicInstruments;
  const taps=['input','pre','post'], sampleBudget=48e6, workBudget=240e6;
  const deliveryRoles=Object.freeze(['dialogue','music','foley','effects','ambience','returns']);
  function named(value,max,label) {
    check(record(value) && Object.keys(value).length<=max && Object.keys(value).every(id),'Invalid mixer '+label);
    return Object.entries(value);
  }
  function compile(source,assets,host,premix,delivery,transport,stream) {
    check(fields(source,['id','sampleRate','map','end','tail','output','strips','processors','taps','peakPolicy','meter']) &&
      id(source.id) && id(source.output) && record(assets) &&
      (source.meter===undefined || typeof source.meter==='boolean') &&
      ['keep','cut'].includes(source.tail ?? 'keep') &&
      ['normalize','error'].includes(source.peakPolicy ?? 'normalize'),'Invalid mixer recipe');
    const rate=source.sampleRate ?? 48000;
    check(integer(rate,8000,96000),'Mixer sample rate must be 8000 to 96000 Hz');
    const timeline=S.mixerTime(rate,source.map), maximum=rate*3600;
    const time=typeof transport==='function' ? transport(timeline) :
      transport ? S.mixerTransport(timeline,transport) : timeline;
    const bounds=source.end===undefined ? null : time.frame(time.position(source.end));
    check(bounds===null || integer(bounds,1,maximum),'Mixer end must be positive and within one hour');
    const audio=new Map(), strips=new Map(), routes=[];
    let assetSamples=0, clipCount=0, sourceEnd=0;
    function asset(name) {
      const bus=premix?.get(name);
      check(id(name) && (bus || Object.hasOwn(assets,name)),'Unknown mixer audio source '+name);
      if (!audio.has(name)) {
        // Internal bus sums can sit above unity until their inserts and fader.
        if (bus) check(bus instanceof Float32Array && bus.length%2===0 && bus.every(Number.isFinite),'Invalid mixer bus input');
        const pcm=bus ? {samples:bus,channels:2,sampleRate:rate} : A.audio(assets[name]);
        assetSamples+=pcm.samples.length;
        check(pcm.channels<=2 && assetSamples<=32e6,'Mixer input exceeds its mono/stereo PCM budget');
        audio.set(name,pcm);
      }
      return audio.get(name);
    }
    const processors=new Map(named(source.processors ?? {},64,'processors').map(([key,row])=>
      [key,S.mixerProcessor(row,rate,time,asset,host)]));
    function clip(raw) {
      check(fields(raw,['id','source','at','fromSample','toSample','gainDb']) && id(raw.id),
        'Mixer clip needs an ID and an audio source');
      const pcm=asset(raw.source), frames=pcm.samples.length/pcm.channels;
      const {fromSample=0,toSample=frames}=raw, step=pcm.sampleRate/rate;
      check(integer(fromSample,0,frames-1) && integer(toSample,fromSample+1,frames) &&
        finite(step,1/128,16),'Invalid clip source sample range or resampling ratio');
      const at=time.position(raw.at ?? {samples:0}), start=time.frame(at);
      const end=Math.min(bounds ?? Infinity,start+Math.ceil((toSample-fromSample)/step));
      check(integer(start,0,maximum) && integer(end,0,maximum) && ++clipCount<=2048,'Mixer clip exceeds the timeline or clip budget');
      if (end>start) sourceEnd=Math.max(sourceEnd,end);
      return {id:raw.id,source:raw.source,start,end,fromSample,toSample,step,
        reader:S.pcmReader(pcm,fromSample,toSample,step),
        gain:time.lane(raw.gainDb,0,-96,24,'clip gain in dB',at)};
    }
    function insert(raw) {
      const row=typeof raw==='string' ? {processor:raw} : raw;
      const processor=processors.get(row?.processor), key=row?.sidechain;
      check(fields(row,['processor','sidechain']) && processor &&
        (key===undefined || processor.sidechain && fields(key,['strip','tap']) && id(key.strip) &&
          taps.includes(key.tap ?? 'post')),'Invalid mixer insert or sidechain assignment');
      return {id:row.processor,processor,key:key && {strip:key.strip,tap:key.tap ?? 'post'}};
    }
    for (const [name,raw] of named(source.strips,48,'strips')) {
      check(fields(raw,['clips','inserts','fader','pan','sends','output']) &&
        (raw.output===undefined || raw.output===null || id(raw.output)) &&
        (name!==source.output || raw.output==null && Object.keys(raw.sends ?? {}).length===0),
      'Invalid strip or outgoing route on mixer output');
      const {clips=[],inserts=[],output=name===source.output ? null : source.output}=raw;
      check(Array.isArray(clips) && clips.length<=512 && Array.isArray(inserts) && inserts.length<=12,
        'A mixer strip exceeds its clip or insert count');
      if (output!==null) routes.push({from:name,to:output,tap:'post',kind:'output',level:time.lane(1,1,0,2,'output')});
      for (const [to,send] of named(raw.sends ?? {},16,'sends')) {
        check(fields(send,['tap','level']) && ['pre','post'].includes(send.tap ?? 'post'),'Invalid mixer send');
        routes.push({from:name,to,tap:send.tap ?? 'post',kind:'send',level:time.lane(send.level,1,0,2,'send level')});
      }
      const placed=Array.from(clips,clip);
      check(new Set(placed.map(row=>row.id)).size===placed.length,'Clip IDs must be unique on a strip');
      const row={name,clips:placed,inserts:Array.from(inserts,insert),routes:[],uses:new Set(),
        fader:time.lane(raw.fader,1,0,4,'fader'),pan:time.lane(raw.pan,0,-1,1,'pan')};
      strips.set(name,row);
    }
    check(strips.has(source.output),'Mixer output strip is missing');
    if (delivery) for (const [name,role] of named(delivery,48,'delivery roles'))
      check(strips.has(name) && deliveryRoles.includes(role),'Invalid delivery role for strip '+name);
    function tap(spec) {
      const strip=strips.get(spec.strip);
      check(strip,'Unknown mixer strip '+spec.strip);
      strip.uses.add(spec.tap);
      return strip;
    }
    const exports=named(source.taps ?? {},20,'export taps').map(([name,row])=>{
      check(fields(row,['strip','tap']) && id(row.strip) && taps.includes(row.tap ?? 'post'),'Invalid mixer export tap');
      const spec={strip:row.strip,tap:row.tap ?? 'post'};
      tap(spec);
      return [name,spec];
    });
    const master=tap({strip:source.output,tap:'post'});
    for (const route of routes) {
      const target=strips.get(route.to);
      check(target,'Unknown mixer route target '+route.to);
      tap({strip:route.from,tap:route.tap});
      target.routes.push(route);
    }
    for (const row of strips.values()) for (const insert of row.inserts) if (insert.key) tap(insert.key);
    const order=[], pending=new Set(), ready=new Set(), timing=(strip,key)=>strips.get(strip).timing[key];
    function plan(row) {
      if (ready.has(row.name)) return;
      check(!pending.has(row.name),'Mixer routing or sidechain cycle at '+row.name);
      pending.add(row.name);
      for (const edge of row.routes) plan(strips.get(edge.from));
      for (const {key} of row.inserts) if (key) plan(strips.get(key.strip));
      const feeds=row.routes.map(edge=>timing(edge.from,edge.tap));
      const arrival=Math.max(0,...feeds.map(feed=>feed.latency));
      const clipsEnd=stream?.[row.name] ?? Math.max(0,...row.clips.map(clip=>clip.end>clip.start ? clip.end : 0));
      row.timing={input:{latency:arrival,end:Math.max(clipsEnd,...feeds.map(feed=>feed.end))}};
      let next=row.timing.input;
      for (const insert of row.inserts) {
        const key=insert.key && timing(insert.key.strip,insert.key.tap);
        const aligned=Math.max(next.latency,key?.latency ?? 0);
        insert.mainDelay=aligned-next.latency;
        insert.keyDelay=key ? aligned-key.latency : 0;
        insert.aligned=aligned;
        insert.latency=aligned+insert.processor.latency;
        const {planEnd,tail}=insert.processor;
        insert.end=next.end ? (planEnd ? planEnd(next.end) : next.end+tail) : 0;
        next=insert;
      }
      row.timing.pre=row.timing.post=next;
      pending.delete(row.name);
      ready.add(row.name);
      order.push(row);
    }
    for (const row of strips.values()) plan(row);
    sourceEnd=bounds ?? sourceEnd;
    const frames=source.tail==='cut' ? Math.max(1,sourceEnd) : Math.max(1,sourceEnd,master.timing.post.end,
      ...exports.map(([,row])=>timing(row.strip,row.tap).end));
    if (stream) {
      check(integer(frames,1,maximum) && frames*2<=sampleBudget,'Session mixer exceeds its frame budget');
      return {rate,sourceEnd,frames,order,routes,master,exports};
    }
    let memory=frames*2*(exports.length+1+(delivery ? deliveryRoles.length+1 : 0)), work=memory;
    for (const row of order) {
      // The last stage can take ownership when no reader needs its input or
      // pre-fader contents. Delivery still needs the unmodified master input.
      row.reusePost=!row.uses.has('input') && !row.uses.has('pre') && !(delivery && row===master);
      for (const [name,stage] of [...Object.entries(row.timing),...row.inserts.map(x=>['insert',x])]) {
        const count=stage.end ? Math.min(frames,stage.end)+stage.latency : 0;
        if (name==='input' || name==='insert' || name==='post' && row.uses.has('post') && !row.reusePost) memory+=2*count;
        memory+=count*(stage.processor?.extra ?? 0);
        work+=count*(stage.processor?.cost ?? 3);
      }
      for (const clip of row.clips) work+=Math.max(0,Math.min(frames,clip.end)-clip.start)*clip.reader.cost;
      work+=row.routes.length*Math.min(frames,row.timing.input.end)*2;
    }
    check(integer(frames,1,maximum) && memory<=sampleBudget && work<=workBudget,
      'Mixer exceeds its frame, PCM or processing budget');
    return {rate,sourceEnd,frames,order,routes,master,exports};
  }
  const read=(data,index)=>data[index] ?? 0;
  function render(source,assets,host,premix,delivery,transport) {
    const {rate,sourceEnd,frames,order,routes,master,exports}=compile(source,assets,host,premix,delivery,transport);
    const buffers=new Map();
    const stems=delivery && Object.fromEntries(deliveryRoles.map(role=>[role,new Float64Array(frames*2)]));
    let premaster;
    const roleOf=name=>Object.hasOwn(delivery,name) ? delivery[name] : deliveryRoles.includes(name) ? name : 'returns';
    const buffer=(name,tap)=>buffers.get(name)[tap];
    const allocate=({latency,end})=>new Float64Array(end ? 2*(Math.min(end,frames)+latency) : 0);
    for (const row of order) {
      const input=allocate(row.timing.input), arrival=row.timing.input.latency;
      const sample=[0,0], separate=stems && row===master;
      for (const clip of row.clips) {
        const gain=clip.gain.reader();
        for (let i=clip.start;i<Math.min(clip.end,frames);i++) {
          clip.reader.read(clip.fromSample+(i-clip.start)*clip.step,sample);
          const j=2*(i+arrival), scale=db(gain(i));
          const l=sample[0]*scale,r=sample[1]*scale;
          input[j]+=l; input[j+1]+=r;
          if (separate) {stems.returns[i*2]+=l;stems.returns[i*2+1]+=r;}
        }
      }
      for (const edge of row.routes) {
        const {samples,latency}=buffer(edge.from,edge.tap), gain=edge.level.reader();
        const stem=separate ? stems[roleOf(edge.from)] : null;
        for (let i=0;i<Math.min(samples.length/2-latency,frames);i++) {
          const dest=2*(i+arrival), from=2*(i+latency), level=gain(i);
          const l=samples[from]*level,r=samples[from+1]*level;
          input[dest]+=l; input[dest+1]+=r;
          if (stem) {stem[i*2]+=l;stem[i*2+1]+=r;}
        }
      }
      if (separate) premaster={samples:input,latency:arrival};
      let processed=input;
      for (const insert of row.inserts) {
        const next=allocate(insert), {processor}=insert;
        if (processor.block) {
          const input=processed.subarray(2*(insert.aligned-insert.mainDelay)), out=next.subarray(2*insert.latency);
          const feed=insert.key && buffer(insert.key.strip,insert.key.tap);
          const key=feed ? feed.samples.subarray(2*feed.latency) : undefined;
          if (out.length) insert.details=processor.block(input,out,key);
          if (processor.wet.min<1) {
            const wet=processor.wet.reader();
            for (let at=0;at<out.length;at+=2) {
              const blend=wet(at/2), l=read(input,at), r=read(input,at+1);
              out[at]=l+(out[at]-l)*blend; out[at+1]=r+(out[at+1]-r)*blend;
            }
          }
          processed=next;
          continue;
        }
        const key=insert.key ? buffer(insert.key.strip,insert.key.tap).samples : processed;
        const process=processor.make(), wet=processor.wet.reader(), out=[0,0];
        for (let at=insert.aligned;at<next.length/2;at++) {
          const dryAt=2*(at-insert.mainDelay-processor.latency), keyAt=2*(at-(insert.key ? insert.keyDelay : insert.mainDelay));
          const l=read(processed,dryAt), r=read(processed,dryAt+1), score=at-insert.latency, amount=wet(score);
          process(l,r,read(key,keyAt),read(key,keyAt+1),score,out);
          next[2*at]=l+(out[0]-l)*amount;
          next[2*at+1]=r+(out[1]-r)*amount;
        }
        processed=next;
      }
      const slot={};
      if (row.uses.has('input')) slot.input={samples:input,latency:arrival};
      if (row.uses.has('pre')) slot.pre={samples:processed,latency:row.timing.pre.latency};
      if (row.uses.has('post')) {
        const post=row.reusePost ? processed : allocate(row.timing.post), {latency}=row.timing.post;
        const fader=row.fader.reader(), pan=row.pan.reader();
        for (let at=latency;at<post.length/2;at++) {
          const t=at-latency, gain=fader(t), balance=pan(t);
          post[2*at]=processed[2*at]*gain*Math.sqrt(1-balance);
          post[2*at+1]=processed[2*at+1]*gain*Math.sqrt(1+balance);
        }
        slot.post={samples:post,latency};
      }
      buffers.set(row.name,slot);
    }
    function print({samples,latency}) {
      const result=new Float64Array(frames*2);
      result.set(samples.subarray(latency*2,(latency+frames)*2));
      return {samples:result,sampleRate:rate,channels:2};
    }
    const value=print(buffer(master.name,'post'));
    const printed=Object.fromEntries(exports.map(([name,spec])=>[name,print(buffer(spec.strip,spec.tap))]));
    let peak=0;
    for (const {samples} of [value,...Object.values(printed)]) for (const x of samples) {
      check(Number.isFinite(x),'Mixer produced nonfinite audio');
      peak=Math.max(peak,Math.abs(x));
    }
    check(peak<=1 || source.peakPolicy!=='error','Mixer output exceeds full scale');
    const headroom=1/Math.max(1,peak);
    if (headroom<1) for (const {samples} of [value,...Object.values(printed)]) {
      for (let i=0;i<samples.length;i++) samples[i]*=headroom;
    }
    const planned=new Map(order.map(row=>[row.name,row.timing]));
    const report={id:source.id,sampleRate:rate,frames,sourceEnd,tailFrames:Math.max(0,frames-sourceEnd),
      latencySamples:master.timing.post.latency,peak,headroom,
      routes:routes.map(({from,to,tap,kind})=>({from,to,tap,kind,
        compensation:planned.get(to).input.latency-planned.get(from)[tap].latency})),
      strips:Object.fromEntries(order.map(row=>[row.name,{
        inputLatency:row.timing.input.latency,latency:row.timing.post.latency,
        inputEnd:row.timing.input.end,end:row.timing.post.end,
        clips:row.clips.filter(clip=>clip.end>clip.start).map(({id,source,start,end})=>({id,source,start,end})),
        inserts:row.inserts.map(({id,processor,mainDelay,key,keyDelay,latency,details})=>({id,type:processor.type,
          latency:processor.latency,tail:processor.tail,outputLatency:latency,mainDelay,
          ...(details && {details}),
          ...(key && {sidechain:{...key,compensation:keyDelay}})}))
      }]))};
    if (source.meter) report.meter=A.mixerMonitor.meter(value);
    return {value,taps:printed,report,...(stems && {premaster:print(premaster),stems})};
  }
  A.mixer=Object.freeze({render:(source,assets,host)=>render(source,assets,host),
    renderPremix:(source,assets,buses)=>render(source,assets,undefined,buses),
    renderForDelivery:(source,assets,roles={},buses)=>render(source,assets,undefined,buses,roles),
    deliveryRoles});
  S.renderMixerTransport=(source,assets,ranges,host)=>render(source,assets,host,undefined,undefined,ranges);
  S.prepareSessionMixer=(source,assets,clock,stream,host)=>{
    const spec=stream ? source : {...source,end:{samples:1},tail:'cut'};
    const {order,master,exports,routes,frames,sourceEnd}=compile(spec,assets,
      host,undefined,undefined,()=>clock,stream);
    const states=new Map(), scratch=[0,0];
    const read=(name,tap)=>states.get(name)[tap];
    const strips=order.map(row=>{
      check(!row.clips.length,'Live session desk receives its clips from the transport');
      const input=[0,0],pre=[0,0],post=[0,0];
      states.set(row.name,{input,pre,post});
      const routes=row.routes.map(edge=>({samples:read(edge.from,edge.tap),level:edge.level.reader()}));
      const inserts=row.inserts.flatMap(({id,processor,key})=>{
        if (processor.wet.max===0) return [];
        if (stream && (!processor.make || processor.latency!==0)) return [null];
        check(processor.make && processor.latency===0,'Insert '+id+' ('+processor.type+
          ') needs offline rendering. Use a causal, zero-lookahead insert or bypass it for live playback.');
        return [{process:processor.make(),wet:processor.wet.reader(),key:key && read(key.strip,key.tap)}];
      });
      return {name:row.name,input,pre,post,routes,inserts,fader:row.fader.reader(),pan:row.pan.reader(),
        inputEnd:row.timing.input.end,end:row.timing.post.end};
    });
    const processes=strips.flatMap(row=>row.inserts.map(insert=>insert?.process));
    if (stream && processes.some(process=>!process?.snapshot || !process.restore)) return null;
    const report={id:source.id,sampleRate:spec.sampleRate,frames,sourceEnd,tailFrames:frames-sourceEnd,latencySamples:0,
      routes:routes.map(({from,to,tap,kind})=>({from,to,tap,kind,compensation:0})),
      strips:Object.fromEntries(order.map(row=>[row.name,{
        inputLatency:0,latency:0,inputEnd:row.timing.input.end,end:row.timing.post.end,clips:[],
        inserts:row.inserts.map(({id,processor,key})=>({id,type:processor.type,latency:processor.latency,
          tail:processor.tail,outputLatency:processor.latency,mainDelay:0,
          ...(key && {sidechain:{...key,compensation:0}})}))
      }]))};
    const controls=order.flatMap(({fader,pan,routes})=>[fader,pan,...routes.filter(edge=>edge.kind==='send').map(edge=>edge.level)]);
    return {report,controls,
      snapshot:()=>processes.map(process=>process.snapshot()),
      restore:states=>processes.forEach((process,i)=>process.restore(states[i])),
      output:read(master.name,'post'),taps:Object.fromEntries(exports.map(([name,row])=>[name,read(row.strip,row.tap)])),
      process(frame,feeds) {
        for (const {name,input,pre,post,routes,inserts,fader,pan,inputEnd,end} of strips) {
          if (stream && frame>=end) {
            input[0]=input[1]=pre[0]=pre[1]=post[0]=post[1]=0;
            continue;
          }
          const feed=feeds[name];
          let l=feed?.[0] ?? 0, r=feed?.[1] ?? 0;
          for (const route of routes) {
            const gain=route.level(frame);
            l+=route.samples[0]*gain;r+=route.samples[1]*gain;
          }
          input[0]=l; input[1]=r;
          if (stream && frame>=inputEnd) input[0]=input[1]=l=r=0;
          for (const insert of inserts) {
            const amount=insert.wet(frame);
            insert.process(l,r,insert.key?.[0] ?? l,insert.key?.[1] ?? r,frame,scratch);
            l+=(scratch[0]-l)*amount;r+=(scratch[1]-r)*amount;
          }
          pre[0]=l;pre[1]=r;
          const gain=fader(frame), balance=pan(frame);
          post[0]=l*gain*Math.sqrt(1-balance);post[1]=r*gain*Math.sqrt(1+balance);
        }
      }};
  };
})(KIT.procedural);
