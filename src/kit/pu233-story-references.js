/* Live policy observations retain a stable identity and a separate current target. */
(function(K) {
  const W = K.world, {check, equal, id, own, read, record, selector, vector} = W.data;
  const {freeze} = K.procedural.data, Q = W.query;
  const causes = ['died','missing','replaced','inaccessible','faction-changed','moved'];
  const priority = {fail:3,withdraw:2,suspend:1};
  const open = new Set(['available','active','suspended']);
  const terminal = new Set(['completed','failed','withdrawn','expired']);
  const positive = value => Number.isSafeInteger(value) && value>0;
  const identityOK = value => id(value) || positive(value);
  const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const pick = (value,path) => path === undefined ? value : read(value,selector(path));
  const distance = (from,to) => Math.hypot(...from.map((value,i)=>value-to[i]));
  const actionFor = (rule,cause) => rule.on?.[cause] ?? 'track';

  function liveAgent(query, {system,agent,generation}) {
    return query.probe(system+'/agent',undefined,{agent,...(generation!==undefined&&{generation})});
  }

  function sample(rule,query) {
    const {agent,entity,socket} = rule.target;
    const value = agent ? liveAgent(query,{...agent,generation:undefined}) : query.probe('world/entity',undefined,{entity});
    if (value.status !== 'ok') return {fault:'missing',detail:value.reason??value.status};
    const row = value.value;
    const identity = agent ? row.generation : rule.identityPath === undefined ? entity : pick(row,rule.identityPath);
    if (!identityOK(identity)) return {fault:'inaccessible',detail:'identity-unavailable'};
    const faction = read(row,rule.factionPath === undefined ? ['metadata','faction'] : selector(rule.factionPath));
    const position = agent ? row.position : query.frame({entity,socket})?.point;
    return {identity,dormant:agent&&row.mode==='dormant',target:{...(agent ? {system:agent.system,agent:agent.agent,generation:identity,entity:row.entity} :
      {entity,...(socket!==undefined&&{socket})}),position:vector(position)?position:null,faction:id(faction)?faction:null}};
  }

  function deathFor(rule,identity,events) {
    if (!rule.death || identity === null) return undefined;
    const {event,target} = rule.death;
    for (const row of events(event.kind)) {
      if (event.system !== undefined && row.system !== event.system || !Q.condition(event.where,row)) continue;
      const observed = pick(row,target), {agent,entity} = rule.target;
      const matches = agent ? observed?.system===agent.system && observed.agent===agent.agent && observed.generation===identity :
        rule.identityPath === undefined ? observed===entity : observed?.entity===entity && observed.identity===identity;
      if (matches) return {event:row.id,kind:row.kind,tick:row.tick};
    }
  }

  function access(rule, target, query) {
    if (!target.position) return 'position-unavailable';
    if (rule.access?.routeFrom) {
      const {system,...actor} = rule.access.routeFrom;
      const sample = query.probe(system+'/route-feasibility',undefined,{...actor,to:target.position});
      return sample.status === 'ok' ? sample.value.status==='ok'?null:sample.value.status : sample.reason??sample.status;
    }
    if (rule.access?.state) {
      const {field,at,args,select,when} = rule.access.state;
      const sample = query.probe(field,at,args);
      if (sample.status!=='ok') return sample.reason??sample.status;
      const value = pick(sample.value,select);
      return value===undefined?'value-unavailable':Q.condition(when,value)?null:'condition-mismatch';
    }
    return null;
  }

  function observe(rule, before, tick, query, events) {
    const current = sample(rule,query);
    const pinned = rule.target.agent?.generation ?? (rule.identityPath===undefined ? rule.target.entity : undefined);
    let identity = before?.identity ?? pinned ?? current.identity ?? null;
    let anchor = before?.anchor ?? null, target = null, adopted = before?.adopted;
    const died = deathFor(rule,identity,events);
    let death = before?.death ?? died;
    const issues = {};
    const add = (cause,detail) => {issues[cause]={action:actionFor(rule,cause),detail};};
    if (!died && current.identity!==undefined && identity!==current.identity && actionFor(rule,'replaced')==='adopt') {
      adopted = {tick,from:identity,to:current.identity};
      identity = current.identity;
      anchor = null;
      death = undefined;
    }
    if (death) add('died',death);
    if (current.fault) add(current.fault,{reason:current.detail});
    else if (identity!==current.identity) add('replaced',{expected:identity,observed:current.identity});
    else if (!death) {
      target = current.target;
      const {position,faction} = target;
      anchor ??= {position,faction};
      if (!anchor.position && position) anchor = {...anchor,position};
      if (faction!==anchor.faction) {
        add('faction-changed',{from:anchor.faction,to:faction});
        if (issues['faction-changed'].action==='track') anchor = {...anchor,faction};
      }
      if (position && anchor.position) {
        const moved = distance(anchor.position,position);
        if (moved>(rule.moveTolerance??0.25)) {
          add('moved',{from:anchor.position,to:position,distance:Number.isFinite(moved)?moved:null});
          if (issues.moved.action==='track') anchor = {...anchor,position};
        }
      }
      const blocked = current.dormant ? 'agent-dormant' : access(rule,target,query);
      if (blocked) add('inaccessible',{reason:blocked});
    }
    return {tick,identity,anchor,target,issues,...(death&&{death}),...(adopted&&{adopted})};
  }

  function compile(documents, world, systems) {
    const definitions = {};
    let count = 0, registry, usesEvents = false;
    function field(name,at) {
      const weather = world.visual?.weatherTracks||world.visual?.environmentPreset;
      registry ??= Q.create({world,...(weather&&{weatherTrackState:{}})},systems);
      check(registry.field(name),'Unknown live reference field '+name+' in '+at);
    }
    for (const document of documents) for (const [story,definition] of Object.entries(document.stories)) {
      const records = definition.lifecycle?.liveReferences;
      if (!records) continue;
      const key = document.id+'/'+story;
      for (const [name,rule] of Object.entries(records)) {
        check(++count<=256,'World live reference budget exceeds 256 targets');
        const at = key+'/'+name;
        if (rule.target.agent) field(rule.target.agent.system+'/agent',at);
        if (rule.access?.routeFrom) field(rule.access.routeFrom.system+'/route-feasibility',at);
        if (rule.access?.state) field(rule.access.state.field,at);
        if (rule.death) {
          const {system} = rule.death.event;
          check(system===undefined||system==='world'||own(systems,system),'Unknown live reference event source '+system+' in '+at);
          usesEvents = true;
        }
      }
      definitions[key] = records;
    }
    if (!count) return undefined;
    freeze(definitions);
    const stories = Object.keys(definitions).sort(), noEvents = () => [];
    function snapshot(before,tick,query,events = noEvents,lifecycle = {},emit) {
      const result = {...before};
      for (const story of stories) {
        if (terminal.has(lifecycle[story]?.transitions.at(-1).to)) continue;
        const records = definitions[story], rows = {};
        for (const reference of Object.keys(records).sort()) {
          const prior = before?.[story]?.[reference], rule = records[reference];
          const next = observe(rule,prior,tick,query,events);
          rows[reference] = next;
          if (!emit) continue;
          const [document,storyId] = story.split('/');
          const send = (change,action,disposition,detail) => emit('story-reference-changed',{
            document,story:storyId,reference,change,action,disposition,detail,target:next.target
          });
          for (const cause of causes) {
            const issue = next.issues[cause], old = prior?.issues[cause];
            if (issue && (!old || ['moved','faction-changed'].includes(cause)&&issue.action==='track'&&!equal(old,issue)))
              send(cause,issue.action,'observed',issue.detail);
            if (!issue && old && old.action!=='track') send(cause,old.action,'cleared',old.detail);
            if (cause==='replaced' && next.adopted?.tick===tick && !equal(prior?.adopted,next.adopted))
              send(cause,'adopt','adopted',next.adopted);
          }
        }
        result[story] = rows;
      }
      return freeze(result);
    }
    function validate(saved, tick, lifecycle) {
      check(record(saved)&&equal(Object.keys(saved).sort(),stories),'Invalid story live reference checkpoint table');
      for (const story of stories) {
        const definitionsForStory = definitions[story], rows = saved[story], end = lifecycle[story]?.transitions.at(-1);
        const expectedTick = terminal.has(end?.to)?end.tick:tick;
        check(record(rows)&&equal(Object.keys(rows).sort(),Object.keys(definitionsForStory).sort()),'Invalid live references for '+story);
        for (const [name,row] of Object.entries(rows)) {
          const rule = definitionsForStory[name], message = 'Invalid live reference '+story+'/'+name;
          check(keys(row,['tick','identity','anchor','target','issues','death','adopted'])&&row.tick===expectedTick&&
            (row.identity===null||identityOK(row.identity))&&record(row.issues)&&Object.keys(row.issues).every(cause=>
              causes.includes(cause)&&keys(row.issues[cause],['action','detail'])&&
              row.issues[cause].action===actionFor(rule,cause)&&record(row.issues[cause].detail)),message);
          check(row.anchor===null||keys(row.anchor,['position','faction'])&&
            (row.anchor.position===null||vector(row.anchor.position))&&(row.anchor.faction===null||id(row.anchor.faction)),message);
          const target=row.target;
          check(target===null||keys(target,['system','agent','generation','entity','socket','position','faction'])&&
            (target.position===null||vector(target.position))&&(target.faction===null||id(target.faction))&&
            (rule.target.agent ? target.system===rule.target.agent.system&&target.agent===rule.target.agent.agent&&
              positive(target.generation)&&target.generation===row.identity : target.entity===rule.target.entity&&target.socket===rule.target.socket),message);
          check((row.death===undefined&& !own(row.issues,'died') ||
            rule.death && keys(row.death,['event','kind','tick'])&&row.death.kind===rule.death.event.kind&&
            positive(row.death.tick)&&row.death.tick<=row.tick&&typeof row.death.event==='string'&&
            row.death.event.startsWith(row.death.tick+'.')&&equal(row.issues.died?.detail,row.death)&&target===null),message);
          if (row.adopted!==undefined) check(actionFor(rule,'replaced')==='adopt'&&keys(row.adopted,['tick','from','to'])&&
            Number.isSafeInteger(row.adopted.tick)&&row.adopted.tick>=0&&row.adopted.tick<=row.tick&&
            identityOK(row.adopted.from)&&row.adopted.to===row.identity&&row.adopted.from!==row.adopted.to,message);
          else {
            const pinned = rule.target.agent?.generation ?? (rule.identityPath===undefined ? rule.target.entity : undefined);
            check(pinned===undefined||pinned===row.identity,message);
          }
        }
      }
    }
    return {definitions,validate,initial:query=>snapshot(undefined,0,query),
      advance(before,tick,query,events,lifecycle,emit) {
        const index = usesEvents ? W.storyEvidence.index(events,events.length) : null;
        return snapshot(before,tick,query,kind=>index?.get(kind)??[],lifecycle,emit);
      }};
  }

  function decision(rows) {
    let choice;
    for (const [reference,row] of Object.entries(rows??{})) for (const cause of causes) {
      const action = row.issues[cause]?.action;
      if ((priority[action]??0)>(priority[choice?.action]??0)) choice = {reference,cause,action};
    }
    return choice;
  }

  function inspect(records,{story,reference}) {
    if (story===undefined && reference===undefined) return Q.ok(records??{});
    const rows = own(records,story)&&records[story];
    if (!rows) return Q.missing('unknown story with live references','missing');
    return reference===undefined?Q.ok(rows):own(rows,reference)?Q.ok(rows[reference]):
      Q.missing('unknown live reference','missing');
  }

  function target(records,query,{story,reference,from}) {
    const row = own(records,story)&&own(records[story],reference)&&records[story][reference];
    if (!row?.target?.position) return Q.missing('live reference target is unavailable');
    const result = {...row.target,identity:row.identity,tick:row.tick,accessible:!own(row.issues,'inaccessible')};
    if (from===undefined) return Q.ok(result);
    check(keys(from,['system','agent','generation'])&&id(from.system)&&id(from.agent)&&
      (from.generation===undefined||positive(from.generation)),'Invalid live reference distance origin');
    const origin = liveAgent(query,from);
    if (origin.status!=='ok') return Q.missing('live reference distance origin is unavailable');
    const separation = distance(origin.value.position,row.target.position);
    return Number.isFinite(separation)?Q.ok({...result,distance:separation}):Q.missing('live reference distance is unavailable');
  }

  W.storyReferences = Object.freeze({compile,decision,inspect,target,open});
})(KIT);
