/* Phrase shapes, score diagnostics, and section-scoped revision proposals. */
(function (K) {
  const P = K.procedural, C = P.musicComposer, M = C.motif, T = P.takeTime;
  const {fields,finite,integer,require,partLocks,unpack} = P.composerSupport;
  delete P.composerSupport;
  const round = value => Number(value.toFixed(6));
  const rngFor = (operation,seed) => K.grow.dice(P.data.hash(JSON.stringify([operation,seed])));
  const choose = (values,rng) => values[Math.floor(rng()*values.length)];

  function makePhrase(options = {}) {
    require(fields(options,['beatsPerBar','bars','style','degrees','start','end','seed']),'Invalid phrase options');
    const {beatsPerBar=4,bars=4,style='lyrical',degrees=[1,2,3,5,6],start=1,end=start,seed=0} = options;
    require(integer(beatsPerBar,1,32) && [2,4].includes(bars) && ['lyrical','syncopated'].includes(style) &&
      Array.isArray(degrees) && degrees.length <= 72 && new Set(degrees).size >= 2 &&
      Array.from(degrees).every(degree=>integer(degree,-35,36)) && degrees.includes(start) && degrees.includes(end) &&
      Number.isSafeInteger(seed),'A phrase needs a valid meter, two or four bars, style, degree set, and seed');
    const rng = rngFor('phrase',seed);
    const away = degrees.filter(degree=>degree!==start);
    const turn = choose(away,rng);
    const crest = degrees.reduce((best,degree)=>Math.abs(degree-start)>Math.abs(best-start) ? degree : best,turn);
    const step = degrees.filter(degree=>degree!==end).sort((a,b)=>Math.abs(a-end)-Math.abs(b-end))[0];
    const sync = style==='syncopated';
    const [pickup,lift,turnAt] = choose(sync ? [[1,5,9],[0,3,10],[2,5,11]] : [[0,4,10],[0,5,10],[1,5,9]],rng);
    const answerAt = choose(sync ? [3,5,7] : [2,3.5,5],rng);
    // Positions and gates are in sixteenths of a bar. The return quotes the first two events.
    const call = [[pickup,2,start,.79],[lift,sync?1.3:2.7,turn,.69],[turnAt,2.8,crest,.94]];
    const answer = [[answerAt,2.7,step,.72],[sync?10:8,sync?3.4:4.7,end,.85]];
    const episodes = bars===2 ? [call,answer] :
      [call,[[5,3.2,turn,.64],[11,1.8,step,.74]],call.slice(0,2).concat([[11,2.4,crest,.98]]),answer];
    return M.motif({length:bars*beatsPerBar,events:episodes.flatMap((episode,bar)=>
      episode.map(([beat,duration,degree,velocity])=>({
        beat:beatsPerBar*(bar+beat/16),duration:beatsPerBar*duration/16,degree,velocity
      })))});
  }

  function measure(notes,start,end,carry) {
    let cursor = Math.min(end,Math.max(start,carry)), occupied = cursor-start, longestRest = 0;
    let minVelocity=1, maxVelocity=0, minDuration=Infinity, maxDuration=0;
    for (const {beat,duration,velocity} of notes) {
      longestRest = Math.max(longestRest,beat-cursor);
      cursor = Math.min(end,beat+duration);
      occupied += cursor-beat;
      minVelocity = Math.min(minVelocity,velocity);
      maxVelocity = Math.max(maxVelocity,velocity);
      minDuration = Math.min(minDuration,duration);
      maxDuration = Math.max(maxDuration,duration);
    }
    const range = (min,max) => notes.length ? [round(min),round(max)] : null;
    return {onsets:notes.length,occupied:round(occupied/(end-start)),
      longestRest:round(Math.max(longestRest,end-cursor)),velocity:range(minVelocity,maxVelocity),
      gateBeats:range(minDuration,maxDuration)};
  }

  function inspectScore(plan) {
    const beatsPerBar = plan.score.tempoMap?.beatsPerBar ?? 4;
    const notesByPart = new Map(Object.keys(plan.parts).map(part=>[part,[]]));
    for (const note of plan.cues) notesByPart.get(note.part).push(note);
    const findings=[], parts={};
    for (const [part,notes] of notesByPart) {
      const {role,voice} = plan.parts[part];
      const buckets = Array.from({length:plan.report.bars},()=>[]);
      for (const note of notes) buckets[Math.floor(note.beat/beatsPerBar)].push(note);
      const signatures = buckets.map((row,i)=>row.length<2 ? null : JSON.stringify(row.map(note=>[
        round(note.beat-i*beatsPerBar),role==='percussion' ? 0 :
          note.midi!==undefined && row[0].midi!==undefined ? note.midi-row[0].midi :
            note.degree-row[0].degree
      ])));
      for (let bar=0;bar<signatures.length;) {
        let next=bar+1;
        while (signatures[bar] && signatures[bar]===signatures[next]) next++;
        if (next-bar>=2) findings.push({
          id:part+'-repeat-'+(bar+1),kind:'repeated-bar',part,role,bars:[bar+1,next],
          evidence:{barsInRun:next-bar,onsetsPerBar:buckets[bar].length},
          summary:role==='percussion' ? 'Attack pattern repeats on the same beats.' :
            'The same relative scale degrees and attack positions recur each bar.'
        });
        bar=next;
      }
      let at=0, carry=0;
      const sections = plan.sections.map((section,index)=>{
        const start=at;
        while (at<notes.length && notes[at].beat<section.end) at++;
        const slice=notes.slice(start,at), sustain=plan.materials[part][index].sustain;
        const stats=measure(slice,section.beat,section.end,carry);
        if (slice.length) carry=slice.at(-1).beat+slice.at(-1).duration;
        const bars=[section.bar+1,section.bar+section.bars];
        if (stats.onsets>=6 && stats.velocity[1]-stats.velocity[0]<=.16 && stats.gateBeats[1]-stats.gateBeats[0]<=.035)
          findings.push({id:part+'-articulation-'+bars[0],kind:'uniform-articulation',part,role,bars,
            section:section.id,evidence:{onsets:stats.onsets,velocity:stats.velocity,gateBeats:stats.gateBeats},
            summary:'Attacks and note lengths stay within a narrow range.'});
        return {id:section.id,bars,material:sustain?'sustain':plan.materials[part][index].value?'motif':'none',
          ...stats,...(sustain && {occupied:1,longestRest:0})};
      });
      parts[part]={role, gain:voice.gain,sections};
    }
    return {meter:beatsPerBar,bars:plan.report.bars,duration:plan.report.duration,parts,findings};
  }

  function audioMetrics(plan,options) {
    require(fields(options,['start','end','sampleRate']),'Audio analysis needs named window options');
    const {start=0,end=Math.min(plan.report.duration,start+20),sampleRate=16000}=options;
    require(finite(start,0,plan.report.duration) &&
      finite(end,start,plan.report.duration) && end>start && end-start<=30 && integer(sampleRate,8000,48000),
      'Choose an audio range within the arrangement, up to thirty seconds at 8–48 kHz');
    const rendered=P.musicScore.compile(plan.score).audio({start,end,sampleRate,stems:true});
    const {firstSample,endSample}=rendered.report;
    const clock=P.musicTiming.compile(plan.score.tempoMap);
    const rate=T.read(sampleRate);
    const at=bar=>Math.min(endSample,Math.max(firstSample,T.index(T.roundDown(T.mul(clock.resolve({bar}),rate)))));
    const b0=Math.max(0,clock.sample(start).bar), b1=clock.sample(end).bar;
    const bars=[];
    const levels=(samples,from,to)=>{
      let squares=0, peak=0;
      for (let i=2*(from-firstSample);i<2*(to-firstSample);i++) {
        const magnitude=Math.abs(samples[i]);
        squares+=magnitude*magnitude;
        peak=Math.max(peak,magnitude);
      }
      return {rms:round(Math.sqrt(squares/(2*(to-from)))),peak:round(peak)};
    };
    for (let bar=b0;bar<=b1 && bar<plan.report.bars;bar++) {
      const from=at(bar),to=at(bar+1);
      if (from>=to) continue;
      bars.push({bar:bar+1,start:from/sampleRate,end:to/sampleRate,
        mix:levels(rendered.value.samples,from,to),
        stems:Object.fromEntries(Object.entries(rendered.stems).map(([part,stem])=>[part,levels(stem.samples,from,to)]))});
    }
    return {sampleRate,firstSample,endSample,mix:levels(rendered.value.samples,firstSample,endSample),bars};
  }

  function analyze(source,options = {}) {
    require(fields(options,['audio']),'Analysis options accept an audio window');
    const plan=unpack(source), report=inspectScore(plan);
    return options.audio===undefined ? report : {...report,audio:audioMetrics(plan,options.audio)};
  }

  const editableNotes = (plan,part,section) => plan.cues.filter(note=>note.part===part && note.section===section.id)
    .map(({beat,duration,degree,velocity,midi,play})=>({beat:beat-section.beat,
      duration:Math.min(duration,section.end-beat),degree,velocity,
      ...(midi!==undefined && {midi}),...(play && {play})}));

  function shape(eligible,start,end,kind,rng) {
    const range = end-start;
    if (kind==='shape-dynamics') {
      const peak = Math.floor((eligible.length-1)*.68);
      return eligible.map((note,i)=>{
        const accent = 1-Math.abs(i-peak)/Math.max(1,peak,eligible.length-1-peak);
        return {...note,velocity:round(Math.min(1,note.velocity*(.70+.46*accent))),
          duration:Math.max(1e-5,Math.min((eligible[i+1]?.beat ?? end)-note.beat,note.duration*(.66+.62*accent)))};
      });
    }
    const first = eligible[0], last = eligible.at(-1);
    if (kind==='break-and-fill') {
      const ghost = start+range*.6875, answer = start+range*.875;
      return [
        {...first,beat:Math.min(first.beat,start+range*.5),duration:Math.min(first.duration,range*.12)},
        {beat:ghost,duration:range*.035,degree:1,velocity:.36},
        {beat:answer,duration:range*.048,degree:1,velocity:.79}
      ];
    }
    const pitch=note=>({degree:note.degree,...(note.midi!==undefined && {midi:note.midi})});
    if (kind==='bass-anticipation') return [
      {...first,beat:Math.min(first.beat,start+range*.5),duration:Math.min(first.duration,range*.25)},
      {beat:start+range*.875,duration:range*.09,...pitch(first),velocity:.63}
    ];
    const contrast=note=>Math.abs(note.midi!==undefined && last.midi!==undefined ? note.midi-last.midi : note.degree-last.degree);
    const high = eligible.reduce((best,note)=>contrast(note)>contrast(best) ? note : best,first);
    const pickup=start+range*choose(kind==='held-response' ? [.5,.5625] : [.4375,.5625],rng);
    const resolution=start+range*.75;
    if (kind==='held-response') return [
      {beat:pickup,duration:resolution-pickup,...pitch(high),velocity:.87},
      {beat:resolution,duration:range*.21,...pitch(last),velocity:.69}
    ];
    return [
      {beat:pickup,duration:range*.055,...pitch(high),velocity:.88},
      {beat:start+range*.625,duration:range*.08,...pitch(eligible[1]),velocity:.67},
      {beat:resolution,duration:range*.21,...pitch(last),velocity:.78}
    ];
  }

  const suggestions = {
    'call-and-answer':'Quote the hook, leave the start of the last bar open, then answer with a pickup and a longer landing.',
    'held-response':'Keep the earlier hook. Answer with two held notes and let the other parts carry the first half of the last bar.',
    'break-and-fill':'Start the last bar with a single hit, leave a gap, then play a quiet pickup and stronger reply.',
    'bass-anticipation':'Leave space after the bass attack and bring its opening note back just ahead of the next bar.',
    'shape-dynamics':'Keep the pitches and attack positions. Shape the velocities and gates around a late accent.'
  };

  function suggest(source,options = {}) {
    require(fields(options,['part','section','seed','limit','unpin']),'Invalid suggestion options');
    const plan=unpack(source), {part,section,seed=0,limit=6,unpin=[]}=options;
    require((part===undefined || Object.hasOwn(plan.parts,part)) &&
      (section===undefined || plan.sections.some(row=>row.id===section)) &&
      Number.isSafeInteger(seed) && integer(limit,1,8) && Array.isArray(unpin) &&
      unpin.length<=136 && Array.from(unpin).every(pin=>plan.pins.includes(pin)),
      'Choose a known part or section, one to eight alternatives, and existing pins to release');
    const held=partLocks(plan.definition,plan.pins.filter(pin=>!unpin.includes(pin)));
    const report=inspectScore(plan), targets=[];
    for (const [name,info] of Object.entries(report.parts)) {
      if ((part!==undefined && part!==name) || info.role==='visual' || !info.gain) continue;
      for (const [index,stats] of info.sections.entries()) {
        if (stats.material!=='motif' || (section!==undefined && section!==stats.id)) continue;
        const span=plan.sections[index];
        if (span.end-span.beat>256 || stats.onsets>512) continue;
        for (const finding of report.findings) {
          if (finding.part!==name) continue;
          const [first,last]=finding.bars;
          const count=Math.min(last,stats.bars[1])-Math.max(first,stats.bars[0])+1;
          if ((finding.section && finding.section!==stats.id) || count<1 ||
            (finding.kind==='repeated-bar' && Math.min(last,stats.bars[1])===first)) continue;
          const kinds=finding.kind==='uniform-articulation' ? ['shape-dynamics'] :
            info.role==='percussion' ? ['break-and-fill'] :
            info.role==='bass' ? ['bass-anticipation'] : ['call-and-answer','held-response'];
          for (const [order,kind] of kinds.entries()) targets.push({
            name,span,kind,finding,rank:(info.role==='lead'?6:0)+Math.min(count,8)*2-order-
              (kind==='shape-dynamics'?5:0),
            first:kind==='shape-dynamics' ? stats.bars[0] : Math.min(last,stats.bars[1])-
              (kind==='call-and-answer' && count>=4 ? 1 : 0),
            last:Math.min(last,stats.bars[1])
          });
        }
      }
    }
    targets.sort((a,b)=>b.rank-a.rank || a.span.bar-b.span.bar);
    const variants=[], proposals=[], blocked=[], filled=new Set();
    for (const [index,target] of targets.entries()) {
      const {name,span,kind,finding,first,last}=target;
      const key=name+':'+kind;
      if (filled.has(key)) continue;
      const bars=[first,last];
      const id='revision-'+(index+1);
      const proposal={id,kind,part:name,section:span.id,bars,finding:finding.id,summary:suggestions[kind]};
      if (held.has(name)) {
        filled.add(key);
        blocked.push({...proposal,blockedBy:held.get(name)});
        continue;
      }
      if (variants.length>=limit) continue;
      const notes=editableNotes(plan,name,span), length=span.end-span.beat;
      const start=(first-span.bar-1)*report.meter, end=(last-span.bar)*report.meter;
      const within=notes.filter(note=>note.beat>=start && note.beat<end);
      if (within.length<2) continue;
      const before=notes.filter(note=>note.beat<start);
      const answerStart=kind==='call-and-answer' ? end-report.meter : start;
      const question=within.filter(note=>note.beat<answerStart).slice(0,2);
      const response=shape(within.filter(note=>note.beat>=answerStart),answerStart,end,
        kind,rngFor([name,span.id,kind],seed));
      const changed=[...question,...response];
      // Leave any pickup from the previous bar intact, unless a new attack needs that space.
      if (before.length) before.at(-1).duration=Math.min(before.at(-1).duration,changed[0].beat-before.at(-1).beat);
      const events=[...before,...changed,...notes.filter(note=>note.beat>=end)];
      if (events.length>512 || Object.keys(plan.definition.motifs).length>=128 ||
          plan.parts[name].notes-within.length+changed.length>4096) continue;
      const edit={part:name,section:span.id,scope:'section',adopt:M.motif({length,events})};
      const variant={id,edits:[edit],...(unpin.length && {unpin:[...new Set(unpin)]})};
      const revised=C.revise(plan,variant).value;
      const actual=editableNotes(revised,name,span).filter(note=>note.beat>=start && note.beat<end);
      if (JSON.stringify(actual)===JSON.stringify(within)) continue;
      filled.add(key);
      variants.push(variant);
      proposals.push({...proposal,before:measure(within,start,end,0),after:measure(actual,start,end,0)});
    }
    return {proposals,blocked,variants};
  }

  P.musicComposer=Object.freeze({...C,makePhrase,analyze,suggest});
})(KIT);
