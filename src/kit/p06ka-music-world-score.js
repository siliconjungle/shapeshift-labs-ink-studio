/* Scene cue performances and score-only gain envelopes on the production timeline. */
(function (P) {
  const {fields,finite,integer,id,check,hz,hash}=P.musicInstruments, T=P.takeTime;
  const token=value=>typeof value==='string' && value.trim() && value.length<=512;
  const epsilon=1e-9;
  function entries(rows,max,message) {
    check(Array.isArray(rows) && rows.length<=max,message);
    return rows;
  }
  function rules(world) {
    check(fields(world,['events','rhythms','space']),'Invalid world score options');
    const rhythms=Array.from(entries(world.rhythms ?? [],64,'Invalid world rhythm table'),row=>{
      check(fields(row,['id','cue','track','segments','grid','delay','gate','hits']) &&
        id(row.id) && token(row.cue) && id(row.track) &&
        (row.segments===undefined || entries(row.segments,64,'Invalid rhythm segments').length &&
          Array.from(row.segments).every(id)), 'Invalid world rhythm rule');
      const {id:name,cue,track,segments,grid=0,delay=0,gate=.12,hits=[{beat:0}]}=row;
      check((grid===0 || finite(grid,.001,4)) && finite(delay,0,8) && finite(gate,.001,4) &&
        entries(hits,16,'Invalid world rhythm hits').length,'Invalid world rhythm settings');
      const notes=Array.from(hits,hit=>{
        check(fields(hit,['beat','level','midi','articulation']) && finite(hit.beat,0,16) &&
          finite(hit.level ?? 1,0,1) && integer(hit.midi ?? 36,0,127) &&
          (hit.articulation===undefined || id(hit.articulation)), 'Invalid world rhythm hit');
        return hit;
      });
      return {id:name,cue,track,segments,grid,delay,gate,hits:notes};
    });
    const space=Array.from(entries(world.space ?? [],64,'Invalid score space table'),row=>{
      check(fields(row,['id','cue','from','to','attack','hold','release','level','tracks']) && id(row.id) &&
        (row.cue===undefined ? finite(row.from,0,300) && finite(row.to,row.from,300) && row.to>row.from &&
          row.hold===undefined : token(row.cue) && row.from===undefined && row.to===undefined) &&
        (row.tracks===undefined || entries(row.tracks,9,'Invalid score space tracks').length &&
          Array.from(row.tracks).every(id)), 'Invalid score space rule');
      const {attack=.05,hold,release=.2,level=0}=row;
      check(finite(attack,0,8) && (hold===undefined || finite(hold,0,300)) && finite(release,0,8) &&
        finite(level,0,1), 'Invalid score space envelope');
      return {...row,attack,hold,release,level};
    });
    const names=[...rhythms,...space].map(rule=>rule.id);
    check(new Set(names).size===names.length,'World score rules need unique IDs');
    return {rhythms,space};
  }
  function events(rows) {
    return Array.from(entries(rows,8192,'World score exceeds its cue budget'),(row,index)=>{
      check(fields(row,['cue','time','strength','duration']) ||
        fields(row,['id','name','time','timecode','detected']) && token(row.name),
        'Invalid world score cue');
      const cue=row.cue ?? row.name, time=T.seconds(T.read(row.timecode ?? row.time));
      const {strength=1,duration}=row;
      check(token(cue) && finite(time,0,1e9) && finite(strength,0,1) &&
        (duration===undefined || finite(duration,0,1e9)),'Invalid world score cue');
      return {cue,time,strength,duration,index};
    }).sort((a,b)=>a.time-b.time || a.index-b.index);
  }
  function groupByCue(rows) {
    const groups=new Map();
    for (const row of rows) {
      const group=groups.get(row.cue) ?? [];
      group.push(row);
      groups.set(row.cue,group);
    }
    return groups;
  }
  const clipEnd=clip=>clip.at+(clip.to-clip.from);
  function addRhythms(rhythms,byCue,timeline,spec,report) {
    if (!rhythms.length) return new Map();
    const clips=timeline.placements.filter(clip=>clip.kind==='segment');
    const clocks=clips.map(clip=>timeline.compiled[clip.source].clock);
    const endingBeats=clips.map((clip,index)=>clocks[index].sample(clip.to).beat);
    const continues=index=>clips[index+1]?.segment===clips[index].segment &&
      Math.abs(clips[index+1].at-clipEnd(clips[index]))<epsilon &&
      !timeline.markers.some(marker=>Math.abs(marker.time-clips[index+1].at)<epsilon);
    const next=clips.map((clip,index)=>continues(index));
    const added=new Map();
    let steps=0;
    for (const rule of rhythms) {
      const selected=rule.segments ?? Object.keys(spec.segments);
      check(selected.every(name=>Object.hasOwn(spec.segments,name)),'Unknown world rhythm segment '+rule.id);
      const percussion=music=>music.arrangement.parts[rule.track]?.role==='percussion' &&
        Object.hasOwn(music.tracks,rule.track);
      check(selected.some(name=>percussion(timeline.compiled[spec.segments[name].source])),
        'World rhythm needs a production percussion track '+rule.track);
      const armed=new Set(selected);
      let cursor=0;
      for (const event of byCue.get(rule.cue) ?? []) {
        while (cursor<clips.length && clipEnd(clips[cursor])-epsilon<=event.time) cursor++;
        const origin=clips[cursor];
        if (!event.strength || !origin || origin.at>event.time+epsilon || !armed.has(origin.segment)) continue;
        let index=cursor;
        const start=event.time+rule.delay;
        while (next[index] && clipEnd(clips[index])-epsilon<=start) {
          check(++steps<=2e6,'World rhythm exceeds its loop traversal budget');
          index++;
        }
        if (clipEnd(clips[index])-epsilon<=start) continue;
        const clip=clips[index], clock=clocks[index], local=clip.from+Math.max(0,start-clip.at);
        const beat=clock.sample(local).beat;
        const initial=rule.grid ? Math.max(beat,Math.ceil(beat/rule.grid-epsilon)*rule.grid) : beat;
        for (const [hitIndex,hit] of rule.hits.entries()) {
          let dest=index, target=initial+hit.beat;
          while (target>=endingBeats[dest]-epsilon && next[dest]) {
            check(++steps<=2e6,'World rhythm exceeds its loop traversal budget');
            const excess=Math.max(0,target-endingBeats[dest]);
            dest++;
            target=clocks[dest].sample(clips[dest].from).beat+excess;
          }
          if (target>=endingBeats[dest]-epsilon) continue;
          const clip=clips[dest], source=timeline.compiled[clip.source];
          const velocity=event.strength*(hit.level ?? 1);
          if (!velocity || !percussion(source) || clip.layers[rule.track]===0) continue;
          const time=dest===index && target===beat ? local :
            Math.max(clip.from,clocks[dest].timeAt({beat:target}));
          const at=clip.at+(time-clip.from);
          if (time>=clip.to-epsilon) continue;
          check(report.length<16384,'World score exceeds its response budget');
          const rows=added.get(clip) ?? {};
          const notes=rows[rule.track] ??= [];
          const midi=hit.midi ?? 36;
          notes.push({part:rule.track,beat:target,time,gate:rule.gate,midi,frequency:hz(midi),velocity,
            play:hit.articulation===undefined ? {} : {articulation:hit.articulation},
            salt:hash([rule.id,event.cue,event.time,event.index,hitIndex]),roundRobin:0});
          added.set(clip,rows);
          report.push({rule:rule.id,cue:event.cue,cueTime:event.time,time:at,track:rule.track,
            segment:clip.segment,source:clip.source,midi,velocity});
        }
      }
    }
    report.sort((a,b)=>a.time-b.time);
    return added;
  }
  function getWindows(rules,byCue,timeline) {
    const tracks=new Set(['room',...Object.values(timeline.compiled).flatMap(music=>Object.keys(music.tracks))]);
    const windows=[];
    for (const rule of rules) {
      check(rule.tracks===undefined || rule.tracks.every(track=>tracks.has(track)),
        'Unknown score space track '+rule.id);
      const events=rule.cue===undefined ? [{time:rule.from,duration:rule.to-rule.from}] : byCue.get(rule.cue) ?? [];
      for (const event of events) {
        if (!((event.strength ?? 1)>0) || event.time-rule.attack>=timeline.duration) continue;
        check(windows.length<16384,'World score exceeds its space window budget');
        const to=event.time+(rule.hold ?? event.duration ?? .18);
        windows.push({rule:rule.id,...(event.cue!==undefined && {cue:event.cue}),
          start:event.time-rule.attack,from:event.time,to,end:to+rule.release,level:rule.level,tracks:rule.tracks});
      }
    }
    return windows.sort((a,b)=>a.start-b.start);
  }
  function envelopes(windows,rate,begin,last) {
    const cache=new Map(), sample=time=>Math.round(time*rate);
    let allocated=0, work=0;
    return part=>{
      const scoped=windows.filter(row=>row.level<1 && (!row.tracks || row.tracks.includes(part)) &&
        sample(row.end)>begin && sample(row.start)<last);
      if (!scoped.length) return;
      const key=JSON.stringify(scoped.map(row=>[row.start,row.from,row.to,row.end,row.level]));
      if (cache.has(key)) return cache.get(key);
      const first=Math.max(begin,sample(scoped[0].start)), end=Math.min(last,
        scoped.reduce((latest,row)=>Math.max(latest,sample(row.end)),first));
      check((allocated+=end-first)<=16e6,'World score exceeds its envelope sample budget');
      const values=new Float32Array(end-first).fill(1);
      for (const row of scoped) {
        const [start,from,to,end]=[row.start,row.from,row.to,row.end].map(sample);
        const low=Math.max(begin,start), high=Math.min(last,end);
        check((work+=high-low)<=72e6,'World score exceeds its envelope mixing budget');
        for (let i=low;i<high;i++) {
          const gain=i<from ? 1+(row.level-1)*(i-start)/(from-start) :
            i<to ? row.level : row.level+(1-row.level)*(i-to)/(end-to);
          const at=i-first;
          if (gain<values[at]) values[at]=gain;
        }
      }
      const gain={first,values};
      cache.set(key,gain);
      return gain;
    };
  }
  P.musicWorldScore={
    captureSettings(world) {
      const {rhythms,space}=rules(world);
      const cues=new Map(rhythms.map(row=>[row.cue,{attack:0,duration:false}]));
      let lookAhead=0;
      for (const rule of space) if (rule.cue!==undefined) {
        const current=cues.get(rule.cue);
        cues.set(rule.cue,{attack:Math.max(current?.attack ?? 0,rule.attack),
          duration:current?.duration || rule.hold===undefined});
        lookAhead=Math.max(lookAhead,rule.attack);
      }
      return {cues,lookAhead};
    },
    prepare(world,timeline,spec,rate,begin,last) {
      const {rhythms,space}=rules(world), byCue=groupByCue(events(world.events ?? []));
      const responses=[], additions=addRhythms(rhythms,byCue,timeline,spec,responses);
      const windows=getWindows(space,byCue,timeline);
      return {additions,envelope:envelopes(windows,rate,begin,last),report:{responses,windows}};
    }
  };
})(KIT.procedural);
