/* Flatten the active comp for interchange and keep its source addresses. */
(function (P) {
  const S=P.mediaGraphSupport, {db,check}=P.musicInstruments;
  function musicHandoff(plan,recipe,material,printed) {
    const {reference,addressed}=S.musicSessionModel;
    const {rate,frames,lanes,sourceLanes,choices,producers,mixer}=plan;
    const clock=P.musicTiming.compile(plan.map), time=S.mixerTime(rate,plan.map);
    const first=clock.sample(0);
    const tempo=[{seconds:0,tempo:first.tempo},...(plan.map.changes ?? []).flatMap(({beat})=>{
      const row=clock.forPosition({beat});
      return row.time>0 && row.time<frames/rate ? [{seconds:row.time,tempo:row.tempo}] : [];
    })].filter((row,index,all)=>!index || row.tempo!==all[index-1].tempo);
    const base=producers.get(reference).score;
    const markers=base.arrangement.sections.map(({id,time})=>({id,seconds:time}))
      .filter(row=>row.seconds>=0 && row.seconds<frames/rate);
    const curve=(value,fallback,min,max,label)=>{
      const lane=time.lane(value,fallback,min,max,label);
      return {curve:lane.curve,points:lane.points};
    };
    const strips=Object.fromEntries(Object.entries(mixer.strips).map(([name,strip])=>
      [name,{fader:curve(strip.fader,1,0,4,'fader'),pan:curve(strip.pan,0,-1,1,'pan'),
        inserts:printed.report.strips[name].inserts}]));
    const routes=printed.report.routes.map(route=>({...route,level:curve(route.kind==='send' ?
      mixer.strips[route.from].sends[route.to].level : 1,1,0,2,'send level')}));
    let noteCount=0, expressionCount=0;
    const frame=seconds=>Math.max(0,Math.ceil(seconds*rate-1e-7));
    const tracks=Object.fromEntries(lanes.filter(lane=>!plan.audio.has(lane)).map(lane=>{
      const spans=[], takes={}, sourceNames=new Set([reference]);
      let start=0;
      function span(from,to,take) {
        if (to<=from) return;
        const previous=spans.at(-1);
        if (previous?.take===take) previous.to=to;
        else spans.push({from,to,take});
        sourceNames.add(take);
      }
      for (const pick of choices) if (pick.lane===lane) {
        span(start,pick.from,reference);
        span(pick.from,pick.to,pick.take);
        start=pick.to;
      }
      span(start,frames,reference);
      const scoreNotes=new Map();
      for (const take of sourceNames) {
        const {source,score}=producers.get(take), track=score.tracks[lane];
        const addresses=addressed(score,lane);
        const notes=score.events[lane].map((note,index)=>{
          const from=frame(note.start ?? note.time), to=frame(Math.min(note.time+note.gate,note.choke ?? Infinity,frames/rate));
          return {from,to,note,address:addresses[index].address};
        }).filter(row=>row.note.velocity>0 && row.to>row.from);
        scoreNotes.set(take,notes);
        takes[take]={instrument:track.patch,
          ...(track.external && {clap:{...track.external}}),
          track:source.tracks[lane]};
      }
      const notes=[];
      for (const {from,to,take} of spans) for (const row of scoreNotes.get(take)) {
        if (row.to<=from || row.from>=to) continue;
        check(++noteCount<=100000,'DAW handoff exceeds its active note budget');
        const {note,address}=row, startSample=Math.max(from,row.from), endSample=Math.min(to,row.to);
        const expression=[];
        P.musicClap.expressionEvents(note,startSample,endSample,rate,.02,(sample,type,value)=>{
          check(++expressionCount<=1000000,'DAW handoff exceeds its expression budget');
          expression.push({sample,type,value});
        });
        notes.push({take,address,startSample,endSample,midi:note.midi,velocity:note.velocity,
          writtenBeat:note.beat,frequency:note.frequency,play:note.play,expression,
          performedStartSample:row.from,performedEndSample:row.to,
          ...(note.ties && {ties:note.ties})});
      }
      notes.sort((a,b)=>a.startSample-b.startSample || a.endSample-b.endSample);
      return [lane,{takes,notes}];
    }));
    if (!printed.sources) check(printed.report.frames*sourceLanes.length*2<=32e6,'Aligned handoff stems exceed their PCM budget');
    const stemGains={};
    const stems=Object.fromEntries(sourceLanes.map(name=>{
      const native=printed.sources?.[name];
      if (native) {
        let peak=1;
        for (const sample of native.samples) peak=Math.max(peak,Math.abs(sample));
        stemGains[name]=peak;
        if (peak>1) for (let i=0;i<native.samples.length;i++) native.samples[i]/=peak;
        return [name,native];
      }
      const clip=recipe.strips[name].clips?.[0];
      const samples=new Float32Array(printed.report.frames*2);
      stemGains[name]=clip ? db(clip.gainDb) : 1;
      if (clip) {
        const first=clip.at.samples*2, pcm=material[clip.source].samples;
        samples.set(pcm.subarray(0,samples.length-first),first);
      }
      return [name,{samples,sampleRate:rate,channels:2}];
    }));
    return {value:printed.value,stems,taps:printed.taps,plan:{format:'ink-studio/daw-handoff',version:1,
      id:plan.session.id,sampleRate:rate,scoreFrames:frames,frames:printed.report.frames,tempoMap:plan.map,
      tempo,stemGains,beatsPerBar:plan.map.beatsPerBar ?? 4,markers,tracks,comp:choices,automation:plan.session.automation ?? {},
      desk:mixer,routing:{output:mixer.output,strips,routes},mixReport:printed.report}};
  }
  S.musicHandoff=musicHandoff;
})(KIT.procedural);
