/* Atomic story settlement using simulation-owned accounts, work and reservations. */
(function(K) {
  const W = K.world, Q = W.query, {check,equal,own,record,endpoint} = W.data;
  const {freeze} = K.procedural.data;
  const socialActions = {reputation:'adjust-reputation',obligation:'open-obligation'};
  const effectsOf = spec => Object.keys(spec).sort().map(id=>[id,...Object.entries(spec[id])[0]]);

  function compile(documents,systems,transfers) {
    const definitions = {};
    for (const document of documents) for (const [story,definition] of Object.entries(document.stories)) {
      const settlement = definition.lifecycle?.settlement;
      if (!settlement) continue;
      const key = document.id+'/'+story;
      const groups = Object.entries(settlement.outcomes??{});
      if (settlement.costs) groups.unshift(['costs',settlement.costs]);
      for (const [phase,effects] of groups) for (const [id,type,spec] of effectsOf(effects)) {
        try {
          if (type==='transfer') {
            const {from,to} = transfers.validate(spec);
            check(!from.ownerOnly&&!to.ownerOnly,'Story transfers require publicly writable accounts');
          } else if (type==='claim' || type==='access') {
            const {board,...args} = spec, provider = systems[board];
            check(provider?.reservationBoard,'Unknown reservation board '+board);
            if (type==='access') provider.checkAction('post-job',args);
            else if (effects===settlement.costs) {
              const reservation = definition.lifecycle.commitment.order.reservation;
              check(reservation?.board===board&&Object.values(reservation.require).some(need=>
                (need.units??1)>=(args.units??1)&&(need.job!==undefined||need.anyOf.includes(args.pool))),
              'Cost needs a matching commitment reservation');
            }
          } else if (type==='work') {
            const [name,process] = endpoint(spec.site), sites = systems[name]?.worksites?.definitions;
            check(own(sites,process)&&spec.batch<=sites[process].batches,'Unknown worksite batch '+spec.site+'/'+spec.batch);
            const objective = definition.stages[spec.stage].objectives[spec.objective];
            const evidence = StoryDocument.objectiveRule(objective,document.objectiveTypes);
            check(evidence?.event?.kind==='work-completed'&&
              (evidence.event.system===undefined||evidence.event.system===name),'Expected work-completed evidence from '+name);
          } else {
            const {ledger,...args} = spec, provider = systems[ledger];
            check(provider?.storySocial,'Unknown social ledger '+ledger);
            provider.checkAction(socialActions[type],args);
          }
        } catch (error) {
          throw new Error('Invalid story settlement '+key+'/'+phase+'/'+id+': '+error.message);
        }
      }
      definitions[key] = settlement;
    }
    return Object.keys(definitions).length?freeze(definitions):undefined;
  }

  function workMatches(event,{site,batch,actor}) {
    const [system,process] = endpoint(site);
    return event?.kind==='work-completed'&&event.system===system&&event.process===process&&event.batch===batch&&
      Array.isArray(event.workers)&&event.workers.length>0&&
      (!actor||event.workers.some(worker=>worker&&Object.keys(actor).every(key=>worker[key]===actor[key])));
  }

  function workProof(row,args) {
    const {stage,objective} = args, flow = row.flow;
    const visit = flow?.current?.stage===stage?flow.current:flow?.route.findLast(entry=>entry.stage===stage);
    const event = visit?.objectives[objective]?.receipt?.event;
    return workMatches(event,args)?{stage,visit:visit.visit,objective,event}:null;
  }

  function apply(spec,row,owner,tick,tx) {
    const effects = [];
    for (const [id,type,args] of effectsOf(spec)) {
      let result;
      if (type==='transfer') result = tx.transfer(args);
      else if (type==='access') {
        const {board,...job} = args;
        result = tx.postJob(board,job);
      } else if (type==='claim') {
        const claim = owner&&tx.query().probe(args.board+'/claim',undefined,owner).value;
        const grant = claim?.status==='held'&&claim.grants.find(grant=>grant.pool===args.pool&&grant.units>=(args.units??1));
        result = grant?{detail:{board:args.board,owner,grant,until:claim.until}}:{blocked:'claim-not-held'};
      } else if (type==='work') {
        const proof = workProof(row,args);
        result = proof?{detail:proof}:{blocked:'work-proof-missing'};
      } else {
        const {ledger,...action} = args;
        result = tx.social(ledger,socialActions[type],action);
      }
      if (result.blocked) return {status:'blocked',tick,blocker:{id,type,reason:result.blocked,
        ...(result.detail&&{detail:result.detail})}};
      effects.push({id,type,detail:result.detail});
    }
    return {status:'applied',tick,effects};
  }

  function note(row,phase,outcome,report) {
    const {blocked,...applied} = row.settlements??{};
    const entry = {...(outcome!==undefined&&{outcome}),...report};
    const settlements = report.status==='applied'?{...applied,[phase]:entry}:{...applied,blocked:{phase,...entry}};
    return {...row,settlements};
  }

  function validDetail(type,args,detail,row,at) {
    if (!record(detail)) return false;
    if (type==='transfer') return detail.tick===at&&detail.requester==='world'&&detail.mode==='exact'&&
      detail.status==='full'&&detail.from===args.from&&detail.to===args.to&&
      equal(detail.requested,args.amount)&&equal(detail.applied,args.amount)&&equal(detail.limitedBy,[]);
    if (type==='claim') return detail.board===args.board&&detail.grant?.pool===args.pool&&
      Number.isSafeInteger(detail.grant.units)&&detail.grant.units>=(args.units??1)&&record(detail.owner);
    if (type==='work') return detail.stage===args.stage&&detail.objective===args.objective&&
      Number.isSafeInteger(detail.visit)&&detail.visit>0&&detail.event?.tick>0&&detail.event.tick<=at&&
      workMatches(detail.event,args)&&(Array.isArray(row.flow?.route)&&row.flow.route.some(visit=>visit?.visit===detail.visit&&visit.stage===detail.stage&&
        equal(visit.objectives?.[detail.objective]?.receipt?.event,detail.event))||detail.visit<=row.flow?.dropped);
    if (type==='access') return detail.board===args.board&&detail.job?.id===args.job&&
      detail.job.kind==='job'&&detail.job.status==='open'&&detail.job.posted===at&&equal(detail.job.holder,args.holder);
    if (type==='reputation') return detail.ledger===args.ledger&&detail.subject===args.subject&&
      detail.faction===args.faction&&detail.delta===args.delta&&Number.isSafeInteger(detail.previous)&&
      Number.isSafeInteger(detail.value)&&detail.value===detail.previous+args.delta;
    return detail.ledger===args.ledger&&detail.obligation===args.obligation&&detail.debtor===args.debtor&&
      detail.creditor===args.creditor&&equal(detail.terms,args.terms)&&detail.status==='open'&&detail.opened===at;
  }

  const keys = (row,names) => record(row)&&Object.keys(row).every(key=>names.includes(key));
  function valid(spec,row,tick) {
    const saved = row.settlements, end = row.transitions.at(-1);
    if (!spec) return saved===undefined;
    const activation = row.transitions.find(entry=>entry.from==='available'&&entry.to==='active');
    const hasCosts = Boolean(spec.costs&&(activation||row.dropped));
    const hasOutcome = end.outcome!==undefined&&own(spec.outcomes,end.outcome);
    if (!saved) return !hasCosts&&!hasOutcome;
    if (!keys(saved,['costs','outcome','blocked'])||!Object.keys(saved).length||
        own(saved,'costs')!==hasCosts||own(saved,'outcome')!==hasOutcome) return false;
    const tickOK = value => Number.isSafeInteger(value)&&value>0&&value<=tick;
    function applied(report,effects) {
      const expected = effectsOf(effects);
      return keys(report,['outcome','status','tick','effects'])&&report.status==='applied'&&tickOK(report.tick)&&
        Array.isArray(report.effects)&&report.effects.length===expected.length&&expected.every(([id,type,args],index)=>{
          const item = report.effects[index];
          return keys(item,['id','type','detail'])&&item.id===id&&item.type===type&&validDetail(type,args,item.detail,row,report.tick);
        });
    }
    if (hasCosts&&(!applied(saved.costs,spec.costs)||saved.costs.outcome!==undefined||
        (activation?saved.costs.tick!==activation.tick:saved.costs.tick>row.transitions[0].tick))) return false;
    if (hasOutcome&&(!applied(saved.outcome,spec.outcomes[end.outcome])||
        saved.outcome.outcome!==end.outcome||saved.outcome.tick!==end.tick||saved.blocked)) return false;
    if (!own(saved,'blocked')) return true;
    const blocked = saved.blocked;
    if (!keys(blocked,['phase','outcome','status','tick','blocker'])||blocked.status!=='blocked'||!tickOK(blocked.tick)||
        !keys(blocked.blocker,['id','type','reason','detail'])||typeof blocked.blocker.reason!=='string'||
        (blocked.blocker.detail!==undefined&&!record(blocked.blocker.detail))) return false;
    const pending = blocked.phase==='costs'&&!hasCosts&&blocked.outcome===undefined?spec.costs:
      blocked.phase==='outcome'&&own(spec.outcomes,blocked.outcome)?spec.outcomes[blocked.outcome]:undefined;
    return own(pending,blocked.blocker.id)&&own(pending[blocked.blocker.id],blocked.blocker.type);
  }

  function inspect(definitions,lifecycle,{story}) {
    const rows = Object.fromEntries(Object.entries(definitions??{}).map(([key,spec])=>
      [key,{definition:spec,...lifecycle?.[key]?.settlements}]));
    return story===undefined?Q.ok(rows):own(rows,story)?Q.ok(rows[story]):Q.missing('Unknown story settlement '+story,'missing');
  }

  W.storySettlement = Object.freeze({compile,apply,note,valid,inspect});
})(KIT);
