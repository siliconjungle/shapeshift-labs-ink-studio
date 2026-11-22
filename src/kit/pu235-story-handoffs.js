/* Revision-guarded story assignments and preserved evidence at a handoff. */
(function(K) {
  const W = K.world, {check,equal,id,own,record} = W.data, {freeze} = K.procedural.data;
  const limit = 32;
  const closed = new Set(['completed','failed','expired','withdrawn']);
  const keys = (value,allowed) => record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const positive = value => Number.isSafeInteger(value)&&value>0;
  const owner = value => keys(value,['system','agent','generation','sequence'])&&id(value.system)&&id(value.agent)&&
    positive(value.generation)&&positive(value.sequence);
  const revision = row => row?.handoffs?.transfers.length??0;
  const assignment = row => row?.handoffs?.transfers.at(-1)?.order??row?.commitment?.order;
  const pending = row => row?.handoffs?.last?.decision==='deferred';
  const sameActor = (a,b) => a.system===b.system&&a.agent===b.agent&&a.generation===b.generation;
  const blockers = report => report.checks.filter(item=>item.status!=='pass').map(({name,status,reason})=>[name,status,reason]);
  const stageOf = row => row.flow?.current ? {stage:row.flow.current.stage,visit:row.flow.current.visit} : null;

  function compile(documents,systems) {
    const definitions = {};
    for (const document of documents) for (const [story,definition] of Object.entries(document.stories)) {
      const proposals = definition.lifecycle?.handoffs;
      if (!proposals) continue;
      const key = document.id+'/'+story;
      for (const [name,proposal] of Object.entries(proposals))
        W.storyCommitments.checkProposal(proposal.commitment,systems,key+'/'+name);
      definitions[key] = proposals;
    }
    return Object.keys(definitions).length?freeze(definitions):undefined;
  }

  function request(row,args,spec,tick) {
    if (revision(row)!==args.revision) return {rejected:'stale-assignment-revision'};
    if (!assignment(row)) return {rejected:'assignment-unavailable'};
    if (pending(row)) return {rejected:'handoff-already-pending'};
    if (revision(row)>=limit) return {rejected:'handoff-limit'};
    const stage = stageOf(row);
    if (spec.stage!==undefined&&spec.stage!==stage?.stage) return {rejected:'handoff-wrong-stage'};
    return {proposal:args.proposal,revision:args.revision,requestedAt:tick,reason:args.reason,from:assignment(row),stage};
  }

  function update(row,report) {
    const transfers = row.handoffs?.transfers??[];
    return {...row,handoffs:{last:report,transfers:report.decision==='accepted'?[...transfers,report]:transfers}};
  }

  function cancel(request,tick,reason) {
    const {proposal,revision,requestedAt,from,stage,reason:requestedReason} = request;
    return {proposal,revision,requestedAt,from,stage,reason:requestedReason,tick,decision:'cancelled',checks:[
      {name:'request',status:'refuse',reason}
    ]};
  }

  function attempt(row,request,spec,tick,query,dispatch) {
    const {proposal,revision,requestedAt,reason,from,stage} = request;
    const report = {proposal,revision,requestedAt,reason,from,stage,tick};
    if (!equal(stage,stageOf(row))) return cancel(request,tick,'stage-changed');
    const deferred = (name,reason,actual) => ({...report,decision:'deferred',
      checks:[W.storyCommitments.blocked(name,'defer',reason,actual)]});
    if (row.transitions.at(-1).to==='suspended') return deferred('story','story-suspended');
    const objectives = spec.requires?.filter(id=>row.flow?.current?.objectives[id]?.result!=='completed');
    if (objectives?.length) return deferred('objectives','objectives-pending',objectives);
    const next = spec.commitment.actor;
    if (next.system===from.system&&next.agent===from.agent) {
      const generation = next.generation??query.probe(next.system+'/agent',undefined,{agent:next.agent}).value?.generation;
      if (generation===from.generation) return {...report,decision:'refused',checks:[
        W.storyCommitments.blocked('actor-change','refuse','actor-already-assigned')
      ]};
    }
    let exchange;
    const result = W.storyCommitments.attempt(spec.commitment,tick,query,(actor,order)=>{
      if (sameActor(actor,from)) return {check:W.storyCommitments.blocked('actor-change','refuse','actor-already-assigned')};
      exchange = dispatch(actor,order,from);
      return exchange;
    });
    return {...report,actor:result.actor,checks:result.checks,decision:result.decision,
      ...(result.order&&{order:result.order,release:exchange.release})};
  }

  function creditAt(row,tick) {
    const transfers = row.handoffs?.transfers??[];
    for (let i=transfers.length-1;i>=0;i--) if (transfers[i].tick<tick) return transfers[i].order;
    return row.commitment?.order;
  }

  function valid(definition,row,tick,reasonOK) {
    const saved = row.handoffs;
    if (saved===undefined) return true;
    if (!definition||!row.commitment?.order||!keys(saved,['transfers','last'])||
      !Array.isArray(saved.transfers)||saved.transfers.length>limit) return false;
    const end = row.transitions.at(-1);
    function proof(item,index,assigned,priorTick) {
      if (!keys(item,['proposal','revision','requestedAt','reason','from','stage','tick','actor','checks','decision','order','release'])||
        !own(definition,item.proposal)||item.revision!==index||!equal(item.from,assigned)||
        !positive(item.requestedAt)||!positive(item.tick)||item.tick<item.requestedAt||item.requestedAt<priorTick||
        item.tick>(closed.has(end.to)?end.tick:tick)||!reasonOK(item.reason)||
        (item.stage!==null&&(!keys(item.stage,['stage','visit'])||typeof item.stage.stage!=='string'||!positive(item.stage.visit)))||
        !Array.isArray(item.checks)||!item.checks.length||item.checks.length>24||
        !item.checks.every(check=>keys(check,['name','status','reason','actual'])&&typeof check.name==='string'&&
          ['pass','defer','refuse'].includes(check.status)&&(check.status==='pass'?check.reason===undefined:typeof check.reason==='string'))) return false;
      if (item.decision==='accepted') {
        const {actor} = definition[item.proposal].commitment;
        return item.checks.every(check=>check.status==='pass')&&owner(item.order)&&!sameActor(item.order,item.from)&&
          item.order.system===actor.system&&item.order.agent===actor.agent&&
          (actor.generation===undefined||item.order.generation===actor.generation)&&
          equal(item.actor,{system:item.order.system,agent:item.order.agent,generation:item.order.generation})&&
          keys(item.release,['status','work'])&&['cancelled','settled','unavailable'].includes(item.release.status)&&
          (item.release.work===null||keys(item.release.work,['task','phase','nextStep','results'])&&id(item.release.work.task)&&
            typeof item.release.work.phase==='string'&&Number.isSafeInteger(item.release.work.nextStep)&&
            item.release.work.nextStep>=0&&Array.isArray(item.release.work.results));
      }
      return item.order===undefined&&item.release===undefined&&
        (item.decision==='deferred'?item.checks.some(check=>check.status==='defer')&&!item.checks.some(check=>check.status==='refuse'):
          ['refused','cancelled'].includes(item.decision)&&item.checks.some(check=>check.status==='refuse'));
    }
    let assigned = row.commitment.order, priorTick = row.commitment.tick;
    for (const [index,item] of saved.transfers.entries()) {
      if (!proof(item,index,assigned,priorTick)||item.decision!=='accepted'||item.tick<=priorTick) return false;
      assigned=item.order;
      priorTick=item.tick;
    }
    const last = saved.last;
    return last?.decision==='accepted'?equal(last,saved.transfers.at(-1)):
      proof(last,saved.transfers.length,assigned,priorTick)&&(!closed.has(end.to)||last.decision!=='deferred');
  }

  function inspect(definitions,lifecycle,{story}) {
    const {ok,missing} = W.query;
    function row(key) {
      const state = lifecycle?.[key];
      return {proposals:definitions[key],revision:revision(state),assignment:assignment(state)??null,
        transfers:state?.handoffs?.transfers??[],last:state?.handoffs?.last??null};
    }
    if (story!==undefined) return own(definitions,story)?ok(row(story)):missing('unknown story handoff','missing');
    return ok(Object.fromEntries(Object.keys(definitions??{}).sort().map(key=>[key,row(key)])));
  }

  W.storyHandoffs = Object.freeze({compile,revision,assignment,pending,request,update,attempt,cancel,creditAt,valid,inspect,blockers,closed});
})(KIT);
