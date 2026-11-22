/* Custody of individual objects, with a continuous chain of world receipts. */
(function(K) {
  const W = K.world, F = W.worldFacts, Q = W.query;
  const {check,record,own,id,equal} = W.data, {freeze} = K.procedural.data;
  const operations = Object.freeze({
    'discover-object':'discover','transfer-object':'transfer','lose-object':'lose','recover-object':'recover','inherit-object':'inherit'
  });
  const actions = Object.freeze(Object.keys(operations)), kinds = ['actor','faction','container','site'];
  const kind = 'custody-changed', rejection = 'custody-rejected';
  const eventKinds = Object.freeze([kind,rejection]);
  const fields = (value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const holderOK = value=>fields(value,['kind','id'])&&kinds.includes(value.kind)&&F.qualified(value.id);
  const tickOf = event=>Number(event.split('.')[0]);
  const latest = row=>row.changes.at(-1)??row.origin;
  const needsFrom = op=>op==='transfer'||op==='inherit'||op==='lose';
  const needsAt = op=>op==='discover'||op==='recover';
  const statusOf = event=>event?.operation==='lose'?'lost':event?'held':'undiscovered';
  const earlier = (id,event)=>F.eventId(id)&&F.compare(id,event)<0;
  const asSource = ({id,tick,kind,system})=>({id,tick,kind,system});
  const sourceOK = (source,event)=>fields(source,['id','tick','kind','system'])&&earlier(source.id,event)&&
    source.tick===tickOf(source.id)&&id(source.kind)&&id(source.system);

  function stepOK(op,{from,to,at}) {
    return (needsFrom(op)?holderOK(from):from===undefined)&&(op==='lose'?to===undefined:holderOK(to))&&
      (needsAt(op)||at!==undefined?F.atOK(at):true)&&!equal(from,to);
  }

  function transition(op,prior,from) {
    if (op==='discover') return prior?'already-discovered':undefined;
    if (!prior) return 'not-discovered';
    if (op==='recover') return prior.operation!=='lose'?'not-lost':undefined;
    if (prior.operation==='lose') return 'object-lost';
    if (!equal(prior.to,from)) return 'holder-mismatch';
  }

  function compile(raw) {
    if (raw===undefined) return null;
    check(fields(raw,['objects','historyLimit'])&&record(raw.objects)&&integer(Object.keys(raw.objects).length,1,1024),
      'World custody needs 1–1024 named objects');
    const {historyLimit=32} = raw;
    check(integer(historyLimit,1,128),'World custody retains 1–128 changes per object');
    const objects = Object.fromEntries(Object.keys(raw.objects).sort().map(object=>{
      const spec = raw.objects[object];
      check(F.qualified(object)&&fields(spec,['label','entity'])&&
        (spec.label===undefined||typeof spec.label==='string'&&spec.label.length>0&&spec.label.length<=256)&&
        (spec.entity===undefined||id(spec.entity)),'Invalid custody object '+object);
      return [object,spec];
    }));
    const policy = freeze({objects,historyLimit});
    const known = object=>typeof object==='string'&&own(objects,object);

    function checkAction(action,args) {
      const op = operations[action];
      check(fields(args,['object','from','to','at','source','previous'])&&known(args.object)&&stepOK(op,args)&&
        (args.source===undefined||F.eventId(args.source))&&
        (args.previous===undefined||op!=='discover'&&F.eventId(args.previous)), 'Invalid '+action+' custody arguments');
    }

    function begin(previous,tick) {
      let rows = previous.records, view = previous;
      function apply(action,args,event,findSource) {
        const {object,from,to,at} = args, operation = operations[action];
        const row = own(rows,object)?rows[object]:undefined, prior = row&&latest(row);
        const rejected = args.previous!==undefined&&args.previous!==prior?.id?'stale-custody':transition(operation,prior,from);
        if (rejected) return {rejected};
        let source;
        if (args.source!==undefined) {
          const receipt = earlier(args.source,event)&&findSource(args.source);
          if (!receipt) return {rejected:'source-unavailable'};
          source = asSource(receipt);
        }
        const change = {id:event,tick,operation,...(prior&&{previous:prior.id}),...(from&&{from}),...(to&&{to}),
          ...(at&&{at}),...(source&&{source})};
        const trim = Number(row?.changes.length===historyLimit);
        const history = row?{...row,changes:[...row.changes.slice(trim),change],dropped:row.dropped+trim}:
          {origin:change,changes:[],dropped:0};
        if (at) history.lastKnown = {event,at};
        rows = {...rows,[object]:history};
        view = undefined;
        return {custody:{object,status:statusOf(change),...change}};
      }
      return {apply,snapshot:()=>view??=freeze({records:rows})};
    }

    function validate(saved,tick,events) {
      check(fields(saved,['records'])&&record(saved.records),'Invalid saved custody ledger');
      const published = new Map(events.filter(event=>event.kind===kind).map(event=>[event.id,event.custody]));
      const used = new Set();
      for (const [object,row] of Object.entries(saved.records)) {
        const message = 'Invalid saved object custody';
        check(known(object)&&fields(row,['origin','changes','dropped','lastKnown'])&&
          Array.isArray(row.changes)&&row.changes.length<=historyLimit&&integer(row.dropped,0,Number.MAX_SAFE_INTEGER)&&
          (!row.dropped||row.changes.length===historyLimit),message);
        function checkReceipt(change) {
          check(fields(change,['id','tick','operation','previous','from','to','at','source'])&&F.eventId(change.id)&&
            integer(change.tick,1,tick)&&change.tick===tickOf(change.id)&&!used.has(change.id)&&
            Object.values(operations).includes(change.operation)&&stepOK(change.operation,change)&&
            (change.source===undefined||sourceOK(change.source,change.id)),message);
          used.add(change.id);
          if (change.tick===tick) check(equal(published.get(change.id),{object,status:statusOf(change),...change}),message);
        }
        const {origin,lastKnown,changes} = row;
        checkReceipt(origin);
        check(origin.operation==='discover'&&origin.previous===undefined,message);
        let prior = origin, seen = origin;
        for (const [i,change] of changes.entries()) {
          checkReceipt(change);
          check(change.operation!=='discover'&&earlier(change.previous,change.id)&&F.compare(prior.id,change.id)<0,message);
          if (!i&&row.dropped) check(F.compare(origin.id,change.previous)<0,message);
          else check(change.previous===prior.id&&!transition(change.operation,prior,change.from),message);
          if (change.at) seen = change;
          prior = change;
        }
        check(fields(lastKnown,['event','at'])&&F.eventId(lastKnown.event)&&F.atOK(lastKnown.at)&&
          F.compare(lastKnown.event,prior.id)<=0,message);
        if (seen!==origin||!row.dropped||lastKnown.event===origin.id)
          check(lastKnown.event===seen.id&&equal(lastKnown.at,seen.at),message);
        else check(F.compare(origin.id,lastKnown.event)<0&&F.compare(lastKnown.event,changes[0].previous)<=0,message);
      }
      check([...published.keys()].every(id=>used.has(id)||
        own(saved.records,published.get(id)?.object)&&saved.records[published.get(id).object].dropped>0&&
        F.compare(id,saved.records[published.get(id).object].changes[0].id)<0),'Missing published custody receipt');
    }
    return {policy,checkAction,begin,validate,initial:()=>freeze({records:{}})};
  }

  function describe(state,policy,object) {
    const row = own(state.records,object)?state.records[object]:undefined;
    if (!row) return {object,...policy.objects[object],status:'undiscovered',dropped:0};
    const current = latest(row);
    return {object,...policy.objects[object],status:statusOf(current),...(current.to&&{holder:current.to}),
      origin:row.origin.id,latest:current.id,lastKnown:row.lastKnown,dropped:row.dropped};
  }

  function inspect(state,policy,tick,args) {
    check(fields(args,['object','holder','status','limit'])&&(args.object===undefined||F.qualified(args.object))&&
      (args.holder===undefined||holderOK(args.holder))&&
      (args.status===undefined||['held','lost','undiscovered'].includes(args.status))&&integer(args.limit??128,0,1024),
    'Invalid object custody filter');
    if (!state) return Q.missing('World custody is not enabled','missing');
    const {object,holder,status,limit=128} = args;
    if (object!==undefined) return own(policy.objects,object)?Q.ok({tick,...describe(state,policy,object)}):
      Q.missing('Unknown custody object','missing');
    const rows = Object.keys(policy.objects).map(object=>describe(state,policy,object)).filter(row=>
      (holder===undefined||equal(holder,row.holder))&&(status===undefined||status===row.status));
    return Q.ok({tick,records:rows.slice(0,limit),matched:rows.length});
  }

  function trace(state,args) {
    check(fields(args,['object','limit'])&&F.qualified(args.object)&&integer(args.limit??128,1,128),
      'Custody trace needs an object ID and optional change limit');
    const {object,limit=128} = args, row = own(state?.records,object)?state.records[object]:undefined;
    if (!row) return Q.missing('Object has no recorded discovery','missing');
    const steps = row.changes.slice(-limit), omitted = row.changes.length-steps.length;
    return Q.ok({object,status:row.dropped||omitted?'partial':'complete',origin:row.origin,
      steps,latest:latest(row).id,dropped:row.dropped,omitted});
  }

  W.worldCustody = Object.freeze({actions,kind,rejection,eventKinds,compile,inspect,trace});
})(KIT);
