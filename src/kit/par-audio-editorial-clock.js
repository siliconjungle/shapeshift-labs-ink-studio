/* Resolve edit targets without rounding between picture, simulation and musical clocks. */
(function (K) {
  const P=K.procedural,T=P.takeTime,S=P.mediaGraphSupport,{id,integer,fields,record,check}=P.musicInstruments;
  const eventId=value=>typeof value==='string' && /^[a-z0-9][a-z0-9._:/-]{0,95}$/i.test(value);
  function editorialClock({picture,world,map,sampleRate,clockMap}) {
    check(fields(picture,['fps','shots','startFrame']) && integer(picture.startFrame ?? 0,0,1000000000) && Array.isArray(picture.shots) &&
      integer(picture.shots.length,1,2048),'Editorial needs a picture rate and a shot list');
    const fps=T.read(picture.fps), take=T.create({fps:picture.fps,sampleRate}), shots=new Map();
    let frames=0;
    for (const shot of picture.shots) {
      check(fields(shot,['id','frames','inFrame']) && id(shot.id) && !shots.has(shot.id) &&
        integer(shot.frames,1,1000000) && integer(shot.inFrame ?? 0,0,1000000000),
      'Picture needs unique shot IDs and bounded source frame ranges');
      shots.set(shot.id,{start:frames,frames:shot.frames,inFrame:shot.inFrame ?? 0});
      frames+=shot.frames;
    }
    check(frames<=10000000,'Picture exceeds its frame budget');
    const startFrame=picture.startFrame ?? 0, first=take.at(startFrame).firstSample;
    const origin=T.position(take,{frame:startFrame});
    const end=take.at(startFrame+frames).firstSample-first;
    check(end>0,'Picture needs at least one audio sample');
    const musical=P.musicTiming.compile(map), mixer=S.mixerTime(sampleRate,map), events=new Map();
    const mapping=clockMap===undefined?undefined:K.world.clockMapping.read(clockMap);
    if(mapping)check(T.compare(T.read(clockMap.clock.fps??24),fps)===0&&mapping.clock.at(0).sampleRate===sampleRate,
      'Editorial clock map needs the same picture and sample rates');
    let simulationRate;
    if (world!==undefined) {
      check(fields(world,['events','simulationRate','aliases']) && Array.isArray(world.events) &&
        world.events.length<=16384 && record(world.aliases ?? {}) && Object.keys(world.aliases ?? {}).length<=4096,
      'Editorial world needs a committed event ledger and simulation rate');
      simulationRate=T.read(world.simulationRate);
      check(T.seconds(simulationRate)>=.01 && T.seconds(simulationRate)<=1000000,'Invalid editorial simulation rate');
      for (const event of world.events) {
        check(record(event) && eventId(event.id) && integer(event.tick,0,1000000000) && !events.has(event.id),
          'World events need unique IDs and committed ticks');
        events.set(event.id,event);
      }
      check(Object.entries(world.aliases ?? {}).every(([alias,key])=>eventId(alias) && eventId(key) &&
        (!events.has(alias) || alias===key)),'World aliases must be distinct from other event IDs');
    }
    function spot(raw) {
      let point,kind,detail={};
      if (fields(raw,['shot','sourceFrame']) && id(raw.shot) && integer(raw.sourceFrame,0,1000000000)) {
        const shot=shots.get(raw.shot);
        if (!shot) return {issue:'missing-shot'};
        const local=raw.sourceFrame-shot.inFrame;
        if (local<0 || local>=shot.frames) return {issue:'source-frame-trimmed'};
        kind='shot';detail={shot:raw.shot,sourceFrame:raw.sourceFrame};
        point=T.position(take,{frame:shot.start+local});
      } else if (fields(raw,['frame']) && integer(raw.frame,0,1000000000)) {
        kind='frame';point=T.position(take,raw);
      } else if (fields(raw,['event']) && eventId(raw.event)) {
        const key=world?.aliases && Object.hasOwn(world.aliases,raw.event) ? world.aliases[raw.event] : raw.event;
        const event=events.get(key);
        if (!event) return {issue:'missing-world-event'};
        kind='event';detail={event:raw.event,eventId:key,tick:event.tick};
        point=T.div(T.read(event.tick),simulationRate);
      } else if(fields(raw,['cue','clip'])&&id(raw.cue)&&(raw.clip===undefined||id(raw.clip))) {
        const matches=mapping?.cues.filter(cue=>cue.id===raw.cue&&(raw.clip===undefined||raw.clip===cue.clip))??[];
        if(matches.length!==1)return {issue:matches.length?'ambiguous-clock-cue':'missing-clock-cue'};
        const cue=matches[0];
        kind='clock-cue';
        detail={cue:cue.id,...(cue.clip!==undefined&&{clip:cue.clip}),...(cue.original&&{original:cue.original}),
          ...(cue.anchor&&{anchor:cue.anchor})};
        point=T.read(cue.at.timecode);
      } else {
        point=mixer.position(raw);
        kind=P.musicTiming.isPosition(raw) ? 'beat' : raw.samples===undefined ? 'seconds' : 'samples';
      }
      const position=T.describe(take,point);
      const sample=kind==='samples' ? raw.samples : T.locate(take,T.add(origin,point)).sample-first;
      if (position.frame<0 || position.frame>=frames || sample<0 || sample>=end)
        return {issue:'outside-picture'};
      return {kind,...detail,sample,frame:position.frame,timecode:position.timecode,
        beat:musical.sample(position.timecode).beat};
    }
    return {frames,end,spot};
  }
  S.editorialClock=editorialClock;
})(KIT);
