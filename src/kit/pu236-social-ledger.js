/* World-owned reputation and obligations. */
(function(K) {
  const W = K.world, {check,equal,id,own,read,record,selector} = W.data, Q = W.query;
  const {freeze} = K.procedural.data;
  const limit = 4096;
  const actions = {
    'adjust-reputation': 'reputation-changed',
    'open-obligation': 'obligation-opened',
    'resolve-obligation': 'obligation-resolved'
  };
  const closed = value => value==='fulfilled'||value==='released';
  const keys = (value,names) => record(value)&&Object.keys(value).every(key=>names.includes(key));
  const termsOK = value => record(value)&&JSON.stringify(value).length<=4096;
  const partyId = value => W.worldFacts.qualified(value);
  const roles = ['debtor','creditor'];
  const categories = ['promise','debt','duty'];
  const policyNames = ['retain','release','transfer'];
  const partyKey = {debtor:'creditor',creditor:'debtor'};
  const termOptions = ['category','fulfillment','onDeparture'];
  const score = (state,{subject,faction}) => own(state.reputation,subject)&&own(state.reputation[subject],faction)?
    state.reputation[subject][faction]:0;
  function validReputation(value) {
    return record(value)&&Object.keys(value).length<=limit&&Object.entries(value).every(([subject,scores])=>
      id(subject)&&record(scores)&&Object.keys(scores).length<=limit&&
      Object.entries(scores).every(([faction,score])=>id(faction)&&Number.isSafeInteger(score)));
  }

  function checkEvent(rule,message) {
    check(keys(rule,['kind','system','where'])&&id(rule.kind)&&(rule.system===undefined||id(rule.system))&&
      JSON.stringify(rule).length<=4096,message);
    Q.condition(rule.where,{});
  }

  function eventMatches(rule,event) {
    return rule.kind===event.kind&&(rule.system===undefined||rule.system===event.system)&&Q.condition(rule.where,event);
  }

  function validReceipt(event) {
    return keys(event,['id','tick','kind','system'])&&W.worldFacts.eventId(event.id)&&
      Number(event.id.split('.')[0])===event.tick&&id(event.kind)&&id(event.system);
  }

  function validPayment(payment) {
    if (!keys(payment,['from','to','amount'])||!partyId(payment.from)||!partyId(payment.to)||payment.from===payment.to) return false;
    const {amount} = payment;
    return Number.isFinite(amount)&&amount>0||Array.isArray(amount)&&[2,3].includes(amount.length)&&
      Array.from(amount).every(Number.isFinite)&&amount.some(value=>value!==0);
  }

  W.runtime.register('social-ledger',config=>{
    const reputation = config?.reputation??{}, {parties={}} = config??{};
    check(keys(config??{},['reputation','parties'])&&validReputation(reputation),'Invalid initial social ledger reputation');
    check(record(parties)&&Object.keys(parties).length<=128,'Social ledgers support up to 128 departure rules');
    const partyRules = new Map();
    for (const party of Object.keys(parties).sort()) {
      const rule = parties[party];
      check(partyId(party)&&keys(rule,['departure','successor'])&&
        (rule.successor===undefined||partyId(rule.successor)&&rule.successor!==party),'Invalid social ledger party '+party);
      checkEvent(rule.departure,'Invalid departure event for '+party);
      if (!partyRules.has(rule.departure.kind)) partyRules.set(rule.departure.kind,[]);
      partyRules.get(rule.departure.kind).push(party);
    }
    const watchesDepartures = partyRules.size>0;

    function checkTerms(args,original=args) {
      check(partyId(args.debtor)&&partyId(args.creditor)&&args.debtor!==args.creditor&&termsOK(args.terms)&&
        (args.category===undefined||categories.includes(args.category)), 'Invalid obligation parties, category, or terms');
      if (args.fulfillment!==undefined) {
        check(keys(args.fulfillment,['event','debtorPath','creditorPath']),'Invalid obligation fulfillment');
        checkEvent(args.fulfillment.event,'Invalid obligation fulfillment event');
        for (const path of ['debtorPath','creditorPath']) if (own(args.fulfillment,path)) selector(args.fulfillment[path]);
      }
      if (args.onDeparture!==undefined) {
        check(keys(args.onDeparture,roles),'Invalid obligation departure policies');
        for (const [role,policy] of Object.entries(args.onDeparture))
          check(policyNames.includes(policy)&&(policy==='retain'||own(parties,original[role]))&&
            (policy!=='transfer'||parties[original[role]].successor!==undefined),'Invalid obligation departure policy for '+role);
      }
    }

    function checkAction(action,args) {
      if (action==='open-obligation') {
        check(keys(args,['obligation','debtor','creditor','terms',...termOptions])&&id(args.obligation),
          'Invalid social ledger action '+action);
        checkTerms(args);
      } else {
        const valid = action==='adjust-reputation' ?
          keys(args,['subject','faction','delta'])&&id(args.subject)&&id(args.faction)&&Number.isSafeInteger(args.delta)&&args.delta!==0 :
          keys(args,['obligation','status'])&&id(args.obligation)&&closed(args.status);
        check(valid,'Invalid social ledger action '+action);
      }
    }

    function update(state,obligation,row) {
      return {state:{...state,obligations:{...state.obligations,[obligation]:row}},detail:{obligation,...row}};
    }

    function apply(state,action,args,tick) {
      if (action==='adjust-reputation') {
        const {subject,faction,delta} = args, scores = own(state.reputation,subject)?state.reputation[subject]:{};
        const previous = score(state,args), value = previous+delta;
        if (!Number.isSafeInteger(value)) return {blocked:'reputation-overflow'};
        if ((!own(state.reputation,subject)&&Object.keys(state.reputation).length>=limit)||
            (!own(scores,faction)&&Object.keys(scores).length>=limit)) return {blocked:'reputation-capacity'};
        return {state:{...state,reputation:{...state.reputation,[subject]:{...scores,[faction]:value}}},
          detail:{subject,faction,previous,delta,value}};
      }
      const {obligation,...agreement} = args, prior = own(state.obligations,obligation)?state.obligations[obligation]:undefined;
      if (action==='open-obligation') {
        if (prior) return {blocked:'obligation-already-exists'};
        if (roles.some(role=>own(state.departures,args[role]))) return {blocked:'obligation-party-departed'};
        if (Object.keys(state.obligations).length>=limit) return {blocked:'obligation-capacity'};
        return update(state,obligation,{...agreement,status:'open',opened:tick});
      }
      if (!prior) return {blocked:'obligation-missing'};
      if (prior.status!=='open') return {blocked:'obligation-already-closed'};
      if (args.status==='fulfilled'&&prior.fulfillment) return {blocked:'obligation-needs-evidence'};
      return update(state,obligation,{...prior,status:args.status,closed:tick});
    }

    function observe(state,events,publish,nativeTransfers) {
      const open = Object.keys(state.obligations).filter(name=>state.obligations[name].status==='open').sort();
      const proofs = new Map();
      for (const name of open) {
        const {fulfillment} = state.obligations[name];
        if (!fulfillment) continue;
        const {kind} = fulfillment.event;
        if (!proofs.has(kind)) proofs.set(kind,[]);
        proofs.get(kind).push(name);
      }
      for (const event of events) {
        const recipients = partyRules.get(event.kind)??[], candidates = proofs.get(event.kind)??[];
        if (!recipients.length&&!candidates.length) continue;
        const {id,tick,kind,system} = event, receipt = {id,tick,kind,system};
        const leaving = recipients.filter(party=>!own(state.departures,party)&&eventMatches(parties[party].departure,event));
        for (const party of leaving) {
          state = {...state,departures:{...state.departures,[party]:receipt}};
          publish('obligation-party-departed',{party,event:receipt},id);
        }
        for (const party of leaving) for (const obligation of open) {
          const prior = state.obligations[obligation];
          if (prior.status!=='open') continue;
          const role = roles.find(role=>prior[role]===party), policy = prior.onDeparture?.[role];
          if (policy===undefined||policy==='retain') continue;
          let result;
          if (policy==='release') {
            result = update(state,obligation,{...prior,status:'released',closed:tick,
              resolution:{method:'departure',party,role,event:receipt}});
            publish(actions['resolve-obligation'],result.detail,id);
          } else {
            const to = parties[party].successor;
            if (!to||own(state.departures,to)||prior[partyKey[role]]===to) {
              publish('obligation-departure-blocked',{obligation,role,party,successor:to??null,reason:'successor-unavailable',event:receipt},id);
              continue;
            }
            const handoff = {role,from:party,to,event:receipt};
            result = update(state,obligation,{...prior,[role]:to,handoffs:[...(prior.handoffs??[]),handoff]});
            publish('obligation-transferred',{...result.detail,handoff},id);
          }
          state = result.state;
        }
        if (kind==='transfer'&&(!nativeTransfers.has(id)||event.status!=='full')) continue;
        for (const obligation of candidates) {
          const prior = state.obligations[obligation], proof = prior.fulfillment;
          if (prior.status!=='open'||tick<=prior.opened||!eventMatches(proof.event,event)) continue;
          if (roles.some(role=>proof[role+'Path']!==undefined&&read(event,selector(proof[role+'Path']))!==prior[role])) continue;
          const payment = kind==='transfer'?{from:event.from,to:event.to,amount:event.applied}:undefined;
          const result = update(state,obligation,{...prior,status:'fulfilled',closed:tick,
            resolution:{method:'event',event:receipt,...(payment&&{payment})}});
          state = result.state;
          publish(actions['resolve-obligation'],result.detail,id);
          break;
        }
      }
      return state;
    }

    function validateState(state) {
      const message = 'Invalid saved social ledger';
      check(keys(state,['reputation','obligations','departures'])&&validReputation(state.reputation)&&record(state.obligations)&&
        Object.keys(state.obligations).length<=limit&&own(state,'departures')===watchesDepartures,message);
      const departures = state.departures??{};
      check(record(departures)&&Object.entries(departures).every(([party,event])=>own(parties,party)&&validReceipt(event)&&
        event.kind===parties[party].departure.kind&&(!parties[party].departure.system||event.system===parties[party].departure.system)),message);
      const used = new Set();
      for (const [name,row] of Object.entries(state.obligations)) {
        check(id(name)&&keys(row,['debtor','creditor','terms','status','opened','closed','handoffs','resolution',...termOptions])&&
          Number.isSafeInteger(row.opened)&&row.opened>0&&
          (row.status==='open'?row.closed===undefined&&row.resolution===undefined:
            closed(row.status)&&Number.isSafeInteger(row.closed)&&row.closed>=row.opened),message);
        const proof = row.resolution;
        if (proof!==undefined) check(keys(proof,['method','party','role','event','payment'])&&
          validReceipt(proof.event)&&proof.event.tick===row.closed,message);
        const original = {debtor:row.debtor,creditor:row.creditor};
        let end = proof?.event;
        if (row.handoffs!==undefined) {
          check(Array.isArray(row.handoffs)&&row.handoffs.length>0&&row.handoffs.length<=Object.keys(departures).length,message);
          for (const step of row.handoffs.slice().reverse()) {
            check(keys(step,['role','from','to','event'])&&roles.includes(step.role)&&own(departures,step.from)&&
              step.to===parties[step.from].successor&&step.to===original[step.role]&&step.from!==original[partyKey[step.role]]&&
              equal(step.event,departures[step.from])&&step.event.tick>=row.opened&&
              (row.closed===undefined||step.event.tick<=row.closed)&&
              (!end||W.worldFacts.compare(step.event.id,end.id)<=0)&&row.onDeparture?.[step.role]==='transfer',message);
            original[step.role] = step.from;
            end = step.event;
          }
        }
        checkTerms(row,original);
        if (proof!==undefined) {
          if (proof.method==='event') {
            const rule = row.fulfillment?.event;
            check(row.status==='fulfilled'&&row.closed>row.opened&&rule&&rule.kind===proof.event.kind&&
              (rule.system===undefined||rule.system===proof.event.system)&&proof.party===undefined&&proof.role===undefined&&
              !used.has(proof.event.id)&&(rule.kind==='transfer'?validPayment(proof.payment):proof.payment===undefined),message);
            used.add(proof.event.id);
          } else {
            check(proof.method==='departure'&&row.status==='released'&&roles.includes(proof.role)&&
              row[proof.role]===proof.party&&own(departures,proof.party)&&equal(departures[proof.party],proof.event)&&
              row.onDeparture?.[proof.role]==='release'&&proof.payment===undefined,message);
          }
        } else check(row.status!=='fulfilled'||row.fulfillment===undefined,message);
      }
    }
    return {initial:()=>freeze({reputation,obligations:{},...(watchesDepartures&&{departures:{}})}),shareCheckpoint:true,validateState,checkAction,
      storySocial:{apply,events:actions,observe},
      actions:Object.fromEntries(Object.entries(actions).map(([action,event])=>[action,(state,args,ctx)=>{
        const result = apply(state,action,args,ctx.tick);
        if (result.blocked) {
          ctx.emit('social-action-rejected',{action,reason:result.blocked});
          return state;
        }
        ctx.emit(event,result.detail);
        return result.state;
      }])),
      fields:{
        reputation:{type:'record',qualified:true,selector:true,read({state,args}){
          if (!Object.keys(args).length) return Q.ok(state.reputation);
          const {subject,faction} = args;
          return id(subject)&&id(faction)?Q.ok({subject,faction,value:score(state,args)}):Q.missing('Specify subject and faction','missing');
        }},
        obligations:{type:'record',qualified:true,selector:true,read({state,args}){
          const {obligation,debtor,creditor,status,category} = args;
          if (!Object.keys(args).length) return Q.ok(state.obligations);
          if (obligation!==undefined)
            return own(state.obligations,obligation)?Q.ok(state.obligations[obligation]):Q.missing('Unknown obligation','missing');
          return Q.ok(Object.fromEntries(Object.entries(state.obligations).filter(([,row])=>
            (debtor===undefined||row.debtor===debtor)&&(creditor===undefined||row.creditor===creditor)&&
            (status===undefined||row.status===status)&&(category===undefined||row.category===category))));
        }},
        ...(watchesDepartures&&{departures:{type:'record',qualified:true,read({state,args:{party}}){
          if (party===undefined) return Q.ok(state.departures);
          return own(state.departures,party)?Q.ok(state.departures[party]):Q.missing('Party has no recorded departure','missing');
        }}})
      }};
  });
})(KIT);
