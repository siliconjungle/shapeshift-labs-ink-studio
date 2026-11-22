/* Native revision generators for distinct musical decisions. */
(function (P) {
  const A=P.musicProduction, H=P.musicHarmony, M=P.musicMotif;
  const {check,clamp,hash}=P.musicInstruments;
  const round=n=>Number(n.toFixed(8)), eps=1e-7, pc=n=>(n%12+12)%12;
  const inside=(beat,from,to)=>beat>=from-eps && beat<to-eps;
  const intervals=(chord,score)=>{
    if (!chord) return [];
    const spec=score.arrangement.score.harmonies[chord.harmony];
    const tones=spec.notes ? spec.notes.filter(value=>value!==null).map(H.midi) : H.chord(chord.root,chord.quality);
    return [...new Set((tones.length ? tones : [H.midi(chord.root)]).map(pc))];
  };
  const near=(pitch,classes,[low,high])=>Array.from({length:high-low+1},(_,i)=>i+low)
    .filter(n=>classes.includes(pc(n))).sort((a,b)=>Math.abs(a-pitch)-Math.abs(b-pitch) || a-b);
  const description={
    exposed:['cue','Expose the melody before the rest of the band enters.'],
    'late-pulse':['cue','Withhold the main pulse and let it enter after the return starts.'],
    handoff:['cue','Give the opening hook rhythm to percussion before the lead takes it back.'],
    'bass-move':['phrase','Change the bass under the same lead using a different chord tone.'],
    pedal:['phrase','Hold one bass pitch through a harmonic change.'],
    suspension:['phrase','Prepare an inner voice, hold it across a change, and resolve by step.'],
    'drum-answer':['phrase','Move percussion from the lead attacks into gaps in its phrase.'],
    contrary:['phrase','Move an inner voice against the lead without moving the hook.'],
    'empty-beat':['phrase','Clear one open beat in the hook for silence.'],
    'note-gesture':['note','Refine the pickup, gates and accents on a small run of notes.']
  };
  const make=(id,revision,merit,details)=>({id,revision,merit,details});
  function attempt(id,build) {
    try {return build();}
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return {id,failure:error.message};
    }
  }

  function silence(ctx,parts,from,to,marker) {
    const current=ctx.source.cueMap ?? {}, total=Object.keys(ctx.score.tracks);
    const windows=parts.flatMap(part=>{
      const list=(current.silence ?? []).filter(row=>!row.parts || row.parts.includes(part))
        .sort((a,b)=>a.from-b.from);
      let start=from, result=[];
      for (const row of list) {
        if (row.to<=start || row.from>=to) continue;
        if (row.from>start) result.push({from:start,to:row.from,parts:[part],mode:'cut'});
        start=Math.max(start,row.to);
      }
      if (start<to) result.push({from:start,to,parts:[part],mode:'cut'});
      return result;
    });
    check(windows.length,'Existing silence already covers those tracks');
    const landmark={id:'search-'+marker+'-'+hash([from,to,parts]).toString(36),beat:to,kind:marker,
      parts:parts.filter(part=>total.includes(part))};
    return {...current,silence:[...(current.silence ?? []),...windows],
      landmarks:[...(current.landmarks ?? []).filter(row=>row.id!==landmark.id),landmark]};
  }

  function sectionNotes(ctx,part) {
    const {section,score}=ctx;
    check(!score.arrangement.materials[part].find(row=>row.section===section.id)?.sustain,
      'Choose a note-driven track');
    return score.arrangement.cues.filter(row=>row.part===part && row.section===section.id).map(row=>({
      id:row.id,beat:round(row.beat-section.beat),duration:round(row.duration),
      degree:row.degree,velocity:row.velocity,...(row.midi!==undefined && {midi:row.midi}),...(row.play && {play:row.play})
    }));
  }
  function adopt(ctx,part,events) {
    const {section}=ctx;
    return {part,section:section.id,scope:'section',adopt:M.motif({length:section.end-section.beat,events})};
  }
  function percussionEdit(ctx,part,windows,hits,drop=()=>false) {
    const start=ctx.section.beat;
    const retained=sectionNotes(ctx,part).flatMap(note=>{
      const at=start+note.beat;
      if (drop(at) || windows.some(row=>inside(at,row.from,row.to))) return [];
      const next=windows.find(row=>row.from>at+eps);
      const duration=round(Math.min(note.duration,(next?.from ?? Infinity)-at));
      return duration>eps ? [{...note,duration}] : [];
    });
    const authored=hits.map(({beat,duration,velocity,play},i)=>({
      id:'search-hit-'+hash([beat,part]).toString(36)+'-'+i,beat:round(beat-start),duration,velocity,...(play && {play})
    }));
    return adopt(ctx,part,[...retained,...authored]);
  }
  function clipRevision(ctx,track,id,notes) {
    const {from,to}=ctx;
    const clips=(ctx.source.tracks[track].clips ?? []).filter(clip=>
      Math.abs(clip.beat-from)>eps || Math.abs(clip.beat+clip.length-to)>eps);
    check(clips.every(clip=>clip.beat+clip.length<=from+eps || clip.beat>=to-eps),
      'Choose the range of an existing clip or a gap between clips');
    const clip=P.musicNoteClips.clip({id:'search-'+id+'-'+hash([from,to]).toString(36),beat:from,
      length:round(to-from),voices:[{id:'line',notes}]});
    return {tracks:{[track]:{clips:[...clips,clip]}}};
  }
  function opening(ctx,kind) {
    const {from,to,meter,tracks,score,pins}=ctx, lead=tracks.lead;
    const pulse=tracks.pulse, exposing=kind==='exposed';
    const parts=exposing ? Object.keys(score.tracks).filter(part=>part!==lead && !pins[part]) : pulse && !pins[pulse] ? [pulse] : [];
    check(lead && parts.length,exposing ? 'Choose a melody and an unlocked supporting track' : 'Choose an unlocked pulse track');
    const start=exposing ? from : Math.max(0,from-meter);
    return [.5,1,1.5].map(bars=>{
      const end=round(Math.min(to,from+meter*bars)), id='bars-'+String(bars).replace('.','-');
      return attempt(id,()=>make(id,{cueMap:silence(ctx,parts,start,end,exposing?'ensemble-entry':'pulse-entry')},
        1-Math.abs(bars-1)*.22,{from:start,to:end,parts,lead}));
    });
  }
  function handoff(ctx) {
    const {from,to,meter,tracks,score,pins}=ctx, {lead,percussion}=tracks;
    check(lead && percussion && !pins[lead] && pins[percussion]!=='all',
      'Handoff needs an unlocked melody and percussion track');
    const attacks=[...new Map(score.events[lead].filter(row=>inside(row.beat,from,Math.min(to,from+meter*1.5)))
      .map(row=>[row.beat,row])).values()].slice(0,6);
    check(attacks.length>=2,'Handoff needs at least two hook attacks');
    return [2,3,5].filter(length=>length<=attacks.length).map(length=>attempt('hits-'+length,()=>{
      const hook=attacks.slice(0,length);
      const end=round(attacks[length]?.beat ?? Math.min(to,hook.at(-1).beat+.5));
      const hits=hook.map((row,i)=>({beat:row.beat,duration:round(Math.min(.125,(hook[i+1]?.beat ?? end)-row.beat)),
        velocity:clamp(.93*row.velocity+.08)}));
      return make('hits-'+length,{cueMap:silence(ctx,[lead],from,end,'hook-return'),
        edits:[percussionEdit(ctx,percussion,[{from,to:end}],hits)]},
      .92-Math.abs(length-3)*.075,{from,to:end,lead,percussion,beats:hits.map(row=>row.beat)});
    }));
  }
  function accompaniment(ctx,kind) {
    const {from,to,tracks,score,harmonies,pins,ranges}=ctx, bass=tracks.bass, pedal=kind==='pedal';
    check(bass && !pins[bass] && tracks.lead,'Choose an unlocked bass and an independent melody');
    const active=harmonies.findLast(row=>row.beat<=from+eps);
    check(active,'Bass search needs a starting chord');
    const changes=[{...active,beat:from},...harmonies.filter(row=>row.beat>from+eps && row.beat<to-eps)];
    check(!pedal || changes.length>=2,'A pedal requires a harmonic change inside the phrase');
    const baseline=score.events[bass].filter(row=>inside(row.beat,from,to));
    const anchor=baseline[0]?.midi ?? H.midi(active.root);
    const limits=ranges[bass] ?? [Math.max(0,anchor-12),Math.min(127,anchor+12)];
    const available=chord=>near(anchor,chord.tones,limits).filter(n=>!ctx.scale || ctx.scale.has(pc(n)));
    const pitches=available(active);
    check(pitches.length,'No bass chord tone meets the register and scale');
    return (pedal ? pitches.slice(0,5) : pitches.filter(n=>n!==anchor).slice(0,5)).map((first,index)=>attempt('path-'+index,()=>{
      let previous=first;
      const notes=(pedal ? changes.slice(0,1) : changes).map((row,i,list)=>{
        const local=i===0 ? [first] : near(previous,row.tones,limits)
          .filter(n=>!ctx.scale || ctx.scale.has(pc(n)));
        const preferred=local.find(n=>pc(n)!==pc(previous)) ?? local[0];
        check(preferred!==undefined,'No in-range bass chord tone at '+row.beat);
        previous=preferred;
        const width=(list[i+1]?.beat ?? to)-row.beat;
        return {id:'bass-'+i,beat:round(row.beat-from),duration:round(width*(pedal ? 1 : .83)),
          midi:preferred,velocity:i ? .64 : .76};
      });
      const movement=notes.reduce((sum,row,i)=>sum+(i ? Math.abs(row.midi-notes[i-1].midi) : 0),0);
      const over=changes.filter(row=>!row.tones.includes(pc(first))).length;
      const merit=pedal ? .9-.05*over-.012*Math.abs(first-anchor) :
        .96-.018*movement-.014*Math.abs(first-anchor);
      return make('path-'+index,clipRevision(ctx,bass,kind,notes),merit,{from,to,bass,lead:tracks.lead,
        pitches:notes.map(row=>row.midi),harmonicChanges:changes.length-1});
    }));
  }

  function suspension(ctx,assets) {
    const {from,to,tracks,score,harmonies,pins,ranges,preferences}=ctx;
    const {inner,lead,bass}=tracks;
    check(inner && lead && bass && !pins[inner],'Choose an unlocked inner track and two fixed outer parts');
    const anchor=score.events[inner].find(row=>inside(row.beat,from,to))?.midi ??
      Math.max(42,Math.min(76,(score.events[lead].find(row=>inside(row.beat,from,to))?.midi ?? 69)-9));
    const [low,high]=ranges[inner] ?? [Math.max(0,anchor-9),Math.min(127,anchor+9)];
    const voice={id:'voice',low,high,anchor:Math.max(low,Math.min(high,anchor))};
    const candidates=[];
    for (const [i,row] of harmonies.entries()) {
      if (i===0 || !inside(row.beat,from+eps*2,to)) continue;
      const delay=Math.min(preferences.suspensionBeats,((Math.min(to,harmonies[i+1]?.beat ?? to))-row.beat)*.55);
      if (delay<.125) continue;
      for (const hold of near(anchor,harmonies[i-1].tones,[low,high])) {
        if (row.tones.includes(pc(hold)) || ctx.scale && !ctx.scale.has(pc(hold))) continue;
        const resolve=[hold-1,hold-2,hold+1,hold+2].find(n=>n>=low && n<=high &&
          row.tones.includes(pc(n)) && (!ctx.scale || ctx.scale.has(pc(n))));
        if (resolve!==undefined) candidates.push({voice:voice.id,at:row.beat,hold,resolve,delay:round(delay)});
      }
    }
    check(candidates.length,'No prepared stepwise suspension fits the local harmony and register');
    return candidates.slice(0,4).map((force,index)=>attempt('resolution-'+index,()=>{
      const result=A.voiceLead(ctx.source,{track:inner,melody:lead,bass,from,to,voices:[voice],suspensions:[force],
        preferences:{dissonance:preferences.dissonance,ties:true}},assets);
      const row=result.variants.find(take=>take.id==='suspensions') ?? result.variants[0];
      check(row,'No distinct voice-leading result for that suspension');
      return make('resolution-'+index,row.revision,.94-Math.abs(force.hold-anchor)*.025,
        {from,to,inner,lead,bass,...force});
    }));
  }
  function drumAnswer(ctx) {
    const {tracks,from,to,score,pins}=ctx, {lead,percussion}=tracks;
    check(lead && percussion && !pins[percussion],'Choose a melody and unlocked percussion track');
    const notes=score.events[lead].filter(row=>inside(row.beat,from,to));
    check(notes.length>0,'Drum answer needs a lead phrase');
    const gaps=[];
    let stop=Math.max(from,score.clock.sample(score.events[lead].filter(row=>row.beat<from)
      .reduce((time,row)=>Math.max(time,row.time+row.gate),0)).beat);
    for (const row of [...notes,{beat:to}]) {
      const onset=row.time===undefined ? to : score.clock.sample(row.time).beat;
      if (onset-stop>.34) gaps.push({from:round(stop),to:onset});
      if (row.time!==undefined) stop=Math.max(stop,score.clock.sample(Math.min(row.time+row.gate,row.choke ?? Infinity)).beat);
    }
    check(gaps.length,'No lead gaps with room for an answer');
    const drops=beat=>notes.some(row=>Math.abs(row.beat-beat)<.105);
    return [.32,.57,.77].map(fraction=>attempt('gap-'+String(fraction).slice(2),()=>{
      const hits=gaps.slice(0,6).map(({from,to},i)=>({beat:round(from+(to-from)*fraction),duration:.085,
        velocity:i===0 ? .74 : i%2 ? .52 : .63})).filter(row=>row.beat+row.duration<to-eps);
      const windows=hits.map(row=>({from:row.beat-.085,to:row.beat+row.duration}));
      check(hits.length,'No answer fits inside the phrase');
      return make('gap-'+String(fraction).slice(2),{edits:[percussionEdit(ctx,percussion,windows,hits,drops)]},
        .87+Math.min(.08,hits.length*.026)-Math.abs(fraction-.57)*.29,
        {from,to,percussion,lead,beats:hits.map(row=>row.beat)});
    }));
  }
  function contrary(ctx) {
    const {from,to,tracks:{inner,lead},score,pins,ranges,harmonies,scale}=ctx;
    check(inner && lead && !pins[inner],'Choose a melody and unlocked inner track');
    const line=score.events[lead].filter(row=>inside(row.beat,from,to));
    const leadNotes=[...new Map(line.map(row=>[row.beat,row])).values()].slice(0,10);
    check(leadNotes.length>=2,'Contrary motion needs at least two melody attacks');
    const anchor=score.events[inner].find(row=>inside(row.beat,from,to))?.midi ?? Math.max(0,leadNotes[0].midi-7);
    const range=ranges[inner] ?? [Math.max(0,anchor-8),Math.min(127,anchor+8)];
    return [-4,0,4].map((shift,index)=>attempt('line-'+index,()=>{
      const notes=[];
      let pitch=anchor+shift, oppositeMoves=0;
      for (const [i,note] of leadNotes.entries()) {
        const target=harmonies.findLast(row=>row.beat<=note.beat+eps);
        const direction=i ? Math.sign(note.midi-leadNotes[i-1].midi) : 0;
        const pool=(target?.tones ?? []).filter(pc=>!scale || scale.has(pc));
        const candidates=near(pitch,pool,range).filter(value=>
          value<note.midi-1 && (!notes.length || !direction || direction*(value-pitch)<0));
        if (!candidates.length) break;
        const midi=candidates[0], duration=round(Math.min(.54,(leadNotes[i+1]?.beat ?? to)-note.beat,to-note.beat));
        if (duration<.0625) break;
        if (notes.length && direction) oppositeMoves++;
        notes.push({id:'line-'+i,beat:round(note.beat-from),duration,midi,velocity:.51});
        pitch=midi;
      }
      check(oppositeMoves>0,'No contrary steps fit the active chords and register');
      return make('line-'+index,clipRevision(ctx,inner,'contrary',notes),.55+Math.min(.36,oppositeMoves*.08),
        {from,to,inner,lead,oppositeMoves,pitches:notes.map(row=>row.midi)});
    }));
  }
  function emptyBeat(ctx) {
    const {from,to,tracks:{lead},score,pins}=ctx;
    const voices=Object.keys(score.tracks), fixed=voices.filter(name=>name===lead || pins[name]);
    const support=voices.filter(name=>!fixed.includes(name));
    check(support.length,'Choose at least one unlocked supporting track');
    const intersects=(name,first,last)=>score.events[name].some(note=>note.time<last-eps &&
      Math.min(note.time+note.gate,note.choke ?? Infinity)>first+eps);
    const slots=[];
    for (let start=Math.ceil(from);start+1<=to+eps;start++) {
      const stop=start+1, a=score.clock.timeAt({beat:start}), b=score.clock.timeAt({beat:stop});
      if (fixed.some(name=>intersects(name,a,b)) || !support.some(name=>intersects(name,a,b))) continue;
      slots.push({start,stop});
    }
    check(slots.length,'No one-beat gap in the hook and protected parts');
    return slots.slice(0,6).map(({start,stop},index)=>attempt('rest-'+index,()=>make('rest-'+index,
      {cueMap:silence(ctx,support,start,stop,'rest')},.94-index*.035,{from:start,to:stop,parts:support,lead})));
  }
  function detail(ctx) {
    const {source,score,tracks,pins,from,to,preferences}=ctx, lead=tracks.lead;
    check(lead && pins[lead]!=='all','Choose an editable melody track');
    const track=source.tracks[lead], patch=source.patches[track.patch], clips=track.clips ?? [];
    const available=[...new Set([...Object.keys(patch.articulations ?? {}),
      ...(patch.zones ?? []).flatMap(zone=>zone.articulation ? [zone.articulation] : [])])];
    const articulation=preferences.articulation ?? available[0];
    check(!preferences.articulation || available.includes(articulation),'Lead patch has no requested articulation');
    const profiles=[
      {id:'pickup',delay:-.026,gate:.87,accent:[.78,1.16,1.00]},
      {id:'lean',delay:.018,gate:1.18,accent:[.96,1.18,.81]},
      {id:'short',delay:.004,gate:.55,accent:[1.17,.81,1.05]}
    ];
    const expressive={
      attack:{attackFade:.10},
      breath:{curves:{breath:[[0,.85],[.33,.32],[.78,.25],[1,.82]],
        amplitude:[[0,.44],[.25,.86],[.7,1],[1,.72]]}},
      release:{releaseLimit:.055}
    };
    if (Object.hasOwn(expressive,preferences.gesture))
      profiles.push({id:preferences.gesture,delay:0,gate:1,accent:[1,1,1],play:expressive[preferences.gesture]});
    const native=clips.some(clip=>clip.beat<to && clip.beat+clip.length>from);
    return profiles.map(profile=>{
      let changed=0;
      const shape=(notes,origin)=>notes.map((note,i)=>{
        const beat=origin+note.beat;
        if (!inside(beat,from,to) || note.tie || notes[i+1]?.tie || changed>=6) return note;
        const ordinal=changed++, old=note.play ?? {};
        const play={...old,...profile.play,...(profile.play?.curves && {curves:{...old.curves,...profile.play.curves}}),delay:Math.max(-.125,Math.min(.125,(old.delay ?? 0)+
          profile.delay*(ordinal===0 ? 1 : ordinal%3===2 ? .6 : -.25))),
          gate:Math.max(.05,Math.min(2,(old.gate ?? 1)*(ordinal%3===1 && !profile.play ? profile.gate*.88 : profile.gate))),
          ...(articulation && ordinal%3===1 && !profile.play && {articulation})};
        return {...note,velocity:clamp((note.velocity ?? .8)*profile.accent[ordinal%3]),play};
      });
      const revision=native ? {tracks:{[lead]:{clips:clips.map(clip=>({...clip,
        voices:clip.voices.map(voice=>({...voice,notes:shape(voice.notes,clip.beat)}))}))}}} :
        {edits:[adopt(ctx,lead,shape(sectionNotes(ctx,lead),ctx.section.beat))]};
      check(changed>0,'No untied melody attacks in the note window');
      return make(profile.id,revision,profile.id===preferences.gesture ? .99 : .78+Math.min(.08,changed*.02),
        {from,to,lead,notes:changed,...(articulation && {articulation})});
    });
  }

  const moves={exposed:ctx=>opening(ctx,'exposed'),'late-pulse':ctx=>opening(ctx,'late-pulse'),handoff,
    'bass-move':ctx=>accompaniment(ctx,'bass-move'),pedal:ctx=>accompaniment(ctx,'pedal'),suspension,
    'drum-answer':drumAnswer,contrary,'empty-beat':emptyBeat,'note-gesture':detail};
  P.musicCompositionMoves=Object.freeze({moves,description,intervals,round,pc});
})(KIT.procedural);
