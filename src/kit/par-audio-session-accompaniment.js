/* Arrange a response and three returns around the performance selected on the session timeline. */
(function (P) {
  const S=P.mediaGraphSupport, A=P.musicProduction;
  const {fields,integer,check}=P.musicInstruments;
  const {clone,freeze}=P.data;
  const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
  const round=value=>Number(value.toFixed(9));
  const intersects=(a,b)=>a.from<b.to && b.from<a.to;
  const contains=(span,sample)=>sample>=span.from && sample<span.to;

  function selected(plan,lane,span) {
    const {reference}=S.musicSessionModel;
    const slots=plan.choices.filter(row=>row.lane===lane && intersects(row,span));
    const edges=[span.from,...slots.flatMap(row=>[Math.max(row.from,span.from),Math.min(row.to,span.to)]),span.to];
    return edges.slice(0,-1).flatMap((from,index)=>{
      const to=edges[index+1], pick=index%2 ? slots[(index-1)/2] : null;
      if (from===to) return [];
      if (!pick || !pick.fadeSamples || pick.take===reference)
        return [{take:pick?.take ?? reference,from,to,weight:()=>1}];
      const weight=sample=>Math.min(1,(sample-pick.from)/pick.fadeSamples,(pick.to-1-sample)/pick.fadeSamples);
      const tail=[
        {from,to:Math.min(to,pick.from+pick.fadeSamples)},
        {from:Math.max(from,pick.to-pick.fadeSamples),to}
      ].filter(row=>row.from<row.to);
      return [{take:pick.take,from,to,weight},...tail.map(row=>({...row,take:reference,weight:sample=>1-weight(sample)}))];
    });
  }

  function performance(plan,lane,span) {
    const rows=[], {rate}=plan, block=Math.max(1,Math.round(.004*rate));
    let work=0;
    for (const {take,from,to,weight} of selected(plan,lane,span)) {
      const {score}=plan.producers.get(take), track=score.tracks[lane];
      check(!track.external,'Performance analysis needs a native playable lead');
      for (const note of score.events[lane]) {
        if (!contains({from,to},Math.round(note.time*rate))) continue;
        const voice=A.prepareVoice(track,note,score.end,rate,score.cue?.perTrack[lane].tail);
        const start=Math.max(from,voice.first), end=Math.min(to,voice.last);
        if (end-start<block) continue;
        const length=end-voice.first;
        check((work+=length)<=rate*160,'Lead analysis exceeds its voice budget. Shorten the listening ranges');
        const pcm=new Float64Array(2*length), levels=[];
        voice.write(pcm,voice.first,end);
        let peak=0;
        for (let sample=start;sample<end;sample+=block) {
          let power=0;
          const stop=Math.min(sample+block,end);
          for (let i=sample;i<stop;i++) {
            const offset=2*(i-voice.first), gain=weight(i);
            power+=(pcm[offset]**2+pcm[offset+1]**2)*gain*gain;
          }
          const rms=Math.sqrt(power/(2*(stop-sample)));
          levels.push({sample,stop,rms});
          peak=Math.max(peak,rms);
        }
        if (peak*track.mix.gain*score.gain<.00015) continue;
        const threshold=peak*.09, attack=levels.find(row=>row.rms>=threshold);
        const release=levels.findLast(row=>row.rms>=threshold);
        const gateEnd=Math.min(end,Math.round((note.time+note.gate)*rate),release.stop);
        if (gateEnd<=attack.sample) continue;
        rows.push({take,clip:note.clip ?? null,voice:note.voice ?? null,note:note.note ?? null,beat:note.beat,
          onset:attack.sample,gateEnd,decayEnd:release.stop,midi:note.midi,velocity:note.velocity,peak});
      }
    }
    rows.sort((a,b)=>a.onset-b.onset || b.peak-a.peak);
    const attacks=[];
    for (const row of rows) {
      const prior=attacks.at(-1);
      // A crossfade or a chord can sound as a single attack.
      if (prior && row.onset-prior.onset<rate*.025) {
        if (row.peak>prior.peak) attacks[attacks.length-1]=row;
      } else attacks.push(row);
    }
    return attacks;
  }

  function events(plan,lane,span) {
    return selected(plan,lane,span).flatMap(({take,from,to})=>plan.producers.get(take).score.events[lane]
      .map(note=>({from:Math.max(from,Math.round(note.time*plan.rate)),
        to:Math.min(to,Math.round(Math.min(note.time+note.gate,note.choke ?? Infinity)*plan.rate)),note,take}))
      .filter(row=>row.to>row.from)).sort((a,b)=>a.from-b.from);
  }

  function gapAfter(occupied,from,to,min) {
    for (const row of occupied) {
      if (row.from>=to) break;
      if (row.from-from>=min) return {from,to:row.from};
      from=Math.max(from,row.to);
    }
    return {from,to};
  }

  function addNotes(plan,session,additions,clock) {
    const beat=sample=>round(clock.sample(sample/plan.rate).beat);
    function clips(source,lane,rows) {
      const clips=clone(source.tracks[lane].clips ?? []);
      const layers=clips.filter(clip=>clip.mode==='layer').sort((a,b)=>a.beat-b.beat);
      const scores=[];
      for (const row of rows) {
        const start=beat(row.from), end=beat(row.to);
        let clip=layers.find(clip=>clip.beat<=start && start<round(clip.beat+clip.length));
        if (!clip) {
          const boundary=layers.find(clip=>clip.beat>start)?.beat ?? beat(plan.frames);
          const clipStart=Math.min(start,boundary-.0625);
          const previous=layers.findLast(clip=>clip.beat<start);
          check(clipStart>=0 && (!previous || clipStart>=round(previous.beat+previous.length)),
            'No note-clip room for '+row.id+' on '+lane);
          clip={id:row.id,beat:round(clipStart),length:round(Math.min(boundary,Math.max(end,clipStart+.0625))-clipStart),
            mode:'layer',voices:[]};
          check(!clips.some(other=>other.id===clip.id),'A clip already uses '+clip.id);
          clips.push(clip);
          layers.push(clip);
          layers.sort((a,b)=>a.beat-b.beat);
        }
        let voice=scores.find(score=>score.clip===clip)?.voice;
        if (!voice) {
          let name='performance-response';
          for (let i=2;clip.voices.some(row=>row.id===name);i++) name='performance-response-'+i;
          voice={id:name,notes:[]};
          clip.voices.push(voice);
          scores.push({clip,voice});
        }
        const duration=round(Math.min(end,round(clip.beat+clip.length))-start);
        check(duration>=1e-5,'No room within the note clip for '+row.id);
        voice.notes.push({id:row.id,beat:round(start-clip.beat),duration,midi:row.midi,
          velocity:row.velocity,...(row.pitchCents!==undefined && {play:{curves:{pitchCents:[[0,row.pitchCents]]}}})});
      }
      return clips;
    }
    const {reference}=S.musicSessionModel;
    for (const [lane,rows] of Object.entries(additions)) {
      if (!rows.length) continue;
      const takes=new Map();
      for (const row of rows) for (const {take} of selected(plan,lane,row)) {
        if (!takes.has(take)) takes.set(take,new Set());
        takes.get(take).add(row);
      }
      // A take with no clip override inherits the revised reference clips.
      // Give it its original clips explicitly when it should only play a subset of the new notes.
      const baseline=takes.get(reference);
      if (baseline) session.production.tracks[lane].clips=clips(plan.producers.get(reference).source,lane,baseline);
      for (const [take,{source}] of plan.producers) {
        if (take===reference) continue;
        const edits=takes.get(take);
        const original=session.takes[take].tracks?.[lane]?.clips;
        if (!edits && (!baseline || original!==undefined)) continue;
        if (edits && baseline && original===undefined && baseline.size===edits.size &&
            [...edits].every(row=>baseline.has(row))) continue;
        const revision=session.takes[take];
        revision.tracks ??= {};
        revision.tracks[lane]={...revision.tracks[lane],clips:edits ? clips(source,lane,edits) : clone(source.tracks[lane].clips ?? [])};
      }
    }
  }

  function mute(session,lane,{from,to},ramp,frames,reveal=false) {
    const mixer=session.mixer ??= {output:'master',strips:{master:{}}};
    mixer.processors ??= {};
    let name='return-space-'+lane.slice(0,28);
    for (let i=2;Object.hasOwn(mixer.processors,name);i++) name='return-space-'+lane.slice(0,28)+'-'+i;
    const sharp=Math.min(ramp,Math.floor((to-from)/3));
    const marks=new Map([[Math.max(0,from-sharp),0],[from,-96],
      [reveal ? to-sharp : to-1,-96],[Math.min(frames,reveal ? to : to+sharp),0]]);
    mixer.processors[name]={type:'gain',db:{unit:'samples',curve:'linear',
      points:[...marks].map(([at,value])=>({at,value}))}};
    const strip=mixer.strips[lane] ??= {};
    strip.inserts=[...(strip.inserts ?? []),name];
  }

  function draft(compile,session,brief,mode) {
    const plan=compile(session), {reference}=S.musicSessionModel, {rate,frames}=plan;
    const {score}=plan.producers.get(reference), {clock}=score;
    check(fields(brief,['lead','bass','metal','response','hook','context','withhold','support','bassMidi','returnMidi','metalMidi']) &&
      ['lead','bass','metal'].every(role=>Object.hasOwn(score.tracks,brief[role])) &&
      new Set([brief.lead,brief.bass,brief.metal]).size===3,'Choose distinct lead, bass and metal score lanes');
    const {lead,bass,metal,bassMidi,returnMidi,metalMidi=60}=brief;
    const support=brief.support ?? plan.lanes.filter(lane=>lane!==lead);
    check(Array.isArray(support) && new Set(support).size===support.length && Array.from(support).every(lane=>
      lane!==lead && plan.sourceLanes.includes(lane)) && support.includes(bass) && support.includes(metal) &&
      !plan.pins[bass] && !plan.pins[metal] && plan.pins[lead]!=='all' &&
      support.every(lane=>plan.pins[lane]!=='all') &&
      [bassMidi,returnMidi].every(note=>note===undefined || integer(note,0,127)) && integer(metalMidi,12,115),
    'Choose editable bass, metal and support lanes, and valid MIDI anchors');
    const span=(raw,label)=>{
      check(fields(raw,['from','to']) && raw.from!==undefined && raw.to!==undefined,'Choose a '+label+' range');
      return plan.range(raw.from,raw.to);
    };
    const response=span(brief.response,'response'), hook=span(brief.hook,'hook'), context=span(brief.context,'context');
    check(context.from<=response.from && response.to<=hook.from && hook.to<context.to && hook.from>context.from &&
      (context.to-context.from)*6<=18e6,'The context must contain the response, return and aftermath within its audio budget');
    const least=Math.round(rate*.045), late=Math.round(rate*.055), ramp=Math.round(rate*.012), bassMin=Math.round(rate*.12);
    const withhold=brief.withhold===undefined ? Math.max(context.from,
      plan.at({beat:Math.max(0,clock.sample(hook.from/rate).beat-1)})) : plan.at(brief.withhold);
    check(withhold>=context.from && withhold<hook.from,'The withheld bass needs a lead-in before the return');
    const keyAt=sample=>{
      const root=P.musicHarmony.midi(score.program.events.findLast(row=>row.time<=sample/rate)?.root ?? score.arrangement.score.key.root);
      return 36+(root%12>7 ? root%12-12 : root%12);
    };
    const reserved=new Set([...plan.producers.values()].flatMap(({score})=>
      [bass,metal].flatMap(lane=>score.events[lane].map(note=>note.note))));
    const noteId=base=>{
      let name=base;
      for (let i=2;reserved.has(name);i++) name=base+'-'+i;
      reserved.add(name);
      return name;
    };
    const approach=performance(plan,lead,response), theme=performance(plan,lead,hook);
    check(approach.length>=2 && theme.length>=1,'Use a response with at least two lead attacks and an articulated hook');
    const occupiedBass=events(plan,bass,response), occupiedMetal=events(plan,metal,response);
    const held=approach.map((row,i)=>({...row,next:approach[i+1]?.onset ?? response.to}))
      .sort((a,b)=>(b.gateEnd-b.onset)-(a.gateEnd-a.onset));
    const reply=held.map(row=>{
      const end=Math.min(row.next-late,response.to);
      const gap=gapAfter(occupiedBass,row.gateEnd+late,end,bassMin);
      return {row,from:gap.from,to:Math.min(gap.from+Math.round(rate*.42),gap.to)};
    }).find(row=>row.to-row.from>=bassMin);
    check(reply,'Leave a bass opening after a held lead note in the response range');
    const answer={id:noteId('bass-answer'),from:reply.from,to:reply.to,midi:bassMidi ?? keyAt(reply.from),
      velocity:clamp(.73*reply.row.velocity+.12,.3,.86)};
    let pickup;
    for (let i=approach.length-1;i>=1 && !pickup;i--) {
      const row=approach[i], prior=approach[i-1], gap=approach[i+1]?.onset ?? response.to;
      const interval=row.onset-prior.onset;
      if (row.onset===reply.row.onset) continue;
      for (const ratio of [1,.5,.75,1.25]) {
        const from=row.onset+Math.round(interval*ratio), to=from+least;
        if (from<row.gateEnd+least || to+late>gap ||
            occupiedMetal.some(hit=>intersects(hit,{from:from-least,to:to+least}))) continue;
        pickup={hit:{id:noteId('metal-answer'),from,to,midi:metalMidi,velocity:clamp(row.velocity*.63+.17,.35,.83)},
          prior,row,ratio};
        break;
      }
    }
    check(pickup,'Leave a gap for the metal to echo a lead interval or a subdivision');
    const drum=[...plan.producers.values()].every(({source,score})=>
      source.patches[score.tracks[metal].patch].type==='drum');
    const first=theme[0];
    const bassAtHook=events(plan,bass,hook);
    const existing=returnMidi===undefined ? bassAtHook.find(row=>row.from<first.onset+late && row.to>first.onset+least) : undefined;
    const anchor=existing ? null : {id:noteId('bass-return'),from:first.onset,
      to:bassAtHook.find(row=>row.from>=first.onset)?.from ?? hook.to,
      midi:returnMidi ?? bassMidi ?? keyAt(first.onset),velocity:.85};
    check(!anchor || anchor.to-anchor.from>=least,'Leave room for the low return note or use a sustained bass note at the hook');
    const strike=theme.map((row,i)=>{
      const shift=clamp(row.midi-first.midi,drum ? -12 : -metalMidi,drum ? 12 : 127-metalMidi);
      return {id:noteId('hook-metal-'+(i+1)),from:row.onset,to:Math.min(hook.to,row.onset+least,theme[i+1]?.onset ?? Infinity),
        midi:metalMidi+shift,velocity:clamp(row.velocity*.8+.23,.4,1),
        ...(drum && {pitchCents:shift*100})};
    }).filter(row=>row.to-row.from>=rate*.010);
    check(strike.length>0,'The metal hook needs space for at least one attack');
    const variants={}, plans={}, returns=[];
    check(mode===undefined || ['exposed','withheld','handoff'].includes(mode),'Choose a known accompaniment return');
    for (const id of mode ? [mode] : ['exposed','withheld','handoff']) {
      const next=clone(session), destinations=[answer,pickup.hit];
      const onMetal=id==='handoff';
      const metalNotes=onMetal ? strike : [];
      if (onMetal) for (const note of metalNotes) destinations.push(note);
      if (id==='withheld' && anchor) destinations.push(anchor);
      addNotes(plan,next,{[bass]:[answer,...(id==='withheld' && anchor ? [anchor] : [])],
        [metal]:[pickup.hit,...metalNotes]},clock);
      const foreground=id==='withheld' ? [lead,bass] : onMetal ? [metal] : [lead];
      for (const lane of [...support,lead]) if (!foreground.includes(lane)) mute(next,lane,hook,ramp,frames);
      const reveal=existing?.from>first.onset ? existing.from : first.onset;
      if (id==='withheld') mute(next,bass,{from:withhold,to:reveal},ramp,frames,true);
      const candidate=compile(next);
      const placed=Object.fromEntries([bass,metal].map(lane=>[lane,events(candidate,lane,context)
        .filter(row=>destinations.some(note=>note.id===row.note.note))
        .map(row=>({id:row.note.note,take:row.take,clip:row.note.clip,voice:row.note.voice,sample:row.from,midi:row.note.midi}))]));
      check(destinations.every(note=>Object.values(placed).flat().some(row=>row.id===note.id)),
        'An accompaniment note is suppressed by the current score or take');
      returns.push({id,foreground,events:placed});
      variants[id]=freeze(next);
      plans[id]=candidate;
    }
    const report={format:'ink-studio/performance-accompaniment',version:1,sampleRate:rate,lead,bass,metal,support:[...support],
      ranges:{response,hook,context},attacks:{response:approach,hook:theme},
      replies:{bass:{hold:reply.row,...answer},metal:{previous:pickup.prior,call:pickup.row,ratio:pickup.ratio,...pickup.hit}},
      bassReturn:anchor ?? {lane:bass,from:existing.from,to:existing.to,midi:existing.note.midi,authored:true},
      percussionHook:strike,withhold,returns};
    return {report,sessions:variants,plans};
  }

  S.createPerformanceAccompaniment=({compile,render})=>{
    function run(session,brief) {
      const {report,sessions,plans}=draft(compile,session,brief), {context}=report.ranges, {samples}=S.musicSessionModel;
      const heard=report.returns.map(row=>{
        const audio=render(plans[row.id],{from:samples(context.from),to:samples(context.to)});
        return {row,audio,headroom:audio.report.mixer.headroom ?? 1};
      });
      const gain=Math.min(...heard.map(row=>row.headroom)), clips={};
      const returns=heard.map(({row,audio,headroom})=>{
        const scale=gain/headroom;
        clips[row.id]=scale===1 ? audio.value : {...audio.value,samples:Float64Array.from(audio.value.samples,value=>value*scale)};
        return {...row,renderPath:audio.report.renderPath};
      });
      return {report:freeze({...report,gain,returns}),clips,sessions};
    }
    return {run,draft:(session,brief,mode)=>draft(compile,session,brief,mode)};
  };
})(KIT.procedural);
