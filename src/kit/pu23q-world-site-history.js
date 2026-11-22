/* Visits and enduring consequences for stable, authored places. */
(function(K) {
  const W = K.world, F = W.worldFacts, Q = W.query, {holderOK,sameHolder} = W.worldKnowledge;
  const {check,record,own,id,equal} = W.data, {freeze} = K.procedural.data;
  const visitAction = 'visit-site', changeAction = 'change-site', rejection = 'site-history-rejected';
  const actions = Object.freeze([visitAction,changeAction]);
  const eventKinds = Object.freeze(['site-visited','site-changed',rejection]);
  const fields = (value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const countOK = value=>integer(value,0,Number.MAX_SAFE_INTEGER);
  const earlier = (value,event)=>F.eventId(value)&&F.compare(value,event)<0;
  const sourceOK = (source,event)=>F.eventReceiptOK(source)&&earlier(source.id,event);
  const eventKind = row=>row.operation==='visit'?'site-visited':'site-changed';
  const landmark = ({id,tick,visitor})=>({id,tick,visitor});
  const consequence = ({id,tick,outcome,source,visit},value)=>({value,id,tick,outcome,...(source&&{source}),...(visit&&{visit})});
  const empty = freeze({visits:0,visitors:[],visitorEvictions:0,history:[],dropped:0,consequences:{}});
  const valueAt = (row,spec,name)=>own(row.consequences,name)?row.consequences[name].value:
    own(spec.initial,name)?spec.initial[name]:undefined;

  function validateValues(value,schema) {
    return record(value)&&Object.entries(value).every(([name,sample])=>own(schema,name)&&F.valueOK(schema[name],sample));
  }
  function visitRefOK(ref,before) {
    return fields(ref,['id','tick','visitor'])&&earlier(ref.id,before)&&ref.tick===F.eventTick(ref.id)&&holderOK(ref.visitor);
  }

  function compile(raw) {
    if (raw===undefined) return null;
    check(fields(raw,['sites','historyLimit','visitorLimit'])&&record(raw.sites)&&integer(Object.keys(raw.sites).length,1,1024),
      'Persistent site history needs 1–1024 named sites');
    const {historyLimit=32,visitorLimit=64} = raw;
    check(integer(historyLimit,1,128)&&integer(visitorLimit,1,256),'Invalid site history or visitor retention limit');
    const sites = Object.fromEntries(Object.keys(raw.sites).sort().map(site=>{
      const spec = raw.sites[site];
      check(F.qualified(site)&&fields(spec,['kind','label','at','fields','initial'])&&id(spec.kind)&&
        (spec.label===undefined||typeof spec.label==='string'&&integer(spec.label.length,1,256)),'Invalid site '+site);
      const {at={place:site},fields:schema={},initial={}} = spec;
      check(F.atOK(at)&&record(schema)&&Object.keys(schema).length<=32&&Object.entries(schema).every(([key,shape])=>
        id(key)&&F.valueTypes.includes(shape))&&validateValues(initial,schema),'Invalid site location or state schema for '+site);
      return [site,{kind:spec.kind,...(spec.label&&{label:spec.label}),at,fields:schema,initial}];
    }));
    const policy = freeze({sites,historyLimit,visitorLimit});
    const known = site=>typeof site==='string'&&own(sites,site);

    function checkAction(action,args) {
      const visit = action===visitAction;
      check(fields(args,visit?['site','visitor','source']:['site','set','outcome','visit','source','expect'])&&known(args.site)&&
        (args.source===undefined||F.eventId(args.source)),'Invalid site history action '+action);
      if (visit) check(holderOK(args.visitor),'A site visit needs an actor or faction');
      else {
        const schema = sites[args.site].fields;
        check(id(args.outcome)&&validateValues(args.set,schema)&&Object.keys(args.set).length>0&&
          (args.expect===undefined||validateValues(args.expect,schema))&&(args.visit===undefined||F.eventId(args.visit)),
        'A site change needs a named outcome and typed state changes');
      }
    }

    function begin(previous,tick) {
      let rows = previous.records, view = previous;
      function apply(action,args,event,findSource) {
        const {site} = args, prior = own(rows,site)?rows[site]:empty;
        let source;
        if (args.source!==undefined) {
          const found = earlier(args.source,event)&&findSource(args.source);
          if (!found) return {rejected:'source-unavailable'};
          source = F.eventReceipt(found);
        }
        const root = {id:event,tick,...(source&&{source})}, next = {...prior};
        let entry;
        if (action===visitAction) {
          const visitor = args.visitor, remembered = prior.visitors.find(row=>sameHolder(row.visitor,visitor));
          const evict = !remembered&&prior.visitors.length===visitorLimit;
          const first = remembered?.first??event, count = (remembered?.count??0)+1;
          next.visits++;
          next.visitors = [...prior.visitors.filter(row=>row!==remembered).slice(Number(evict)),
            {visitor,count,first,last:event}];
          next.visitorEvictions += Number(evict);
          entry = {...root,operation:'visit',visitor,visitNumber:next.visits,visitorCount:count,
            ...(remembered&&{previous:remembered.last})};
        } else {
          if (Object.entries(args.expect??{}).some(([key,value])=>!equal(value,valueAt(prior,sites[site],key))))
            return {rejected:'state-mismatch'};
          let visit;
          if (args.visit!==undefined) {
            const retained = prior.history.find(row=>row.operation==='visit'&&row.id===args.visit);
            const remembered = prior.visitors.find(row=>row.first===args.visit||row.last===args.visit);
            if (!retained&&!remembered) return {rejected:'visit-unavailable'};
            visit = retained?landmark(retained):{id:args.visit,tick:F.eventTick(args.visit),visitor:remembered.visitor};
          }
          entry = {...root,operation:'change',outcome:args.outcome,set:args.set,...(visit&&{visit})};
          next.consequences = {...prior.consequences,...Object.fromEntries(Object.entries(args.set).map(([key,value])=>
            [key,consequence(entry,value)]))};
        }
        const trim = Number(prior.history.length===historyLimit);
        next.history = [...prior.history.slice(trim),entry];
        next.dropped += trim;
        rows = {...rows,[site]:next};
        view = undefined;
        return {kind:eventKind(entry),detail:{site,[entry.operation]:entry}};
      }
      return {apply,snapshot:()=>view??=freeze({records:rows})};
    }

    function validate(saved,tick,events) {
      check(fields(saved,['records'])&&record(saved.records),'Invalid saved site history ledger');
      const published = new Map(events.filter(row=>row.kind==='site-visited'||row.kind==='site-changed').map(row=>[row.id,row]));
      const seen = new Set();
      for (const [site,row] of Object.entries(saved.records)) {
        const message = 'Invalid saved site history', spec = known(site)?sites[site]:undefined;
        check(spec&&fields(row,['visits','visitors','visitorEvictions','history','dropped','consequences'])&&countOK(row.visits)&&
          countOK(row.dropped)&&Array.isArray(row.history)&&integer(row.history.length,1,historyLimit)&&
          (!row.dropped||row.history.length===historyLimit)&&row.visits<=row.dropped+row.history.length&&
          Array.isArray(row.visitors)&&row.visitors.length<=visitorLimit&&countOK(row.visitorEvictions)&&
          row.visitors.length+row.visitorEvictions<=row.visits&&(!row.visitorEvictions||row.visitors.length===visitorLimit)&&
          record(row.consequences),message);
        const indexed = new Map(), latest = new Map(), latestVisits = new Map();
        const holderKey = visitor=>visitor.kind+'#'+visitor.id;
        let prior, ordinal;
        for (const entry of row.history) {
          check(record(entry)&&F.eventId(entry.id)&&integer(entry.tick,1,tick)&&entry.tick===F.eventTick(entry.id)&&
            !seen.has(entry.id)&&(!prior||F.compare(prior,entry.id)<0)&&(entry.source===undefined||sourceOK(entry.source,entry.id)),message);
          if (entry.operation==='visit') {
            check(fields(entry,['id','tick','source','operation','visitor','visitNumber','visitorCount','previous'])&&holderOK(entry.visitor)&&
              integer(entry.visitNumber,1,row.visits)&&integer(entry.visitorCount,1,entry.visitNumber)&&
              (ordinal===undefined?(row.dropped>0||entry.visitNumber===1):entry.visitNumber===ordinal+1)&&
              (entry.visitorCount===1?entry.previous===undefined:earlier(entry.previous,entry.id)),message);
            const last = latestVisits.get(holderKey(entry.visitor));
            if (entry.previous!==undefined&&(last||!row.dropped))
              check(last?.id===entry.previous&&entry.visitorCount===last.visitorCount+1,message);
            latestVisits.set(holderKey(entry.visitor),entry);
            ordinal = entry.visitNumber;
          } else {
            check(entry.operation==='change'&&fields(entry,['id','tick','source','operation','outcome','set','visit'])&&id(entry.outcome)&&
              validateValues(entry.set,spec.fields)&&Object.keys(entry.set).length>0,message);
            if (entry.visit!==undefined) {
              check(visitRefOK(entry.visit,entry.id),message);
              const visit = indexed.get(entry.visit.id);
              check(visit?visit.operation==='visit'&&equal(landmark(visit),entry.visit):
                row.dropped>0&&F.compare(entry.visit.id,row.history[0].id)<0,message);
            }
            for (const [key,value] of Object.entries(entry.set)) latest.set(key,consequence(entry,value));
          }
          const publishedRow = published.get(entry.id);
          if (entry.tick===tick) check(publishedRow?.kind===eventKind(entry)&&publishedRow.site===site&&
            equal(publishedRow[entry.operation],entry),message);
          indexed.set(entry.id,entry);
          seen.add(entry.id);
          prior = entry.id;
        }
        check(ordinal===undefined?row.dropped>0||row.visits===0:ordinal===row.visits,message);
        check([...latest.keys()].every(key=>own(row.consequences,key)),message);
        for (const [key,value] of Object.entries(row.consequences)) {
          check(fields(value,['value','id','tick','outcome','source','visit'])&&own(spec.fields,key)&&
            F.valueOK(spec.fields[key],value.value)&&F.eventId(value.id)&&value.tick===F.eventTick(value.id)&&id(value.outcome)&&
            (value.source===undefined||sourceOK(value.source,value.id))&&(value.visit===undefined||visitRefOK(value.visit,value.id))&&
            (latest.has(key)?equal(latest.get(key),value):row.dropped>0&&F.compare(value.id,row.history[0].id)<0),message);
        }
        const visitors = new Set();
        let lastVisit;
        for (const stats of row.visitors) {
          check(fields(stats,['visitor','count','first','last'])&&holderOK(stats.visitor)&&integer(stats.count,1,row.visits)&&
            F.eventId(stats.first)&&F.eventId(stats.last)&&F.compare(stats.last,prior)<=0&&
            (stats.count===1?stats.first===stats.last:F.compare(stats.first,stats.last)<0)&&
            (lastVisit===undefined||F.compare(lastVisit,stats.last)<0),message);
          const key = holderKey(stats.visitor), last = latestVisits.get(key);
          check(!visitors.has(key)&&(last?last.id===stats.last&&last.visitorCount===stats.count:
            row.dropped>0&&F.compare(stats.last,row.history[0].id)<0),message);
          visitors.add(key);
          lastVisit = stats.last;
        }
        check([...latestVisits.keys()].every(key=>visitors.has(key)||row.visitorEvictions>0),message);
      }
      for (const [id,event] of published) {
        const row = own(saved.records,event.site)?saved.records[event.site]:undefined;
        check(seen.has(id)||row&&row.dropped>0&&F.compare(id,row.history[0].id)<0,'Missing published site history receipt');
      }
    }
    return {policy,checkAction,begin,validate,initial:()=>freeze({records:{}})};
  }

  function describe(state,spec,site,visitor) {
    const row = own(state.records,site)?state.records[site]:empty, {kind,label,at,initial} = spec;
    const current = {...initial,...Object.fromEntries(Object.entries(row.consequences).map(([key,entry])=>[key,entry.value]))};
    const stats = visitor&&row.visitors.find(entry=>sameHolder(visitor,entry.visitor));
    return {site,kind,...(label&&{label}),at,state:current,consequences:row.consequences,visits:row.visits,
      ...(visitor&&{visitor:{holder:visitor,status:stats?'tracked':row.visitorEvictions?'untracked':'unseen',
        ...(stats&&{count:stats.count,first:stats.first,last:stats.last})}}),
      ...(row.history.length&&{latest:row.history.at(-1).id}),dropped:row.dropped,visitorEvictions:row.visitorEvictions};
  }

  function inspect(state,policy,tick,args) {
    check(fields(args,['site','kind','visitor','limit'])&&(args.site===undefined||F.qualified(args.site))&&
      (args.kind===undefined||id(args.kind))&&(args.visitor===undefined||holderOK(args.visitor))&&
      integer(args.limit??128,0,1024),'Invalid site history query');
    if (!state) return Q.missing('Site history is not enabled','missing');
    const {site,kind,visitor,limit=128} = args;
    if (site!==undefined) return own(policy.sites,site)?Q.ok({tick,...describe(state,policy.sites[site],site,visitor)}):
      Q.missing('Unknown site','missing');
    const sites = Object.keys(policy.sites).filter(key=>kind===undefined||policy.sites[key].kind===kind);
    return Q.ok({tick,records:sites.slice(0,limit).map(key=>describe(state,policy.sites[key],key,visitor)),matched:sites.length});
  }

  function trace(state,policy,args) {
    check(fields(args,['site','limit'])&&F.qualified(args.site)&&integer(args.limit??128,1,128),'Site history trace needs a site ID');
    const {site,limit=128} = args;
    if (!state||!own(policy.sites,site)) return Q.missing('Unknown site','missing');
    const row = own(state.records,site)?state.records[site]:empty, entries = row.history.slice(-limit);
    const omitted = row.history.length-entries.length;
    return Q.ok({site,status:row.dropped||omitted?'partial':'complete',entries,dropped:row.dropped,omitted});
  }

  W.worldSiteHistory = Object.freeze({actions,eventKinds,rejection,compile,inspect,trace});
})(KIT);
