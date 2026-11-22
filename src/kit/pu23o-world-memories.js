/* Significant experiences and the directed relationships they influence. */
(function(K) {
  const W = K.world, Q = W.query, F = W.worldFacts, {holderOK,sameHolder} = W.worldKnowledge;
  const {check,record,own,equal,id} = W.data, {freeze} = K.procedural.data;
  const action = 'remember', kind = 'memory-recorded', rejection = 'memory-rejected';
  const eventKinds = Object.freeze([kind,rejection]);
  const fields = (value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const tickOf = event=>Number(event.split('.')[0]);
  const nextExpiry = rows=>rows.reduce((next,row)=>next===null?row.expires:Math.min(next,row.expires),null);

  function compile(raw) {
    if (raw===undefined) return null;
    check(fields(raw,['types','limit','durableLimit'])&&record(raw.types)&&
      integer(Object.keys(raw.types).length,1,128),'World memories need 1–128 named types');
    const {limit=512,durableLimit=128} = raw;
    check(integer(limit,1,4096)&&integer(durableLimit,1,4096),'World memory retention limits must be 1–4096');
    const axes = new Set();
    const types = Object.fromEntries(Object.entries(raw.types).map(([type,spec])=>{
      check(id(type)&&fields(spec,['durable','decayTicks','effects','data']),'Invalid world memory type '+type);
      const {durable=false,decayTicks=600,effects={},data={}} = spec;
      check(typeof durable==='boolean'&&(durable?spec.decayTicks===undefined:integer(decayTicks,1,W.runtime.maxTick)),
        'Invalid memory decay for '+type);
      check(record(effects)&&Object.keys(effects).length<=16&&Object.entries(effects).every(([axis,delta])=>
        id(axis)&&integer(delta,-100,100)&&delta!==0),'Invalid memory relationship effects for '+type);
      check(record(data)&&Object.keys(data).length<=16&&Object.entries(data).every(([key,shape])=>
        id(key)&&F.valueTypes.includes(shape)),'Invalid memory data schema for '+type);
      for (const axis of Object.keys(effects)) axes.add(axis);
      return [type,{durable,...(!durable&&{decayTicks}),effects,data}];
    }));
    check(axes.size<=64,'World memories support up to 64 relationship axes');
    const policy = freeze({types,limit,durableLimit,axes:[...axes].sort()});

    function checkAction(args) {
      check(fields(args,['holder','about','type','data','source'])&&holderOK(args.holder)&&
        (args.about===undefined||holderOK(args.about))&&typeof args.type==='string'&&own(types,args.type)&&
        (args.source===undefined||F.eventId(args.source)), 'A memory needs a registered type, holder, and optional subject or source event');
      const spec = types[args.type], data = args.data??{};
      check(!Object.keys(spec.effects).length||args.about!==undefined,'Relationship memories need a subject');
      check(record(data)&&args.data!==null&&Object.keys(data).length===Object.keys(spec.data).length&&
        Object.entries(spec.data).every(([key,shape])=>own(data,key)&&F.valueOK(shape,data[key])),
      'Invalid memory data for '+args.type);
    }

    function begin(previous,tick) {
      let view = previous, {fading,durable,expired,evicted} = previous;
      if (previous.nextExpiry!==null&&previous.nextExpiry<=tick) {
        fading = fading.filter(row=>row.expires>tick);
        expired += previous.fading.length-fading.length;
        view = undefined;
      }
      function remember(args,event) {
        const {type,holder,about,data={},source} = args, spec = types[type];
        if (source!==undefined&&F.compare(source,event)>=0) return {rejected:'source-not-earlier'};
        const retained = spec.durable?durable:fading;
        if (source!==undefined&&retained.some(row=>row.source===source&&row.type===type&&sameHolder(row.holder,holder)&&
          equal(row.about,about))) return {};
        if (spec.durable&&durable.length===durableLimit) return {rejected:'durable-capacity'};
        const memory = {id:event,tick,type,holder,...(about&&{about}),data,...(source&&{source}),
          ...(spec.durable?{durable:true}:{durable:false,expires:tick+spec.decayTicks})};
        if (spec.durable) durable = [...durable,memory];
        else {
          if (fading.length===limit) evicted++;
          fading = [...fading.slice(fading.length===limit?1:0),memory];
        }
        view = undefined;
        return {memory};
      }
      return {remember,snapshot:()=>view??=freeze({fading,durable,expired,evicted,nextExpiry:nextExpiry(fading)})};
    }

    function validate(saved,tick,events) {
      check(fields(saved,['fading','durable','expired','evicted','nextExpiry'])&&Array.isArray(saved.fading)&&
        saved.fading.length<=limit&&Array.isArray(saved.durable)&&saved.durable.length<=durableLimit&&
        integer(saved.expired,0,Number.MAX_SAFE_INTEGER)&&integer(saved.evicted,0,Number.MAX_SAFE_INTEGER),
      'Invalid saved world memory ledger');
      const seen = new Set(), sourced = new Set();
      const recent = new Map(events.filter(event=>event?.kind===kind).map(event=>[event.id,event.memory]));
      for (const partition of ['fading','durable']) {
        let previous;
        for (const row of saved[partition]) {
          const message = 'Invalid saved world memory';
          check(fields(row,['id','tick','type','holder','about','data','source','durable','expires'])&&F.eventId(row.id)&&
            integer(row.tick,1,tick)&&row.tick===tickOf(row.id)&&!seen.has(row.id)&&
            (!previous||F.compare(previous,row.id)<0)&&record(row.data),message);
          const {type,holder,about,data,source} = row;
          checkAction({type,holder,about,data,source});
          const spec = types[type];
          check(row.durable===spec.durable&&row.durable===(partition==='durable')&&
            (row.durable?row.expires===undefined:row.expires===row.tick+spec.decayTicks&&row.expires>tick),message);
          if (source!==undefined) {
            const key = JSON.stringify([source,type,holder.kind,holder.id,about?.kind,about?.id]);
            check(F.compare(source,row.id)<0&&!sourced.has(key),message);
            sourced.add(key);
          }
          if (row.tick===tick) check(equal(recent.get(row.id),row),message);
          seen.add(row.id);
          previous = row.id;
        }
      }
      check(saved.nextExpiry===nextExpiry(saved.fading),'Invalid saved memory expiry');
    }

    return {policy,checkAction,begin,validate,initial:()=>freeze({fading:[],durable:[],expired:0,evicted:0,nextExpiry:null})};
  }

  function describe(row,tick,policy) {
    const {effects,decayTicks} = policy.types[row.type], remaining = row.expires-tick;
    const strength = row.durable?100:Math.ceil(100*remaining/decayTicks);
    const current = row.durable?effects:Object.fromEntries(Object.entries(effects).map(([axis,delta])=>
      [axis,Math.trunc(delta*remaining/decayTicks)||0]));
    return {...row,strength,effects:current};
  }

  function matching(state,holder,about,type,event) {
    return [...state.fading,...state.durable].filter(row=>(holder===undefined||sameHolder(row.holder,holder))&&
      (about===undefined||row.about&&sameHolder(row.about,about))&&(type===undefined||row.type===type)&&
      (event===undefined||row.id===event)).sort((a,b)=>F.compare(a.id,b.id));
  }

  function inspect(state,policy,tick,args) {
    const {holder,about,type,id:event,limit=128} = args;
    check(fields(args,['holder','about','type','id','limit'])&&(holder===undefined||holderOK(holder))&&
      (about===undefined||holderOK(about))&&(type===undefined||id(type))&&(event===undefined||F.eventId(event))&&
      integer(limit,0,8192),'Invalid world memory filter');
    if (!state) return Q.missing('World memories are not enabled','missing');
    const rows = matching(state,holder,about,type,event);
    return Q.ok({tick,records:rows.slice(0,limit).map(row=>describe(row,tick,policy)),matched:rows.length,
      evicted:state.evicted,expired:state.expired});
  }

  function relationship(state,policy,tick,args) {
    check(fields(args,['holder','with'])&&holderOK(args.holder)&&holderOK(args.with),'Relationship needs a holder and counterpart');
    if (!state) return Q.missing('World memories are not enabled','missing');
    const {holder,with:counterpart} = args, scores = Object.fromEntries(policy.axes.map(axis=>[axis,0]));
    const contributors = [];
    for (const row of matching(state,holder,counterpart)) {
      const {effects} = describe(row,tick,policy), entries = Object.entries(effects);
      if (!entries.length) continue;
      for (const [axis,delta] of entries) scores[axis] += delta;
      contributors.push({id:row.id,type:row.type,effects});
    }
    return Q.ok({tick,holder,with:counterpart,status:contributors.length?'known':'unknown',scores,contributors});
  }

  W.worldMemories = Object.freeze({action,kind,rejection,eventKinds,compile,inspect,relationship});
})(KIT);
