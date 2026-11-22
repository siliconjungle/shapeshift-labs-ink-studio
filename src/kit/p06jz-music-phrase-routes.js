/* A phrase choice sees only completed playback and the approach to its scene. */
(function (P) {
  const {fields,record,integer,id,check}=P.musicInstruments;
  const epsilon=1e-8;
  const canonical=value=>value===null || typeof value!=='object' ? value :
    Array.isArray(value) ? value.map(canonical) :
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  const signature=value=>JSON.stringify(canonical(value));
  const grid=cue=>signature({tempo:cue.arrangement.score.tempoMap ?? {},
    bars:cue.arrangement.sections.map(({id,bar,bars})=>[id,bar,bars])});
  const sharesGrid=(a,b)=>a.end===b.end && grid(a)===grid(b);
  const onset=note=>note.start ?? note.time;
  const canSpeak=(track,note)=>track?.mix.gain>0 && note.velocity>0 &&
    (track.external || track.play.prepare(note,48000,note.gate).duration>0);

  function create(raw,segments,load,end,live=false) {
    check(fields(raw,['routes','listen']) && record(raw.routes ?? {}) && record(raw.listen ?? {}) &&
      Object.keys(raw.routes ?? {}).length<=64 && Object.keys(raw.listen ?? {}).length<=64,
    'Phrase routing needs named routes and optional listening tracks');
    const known=name=>id(name) && Object.hasOwn(segments,name);
    const phraseIds=new Set(Object.keys(segments));
    const tracks=new Map(), routes=new Map(), counts=new Map(), decisions=[], played=[];
    for (const [segment,rows] of Object.entries(raw.routes ?? {})) {
      check(known(segment) && Array.isArray(rows) && integer(rows.length,1,8),'Invalid adaptive phrase route');
      const baseline=load(segments[segment].source);
      routes.set(segment,Array.from(rows,row=>{
        check(fields(row,['id','source','when']) && id(row.id) && !phraseIds.has(row.id) && id(row.source) &&
          fields(row.when,['via','rule','heard']),'Phrase choices need unique IDs, a source, and a condition');
        const {via,rule,heard=[]}=row.when;
        check((via===undefined || Array.isArray(via) && integer(via.length,1,8) && Array.from(via).every(known)) &&
          (rule===undefined || id(rule)) && Array.isArray(heard) && heard.length<=8 &&
          Array.from(heard).every(test=>fields(test,['phrase','min','max']) && id(test.phrase) &&
            integer(test.min ?? (test.max===undefined ? 1 : 0),0,4096) &&
            integer(test.max ?? 4096,test.min ?? (test.max===undefined ? 1 : 0),4096)) &&
          new Set(heard.map(test=>test.phrase)).size===heard.length,'Invalid phrase listening or journey condition');
        const variant=load(row.source);
        check(sharesGrid(baseline,variant),'Phrase alternatives must share the destination score grid');
        phraseIds.add(row.id);
        return row;
      }));
    }
    for (const choices of routes.values()) for (const row of choices)
      check((row.when.heard ?? []).every(test=>phraseIds.has(test.phrase)),'Unknown phrase in listening condition');
    for (const [name,list] of Object.entries(raw.listen ?? {})) {
      check(known(name) && Array.isArray(list) && integer(list.length,1,8) && Array.from(list).every(id) &&
        new Set(list).size===list.length,'Choose distinct listening tracks for a scene');
      const sources=[segments[name].source,...(routes.get(name) ?? []).map(row=>row.source)];
      check(sources.every(source=>list.every(track=>Object.hasOwn(load(source).tracks,track))),
        'Each phrase alternative must supply the listening tracks for '+name);
      tracks.set(name,list);
    }
    const indexes=new Map();
    function audible(source,track) {
      const key=source+'/'+track;
      if (!indexes.has(key)) {
        const music=load(source), rows=music.events[track];
        indexes.set(key,rows.filter(note=>canSpeak(music.tracks[track],note)).map(onset).sort((a,b)=>a-b));
      }
      return indexes.get(key);
    }
    function heardPhrase(phrase,segment,source,at) {
      counts.set(phrase,(counts.get(phrase) ?? 0)+1);
      if (live && played.length===64) played.shift();
      played.push({phrase,segment,source,at});
    }
    function remember(clip) {
      const window=segments[clip.segment], complete=clip.at+clip.to-clip.from;
      if (clip.kind!=='segment' || !clip.gain || !clip.phrase || complete>end+epsilon ||
        clip.from>window.start+epsilon || clip.to<window.end-epsilon) return;
      const names=tracks.get(clip.segment) ?? Object.keys(load(clip.source).tracks);
      if (!names.some(name=>{
        if (clip.layers[name]===0 || !Object.hasOwn(load(clip.source).events,name)) return false;
        const notes=audible(clip.source,name);
        let lo=0, hi=notes.length;
        while (lo<hi) {
          const mid=(lo+hi)>>>1;
          if (notes[mid]<clip.from-epsilon) lo=mid+1;
          else hi=mid;
        }
        return notes[lo]<clip.to-epsilon;
      })) return;
      heardPhrase(clip.phrase,clip.segment,clip.source,complete);
    }
    function choose(name,time,source,via,rule,reason) {
      const choices=routes.get(name);
      if (!choices) return {source,phrase:name};
      const heard=phrase=>counts.get(phrase) ?? 0;
      const matches=({when})=>(when.rule===undefined || rule===when.rule) &&
        (when.via===undefined || when.via.length<=via.length &&
          when.via.every((visit,i)=>visit===via[via.length-when.via.length+i])) &&
        (when.heard ?? []).every(test=>heard(test.phrase)>=(test.min ?? (test.max===undefined ? 1 : 0)) &&
          heard(test.phrase)<=(test.max ?? 4096));
      const match=choices.find(matches), selected={source:match?.source ?? source,phrase:match?.id ?? name};
      const referenced=new Set(choices.flatMap(row=>(row.when.heard ?? []).map(test=>test.phrase)));
      if (live && decisions.length===64) decisions.shift();
      decisions.push({time,segment:name,reason,via:via.slice(),rule,...selected,
        matched:match?.id ?? null,heard:Object.fromEntries([...referenced].map(phrase=>[phrase,heard(phrase)]))});
      return selected;
    }
    return {choose,remember,heardPhrase,tracks:name=>tracks.get(name),repeats:name=>routes.has(name),
      counts:()=>Object.fromEntries(counts),report:()=>({heard:Object.fromEntries(counts),played:played.slice(),decisions:decisions.slice()})};
  }
  P.musicPhraseRoutes=Object.freeze({create,signature,sharesGrid,onset});
})(KIT.procedural);
