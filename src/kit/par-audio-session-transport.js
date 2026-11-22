/* Pull prepared takes through one live desk and keep the effects on the device clock. */
(function (P) {
  const S=P.mediaGraphSupport;
  const {fields,finite,integer,id,check}=P.musicInstruments;
  const {addressing,signature,samples}=S.musicSessionModel;
  const {blockFrames}=S.sessionBlocks;
  const bounded=value=>Math.max(-1,Math.min(1,value));
  const clockKey=plan=>signature([plan.rate,plan.map,plan.frames,plan.lanes,plan.mixer]);

  function timeline(prepared) {
    const {rate,map,frames,pins,media}=prepared;
    return addressing(rate,map,frames,pins,lane=>{
      const row=Object.hasOwn(media,lane) ? media[lane] : null;
      return row && {fallback:row.fallback,has:take=>Object.hasOwn(row.materials,take),
        pitches:take=>row.materials[take].pitches};
    });
  }

  S.openSessionTransport=function openSessionTransport(initial,options={},editor) {
    check(fields(options,['from','to','at','preroll','gain','fadeSamples']) &&
      typeof (options.preroll ?? true)==='boolean' && finite(options.gain ?? 1,0,2),
    'Invalid live session settings');
    let plan=initial, time=timeline(plan);
    const {rate}=plan, key=clockKey(plan), gain=options.gain ?? 1;
    const defaultFade=options.fadeSamples ?? Math.round(.012*rate);
    check(integer(defaultFade,0,rate/2),'A take fade needs up to half a second');
    let loop=time.range(options.from ?? samples(0),options.to ?? samples(plan.frames));
    let position=options.at===undefined ? loop.from : time.at(options.at);
    check(integer(position,loop.from,loop.to-1),'Starting playhead is outside the loop');
    const clock=S.sessionMixerTime(rate,plan.map), desk=S.prepareSessionMixer(plan.mixer,editor.assets,clock);
    const feeds=Object.fromEntries(plan.sourceLanes.map(name=>[name,[0,0]]));
    const effects=S.sessionEffects(rate,feeds);
    let runFrame=0, frame=0, pass=0, clippedFrames=0;
    let lanes, cache, monitor=null, revision=0;

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

    function read(lane,dest,index,weight,at) {
      if (!weight) return;
      const take=lane.materials[index];
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

    function step(at) {
      effects.start();
      for (const name of plan.lanes) {
        const lane=lanes[name], dest=feeds[name];
        dest[0]=dest[1]=0;
        if (at<lane.previous) lane.index=0;
        lane.previous=at;
        while (lane.choices[lane.index]?.to<=at) lane.index++;
        const row=lane.choices[lane.index], weights=readWeights(lane,frame);
        const base=weights[0];
        if (base) {
          if (!row || at<row.from) read(lane,dest,lane.fallback,base,at);
          else {
            const u=row.fadeSamples ? Math.min(1,(at-row.from)/row.fadeSamples,(row.to-1-at)/row.fadeSamples) : 1;
            read(lane,dest,row.index,base*u,at);
            read(lane,dest,lane.fallback,base*(1-u),at);
          }
        }
        for (let i=1;i<weights.length;i++) read(lane,dest,i-1,weights[i],at);
      }
      effects.finish(at,runFrame);
      desk.process(runFrame++,feeds);
    }

    prepare(plan);
    if (options.preroll!==false) for (let at=0;at<position;at++) step(at);
    clock.begin(runFrame,position,loop);
    const warmup=runFrame;

    const state=()=>({id:plan.session.id,sampleRate:rate,frames:plan.frames,revision,frame,scoreSample:position,pass,
      loop:{...loop},warmupSamples:warmup,clippedFrames,monitor,cache:{...cache},comp:plan.choices.map(row=>({...row})),
      lanes:Object.fromEntries(plan.lanes.map(name=>[name,{take:lanes[name].selected,takes:lanes[name].names.slice()}]))});
    function pull(frames,options={}) {
      check(integer(frames,1,16384) && fields(options,['taps']) &&
        typeof (options.taps ?? false)==='boolean','Live pull needs 1 to 16384 frames');
      const start={frame,scoreSample:position,pass,loop:{...loop}};
      const out=new Float32Array(frames*2);
      const taps=options.taps ? Object.fromEntries(Object.keys(desk.taps).map(key=>[key,new Float32Array(frames*2)])) : {};
      const outputs=Object.entries(taps).map(([name,pcm])=>({pcm,source:desk.taps[name]}));
      for (let i=0;i<frames;i++) {
        step(position);
        const source=monitor ? desk.taps[monitor.tap] : desk.output;
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
      if (lane.selected!==take) {
        const weights=readWeights(lane,frame).slice();
        lane.selected=take;
        lane.target=lane.names.indexOf(take)+1;
        lane.transition=fadeSamples ? {start:frame,end:frame+fadeSamples,weights} : null;
      }
      return {frame,scoreSample:position,pass,lane:command.lane,take};
    }
    function setLoop(range) {
      check(fields(range,['from','to']),'Choose new loop bounds');
      const next=time.range(range.from,range.to);
      for (const [lane,control] of Object.entries(lanes)) if (control.selected!==null)
        time.choice({lane,take:control.selected,from:samples(next.from),to:samples(next.to)});
      if (next.from===loop.from && next.to===loop.to) return state();
      if (position<next.from || position>=next.to) position=next.from;
      loop=next;
      pass=0;
      clock.begin(runFrame,position,loop);
      return state();
    }
    function applyPrepared(prepared) {
      const next=editor.materialize(prepared);
      const nextTime=timeline(next);
      check(clockKey(next)===key,'Reopen the live transport after changing its tracks, clock or mixer');
      for (const [lane,control] of Object.entries(lanes)) if (control.selected!==null)
        nextTime.choice({lane,take:control.selected,from:samples(loop.from),to:samples(loop.to)});
      prepare(next);
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
      monitor=selection===null ? null : S.sessionMonitor(selection,desk.taps);
      return state();
    }
    return Object.freeze({pull,state,switchTake,setLoop,setMonitor,edit,keep:command=>edit([keepEdit(command)]),
      keepEdit,applyPrepared,inspect:()=>plan.report,document:()=>P.data.freeze(plan.session)});
  };
})(KIT.procedural);
