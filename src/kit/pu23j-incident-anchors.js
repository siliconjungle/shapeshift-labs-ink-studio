/* Authored incident placements on the world clock and completed state. */
(function(K) {
  const W = K.world, Q = W.query, {check,equal,record} = W.data, {freeze} = K.procedural.data;
  const reason = 'authored-anchor';

  function compiler(world,systems) {
    let registry;
    return (raw,deadline,key)=>{
      if (!raw) return undefined;
      let window;
      if (raw.window) {
        const ticks = (seconds,round)=>W.storyTriggers.ticks(seconds,world.dt,round,'Anchor window exceeds the world tick budget for '+key);
        const opensAt = Math.max(1,ticks(raw.window.from,Math.ceil)), closesBefore = ticks(raw.window.until,Math.floor)+1;
        check(opensAt<closesBefore,'Anchor window contains no world tick for '+key);
        window = {opensAt,closesBefore};
      }
      check((window?.opensAt??1)<(deadline??Infinity),'Story deadline leaves no time for authored anchor '+key);
      if (raw.state) {
        const weather = world.visual?.weatherTracks||world.visual?.environmentPreset;
        registry ??= Q.create({world,...(weather&&{weatherTrackState:{}})},systems);
        check(registry.field(raw.state.field),'Unknown anchor query field '+raw.state.field+' in '+key);
      }
      return { ...(window&&{window}),...(raw.state&&{state:raw.state}) };
    };
  }

  function gate(policy,tick,query) {
    const {window,state} = policy;
    if (window&&tick<window.opensAt) return {tick,ready:false,reason:'before-anchor-window'};
    if (window&&tick>=window.closesBefore) return {tick,ready:false,reason:'anchor-window-missed'};
    if (!state) return {tick,ready:true,reason:'anchor-window-open'};
    const evidence = W.storyEvidence.observe({state},tick,undefined,query).change?.receipt;
    return evidence?{tick,ready:true,reason:'anchor-condition-matched',evidence}:
      {tick,ready:false,reason:'anchor-condition-unmet'};
  }

  function valid(policy,saved,tick) {
    if (!policy) return saved===undefined;
    if (!record(saved)) return false;
    if (!policy.state||policy.window&&(tick<policy.window.opensAt||tick>=policy.window.closesBefore))
      return equal(saved,gate(policy,tick));
    if (saved.ready===false) return equal(saved,{tick,ready:false,reason:'anchor-condition-unmet'});
    return W.storyEvidence.valid({state:policy.state},saved.evidence,tick,0,false)&&
      equal(saved,{tick,ready:true,reason:'anchor-condition-matched',evidence:saved.evidence});
  }

  function reservation(anchors,state,tick,nextBeat) {
    if (!anchors) return null;
    let earliest = null;
    for (const [key,policy] of Object.entries(anchors)) {
      const opensAt = policy.window?.opensAt, row = state?.[key];
      if (policy.state||!(opensAt>tick&&opensAt<nextBeat)||
          !(row?!row.terminal&&row.expiresAt>opensAt:policy.queueAt!==undefined)) continue;
      if (!earliest||opensAt<earliest.opensAt) earliest = {candidate:key,opensAt};
    }
    return earliest;
  }

  function inspect(anchors,state,tick,storyteller) {
    if (!anchors) return Q.missing('World has no authored incident anchors','missing');
    const rows = Object.entries(anchors).map(([candidate,policy])=>{
      const row = state?.[candidate], status = row?.status==='dispatched'?'placed':
        row?.status==='expired'||tick>=Math.min(policy.window?.closesBefore??Infinity,policy.worldDeadlineTick??Infinity)?'missed':row?'queued':'waiting';
      const blockers = [];
      if (row?.anchor?.ready===false) blockers.push(row.anchor.reason);
      if (row?.report?.ready===false) blockers.push('feasibility');
      if (row?.pressure?.ready===false) blockers.push('pressure');
      if (row?.cooldown?.ready===false) blockers.push('recovery-cooldown');
      return {candidate,policy,status,...(row&&{queuedAt:row.queuedAt,expiresAt:row.expiresAt,gate:row.anchor}),
        ...(row?.terminal&&{terminal:row.terminal}),blockers};
    });
    const next = storyteller?W.storyteller.nextAt(storyteller,W.storyteller.lastAutomatic(state)):null;
    const reserved = storyteller&&(next===null||tick>=next)?
      reservation(anchors,state,tick,W.storyteller.nextAt(storyteller,tick)):null;
    return Q.ok(freeze({tick,reserved,anchors:rows}));
  }

  W.incidentAnchors = Object.freeze({compiler,gate,valid,reservation,inspect,reason});
})(KIT);
