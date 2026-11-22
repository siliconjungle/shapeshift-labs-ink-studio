/* Holder-local observations and reports about typed world facts. */
(function(K) {
  const W = K.world, Q = W.query, F = W.worldFacts, {check,record,own,equal} = W.data, {freeze} = K.procedural.data;
  const action = 'share-fact', kind = 'fact-learned';
  const kinds = ['actor','faction'];
  const fields = (value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const holderOK = value=>fields(value,['kind','id'])&&kinds.includes(value.kind)&&F.qualified(value.id);
  const keyFor = (holder,fact)=>holder.kind+'/'+holder.id+'#'+fact;
  const sameHolder = (a,b)=>a.kind===b.kind&&a.id===b.id;
  const available = schema=>['at',...Object.keys(schema.subjects).map(key=>'subject/'+key),
    ...Object.keys(schema.fields).map(key=>'data/'+key)];
  const tokensOK = list=>Array.isArray(list)&&integer(list.length,1,49)&&new Set(list).size===list.length&&
    Array.from(list).every(field=>field==='at'||typeof field==='string'&&/^(subject|data)\//.test(field)&&W.data.id(field.split('/')[1])&&
      field.split('/').length===2);
  const receiptKey = (event,field)=>event+'#'+field;
  const learned = (entry,event)=>({
    holder:entry.holder,fact:entry.fact,type:entry.type,...event
  });

  function detail(fact,field) {
    if (field==='at') return fact.at;
    const [group,name] = field.split('/');
    return group==='subject'?fact.subjects[name]:fact.data[name];
  }

  function validDetail(schema,field,value) {
    if (field==='at') return F.atOK(value);
    const [group,name] = field.split('/');
    return group==='subject'?fields(value,['kind','id'])&&value.kind===schema.subjects[name]&&F.qualified(value.id):
      F.valueOK(schema.fields[name],value);
  }

  function compile(raw,factPolicy) {
    if (raw===undefined) return null;
    check(factPolicy,'World knowledge requires typed world facts');
    check(raw===true||fields(raw,['limit']),'World knowledge needs true or a retention policy');
    const limit = raw.limit??512, schemas = factPolicy.types;
    check(integer(limit,1,4096),'World knowledge retains 1–4096 holder/fact entries');
    const policy = freeze({limit,fields:Object.fromEntries(Object.entries(schemas).map(([type,schema])=>[type,available(schema)]))});
    function checkWitnesses(type,list) {
      check(Array.isArray(list)&&list.length<=16,'World fact witnesses need up to 16 holders');
      const seen = new Set();
      for (const row of list) {
        check(fields(row,['holder','fields'])&&holderOK(row.holder)&&
          (row.fields===undefined||tokensOK(row.fields)&&row.fields.every(field=>policy.fields[type].includes(field))),
        'Invalid witness or observed fields for world fact '+type);
        const key = keyFor(row.holder,'');
        check(!seen.has(key),'Duplicate world fact witness '+row.holder.id);
        seen.add(key);
      }
    }

    function checkAction(args) {
      check(fields(args,['fact','from','to','fields'])&&F.eventId(args.fact)&&holderOK(args.from)&&holderOK(args.to)&&
        !sameHolder(args.from,args.to)&&(args.fields===undefined||tokensOK(args.fields)),
      'Fact sharing needs a fact ID, two distinct holders, and optional disclosure fields');
    }

    function begin(previous,tick) {
      let rows, dropped = previous.dropped, view = previous;
      const index = ()=>rows??=new Map(previous.records.map(row=>[keyFor(row.holder,row.fact),row]));
      function grant(fact,type,holder,disclosure,id,{mode,from,values}) {
        const key = keyFor(holder,fact), prior = index().get(key);
        const details = {...prior?.details}, introduced = disclosure.filter(field=>!own(details,field));
        if (!introduced.length) return null;
        const via = {};
        for (const field of introduced) {
          const hint = values(field);
          via[field] = hint.via;
          details[field] = {value:hint.value,event:id,tick,mode,via:hint.via,...(from&&{from})};
        }
        const row = {holder,fact,type,details};
        rows.delete(key);
        rows.set(key,row);
        view = undefined;
        if (rows.size>limit) {
          rows.delete(rows.keys().next().value);
          dropped++;
        }
        return learned(row,{mode,...(from&&{from}),fields:introduced,via});
      }
      function witness(fact,{holder,fields},id) {
        return grant(fact.id,fact.type,holder,fields??policy.fields[fact.type],id,
          {mode:'witness',values:field=>({value:detail(fact,field),via:fact.id})});
      }
      function share({fact,from,to,fields},id) {
        const prior = index().get(keyFor(from,fact));
        if (!prior) return {rejected:'source-unaware'};
        const disclosure = fields??Object.keys(prior.details);
        const missing = disclosure.filter(field=>!own(prior.details,field));
        if (missing.length) return {rejected:'source-lacks-details',missing};
        return {learning:grant(fact,prior.type,to,disclosure,id,{mode:'report',from,
          values:field=>({value:prior.details[field].value,via:prior.details[field].event})})};
      }
      const snapshot = ()=>view??=freeze({records:[...rows.values()],dropped});
      return {witness,share,snapshot};
    }

    function validate(saved,tick,facts,events) {
      check(fields(saved,['records','dropped'])&&Array.isArray(saved.records)&&saved.records.length<=limit&&
        integer(saved.dropped,0,Number.MAX_SAFE_INTEGER)&&(!saved.dropped||saved.records.length===limit),
      'Invalid saved knowledge ledger');
      const authoritative = new Map(facts.records.map(fact=>[fact.id,fact]));
      const lastEvents = new Map(events.filter(event=>event?.kind===kind).map(event=>[event.id,event]));
      const holders = new Set(), receipts = new Map(), links = [];
      let previous;
      for (const row of saved.records) {
        const message = 'Invalid saved knowledge record';
        check(fields(row,['holder','fact','type','details'])&&holderOK(row.holder)&&F.eventId(row.fact)&&
          typeof row.type==='string'&&own(schemas,row.type)&&record(row.details)&&
          Object.keys(row.details).length>0&&Object.keys(row.details).every(field=>policy.fields[row.type].includes(field)),message);
        const key = keyFor(row.holder,row.fact), fact = authoritative.get(row.fact);
        check(!holders.has(key)&&(!fact||fact.type===row.type),message);
        holders.add(key);
        let latest;
        for (const [field,receipt] of Object.entries(row.details)) {
          check(fields(receipt,['value','event','tick','mode','via','from'])&&validDetail(schemas[row.type],field,receipt.value)&&
            F.eventId(receipt.event)&&F.eventId(receipt.via)&&integer(receipt.tick,1,tick)&&
            Number(receipt.event.split('.')[0])===receipt.tick&&F.compare(row.fact,receipt.event)<0&&
            F.compare(receipt.via,receipt.event)<0&&(!fact||equal(detail(fact,field),receipt.value)),message);
          if (receipt.mode==='witness')
            check(receipt.from===undefined&&receipt.via===row.fact&&row.fact.split('.')[0]===receipt.event.split('.')[0],message);
          else {
            check(receipt.mode==='report'&&holderOK(receipt.from)&&!sameHolder(receipt.from,row.holder)&&
              F.compare(row.fact,receipt.via)<0,message);
            links.push({row,field,receipt});
          }
          const indexed = receiptKey(receipt.event,field), event = lastEvents.get(receipt.event);
          check(!receipts.has(indexed),message);
          if (receipt.tick===tick) check(record(event?.learning)&&Array.isArray(event.learning.fields)&&record(event.learning.via)&&
            equal(event.learning.holder,row.holder)&&event.learning.fact===row.fact&&
            event.learning.type===row.type&&event.learning.mode===receipt.mode&&equal(event.learning.from,receipt.from)&&
            event.learning.fields.includes(field)&&event.learning.via[field]===receipt.via,message);
          receipts.set(indexed,{row,receipt});
          if (!latest||F.compare(latest,receipt.event)<0) latest = receipt.event;
        }
        check(!previous||F.compare(previous,latest)<0,message);
        previous = latest;
      }
      for (const {row,field,receipt} of links) {
        const source = receipts.get(receiptKey(receipt.via,field));
        if (source) check(source.row.fact===row.fact&&source.row.type===row.type&&sameHolder(source.row.holder,receipt.from)&&
          equal(source.receipt.value,receipt.value),'Invalid saved knowledge report source');
      }
    }

    return {policy,checkWitnesses,checkAction,begin,validate,initial:()=>freeze({records:[],dropped:0})};
  }

  function describe(row,policy) {
    const {holder,fact,type,details} = row, missing = policy.fields[type].filter(field=>!own(details,field));
    const modes = new Set(Object.values(details).map(receipt=>receipt.mode));
    const subjects = {}, data = {}, receipts = {};
    for (const [field,{value,...receipt}] of Object.entries(details)) {
      receipts[field] = receipt;
      if (field==='at') continue;
      const [group,name] = field.split('/');
      (group==='subject'?subjects:data)[name] = value;
    }
    return {holder,fact,type,status:missing.length?'partial':'complete',origin:modes.size>1?'mixed':modes.has('witness')?'witness':'secondhand',
      ...(details.at&&{at:details.at.value}),subjects,data,missing,receipts};
  }

  function inspect(state,policy,tick,args) {
    check(fields(args,['holder','fact','type','limit'])&&(args.holder===undefined||holderOK(args.holder))&&
      (args.fact===undefined||F.eventId(args.fact))&&(args.type===undefined||typeof args.type==='string'&&W.data.id(args.type))&&
      integer(args.limit??128,0,4096),'Invalid world knowledge filter');
    if (!state) return Q.missing('World knowledge is not enabled','missing');
    const {holder,fact,type,limit=128} = args;
    const matching = state.records.filter(row=>(holder===undefined||sameHolder(holder,row.holder))&&
      (fact===undefined||fact===row.fact)&&(type===undefined||type===row.type));
    if (holder&&fact) {
      const knowledge = matching[0]&&describe(matching[0],policy);
      return Q.ok({tick,holder,fact,status:knowledge?.status??'unknown',...(knowledge&&{knowledge}),dropped:state.dropped});
    }
    return Q.ok({tick,records:matching.slice(0,limit).map(row=>describe(row,policy)),matched:matching.length,dropped:state.dropped});
  }

  function trace(state,args) {
    check(fields(args,['holder','fact','field','limit'])&&holderOK(args.holder)&&F.eventId(args.fact)&&
      tokensOK([args.field])&&integer(args.limit??32,1,128),'Knowledge lineage needs a holder, fact ID and detail field');
    const {holder,fact,field,limit=32} = args;
    const rows = state?.records.filter(row=>row.fact===fact&&own(row.details,field))??[];
    const root = rows.find(row=>sameHolder(holder,row.holder));
    if (!root) return Q.missing('Holder has no retained knowledge of that detail','missing');
    const byId = new Map(rows.map(row=>[row.details[field].event,row]));
    const steps = [];
    let row = root, gap;
    while (row) {
      const {value,...receipt} = row.details[field];
      steps.push({holder:row.holder,...receipt});
      if (receipt.mode==='witness') break;
      row = byId.get(receipt.via);
      if (!row||steps.length===limit) {
        gap = {event:receipt.via,holder:receipt.from,reason:row?'limit':'knowledge-retention'};
        break;
      }
    }
    return Q.ok({fact,field,status:gap?'partial':'complete',value:root.details[field].value,steps,...(gap&&{gap})});
  }

  W.worldKnowledge = Object.freeze({action,kind,compile,inspect,trace});
})(KIT);
