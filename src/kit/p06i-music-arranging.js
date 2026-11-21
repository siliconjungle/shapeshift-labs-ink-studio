/* Revisions whose generated notes depend on what the rest of the phrase is playing. */
(function (P) {
  const A=P.musicProduction, C=P.musicComposer, H=P.musicHarmony, I=P.musicInstruments;
  const {record,fields,finite,integer,id,check,hash}=I;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const rounded=value=>Number(value.toFixed(9));
  const pc=value=>((value%12)+12)%12;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

  function revise(source,spec={},assets={}) {
    check(fields(spec,['id','edits','pin','unpin','tracks','patches','harmonies','changes','room','gain']) &&
      (spec.id===undefined || id(spec.id)),'Invalid production revision');
    const baseline=A.compile(source,assets), next=clone(source);
    const arrangement=clone(baseline.arrangement.definition);
    const after=C.revise(arrangement,{edits:spec.edits,pin:spec.pin,unpin:spec.unpin}).value;
    next.arrangement=clone(after.definition);
    const locked=C.locks(after);
    for (const [name,patch] of Object.entries(spec.patches ?? {})) {
      check(id(name) && record(patch),'Invalid replacement patch');
      next.patches[name]=clone(patch);
    }
    for (const [name,track] of Object.entries(spec.tracks ?? {})) {
      check(id(name) && Object.hasOwn(after.parts,name) && record(track),'Invalid track revision');
      next.tracks[name]={...next.tracks[name],...clone(track)};
    }
    for (const [name,harmony] of Object.entries(spec.harmonies ?? {})) {
      check(id(name) && record(harmony),'Invalid replacement harmony');
      next.arrangement.score.harmonies[name]=clone(harmony);
    }
    if (spec.changes!==undefined) {
      check(Array.isArray(spec.changes) && spec.changes.length<=64,'A revision needs bounded chord changes');
      const changes=next.arrangement.score.changes ?? [];
      const ids=new Set(spec.changes.map(row=>row.id));
      check(ids.size===spec.changes.length,'Chord change IDs must be unique');
      next.arrangement.score.changes=[...changes.filter(row=>!ids.has(row.id)),...clone(spec.changes)];
    }
    if (spec.room!==undefined) next.room={...next.room,...clone(spec.room)};
    if (spec.gain!==undefined) next.gain=spec.gain;
    const compiled=A.compile(next,assets);
    for (const [name,reason] of Object.entries(locked)) {
      const before=baseline.arrangement.parts[name], after=compiled.arrangement.parts[name];
      const patch=source.tracks[name]?.patch;
      check(same(before,after) && same(baseline.events[name],compiled.events[name]) &&
        same(source.tracks[name],next.tracks[name]) && same(source.patches[patch],next.patches[patch]),
        'Production revision changes a pinned part '+name+' ('+reason.join(', ')+')');
      // Keep voices which drive pinned scene bindings intact even when their audio track is absent.
      if (source.tracks[name]===undefined) for (const cue of baseline.arrangement.cues.filter(row=>row.part===name))
        check(same(baseline.program.pitch(name,cue.time),compiled.program.pitch(name,cue.time)),
          'Production revision changes the pitch of a pinned cue '+name);
    }
    return P.data.freeze(next);
  }

  function local(plan,name,section) {
    return plan.cues.filter(note=>note.part===name && note.section===section.id).map(note=>({
      beat:rounded(note.beat-section.beat),duration:rounded(Math.min(note.duration,section.end-note.beat)),
      velocity:note.velocity,degree:note.degree,...(note.midi!==undefined && {midi:note.midi}),
      ...(note.play && {play:note.play})}));
  }
  function sectionEdit(name,section,notes) {
    return {part:name,section:section.id,scope:'section',
      adopt:C.motif.motif({length:section.end-section.beat,events:notes})};
  }
  const harmonyAt=(score,time)=>score.program.events.findLast(row=>row.time<=time+1e-8);
  const tones=(score,harmony)=>{
    const spec=score.arrangement.score.harmonies[harmony.harmony];
    return spec.notes?.filter(note=>note!==null).map(H.midi) ?? H.chord(harmony.root,harmony.quality);
  };
  function nearestNote(classes,anchor,low,high,avoid) {
    let cost=Infinity, result=anchor;
    for (let note=low;note<=high;note++) {
      if (!classes.includes(pc(note))) continue;
      const distance=Math.abs(note-anchor)+(pc(note)===pc(avoid) ? 3.1 : 0);
      if (distance<cost) {cost=distance;result=note;}
    }
    return result;
  }
  function nearest(notes,time) {
    let left=0, right=notes.length;
    while (left<right) {
      const i=(left+right)>>>1;
      if (notes[i].time<time) left=i+1;
      else right=i;
    }
    const a=notes[left-1], b=notes[left];
    return a && (!b || time-a.time<b.time-time) ? a : b;
  }

  function context(score,section,names={}) {
    const {arrangement,tracks}=score;
    check(fields(names,['lead','bass','kick','snare','hat','pad']), 'Choose known phrase roles');
    const role=(role,kind=role)=>{
      if (names[kind]!==undefined) {
        check(Object.hasOwn(tracks,names[kind]) && arrangement.parts[names[kind]].role===role,'Role has no matching part');
        return names[kind];
      }
      if (role==='percussion') return Object.keys(tracks).find(name=>name===kind ||
        arrangement.parts[name].voice.instrument===kind);
      return Object.keys(tracks).find(name=>arrangement.parts[name].role===role);
    };
    const lead=role('lead'), bass=role('bass'), kick=role('percussion','kick'), snare=role('percussion','snare');
    const pad=role('pad'), hat=role('percussion','hat');
    const end=section.end-section.beat, meter=arrangement.score.tempoMap?.beatsPerBar ?? 4;
    const turn=Math.max(0,end-meter), at=beat=>score.clock.timeAt({beat:rounded(section.beat+beat)});
    const backing=part=>part ? score.events[part].filter(note=>note.time>=at(turn)-.1 && note.time<at(end)) : [];
    const harmony=harmonyAt(score,at(turn)), destination=harmonyAt(score,at(end)) ?? harmony;
    const notes=lead ? local(arrangement,lead,section) : [];
    const last=lead && score.events[lead].findLast(note=>note.beat<section.beat+turn);
    return {lead,bass,kick,snare,hat,pad,end,meter,turn,at,backing,harmony,destination,notes,last};
  }

  function proposeLead(score,section,ctx,seed) {
    const {lead,notes,backing,kick,snare,hat,bass,harmony,destination,turn,at,end,last}=ctx;
    if (!lead || !notes.length || !harmony || !destination) return null;
    const onsets=[...backing(kick),...backing(snare),...backing(hat)].sort((a,b)=>a.time-b.time);
    const low=backing(bass);
    const candidates=[];
    for (let step=1;step<(end-turn)*4-1;step++) {
      const beat=turn+step/4, time=at(beat)+A.grooveAt(score.tracks[lead].groove,section.beat+beat).delay;
      const drum=nearest(onsets,time), weight=drum?.velocity ?? 0;
      const margin=drum ? Math.abs(drum.time-time) : .25;
      const lowNote=nearest(low,time);
      const bassOverlap=lowNote && Math.abs(lowNote.time-time)<.06 ? lowNote.velocity : 0;
      const preference=Math.min(.2,margin)*3-weight*(margin<.06 ? .52 : 0)-bassOverlap*.27+
        ((hash([seed,section.id,step])>>>0)%997)/99700;
      candidates.push({beat,preference});
    }
    const opening=candidates.filter(row=>row.beat<turn+(end-turn)*.58).sort((a,b)=>b.preference-a.preference)[0];
    const ending=candidates.filter(row=>row.beat>=turn+(end-turn)*.58).sort((a,b)=>b.preference-a.preference)[0];
    if (!opening || !ending) return null;
    const anchor=last?.midi ?? 64, avoid=nearest(low,at(opening.beat))?.midi;
    const atOpening=tones(score,harmonyAt(score,at(opening.beat)) ?? harmony).map(pc);
    const atEnding=tones(score,harmonyAt(score,at(ending.beat)) ?? harmony).map(pc);
    const next=tones(score,destination).map(pc);
    if (!atOpening.length || !atEnding.length || !next.length) return null;
    const takeoff=nearestNote(atOpening,anchor+3,Math.max(0,anchor-7),Math.min(127,anchor+9),avoid);
    const retained=atEnding.filter(note=>next.includes(note));
    const landing=nearestNote(retained.length ? retained : next,takeoff-2,
      Math.max(0,anchor-9),Math.min(127,anchor+9),takeoff);
    const keep=notes.filter(note=>note.beat<turn);
    const pulse=Math.min(.28,ending.beat-opening.beat-.015);
    if (keep.length) keep.at(-1).duration=Math.min(keep.at(-1).duration,turn-keep.at(-1).beat);
    return sectionEdit(lead,section,[...keep,{beat:opening.beat,duration:pulse,midi:takeoff,velocity:.83,
      play:{brightness:.8,articulation:'pluck'}},
      {beat:ending.beat,duration:Math.min(end-ending.beat,(end-turn)*.5),midi:landing,velocity:.68,
        play:{brightness:.48,vibrato:9,articulation:'hold'}}]);
  }

  function proposePocket(score,section,ctx,locked) {
    const {bass,kick,snare,lead,backing,at,end,turn,destination}=ctx, edits=[];
    const anchors=backing(kick).filter(note=>note.beat>=section.beat+turn && note.velocity>.55);
    const melody=backing(lead);
    if (bass && !locked[bass] && anchors.length && destination) {
      const original=local(score.arrangement,bass,section);
      const keep=original.filter(note=>note.beat<turn);
      if (keep.length) keep.at(-1).duration=Math.min(keep.at(-1).duration,turn-keep.at(-1).beat);
      const landing=end-Math.min(.5,(end-turn)*.3);
      const hits=anchors.filter(note=>note.beat-section.beat<landing-.2).slice(0,2);
      const old=score.events[bass].findLast(note=>note.beat<section.beat+turn) ??
        score.events[bass].find(note=>note.beat>=section.beat+turn);
      const reference=old?.midi ?? 38;
      const fill=hits.map((note,i)=>{
        const beat=rounded(note.beat-section.beat), next=hits[i+1]?.beat-section.beat || landing;
        const chord=tones(score,harmonyAt(score,at(beat))).map(pc);
        const anchor=nearestNote(chord,reference,Math.max(0,reference-8),Math.min(127,reference+8));
        const difference=note.time-at(beat)-A.grooveAt(score.tracks[bass].groove,note.beat).delay;
        const delay=Math.max(-.125,Math.min(.125,difference));
        return {beat,midi:anchor,velocity:i ? .72 : .91,duration:Math.min(.56,next-beat-.015),
          play:{delay,brightness:i ? .45 : .66}};
      }).filter(note=>note.duration>=.012);
      const anchor=fill.at(-1)?.midi ?? reference;
      const endPitch=nearestNote([pc(H.midi(destination.root))],anchor,Math.max(0,anchor-8),Math.min(127,anchor+8));
      fill.push({beat:landing,midi:endPitch,velocity:.76,duration:Math.min(.31,end-landing),play:{glide:.025,brightness:.63}});
      edits.push(sectionEdit(bass,section,[...keep,...fill]));
    }
    if (snare && !locked[snare]) {
      const old=local(score.arrangement,snare,section), keep=old.filter(row=>row.beat<turn);
      if (old.length) {
        const endbar=old.filter(row=>row.beat>=turn), anchors=endbar.filter(row=>row.velocity>=.65);
        const pulse=[end-.25,end-.5,end-.75,end-1].find(beat=>{
          if (beat<turn) return false;
          const time=at(beat)+A.grooveAt(score.tracks[snare].groove,section.beat+beat).delay;
          const event=nearest(melody,time), nearestAnchor=anchors.reduce((min,r)=>Math.min(min,Math.abs(r.beat-beat)),Infinity);
          return nearestAnchor>=.16 && (!event || Math.abs(event.time-time)>.07);
        });
        if (pulse!==undefined) {
          if (keep.length) keep.at(-1).duration=Math.min(keep.at(-1).duration,turn-keep.at(-1).beat);
          const fill=[...anchors,{beat:pulse,duration:.07,degree:1,velocity:.43,
            play:{articulation:'ghost'}}].sort((a,b)=>a.beat-b.beat);
          for (let i=0;i<fill.length-1;i++) fill[i].duration=Math.min(fill[i].duration,fill[i+1].beat-fill[i].beat);
          edits.push(sectionEdit(snare,section,[...keep,...fill]));
        }
      }
    }
    return edits;
  }

  function suggest(source,options={},assets={}) {
    check(fields(options,['section','parts','seed','unpin','intent']) && Number.isSafeInteger(options.seed ?? 0) &&
      (options.unpin===undefined || Array.isArray(options.unpin)) &&
      [undefined,'lead','pocket','arrival'].includes(options.intent),'Invalid phrase suggestion options');
    const score=A.compile(source,assets), plan=score.arrangement;
    const section=options.section ? plan.sections.find(item=>item.id===options.section) :
      plan.sections[Math.max(0,plan.sections.length-2)];
    check(section && section.end-section.beat<=256 && section.bars>=1,'Choose a bounded arrangement section');
    const ctx=context(score,section,options.parts), locked=C.locks(plan,options.unpin), unpin=options.unpin ?? [];
    check(unpin.every(pin=>plan.pins.includes(pin)),'Suggestion unpin must name an active pin');
    const variants=[], blocked=[];
    const add=(kind,parts,summary,revision)=>{
      if (options.intent && kind!==options.intent) return;
      const held=parts.filter(name=>locked[name]);
      if (held.length) {
        blocked.push({id:kind,parts:held,pins:[...new Set(held.flatMap(name=>locked[name]))]});
        return;
      }
      if (!revision) return;
      const variant={id:kind,...revision,...(unpin.length && {unpin})};
      revise(source,variant,assets);
      variants.push({id:kind,section:section.id,parts,summary,revision:variant});
    };
    if (ctx.lead) add('lead',[ctx.lead],
      'Keep the hook and answer in gaps between audible drum attacks, aiming at the next harmony.',
      options.intent && options.intent!=='lead' || locked[ctx.lead] ? null : (()=>{
        const edit=proposeLead(score,section,ctx,options.seed ?? 0);
        return edit && {edits:[edit]};
      })());
    if (!options.intent || options.intent==='pocket') {
      const edits=proposePocket(score,section,ctx,locked);
      if (edits.length) add('pocket',edits.map(row=>row.part),
        'Anchor the bass to the kick, anticipate the next root, and place a snare pickup in a lead gap.',{edits});
    }
    const pad=ctx.pad;
    if (pad && score.tracks[pad].pad && (!options.intent || options.intent==='arrival')) {
      const old=source.tracks[pad].pad, config=score.tracks[pad].pad;
      const anchors=ctx.destination ? tones(score,ctx.destination).map(pc) : [];
      const anchor=anchors.length ? nearestNote(anchors,Math.min(config.max,config.top+4),config.min,config.max,config.top) : config.top;
      const rhythm={every:Math.min(2,ctx.meter),length:Math.min(1.7,ctx.meter),offset:Math.min(.25,ctx.meter/4),velocity:.76};
      add('arrival',[pad],'Revoice the pad toward the destination chord and give it staggered pulses.',
        {tracks:{[pad]:{pad:{...old,sections:{...old.sections,[section.id]:{
          ...old.sections?.[section.id],anchor,spread:.042,tie:true,brightness:.68,rhythm}}}}}});
    }
    return P.data.freeze({section:section.id,variants,blocked});
  }

  function renderedAnalysis(score,raw) {
    check(fields(raw,['start','end','sampleRate','kick','bass']),'Invalid rendered analysis options');
    const {start=0,end=Math.min(score.end,start+20),sampleRate=16000}=raw;
    check(finite(start,0,score.end) && finite(end,start,score.end) && end>start && end-start<=30 &&
      integer(sampleRate,8000,48000),'Rendered analysis needs a window of up to thirty seconds');
    const {report,stems}=A.renderCompiled(score,{start,end,sampleRate,stems:true});
    const level=({samples})=>{
      let sum=0, peak=0;
      for (const x of samples) {sum+=x*x;peak=Math.max(peak,Math.abs(x));}
      return {rms:Math.sqrt(sum/samples.length),peak};
    };
    const first=report.firstSample, frames=report.endSample-first;
    const names=Object.keys(score.tracks);
    const kick=raw.kick ?? names.find(name=>name==='kick' || score.arrangement.parts[name].voice.instrument==='kick');
    const bass=raw.bass ?? names.find(name=>score.arrangement.parts[name].role==='bass');
    check([kick,bass].every(name=>name===undefined || names.includes(name)) && (kick===undefined || kick!==bass),
      'Choose distinct production tracks for kick and bass analysis');
    const lowEnd=[];
    if (kick && bass) {
      const attacks=score.events[kick].filter(note=>note.time>=start && note.time<end && note.velocity>.25);
      const band=(audio)=>{
        const a=1-Math.exp(-2*Math.PI*30/sampleRate), b=1-Math.exp(-2*Math.PI*180/sampleRate);
        const summed=new Float64Array(frames+1);
        let low=0, high=0;
        for (let n=0;n<frames;n++) {
          const mono=(audio.samples[n*2]+audio.samples[n*2+1])*.5;
          low+=(mono-low)*a;
          high+=(mono-low-high)*b;
          summed[n+1]=summed[n]+high*high;
        }
        return summed;
      };
      const x=band(stems[kick]), y=band(stems[bass]);
      for (const note of attacks) {
        const at=Math.max(0,Math.ceil(note.time*sampleRate)-first), to=Math.min(frames,at+Math.round(.065*sampleRate));
        if (to<=at) continue;
        const k=x[to]-x[at], b=y[to]-y[at];
        lowEnd.push({beat:note.beat,time:note.time,kickRms:Math.sqrt(k/(to-at)),bassRms:Math.sqrt(b/(to-at)),
          bassOverKickDb:k>1e-15 && b>1e-15 ? Number((10*Math.log10(b/k)).toFixed(2)) : null});
      }
    }
    return {...report,start,end,stems:Object.fromEntries(Object.entries(stems).map(([name,stem])=>[name,level(stem)])),
      ...(kick && bass && {lowEnd:{tracks:[kick,bass],bandHz:[30,180],windowSeconds:.065,attacks:lowEnd}})};
  }

  function analyze(source,assets={},options={}) {
    check(fields(options,['section','window','audio']) && finite(options.window ?? .055,.005,.2),
      'Invalid production analysis options');
    const score=A.compile(source,assets), window=options.window ?? .055, plan=score.arrangement;
    const sections=plan.sections.filter(section=>options.section===undefined || section.id===options.section);
    check(sections.length,'Unknown production analysis section');
    const details=sections.map(section=>{
      const rows=Object.fromEntries(Object.entries(score.events).map(([part,notes])=>[part,
        notes.filter(note=>note.time>=section.time && note.time<section.endTime)]));
      const pairs=[];
      const names=Object.keys(rows);
      for (let i=0;i<names.length;i++) for (const second of names.slice(i+1)) {
        const first=names[i], both=rows[first].filter(note=>note.velocity>=.55).flatMap(note=>{
          const hit=nearest(rows[second],note.time);
          return hit && hit.velocity>=.55 && Math.abs(hit.time-note.time)<=window ?
            [{beat:note.beat,otherBeat:hit.beat,milliseconds:rounded((hit.time-note.time)*1000)}] : [];
        });
        if (both.length) pairs.push({parts:[first,second],count:both.length,examples:both.slice(0,16)});
      }
      const next=score.arrangement.sections.find(row=>row.beat===section.end);
      const crossing=next ? Object.values(score.events).flatMap(track=>track.filter(note=>
        note.time<next.time && note.time+note.gate>next.time && plan.parts[note.part].role!=='percussion')
        .map(note=>({part:note.part,note:H.pitchName(note.midi)}))) : [];
      const harmony=score.program.events.filter(row=>row.time>=section.time && row.time<section.endTime)
        .map(row=>({beat:row.beat,root:row.root,quality:row.quality}));
      return {id:section.id,range:[section.time,section.endTime],pairs,harmony,crossing,
        attacks:Object.fromEntries(Object.entries(rows).map(([part,notes])=>[part,notes.length]))};
    });
    return P.data.freeze({duration:score.end,window,sections:details,
      ...(options.audio!==undefined && {audio:renderedAnalysis(score,options.audio)})});
  }
  P.musicProduction=Object.freeze({...A,revise,suggest,analyze});
})(KIT.procedural);
