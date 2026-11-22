/* Typed occurrences with direct links to previously published world events. */
(function(K) {
  const W = K.world, Q = W.query, {check,record,own,id,vector,equal} = W.data, {freeze} = K.procedural.data;
  const action = 'fact', kind = 'world-fact';
  const qualified = value => typeof value==='string'&&value.length<=512&&value.split('/').every(id);
  const eventId = value => typeof value==='string'&&/^[1-9]\d{0,7}\.(0|[1-9]\d{0,3})$/.test(value);
  const fields = (value,keys) => record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const integer = (value,min,max) => Number.isSafeInteger(value)&&value>=min&&value<=max;
  const compare = (a,b) => {
    const [ta,ia] = a.split('.').map(Number), [tb,ib] = b.split('.').map(Number);
    return ta-tb||ia-ib;
  };
  const point = value=>vector(value)&&Array.from(value).every(Number.isFinite);
  const types = Object.freeze({number:Number.isFinite,integer:Number.isSafeInteger,boolean:value=>typeof value==='boolean',
    string:value=>typeof value==='string'&&value.length<=1024,id:qualified,point});
  const atOK = value => fields(value,['place','entity','point','socket'])&&
    (own(value,'place')||own(value,'entity')||own(value,'point'))&&
    (!own(value,'place')||qualified(value.place))&&(!own(value,'entity')||id(value.entity))&&
    (!own(value,'point')||point(value.point))&&(!own(value,'socket')||id(value.socket)&&own(value,'entity'));
  const namesMatch = (value,spec) => record(value)&&Object.keys(value).length===Object.keys(spec).length&&
    Object.keys(spec).every(key=>own(value,key));
  const factSummary = fact => ({id:fact.id,tick:fact.tick,system:'world',kind,factType:fact.type});

  function compile(raw,dt) {
    if (raw===undefined) return null;
    check(fields(raw,['types','limit','eventLimit'])&&record(raw.types)&&integer(Object.keys(raw.types).length,1,128),
      'World facts need a table of 1–128 fact types');
    const {limit=256,eventLimit=2048} = raw;
    check(integer(limit,1,4096)&&integer(eventLimit,1,20000),'Fact retention needs 1–4096 facts and 1–20000 event receipts');
    const schemas = freeze(Object.fromEntries(Object.keys(raw.types).sort().map(type=>{
      const spec = raw.types[type];
      check(id(type)&&fields(spec,['subjects','fields']),'Invalid world fact type '+type);
      const {subjects={},fields:attributes={}} = spec;
      check(record(subjects)&&Object.keys(subjects).length<=16&&Object.entries(subjects).every(([role,domain])=>id(role)&&id(domain)),
        'Invalid subject roles for world fact '+type);
      check(record(attributes)&&Object.keys(attributes).length<=32&&Object.entries(attributes).every(([name,shape])=>
        id(name)&&typeof shape==='string'&&own(types,shape)),
        'Invalid data fields for world fact '+type);
      const sorted = value=>Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]]));
      return [type,{subjects:sorted(subjects),fields:sorted(attributes)}];
    })));

    function valuesOK(data,schema) {
      return namesMatch(data,schema.fields)&&Object.entries(schema.fields).every(([key,shape])=>types[shape](data[key]));
    }

    function checkAction(args) {
      check(fields(args,['type','at','subjects','data','causes','witnesses'])&&typeof args.type==='string'&&own(schemas,args.type)&&atOK(args.at),
        'A world fact needs a registered type and a place, entity, or point');
      const schema = schemas[args.type], {subjects={},data={},causes=[]} = args;
      check(namesMatch(subjects,schema.subjects)&&Object.values(subjects).every(qualified),
        'Invalid subjects for world fact '+args.type);
      check(valuesOK(data,schema),'Invalid data for world fact '+args.type);
      check(Array.isArray(causes)&&causes.length<=16&&Array.from(causes).every(eventId)&&new Set(causes).size===causes.length,
        'World fact causes need up to 16 unique event IDs');
    }

    function begin(previous,tick) {
      const lookup = new Map(previous.records.map(fact=>[fact.id,factSummary(fact)]));
      for (const event of previous.events) lookup.set(event.id,event);
      const emitted = [], recorded = [];
      function prepare(args,sequence) {
        const next = tick+'.'+sequence, schema = schemas[args.type], input = args.subjects??{};
        const causes = (args.causes??[]).map(ref=>{
          const event = lookup.get(ref);
          check(event&&compare(ref,next)<0,'World fact '+args.type+' needs a retained earlier event '+ref);
          return event;
        });
        const subjects = Object.fromEntries(Object.entries(schema.subjects).map(([role,kind])=>[role,{kind,id:input[role]}]));
        return {id:next,tick,time:tick*dt,type:args.type,at:args.at,subjects,data:args.data??{},causes};
      }
      function note(row,causal,typed) {
        const {id,tick,system,kind} = row;
        const event = {id,tick,system,kind,...(typed&&{factType:row.fact.type}),...(causal&&{causal})};
        emitted.push(event);
        lookup.set(id,event);
        if (typed) recorded.push(row.fact);
      }
      function snapshot() {
        const count = previous.records.length+recorded.length;
        return {records:recorded.length?[...previous.records,...recorded].slice(-limit):previous.records,
          dropped:previous.dropped+Math.max(0,count-limit),
          eventReceiptsDropped:previous.eventReceiptsDropped+Math.max(0,previous.events.length+emitted.length-eventLimit)};
      }
      function finish() {
        return freeze({...snapshot(),events:emitted.length?[...previous.events,...emitted].slice(-eventLimit):previous.events});
      }
      return {prepare,note,snapshot,finish,receipt:id=>lookup.get(id)};
    }

    function validate(saved,tick,causalEnabled,latest) {
      const tickOf = row=>eventId(row.id)&&Number(row.id.split('.')[0])===row.tick&&integer(row.tick,1,tick);
      const receiptOK = row=>fields(row,['id','tick','system','kind','factType','causal'])&&tickOf(row)&&id(row.system)&&id(row.kind)&&
        (row.kind===kind?row.system==='world'&&typeof row.factType==='string'&&own(schemas,row.factType):row.factType===undefined)&&
        (row.causal===undefined||causalEnabled&&row.causal!=='omitted'&&W.causality.savedReference(row.causal,row.tick)&&
          Number(row.causal.split('.')[1])===row.tick);
      const ordered = (rows,valid) => rows.every((row,i)=>valid(row)&&(i===0||compare(rows[i-1].id,row.id)<0));
      check(fields(saved,['records','events','dropped','eventReceiptsDropped'])&&
        Array.isArray(saved.records)&&saved.records.length<=limit&&Array.isArray(saved.events)&&saved.events.length<=eventLimit&&
        integer(saved.dropped,0,Number.MAX_SAFE_INTEGER)&&integer(saved.eventReceiptsDropped,0,Number.MAX_SAFE_INTEGER)&&
        (!saved.dropped||saved.records.length===limit)&&(!saved.eventReceiptsDropped||saved.events.length===eventLimit)&&
        ordered(saved.events,receiptOK),'Invalid saved world fact ledger');
      const events = new Map(saved.events.map(row=>[row.id,row])), facts = new Map();
      const hasCause = (cause,ref) => {
        if (!receiptOK(cause)||compare(cause.id,ref)>=0) return false;
        const indexed = events.get(cause.id);
        const prior = facts.get(cause.id);
        if (indexed&&!equal(indexed,cause)) return false;
        return !prior||equal({...cause,causal:undefined},{...factSummary(prior),causal:undefined});
      };
      check(ordered(saved.records,fact=>{
        if (!fields(fact,['id','tick','time','type','at','subjects','data','causes'])||!tickOf(fact)||fact.time!==fact.tick*dt||
            typeof fact.type!=='string'||!own(schemas,fact.type)||!atOK(fact.at)||!Array.isArray(fact.causes)||fact.causes.length>16)
          return false;
        const schema = schemas[fact.type];
        if (!namesMatch(fact.subjects,schema.subjects)||!valuesOK(fact.data,schema)||
            !Object.entries(fact.subjects).every(([role,subject])=>fields(subject,['kind','id'])&&
              subject.kind===schema.subjects[role]&&qualified(subject.id))||
            !fact.causes.every(cause=>hasCause(cause,fact.id))||new Set(fact.causes.map(row=>row.id)).size!==fact.causes.length)
          return false;
        const row = events.get(fact.id);
        facts.set(fact.id,fact);
        return !row||equal({...row,causal:undefined},{...factSummary(fact),causal:undefined});
      }),'Invalid saved world fact or earlier event link');
      for (const event of latest.filter(row=>row?.kind===kind).slice(-limit))
        check(own(event,'fact')&&equal(facts.get(event.id),event.fact),'Saved world fact differs from its published event');
    }

    return {policy:freeze({types:schemas,limit,eventLimit}),checkAction,begin,validate,
      initial:()=>freeze({records:[],events:[],dropped:0,eventReceiptsDropped:0})};
  }

  function inspect(state,tick,args) {
    check(fields(args,['id','type','subject','role','place','entity','after','before','where','limit']),'Invalid world fact filter');
    const {id:ref,type,subject,role,place,entity,after=0,before=tick,where,
      limit=128} = args;
    check((ref===undefined||eventId(ref))&&(type===undefined||id(type))&&(subject===undefined||qualified(subject))&&
      (role===undefined||id(role))&&(place===undefined||qualified(place))&&(entity===undefined||id(entity))&&
      integer(after,0,W.runtime.maxTick)&&integer(before,after,W.runtime.maxTick)&&integer(limit,0,4096),'Invalid world fact filter');
    Q.condition(where,{});
    if (!state) return Q.missing('World facts are not enabled','missing');
    const rows = state.records.filter(fact=>fact.tick>=after&&fact.tick<=before&&(ref===undefined||fact.id===ref)&&
      (type===undefined||fact.type===type)&&(place===undefined||fact.at.place===place)&&(entity===undefined||fact.at.entity===entity)&&
      (subject===undefined&&role===undefined||Object.entries(fact.subjects).some(([key,row])=>
        (role===undefined||key===role)&&(subject===undefined||row.id===subject)))&&Q.condition(where,fact));
    return Q.ok({tick,facts:rows.slice(0,limit),matched:rows.length,dropped:state.dropped,
      eventReceiptsDropped:state.eventReceiptsDropped});
  }

  function trace(state,args) {
    check(fields(args,['id','limit','maxDepth'])&&eventId(args.id)&&integer(args.limit??128,1,4096)&&
      integer(args.maxDepth??16,0,64),'Fact lineage needs an event ID and bounded depth and size');
    const byId = new Map(state?.records.map(row=>[row.id,row])), root = byId.get(args.id);
    if (!root) return Q.missing('Unknown retained world fact '+args.id,'missing');
    const {limit=128,maxDepth=16} = args;
    const queue = [[factSummary(root),0]], seen = new Set(), nodes = [], edges = [], gaps = new Map();
    for (const [event,depth] of queue) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      if (depth>maxDepth||nodes.length>=limit) {
        gaps.set(event.id,{id:event.id,reason:depth>maxDepth?'depth':'node-budget'});
        continue;
      }
      const fact = byId.get(event.id);
      nodes.push({...event,...(fact&&{fact})});
      if (event.factType&&!fact) gaps.set(event.id,{id:event.id,reason:'fact-retention'});
      for (const cause of fact?.causes??[]) {
        edges.push({effect:event.id,cause:cause.id});
        queue.push([cause,depth+1]);
      }
    }
    return Q.ok({status:gaps.size?'partial':'complete',root:root.id,nodes,edges,gaps:[...gaps.values()],dropped:state.dropped});
  }

  const valueOK = (shape,value)=>own(types,shape)&&types[shape](value);
  W.worldFacts = Object.freeze({action,kind,compile,inspect,trace,qualified,eventId,compare,atOK,valueOK,
    valueTypes:Object.freeze(Object.keys(types))});
})(KIT);
