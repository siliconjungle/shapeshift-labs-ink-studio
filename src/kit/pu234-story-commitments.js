/* Explain a story proposal using the actor's native orders, needs, and activity terms. */
(function(K) {
  const W = K.world, Q = W.query, {check, equal, own, read, record, selector} = W.data;
  const {freeze} = K.procedural.data;
  const terminal = new Set(['completed','failed','withdrawn','expired']);
  const positive = value => Number.isSafeInteger(value)&&value>0;
  const keys = (value,allowed) => record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const pass = (name,actual) => ({name,status:'pass',...(actual!==undefined&&{actual})});
  const blocked = (name,status,reason,actual) => ({name,status,reason,...(actual!==undefined&&{actual})});
  const decision = checks => checks.some(row=>row.status==='refuse')?'refused':
    checks.some(row=>row.status==='defer')?'deferred':'accepted';
  const reasons = report => report.checks.filter(row=>row.status!=='pass').map(({name,status,reason})=>[name,status,reason]);

  function compile(documents, systems) {
    const definitions = {};
    for (const document of documents) for (const [story,definition] of Object.entries(document.stories)) {
      const spec = definition.lifecycle?.commitment;
      if (!spec) continue;
      const key = document.id+'/'+story, {actor:{system,...actor},order} = spec;
      const roster = own(systems,system)&&systems[system];
      check(roster?.fields?.['commitment-terms']&&roster.actions?.['issue-order']&&roster.actions?.['cancel-order'],
        'Unknown story commitment roster '+system+' in '+key);
      try { roster.checkAction('issue-order',{...actor,order}); }
      catch(error) { throw new Error('Invalid story commitment order in '+key+': '+error.message); }
      if (order.reservation) {
        const board = order.reservation.board;
        check(own(systems,board)&&systems[board].reservationBoard,'Unknown story commitment reservation board '+board);
      }
      definitions[key] = spec;
    }
    return Object.keys(definitions).length?freeze(definitions):undefined;
  }

  function evaluate(spec,tick,query) {
    const {actor,activity,order,terms={},consider={}} = spec;
    const {system,agent,generation} = actor;
    const sample = query.probe(system+'/commitment-terms',undefined,{agent,activity,orderId:order.id});
    if (sample.status!=='ok') return {tick,actor,checks:[blocked('actor','defer','actor-unavailable',sample.reason)]};
    const actual = sample.value, checks = [];
    const replaced = generation!==undefined&&actual.actor.generation!==generation;
    checks.push(replaced?blocked('actor','refuse','actor-replaced',actual.actor):pass('actor',actual.actor));
    if (replaced) return {tick,actor,checks};
    checks.push(actual.available?blocked('availability','defer',actual.available,{
      ...actual.orders,activity:actual.activity,phase:actual.phase
    }):pass('availability'));
    if (!actual.orderAvailable) checks.push(blocked('order','refuse','order-unavailable',{task:order.task,id:order.id??null}));
    if (activity!==undefined) {
      const native = actual.activityTerms;
      if (!native) checks.push(blocked('activity','refuse','activity-not-authorized',activity));
      else {
        checks.push(pass('activity',activity));
        if (native.schedule) checks.push(native.schedule.open?pass('schedule',native.schedule):
          blocked('schedule','defer','outside-schedule',native.schedule));
        if (native.need) {
          const observed = {needs:actual.needs,when:native.need.when};
          checks.push(native.need.pass?pass('needs',observed):blocked('needs','defer','need-condition',observed));
        }
      }
    }
    const context = {actor:actual.actor,needs:actual.needs,activity:actual.activity,phase:actual.phase,terms};
    for (const name of Object.keys(consider).sort()) {
      const {when,otherwise} = consider[name], label = 'term/'+name;
      const observed = when.path===undefined?undefined:read(context,selector(when.path));
      const proof = {when,...(observed!==undefined&&{value:observed})};
      checks.push(Q.condition(when,context)?pass(label,proof):blocked(label,otherwise,'terms-unmet',proof));
    }
    return {tick,actor:actual.actor,checks};
  }

  function attempt(spec,tick,query,dispatch) {
    const report = evaluate(spec,tick,query);
    const initial = decision(report.checks);
    if (initial!=='accepted') return {...report,decision:initial};
    const result = dispatch(report.actor,spec.order);
    if (result.check) report.checks.push(result.check);
    return {...report,decision:decision(report.checks),...(result.order&&{order:result.order})};
  }

  function releases(definitions,state,tick) {
    return Object.keys(definitions??{}).sort().flatMap(story=>{
      const row = state[story], end = row?.transitions.at(-1);
      return end?.tick===tick-1&&terminal.has(end.to)&&row.commitment?.order?[{story,order:row.commitment.order}]:[];
    });
  }

  function valid(spec,row,tick) {
    const report = row.commitment;
    if (!spec) return report===undefined;
    const active = row.transitions.find(change=>change.from==='available'&&change.to==='active');
    const end = row.transitions.at(-1);
    if (report===undefined) return !active&&!row.dropped&&end.to!=='active'&&end.to!=='suspended';
    if (!keys(report,['tick','actor','checks','decision','order','requestedAt','requestReason'])||
      !positive(report.requestedAt)||!positive(report.tick)||report.requestedAt>report.tick||report.tick>(terminal.has(end.to)?end.tick:tick)||
      (!row.dropped&&report.requestedAt<row.transitions[0].tick)||
      typeof report.requestReason!=='string'||!report.requestReason.trim()||report.requestReason.length>256||
      !keys(report.actor,['system','agent','generation'])||report.actor.system!==spec.actor.system||report.actor.agent!==spec.actor.agent||
      (report.actor.generation!==undefined&&!positive(report.actor.generation))||
      (spec.actor.generation!==undefined&&report.actor.generation!==spec.actor.generation)||
      !Array.isArray(report.checks)||!report.checks.length||report.checks.length>24||
      !report.checks.every(item=>keys(item,['name','status','reason','actual'])&&typeof item.name==='string'&&
        ['pass','defer','refuse'].includes(item.status)&&(item.status==='pass'?item.reason===undefined:typeof item.reason==='string'))||
      report.decision!==decision(report.checks)) return false;
    if (report.decision==='accepted') return keys(report.order,['system','agent','generation','sequence'])&&
      positive(report.actor.generation)&&positive(report.order.sequence)&&equal(report.order,{...report.actor,sequence:report.order.sequence})&&
      (active?active.tick===report.tick:row.dropped>0);
    if (report.order!==undefined||active||row.dropped||!['available','withdrawn','expired'].includes(end.to)) return false;
    return report.decision==='deferred'||end.to==='withdrawn'&&end.tick===report.tick&&end.reason==='actor-refused';
  }

  function inspect(definitions,lifecycle,{story}) {
    const row = key => ({proposal:definitions[key],decision:lifecycle?.[key]?.commitment??null});
    if (story!==undefined) return own(definitions,story)?Q.ok(row(story)):Q.missing('unknown story commitment','missing');
    return Q.ok(Object.fromEntries(Object.keys(definitions??{}).sort().map(key=>[key,row(key)])));
  }

  W.storyCommitments = Object.freeze({compile,attempt,blocked,pass,reasons,releases,valid,inspect});
})(KIT);
