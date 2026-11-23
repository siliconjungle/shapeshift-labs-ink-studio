/* Causal score space and accents driven by the passage currently playing. */
(function (P) {
  const {fields,record,id,finite,integer,check}=P.musicInstruments;
  function open(raw,{segments,compiled,stingers,streams,rate,maxEvents,frameAt,inputFrame,log,play}) {
    check(fields(raw,['openings','cues']) && record(raw.openings ?? {}) && record(raw.cues) &&
      integer(Object.keys(raw.cues).length,1,128) && Object.keys(raw.openings ?? {}).length<=64,
    'Live scoring needs named cue rules and optional musical openings');
    const snap=seconds=>Math.round(seconds*rate);
    const openings=new Map(), openingNames=new Set();
    for (const [section,groups] of Object.entries(raw.openings ?? {})) {
      check(Object.hasOwn(segments,section) && record(groups) && integer(Object.keys(groups).length,1,16),
        'Musical openings need a timeline section and up to 16 names');
      const {source,start,end}=segments[section], clock=compiled[source].clock, table=new Map();
      for (const [name,positions] of Object.entries(groups)) {
        check(id(name) && Array.isArray(positions) && integer(positions.length,1,32),
          'Name up to 32 positions per musical opening');
        const points=Array.from(positions,point=>{
          const position=P.musicTiming.isPosition(point) ? clock.timeAt(point) : point;
          check(finite(position,start,end-1/rate),'Musical opening lies outside the playable window');
          return position;
        }).sort((a,b)=>a-b);
        table.set(name,points);
        openingNames.add(name);
      }
      openings.set(section,table);
    }
    const rules=new Map(Object.entries(raw.cues).map(([name,row])=>{
      check(id(name) && fields(row,['space','accent','passThrough']) &&
        (row.space!==undefined || row.accent!==undefined) && typeof (row.passThrough ?? false)==='boolean',
      'Invalid live scoring cue '+name);
      let space,accent;
      if (row.space!==undefined) {
        check(fields(row.space,['gain','attack','hold','release']),'Invalid score space '+name);
        const {gain=0,attack=.025,hold=.24,release=.18}=row.space;
        check(finite(gain,0,1) && [attack,hold,release].every(value=>finite(value,0,30)),
          'Invalid score space '+name);
        space={gain,attack:snap(attack),hold:snap(hold),release:snap(release)};
        check(space.attack+space.hold+space.release>0,'Score space needs a positive duration');
      }
      if (row.accent!==undefined) {
        check(fields(row.accent,['resource','opening','cooldown','expiresAfter']),'Invalid score accent '+name);
        const {resource,opening,cooldown=0,expiresAfter=2}=row.accent;
        check(id(resource) && (Object.hasOwn(stingers,resource) || streams.has(resource)) &&
          (opening===undefined || openingNames.has(opening)) && finite(cooldown,0,120) && finite(expiresAfter,0,30),
        'Score accent needs a mapped resource, known opening, and bounded timing');
        accent={resource,opening,cooldown:snap(cooldown),expiresAfter};
      }
      return [name,{name,space,accent,passThrough:row.passThrough ?? false}];
    }));

    const windows=new Map(), lastPlayed=new Map(), pending=[], outcomes={};
    let wake=Infinity, lastClip;
    const ruleFor=intent=>rules.get(intent.cue ?? intent.resource);
    function gainAt(window,frame) {
      if (!window || frame>=window.endFrame) return 1;
      if (frame<window.attackEnd) return window.from+(window.target-window.from)*
        (frame-window.startFrame)/(window.attackEnd-window.startFrame);
      if (frame<window.releaseStart) return window.target;
      return window.target+(1-window.target)*(frame-window.releaseStart)/(window.endFrame-window.releaseStart);
    }
    function level(frame) {
      let gain=1;
      for (const [name,window] of windows) {
        if (frame>=window.endFrame) windows.delete(name);
        else gain=Math.min(gain,gainAt(window,frame));
      }
      return gain;
    }
    function decision({rule,intent,expiresFrame},status,extra={}) {
      outcomes[status]=(outcomes[status] ?? 0)+1;
      log('score-accent',{cue:rule.name,resource:rule.accent.resource,expiresFrame,status,trigger:intent,...extra,
        ...(rule.accent.opening!==undefined && {opening:rule.accent.opening})});
    }
    function offer(rule,intent,frame) {
      if (rule.space) {
        const {gain:target,attack,hold,release}=rule.space, from=gainAt(windows.get(rule.name),frame);
        const startFrame=frame, attackEnd=frame+attack,releaseStart=attackEnd+hold,endFrame=releaseStart+release;
        const window={from,target,startFrame,attackEnd,releaseStart,endFrame};
        windows.set(rule.name,window);
        log('score-space',{cue:rule.name,...window,trigger:intent});
      }
      if (!rule.accent) return;
      const expiresFrame=inputFrame(intent.time+rule.accent.expiresAfter);
      const row={rule,intent,expiresFrame};
      if (frame>expiresFrame) decision(row,'expired');
      else if (pending.length>=maxEvents) decision(row,'dropped',{reason:'queue-budget'});
      else {
        pending.push(row);
        wake=frame;
        if (rule.accent.opening!==undefined) decision(row,'queued');
      }
    }
    function step(frame,clip) {
      if (!pending.length || (lastClip===clip.id && frame<wake)) return;
      lastClip=clip.id;
      wake=Infinity;
      const markers=openings.get(clip.section);
      let retained=0;
      for (const row of pending) {
        const {rule,intent,expiresFrame}=row;
        if (frame>expiresFrame) {
          decision(row,'expired');
          continue;
        }
        const {opening,resource,cooldown}=rule.accent;
        let at=frame;
        if (opening!==undefined) {
          at=Infinity;
          if (!clip.finished) for (const position of markers?.get(opening) ?? []) {
            const candidate=frameAt(clip.phase,position);
            if (position>=clip.position && candidate>=frame && candidate<clip.stop) {
              at=candidate;
              break;
            }
          }
        }
        if (at>frame) {
          pending[retained++]=row;
          wake=Math.min(wake,at,expiresFrame+1);
          continue;
        }
        const ready=(lastPlayed.get(rule.name) ?? -Infinity)+cooldown;
        if (frame<ready) decision(row,'cooldown',{readyFrame:ready});
        else {
          const status=play(resource,intent);
          if (status==='played' || status==='scheduled') {
            lastPlayed.set(rule.name,frame);
            decision(row,'played',{section:clip.section});
          } else decision(row,status);
        }
      }
      pending.length=retained;
    }

    return {hasSpace:[...rules.values()].some(rule=>rule.space),ruleFor,offer,step,level,
      resources:()=>new Set(pending.map(row=>row.rule.accent.resource)),
      inspect:frame=>({gain:level(frame),outcomes,pending:pending.map(({rule,expiresFrame})=>({
        cue:rule.name,resource:rule.accent.resource,opening:rule.accent.opening,expiresFrame
      }))})};
  }
  P.musicLiveScoring=Object.freeze({open});
})(KIT.procedural);
