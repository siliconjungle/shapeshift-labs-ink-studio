/* Turn one listening hypothesis into controlled, addressed score comparisons. */
(function (P) {
  const {fields,finite,integer,id,check,sampleZones}=P.musicInstruments;
  const round=(n,digits=6)=>Number(n.toFixed(digits));
  const limit=(n,low,high)=>Math.max(low,Math.min(high,n));
  const position=sample=>({samples:sample});
  const span=(first,end)=>({from:position(first),to:position(end)});
  const start=(row,rate)=>Math.ceil((row.start ?? row.time)*rate-1e-7);
  const address=row=>({clip:row.clip,voice:row.voice,note:row.note});
  const same=(a,b)=>a.clip===b.clip && a.voice===b.voice && a.note===b.note;

  function addressInScore(score,span,rate) {
    return {firstSample:span.firstSample,endSample:span.endSample,start:span.firstSample/rate,end:span.endSample/rate,
      fromBeat:round(score.clock.sample(span.firstSample/rate).beat,9),
      toBeat:round(score.clock.sample(Math.min(score.end,span.endSample/rate)).beat,9)};
  }

  function playVoice(score,part,note,rate,ms) {
    const track=score.tracks[part];
    const voice=P.musicProduction.prepareVoice(track,note,score.end,rate,score.cue?.perTrack[part].tail);
    const frames=Math.min(voice.last-voice.first,Math.ceil(rate*ms/1000));
    if (frames<1) return null;
    const samples=new Float32Array(frames*2);
    voice.write(samples,voice.first,voice.first+frames);
    return {sampleRate:rate,channels:2,samples,firstSample:voice.first,endSample:voice.first+frames};
  }

  // Use a short sustained energy rise against a relative threshold. A single
  // outlying sample should not count as an audible onset.
  function onset(audio) {
    if (!audio) return null;
    const {samples,sampleRate}=audio, frames=samples.length/2;
    const block=Math.max(1,Math.round(.002*sampleRate)), levels=[];
    for (let from=0;from<frames;from+=block) {
      const to=Math.min(frames,from+block);
      let power=0;
      for (let i=2*from;i<2*to;i++) power+=samples[i]**2;
      levels.push(Math.sqrt(power/(2*(to-from))));
    }
    const peak=Math.max(...levels);
    if (peak<1e-5) return null;
    const floor=Math.max(.00001,peak*.10);
    const index=levels.findIndex((value,i)=>value>=floor && (levels[i+1] ?? value)>=floor);
    return index<0 ? null : {sample:audio.firstSample+index*block,peak};
  }

  const active=(score,part,focus)=>score.events[part].filter(row=>row.velocity>0 &&
    row.time<focus.end && row.time+row.gate>focus.start);
  function masking(source,score,review,raw) {
    check(fields(raw,['kind','track','semitones','duckDb','holdMs']) && id(raw.track) &&
      raw.track!==review.lead && review.lead && Object.hasOwn(score.tracks,raw.track) &&
      (raw.semitones===undefined || integer(raw.semitones,-36,36) && raw.semitones!==0) &&
      finite(raw.duckDb ?? -8,-24,-1) && finite(raw.holdMs ?? 165,35,600),
    'Masking diagnosis needs a lead and a distinct competing score track');
    const hook=active(score,review.lead,review.focus), rival=active(score,raw.track,review.focus);
    check(hook.length && rival.length,'The focus needs sounding lead and competing notes');
    const {rate,focus}=review, track=raw.track;
    const average=notes=>notes.reduce((sum,row)=>sum+row.midi,0)/notes.length;
    const direction=average(rival)<=average(hook) ? -1 : 1;
    const moves=[direction*12,-direction*12].filter(value=>rival.every(note=>integer(note.midi+value,0,127)));
    const semitones=raw.semitones ?? moves[0];
    const parts=[track], windows=[];
    for (const row of hook) {
      const from=Math.max(focus.firstSample,start(row,rate)-Math.round(.010*rate));
      const to=Math.min(focus.endSample,from+Math.round((raw.holdMs ?? 165)*rate/1000));
      if (to-from<8) continue;
      const prior=windows.at(-1);
      if (prior && from<=prior.to+4) prior.to=Math.max(prior.to,to);
      else windows.push({from,to});
    }
    const candidates=[{id:'mute-rival',label:'Mute the competing track',edits:[{op:'silence',parts,mode:'cut'}]}];
    const unavailable=[];
    if (score.arrangement.parts[track].role==='percussion' || semitones===undefined)
      unavailable.push({id:'move-register',reason:'Competing track has no available pitched register'});
    else candidates.push({id:'move-register',label:'Move the competing track out of the hook register',
      edits:[{op:'register',parts,semitones}]});
    if (windows.length) candidates.push({id:'duck-rival',label:'Duck around hook attacks',
      edits:windows.slice(0,12).map(({from,to})=>({op:'level',parts,range:span(from,to),gainDb:raw.duckDb ?? -8,fadeSeconds:.012}))});
    const question='Which intervention makes the hook easier to follow while retaining the accompanying part you want?';
    return {tracks:[review.lead,track],candidates,unavailable,question,
      targets:[{id:'hook-exposure',range:span(focus.firstSample,focus.endSample),parts:[review.lead],rivals:parts}],
      evidence:{lead:review.lead,track,semitones:semitones ?? null,duckWindows:windows.slice(0,12)}};
  }

  function groove(source,score,review,raw) {
    const {rate,focus}=review;
    check(fields(raw,['kind','anchor','track','note','targetMs','accent','searchMs']) &&
      id(raw.anchor) && id(raw.track) && raw.anchor!==raw.track && Object.hasOwn(score.tracks,raw.anchor) &&
      Object.hasOwn(score.tracks,raw.track) && (raw.note===undefined ||
        fields(raw.note,['clip','voice','note']) && ['clip','voice','note'].every(name=>id(raw.note[name]))) &&
      finite(raw.targetMs ?? 0,-100,100) && finite(raw.accent ?? .6,.04,1) &&
      finite(raw.searchMs ?? 150,30,240),'Groove diagnosis needs an anchor and a different editable score track');
    const anchors=active(score,raw.anchor,focus), performers=active(score,raw.track,focus);
    const targets=performers.filter(row=>row.clip && (!raw.note || same(row,raw.note)) && row.time>=focus.start);
    const nearest=(rows,row)=>rows.reduce((best,other)=>!best || Math.abs(other.beat-row.beat)<Math.abs(best.beat-row.beat) ? other : best,null);
    const target=targets.find(row=>anchors.some(anchor=>Math.abs(anchor.time-row.time)<.22)) ?? targets[0];
    check(target && anchors.length,'Choose a written target note and an audible anchor in the focus');
    const anchor=nearest(anchors,target);
    const lanes=[{role:'anchor',name:raw.anchor,note:anchor},{role:'target',name:raw.track,note:target}];
    const describe=(compiled,name,note)=> {
      const trigger=start(note,rate), grid=Math.round(compiled.clock.timeAt({beat:note.beat})*rate);
      const pcm=compiled.tracks[name].external ? null : playVoice(compiled,name,note,rate,raw.searchMs ?? 150);
      const hit=onset(pcm);
      return {info:{part:name,...(note.clip && address(note)),beat:note.beat,velocity:note.velocity,
        gridSample:grid,triggerSample:trigger,audibleSample:hit?.sample ?? null,
        gridToTriggerMs:round((trigger-grid)*1000/rate,3),
        triggerToAudioMs:hit ? round((hit.sample-trigger)*1000/rate,3) : null},pcm,hit};
    };
    const baseline=lanes.map(row=>describe(score,row.name,row.note));
    const written=source.tracks[raw.track].clips.find(row=>row.id===target.clip).voices
      .find(row=>row.id===target.voice).notes.find(row=>row.id===target.note);
    const edit=(id,label,set)=>({id,label,edits:[{op:'note',part:raw.track,...address(target),set}]});
    const accents=performers.filter(row=>row!==target).map(row=>row.velocity).sort((a,b)=>a-b);
    const accent=raw.accent ?? accents[accents.length>>1] ?? .6;
    const candidates=[], unavailable=[];
    if (Math.abs(accent-written.velocity)>1e-5) candidates.push(edit('accent','Change only the written accent',{velocity:accent}));
    else unavailable.push({id:'accent',reason:'Written accent already matches the test value'});
    const difference=(baseline[0].info.triggerSample-baseline[1].info.triggerSample)/rate +(raw.targetMs ?? 0)/1000;
    const delay=round(limit((written.play?.delay ?? 0)+difference,-.125,.125),9);
    if (Math.abs(delay-(written.play?.delay ?? 0))>=.5/rate)
      candidates.push(edit('timing','Move the trigger against the anchor',{play:{...written.play,delay}}));
    else unavailable.push({id:'timing',reason:'Scheduled triggers already match the requested relationship'});
    const {info,hit}=baseline[1];
    const patch=source.patches[source.tracks[raw.track].patch];
    let trimmed;
    if (hit && info.triggerToAudioMs>=6 && sampleZones(patch).length) {
      const baseOffset=written.play?.offset ?? 0, step=Math.max(1,info.triggerToAudioMs-3)/1000;
      for (const scale of [.25,.5,.75,1,1.25,1.5,2,3,4]) {
        const offset=round(Math.min(5,baseOffset+step*scale),9);
        if (offset<=baseOffset) break;
        const trial={...target,play:{...target.play,offset}};
        const next=describe(score,raw.track,trial);
        if (!next.hit || next.hit.peak<hit.peak*.72 || next.info.triggerToAudioMs>=info.triggerToAudioMs-3) continue;
        if (!trimmed || next.info.triggerToAudioMs<trimmed.latency)
          trimmed={offset,latency:next.info.triggerToAudioMs};
        if (trimmed.latency<=5) break;
      }
    }
    if (trimmed) candidates.push(edit('sample-attack','Skip the measured sample lead-in',{play:{...written.play,offset:trimmed.offset}}));
    else unavailable.push({id:'sample-attack',reason:'No supported sample offset measurably advanced this voice attack'});
    const pair=(compiled)=> {
      const values=lanes.map(row=>{
        const matches=compiled.events[row.name].filter(note=>row.note.clip ? same(note,row.note) : note.beat===row.note.beat);
        const note=matches.reduce((best,other)=>!best || Math.abs(other.time-row.note.time)<Math.abs(best.time-row.note.time) ? other : best,null);
        return note ? describe(compiled,row.name,note).info : null;
      });
      const [a,b]=values;
      return {anchor:a,target:b,triggerGapMs:a && b ? round((b.triggerSample-a.triggerSample)*1000/rate,3) : null,
        audibleGapMs:a?.audibleSample!=null && b?.audibleSample!=null ? round((b.audibleSample-a.audibleSample)*1000/rate,3) : null};
    };
    return {tracks:lanes.map(row=>row.name),candidates,unavailable,
      question:'Does the pocket change when the accent, trigger timing, or time inside the sample is changed separately?',
      evidence:{targetMs:raw.targetMs ?? 0,trimmed,original:pair(score)},pair,
      voices:Object.fromEntries(baseline.flatMap(({pcm},i)=>pcm ? [['voice-'+lanes[i].role,
        {pcm,range:addressInScore(score,pcm,rate),track:lanes[i].name}]] : []))};
  }

  P.musicCritiqueDiagnosis=Object.freeze({masking,groove});
})(KIT.procedural);
