/* Assemble independent session forks, audition the matrix and keep heard revisions. */
(function (P) {
  const S=P.mediaGraphSupport, {fields,record,integer,id,finite,check}=P.musicInstruments;
  const {clone,freeze,hash}=P.data;
  const format='ink-studio/music-experiment', levels=['sound','phrase','cue'];
  const text=(value,limit)=>typeof value==='string' && value.trim().length>0 && value.length<=limit;
  const serial=value=>JSON.stringify(value);
  const own=(table,key)=>Object.hasOwn(table,key) ? table[key] : undefined;
  const bound=(plan,raw)=>{
    check(fields(raw,['from','to']),'Choose an experiment range with from and to addresses');
    return plan.range(raw.from,raw.to);
  };
  const includes=(wide,narrow)=>wide.from<=narrow.from && wide.to>=narrow.to;
  const intersects=(a,b)=>a.from<b.to && a.to>b.from;
  const digest=value=>(hash(serial(value))>>>0).toString(36);

  function segments(plan,lane,span) {
    const {reference}=S.musicSessionModel, fallback=plan.audio.get(lane)?.take ?? reference;
    const output=[];
    let start=span.from;
    for (const pick of plan.choices) {
      if (pick.lane!==lane || !intersects(pick,span)) continue;
      const from=Math.max(span.from,pick.from), to=Math.min(span.to,pick.to);
      if (start<from) output.push({from:start,to:from,take:fallback});
      output.push({from,to,take:pick.take,...(pick.fadeSamples && {fade:[pick.from,pick.to,pick.fadeSamples]})});
      start=to;
    }
    if (start<span.to) output.push({from:start,to:span.to,take:fallback});
    return output;
  }

  function protectedLane(plan,lane,span,mode) {
    const recording=plan.audio.get(lane);
    const words=(take,{from,to})=>{
      const {score,source}=plan.producers.get(take), track=score.tracks[lane];
      const first=from/plan.rate, last=to/plan.rate;
      const rows=score.events[lane].filter(row=>row.time<last &&
        (mode==='all' ? row.time+row.gate>first : row.time>=first));
      if (mode==='pitch') return rows.map(row=>[row.voice ?? null,row.midi]);
      if (mode==='onsets') return rows.map(({beat,time,midi,frequency,voice})=>[beat,time,midi,frequency,voice]);
      const cue=Object.fromEntries(Object.entries(score.cue?.perTrack[lane] ?? {}).filter(([,rows])=>rows.length));
      return {rows,track:source.tracks[lane],patch:source.patches[track.patch],cue,gain:score.gain,
        duck:track.mix.duck && score.events[track.mix.duck.from]};
    };
    const picks=segments(plan,lane,span);
    if (mode!=='all') return picks.flatMap(({take,...row})=>words(take,row));
    return picks.map(({take,...row})=>({...row,
      content:recording ? recording.takes.get(take) : words(take,row),
      ...(row.fade && {fromTake:recording ? recording.takes.get(recording.take) :
        words(S.musicSessionModel.reference,row)})}));
  }

  function setup(base,brief) {
    check(fields(brief,['id','goal','seed','focus','scout','context','roles','locks','axes','advance','targets','screen']) &&
      id(brief.id ?? 'experiment') && Number.isSafeInteger(brief.seed ?? 0) &&
      (brief.goal===undefined || text(brief.goal,640)) && fields(brief.axes,levels) && Object.keys(brief.axes).length,
      'An experiment needs named sound, phrase or cue variants and a focus range');
    const focus=bound(base,brief.focus), scout=bound(base,brief.scout ?? brief.focus), context=bound(base,brief.context ?? brief.focus);
    check(includes(focus,scout) && includes(context,focus),'The scout must sit in the focus and the focus in its context');
    const roles=brief.roles ?? {};
    check(fields(roles,['hook','kick','bass']) && Object.values(roles).every(name=>base.lanes.includes(name)) &&
      new Set(Object.values(roles)).size===Object.keys(roles).length,'Choose distinct experiment lanes');
    const locks=brief.locks ?? [];
    check(Array.isArray(locks) && locks.length<=32 && Array.from(locks).every(row=>
      fields(row,['lane','range','mode']) && base.lanes.includes(row.lane) &&
      ['onsets','pitch','all'].includes(row.mode ?? 'onsets') &&
      (!base.audio.has(row.lane) || row.mode==='all')),'Choose valid experiment locks');
    const sentinels=locks.map(row=>({lane:row.lane,span:row.range ? bound(base,row.range) : focus,mode:row.mode ?? 'onsets'}));
    if (roles.hook && !base.audio.has(roles.hook)) sentinels.push({lane:roles.hook,span:focus,mode:'onsets'});
    else if (roles.hook) sentinels.push({lane:roles.hook,span:focus,mode:'all'});
    for (const [lane,mode] of Object.entries(base.pins)) sentinels.push({lane,span:{from:0,to:base.frames},mode});
    for (const row of sentinels) row.before=serial(protectedLane(base,row.lane,row.span,row.mode));

    let matrix=[[]];
    for (const axis of levels) {
      if (!Object.hasOwn(brief.axes,axis)) continue;
      const variants=brief.axes[axis];
      check(Array.isArray(variants) && integer(variants.length,1,24) &&
        new Set(variants.map(row=>row?.id)).size===variants.length &&
        Array.from(variants).every(row=>fields(row,['id','label','family','revision','edits']) && id(row.id) &&
          id(row.family ?? row.id) && text(row.label ?? row.id,120) &&
          (row.revision===undefined || record(row.revision) && row.revision.unpin===undefined) &&
          (row.edits===undefined || Array.isArray(row.edits) && row.edits.length<=128 &&
            Array.from(row.edits).every(edit=>record(edit) && edit.op!=='pin'))),
      'Give '+axis+' distinct named variants with protected revisions or session edits');
      check(matrix.length*variants.length<=256,'An experiment can render up to 256 combinations');
      matrix=matrix.flatMap(rows=>variants.map(row=>[...rows,{axis,...row}]));
    }
    const {limit=12,disagreement=Math.min(2,limit-1),diversity=['phrase','sound','cue']}=brief.advance ?? {};
    check(fields(brief.advance ?? {},['limit','disagreement','diversity']) && integer(limit,1,24) &&
      integer(disagreement,0,limit-1) && Array.isArray(diversity) && integer(diversity.length,1,3) &&
      new Set(diversity).size===diversity.length && Array.from(diversity).every(axis=>levels.includes(axis)),
    'Choose distinct coverage axes and a bounded number of context and disagreement slots');
    check((scout.to-scout.from)*(matrix.length+1)*2<=192e6 &&
      (context.to-context.from)*(Math.min(matrix.length,limit)+1)*2<=24e6,
    'Experiment exceeds its listening budget. Shorten the windows or reduce the matrix or shortlist');
    const targets={hookDb:-2,contrastDb:10,kickBass:.35,levelDb:-22,...brief.targets};
    const screen={floorDb:-75,allowNormalization:false,...brief.screen};
    check(fields(brief.targets ?? {},['hookDb','contrastDb','kickBass','levelDb']) &&
      finite(targets.hookDb,-36,36) && finite(targets.contrastDb,0,50) && finite(targets.kickBass,0,1) &&
      finite(targets.levelDb,-64,0) && fields(brief.screen ?? {},['floorDb','allowNormalization']) &&
      finite(screen.floorDb,-120,-18) && typeof screen.allowNormalization==='boolean','Invalid experiment acoustic targets or screen');
    return {focus,scout,context,matrix,roles,sentinels,targets,screen,advance:{limit,disagreement,diversity}};
  }

  S.createSessionExperiment=({compile,render,edit,assets})=>{
    const E=S.sessionExperimentEvidence, reference=P.musicCritiqueReferences;
    const at=({from,to})=>({from:{samples:from},to:{samples:to}});
    const signature=(source,brief)=>({source:digest(source),brief:digest(brief),assets:digest(reference.assetSignature(assets))});
    const identity=index=>'take-'+String(index+1).padStart(3,'0');

    function apply(source,variants) {
      let session=source;
      for (const variant of variants) {
        if (variant.revision) {
          const bank=S.musicSessionModel.instruments(assets,session.production,variant.revision);
          const production=P.musicProduction.revise(session.production,variant.revision,bank);
          session={...session,production};
        }
        if (variant.edits?.length) session=edit(session,variant.edits);
      }
      return session;
    }
    function guarded(base,session,sentinels) {
      const candidate=compile(session);
      check(candidate.rate===base.rate && candidate.frames===base.frames && serial(candidate.map)===serial(base.map) &&
        serial(candidate.lanes)===serial(base.lanes),'Experiment branches must share the session clock and lanes');
      for (const row of sentinels) check(row.before===serial(protectedLane(candidate,row.lane,row.span,row.mode)),
        'Changes locked '+row.mode+' on '+row.lane);
      return candidate;
    }

    function run(source,brief,options={}) {
      check(fields(options,['onScout']) && (options.onScout===undefined || typeof options.onScout==='function'),
        'Invalid experiment output callback');
      const base=compile(source), model=setup(base,brief), {scout,focus,context,roles,matrix,sentinels,targets,screen}=model;
      const taps={...base.mixer.taps}, probe={};
      for (const [kind,lane] of Object.entries(roles)) {
        let name=Object.keys(taps).find(key=>taps[key].strip===lane && (taps[key].tap ?? 'post')==='post');
        if (!name) {
          name='experiment-'+kind;
          while (Object.hasOwn(taps,name)) name+='x';
          taps[name]={strip:lane,tap:'post'};
        }
        probe[kind]=name;
      }
      check(Object.keys(taps).length<=20,'Experiment role taps exceed the session tap budget');
      const hear=(plan,span)=>render({...plan,mixer:{...plan.mixer,taps,
        ...(!screen.allowNormalization && {peakPolicy:'error'})}},at(span));
      const metric=result=>E.measure(result,probe,targets);
      const spans=result=>{
        const a=focus.from-context.from,b=focus.to-context.from;
        return {whole:metric(result),focus:E.measure(result,probe,targets,a,b),
          leadIn:a>0 ? E.measure(result,probe,targets,0,a) : null,
          follow:b<result.report.frames ? E.measure(result,probe,targets,b) : null};
      };
      const baseScout=hear(base,scout), baseline=metric(baseScout);
      check(!roles.hook || baseline.hookToBedDb!==null,'The scout window needs the sounding reference hook');
      const fingerprintOf=(result,metrics)=>serial([reference.audioHash(result.value.samples),
        result.value.samples.length,metrics.rmsDb,metrics.peakDb,metrics.gain]);
      const exact=new Map([[serial(source),'reference']]), fingerprints=new Map([
        [fingerprintOf(baseScout,baseline),'reference']]);
      const candidates=[], eligible=[];
      let renders=0;
      for (const [index,variants] of matrix.entries()) {
        const id=identity(index), axes=Object.fromEntries(variants.map(({axis,id,label,family})=>
          [axis,{id,label:label ?? id,family:family ?? id}]));
        const row={id,axes};
        candidates.push(row);
        let audible;
        try {
          const session=apply(source,variants), plan=guarded(base,session,sentinels), spec=serial(session);
          if (exact.has(spec)) {
            Object.assign(row,{status:'duplicate',duplicateOf:exact.get(spec)});
            continue;
          }
          audible=hear(plan,scout);
          renders++;
          exact.set(spec,id);
          row.metrics=metric(audible);
          row.renderPath=audible.report.renderPath;
          if (row.metrics.rmsDb<screen.floorDb || roles.hook && row.metrics.hookToBedDb===null ||
            !screen.allowNormalization && row.metrics.gain<1) {
            row.status='rejected';
            row.reason=row.metrics.rmsDb<screen.floorDb ? 'Below the scout floor' : roles.hook && row.metrics.hookToBedDb===null ?
              'Hook is silent in scout' : 'Scout needed peak normalization';
          } else {
            const fingerprint=fingerprintOf(audible,row.metrics), match=fingerprints.get(fingerprint);
            if (match) row.scoutTwinOf=match;
            else fingerprints.set(fingerprint,id);
            row.status='scouted';
            row.fingerprint=fingerprint;
            eligible.push(row);
          }
        } catch (error) {
          Object.assign(row,{status:'rejected',reason:error.message});
        }
        if (audible && options.onScout) options.onScout(id,audible.value);
      }
      const referenceContext=hear(base,context);
      const shortlist=E.advance(eligible,model.advance,brief.seed ?? 0);
      const listening=audio=>({audio:audio.value,headroom:audio.report.mixer.headroom});
      const heard=new Map([['reference',listening(referenceContext)]]), baselineContext=spans(referenceContext);
      const fullFingerprints=new Map([[fingerprintOf(referenceContext,baselineContext.whole),'reference']]);
      let contextRenders=0;
      for (const row of shortlist) {
        const candidate=candidates.find(entry=>entry.id===row.id);
        const index=Number(row.id.slice(5))-1;
        try {
          const plan=guarded(base,apply(source,matrix[index]),sentinels);
          const audio=hear(plan,context);
          contextRenders++;
          row.metrics=spans(audio);
          const signature=fingerprintOf(audio,row.metrics.whole), twin=fullFingerprints.get(signature);
          if (!screen.allowNormalization && row.metrics.whole.gain<1) {
            row.status='rejected';
            row.error='Context needed peak normalization';
          } else if (twin) {
            row.status='duplicate';
            row.duplicateOf=twin;
          } else {
            fullFingerprints.set(signature,row.id);
            row.status='heard';
            row.renderPath=audio.report.renderPath;
            candidate.status='advanced';
            heard.set(row.id,listening(audio));
          }
        } catch (error) {
          row.status='rejected';
          row.error=error.message;
        }
      }
      const gain=Math.min(...[...heard.values()].map(row=>row.headroom));
      const clips=Object.fromEntries([...heard].map(([id,{audio,headroom}])=>{
        const scale=gain/headroom;
        return [id,scale===1 ? audio : {...audio,samples:Float64Array.from(audio.samples,sample=>sample*scale)}];
      }));
      const value=freeze({format,version:1,id:brief.id ?? 'experiment',brief:clone(brief),scope:signature(source,brief),
        sampleRate:base.rate,ranges:{focus,scout,context},attempted:matrix.length,scoutRenders:renders,
        contextRenders,contextHeard:heard.size-1,gain,baseline:{scout:baseline,context:baselineContext},candidates,shortlist});
      return {value,clips};
    }

    function keep(source,report,choice) {
      check(fields(choice,['candidate','reason']) && id(choice.candidate) && text(choice.reason,1000) &&
        report?.format===format && report.version===1 && Array.isArray(report.shortlist) &&
        report.shortlist.some(row=>row.id===choice.candidate && row.status==='heard'),
      'Choose a fully auditioned experiment candidate and record the listening reason');
      check(serial(signature(source,report.brief))===serial(report.scope),'Experiment belongs to a different session, brief or asset bank');
      const base=compile(source), {matrix,sentinels}=setup(base,report.brief), index=matrix.findIndex((_,i)=>identity(i)===choice.candidate);
      check(index>=0,'Unknown experiment candidate');
      const session=apply(source,matrix[index]);
      guarded(base,session,sentinels);
      return {value:freeze(clone(session)),decision:freeze({experiment:report.id,candidate:choice.candidate,reason:choice.reason,
        axes:Object.fromEntries(matrix[index].map(row=>[row.axis,row.id])),scope:report.scope})};
    }
    return {run,keep};
  };
})(KIT.procedural);
