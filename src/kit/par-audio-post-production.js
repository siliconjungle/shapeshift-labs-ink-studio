/* Sample-addressed recorder relink, picture review and delivery checks. */
(function (P) {
  const A=P.mediaGraph, T=P.takeTime, S=P.mediaGraphSupport;
  const {fields,record,integer,id,check}=P.musicInstruments;
  const kinds=['boom','lav','adr'];
  const token=value=>typeof value==='string' && value.length>0 && value.length<=64 && value.trim()===value;
  const clockSample=value=>integer(value,0,Number.MAX_SAFE_INTEGER) ||
    typeof value==='string' && /^\d{1,20}$/.test(value) && BigInt(value)<2n**64n;
  const key=(scene,take)=>JSON.stringify([scene,take]);
  const pcm=(data,source)=>({sampleRate:source.sampleRate,channels:source.channels,samples:data});
  const range=(raw,frames)=>fields(raw,['fromSample','toSample']) &&
    integer(raw.fromSample,0,frames-1) && integer(raw.toSample,raw.fromSample+1,frames);

  function relink(session,assets,settings) {
    const E=A.audioEditorial, base=E.inspect(session,assets), selected=new Map(base.clips.map(row=>[row.id,row]));
    check(fields(settings,['recordings','links']) && Array.isArray(settings.recordings) &&
      settings.recordings.length<=256 && Array.isArray(settings.links) && settings.links.length<=128,
    'Relink needs a field-recorder catalog and a clip link list');
    const recordings=new Map(), rolls=new Map(), sources={...assets}, reads=new Map(), changes=[], report=[], seen=new Set();
    for (const row of settings.recordings) {
      check(fields(row,['id','asset','scene','take','kind','channels','timeReference','anchors']) &&
        id(row.id) && !recordings.has(row.id) && id(row.asset) && Object.hasOwn(assets,row.asset) &&
        token(row.scene) && token(row.take) && kinds.includes(row.kind) &&
        (row.timeReference===undefined || clockSample(row.timeReference)) &&
        record(row.anchors ?? {}) && Object.keys(row.anchors ?? {}).length<=128 &&
        Object.entries(row.anchors ?? {}).every(([name,sample])=>id(name) && integer(sample,0,32000000)),
      'Invalid or duplicate field-recorder source');
      if (!reads.has(row.asset)) reads.set(row.asset,A.audio(assets[row.asset]));
      const source=reads.get(row.asset), channels=row.channels ?? (source.channels===1 ? [0] : [0,1]);
      check(Array.isArray(channels) && integer(channels.length,1,2) && new Set(channels).size===channels.length &&
        Array.from(channels).every(channel=>integer(channel,0,source.channels-1)) &&
        (source.channels<=2 || row.channels!==undefined),
      'Choose the channel or stereo pair on a polyphonic recorder file');
      const frames=source.samples.length/source.channels;
      check(Object.values(row.anchors ?? {}).every(sample=>sample<frames),'Recorder anchor lies outside its source');
      const take={...row,channels,source,frames};
      recordings.set(row.id,take);
      const roll=key(row.scene,row.take);
      if (!rolls.has(roll)) rolls.set(roll,[]);
      rolls.get(roll).push(take);
    }
    const generated=new Map();
    let budget=0;
    for (const row of settings.links) {
      check(fields(row,['clip','scene','take','anchor','recorderSample','alternates','prefer','handles']) &&
        id(row.clip) && selected.has(row.clip) && !seen.has(row.clip) && token(row.scene) && token(row.take) &&
        (row.anchor===undefined || id(row.anchor)) && (row.recorderSample===undefined || clockSample(row.recorderSample)) &&
        (row.anchor!==undefined || row.recorderSample!==undefined) &&
        (row.prefer===undefined || id(row.prefer)) && integer(row.handles ?? 0,0,session.sampleRate*10) &&
        Array.isArray(row.alternates ?? []) && (row.alternates ?? []).length<=12 &&
        Array.from(row.alternates ?? []).every(name=>recordings.get(name)?.scene===row.scene),
      'A recorder link needs a unique clip, exact scene/take, and source anchor or recorder sample');
      seen.add(row.clip);
      const candidates=[...new Set([...(rolls.get(key(row.scene,row.take)) ?? []),
        ...(row.alternates ?? []).map(name=>recordings.get(name))])];
      check(candidates.length<=15 && (row.prefer===undefined || candidates.some(take=>take.id===row.prefer)),
        'Recorder link has too many matches or an unknown preferred take');
      const current=selected.get(row.clip), left=-current.source.first, right=current.source.last;
      const result={clip:row.clip,scene:row.scene,take:row.take,alternates:[],issues:[]};
      for (const take of candidates) {
        const {source,frames}=take, rate=source.sampleRate;
        const reference=take.timeReference ?? assets[take.asset].bwf?.timeReference;
        let pin=row.anchor!==undefined && Object.hasOwn(take.anchors ?? {},row.anchor) ? take.anchors[row.anchor] : undefined;
        let alignment='marked';
        if (pin===undefined && row.recorderSample!==undefined && clockSample(reference)) {
          const position=T.roundDown(T.div([BigInt(row.recorderSample)*BigInt(rate),1n],T.read(session.sampleRate)));
          const exact=position-BigInt(reference);
          if (exact>=0n && exact<BigInt(frames)) pin=Number(exact);
          alignment='broadcast-wave';
        }
        if (pin===undefined) {
          result.issues.push({source:take.id,reason:'missing-sync'});
          continue;
        }
        const scale=rate/session.sampleRate, start=pin-Math.floor(left*scale), end=pin+Math.floor(right*scale);
        if (start<0 || end>frames || end<=pin) {
          result.issues.push({source:take.id,reason:'insufficient-media',sourceSample:pin});
          continue;
        }
        const direct=source.channels===take.channels.length && take.channels.every((channel,i)=>i===channel);
        const asset=direct ? take.asset : 'rec-'+take.id;
        check(id(asset) && (direct || !Object.hasOwn(assets,asset)),'Recorder channel asset ID collides with the existing bank');
        if (!direct && !generated.has(asset)) {
          budget+=frames*take.channels.length;
          check(budget<=16e6,'Recorder channel extraction exceeds its PCM budget');
          const data=new Float64Array(frames*take.channels.length);
          for (let i=0;i<frames;i++) for (const [ch,channel] of take.channels.entries())
            data[i*take.channels.length+ch]=source.samples[i*source.channels+channel];
          sources[asset]={sampleRate:rate,channels:take.channels.length,samples:data};
          generated.set(asset,take.asset);
        }
        const handles=Math.floor((row.handles ?? 0)*scale), trim={asset,sync:{sample:pin},
          fromSample:start,toSample:end,handles:{fromSample:Math.max(0,start-handles),toSample:Math.min(frames,end+handles)}};
        const old=session.clips.find(clip=>clip.id===row.clip).takes;
        check(!Object.hasOwn(old,take.id) || JSON.stringify(old[take.id])===JSON.stringify(trim),
          'Recorder take ID collides with an existing edit on '+row.clip);
        changes.push({op:'put-take',clip:row.clip,take:take.id,source:trim});
        result.alternates.push({id:take.id,kind:take.kind,asset,channels:take.channels,sourceSample:pin,alignment});
      }
      if (!candidates.length) result.issues.push({reason:'scene-take-not-found'});
      if (row.prefer!==undefined && result.alternates.some(take=>take.id===row.prefer) && current.take!==row.prefer) {
        if (current.comp.length) changes.push({op:'comp',clip:row.clip,ranges:[]});
        changes.push({op:'take',clip:row.clip,take:row.prefer});
      }
      result.selected=result.alternates.some(take=>take.id===row.prefer) ? row.prefer : current.take;
      report.push(result);
    }
    const {value}=E.revise(session,sources,changes);
    return {value,assets:sources,report:{links:report,generated:Object.fromEntries(generated)}};
  }

  function reviewPicture(session,assets,revision) {
    const result=A.audioEditorial.reconform(session,assets,revision), attention=[];
    const before=S.editorialClock(session).shotSpans(), after=S.editorialClock(result.session).shotSpans();
    const prior=new Map(before.map(row=>[row.id,row]));
    const proposed=new Map(after.map(row=>[row.id,row]));
    const picture=[...new Set([...prior.keys(),...proposed.keys()])].map(id=>{
      const a=prior.get(id) ?? null,b=proposed.get(id) ?? null;
      const change=a===null ? 'added' : b===null ? 'removed' :
        a.inFrame!==b.inFrame || a.frames!==b.frames ? 'trimmed' :
          a.fromSample!==b.fromSample ? 'moved' : 'unchanged';
      return {id,change,before:a,after:b};
    });
    for (const change of result.report.changes) {
      if (change.after.issue) attention.push({clip:change.id,reason:change.after.issue,action:'respots-or-remove'});
      else if (change.status==='trimmed' || change.afterRange?.toSample<=change.afterRange?.fromSample)
        attention.push({clip:change.id,reason:'range-changed',action:'check-handles'});
    }
    for (const collision of result.report.collisions)
      attention.push({clips:collision.clips,reason:'new-overlap',action:'audition-overlap'});
    return {...result,report:{...result.report,picture,attention}};
  }

  function verify(mix,stems) {
    const source=A.audio(mix);
    check(record(stems) && Object.keys(stems).length>=1 && Object.keys(stems).length<=48,
      'Verify at least one aligned stem');
    const lanes=Object.entries(stems).map(([name,value])=>{
      const stem=A.audio(value);
      check(stem.sampleRate===source.sampleRate && stem.channels===source.channels &&
        stem.samples.length===source.samples.length,'Stem clock differs from the print: '+name);
      return stem.samples;
    });
    let maxError=0,power=0,worstSample=0;
    for (let i=0;i<source.samples.length;i++) {
      let sum=0;
      for (const values of lanes) sum+=values[i];
      const error=Math.abs(sum-source.samples[i]);
      if (error>maxError) {
        maxError=error;
        worstSample=Math.floor(i/source.channels);
      }
      power+=error*error;
    }
    return {frames:source.samples.length/source.channels,sampleRate:source.sampleRate,channels:source.channels,
      stems:Object.keys(stems),maxError,rmsError:Math.sqrt(power/source.samples.length),worstSample};
  }
  A.postProduction={relink,reviewPicture,verify};
})(KIT.procedural);
