/* Independent, editable note lines within a production track. */
(function (P) {
  const {fields,finite,id,check}=P.musicInstruments;
  const M=P.musicMotif, H=P.musicHarmony;
  const epsilon=1e-8, round=n=>Number(n.toFixed(9));

  function clip(raw) {
    check(fields(raw,['id','beat','length','voices','mode','timing','loopBeats']) && id(raw.id) && finite(raw.beat,0,65536) &&
      finite(raw.length,.0625,256) &&
      (raw.loopBeats===undefined || finite(raw.loopBeats,.0625,256)) && [undefined,'layer','attacks'].includes(raw.mode) && (raw.timing===undefined || raw.timing==='played') && Array.isArray(raw.voices) && raw.voices.length>=1 && raw.voices.length<=8,
    'A note clip needs a name, beat range and one to eight named voices');
    const voices=Array.from(raw.voices,voice=>{
      check(fields(voice,['id','notes']) && id(voice.id) && Array.isArray(voice.notes) && voice.notes.length<=512,
        'A clip voice needs a name and editable notes');
      const ties=new Set();
      const events=Array.from(voice.notes,row=>{
        check(fields(row,['id','beat','duration','midi','velocity','play','tie']) && id(row.id) &&
          (row.tie===undefined || typeof row.tie==='boolean') && (!row.tie || row.play===undefined),
        'A clip note needs an ID, timing and MIDI pitch. A tie inherits its attack expression');
        const {tie,...note}=row;
        if (tie) ties.add(note.id);
        return {...note,midi:H.midi(note.midi)};
      });
      return {id:voice.id,notes:M.motif({length:raw.loopBeats ?? raw.length,events}).events.map(({degree,...note})=>
        ({...note,...(ties.has(note.id) && {tie:true})}))};
    });
    check(new Set(voices.map(voice=>voice.id)).size===voices.length,'Note clip voice IDs must be unique');
    return P.data.freeze({id:raw.id,beat:raw.beat,length:raw.length,voices,
      ...(raw.loopBeats!==undefined && {loopBeats:raw.loopBeats}),...(raw.mode!==undefined && {mode:raw.mode}),...(raw.timing!==undefined && {timing:raw.timing})});
  }

  function rows(raw,clock,program,end) {
    check(Array.isArray(raw) && raw.length<=256,'A track can place up to 256 note clips');
    const spans=Array.from(raw,clip).sort((a,b)=>a.beat-b.beat);
    const groups=[spans.filter(row=>row.mode===undefined),spans.filter(row=>row.mode==='attacks'),
      spans.filter(row=>row.mode==='layer')];
    const disjoint=rows=>rows.every((row,i)=>!i || row.beat>=rows[i-1].beat+rows[i-1].length-epsilon);
    check(new Set(spans.map(row=>row.id)).size===spans.length &&
      spans.every(row=>row.beat+row.length<=end+epsilon) && groups.every(disjoint),
      'Note clip placements need unique IDs and nonoverlapping ranges within each mode');
    const windows=[], attacks=[], notes=[], extra=[];
    let count=0;
    for (const [index,group] of groups.entries()) {
      const active=new Map();
      for (const span of group) {
        const from=clock.timeAt({beat:round(span.beat)}), to=clock.timeAt({beat:round(span.beat+span.length)});
        check(from>=0 && from<to,'Note clips need a positive range on the cue clock');
        if (index===0) windows.push({from,to});
        if (index===1) attacks.push({from,to});
        const period=span.loopBeats ?? span.length;
        for (let repeat=0;repeat*period<span.length-epsilon;repeat++) for (const voice of span.voices) for (const note of voice.notes) {
          const offset=round(repeat*period+note.beat);
          if (offset>=span.length-epsilon) continue;
          check(++count<=4096,'The track exceeds its note-clip budget');
          const beat=round(span.beat+offset), time=clock.timeAt({beat});
          const stop=clock.timeAt({beat:round(span.beat+offset+note.duration)});
          const clipEnd=span.loopBeats!==undefined && stop>to+epsilon ? to : undefined;
          const previous=active.get(voice.id);
          if (note.tie) {
            check(previous && Math.abs(previous.end-time)<epsilon && previous.midi===note.midi && previous.velocity>0,
              'A clip tie needs an audible adjacent note with the same voice and pitch');
            check((previous.play.gate ?? 1)===1 && (previous.play.retrigger ?? 1)===1,
              'A tied clip attack needs a full gate and a single trigger');
            previous.end=stop;
            if (clipEnd!==undefined) previous.clipEnd=clipEnd;
            (previous.ties ??= []).push({clip:span.id,note:note.id});
            continue;
          }
          const entry={beat,time,end:stop,midi:note.midi,frequency:program.chordPitch(note.midi,time),
            velocity:note.velocity,voice:voice.id,clip:span.id,note:note.id,play:note.play ?? {},
            ...(span.loopBeats!==undefined && {clipLaunch:from}),...(clipEnd!==undefined && {clipEnd}),
            ...(span.timing==='played' && {played:true})};
          (index===0 ? notes : extra).push(entry);
          active.set(voice.id,entry);
        }
      }
    }
    return {windows,notes,attacks,extra};
  }

  function overlay(base,compiled,clock) {
    if (!compiled) return base;
    const retained=[];
    for (const row of base) {
      let time=row.time;
      for (const {from,to} of compiled.windows) {
        if (to<=time+epsilon) continue;
        if (from>=row.end-epsilon) break;
        if (from>time+epsilon) retained.push({...row,time,beat:clock.sample(time).beat,end:from});
        time=Math.max(time,to);
      }
      if (time<row.end-epsilon) retained.push(time===row.time ? row : {...row,time,beat:clock.sample(time).beat});
    }
    return retained.concat(compiled.notes).filter(row=>!compiled.attacks.some(({from,to})=>
      row.time>=from-epsilon && row.time<to-epsilon)).concat(compiled.extra).sort((a,b)=>a.time-b.time);
  }
  function edit(clips,address,set) {
    check(fields(address,['clip','voice','note']) && Object.keys(address).length===3 &&
      Object.values(address).every(id) && fields(set,['beat','duration','midi','velocity','play','tie']),
    'Invalid addressed note edit');
    const result=P.data.clone(clips ?? []);
    const note=result.find(clip=>clip.id===address.clip)?.voices.find(voice=>voice.id===address.voice)
      ?.notes.find(note=>note.id===address.note);
    check(note,'Unknown editable clip note');
    Object.assign(note,P.data.clone(set));
    return result;
  }

  P.musicNoteClips=Object.freeze({clip,rows,overlay,edit});
})(KIT.procedural);
