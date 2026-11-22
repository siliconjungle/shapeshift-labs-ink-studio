/* Pull prepared takes through one live desk and keep the effects on the device clock. */
(function (P) {
  const S=P.mediaGraphSupport;
  const {fields,finite,integer,id,check}=P.musicInstruments;
  const {addressing,signature,samples}=S.musicSessionModel;
  const {blockFrames}=S.sessionBlocks;
  const bounded=value=>Math.max(-1,Math.min(1,value));
  const clockKey=plan=>signature([plan.rate,plan.map,plan.lanes,plan.session.mixer,
    Object.entries(plan.session.automation ?? {}).map(([name,row])=>[name,row.target])]);

  function timeline(prepared) {
    const {rate,map,frames,pins,media}=prepared;
    return addressing(rate,map,frames,pins,lane=>{
      const row=Object.hasOwn(media,lane) ? media[lane] : null;
      return row && {fallback:row.fallback,has:take=>Object.hasOwn(row.materials,take),
        pitches:take=>row.materials[take].pitches};
    });
  }

  S.openSessionTransport=function openSessionTransport(initial,options={},editor) {
    check(fields(options,['from','to','at','preroll','gain','fadeSamples','leadInSamples','monitor']) &&
      typeof (options.preroll ?? true)==='boolean' && finite(options.gain ?? 1,0,2),
    'Invalid live session settings');
    let plan=initial, time=timeline(plan);
    const {rate}=plan, gain=options.gain ?? 1;
    const defaultFade=options.fadeSamples ?? Math.round(.012*rate);
    check(integer(defaultFade,0,rate/2),'A take fade needs up to half a second');
    let loop=time.range(options.from ?? samples(0),options.to ?? samples(plan.frames));
    function leadIn(loop,count=0) {
      check(integer(count,0,plan.frames),'Choose a nonnegative lead-in in samples');
      return Math.max(0,loop.from-count);
    }
    const first=leadIn(loop,options.leadInSamples);
    let position=options.at===undefined ? first : time.at(options.at);
    check(integer(position,first,loop.to-1),'Starting playhead is outside the loop and lead-in');
    const feeds=Object.fromEntries(plan.sourceLanes.map(name=>[name,[0,0]]));
    let clock, desk, effects, warmup, lanes, cache, revision=0;
    let sound=null, soundFade=null;
    let runFrame=0, frame=0, pass=0, clippedFrames=0, monitor=null;
    function reset(next,at,preroll,selection=monitor) {
      clock=S.sessionMixerTime(rate,next.map);
      desk=S.prepareSessionMixer(next.mixer,editor.assets,clock,undefined,editor.host);
      monitor=selection===null ? null : S.sessionMonitor(selection,desk.taps,next.lanes);
      effects=S.sessionEffects(rate,feeds);
      lanes=undefined;
      sound=soundFade=null;
      runFrame=0;
      prepare(next);
      if (preroll) for (let sample=0;sample<at;sample++) step(sample);
      warmup=runFrame;
      clock.begin(runFrame,at,loop);
    }

    function prepare(next) {
      const nextLanes=effects.prepare(()=>Object.fromEntries(next.lanes.map(name=>{
        const lane=next.media[name], names=Object.keys(lane.materials);
        const materials=names.map(take=>{
          const {value}=lane.materials[take];
          return {...value,effect:effects.register(name,value)};
        });
        const prior=lanes?.[name], fallback=names.indexOf(lane.fallback);
        const choices=next.choices.filter(row=>row.lane===name).map(row=>({...row,index:names.indexOf(row.take)}));
        const control={names,materials,fallback,choices,index:0,previous:-1,target:0,selected:null,transition:null,
          weights:new Float64Array(names.length+1)};
        if (prior) {
          const weights=readWeights(prior,frame);
          const mapped=new Float64Array(names.length+1);
          mapped[0]=weights[0];
          for (const [i,take] of prior.names.entries()) {
            const at=names.indexOf(take);
            mapped[at<0 ? 0 : at+1]+=weights[i+1];
          }
          control.selected=names.includes(prior.selected) ? prior.selected : null;
          control.target=names.indexOf(control.selected)+1;
          if (prior.transition && frame<prior.transition.end)
            control.transition={start:frame,end:prior.transition.end,weights:mapped};
        }
        return [name,control];
      })));
      lanes=nextLanes;
      cache=next.cache;
    }

    function readWeights(lane,at) {
      const {weights,transition,target}=lane;
      if (transition && at<transition.end) {
        const u=(at-transition.start)/(transition.end-transition.start);
        for (let i=0;i<weights.length;i++) weights[i]=transition.weights[i]*(1-u);
        weights[target]+=u;
      } else {
        lane.transition=null;
        weights.fill(0);
        weights[target]=1;
      }
      return weights;
    }

    function read(take,dest,weight,at) {
      if (!weight) return;
      let data=take, indexInBlock=at, offset=2*(at-(take.from ?? 0));
      if (take.block) {
        const block=Math.floor(at/blockFrames);
        if (block!==take.index) {
          take.data=take.block(block);
          take.index=block;
        }
        data=take.data;
        indexInBlock=at-block*blockFrames;
        offset=indexInBlock*2;
      }
      const source=data.dry.samples ?? data.dry, l=(source[offset] ?? 0)*weight, r=(source[offset+1] ?? 0)*weight;
      dest[0]+=l;
      dest[1]+=r;
      const send=data.roomLevel?.[indexInBlock] ?? take.send ?? 0;
      const drive=data.echoLevel?.[indexInBlock] ?? take.echo?.send ?? 0;
      effects.add(take.effect,l,r,send,drive,weight);
    }

    function soundProgress() {
      if (!soundFade) return 1;
      const progress=(frame-soundFade.start)/defaultFade;
      if (progress<1) return progress;
      soundFade=null;
      return 1;
    }

    function setSound(candidate) {
      const source=candidate && effects.prepare(()=>({...candidate,material:{...candidate.material,
        effect:effects.register(candidate.lane,candidate.material)}}));
      const progress=soundProgress(), outgoing=[];
      for (const [row,weight] of soundFade?.outgoing ?? []) {
        const remaining=weight*(1-progress);
        if (remaining) outgoing.push([row,remaining]);
      }
      if (sound && progress) outgoing.push([sound,progress]);
      sound=source;
      soundFade=defaultFade && (outgoing.length || sound) ? {start:frame,outgoing} : null;
      return {frame,scoreSample:position,pass, sound:soundInfo()};
    }

    const soundInfo=()=>sound && {lane:sound.lane,id:sound.id,source:sound.source,from:sound.from,to:sound.to};

    function step(at) {
      effects.start();
      const progress=soundProgress(), outgoing=soundFade?.outgoing;
      for (const name of plan.lanes) {
        const lane=lanes[name], dest=feeds[name];
        dest[0]=dest[1]=0;
        if (at<lane.previous) lane.index=0;
        lane.previous=at;
        while (lane.choices[lane.index]?.to<=at) lane.index++;
        const row=lane.choices[lane.index], weights=readWeights(lane,frame);
        if (monitor?.mode==='mute' && monitor.lane===name) continue;
        let retained=1;
        if (sound?.lane===name && at>=sound.from && at<sound.to) {
          read(sound.material,dest,progress,at);
          retained-=progress;
        }
        if (outgoing) for (const [prior,weight] of outgoing) if (prior.lane===name && at>=prior.from && at<prior.to) {
          const fading=weight*(1-progress);
          read(prior.material,dest,fading,at);
          retained-=fading;
        }
        retained=Math.max(0,retained);
        const base=weights[0]*retained;
        if (base) {
          if (!row || at<row.from) read(lane.materials[lane.fallback],dest,base,at);
          else {
            const u=row.fadeSamples ? Math.min(1,(at-row.from)/row.fadeSamples,(row.to-1-at)/row.fadeSamples) : 1;
            read(lane.materials[row.index],dest,base*u,at);
            read(lane.materials[lane.fallback],dest,base*(1-u),at);
          }
        }
        for (let i=1;i<weights.length;i++) read(lane.materials[i-1],dest,weights[i]*retained,at);
      }
      effects.finish(at,runFrame);
      desk.process(runFrame++,feeds);
    }

    reset(plan,position,options.preroll!==false,options.monitor ?? null);

    const state=()=>({id:plan.session.id,sampleRate:rate,frames:plan.frames,revision,frame,scoreSample:position,pass,
      loop:{...loop},warmupSamples:warmup,clippedFrames,monitor,...(sound && {sound:soundInfo()}),taps:Object.keys(desk.taps),cache:{...cache},comp:plan.choices.map(row=>({...row})),
      lanes:Object.fromEntries(plan.lanes.map(name=>[name,{take:lanes[name].selected,takes:lanes[name].names.slice()}]))});
    function pull(frames,options={}) {
      check(integer(frames,1,16384) && fields(options,['taps']) &&
        typeof (options.taps ?? false)==='boolean','Live pull needs 1 to 16384 frames');
      const start={frame,scoreSample:position,pass,loop:{...loop}};
      const out=new Float32Array(frames*2);
      const taps=options.taps ? Object.fromEntries(Object.keys(desk.taps).map(key=>[key,new Float32Array(frames*2)])) : {};
      const outputs=Object.entries(taps).map(([name,pcm])=>({pcm,source:desk.taps[name]}));
      const source=monitor?.tap ? desk.taps[monitor.tap] : desk.output;
      for (let i=0;i<frames;i++) {
        step(position);
        const subtract=monitor?.mode==='subtract';
        const l=(subtract ? desk.output[0]-source[0] : source[0])*gain;
        const r=(subtract ? desk.output[1]-source[1] : source[1])*gain;
        check(Number.isFinite(l) && Number.isFinite(r),'Live mixer produced nonfinite audio');
        clippedFrames+=Number(Math.max(Math.abs(l),Math.abs(r))>1);
        out[i*2]=bounded(l);out[i*2+1]=bounded(r);
        for (const {pcm,source} of outputs) {
          pcm[i*2]=source[0];pcm[i*2+1]=source[1];
        }
        frame++;
        if (++position===loop.to) {position=loop.from;pass++;}
      }
      const audio=samples=>({sampleRate:rate,channels:2,samples});
      return {value:audio(out),taps:Object.fromEntries(Object.entries(taps).map(([key,pcm])=>[key,audio(pcm)])),
        start,end:{frame,scoreSample:position,pass},clippedFrames};
    }
    function switchTake(command) {
      check(fields(command,['lane','take','fadeSamples']) && id(command.lane) &&
        (command.take===null || id(command.take)) && Object.hasOwn(lanes,command.lane),'Choose a live lane and take');
      const lane=lanes[command.lane], {take,fadeSamples=defaultFade}=command;
      check(integer(fadeSamples,0,rate/2),'A take fade needs up to half a second');
      if (take!==null) time.choice({lane:command.lane,take,from:samples(loop.from),to:samples(loop.to)});
      if (sound?.lane===command.lane) setSound(null);
      if (lane.selected!==take) {
        const weights=readWeights(lane,frame).slice();
        lane.selected=take;
        lane.target=lane.names.indexOf(take)+1;
        lane.transition=fadeSamples ? {start:frame,end:frame+fadeSamples,weights} : null;
      }
      return {frame,scoreSample:position,pass,lane:command.lane,take};
    }
    function setLoop(range) {
      check(fields(range,['from','to','leadInSamples']),'Choose new loop bounds');
      const next=time.range(range.from,range.to), first=leadIn(next,range.leadInSamples);
      if (range.leadInSamples!==undefined) {
        const auditions=Object.entries(lanes).filter(([,lane])=>lane.selected!==null);
        for (const [lane,control] of auditions)
          time.choice({lane,take:control.selected,from:samples(next.from),to:samples(next.to)});
        loop=next;
        position=first;
        pass=0;
        reset(plan,position,true);
        for (const [lane,control] of auditions) switchTake({lane,take:control.selected,fadeSamples:0});
        return state();
      }
      for (const [lane,control] of Object.entries(lanes)) if (control.selected!==null)
        time.choice({lane,take:control.selected,from:samples(next.from),to:samples(next.to)});
      if (next.from===loop.from && next.to===loop.to) return state();
      if (sound) setSound(null);
      if (position<next.from || position>=next.to) position=next.from;
      loop=next;
      pass=0;
      clock.begin(runFrame,position,loop);
      return state();
    }
    function applyPrepared(prepared) {
      const next=editor.materialize(prepared);
      const nextTime=timeline(next);
      const added=next.lanes.slice(plan.lanes.length);
      const appended=added.length>0 && plan.lanes.every((name,index)=>name===next.lanes[index]) &&
        added.every(name=>Object.hasOwn(next.session.audio ?? {},name) &&
          !Object.hasOwn(plan.mixer.strips,name) && !Object.keys(next.mixer.strips[name]).length);
      check(clockKey(appended ? {...next,lanes:plan.lanes} : next)===clockKey(plan),
        'Reopen the live transport after changing its tracks, clock or mixer routing');
      let revised;
      if (signature(next.mixer)!==signature(plan.mixer)) {
        revised=S.prepareSessionMixer(next.mixer,editor.assets,clock,undefined,editor.host);
        const order=report=>Object.keys(report.strips).filter(name=>report.strips[name].inserts.length);
        check(signature(order(desk.report))===signature(order(revised.report)),'Reopen the live desk after changing insert order');
        revised.restore(desk.snapshot());
      }
      const resized={from:Math.min(loop.from,next.frames-1),
        to:loop.to===plan.frames ? next.frames : Math.min(loop.to,next.frames)};
      for (const [lane,control] of Object.entries(lanes)) if (control.selected!==null)
        nextTime.choice({lane,take:control.selected,from:samples(resized.from),to:samples(resized.to)});
      for (const name of added) feeds[name]=[0,0];
      prepare(next);
      if (sound) setSound(null);
      if (resized.from!==loop.from || resized.to!==loop.to) {
        loop=resized;
        if (position>=loop.to) position=loop.from;
        clock.begin(runFrame,position,loop);
      }
      if (revised) desk=revised;
      plan=next;
      time=nextTime;
      revision++;
      return state();
    }
    const edit=changes=>applyPrepared(editor.prepareLive(editor.edit(plan.session,changes)));
    function keepEdit(command) {
      check(fields(command,['lane','take','from','to','fadeSamples']) && Object.hasOwn(lanes,command.lane),
        'Keep needs a lane and an editable score range');
      const take=command.take ?? lanes[command.lane].selected;
      check(id(take),'Switch to a take or name one to keep');
      return {op:'comp',lane:command.lane,take,from:command.from ?? samples(loop.from),
        to:command.to ?? samples(loop.to),fadeSamples:command.fadeSamples ?? 0};
    }
    function setMonitor(selection) {
      monitor=selection===null ? null : S.sessionMonitor(selection,desk.taps,plan.lanes);
      return state();
    }
    return Object.freeze({pull,state,switchTake,setSound,setLoop,setMonitor,edit,keep:command=>edit([keepEdit(command)]),
      keepEdit,applyPrepared,inspect:()=>plan.report,
      trace:preview=>editor.trace(plan.session,preview),document:()=>P.data.freeze(plan.session)});
  };
})(KIT.procedural);
