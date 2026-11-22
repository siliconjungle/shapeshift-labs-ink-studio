/* Search bounded musical alternatives and keep one winner per kind of move. */
(function (P) {
  const A=P.musicProduction,H=P.musicHarmony;
  const {check,fields,finite,id,integer,hash,record}=P.musicInstruments;
  const {moves,description,intervals,round,pc}=P.musicCompositionMoves;
  const desks=['lead','bass','inner','percussion','pulse'];
  const order=['exposed','handoff','bass-move','pedal','suspension','drum-answer','note-gesture'];
  const roughness=[0,1,.64,.24,.16,.11,.84,.07,.23,.24,.64,.89];
  const format='ink-studio/composition-search', epsilon=1e-7;
  const signature=value=>JSON.stringify(value);
  const performed=rows=>rows.map(({time,beat,gate,midi,frequency,velocity,play,fromFrequency,choke,salt,roundRobin})=>
    [time,beat,gate,midi,frequency,velocity,play,fromFrequency,choke,salt,roundRobin]);
  const writtenPitches=rows=>rows.slice().sort((a,b)=>a.beat-b.beat || String(a.voice).localeCompare(String(b.voice)))
    .map(row=>[row.voice ?? null,row.midi]);
  const text=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;

  function setup(source,brief,assets) {
    check(fields(brief,['section','goal','seed','tracks','range','constraints','preferences','kinds']) &&
      id(brief.section) && (brief.goal===undefined || text(brief.goal,640)) && Number.isSafeInteger(brief.seed ?? 0),
      'A composition search needs a destination section and optional goal and seed');
    const score=A.compile(source,assets), {arrangement}=score, names=Object.keys(score.tracks);
    const section=arrangement.sections.find(row=>row.id===brief.section);
    check(section,'Unknown composition search section');
    const meter=arrangement.score.tempoMap?.beatsPerBar ?? 4;
    const range=brief.range ?? {}, from=range.from ?? section.beat, to=range.to ?? Math.min(section.end,from+meter*2);
    check(fields(range,['from','to']) && finite(from,section.beat,section.end-.125) &&
      finite(to,from+.125,Math.min(section.end,from+32)),'Use an absolute beat range inside the section, up to 32 beats');
    const raw=brief.tracks ?? {};
    const role=name=>arrangement.parts[name].role, roleTrack=target=>names.find(name=>role(name)===target);
    check(fields(raw,desks) && Object.entries(raw).every(([slot,name])=>
      names.includes(name) && (['percussion','pulse'].includes(slot) ? role(name)==='percussion' : role(name)!=='percussion')),
    'Choose applicable tracks for each composition role');
    const lead=raw.lead ?? roleTrack('lead'), bass=raw.bass ?? roleTrack('bass'), pulse=raw.pulse ??
      names.find(name=>role(name)==='percussion' && source.patches[source.tracks[name].patch]?.kind==='kick') ??
      roleTrack('percussion');
    const percussion=raw.percussion ?? names.find(name=>role(name)==='percussion' && name!==pulse) ?? pulse;
    const inner=raw.inner ?? names.find(name=>role(name)==='pad' && name!==lead && name!==bass);
    const voices=[lead,bass,inner].filter(Boolean);
    check(new Set(voices).size===voices.length,'The melody, bass and inner voice need distinct tracks');
    const tracks=Object.fromEntries(Object.entries({lead,bass,inner,percussion,pulse}).filter(([,name])=>name!==undefined));
    const kinds=brief.kinds ?? order;
    check(Array.isArray(kinds) && integer(kinds.length,1,Object.keys(moves).length) && new Set(kinds).size===kinds.length &&
      Array.from(kinds).every(name=>Object.hasOwn(moves,name)),'Choose distinct supported kinds of composition move');
    const constraints=brief.constraints ?? {}, preferences=brief.preferences ?? {};
    check(fields(constraints,['scale','chord','dissonance','pins','ranges']) &&
      fields(preferences,['dissonance','harmonyWeight','suspensionBeats','gesture','articulation']),
    'Invalid composition search constraints or preferences');
    const {chord='free',dissonance,pins:declared={},ranges:rawRanges={}}=constraints;
    check(['free','landing','strict'].includes(chord) && (dissonance===undefined || Array.isArray(dissonance) &&
      dissonance.length===2 && finite(dissonance[0],0,1) && finite(dissonance[1],dissonance[0],1)) &&
      record(declared) && Object.entries(declared).every(([name,mode])=>names.includes(name) &&
        (mode==='all' || mode==='pitch' && role(name)!=='percussion')) && record(rawRanges),
    'Use valid chord, dissonance or track constraints');
    const pins={...declared};
    for (const name of Object.keys(P.musicComposer.locks(arrangement))) if (names.includes(name)) pins[name]='all';
    const ranges=Object.fromEntries(Object.entries(rawRanges).map(([name,row])=>{
      check(names.includes(name) && role(name)!=='percussion' && Array.isArray(row) && row.length===2,
        'Pitch ranges need a pitched track and two notes');
      const [low,high]=row.map(H.midi);
      check(low<=high && (name!==inner || high-low<=24),'Pitch range must rise and an inner voice fits within two octaves');
      return [name,[low,high]];
    }));
    let scale;
    if (constraints.scale!==undefined) {
      check(fields(constraints.scale,['root','mode']) && constraints.scale.root!==undefined &&
        constraints.scale.mode!==undefined,'A search scale needs a root and mode');
      const root=H.midi(constraints.scale.root);
      scale=new Set(H.scaleSteps(constraints.scale.mode).map(step=>pc(root+step)));
    }
    const prefs={dissonance:.22,harmonyWeight:.6,suspensionBeats:.57,gesture:'lean',...preferences};
    check(finite(prefs.dissonance,0,1) && finite(prefs.harmonyWeight,0,4) && finite(prefs.suspensionBeats,.125,2) &&
      ['pickup','lean','short','breath','attack','release'].includes(prefs.gesture) && (prefs.articulation===undefined || id(prefs.articulation)),
    'Invalid dissonance target, weighting or note-gesture preferences');
    const harmonies=score.program.events.map(row=>({...row,beat:round(score.clock.sample(row.time).beat),
      tones:intervals(row,score)}));
    return {source,score,section,from,to,meter,tracks,pins,ranges,scale,chord,dissonance,
      kinds,preferences:prefs,harmonies,names,role,seed:brief.seed ?? 0};
  }

  function addedPitches(before,after) {
    const counts=new Map();
    const key=row=>signature([row.beat,row.midi]);
    for (const row of before) counts.set(key(row),(counts.get(key(row)) ?? 0)+1);
    return after.filter(row=>{
      const address=key(row), count=counts.get(address) ?? 0;
      if (!count) return true;
      counts.set(address,count-1);
      return false;
    });
  }
  function fitPitches(ctx,candidate,changed) {
    const harmonies=candidate.program.events.map(row=>({...row,beat:round(candidate.clock.sample(row.time).beat),
      tones:intervals(row,candidate)}));
    let tones=0,total=0;
    for (const part of changed) {
      if (ctx.role(part)==='percussion') continue;
      for (const row of addedPitches(ctx.score.events[part],candidate.events[part])) {
        check(!ctx.scale || ctx.scale.has(pc(row.midi)), 'An added attack falls outside the search scale');
        const range=ctx.ranges[part];
        check(!range || row.midi>=range[0] && row.midi<=range[1],'An added attack falls outside the pitch range');
        const chord=harmonies.findLast(event=>event.beat<=row.beat+epsilon);
        if (!chord) {
          check(ctx.chord==='free','An added attack has no active chord');
          continue;
        }
        const fits=chord.tones.includes(pc(row.midi)), landing=row.beat-chord.beat<=.125;
        check(fits || ctx.chord==='free' || ctx.chord==='landing' && !landing,
          'An added attack falls outside the required chord tones');
        tones+=Number(fits);
        total++;
      }
    }
    return {addedPitches:total,chordToneFraction:total ? round(tones/total) : null};
  }
  function dissonance(ctx,score,changed,from,to) {
    const start=score.clock.timeAt({beat:from}), end=score.clock.timeAt({beat:to}), affecting=new Set(changed);
    const notes=ctx.names.filter(name=>ctx.role(name)!=='percussion').flatMap(part=>score.events[part].flatMap(note=>{
      const a=Math.max(start,note.time), b=Math.min(end,note.time+note.gate,note.choke ?? Infinity);
      return b>a ? [{a,b,midi:note.midi,part,velocity:note.velocity}] : [];
    })).sort((a,b)=>a.a-b.a);
    check(notes.length<=2048,'Choose a shorter phrase or a less dense range');
    let weight=0, result=0;
    for (const [i,a] of notes.entries()) for (let j=i+1;j<notes.length && notes[j].a<a.b;j++) {
      const b=notes[j];
      if (!affecting.has(a.part) && !affecting.has(b.part)) continue;
      const overlap=(Math.min(a.b,b.b)-b.a)*a.velocity*b.velocity;
      result+=overlap*roughness[pc(Math.abs(a.midi-b.midi))];
      weight+=overlap;
    }
    return weight>0 ? round(result/weight) : null;
  }
  function assess(ctx,kind,variant,assets) {
    if (variant.failure) throw new RangeError(variant.failure);
    const source=A.revise(ctx.source,variant.revision,assets), candidate=A.compile(source,assets);
    const changed=ctx.names.filter(name=>signature(performed(ctx.score.events[name]))!==signature(performed(candidate.events[name])));
    check(changed.length,'The move does not change the performed score');
    const {from,to,parts,lead,bass,inner,percussion,beats}=variant.details;
    const affected=parts ?? (kind==='handoff' ? [lead,percussion] :
      [kind==='drum-answer' ? percussion : kind==='note-gesture' ? lead : inner ?? bass]);
    check(changed.every(name=>affected.includes(name)), 'A groove or part link changes an independent performance');
    for (const name of changed) {
      check(ctx.pins[name]!=='all','Move changes pinned track '+name);
      if (ctx.pins[name]==='pitch')
        check(signature(writtenPitches(ctx.score.events[name]))===signature(writtenPitches(candidate.events[name])),
          'Move changes pinned pitches on '+name);
    }
    const harmony=fitPitches(ctx,candidate,changed);
    const rough=dissonance(ctx,candidate,changed,variant.details.from,variant.details.to);
    check(rough===null || !ctx.dissonance || finite(rough,ctx.dissonance[0],ctx.dissonance[1]),
      'Interval roughness exceeds the requested bounds');
    const penalty=rough===null ? 0 : ctx.preferences.harmonyWeight*Math.abs(rough-ctx.preferences.dissonance);
    const evidence={changedTracks:changed,beforeAttacks:{},afterAttacks:{},dissonance:rough,...harmony};
    const inWindow=(music,name)=>music.events[name].filter(row=>row.beat>=from-epsilon && row.beat<to-epsilon);
    if (kind==='exposed') check(inWindow(candidate,lead).length,'The exposed span needs a sounding melody');
    if (kind==='late-pulse') {
      const pulse=candidate.events[parts[0]].find(row=>row.beat>=to-epsilon);
      check(pulse,'The pulse needs a later re-entry in the cue');
      evidence.pulseReturnsAt=pulse.beat;
    }
    if (kind==='handoff' || kind==='drum-answer') {
      const reproduced=inWindow(candidate,percussion);
      check(beats.every(beat=>reproduced.some(row=>Math.abs(row.beat-beat)<epsilon)),
        'A cue mask drops some of the proposed percussion hits');
      if (kind==='handoff') check(!inWindow(candidate,lead).length,'The original lead still plays in the handoff range');
    }
    if (kind==='pedal' || kind==='suspension') {
      const part=kind==='pedal' ? bass : inner;
      const boundary=kind==='pedal' ? ctx.harmonies.find(row=>row.beat>from+epsilon && row.beat<to)?.beat : variant.details.at;
      const at=candidate.clock.timeAt({beat:boundary});
      check(inWindow(candidate,part).some(row=>row.time<at-epsilon && row.time+row.gate>at+epsilon &&
        row.time+candidate.tracks[part].play.prepare(row,48000,row.gate).duration>at+epsilon),
      'The track does not sustain across the change');
      evidence.heldAcrossBeat=boundary;
    }
    for (const name of changed) {
      evidence.beforeAttacks[name]=inWindow(ctx.score,name).length;
      evidence.afterAttacks[name]=inWindow(candidate,name).length;
    }
    return {evidence,score:round(variant.merit-penalty),key:signature(changed.map(name=>[name,performed(candidate.events[name])]))};
  }

  function searchComposition(source,brief,assets={}) {
    const ctx=setup(source,brief,assets), families=[], winners=[], seen=new Set();
    for (const kind of ctx.kinds) {
      const [level,hypothesis]=description[kind], rows=[], accepted=[];
      let generated;
      try { generated=moves[kind](ctx,assets); }
      catch (error) {
        if (!(error instanceof RangeError)) throw error;
        families.push({kind,level,blocked:error.message,candidates:[]});
        continue;
      }
      for (const candidate of generated) {
        const row={id:candidate.id,details:candidate.details ?? null};
        try {
          const {evidence,score,key}=assess(ctx,kind,candidate,assets);
          Object.assign(row,{evidence,score,merit:round(candidate.merit),status:seen.has(key) ? 'duplicate' : 'valid'});
          if (!seen.has(key)) {
            const tie=hash([ctx.seed,kind,candidate.id])>>>0;
            accepted.push({row,candidate,key,tie});
          }
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          Object.assign(row,{status:'blocked',reason:error.message});
        }
        rows.push(row);
      }
      accepted.sort((a,b)=>b.row.score-a.row.score || a.tie-b.tie || a.row.id.localeCompare(b.row.id));
      const winner=accepted[0];
      if (winner) {
        seen.add(winner.key);
        winner.row.status='selected';
        winners.push({id:kind,level,candidate:winner.row.id,hypothesis,
          details:winner.row.details,evidence:winner.row.evidence,revision:{...winner.candidate.revision,id:kind}});
      }
      families.push({kind,level,candidates:rows,...(winner ? {winner:winner.row.id} : {blocked:'No distinct eligible candidate'})});
    }
    const session=A.planProducer(source,{section:ctx.section.id,strategies:[],goal:brief.goal ?? 'Compare distinct musical moves.',
      takes:winners.map(row=>({id:row.id,hypothesis:row.hypothesis,components:[
        {id:'move',summary:row.hypothesis,revision:row.revision}
      ]}))},assets);
    const report={section:ctx.section.id,from:ctx.from,to:ctx.to,seed:ctx.seed,tracks:ctx.tracks,pins:ctx.pins,
      constraints:brief.constraints ?? {},preferences:ctx.preferences,families};
    return P.data.freeze(P.data.clone({format,version:1,session,winners,report}));
  }

  P.musicProduction=Object.freeze({...A,searchComposition});
})(KIT.procedural);
