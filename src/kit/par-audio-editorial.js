/* Nondestructive, sync-anchored editorial with alternate takes and reconform. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,T=P.takeTime,{fields,record,id,integer,finite,check}=P.musicInstruments;
  const format='ink-studio/audio-editorial',limit=16e6;
  const curves=['linear','equal-power'];
  const ceil=([n,d])=>T.index(-T.roundDown([-n,d]));
  const blend=(u,curve)=>curve==='equal-power' ? [Math.cos(u*Math.PI/2),Math.sin(u*Math.PI/2)] : [1-u,u];
  const edge=(u,curve)=>curve==='equal-power' ? Math.sin(Math.PI*.5*u) : u;
  function table(value,max,label) {
    check(record(value) && Object.keys(value).length<=max && Object.keys(value).every(id),'Invalid '+label+' table');
    return Object.entries(value);
  }
  function compile(session,assets) {
    check(fields(session,['format','version','id','sampleRate','picture','world','map','sourceEdits','clips','clockMap']) &&
      session.format===format && session.version===1 && id(session.id) &&
      integer(session.sampleRate,8000,96000) && record(assets) && Array.isArray(session.clips) &&
      session.clips.length<=512,'Expected a bounded audio editorial session');
    const {sampleRate}=session, clock=S.editorialClock(session), editDocs=new Map(table(session.sourceEdits ?? {},128,'source edit'));
    const inputs=new Map(), edits=new Map(), stretchTail=S.editorialTails();
    let budget=0;
    function load(asset) {
      check(id(asset) && Object.hasOwn(assets,asset),'Missing editorial source '+asset);
      if (!inputs.has(asset)) {
        const source=A.audio(assets[asset]), frames=source.samples.length/source.channels;
        budget+=source.samples.length;
        check(source.channels<=2 && frames>0 && budget<=32e6,'Editorial source exceeds the stereo PCM budget');
        inputs.set(asset,{source,frames});
      }
      return inputs.get(asset);
    }
    function marker(asset,key) {
      if (!edits.has(asset)) {
        check(editDocs.has(asset),'Named sync marker needs a source edit for '+asset);
        const doc=A.sampleEdit.validate(editDocs.get(asset)), {source,frames}=load(asset);
        check(doc.source.sampleRate===source.sampleRate && doc.source.channels===source.channels &&
          doc.source.frames===frames,'Source edit does not match the editorial PCM');
        edits.set(asset,new Map(doc.markers.map(row=>[row.id,row.at])));
      }
      const index=edits.get(asset).get(key);
      check(index!==undefined,'Unknown source sync marker '+key);
      return index;
    }
    function take(raw) {
      check(fields(raw,['asset','sync','fromSample','toSample','handles','slip','tail']),
        'Invalid editorial take');
      const {asset,sync,fromSample=0}=raw, {source,frames}=load(asset), {toSample=frames}=raw;
      const handles=raw.handles ?? {fromSample:0,toSample:frames};
      check(fields(handles,['fromSample','toSample']) && integer(handles.fromSample,0,frames-1) &&
        integer(handles.toSample,handles.fromSample+1,frames) && integer(fromSample,handles.fromSample,handles.toSample-1) &&
        integer(toSample,fromSample+1,handles.toSample),'Take range exceeds its available source handles');
      const marked=fields(sync,['marker']) && id(sync.marker);
      check(marked || fields(sync,['sample']) && integer(sync.sample,0,frames-1),'A take needs a source sample or named sync marker');
      const pin=marked ? marker(asset,sync.marker) : sync.sample;
      check(pin>=fromSample && pin<toSample,'Take trim would remove its sync sample');
      const step=source.sampleRate/sampleRate, ratio=T.div(T.read(sampleRate),T.read(source.sampleRate));
      check(finite(step,1/128,16),'Editorial resampling ratio exceeds its range');
      const offset=sourceSample=>ceil(T.mul(T.read(sourceSample-pin),ratio));
      const tail=stretchTail(source,fromSample,toSample,pin,step,raw.tail);
      const first=offset(fromSample), last=offset(tail?.end ?? toSample), original=S.pcmReader(source,fromSample,toSample,step);
      const slip=raw.slip;
      let displaced, joinEnd=0, joinStart=0;
      if (slip!==undefined) {
        check(fields(slip,['samples','joinSamples']) && integer(slip.samples,-frames,frames) &&
          integer(slip.joinSamples,1,sampleRate*2),'Invalid protected head slip');
        if (slip.samples) {
          joinEnd=-Math.max(0,offset(pin+Math.max(0,slip.samples)));
          joinStart=joinEnd-slip.joinSamples;
          check(first<=joinStart && fromSample+slip.samples>=handles.fromSample &&
            fromSample+slip.samples<pin,'Head slip exceeds handles or leaves no join before the sync');
          displaced=S.pcmReader(source,handles.fromSample,pin,step);
        }
      }
      const pcm=(t,out,scratch)=>{
        const position=pin+t*step;
        if (tail?.read && position>=tail.info.fromSample) tail.read(position,out);
        else original.read(position,out);
        if (displaced && t<joinEnd) {
          displaced.read(position+slip.samples,scratch);
          const u=Math.max(0,(t-joinStart)/slip.joinSamples);
          out[0]=scratch[0]+(out[0]-scratch[0])*u;
          out[1]=scratch[1]+(out[1]-scratch[1])*u;
        }
      };
      return {asset,sourceSync:pin,sourceRate:source.sampleRate,range:{fromSample,toSample},handles:{...handles},
        first,last,cost:original.cost*(displaced ? 2 : 1),pcm,
        ...(marked && {marker:sync.marker}),...(slip && {slip:{...slip}}),...(tail && {tail:tail.info})};
    }
    const tracks=new Set(), ids=new Set(), clips=[];
    for (const raw of session.clips) {
      check(fields(raw,['id','track','spot','take','takes','comp','fades','gain']) && id(raw.id) &&
        !ids.has(raw.id) && id(raw.track ?? 'main') && id(raw.take) && finite(raw.gain ?? 1,0,4),
      'Invalid or duplicate editorial clip');
      ids.add(raw.id);
      const track=raw.track ?? 'main';
      tracks.add(track);
      const takes=new Map(table(raw.takes,16,'alternate take').map(([name,row])=>[name,take(row)]));
      const choice=takes.get(raw.take);
      check(choice,'Choose an existing take for the clip');
      const {first,last}=choice, fades=raw.fades ?? {};
      check(fields(fades,['inSamples','outSamples','curve']) &&
        integer(fades.inSamples ?? 0,0,last-first) && integer(fades.outSamples ?? 0,0,last-first-(fades.inSamples ?? 0)) &&
        curves.includes(fades.curve ?? 'linear'),'Clip fades must fit within the selected take');
      const comp=raw.comp ?? [];
      check(Array.isArray(comp) && comp.length<=128,'Invalid time-range comp');
      const ranges=Array.from(comp,row=>{
        check(fields(row,['take','fromOffset','toOffset','fadeSamples','curve']) && id(row.take) && row.take!==raw.take,
          'Comp range needs an alternate take');
        const alt=takes.get(row.take), {fromOffset:from,toOffset:to,fadeSamples=0}=row;
        check(alt && integer(from,Math.max(first,alt.first),last-1) &&
          integer(to,from+1,Math.min(last,alt.last)) &&
          integer(fadeSamples,0,Math.floor((to-from-1)/2)) && curves.includes(row.curve ?? 'linear'),
        'Comp range and fades must fit both takes');
        return {from,to,fadeSamples,curve:row.curve ?? 'linear',take:row.take,alt};
      }).sort((a,b)=>a.from-b.from);
      check(ranges.every((row,i)=>i===0 || ranges[i-1].to<=row.from),'Comp ranges may not overlap');
      const spot=clock.spot(raw.spot);
      const {pcm,cost,...source}=choice;
      const report={id:raw.id,track,take:raw.take,source,spot,alternates:[...takes.keys()].filter(name=>name!==raw.take),
        fades:{inSamples:fades.inSamples ?? 0,outSamples:fades.outSamples ?? 0,curve:fades.curve ?? 'linear'},
        comp:ranges.map(({from,to,fadeSamples,curve,take,alt})=>({fromOffset:from,toOffset:to,
          fadeSamples,curve,take,asset:alt.asset,sourceSync:alt.sourceSync}))};
      if (!spot.issue) {
        const start=spot.sample+first, end=spot.sample+last;
        report.range={fromSample:Math.max(0,start),toSample:Math.min(clock.end,end)};
        report.clipped={head:Math.max(0,-start),tail:Math.max(0,end-clock.end)};
      }
      clips.push({report,choice,ranges,gain:raw.gain ?? 1});
    }
    check(tracks.size<=48,'Editorial exceeds its track budget');
    return {id:session.id,sampleRate,clock,clips,tracks};
  }
  function describe(plan) {
    return {id:plan.id,sampleRate:plan.sampleRate,pictureFrames:plan.clock.frames,frames:plan.clock.end,
      clips:plan.clips.map(row=>row.report)};
  }
  function mix(plan,frames,stems=false,allowUnresolved=false) {
    check(allowUnresolved || plan.clips.every(row=>!row.report.spot.issue),
      'Resolve the missing editorial spots or preview with allowUnresolved');
    check(frames*2*(1+(stems ? plan.tracks.size : 0))<=limit,'Editorial render exceeds its PCM budget');
    let cost=0;
    for (const {report,choice,ranges} of plan.clips) if (report.range) {
      cost+=(report.range.toSample-report.range.fromSample)*choice.cost;
      for (const row of ranges) cost+=(row.to-row.from)*row.alt.cost;
    }
    check(cost<=240e6,'Editorial render exceeds its resampling budget');
    const out=new Float64Array(2*frames), tracks=Object.fromEntries(stems ?
      [...plan.tracks].map(name=>[name,new Float64Array(out.length)]) : []);
    const current=[0,0], alternate=[0,0], scratch=[0,0];
    for (const {report,choice,ranges,gain} of plan.clips) {
      if (!report.range) continue;
      const {spot,range,fades,track}=report, dest=Object.hasOwn(tracks,track) ? tracks[track] : null;
      let index=0;
      for (let i=range.fromSample;i<range.toSample;i++) {
        const t=i-spot.sample;
        choice.pcm(t,current,scratch);
        while (index<ranges.length && t>=ranges[index].to) index++;
        const pick=ranges[index];
        if (pick && t>=pick.from) {
          pick.alt.pcm(t,alternate,scratch);
          const u=pick.fadeSamples ? Math.min(1,(t-pick.from)/pick.fadeSamples,(pick.to-1-t)/pick.fadeSamples) : 1;
          const [a,b]=blend(u,pick.curve);
          current[0]=current[0]*a+alternate[0]*b; current[1]=current[1]*a+alternate[1]*b;
        }
        const u=Math.min(1,fades.inSamples ? (t-choice.first)/fades.inSamples : 1,
          fades.outSamples ? (choice.last-1-t)/fades.outSamples : 1);
        const level=gain*edge(u,fades.curve), at=i*2, left=current[0]*level,right=current[1]*level;
        out[at]+=left; out[at+1]+=right;
        if (dest) {dest[at]+=left;dest[at+1]+=right;}
      }
    }
    return {out,tracks};
  }
  const audio=(samples,sampleRate)=>({samples,sampleRate,channels:2});
  function normalize(buffers) {
    let peak=0;
    for (const buffer of buffers) for (const value of buffer) {
      check(Number.isFinite(value),'Editorial resampling produced invalid PCM');
      peak=Math.max(peak,Math.abs(value));
    }
    const headroom=1/Math.max(1,peak);
    if (headroom<1) for (const buffer of buffers) for (let i=0;i<buffer.length;i++) buffer[i]*=headroom;
    return {peak,headroom};
  }
  function render(session,assets,options={}) {
    check(fields(options,['stems','allowUnresolved']) && [options.stems,options.allowUnresolved]
      .every(value=>value===undefined || typeof value==='boolean'),'Invalid editorial render options');
    const plan=compile(session,assets), {out,tracks}=mix(plan,plan.clock.end,options.stems,options.allowUnresolved);
    const meter=normalize([out,...Object.values(tracks)]);
    return {value:audio(out,plan.sampleRate),stems:Object.fromEntries(Object.entries(tracks)
      .map(([name,pcm])=>[name,audio(pcm,plan.sampleRate)])),report:{...describe(plan),...meter}};
  }
  function revise(session,assets,changes) {
    compile(session,assets);
    check(Array.isArray(changes) && changes.length<=512,'Expected a bounded editorial edit list');
    const next=P.data.clone(session), byId=new Map(next.clips.map(row=>[row.id,row]));
    for (const row of changes) {
      if (row?.op==='add-clip') {
        check(fields(row,['op','clip']) && record(row.clip) && id(row.clip.id) && !byId.has(row.clip.id),
          'New editorial clip needs a unique ID');
        byId.set(row.clip.id,P.data.clone(row.clip));
        continue;
      }
      const clip=byId.get(row?.clip);
      check(clip,'Unknown editorial clip');
      switch (row.op) {
        case 'remove-clip':
          check(fields(row,['op','clip']),'Invalid clip removal');
          byId.delete(row.clip);
          break;
        case 'spot':
          check(fields(row,['op','clip','spot']),'Invalid spotting edit');
          clip.spot=row.spot;
          break;
        case 'take':
          check(fields(row,['op','clip','take']) && id(row.take),'Invalid take selection');
          clip.take=row.take;
          break;
        case 'fades':
          check(fields(row,['op','clip','fades']),'Invalid fade edit');
          clip.fades=row.fades;
          break;
        case 'comp':
          check(fields(row,['op','clip','ranges']) && Array.isArray(row.ranges),'Invalid comp edit');
          clip.comp=row.ranges;
          break;
        case 'put-take':
          check(fields(row,['op','clip','take','source']) && id(row.take) && record(row.source),
            'Alternate edit needs a named take and source');
          clip.takes[row.take]=P.data.clone(row.source);
          break;
        case 'handles':
        case 'trim':
        case 'slip-head':
        case 'stretch-tail': {
          const name=row.take ?? clip.take;
          check(id(name) && Object.hasOwn(clip.takes,name),'Unknown editorial take');
          const take=clip.takes[name];
          if (row.op==='trim') {
            check(fields(row,['op','clip','take','fromSample','toSample']) &&
              (row.fromSample!==undefined || row.toSample!==undefined),'Invalid take trim');
            if (row.fromSample!==undefined) take.fromSample=row.fromSample;
            if (row.toSample!==undefined) take.toSample=row.toSample;
          } else if (row.op==='handles') {
            check(fields(row,['op','clip','take','handles']) && record(row.handles),'Invalid take handles');
            take.handles=row.handles;
          } else if (row.op==='slip-head') {
            check(fields(row,['op','clip','take','slip']) && (row.slip===null || record(row.slip)),
              'Invalid head slip edit');
            if (row.slip===null) delete take.slip;
            else take.slip=row.slip;
          } else {
            check(fields(row,['op','clip','take','tail']) && (row.tail===null || record(row.tail)),
              'Invalid tail stretch edit');
            if (row.tail===null) delete take.tail;
            else take.tail=row.tail;
          }
          break;
        }
        default: throw new RangeError('Unknown editorial edit '+row.op);
      }
    }
    next.clips=[...byId.values()];
    const result=P.data.clone(next);
    return {value:result,report:describe(compile(result,assets))};
  }
  function overlaps(clips) {
    const pairs=new Map();
    for (let i=0;i<clips.length;i++) for (let k=0;k<i;k++) {
      const a=clips[k],b=clips[i];
      if (a.track!==b.track || !a.range || !b.range) continue;
      const fromSample=Math.max(a.range.fromSample,b.range.fromSample), toSample=Math.min(a.range.toSample,b.range.toSample);
      if (fromSample<toSample) {
        const names=[a.id,b.id].sort();
        pairs.set(names.join(':'),{clips:names,track:a.track,fromSample,toSample});
      }
    }
    return pairs;
  }
  function reconform(session,assets,revision) {
    check(fields(revision,['picture','world','map','clockMap']) && Object.keys(revision).length>0,
      'Give the revised picture, world ledger, tempo map, or clock map');
    const updated=P.data.clone({...session,...revision});
    const before=compile(session,assets), after=compile(updated,assets), frames=Math.max(before.clock.end,after.clock.end);
    check(frames*4<=limit,'Reconform pair exceeds its combined PCM budget');
    const old=describe(before), current=describe(after);
    const changes=current.clips.map((now,i)=>{
      const prior=old.clips[i], shift=prior.range && now.range ? now.spot.sample-prior.spot.sample : null;
      return {id:now.id,status:now.spot.issue ? 'unresolved' : prior.spot.issue ? 'resolved' :
        shift || prior.spot.frame!==now.spot.frame ? 'moved' :
        prior.range.fromSample!==now.range.fromSample || prior.range.toSample!==now.range.toSample ? 'trimmed' : 'unchanged',
      shiftSamples:shift,before:prior.spot,after:now.spot,
      ...(prior.range && {beforeRange:prior.range}),...(now.range && {afterRange:now.range})};
    });
    const existing=overlaps(old.clips), collisions=[...overlaps(current.clips)].flatMap(([key,row])=>
      existing.has(key) ? [] : [row]);
    const left=mix(before,frames,false,true).out, right=mix(after,frames,false,true).out, meter=normalize([left,right]);
    return {value:audio(right,after.sampleRate),before:audio(left,before.sampleRate),session:updated,
      report:{before:old,after:current,frames,changes,collisions,...meter}};
  }
  A.audioEditorial=Object.freeze({inspect:(session,assets)=>describe(compile(session,assets)),revise,render,reconform});
})(KIT.procedural);
