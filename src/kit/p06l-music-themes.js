/* Theme identities and listening history across score sections and adaptive playback. */
(function (P) {
  const A=P.musicProduction, M=P.musicMotif, H=P.musicHarmony;
  const {record,fields,finite,integer,id,check}=P.musicInstruments;
  const stages=['fragment','development','statement'];
  const epsilon=1e-8, round=v=>Number(v.toFixed(9));
  const pc=v=>((v%12)+12)%12;
  const before=(a,b)=>a.time-b.time || a.part.localeCompare(b.part);
  const audible=(track,event)=>track?.mix.gain>0 && event.velocity>0 && (track.external || track.play.prepare(event,48000,event.gate).duration>0);

  function named(raw,max,label) {
    check(record(raw) && Object.keys(raw).length<=max && Object.keys(raw).every(id),'Invalid '+label+' table');
    return Object.entries(raw);
  }
  function catalog(plan,raw) {
    return Object.fromEntries(named(raw,32,'theme').map(([name,value])=>{
      check(fields(value,['motif','root','fragments']),'A theme needs a motif and optional root and fragments');
      const motif=M.motif(typeof value.motif==='string' ? plan.definition.motifs[value.motif] : value.motif);
      check(motif.events.length>=1 && motif.events.length<=64,'A theme needs one to sixty-four notes');
      const root=value.root===undefined ? motif.events.find(note=>note.midi!==undefined)?.midi : H.midi(value.root);
      const identities=motif.events.map(note=>note.id);
      const fragments=Object.fromEntries(named(value.fragments ?? {},16,'fragment').map(([key,notes])=>{
        check(Array.isArray(notes) && notes.length>=1 && new Set(notes).size===notes.length &&
          Array.from(notes).every(note=>identities.includes(note)),'Fragment notes must name distinct theme events');
        return [key,motif.events.filter(event=>notes.includes(event.id))];
      }));
      return [name,{motif,root,identities,fragments}];
    }));
  }

  function realizePitch(score,part,theme,note,beat,target) {
    if (target.pitch==='rhythm' || part.role==='percussion') return {};
    const clock=score.clock, scoreKey=H.midi(score.arrangement.score.key?.root ?? 'C4');
    const modes=H.scaleSteps(part.mode ?? score.arrangement.score.key?.mode);
    const degree=note.degree-1;
    const offset=modes[(degree%modes.length+modes.length)%modes.length]+12*Math.floor(degree/modes.length);
    const register=part.register ?? (part.role==='bass'?-12:0);
    const time=clock.timeAt({beat});
    const chord=score.program.events.findLast(event=>event.time<=time+epsilon);
    const root=chord ? H.midi(chord.root) : scoreKey;
    const pitched=target.pitch==='original' ?
      (note.midi ?? ((part.pitch==='key' ? scoreKey : root)+offset+register)) :
      root+register+(note.midi===undefined ? offset : note.midi-theme.root);
    const desired=pitched+target.transpose;
    check(integer(desired,0,127),'Theme pitch is outside the MIDI range');
    if (target.pitch!=='chord-tone' || !chord) return {midi:desired};
    const spec=score.arrangement.score.harmonies[chord.harmony];
    const tones=(spec.notes ? spec.notes.filter(note=>note!==null).map(note=>H.midi(note)) :
      H.chord(chord.root,chord.quality)).map(pc);
    if (!tones.length) return {midi:desired};
    for (let distance=0;distance<=12;distance++) {
      const direction=target.prefer==='up' ? [distance,-distance] : [-distance,distance];
      for (const step of direction) if (integer(desired+step,0,127) && tones.includes(pc(desired+step)))
        return {midi:desired+step};
    }
    return {midi:desired};
  }

  function takeTarget(raw,score) {
    check(fields(raw,['part','pitch','transpose','prefer','offset','stretch','gate','level','play']) &&
      Object.hasOwn(score.arrangement.parts,raw.part),'A theme target needs a named arrangement part');
    const {part,pitch='original',transpose=0,prefer='down',offset=0,stretch=1,gate=1,level=1,play}=raw;
    check(['original','rhythm','chord','chord-tone'].includes(pitch) && integer(transpose,-60,60) &&
      ['down','up'].includes(prefer) && finite(offset,0,256) && finite(stretch,.0625,16) &&
      finite(gate,.025,1) && finite(level,.001,2) && (play===undefined || record(play)),
      'Invalid theme timing, pitch or articulation');
    check(!score.tracks[part]?.pad,'A theme target needs a track that follows its written notes');
    return {part,pitch,transpose,prefer,offset,stretch,gate,level,play};
  }

  function baseNotes(plan,part,section) {
    check(!plan.materials[part].find(row=>row.section===section.id).sustain,
      'Choose a note-driven part for a theme appearance');
    return plan.cues.filter(row=>row.part===part && row.section===section.id).map((row,i)=>({
      id:'existing-'+i,beat:round(row.beat-section.beat),duration:round(Math.min(row.duration,section.end-row.beat)),
      degree:row.degree,velocity:row.velocity,...(row.midi!==undefined && {midi:row.midi}),
      ...(row.play && {play:row.play})
    }));
  }

  function develop(source,spec,assets={}) {
    check(fields(spec,['themes','appearances','unpin']) && Array.isArray(spec.appearances) &&
      spec.appearances.length<=96 && (spec.unpin===undefined || Array.isArray(spec.unpin)),
      'Theme development needs a catalog and bounded appearances');
    const score=A.compile(source,assets), plan=score.arrangement, themes=catalog(plan,spec.themes);
    const unpin=spec.unpin ?? [];
    check(Array.from(unpin).every(pin=>plan.pins.includes(pin)),'Theme unpin must name an active pin');
    const ids=new Set(), edited=new Map(), pending=[];
    for (const [index,entry] of Array.from(spec.appearances).entries()) {
      check(fields(entry,['id','theme','section','beat','stage','fragment','targets']) && id(entry.id) &&
        !ids.has(entry.id) && Object.hasOwn(themes,entry.theme) && stages.includes(entry.stage) &&
        Array.isArray(entry.targets) && entry.targets.length>=1 && entry.targets.length<=8,'Invalid theme appearance');
      ids.add(entry.id);
      const section=plan.sections.find(row=>row.id===entry.section), theme=themes[entry.theme];
      const start=entry.beat ?? 0;
      check(section && finite(start,0,section.end-section.beat) && section.end-section.beat<=256 &&
        (entry.fragment===undefined || Object.hasOwn(theme.fragments,entry.fragment)) &&
        (entry.stage!=='statement' || entry.fragment===undefined),'Invalid theme section, beat or fragment');
      const material=entry.fragment===undefined ? theme.motif.events : theme.fragments[entry.fragment];
      const targets=Array.from(entry.targets,raw=>takeTarget(raw,score));
      check(new Set(targets.map(target=>target.part)).size===targets.length,'A theme appearance can only target each part once');
      const assignments=[];
      for (const [targetIndex,target] of targets.entries()) {
        const local=round(start+target.offset);
        const end=round(local+(entry.fragment===undefined ? theme.motif.length :
          material.at(-1).beat+material.at(-1).duration)*target.stretch);
        check(end<=section.end-section.beat+epsilon,'Theme appearance extends beyond its section');
        const key=section.id+':'+target.part;
        if (!edited.has(key)) edited.set(key,{section,part:target.part,windows:[],notes:baseNotes(plan,target.part,section)});
        const lane=edited.get(key);
        check(lane.windows.every(([a,b])=>end<=a+epsilon || local>=b-epsilon),'Theme appearances overlap on one part');
        lane.windows.push([local,end]);
        const notes=material.map((note,i)=>{
          const beat=round(local+note.beat*target.stretch), duration=round(note.duration*target.stretch*target.gate);
          const play={...note.play,...target.play};
          return {id:'theme-'+index+'-'+targetIndex+'-'+i,beat,duration,degree:target.pitch==='rhythm'?1:note.degree,
            ...realizePitch(score,plan.definition.parts[target.part],theme,note,round(section.beat+beat),target),
            velocity:Math.min(1,note.velocity*target.level),...(Object.keys(play).length && {play})};
        });
        lane.notes.push(...notes);
        assignments.push({part:target.part,notes:notes.map((note,i)=>({beat:round(section.beat+note.beat),
          event:note.id,note:material[i].id}))});
      }
      pending.push({id:entry.id,theme:entry.theme,section:entry.section,stage:entry.stage,assignments});
    }
    const edits=Array.from(edited.values(),lane=>{
      const windows=lane.windows.sort((a,b)=>a[0]-b[0]);
      const notes=lane.notes.flatMap(note=>{
        if (note.id.startsWith('theme-')) return [note];
        const end=note.beat+note.duration, retained=[];
        let at=note.beat;
        for (const [a,b] of windows) {
          if (a>=end-epsilon) break;
          if (b<=at+epsilon) continue;
          if (a>at) retained.push([at,a]);
          at=b;
        }
        if (at<end) retained.push([at,end]);
        return retained.flatMap(([beat,stop],i)=>{
          const duration=round(stop-beat);
          return duration>=1e-5 ? [{...note,id:note.id+'-'+i,beat,duration}] : [];
        });
      });
      return {part:lane.part,section:lane.section.id,scope:'section',
        adopt:M.motif({length:lane.section.end-lane.section.beat,events:notes})};
    });
    const revision={edits,unpin}, production=A.revise(source,revision,assets), rendered=A.compile(production,assets);
    const performed=Object.fromEntries(Object.entries(rendered.events).map(([part,events])=>{
      const byBeat=new Map();
      for (const event of events)
        if (!byBeat.has(event.beat) && audible(rendered.tracks[part],event)) byBeat.set(event.beat,event);
      return [part,byBeat];
    }));
    const appearances=pending.map(({assignments,...entry})=>({...entry,tracks:assignments.map(({part,notes})=>{
      // A visual-only part can still carry theme cues, but does not count as heard.
      return {part,count:notes.length,notes:notes.flatMap(note=>{
        const event=performed[part]?.get(note.beat);
        return event ? [{id:note.note,event:note.event,beat:note.beat,time:event.time,midi:event.midi}] : [];
      })};
    })}));
    const themeMap={themes:Object.fromEntries(Object.entries(themes).map(([name,theme])=>[name,theme.identities])),appearances};
    const tracker=createHistory({score:themeMap},rendered.end,{score:rendered});
    for (const section of rendered.arrangement.sections) tracker.add({source:'score',at:section.time,
      from:section.time,to:section.endTime,layers:{},gain:1,fadeIn:0});
    const sections=rendered.arrangement.sections.map(section=>({id:section.id,
      appearances:appearances.filter(row=>row.section===section.id).map(row=>row.id),
      before:tracker.at(section.time),after:tracker.at(section.endTime)}));
    return P.data.freeze({production,themeMap,revision,report:{sections}});
  }

  function createHistory(maps,duration,compiled,live=false) {
    const catalog=new Map(), indexes=new Map();
    for (const [name,map] of named(maps,32,'theme source')) {
      check(Object.hasOwn(compiled,name) && fields(map,['themes','appearances']) &&
        Array.isArray(map.appearances) && map.appearances.length<=96,'Invalid source theme map');
      const themes=new Map(named(map.themes,32,'theme identity'));
      for (const [theme,notes] of themes) {
        check(Array.isArray(notes) && notes.length>=1 && notes.length<=64 && new Set(notes).size===notes.length &&
          Array.from(notes).every(id),'Invalid theme notes');
        const previous=catalog.get(theme);
        check(!previous || JSON.stringify(previous)===JSON.stringify(notes),'Sources disagree on theme identity '+theme);
        catalog.set(theme,notes);
      }
      const appearances=new Set(), hits=[], score=compiled[name];
      const performed=Object.fromEntries(Object.entries(score.events).map(([part,events])=>[
        part,new Map(events.filter(event=>event.velocity>0).map(event=>[JSON.stringify([event.beat,event.time,event.midi]),event]))
      ]));
      for (const appearance of Array.from(map.appearances)) {
        check(fields(appearance,['id','theme','section','stage','tracks']) && id(appearance.id) &&
          !appearances.has(appearance.id) && themes.has(appearance.theme) && stages.includes(appearance.stage) &&
          Array.isArray(appearance.tracks) && appearance.tracks.length<=8,'Invalid mapped appearance');
        appearances.add(appearance.id);
        const identities=themes.get(appearance.theme);
        for (const track of Array.from(appearance.tracks)) {
          check(fields(track,['part','count','notes']) && id(track.part) && integer(track.count,1,64) &&
            Array.isArray(track.notes) && track.notes.length<=track.count &&
            Array.from(track.notes).every(note=>{
              if (!fields(note,['id','event','beat','time','midi']) || !identities.includes(note.id) ||
                !id(note.event) || !finite(note.time,0,score.end)) return false;
              const event=performed[track.part]?.get(JSON.stringify([note.beat,note.time,note.midi]));
              return event && audible(score.tracks[track.part],event);
            }) &&
            new Set(track.notes.map(note=>note.id)).size===track.notes.length,
            'Mapped theme performance must match the source notes');
          if (appearance.stage==='statement') check(track.count===identities.length,'A statement needs the complete theme');
          for (const note of track.notes) if (Object.hasOwn(compiled[name].tracks,track.part)) hits.push({
            appearance:appearance.id,theme:appearance.theme,stage:appearance.stage,
            part:track.part,count:track.count,note:note.id,time:note.time,midi:note.midi
          });
        }
      }
      hits.sort(before);
      indexes.set(name,hits);
    }
    const pending=[], instances=new Map(), complete=[], heard=new Map();
    let cursor=0;
    const snapshot=()=>Object.fromEntries(Array.from(catalog,([theme,identities])=>{
      const state=heard.get(theme);
      return [theme,{heard:identities.filter(note=>state?.notes.has(note)),withheld:identities.filter(note=>!state?.notes.has(note)),
        counts:Object.fromEntries(stages.map(stage=>[stage,state?.counts[stage] ?? 0]))}];
    }));
    return {
      add(placement) {
        const source=indexes.get(placement.source);
        if (!source?.length || !placement.gain) return;
        let lo=0,hi=source.length;
        while (lo<hi) {
          const mid=(lo+hi)>>>1;
          if (source[mid].time<placement.from-epsilon) lo=mid+1;
          else hi=mid;
        }
        for (let i=lo; i<source.length && source[i].time<placement.to-epsilon;i++) {
          const hit=source[i], at=placement.at+Math.max(0,hit.time-placement.from);
          if (placement.note && (placement.note.part!==hit.part || placement.note.midi!==hit.midi)) continue;
          if (!(placement.layers[hit.part] ?? 1) || at>=duration || at<cursor-epsilon) continue;
          check(pending.length<65536,'Theme playback exceeds its pending event budget');
          pending.push({...hit,time:round(at),segment:placement.segment ?? null,source:placement.source,
            instance:JSON.stringify([placement.source,hit.appearance,placement.instance ?? round(placement.at-placement.from)]),
            placement:placement.instance});
        }
      },
      at(time) {
        check(time>=cursor-epsilon,'Theme history must advance in playback order');
        cursor=time;
        pending.sort(before);
        let read=0;
        for (const hit of pending) {
          if (hit.time>=time-epsilon) break;
          read++;
          const state=heard.get(hit.theme) ?? {notes:new Set(),counts:{}};
          heard.set(hit.theme,state);
          state.notes.add(hit.note);
          const instance=instances.get(hit.instance) ?? {parts:new Map(),completed:false,placement:hit.placement};
          instances.set(hit.instance,instance);
          const notes=instance.parts.get(hit.part) ?? new Set();
          notes.add(hit.note);
          instance.parts.set(hit.part,notes);
          if (instance.completed || notes.size!==hit.count) continue;
          instance.completed=true;
          state.counts[hit.stage]=(state.counts[hit.stage] ?? 0)+1;
          if (live && complete.length===64) complete.shift();
          complete.push({id:hit.appearance,theme:hit.theme,stage:hit.stage,part:hit.part,
            time:hit.time,segment:hit.segment,source:hit.source});
        }
        if (read) pending.splice(0,read);
        return snapshot();
      },
      finish(placement,time) {
        this.at(time);
        for (const [key,instance] of instances) if (instance.placement===placement) instances.delete(key);
      },
      completed() {return complete.slice();}
    };
  }

  P.musicThemes=Object.freeze({createHistory,stages});
  P.musicProduction=Object.freeze({...A,developThemes:develop});
})(KIT.procedural);
