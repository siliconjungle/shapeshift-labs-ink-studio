/* Conflicting accounts and evidence scoped to a holder and an authored topic. */
(function(K) {
  const W = K.world, Q = W.query, F = W.worldFacts, N = W.worldKnowledge;
  const {check,record,own,equal,id} = W.data, {freeze} = K.procedural.data;
  const {holderOK,sameHolder,keyFor,validDetail,validReceipt} = N;
  const claim = 'claim-belief', relay = 'relay-belief', verify = 'verify-belief';
  const actions = Object.freeze([claim,relay,verify]);
  const kind = 'belief-updated', rejection = 'belief-rejected';
  const eventKinds = Object.freeze([kind,rejection]);
  const fields = (value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const certainty = value=>integer(value,0,100);
  const inFrame = (event,tick)=>F.eventId(event)&&Number(event.split('.')[0])<=tick;

  function assessment(row) {
    if (!row) return {status:'unknown'};
    if (row.evidence) return {status:'verified',confidence:100,value:row.evidence.receipt.value,event:row.evidence.event};
    const confidence = Math.max(...row.accounts.map(account=>account.confidence));
    const strongest = row.accounts.filter(account=>account.confidence===confidence);
    const preferred = strongest[0];
    return strongest.every(account=>equal(account.value,preferred.value))?
      {status:'believed',confidence,value:preferred.value,event:preferred.event}:
      {status:'contested',confidence};
  }

  function compile(raw,factPolicy,knowledgePolicy) {
    if (raw===undefined) return null;
    check(knowledgePolicy,'World beliefs require world knowledge');
    check(fields(raw,['topics','limit','accountLimit'])&&record(raw.topics)&&
      integer(Object.keys(raw.topics).length,1,128),'World beliefs need 1–128 named topics');
    const {limit=512,accountLimit=16} = raw;
    check(integer(limit,1,4096)&&integer(accountLimit,2,64),'World beliefs retain 1–4096 entries and 2–64 accounts per entry');
    const topics = Object.fromEntries(Object.entries(raw.topics).map(([topic,spec])=>{
      check(id(topic)&&fields(spec,['type','field'])&&typeof spec.type==='string'&&own(knowledgePolicy.fields,spec.type)&&
        knowledgePolicy.fields[spec.type].includes(spec.field),'Invalid world belief topic '+topic);
      return [topic,{type:spec.type,field:spec.field}];
    }));
    const policy = freeze({topics,limit,accountLimit});
    const hasTopic = topic=>typeof topic==='string'&&own(topics,topic);
    function checkAction(action,args) {
      check(record(args)&&hasTopic(args.topic),'World belief action needs a declared topic');
      const spec = topics[args.topic];
      if (action===claim)
        check(fields(args,['topic','holder','source','value','confidence'])&&holderOK(args.holder)&&holderOK(args.source)&&
          certainty(args.confidence)&&validDetail(factPolicy.types[spec.type],spec.field,args.value),
        'Belief claim needs a holder, source, typed value, and integer confidence from 0 to 100');
      else if (action===relay)
        check(fields(args,['topic','from','to','account','confidence'])&&holderOK(args.from)&&holderOK(args.to)&&
          !sameHolder(args.from,args.to)&&F.eventId(args.account)&&(args.confidence===undefined||certainty(args.confidence)),
        'Belief relay needs distinct holders, an original account ID, and optional confidence from 0 to 100');
      else
        check(fields(args,['topic','holder','fact'])&&holderOK(args.holder)&&F.eventId(args.fact),
          'Belief verification needs a holder and a fact ID');
    }

    function begin(previous) {
      let rows, snapshot = previous, dropped = previous.dropped;
      const index = ()=>rows??=new Map(previous.records.map(row=>[keyFor(row.holder,row.topic),row]));
      function apply(action,args,event,knowledge) {
        const {topic} = args, holder = action===relay?args.to:args.holder;
        const key = keyFor(holder,topic), before = index().get(key);
        let accounts = before?.accounts??[], evidence = before?.evidence;
        let account, via, rejected;
        if (action===claim)
          account = {event,origin:event,source:args.source,value:args.value,confidence:args.confidence};
        else if (action===relay) {
          const sender = index().get(keyFor(args.from,topic))?.accounts.find(row=>row.origin===args.account);
          if (!sender) rejected = 'source-lacks-account';
          else if (args.confidence>sender.confidence) rejected = 'confidence-exceeds-source';
          else if (accounts.some(row=>row.origin===args.account)) return {};
          else {
            via = sender.event;
            account = {...sender,event,via,from:args.from,confidence:args.confidence??sender.confidence};
          }
        } else {
          const {type,field} = topics[topic], known = knowledge.lookup(holder,args.fact,field);
          if (!known||known.type!==type) rejected = 'holder-lacks-evidence';
          else if (evidence&&F.compare(args.fact,evidence.fact)<=0) return {};
          else {
            via = known.receipt.event;
            evidence = {event,fact:args.fact,receipt:known.receipt};
          }
        }
        if (rejected) return {rejected};
        if (account) accounts = [...accounts.slice(1-accountLimit),account];
        const row = {holder,topic,accounts,...(evidence&&{evidence})};
        rows.delete(key);
        rows.set(key,row);
        snapshot = undefined;
        if (rows.size>limit) {
          rows.delete(rows.keys().next().value);
          dropped++;
        }
        return {via,belief:{holder,topic,before:assessment(before),after:assessment(row),...(account?{account}:{evidence})}};
      }
      return {apply,snapshot:()=>snapshot??=freeze({records:[...rows.values()],dropped})};
    }

    function validate(saved,tick,facts,knowledge,events) {
      check(fields(saved,['records','dropped'])&&Array.isArray(saved.records)&&saved.records.length<=limit&&
        integer(saved.dropped,0,Number.MAX_SAFE_INTEGER)&&(!saved.dropped||saved.records.length===limit),
      'Invalid saved belief ledger');
      const lastEvents = new Map(events.filter(event=>event?.kind===kind).map(event=>[event.id,event.belief]));
      const known = new Map(knowledge.records.map(row=>[keyFor(row.holder,row.fact),row]));
      const authoritative = new Map(facts.records.map(fact=>[fact.id,fact]));
      const keys = new Set(), updates = new Set(), receipts = new Map(), relays = [];
      let previous;
      for (const row of saved.records) {
        const message = 'Invalid saved belief record';
        check(fields(row,['holder','topic','accounts','evidence'])&&holderOK(row.holder)&&hasTopic(row.topic)&&
          Array.isArray(row.accounts)&&row.accounts.length<=accountLimit&&(row.accounts.length||row.evidence!==undefined),message);
        const {holder,topic,accounts,evidence} = row, {type,field} = topics[topic], schema = factPolicy.types[type];
        const key = keyFor(holder,topic), origins = new Set();
        check(!keys.has(key),message);
        keys.add(key);
        function checkEvent(source,detail) {
          check(!updates.has(source.event),message);
          updates.add(source.event);
          if (Number(source.event.split('.')[0])===tick) {
            const published = lastEvents.get(source.event);
            check(published?.topic===topic&&equal(published.holder,holder)&&equal(published[detail],source),message);
          }
        }
        let latest;
        for (const account of accounts) {
          check(fields(account,['event','origin','source','value','confidence','via','from'])&&
            inFrame(account.event,tick)&&F.eventId(account.origin)&&holderOK(account.source)&&certainty(account.confidence)&&
            validDetail(schema,field,account.value)&&!origins.has(account.origin)&&(!latest||F.compare(latest,account.event)<0),message);
          if (account.event===account.origin) check(account.via===undefined&&account.from===undefined,message);
          else {
            check(F.eventId(account.via)&&F.compare(account.origin,account.via)<=0&&F.compare(account.via,account.event)<0&&
              holderOK(account.from)&&!sameHolder(account.from,holder),message);
            relays.push({topic,account});
          }
          checkEvent(account,'account');
          origins.add(account.origin);
          receipts.set(account.event,{topic,holder,account});
          latest = account.event;
        }
        if (evidence!==undefined) {
          check(fields(evidence,['event','fact','receipt'])&&inFrame(evidence.event,tick)&&F.eventId(evidence.fact)&&
            validReceipt(evidence.receipt,holder,evidence.fact,schema,field,tick)&&
            F.compare(evidence.receipt.event,evidence.event)<0,message);
          const fact = authoritative.get(evidence.fact), knownRow = known.get(keyFor(holder,evidence.fact));
          check(!fact||fact.type===type&&equal(N.detail(fact,field),evidence.receipt.value),message);
          if (knownRow) {
            const retained = knownRow.details[field];
            check(knownRow.type===type&&(!retained||F.compare(retained.event,evidence.event)>0||
              equal(retained,evidence.receipt)),message);
          }
          checkEvent(evidence,'evidence');
          if (!latest||F.compare(latest,evidence.event)<0) latest = evidence.event;
        }
        check(!previous||F.compare(previous,latest)<0,message);
        previous = latest;
      }
      for (const {topic,account} of relays) {
        const origin = receipts.get(account.origin), sender = receipts.get(account.via);
        for (const source of [origin,sender]) if (source) {
          check(source.topic===topic&&source.account.origin===account.origin&&equal(source.account.source,account.source)&&
            equal(source.account.value,account.value)&&source.account.confidence>=account.confidence,'Invalid saved belief relay');
        }
        if (sender) check(sameHolder(sender.holder,account.from),'Invalid saved belief relay source');
      }
    }
    return {policy,checkAction,begin,validate,initial:()=>freeze({records:[],dropped:0})};
  }

  function inspect(state,policy,tick,args) {
    check(fields(args,['holder','topic','limit'])&&(args.holder===undefined||holderOK(args.holder))&&
      (args.topic===undefined||typeof args.topic==='string'&&id(args.topic))&&integer(args.limit??128,0,4096),
    'Invalid world beliefs filter');
    if (!state||args.topic!==undefined&&!own(policy.topics,args.topic)) return Q.missing('World belief topic is not enabled','missing');
    const {holder,topic,limit=128} = args;
    const matching = state.records.filter(row=>(holder===undefined||sameHolder(holder,row.holder))&&(topic===undefined||topic===row.topic));
    const describe = row=>({...row,...assessment(row)});
    if (holder&&topic) {
      const row = matching[0];
      return Q.ok({tick,holder,topic,status:row?assessment(row).status:'unknown',...(row&&{belief:describe(row)}),dropped:state.dropped});
    }
    return Q.ok({tick,records:matching.slice(0,limit).map(describe),matched:matching.length,dropped:state.dropped});
  }

  W.worldBeliefs = Object.freeze({actions,kind,rejection,eventKinds,compile,inspect});
})(KIT);
