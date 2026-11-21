/* Compare musical decisions, audition in context, and keep named revisions. */
(function (P) {
  const A=P.musicProduction, H=P.musicHarmony, T=P.takeTime;
  const {record,fields,finite,integer,id,check,db}=P.musicInstruments;
  const sessionFormat='ink-studio/producer-session', referenceFormat='ink-studio/producer-reference';
  const strategies=['harmony','orchestration'];
  const epsilon=1e-8, round=value=>Number(value.toFixed(9));
  const prose=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const fingerprint=source=>{
    const json=JSON.stringify(source);
    return [json.length,P.data.hash(json),P.data.hash(json,0x9e3779b9)].map(value=>value.toString(36)).join('-');
  };
  const at=(score,point)=>P.musicTiming.isPosition(point) ? score.clock.timeAt(point) : T.seconds(T.read(point));
  const sample=(time,rate)=>T.index(T.roundDown(T.mul(T.read(time),[BigInt(rate),1n])));
  const sectionByName=(score,name)=>score.arrangement.sections.find(section=>section.id===name);
  const chordAt=(score,time)=>score.program.events.findLast(row=>row.time<=time+epsilon);

  function assemble(components,score) {
    const owners=new Map(), revision={};
    const sections=score.arrangement.sections.map(section=>section.id);
    const claim=(key,component)=>{
      check(!owners.has(key) || owners.get(key)===component,'Producer choices overlap at '+key);
      owners.set(key,component);
    };
    for (const [index,{revision:row}] of components.entries()) {
      check(fields(row,['id','edits','harmonies','changes','tracks','patches','room','gain']) &&
        (row.id===undefined || id(row.id)) && Object.keys(row).some(key=>key!=='id'),
        'Producer components need a production revision');
      for (const [key,value] of Object.entries(row)) {
        if (key==='id') continue;
        if (key==='gain') {
          claim('gain',index);
          revision.gain=value;
        } else if (key==='edits' || key==='changes') {
          check(Array.isArray(value) && value.length<=(key==='edits'?128:64) && Array.from(value).every(record),
            'Invalid producer '+key);
          for (const edit of value) {
            if (key==='changes') {
              check(id(edit.id),'A producer chord change needs an ID');
              claim('change:'+edit.id,index);
              claim('harmony at '+at(score,edit.time),index);
            } else if (edit.harmony!==undefined) claim('harmony:'+edit.harmony,index);
            else if (edit.binding!==undefined) claim('binding:'+edit.binding,index);
            else for (const section of edit.scope==='section' ? [edit.section] : sections)
              claim('part:'+edit.part+':'+section,index);
          }
          (revision[key] ??= []).push(...value);
        } else {
          check(record(value) && Object.keys(value).length<=128,'Invalid producer '+key);
          const table=revision[key] ??= {};
          for (const [name,setting] of Object.entries(value)) {
            check(id(name),'Invalid producer setting name');
            if (key==='tracks') {
              check(record(setting),'A producer track needs its named settings');
              for (const field of Object.keys(setting)) claim('track:'+name+':'+field,index);
              table[name]={...table[name],...setting};
            } else {
              claim((key==='harmonies'?'harmony':key)+':'+name,index);
              table[name]=setting;
            }
          }
        }
      }
    }
    return revision;
  }

  function harmony(score,section) {
    const meter=score.arrangement.score.tempoMap?.beatsPerBar ?? 4;
    const previous=score.arrangement.sections.find(row=>row.end===section.beat);
    if (!previous) return 'The section needs a lead-in for a cadence.';
    const destination=chordAt(score,section.time);
    const latest=score.program.events.findLast(row=>row.time<section.time-epsilon);
    if (!destination || !latest) return 'The cadence needs an incoming and a destination harmony.';
    const beats=Math.min(meter/2,(section.beat-latest.beat)/2,section.beat-previous.beat);
    if (beats<.5) return 'The lead-in already has a chord change close to the return.';
    const beat=round(section.beat-beats);
    const incoming=H.midi(latest.root), tonic=H.midi(destination.root), fifth=(tonic+7)%12;
    const substitute=incoming%12===fifth && latest.quality==='dominant7';
    const pitchClass=substitute ? (tonic+1)%12 : fifth, register=substitute ? tonic+1 : incoming;
    const root=pitchClass+12*Math.max(0,Math.min(9,Math.round((register-pitchClass)/12)));
    const keys=new Set(score.program.events.map(row=>row.id));
    const unique= (stem,has)=>{
      let name=stem, suffix=1;
      while (has(name)) name=stem+'-'+suffix++;
      return name;
    };
    const name=unique('producer-dominant',key=>Object.hasOwn(score.arrangement.score.harmonies,key));
    const chord=H.chord(root,'dominant7'), voices=Object.keys(score.arrangement.parts);
    const bass=voices.findIndex(name=>score.arrangement.parts[name].role==='bass');
    const notes=chord.slice(0,voices.length);
    if (bass>0 && bass<notes.length) [notes[0],notes[bass]]=[notes[bass],notes[0]];
    const changes=[{id:unique('producer-lift',key=>keys.has(key)),time:{beat},harmony:name}];
    if (destination.time<section.time-epsilon)
      changes.push({id:unique('producer-resolve',key=>keys.has(key)),time:{beat:section.beat},harmony:destination.harmony});
    return {
      id:'harmony',hypothesis:substitute ? 'A tritone substitution keeps the dominant guide tones and approaches the tonic from a semitone above.' :
        'A dominant seventh in the lead-in can make the same arrival feel more conclusive.',
      components:[{id:'cadence',summary:H.pitchName(root)+' dominant seventh resolves into '+destination.root+' '+destination.quality+'.',
        revision:{harmonies:{[name]:{root,quality:'dominant7',notes}},changes}}]
    };
  }

  function orchestration(score,section,brief,source) {
    const {arrangement:plan,tracks}=score, meter=plan.score.tempoMap?.beatsPerBar ?? 4;
    const pitched=name=>['pad','lead'].includes(plan.parts[name].role);
    const ensemble=Object.keys(tracks).filter(pitched);
    const material=name=>plan.materials[name].find(row=>row.section===section.id);
    const lead=brief.lead ?? ensemble.find(name=>plan.parts[name].role==='lead' &&
      plan.cues.some(note=>note.part===name && note.section===section.id));
    const layer=brief.layer ?? ensemble.find(name=>name!==lead && !tracks[name].pad &&
      !material(name).value && !material(name).sustain);
    if (lead && layer && lead!==layer && !tracks[layer].pad && !material(layer).value && !material(layer).sustain) {
      const length=round(section.end-section.beat), limit=Math.min(length,meter*2);
      const octave=brief.octave ?? 12;
      const events=plan.cues.filter(row=>row.part===lead && row.section===section.id && row.beat<section.beat+limit)
        .flatMap(row=>{
          const pitch=score.program.pitch(lead,row.time).midi;
          if (pitch===null || pitch===undefined || !integer(pitch+octave,0,127)) return [];
          const beat=round(row.beat-section.beat);
          return [{beat,duration:round(Math.min(row.duration*.88,limit-beat)),midi:pitch+octave,velocity:row.velocity*.73}];
        });
      if (events.length && length<=256 && events.length<=512) return {
        id:'orchestration',hypothesis:'A second instrument can widen the hook while the existing chords hold steady.',
        components:[{id:'octave-double',summary:layer+' doubles the opening of '+lead+' in '+section.id+'.',
          revision:{edits:[{part:layer,section:section.id,scope:'section',adopt:{length,events}}]}}]
      };
    }
    const pad=brief.layer ?? ensemble.find(name=>tracks[name].pad && (material(name).value || material(name).sustain));
    if (!pad || !tracks[pad].pad || !(material(pad).value || material(pad).sustain))
      return 'Use a resting melodic layer or an active chord pad for an orchestration take.';
    const config=tracks[pad].pad.sections[section.id] ?? tracks[pad].pad;
    const anchor=Math.min(config.max,config.top+7), previous=source.tracks[pad].pad;
    return {
      id:'orchestration',hypothesis:'Open the pad register and let its chord tones enter one by one at the return.',
      components:[{id:'open-pad',summary:'Higher voicing and staggered attacks on '+pad+' in '+section.id+'.',
        revision:{tracks:{[pad]:{pad:{...previous,sections:{...previous.sections,[section.id]:{
          ...previous.sections?.[section.id],anchor,spread:.065,tie:false}}}}}}}]
    };
  }

  function validateTakes(takes,score) {
    check(Array.isArray(takes) && takes.length>=1 && takes.length<=8,'Producer sessions need up to eight takes');
    const ids=new Set();
    return Array.from(takes,(take,index)=>{
      check(fields(take,['id','hypothesis','components']) && id(take.id) && !ids.has(take.id) &&
        prose(take.hypothesis,640) && Array.isArray(take.components) && take.components.length<=24 &&
        (index===0 ? take.id==='reference' && take.components.length===0 : take.components.length>0),
        'Invalid producer take');
      ids.add(take.id);
      const seen=new Set();
      for (const unit of take.components) {
        check(fields(unit,['id','summary','revision']) && id(unit.id) && !seen.has(unit.id) && prose(unit.summary,640),
          'Producer take components need distinct IDs and a summary');
        seen.add(unit.id);
      }
      return {id:take.id,...assemble(take.components,score)};
    });
  }

  function planProducer(source,brief,assets={}) {
    check(fields(brief,['section','goal','lead','layer','octave','strategies','takes']) && id(brief.section) &&
      prose(brief.goal,640) && (brief.octave===undefined || [-12,12].includes(brief.octave)), 'Invalid producer brief');
    const score=A.compile(source,assets), section=sectionByName(score,brief.section);
    check(section,'Unknown producer section '+brief.section);
    for (const name of [brief.lead,brief.layer]) if (name!==undefined)
      check(id(name) && Object.hasOwn(score.tracks,name) && ['lead','pad'].includes(score.arrangement.parts[name].role),
        'Name an existing pitched production track');
    const chosen=brief.strategies ?? strategies, authored=brief.takes ?? [];
    check(Array.isArray(chosen) && Array.from(chosen).every(name=>strategies.includes(name)) &&
      new Set(chosen).size===chosen.length && Array.isArray(authored) && 1+chosen.length+authored.length<=8,
      'Choose distinct producer strategies and up to eight total takes');
    const reference={id:'reference',hypothesis:'Keep the current arrangement for comparison.',components:[]};
    const takes=[reference], blocked=[];
    const signature=music=>JSON.stringify(music.events);
    for (const strategy of chosen) {
      try {
        const take=strategy==='harmony' ? harmony(score,section) : orchestration(score,section,brief,source);
        if (typeof take==='string') {blocked.push({strategy,reason:take});continue;}
        const revision=assemble(take.components,score);
        const candidate=A.compile(A.revise(source,revision,assets),assets);
        if (signature(candidate)===signature(score)) {
          blocked.push({strategy,reason:'The proposed change does not alter the performed notes.'});
          continue;
        }
        takes.push(take);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        blocked.push({strategy,reason:error.message});
      }
    }
    takes.push(...authored);
    const revisions=validateTakes(takes,score);
    for (const revision of revisions.slice(takes.length-authored.length)) A.revise(source,revision,assets);
    return P.data.freeze(clone({format:sessionFormat,version:1,base:fingerprint(source),
      section:section.id,goal:brief.goal,takes,blocked}));
  }

  function open(source,session,assets) {
    check(fields(session,['format','version','base','section','goal','takes','blocked']) &&
      session.format===sessionFormat && session.version===1 && session.base===fingerprint(source) &&
      id(session.section) && prose(session.goal,640),'Producer session needs its original production');
    const score=A.compile(source,assets), section=sectionByName(score,session.section);
    check(section,'Unknown producer section '+session.section);
    return {score,section,revisions:validateTakes(session.takes,score)};
  }

  function listenRanges(score,section,options) {
    const {start:begin,end:stop,focus}=options, meter=score.arrangement.score.tempoMap?.beatsPerBar ?? 4;
    const start=begin===undefined ? Math.max(0,section.time-8,score.clock.timeAt({beat:Math.max(0,section.beat-meter)})) :
      at(score,begin);
    const end=stop===undefined ? Math.min(score.end,start+30,section.time+14,
      score.clock.timeAt({beat:Math.min(section.end,section.beat+2*meter)})) : at(score,stop);
    check(finite(start,0,score.end) && finite(end,start,score.end) && end>start && end-start<=30,
      'Producer context must be within the score and at most thirty seconds');
    const defaults=section.time>=start && section.time<end ?
      [{id:'arrival',start:section.time,end:Math.min(end,score.clock.timeAt({beat:Math.min(section.end,section.beat+meter)}))}] : [];
    const rows=focus ?? defaults, ids=new Set();
    check(Array.isArray(rows) && rows.length<=8,'Producer review needs up to eight listening windows');
    return {start,end,focus:Array.from(rows,row=>{
      check(fields(row,['id','start','end','tracks']) && id(row.id) && !ids.has(row.id),'Invalid producer listening window');
      ids.add(row.id);
      const from=row.start===undefined ? start : at(score,row.start), to=row.end===undefined ? end : at(score,row.end);
      const tracks=row.tracks;
      check(finite(from,start,end) && finite(to,from,end) && to>from &&
        (tracks===undefined || Array.isArray(tracks) && tracks.length>=1 && tracks.length<=9 &&
          new Set(tracks).size===tracks.length && Array.from(tracks).every(name=>name==='room' || Object.hasOwn(score.tracks,name))),
        'Producer focus must be within context and name existing tracks');
      return {id:row.id,start:from,end:to,...(tracks && {tracks})};
    })};
  }

  function evidence(score,range) {
    const changes=score.program.events.filter(row=>row.time>range.start+epsilon && row.time<range.end);
    const initial=chordAt(score,range.start);
    if (initial) changes.unshift(initial);
    return {
      harmony:changes.map(({root,quality,time,beat})=>({root,quality,time,beat})),
      attacks:Object.fromEntries(Object.entries(score.events).filter(([name])=>!range.tracks || range.tracks.includes(name))
        .map(([name,notes])=>[name,notes.filter(note=>note.time>=range.start && note.time<range.end && note.velocity>0).length]))
    };
  }

  function reviewProducer(source,session,assets={},options={}) {
    check(fields(options,['start','end','sampleRate','target','ceiling','focus']),'Invalid producer review options');
    const {score,section,revisions}=open(source,session,assets);
    const range=listenRanges(score,section,options);
    const review=A.audition(source,revisions,assets,{start:range.start,end:range.end,
      sampleRate:options.sampleRate,target:options.target,ceiling:options.ceiling});
    const rate=review.report.sampleRate, start=sample(range.start,rate);
    check(range.focus.reduce((sum,row)=>sum+sample(row.end,rate)-sample(row.start,rate),0)*2*revisions.length<=18e6,
      'Producer review exceeds its listening sample budget');
    const rows=range.focus.map(row=>{
      const first=sample(row.start,rate), end=sample(row.end,rate);
      check(end>first,'A listening window needs at least one sample');
      return {...row,firstSample:first,endSample:end,scale:1};
    });
    const takes=review.takes.map(take=>{
      const render=take.id==='reference' ? score : A.compile(take.production,assets);
      const focus=Object.fromEntries(rows.map(row=>{
        const startIndex=(row.firstSample-start)*2, stopIndex=(row.endSample-start)*2;
        const audio={sampleRate:rate,channels:2,samples:take.value.samples.slice(startIndex,stopIndex)};
        if (row.tracks) {
          audio.samples.fill(0);
          for (const name of row.tracks) {
            const stem=take.stems[name].samples;
            for (let i=0;i<audio.samples.length;i++) audio.samples[i]+=stem[startIndex+i];
          }
          const peak=A.meters(audio,true).truePeak;
          if (peak>0) row.scale=Math.min(row.scale,db(options.ceiling ?? -1)/peak);
        }
        return [row.id,audio];
      }));
      const {stems,...output}=take;
      return {...output,focus,evidence:{context:evidence(render,range),
        focus:Object.fromEntries(rows.map(row=>[row.id,evidence(render,row)]))}};
    });
    for (const row of rows) if (row.scale<1) for (const take of takes) {
      const result=take.focus[row.id];
      for (let i=0;i<result.samples.length;i++) result.samples[i]*=row.scale;
    }
    return {takes,report:{...review.report,section:session.section,goal:session.goal,focus:rows,
      takes:takes.map((take,index)=>({...take.report,id:take.id,hypothesis:session.takes[index].hypothesis,
        components:session.takes[index].components.map(({id,summary})=>({id,summary})),evidence:take.evidence}))}};
  }

  function keepProducer(source,session,selection,assets={}) {
    check(fields(selection,['keep','reason','listened']) && prose(selection.reason,2000) &&
      Array.isArray(selection.keep) && selection.keep.length<=24 &&
      (selection.listened===undefined || Array.isArray(selection.listened) && selection.listened.length<=16 &&
        Array.from(selection.listened).every(text=>prose(text,240))), 'Record the selected components and why they work');
    const {score}=open(source,session,assets), used=new Set(), selected=[];
    const units=Array.from(selection.keep,row=>{
      check(fields(row,['take','component']) && id(row.take) && id(row.component),'Invalid producer selection');
      const take=session.takes.find(take=>take.id===row.take), component=take?.components.find(unit=>unit.id===row.component);
      const key=row.take+':'+row.component;
      check(component && !used.has(key),'Producer selection must name a distinct auditioned component');
      used.add(key);
      selected.push({...row,hypothesis:take.hypothesis,summary:component.summary});
      return component;
    });
    const revision=assemble(units,score);
    const production=units.length ? A.revise(source,revision,assets) : P.data.freeze(clone(source));
    const reference=P.data.freeze(clone({format:referenceFormat,version:1,base:session.base,section:session.section,
      goal:session.goal,selected,reason:selection.reason,listened:selection.listened ?? [],revision}));
    return {production,reference,revision:reference.revision};
  }

  P.musicProduction=Object.freeze({...A,planProducer,reviewProducer,keepProducer});
})(KIT.procedural);
