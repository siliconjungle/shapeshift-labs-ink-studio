/* Stable weighted selection and independently verifiable decision receipts. */
(function(K) {
  const W = K.world, Q = W.query, {check,equal,record} = W.data;
  const {freeze,hash} = K.procedural.data;
  const {isStoryId} = StoryDocument;
  const algorithm = 'weighted-ticket-v1', wordCount = 0x100000000;
  const compareId = (a,b) => a<b?-1:a>b?1:0;
  const before = (a,b) => a.queuedAt-b.queuedAt||compareId(a.candidate,b.candidate);
  const status = (ready,weight) => !ready?'blocked':weight===0?'zero-weight':'eligible';

  function draw(seed,pool,tick,totalWeight) {
    const ceiling = wordCount-wordCount%totalWeight;
    for (let attempt=0;attempt<128;attempt++) {
      let word = hash(JSON.stringify([algorithm,seed,pool,tick,attempt]));
      word = Math.imul(word^(word>>>16),0x7feb352d);
      word = Math.imul(word^(word>>>15),0x846ca68b);
      word = (word^(word>>>16))>>>0;
      if (word<ceiling) return {attempt,word,ticket:word%totalWeight};
    }
    throw Error('Incident selection exceeded its draw budget for '+pool);
  }

  function decide(seed,pool,tick,rows) {
    let totalWeight = 0;
    const eligible = [];
    const candidates = [...rows].sort(before).map(row=>{
      if (row.status!=='eligible') return row;
      const next = {...row,tickets:{from:totalWeight,to:totalWeight+row.weight}};
      totalWeight += row.weight;
      eligible.push(next);
      return next;
    });
    if (!eligible.length) return null;
    check(totalWeight>0&&totalWeight<=wordCount,'Invalid incident selection weight total');
    const sample = eligible.length===1?null:draw(seed,pool,tick,totalWeight);
    const chosen = sample===null?eligible[0]:eligible.find(row=>sample.ticket<row.tickets.to);
    return freeze({algorithm,seed,pool,tick,candidates,totalWeight,draw:sample,winner:chosen.candidate,
      reason:sample===null?'only-eligible-candidate':'seeded-weighted-draw'});
  }

  function select(seed,tick,rows,policyFor) {
    const pools = new Map(), selections = new Map();
    for (const {candidate,queuedAt,status:state} of rows) {
      const policy = policyFor(candidate);
      if (!policy) continue;
      const {pool,weight} = policy;
      if (!pools.has(pool)) pools.set(pool,[]);
      pools.get(pool).push({candidate,queuedAt,weight,status:status(state==='ready',weight)});
    }
    for (const [pool,candidates] of pools) {
      const receipt = decide(seed,pool,tick,candidates);
      if (receipt) selections.set(receipt.winner,receipt);
    }
    return selections;
  }

  function validate(state,seed,policyFor,cooldownAt) {
    const rows = Object.values(state), draws = new Set();
    for (const row of rows) {
      if (!Object.hasOwn(row,'selection')) continue;
      const {selection,candidate,terminal} = row, policy = policyFor(candidate);
      const message = 'Invalid saved incident selection for '+candidate;
      check(row.status==='dispatched'&&policy&&record(selection)&&selection.winner===candidate&&
        selection.tick===terminal.tick&&selection.pool===policy.pool&&selection.reason===terminal.reason&&
        Array.isArray(selection.candidates),message);
      const {pool,tick} = selection, seat = pool+'/'+tick;
      check(!draws.has(seat),'Multiple saved incident selections for '+seat);
      draws.add(seat);
      // These are the pool members still pending after explicit selections at this tick.
      const members = rows.filter(item=>policyFor(item.candidate)?.pool===pool&&item.queuedAt<=tick&&tick<item.expiresAt&&
        (!item.terminal||item.terminal.tick>tick||item===row)).sort(before);
      check(selection.candidates.length===members.length,message);
      const inputs = members.map((item,index)=>{
        const saved = selection.candidates[index], {weight} = policyFor(item.candidate);
        const cooling = (item.report.tick===tick?item.cooldown:cooldownAt(item.candidate,tick))?.ready===false;
        const canChange = item.report.tick!==tick||item.report.ready&&item.pressure?.ready===false;
        check(record(saved)&&saved.candidate===item.candidate&&saved.queuedAt===item.queuedAt&&saved.weight===weight&&
          (saved.status==='blocked'||!cooling)&&
          (canChange?saved.status==='blocked'||saved.status===status(true,weight):
            saved.status===status(item.report.ready&&!cooling,weight)),message);
        return {candidate:item.candidate,queuedAt:item.queuedAt,weight,status:saved.status};
      });
      check(equal(selection,decide(seed,pool,tick,inputs)),message);
    }
  }

  function inspect(state,tick,args) {
    const fields = ['pool','winner'];
    check(record(args)&&Object.keys(args).every(key=>fields.includes(key))&&
      (args.pool===undefined||isStoryId(args.pool))&&(args.winner===undefined||
        typeof args.winner==='string'&&args.winner.split('/').length===2&&args.winner.split('/').every(isStoryId)),
      'Invalid incident selection filters');
    const selections = Object.values(state??{}).flatMap(row=>{
      const receipt = row.selection;
      return receipt&&(args.pool===undefined||args.pool===receipt.pool)&&
        (args.winner===undefined||args.winner===receipt.winner)?[receipt]:[];
    }).sort((a,b)=>a.tick-b.tick||compareId(a.pool,b.pool));
    return Q.ok({tick,selections});
  }

  W.incidentSelection = Object.freeze({select,validate,inspect,before});
})(KIT);
