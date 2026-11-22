/* Named pacing and challenge policies for automatic incident dispatch. */
(function(K) {
  const W = K.world, Q = W.query, {check,own,record,equal} = W.data, {freeze} = K.procedural.data;
  const {isStoryId,incidentCategories} = StoryDocument;
  const categories = [...incidentCategories,'unclassified'];
  const fields = (value,names) => record(value)&&Object.keys(value).every(key=>names.includes(key));
  const seconds = value => Number.isFinite(value)&&value>0;
  const integer = (value,max) => Number.isSafeInteger(value)&&value>=0&&value<=max;

  function compile(raw,dt,seed) {
    if (raw===undefined) return null;
    check(fields(raw,['active','profiles'])&&isStoryId(raw.active)&&record(raw.profiles)&&own(raw.profiles,raw.active)&&
      Object.keys(raw.profiles).length<=32,'Storyteller needs an active ID in a table of up to 32 profiles');
    const ticks = value=>Math.max(1,W.storyTriggers.ticks(value,dt,Math.ceil,'Storyteller cadence exceeds the world tick budget'));
    const profiles = Object.fromEntries(Object.keys(raw.profiles).sort().map(id=>{
      const profile = raw.profiles[id], place = 'Storyteller profile '+id;
      check(isStoryId(id)&&fields(profile,['cadence','challenge','categoryWeights']),place+' has invalid fields');
      const {cadence,challenge={},categoryWeights={}} = profile;
      check(fields(cadence,['minInterval','maxInterval'])&&seconds(cadence.minInterval)&&
        (cadence.maxInterval===undefined||seconds(cadence.maxInterval)&&cadence.maxInterval>=cadence.minInterval),
      place+' needs positive ordered cadence intervals in seconds');
      check(fields(challenge,['maxIntensity'])&&(challenge.maxIntensity===undefined||integer(challenge.maxIntensity,5)),
        place+' needs a maximum intensity from 0 to 5');
      check(fields(categoryWeights,categories)&&Object.values(categoryWeights).every(weight=>integer(weight,16)),
        place+' needs integer weights from 0 to 16 for known incident categories');
      return [id,{cadence:{minTicks:ticks(cadence.minInterval),maxTicks:ticks(cadence.maxInterval??cadence.minInterval)},
        challenge:{maxIntensity:challenge.maxIntensity??5},categoryWeights}];
    }));
    return freeze({active:raw.active,profiles,seed});
  }

  function candidates(model,specs) {
    const {challenge,categoryWeights} = model.profiles[model.active];
    const weighted = Object.keys(categoryWeights).length>0;
    const authoredPools = new Set([...specs.values()].map(spec=>spec.policy.selection?.pool));
    let sharedPool = 'storyteller';
    for (let i=1;authoredPools.has(sharedPool);i++) sharedPool = 'storyteller-'+i;
    const rows = [];
    for (const [key,{policy,info}] of specs) {
      if (policy.release!=='automatic') continue;
      const {category='unclassified',intensity=null} = info.incident??{};
      const categoryWeight = categoryWeights[category]??1;
      const original = policy.selection??(weighted?{pool:sharedPool,weight:1}:null);
      const selection = original&&{pool:original.pool,weight:original.weight*categoryWeight};
      rows.push([key,{category,intensity,categoryWeight,withinChallenge:intensity===null||intensity<=challenge.maxIntensity,
        ...(selection&&{selection})}]);
    }
    return freeze(Object.fromEntries(rows));
  }

  function nextAt(model,tick) {
    if (tick===null) return null;
    const {minTicks,maxTicks} = model.profiles[model.active].cadence;
    const offset = maxTicks===minTicks?0:
      W.incidentSelection.draw(model.seed,'cadence',tick,maxTicks-minTicks+1,'storyteller-interval-v1').ticket;
    return tick+minTicks+offset;
  }

  function lastAutomatic(state) {
    let last = null;
    for (const row of Object.values(state??{}))
      if (row.storyteller?.mode==='automatic') last = Math.max(last??0,row.terminal.tick);
    return last;
  }

  function receipt(model,mode,previous,tick) {
    return {profile:model.active,mode,...(mode==='automatic'&&{
      previousAutomaticAt:previous,nextAutomaticAt:nextAt(model,tick)
    })};
  }

  function validate(model,direction,state) {
    const rows = Object.values(state).filter(row=>row.status==='dispatched').sort((a,b)=>a.terminal.tick-b.terminal.tick);
    let previous = null;
    for (const row of rows) {
      const {candidate,terminal,selection,storyteller} = row, mode = storyteller?.mode;
      const message = 'Invalid saved storyteller dispatch for '+candidate;
      check((mode==='manual'||mode==='automatic')&&equal(storyteller,receipt(model,mode,previous,terminal.tick)),message);
      if (mode==='manual') {
        check(selection===undefined,message);
        continue;
      }
      const spec = direction[candidate], earliest = nextAt(model,previous);
      check(spec?.withinChallenge&&spec.selection?.weight!==0&&(earliest===null||terminal.tick>=earliest)&&
        Boolean(spec.selection)===Boolean(selection)&&(selection||terminal.reason==='automatic-release'),message);
      previous = terminal.tick;
    }
  }

  function inspect(model,direction,state,tick) {
    if (!model) return Q.missing('World has no storyteller profile','missing');
    const lastAutomaticAt = lastAutomatic(state), nextAutomaticAt = nextAt(model,lastAutomaticAt);
    const cadenceReady = nextAutomaticAt===null||tick>=nextAutomaticAt;
    const pending = [];
    for (const row of Object.values(state??{}).sort(W.incidentSelection.before)) {
      const spec = direction?.[row.candidate];
      if (!spec||!['ready','blocked'].includes(row.status)) continue;
      const blockers = [];
      if (!row.report.ready) blockers.push('feasibility');
      if (row.pressure?.ready===false) blockers.push('pressure');
      if (row.cooldown?.ready===false) blockers.push('recovery-cooldown');
      if (!spec.withinChallenge) blockers.push('challenge');
      if (spec.selection?.weight===0) blockers.push('zero-weight');
      if (!cadenceReady) blockers.push('cadence');
      pending.push({candidate:row.candidate,...spec,ready:!blockers.length,blockers});
    }
    return Q.ok(freeze({tick,profile:model.active,...model.profiles[model.active],lastAutomaticAt,nextAutomaticAt,cadenceReady,pending}));
  }

  W.storyteller = Object.freeze({compile,candidates,nextAt,lastAutomatic,receipt,validate,inspect});
})(KIT);
