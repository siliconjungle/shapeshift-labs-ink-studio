/* Compare musical decisions using editable takes and the same session mixer. */
(function (P) {
  const S=P.mediaGraphSupport,M=P.mediaGraph,A=P.musicProduction;
  const {check,fields,id,integer,finite,record,db}=P.musicInstruments;
  const {reference}=S.musicSessionModel;
  const types=['form','phrase','voicing','gesture','rhythm'];
  const format='ink-studio/composition-workbench';
  const revise=revision=>({op:'revise-score',revision});

  function form(plan,raw,assets) {
    check(fields(raw,['theme','withhold','ending']) && (raw.theme===undefined ||
      fields(raw.theme,['themes','appearances'])) && (raw.withhold===undefined ||
      Array.isArray(raw.withhold) && raw.withhold.length<=32),
    'A cue form needs a theme plan, withheld passages or an ending');
    const {source,score}=plan.producers.get(reference);
    const end=score.arrangement.sections.at(-1).end, current=source.cueMap ?? {};
    const windows=Array.from(raw.withhold ?? [],row=>{
      check(fields(row,['from','to','parts','mode']) && finite(row.from,0,end) &&
        finite(row.to,row.from+1e-8,end) && Array.isArray(row.parts) && row.parts.length>0 &&
        new Set(row.parts).size===row.parts.length && Array.from(row.parts).every(name=>Object.hasOwn(score.tracks,name)) &&
        ['ring','cut'].includes(row.mode ?? 'ring'),'A withheld passage needs a beat range and named score tracks');
      return {...row,mode:row.mode ?? 'ring'};
    });
    const {ending}=raw;
    if (ending!==undefined) {
      check(fields(ending,['at','mode']) && finite(ending.at,0,end-1e-8) &&
        ['ring','cut'].includes(ending.mode ?? 'ring'),'An ending needs a beat and ring or cut');
      windows.push({from:ending.at,to:end,mode:ending.mode ?? 'ring'});
    }
    check(windows.length || raw.theme,'Choose at least one cue decision');
    const cueMap={...current,silence:[...(current.silence ?? []),...windows]};
    const shaped=A.revise(source,{cueMap},assets);
    const theme=raw.theme && A.developThemes(shaped,raw.theme,assets);
    return {edits:[revise({edits:theme?.revision.edits ?? [],cueMap})],
      evidence:{withheld:windows,...(ending && {ending:{beat:ending.at,mode:ending.mode ?? 'ring'}}),
        ...(theme && {sections:theme.report.sections,appearances:theme.themeMap.appearances})}};
  }

  function phrase(plan,raw,assets) {
    const {source}=plan.producers.get(reference);
    const pins={...raw.constraints?.pins};
    for (const [lane,mode] of Object.entries(plan.pins)) {
      if (!plan.audio.has(lane) && pins[lane]!=='all') pins[lane]=mode;
    }
    const result=A.searchComposition(source,{...raw,constraints:{...raw.constraints,pins}},assets);
    return {rows:result.winners.map(row=>({suffix:row.id,level:row.level==='note' ? 'gesture' : row.level,
      edits:[revise(row.revision)],evidence:{choice:row.candidate,hypothesis:row.hypothesis,...row.details,...row.evidence}})),
      evidence:result.report};
  }

  function voicing(plan,raw,assets) {
    const result=A.voiceLead(plan.producers.get(reference).source,raw,assets);
    return {rows:result.variants.map(row=>({suffix:row.id,edits:[revise(row.revision)],evidence:row.metrics})),
      evidence:result.report};
  }

  function gesture(plan,raw) {
    check(fields(raw,['lane','clip','voice','notes']) && [raw.lane,raw.clip,raw.voice].every(id) &&
      Array.isArray(raw.notes) && integer(raw.notes.length,1,32),'Address one written voice and its gesture edits');
    const {lane,clip,voice}=raw, {source}=plan.producers.get(reference);
    const notes=Object.hasOwn(source.tracks,lane) && source.tracks[lane].clips?.find(row=>row.id===clip)
      ?.voices.find(row=>row.id===voice)?.notes;
    check(notes,'Unknown written voice for the gesture');
    const taken=new Set();
    const edits=Array.from(raw.notes,row=>{
      check(fields(row,['note','play','velocity']) && id(row.note) && !taken.has(row.note) &&
        (row.play!==undefined || row.velocity!==undefined) && (row.play===undefined || record(row.play)),
      'Gesture changes need distinct note IDs and expression or velocity');
      taken.add(row.note);
      const note=notes.find(note=>note.id===row.note);
      check(note && !note.tie,'Choose an existing attack rather than a tied continuation');
      return {op:'note',take:reference,lane,clip,voice,note:row.note,set:{
        ...(row.velocity!==undefined && {velocity:row.velocity}),
        ...(row.play && {play:{...note.play,...row.play,
          ...(row.play.curves && {curves:{...note.play?.curves,...row.play.curves}})}})
      }};
    });
    return {edits,evidence:{lane,clip,voice,notes:[...taken]}};
  }

  function writtenVariant(pattern,moves) {
    check(record(moves) && integer(Object.keys(moves).length,1,128) &&
      Object.keys(moves).every(id),'Written alternatives move named steps to new written beats');
    const seen=new Set();
    const change=steps=>steps.map(step=>{
      if (!Object.hasOwn(moves,step.id)) return step;
      seen.add(step.id);
      return {...step,beat:moves[step.id]};
    });
    const result={...pattern,steps:change(pattern.steps),...(pattern.fills &&
      {fills:pattern.fills.map(fill=>({...fill,steps:change(fill.steps)}))})};
    check(seen.size===Object.keys(moves).length,'Written alternative refers to an unknown step');
    return result;
  }

  function rhythm(plan,raw) {
    check(fields(raw,['pattern','written','settings','notes','pads','foley']) && record(raw.pattern) &&
      fields(raw.settings ?? {},['startBeat','cycles','fills','seed','scale','timing']) &&
      (raw.notes || raw.pads || raw.foley),'Route a rhythm to written notes, a sample kit or Foley clips');
    const {pattern,written,notes,pads,foley}=raw;
    check(notes===undefined || fields(notes,['lane','clip','voices','mode']) && id(notes.lane) && record(notes.voices),
      'Rhythm notation needs a named score track and voices');
    check(pads===undefined || fields(pads,['lane','take','kit','routes']) && id(pads.lane) && id(pads.take) &&
      record(pads.kit) && record(pads.routes),'A rhythm kit needs a lane, take, kit and pad routes');
    check(foley===undefined || plan.editorialClock && fields(foley,['lane','take','routes']) && id(foley.lane) &&
      id(foley.take) && record(foley.routes),'Rhythmic Foley needs a shared picture and editable clip routes');
    check(!pads || !foley || pads.lane!==foley.lane,'Give the sampler and Foley separate audio lanes');
    const {source,score}=plan.producers.get(reference);
    const key=score.arrangement.score.key;
    const routes={notes:notes?.voices ?? {},pads:pads?.routes ?? {},foley:foley?.routes ?? {}};
    const {timing=1,...settings}=raw.settings ?? {};
    check(finite(timing,0,2),'Rhythm timing amount must be between zero and two');
    const variants=[['grid',pattern,0],['timing',pattern,timing]];
    if (written!==undefined) {
      check(Array.isArray(pattern.steps) && (pattern.fills===undefined || Array.isArray(pattern.fills) &&
        pattern.fills.every(fill=>Array.isArray(fill?.steps))),'Expected a written pad pattern');
      const alternate=writtenVariant(pattern,written);
      variants.splice(1,0,['written',alternate,0]);
      variants.push(['both',alternate,timing]);
    }
    return {rows:variants.map(([suffix,writtenPattern,amount])=>{
      const value=M.rhythmProjection.project(writtenPattern,routes,{scale:{root:key?.root ?? 'C4',mode:key?.mode ?? 'major'},
        ...settings,timing:amount,map:plan.map,sampleRate:plan.rate,...(notes && {clipId:notes.clip ?? pattern.id,mode:notes.mode})});
      const edits=[];
      if (notes) {
        const track=Object.hasOwn(source.tracks,notes.lane) && source.tracks[notes.lane];
        check(track && value.clip,'Choose an existing score lane and playable rhythm voices');
        const clips=(track.clips ?? []).filter(row=>row.id!==value.clip.id);
        edits.push(revise({tracks:{[notes.lane]:{clips:[...clips,value.clip]}}}));
      }
      const take=(target,spec)=>edits.push({op:'audio-take',lane:target.lane,take:target.take,source:spec},
        {op:'audio-select',lane:target.lane,take:target.take});
      if (pads) take(pads,{kit:pads.kit,...value.pads});
      if (foley) take(foley,value.foley);
      return {suffix,edits,evidence:value.report};
    })};
  }

  S.createCompositionWorkbench=({assets,compile,edit,render})=>function compose(session,brief) {
    check(fields(brief,['moves','preview']) && Array.isArray(brief.moves) && integer(brief.moves.length,1,12),
      'Choose one to twelve named composition moves');
    const plan=compile(session), candidates=[], groups=[], sessions={reference:session}, names=new Set();
    const functions={form,phrase,voicing,gesture,rhythm};
    for (const move of brief.moves) {
      const type=types.find(key=>move?.[key]!==undefined);
      check(type && fields(move,['id',type]) && id(move.id) && move.id.length<=28 &&
        move.id!==reference && !names.has(move.id) && record(move[type]),'Choose one kind of move per unique name');
      names.add(move.id);
      const result=functions[type](plan,move[type],assets);
      const group={id:move.id,type,evidence:result.rows ? result.evidence ?? {} : undefined,rejected:[]};
      if (group.evidence===undefined) delete group.evidence;
      groups.push(group);
      const level={form:'cue',phrase:'phrase',voicing:'phrase',gesture:'gesture',rhythm:'rhythm'}[type];
      for (const row of result.rows ?? [result]) {
        const name=row.suffix ? move.id+'-'+row.suffix : move.id;
        check(id(name) && !Object.hasOwn(sessions,name) && candidates.length<24,'Composition audition exceeds its candidate budget or repeats a name');
        try {
          sessions[name]=edit(session,row.edits);
          candidates.push({id:name,level:row.level ?? level,edits:row.edits,evidence:row.evidence ?? {}});
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          group.rejected.push({id:name,reason:error.message});
        }
      }
    }
    const value={format,version:1,session:session.id,groups,candidates};
    const clips={};
    if (brief.preview!==undefined) {
      const preview=brief.preview;
      check(fields(preview,['from','to','leadInSamples','context']),'Choose a straight composition review with optional lead-in or context');
      const {from,to}=plan.range(preview.from,preview.to);
      const extent=to-from+(preview.leadInSamples ?? 0)+(preview.context?.beforeSamples ?? 0)+(preview.context?.afterSamples ?? 0);
      check(integer(extent,1,plan.rate*30) && extent*Object.keys(sessions).length*2<=16e6,
        'Review up to thirty seconds within the combined audition budget');
      const prints=Object.entries(sessions).map(([id,recipe])=>{
        const audio=render(recipe,preview).value;
        return {id,audio,...A.meters(audio,true)};
      });
      const common=Math.min(-17,...prints.map(row=>row.lufs===null ? -17 :
        row.lufs-1-20*Math.log10(row.truePeak)));
      const base=prints[0].audio.samples;
      value.listening={sampleRate:plan.rate,commonLufs:common,takes:prints.map(({id,audio,lufs,truePeak})=>{
        const gain=lufs===null ? 1 : db(common-lufs);
        clips[id]={...audio,samples:audio.samples.map(sample=>sample*gain)};
        const identicalToReference=audio.samples.length===base.length && audio.samples.every((sample,i)=>sample===base[i]);
        return {id,lufs:lufs===null ? null : common,truePeak:truePeak*gain,gain,identicalToReference};
      })};
    }
    return {value:P.data.freeze(P.data.clone(value)),sessions,clips};
  };
})(KIT.procedural);
