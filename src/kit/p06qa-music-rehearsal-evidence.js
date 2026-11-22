/* Inspect placed notes and measured audio around each adaptive boundary. */
(function (P) {
  const T=P.takeTime, A=P.musicProduction;
  const eps=1e-8, round=(value,digits=6)=>Number(value.toFixed(digits));
  const sample=(time,rate)=>T.index(T.roundDown(T.mul(T.read(time),[BigInt(rate),1n])));
  const endOf=clip=>clip.at+clip.to-clip.from;
  const visible=(music,clip,track)=>clip.gain>0 && (clip.layers[track] ?? 1)>0 && music.tracks[track]?.mix.gain>0;
  const near=(a,b)=>Math.abs(a-b)<eps;

  function pointNotes(timeline,clips,time,tracks,radius,indexes) {
    const hits=[];
    for (const clip of clips) {
      if (clip.at>time+radius || endOf(clip)<time-radius) continue;
      const music=timeline.compiled[clip.source];
      for (const name of tracks) {
        if (!visible(music,clip,name)) continue;
        const key=clip.source+':'+name;
        if (!indexes.has(key)) {
          const notes=music.events[name].filter(note=>note.velocity>0)
            .map(note=>({onset:note.start ?? note.time,end:note.time+note.gate,midi:note.midi}))
            .sort((a,b)=>a.onset-b.onset);
          let latest=-Infinity;
          const ending=notes.map(note=>latest=Math.max(latest,note.end));
          indexes.set(key,{notes,ending});
        }
        const {notes,ending}=indexes.get(key);
        const local=clip.from+time-clip.at, first=Math.max(clip.from,local-radius);
        let low=0,high=notes.length;
        while (low<high) {
          const middle=(low+high)>>>1;
          if (ending[middle]<first-eps) low=middle+1;
          else high=middle;
        }
        for (let i=low;i<notes.length;i++) {
          const note=notes[i];
          if (note.onset>=clip.to-eps || note.onset>local+radius) break;
          const at=Math.max(clip.at,clip.at+note.onset-clip.from);
          const end=Math.min(endOf(clip),clip.at+note.end-clip.from);
          if (end<=at) continue;
          if (at<time-radius && end<=time) continue;
          hits.push({track:name,segment:clip.segment,midi:note.midi,time:round(at),delta:round(at-time),
            holding:at<time && end>time});
        }
      }
    }
    return hits.sort((a,b)=>Number(b.holding)-Number(a.holding) || Math.abs(a.delta)-Math.abs(b.delta)).slice(0,8);
  }

  function placementAttack(timeline,clip,wanted,indexes,rate) {
    if (!clip || !clip.gain) return null;
    const cue=timeline.compiled[clip.source];
    const tracks=wanted?.length ? wanted : Object.keys(cue.tracks);
    const end=Math.min(clip.to,clip.from+timeline.duration-clip.at);
    let earliest=Infinity;
    for (const track of tracks) {
      if (!visible(cue,clip,track)) continue;
      const part=cue.tracks[track], key=clip.source+'/'+track;
      if (!indexes.has(key)) indexes.set(key,cue.events[track].filter(note=>note.velocity>0 &&
        (part.external || part.play.prepare(note,rate,note.gate).duration>0))
        .map(note=>note.start ?? note.time).sort((a,b)=>a-b));
      const times=indexes.get(key);
      let low=0,high=times.length;
      while (low<high) {
        const middle=(low+high)>>>1;
        if (times[middle]<clip.from-eps) low=middle+1; else high=middle;
      }
      if (times[low]<end-eps) earliest=Math.min(earliest,clip.at+Math.max(0,times[low]-clip.from));
    }
    return Number.isFinite(earliest) ? earliest : null;
  }

  function pitches(timeline,clip,from,to) {
    if (!clip || to<from) return [];
    const music=timeline.compiled[clip.source], notes=new Set();
    for (const [part,rows] of Object.entries(music.events)) {
      if (!visible(music,clip,part) || music.arrangement.parts[part].role==='percussion') continue;
      for (const note of rows) {
        if (note.time>=to+eps) break;
        if (note.velocity>0 && note.midi!==null && note.time+note.gate>from && note.time<to) notes.add(note.midi);
      }
    }
    return [...notes].sort((a,b)=>a-b);
  }

  function audioEvidence(value,time) {
    const {samples,sampleRate}=value, frames=samples.length/2;
    const at=Math.min(frames,sample(time,sampleRate)), radius=Math.round(.10*sampleRate);
    const from=Math.max(0,at-radius), to=Math.min(frames,at+radius);
    let left=0,right=0,peak=0,clipped=0;
    for (let i=from;i<to;i++) {
      const l=samples[2*i],r=samples[2*i+1],p=(l*l+r*r)/2;
      if(i<at) left+=p;
      else right+=p;
      const magnitude=Math.max(Math.abs(l),Math.abs(r));
      peak=Math.max(peak,magnitude);
      clipped+=Number(magnitude>1);
    }
    const jump=at>0 && at<frames ? Math.max(Math.abs(samples[2*at]-samples[2*at-2]),
      Math.abs(samples[2*at+1]-samples[2*at-1])) : 0;
    const quiet=Math.max(.001,peak*.035), bound=Math.round(.6*sampleRate);
    let pre=at,post=at;
    const low=i=>Math.max(Math.abs(samples[2*i]),Math.abs(samples[2*i+1]))<quiet;
    while (pre>Math.max(0,at-bound) && low(pre-1)) pre--;
    while (post<Math.min(frames,at+bound) && low(post)) post++;
    const db=x=>x>1e-12 ? round(10*Math.log10(x),3) : null;
    return {sample:at,firstSample:from,endSample:to,peak:round(peak),clippedFrames:clipped,
      sampleJump:round(jump),beforeDbFS:db(left/Math.max(1,at-from)),afterDbFS:db(right/Math.max(1,to-at)),
      quietSeconds:round((post-pre)/sampleRate)};
  }

  function observe(trace,timeline,result,options) {
    const {report,value}=result, clips=timeline.placements.filter(clip=>clip.kind==='segment');
    const {watchTracks,radius,measureStingerAttack}=options;
    const cases=[], loops=[], indexes=new Map(), onsets=new Map();
    const append=(row)=>{
      const signal=audioEvidence(value,row.time), issues=[];
      const issue=(name,weight)=>issues.push({kind:name,weight});
      if (signal.clippedFrames) issue('clipping',5);
      if (signal.sampleJump>.095 && signal.sampleJump>signal.peak*.3) issue('waveform-step',3);
      if (row.kind==='transition' || row.kind==='exit-splice' || row.kind==='loop') {
        if (signal.quietSeconds>.10) issue('quiet-at-join',Math.min(5,round(signal.quietSeconds*7,2)));
        if (row.gap>.035) issue('unfilled-segment-gap',Math.min(5,round(1+row.gap*3,2)));
        if (signal.beforeDbFS!==null && signal.afterDbFS!==null &&
            Math.abs(signal.beforeDbFS-signal.afterDbFS)>8) issue('level-change',2);
        if (row.kind==='exit-splice') issue('exit-source-jump',2);
      }
      if (row.kind==='transition' && row.wait>.60) issue('quantization-wait',Math.min(4,round(row.wait,2)));
      if (row.kind==='cancelled-request') issue('reversed-before-boundary',1);
      if ((row.kind==='stinger' && row.status==='played' || row.kind==='world-cue') && row.hook.length)
        issue('hook-collision',row.hook[0].holding || Math.abs(row.hook[0].delta)<radius/2 ? 4 : 2);
      cases.push({...row,audio:signal,issues,priority:round(issues.reduce((total,issue)=>total+issue.weight,0),3)});
    };
    for (const [i,marker] of timeline.markers.entries()) {
      const left=clips.findLast(clip=>clip.segment===marker.from && clip.at<marker.time-eps);
      const right=clips.find(clip=>clip.segment===marker.to && near(clip.at,marker.time));
      const leaving=left ? pitches(timeline,left,Math.max(left.from,left.to-radius),left.to) : [];
      const entering=right ? pitches(timeline,right,right.from,Math.min(right.to,right.from+radius)) : [];
      const request=trace.requests.find(row=>row.outcome==='committed' &&
        (row.serial!==undefined && marker.serial!==null ? row.serial===marker.serial :
          row.rule===marker.rule && near(row.resolvedAt,marker.time)));
      const held=report.performers?.joins[i]?.held;
      append({id:'transition-'+(i+1),...(held && {held}),kind:'transition',...marker,wait:request ? round(marker.time-request.time) : null,
        gap:Math.max(0,round(marker.time-(left ? endOf(left) : marker.time))),
        outgoing:left ? {segment:left.segment,source:left.source,position:left.to} : null,
        incoming:right ? {segment:right.segment,source:right.source,position:right.from} : null,leaving,entering,
        sharedPitchClasses:[...new Set(leaving.map(midi=>midi%12))].filter(pc=>entering.some(midi=>midi%12===pc)),
        joinedLayers:timeline.placements.filter(clip=>clip.kind!=='segment' && clip.at<=marker.time+eps &&
          endOf(clip)>marker.time-eps).map(({kind,segment,at,from,to})=>({kind,segment,start:at,end:at+to-from}))});
    }
    for (let i=1;i<clips.length;i++) {
      const left=clips[i-1],right=clips[i], {segment,at}=right, shape=timeline.segments[segment];
      if (left.segment!==segment || near(left.to,right.from) || timeline.markers.some(row=>near(row.time,at))) continue;
      const kind=near(left.to,shape.end) && near(right.from,shape.start) ? 'loop' : 'exit-splice';
      if (kind==='loop') loops.push({segment,time:at});
      append({id:kind+'-'+i,kind,time:at,segment,gap:Math.max(0,round(at-endOf(left))),
        outgoing:{source:left.source,position:left.to},incoming:{source:right.source,position:right.from}});
    }
    for (const [i,cue] of timeline.cueDecisions.entries()) {
      const placement=measureStingerAttack && cue.status==='played' ? timeline.placements.find(clip=>
        clip.kind==='stinger' && clip.segment===cue.segment && near(clip.at,cue.time)) : null;
      const attack=measureStingerAttack ? placementAttack(timeline,placement,null,onsets,value.sampleRate) : cue.time;
      const hook=attack===null ? [] : pointNotes(timeline,clips,attack,watchTracks,radius,indexes);
      append({id:'cue-'+(i+1),kind:'stinger',...cue,hook,...(measureStingerAttack && {attack})});
    }
    for (const [i,row] of trace.worldEvents.entries()) {
      const hook=pointNotes(timeline,clips,row.time,watchTracks,radius,indexes);
      const responses=(report.world?.responses ?? []).filter(hit=>hit.cue===row.cue && near(hit.cueTime,row.time))
        .map(({time,track,segment})=>({time,track,segment}));
      append({id:'world-'+(i+1),kind:'world-cue',...row,hook,responses});
    }
    for (const request of trace.requests) if (request.outcome!=='committed')
      append({...request,id:request.id,kind:request.outcome==='cancelled' ? 'cancelled-request' : 'pending-request',
        requestedAt:request.time,time:Math.min(trace.end,request.resolvedAt ?? trace.end)});
    const boundaries=[{time:0,to:trace.entry},...timeline.markers,{time:trace.end}];
    const dwells=boundaries.slice(0,-1).map((row,i)=>{
      const end=boundaries[i+1].time;
      return {segment:row.to,start:row.time,end,duration:round(end-row.time),
        loops:loops.filter(loop=>loop.segment===row.to && loop.time>=row.time && loop.time<end).length};
    });
    return {id:trace.id,label:trace.label ?? trace.id,end:trace.end,origin:trace.origin ?? null,
      peak:report.peak,rms:report.rms,requests:trace.requests,dwells,
      ...(report.phrasing && {phrasing:report.phrasing}),
      ...(report.performers && {performers:report.performers}),cases:cases.sort((a,b)=>a.time-b.time || a.id.localeCompare(b.id))};
  }

  function matched(waves,target,ceiling) {
    const levels=waves.map(audio=>A.meters(audio,true));
    const aim=Math.min(target,...levels.map(row=>row.lufs===null || !row.truePeak ? target :
      row.lufs+ceiling-20*Math.log10(row.truePeak)));
    return waves.map((audio,i)=>{
      const {lufs,truePeak}=levels[i];
      const gain=lufs===null ? Math.min(1,10**(ceiling/20)/Math.max(truePeak,1e-12)) : 10**((aim-lufs)/20);
      return {value:{...audio,samples:audio.samples.map(x=>x*gain)},
        playback:{lufs:lufs===null ? null : round(aim,3),gain:round(gain),truePeak:round(truePeak*gain)}};
    });
  }

  P.adaptiveRehearsalEvidence=Object.freeze({observe,matched,sample,audioEvidence,placementAttack});
})(KIT.procedural);
