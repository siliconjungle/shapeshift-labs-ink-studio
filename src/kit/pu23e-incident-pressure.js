/* Pressure commitments derived from live incidents and reserved during queue admission. */
(function(K) {
  const W = K.world, Q = W.query, {check,own,record,equal} = W.data, {freeze} = K.procedural.data;
  const {isStoryId,pressureUnits} = StoryDocument;
  const live = new Set(['available','active','suspended']);
  const countOK = value => Number.isSafeInteger(value)&&value>=0&&value<=256;
  const summary = (used,limit) => ({used,limit,remaining:limit===null?null:limit-used});

  function compile(raw,policies) {
    if (raw===undefined&&!Object.values(policies).some(policy=>Object.keys(policy.pressure??{}).length)) return null;
    const config = raw===undefined?{}:raw;
    check(record(config)&&Object.keys(config).every(key=>['commitments','limits'].includes(key)),
      'Invalid incident pressure configuration');
    const {commitments=null,limits={}} = config;
    check((config.commitments===undefined||countOK(commitments))&&record(limits)&&Object.keys(limits).length<=64&&
      Object.entries(limits).every(([id,limit])=>isStoryId(id)&&pressureUnits(limit)),
      'Incident pressure needs a commitment limit from 0 to 256 and up to 64 integer pressure limits');
    const demands = Object.fromEntries(Object.keys(policies).sort().map(key=>[key,policies[key].pressure??{}]));
    const dimensions = [...new Set([...Object.keys(limits),...Object.values(demands).flatMap(Object.keys)])].sort();
    return freeze({commitments,limits,dimensions,demands});
  }

  function report(policy,key,tick,count,used) {
    const commitments = {...summary(count,policy.commitments),requested:1};
    const dimensions = Object.fromEntries(Object.entries(policy.demands[key]).sort(([a],[b])=>a<b?-1:a>b?1:0)
      .map(([id,requested])=>[id,{...summary(used[id],own(policy.limits,id)?policy.limits[id]:null),requested}]));
    const exceeds = ({remaining,requested})=>remaining!==null&&requested>remaining;
    const blockers = Object.entries(dimensions).filter(([,row])=>exceeds(row)).map(([id])=>({kind:'pressure',id}));
    if (exceeds(commitments)) blockers.unshift({kind:'commitments'});
    return {tick,ready:!blockers.length,commitments,dimensions,blockers};
  }

  function begin(policy,lifecycle) {
    const usage = Object.fromEntries(policy.dimensions.map(id=>[id,0])), holds = new Map();
    function hold(candidate,status) {
      check(!holds.has(candidate),'Duplicate incident pressure commitment '+candidate);
      const pressure = policy.demands[candidate];
      holds.set(candidate,{candidate,status,pressure});
      for (const [id,units] of Object.entries(pressure)) usage[id] += units;
    }
    for (const key of Object.keys(policy.demands)) {
      const status = lifecycle?.[key]?.transitions.at(-1).to;
      if (live.has(status)) hold(key,status);
    }
    return {
      assess:(key,tick)=>report(policy,key,tick,holds.size,usage),
      reserve:key=>hold(key,'available'),
      snapshot:()=>({
        commitments:summary(holds.size,policy.commitments),
        dimensions:Object.fromEntries(policy.dimensions.map(id=>[id,summary(usage[id],own(policy.limits,id)?policy.limits[id]:null)])),
        holds:[...holds.values()]
      })
    };
  }

  function validReport(policy,key,saved,tick) {
    if (!policy) return saved===undefined;
    if (!record(saved)||!countOK(saved.commitments?.used)||!record(saved.dimensions)||
        (policy.commitments!==null&&saved.commitments.used>policy.commitments)) return false;
    const usage = Object.fromEntries(Object.keys(policy.demands[key]).map(id=>[id,
      own(saved.dimensions,id)?saved.dimensions[id]?.used:undefined]));
    return Object.entries(usage).every(([id,value])=>Number.isSafeInteger(value)&&value>=0&&
      value<=(own(policy.limits,id)?policy.limits[id]:256000000))&&
      equal(saved,report(policy,key,tick,saved.commitments.used,usage));
  }

  function validate(policy,lifecycle) {
    const {commitments,dimensions} = begin(policy,lifecycle).snapshot();
    check([commitments,...Object.values(dimensions)].every(row=>row.remaining===null||row.remaining>=0),
      'Saved incident pressure commitments exceed the world budget');
  }

  function inspect(policy,lifecycle,tick) {
    return policy?Q.ok(freeze({tick,...begin(policy,lifecycle).snapshot()})):Q.missing('World has no incident pressure budget','missing');
  }

  W.incidentPressure = Object.freeze({compile,begin,validReport,validate,inspect});
})(KIT);
