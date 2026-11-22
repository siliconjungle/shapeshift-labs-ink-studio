/* A portable view of the payload and provenance of each committed world event. */
(function(K) {
  const W=K.world,{check,id,record}=W.data,{freeze}=K.procedural.data;
  const eventId=value=>typeof value==='string'&&/^\d{1,8}\.\d{1,4}$/.test(value);
  const qualified=value=>typeof value==='string'&&value.split('/').every(id);
  const tickOf=value=>Number(value.split('.')[0]);
  const sequence=value=>Number(value.split('.')[1]);
  const earlier=(a,b)=>eventId(a)&&eventId(b)&&
    (tickOf(a)<tickOf(b)||tickOf(a)===tickOf(b)&&sequence(a)<sequence(b));
  const main=freeze({version:1,lineage:[{branch:'main',fromTick:0}]});

  function stream(previous,tick,name) {
    check(name===undefined||id(name),'Invalid event branch ID');
    const state=previous===undefined?main:previous;
    check(state?.version===1&&Array.isArray(state.lineage)&&state.lineage.length>0&&
      state.lineage.every((row,i)=>id(row?.branch)&&Number.isSafeInteger(row.fromTick)&&
        (i===0?row.fromTick===0:row.fromTick>state.lineage[i-1].fromTick)&&row.fromTick<=tick+1),
    'Invalid saved event branch lineage');
    if (name===undefined||name===state.lineage.at(-1).branch) return freeze(state);
    const next={branch:name,fromTick:tick+1}, lineage=state.lineage;
    return freeze({version:1,lineage:[...(lineage.at(-1).fromTick===next.fromTick?lineage.slice(0,-1):lineage),next]});
  }

  function branchAt(stream,tick) {
    return stream?.lineage.findLast(row=>row.fromTick<=tick)?.branch??'main';
  }

  function storyOf(detail) {
    if (id(detail.document)&&id(detail.story)) return detail.document+'/'+detail.story;
    for (const key of [detail.story,detail.incident,detail.candidate]) {
      if (qualified(key)&&key.split('/').length===2) return key;
    }
    return null;
  }

  function subjects(kind,detail) {
    const refs=[];
    const add=(role,kind,id)=>{
      if (qualified(id)&&qualified(kind)&&qualified(role)&&
        !refs.some(row=>row.kind===kind&&row.id===id&&row.role===role)) refs.push({role,kind,id});
    };
    for (const table of [detail.subjects,detail.fact?.subjects]) {
      if (Array.isArray(table)) for (const item of table) add(item?.role??'subject',item?.kind,item?.id);
      else if (record(table)) for (const [role,item] of Object.entries(table)) add(role,item?.kind,item?.id);
    }
    for (const key of ['entity','body','agent','actor','place','site','item','faction'])
      add(key,key,detail[key]);
    for (const [key,value] of Object.entries(detail.fact?.at??{}))
      if (key==='entity'||key==='place') add(key,key,value);
    add('agent','agent',detail.order?.agent??detail.assignment?.agent);
    if (kind==='transfer') {
      add('from','account',detail.from);
      add('to','account',detail.to);
    }
    return refs;
  }

  function context(row,world,stream,options={}) {
    const {detail=row,command,causalParents=[],lifecycle}=options;
    const {tick,id:local,kind}=row, branch=branchAt(stream,tick), story=storyOf(detail);
    const current=story&&lifecycle?.[story]?.flow?.current;
    const stage=story?(id(detail.stage)&&(!current||detail.visit!==undefined)?detail.stage:current?.stage??null):null;
    const visit=story?(Number.isSafeInteger(detail.visit)?detail.visit:current?.visit??null):null;
    const eventCauses = [];
    const add=value=>{
      if (earlier(value,local)&&!eventCauses.includes(value)) eventCauses.push(value);
    };
    const evidence=detail.evidence??detail.source?.evidence;
    if (evidence?.kind==='event'&&Array.isArray(evidence.events)) evidence.events.forEach(add);
    if (Array.isArray(detail.fact?.causes)) detail.fact.causes.forEach(cause=>add(cause?.id));
    if (Array.isArray(detail.causes)) detail.causes.forEach(cause=>add(typeof cause==='string'?cause:cause?.id));
    if (record(detail.learning?.via)) Object.values(detail.learning.via).forEach(add);
    for (const value of [detail.receipt?.event?.id,detail.custody?.source?.id,detail.custody?.previous,
      detail.memory?.source,detail.visit?.source?.id,detail.change?.source?.id,
      kind==='event-action-scheduled'?detail.trigger:undefined,command?.source]) add(value);
    const causes=eventCauses.map(id=>({type:'event',world,branch:branchAt(stream,tickOf(id)),id}));
    if (command) {
      const {index,action,id}=command;
      causes.push({type:'command',world,branch,tick,index,action,...(id!==undefined&&{id})});
    }
    for (const id of new Set(causalParents)) {
      if (id==='omitted') causes.push({type:'omitted'});
      else if (typeof id==='string'&&/^c\.\d+\.\d+$/.test(id))
        causes.push({type:'trace',world,branch:branchAt(stream,Number(id.split('.')[1])),id});
    }
    return {version:1,world,branch,story,stage,visit,subjects:subjects(kind,detail),causes};
  }

  function read(row,world,stream) {
    const {id,tick,kind,system,eventContext,...payload}=row;
    return freeze({...(eventContext?.version===1?eventContext:context(row,world,stream)),id,tick,kind,system,payload});
  }

  W.committedEvents=Object.freeze({stream,branchAt,context,read,eventId,tickOf});
})(KIT);
