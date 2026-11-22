/* Four session branches and two consequential questions on the same score clock. */
(function (P) {
  const S=P.mediaGraphSupport, R=P.musicCritiqueReferences;
  const {fields,record,finite,integer,id,check}=P.musicInstruments, {clone,freeze,hash}=P.data;
  const serial=JSON.stringify, labels=['a','b','c','d'], names=['current','source','performance','arrangement'];
  const prompts={
    identity:'Which call do you remember after the gap?',
    replay:'Which return would you play again?'
  };
  const format='ink-studio/performance-ballot', keyFormat=format+'-key';
  const signature=value=>{
    const text=serial(value);
    return 'ballot-'+(hash(text)>>>0).toString(36)+'-'+(hash(text,0x9e3779b9)>>>0).toString(36);
  };
  const pair=({from,to})=>({from:{samples:from},to:{samples:to}});
  const encloses=(outer,inner)=>outer.from<=inner.from && outer.to>=inner.to;

  function swap(plan,lane,patch) {
    const {reference}=S.musicSessionModel, next=clone(plan.session);
    const used=new Set([...plan.producers.values()].flatMap(({source})=>Object.keys(source.patches)));
    let name='ballot-lead';
    for (let i=2;used.has(name);i++) name='ballot-lead-'+i;
    let basePatch;
    for (const [take,{source}] of plan.producers) {
      const {gestures,echo,performance}=source.patches[source.tracks[lane].patch];
      const instrument={...clone(patch),...(gestures && {gestures}),...(echo && {echo}),...(performance && {performance})};
      if (take===reference) {
        basePatch=instrument;
        next.production.patches[name]=instrument;
        next.production.tracks[lane].patch=name;
      } else {
        const revision=next.takes[take];
        if (serial(instrument)!==serial(basePatch)) (revision.patches ??= {})[name]=instrument;
        if (revision.tracks?.[lane]?.patch!==undefined) revision.tracks[lane].patch=name;
      }
    }
    return next;
  }

  function sameLeadSource(base,next,lane) {
    const {reference}=S.musicSessionModel;
    function ranges(plan) {
      const choices=plan.choices.filter(row=>row.lane===lane);
      const keys=new Map([...plan.producers].map(([id,{source,score}])=>{
        const {phrases,...track}=source.tracks[lane];
        return [id,serial({track,patch:source.patches[track.patch],part:score.arrangement.parts[lane],
          cues:score.arrangement.cues.filter(row=>row.part===lane),cueMap:source.cueMap,grooveMap:source.grooveMap})];
      }));
      return {choices,key:sample=>keys.get(choices.find(row=>row.from<=sample && sample<row.to)?.take ?? reference)};
    }
    const a=ranges(base), b=ranges(next);
    return [0,...[...a.choices,...b.choices].flatMap(row=>[row.from,row.to])]
      .every(sample=>a.key(sample)===b.key(sample));
  }

  function waveform(clip,context,ranges,gap) {
    if (ranges.length===1 && ranges[0].from===context.from && ranges[0].to===context.to) return clip;
    const length=ranges.reduce((n,span)=>n+span.to-span.from,0)+gap*(ranges.length-1);
    const pcm=new Float64Array(2*length), fade=Math.round(clip.sampleRate*.008);
    let offset=0;
    for (const span of ranges) {
      const frames=span.to-span.from, start=span.from-context.from, ramp=Math.min(fade,Math.floor(frames/2));
      for (let j=0;j<frames;j++) {
        const gain=ramp ? Math.min(1,j/ramp,(frames-1-j)/ramp) : 1;
        for (let lane=0;lane<2;lane++) pcm[(offset+j)*2+lane]=clip.samples[(start+j)*2+lane]*gain;
      }
      offset+=frames+gap;
    }
    return {...clip,samples:pcm};
  }

  function distinct(a,b) {
    // Measure difference after gain alignment so changing only level cannot earn a ballot.
    const x=a.samples, y=b.samples;
    let ax=0, ay=0, cross=0;
    for (let i=0;i<x.length;i++) {
      ax+=x[i]**2;
      ay+=y[i]**2;
      cross+=x[i]*y[i];
    }
    return ax>0 && ay>0 && cross/Math.sqrt(ax*ay)<1-.005**2/2;
  }

  function blind(rows,context,questions,settings) {
    const {rate,seed,target,ceiling,name}=settings, audio={}, manifest=[], map={};
    for (const {id,prompt,ranges,gap} of questions) {
      const waves=rows.map(({clip})=>waveform(clip,context,ranges,gap));
      const order=rows.map(({stage},index)=>({index,rank:hash(serial([seed,id,stage]))>>>0}))
        .sort((a,b)=>a.rank-b.rank || a.index-b.index).map(row=>row.index);
      const matched=P.adaptiveRehearsalEvidence.matched(waves,target,ceiling);
      check(matched.every(row=>row.playback.lufs!==null),'One of the four excerpts is too quiet to level match for '+id);
      audio[id]=Object.fromEntries(labels.map((label,i)=>[label,matched[order[i]].value]));
      map[id]=Object.fromEntries(labels.map((label,i)=>{
        const row=rows[order[i]], print=matched[order[i]];
        return [label,{stage:row.stage,variant:row.variant,change:row.change,
          audioHash:R.excerptHash(print.value.samples),playback:print.playback}];
      }));
      const frames=matched[0].value.samples.length/2;
      const sequence=ranges.map((range,index)=>{
        const start=index ? ranges[0].to-ranges[0].from+gap : 0;
        return {firstFrame:start,endFrame:start+range.to-range.from,range};
      });
      manifest.push({id,prompt,frames,sequence,lufs:matched[0].playback.lufs});
    }
    const publicInfo={format,version:1,id:name,sampleRate:rate,labels:[...labels],questions:manifest};
    const token=signature([publicInfo,map]);
    const test=freeze({...publicInfo,token});
    return {test,key:freeze({format:keyFormat,version:1,test,map}),audio};
  }

  S.createPerformanceBallot=({compile,edit,experiments,accompaniment})=>function evaluate(session,brief) {
    check(fields(brief,['id','seed','lead','context','scout','call','recall','gapSeconds','targetLufs','ceilingDbTP',
      'sources','performances','accompaniment','arrangements','advance']) && id(brief.id ?? 'four-way') &&
      Number.isSafeInteger(brief.seed ?? 0) && finite(brief.gapSeconds ?? 1.5,.25,6) &&
      finite(brief.targetLufs ?? -18,-35,-9) && finite(brief.ceilingDbTP ?? -1.2,-9,-.5) &&
      integer(brief.advance ?? 2,1,4),'Choose a four-way session brief, listening levels and search budget');
    const {lead,seed=0,advance=2}=brief, base=compile(session), {rate}=base;
    check(id(lead) && Object.hasOwn(base.producers.get(S.musicSessionModel.reference).score.tracks,lead) &&
      base.pins[lead]!=='all','Choose an editable score lead');
    const range=(raw,label)=>{
      check(fields(raw,['from','to']) && raw.from!==undefined && raw.to!==undefined,'Choose a '+label+' range');
      return base.range(raw.from,raw.to);
    };
    const context=range(brief.context,'context'), scout=range(brief.scout ?? brief.recall,'scout');
    const call=range(brief.call,'call'), recall=range(brief.recall,'recall');
    check([scout,call,recall].every(span=>encloses(context,span)) && call.to<=recall.from &&
      [scout,call,recall].every(span=>span.to-span.from>=.40*rate) && (context.to-context.from)*8<=16e6,
    'Put the scout, first call and later recall in the same bounded listening context');
    check(fields(brief.accompaniment,['bass','metal','response','hook','support','withhold','bassMidi','returnMidi','metalMidi']),
      'Supply the bass, metal and response ranges for the arrangement');
    const types=[
      ['source','sound',brief.sources,['patch'],row=>record(row.patch) &&
        !['gestures','echo','performance'].some(key=>Object.hasOwn(row.patch,key))],
      ['performance','phrase',brief.performances,['edits'],row=>Array.isArray(row.edits) && integer(row.edits.length,1,128) &&
        Array.from(row.edits).every(change=>change?.lane===lead &&
          ['record-phrase','phrase-point','comp-phrase','comp'].includes(change.op))],
      ['arrangement','cue',brief.arrangements,['return','settings'],row=>['exposed','withheld','handoff'].includes(row.return) &&
        fields(row.settings ?? {},['support','withhold','bassMidi','returnMidi','metalMidi'])]
    ];
    for (const [stage,,rows,keys,valid] of types) check(Array.isArray(rows) && integer(rows.length,1,24) &&
      new Set(rows.map(row=>row?.id)).size===rows.length && Array.from(rows).every(row=>
        fields(row,['id','family','change',...keys]) && id(row.id) && id(row.family ?? row.id) &&
        R.prose(row.change,640) && valid(row)),'Give '+stage+' one to twenty-four named variations and a listening hypothesis');
    const scoped={context:pair(context),scout:pair(scout),focus:pair(context)};
    const reports={}, sessions={current:freeze(clone(session))};
    const rows=[];
    let current;
    for (const [stage,axis,choices] of types) {
      const origin=stage==='arrangement' ? sessions.performance : session;
      const plans=new Map();
      const sweep=experiments.sweep(origin,{...scoped,seed,id:'ballot-'+stage,
        roles:stage==='arrangement' ? {} : {hook:lead},
        advance:{limit:advance,disagreement:Math.min(1,advance-1),diversity:[axis]},
        axes:{[axis]:choices.map(({id,family})=>({id,...(family && {family})}))}},{
        lockHook:stage==='source',
        build(name) {
          const row=choices.find(row=>row.id===name);
          if (stage==='source') return swap(base,lead,row.patch);
          if (stage==='performance') {
            const next=edit(session,row.edits);
            check(sameLeadSource(base,compile(next),lead),'Performance swaps must retain the written lead and its source');
            return next;
          }
          const result=accompaniment.draft(origin,{...brief.accompaniment,...row.settings,lead,context:pair(context)},row.return);
          plans.set(name,result.report);
          return result.sessions[row.return];
        }
      });
      const advanced=sweep.value.shortlist.filter(row=>row.status==='heard');
      if (stage==='source') current=sweep.clips.reference;
      const compared=[current,...rows.map(row=>row.clip)];
      const duplicates=advanced.filter(row=>compared.some(clip=>!distinct(sweep.clips[row.id],clip)));
      const pick=advanced.filter(row=>!duplicates.includes(row)).sort((a,b)=>
        b.metrics.whole.foreground+b.metrics.whole.pocket-a.metrics.whole.foreground-a.metrics.whole.pocket)[0];
      check(pick,'No distinct usable '+stage+' branch advanced. '+sweep.value.candidates.map(row=>
        row.axes[axis].id+': '+(row.reason ?? sweep.value.shortlist.find(item=>item.id===row.id)?.error ??
          (duplicates.some(item=>item.id===row.id) ? 'same after level matching' : row.status))).join('; '));
      const candidate=sweep.value.candidates.find(row=>row.id===pick.id), variant=candidate.axes[axis].id;
      const choice=choices.find(row=>row.id===variant);
      reports[stage]={variant,batch:sweep.value,levelTwins:duplicates.map(row=>row.id),...(plans.has(variant) && {accompaniment:plans.get(variant)})};
      sessions[stage]=freeze(sweep.sessions[pick.id]);
      rows.push({stage,variant,change:choice.change,clip:sweep.clips[pick.id]});
    }
    rows.unshift({stage:'current',variant:'current',change:'The current session passage.',clip:current});
    const gap=Math.round(rate*(brief.gapSeconds ?? 1.5));
    const result=blind(rows,context,[
      {id:'identity',prompt:prompts.identity,ranges:[call,recall],gap},
      {id:'replay',prompt:prompts.replay,ranges:[context],gap:0}
    ],{rate,seed,name:brief.id ?? 'four-way',target:brief.targetLufs ?? -18,ceiling:brief.ceilingDbTP ?? -1.2});
    return {...result,sessions,report:freeze({format:format+'-report',version:1,token:result.test.token,
      sampleRate:rate,ranges:{context,scout,call,recall},search:reports})};
  };

  function archive(key,vote,audio) {
    const {test,map}=key ?? {};
    check(fields(key,['format','version','test','map']) && key.format===keyFormat && key.version===1 &&
      test?.format===format && test.version===1 && integer(test.sampleRate,8000,96000) && id(test.id) &&
      serial(test.labels)===serial(labels) && Array.isArray(test.questions) &&
      serial(test.questions.map(row=>row.id))===serial(Object.keys(prompts)) &&
      fields(map,Object.keys(prompts)) && fields(audio,Object.keys(prompts)),'Use the private key and audio from a four-way ballot');
    const {token,...publicInfo}=test;
    check(token===signature([publicInfo,map]) && fields(vote,['token','listener','answers']) && vote.token===token &&
      id(vote.listener) && fields(vote.answers,Object.keys(prompts)) && Object.keys(vote.answers).length>0,
    'Supply answers and a listener ID for this blind ballot');
    for (const {id,frames} of test.questions) {
      check(integer(frames,1,3e6) && fields(audio[id],labels) && fields(map[id],labels) &&
        labels.every(label=>fields(map[id][label],['stage','variant','change','audioHash','playback']) &&
          typeof map[id][label].audioHash==='string') &&
        serial(Object.values(map[id]).map(row=>row.stage).sort())===serial(names.slice().sort()),
      'Four excerpt labels must match the private key');
      for (const label of labels) {
        const clip=P.mediaGraph.audio(audio[id][label]);
        check(clip.sampleRate===test.sampleRate && clip.channels===2 && clip.samples.length===2*frames &&
          R.excerptHash(clip.samples)===map[id][label].audioHash,'The audio no longer matches this ballot');
      }
    }
    const answers=Object.fromEntries(Object.entries(vote.answers).map(([question,row])=>{
      check(fields(row,['choices','reason']) && Array.isArray(row.choices) && integer(row.choices.length,1,4) &&
        new Set(row.choices).size===row.choices.length && Array.from(row.choices).every(label=>labels.includes(label)) &&
        R.prose(row.reason,2000),'Choose a favorite or tied favorites and write what you heard');
      const choices=row.choices.slice().sort();
      return [question,{choices,tie:choices.length>1,reason:row.reason.trim(),
        versions:choices.map(label=>({label,...map[question][label]}))}];
    }));
    return freeze({format:format+'-record',version:1,test:clone(test),listener:vote.listener,answers});
  }

  P.mediaGraph.performanceBallot=Object.freeze({archive});
})(KIT.procedural);
