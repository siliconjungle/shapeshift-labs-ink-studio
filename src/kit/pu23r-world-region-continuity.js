/* Stable references projected from authoritative solvers across regional read models. */
(function(K) {
  const W = K.world, {check,equal,id,own,record,vector,endpoint} = W.data;
  const {freeze} = K.procedural.data;
  const tables = ['people','parties','accounts','stories'];
  const globalRegion = '@global';
  const fields = (raw,keys)=>record(raw)&&Object.keys(raw).every(key=>keys.includes(key));
  const listOK = (raw,test,max=128)=>Array.isArray(raw)&&raw.length<=max&&new Set(raw).size===raw.length&&Array.from(raw).every(test);
  const regionOK = region=>id(region)||region===globalRegion;
  const handleOK = row=>fields(row,['system','agent','generation'])&&id(row.system)&&id(row.agent)&&
    Number.isSafeInteger(row.generation)&&row.generation>0;
  const handleKey = ({system,agent,generation})=>[system,agent,generation].join('/');
  const sorted = values=>[...new Set(values)].sort();

  function compile(world,systems,transfers,lifecycle) {
    const raw = world.regionContinuity;
    if (raw===undefined) return null;
    check(world.simulationChunks&&fields(raw,tables),'Region continuity needs authored simulation chunks and named records');
    const geography = W.regionRevisions.layoutOf(world), accounts = new Map(transfers.describe().map(row=>[row.name,row]));
    const stories = lifecycle?.initial(), dormant = new Set();
    const table = (name,validate,test=id)=>{
      const rows = own(raw,name)?raw[name]:{};
      check(record(rows)&&Object.keys(rows).length<=128,'Invalid continuity '+name+' table');
      return Object.fromEntries(Object.keys(rows).sort().map(key=>{
        check(test(key),'Invalid continuity '+name+' key '+key);
        return [key,validate(rows[key],key)];
      }));
    };
    const people = table('people',(row,name)=>{
      check(handleOK(row)&&own(systems[row.system]?.fields,'agent'),'Unknown continuity person roster for '+name);
      return row;
    });
    const personNames = new Map(Object.entries(people).map(([name,ref])=>[handleKey(ref),name]));
    check(personNames.size===Object.keys(people).length,'A continuity lifetime may have only one name');
    const parties = table('parties',(row,name)=>{
      check(fields(row,['members','formation'])&&own(row,'members')!==own(row,'formation'),'Invalid continuity party '+name);
      if (own(row,'members')) check(listOK(row.members,who=>id(who)&&own(people,who))&&row.members.length>0,
        'Unknown continuity party member in '+name);
      else {
        const [system] = endpoint(row.formation);
        check(own(systems[system]?.fields,'formations'),'Unknown continuity formation roster for '+name);
      }
      return row;
    });
    const stock = table('accounts',(row,name)=>{
      check(fields(row,['account','person','party','dormantTransfers'])&&accounts.has(row.account)&&
        !(own(row,'person')&&own(row,'party'))&&(row.person===undefined||id(row.person)&&own(people,row.person))&&
        (row.party===undefined||id(row.party)&&own(parties,row.party))&&
        (row.dormantTransfers===undefined||typeof row.dormantTransfers==='boolean'),'Invalid continuity account '+name);
      if (row.dormantTransfers) {
        const [system] = endpoint(row.account);
        check(systems[system].durableAccounts===true&&!accounts.get(row.account).ownerOnly,
          'Dormant settlement needs a public durable account '+row.account);
        dormant.add(row.account);
      }
      return row;
    });
    const arcs = table('stories',(row,story)=>{
      check(own(stories,story)&&fields(row,['people','parties','accounts','regions']),'Unknown continuity story '+story);
      for (const [key,entries] of [['people',people],['parties',parties],['accounts',stock]])
        check(row[key]===undefined||listOK(row[key],value=>id(value)&&own(entries,value)),'Unknown story '+key+' in '+story);
      check(row.regions===undefined||listOK(row.regions,region=>geography.layout.has(region)),
        'Unknown continuity story region in '+story);
      return row;
    },story=>typeof story==='string'&&story.split('/').length===2&&story.split('/').every(id));
    check(Object.keys(people).length+Object.keys(parties).length+Object.keys(stock).length+Object.keys(arcs).length>0,
      'Region continuity needs at least one named record');
    return {geography,personNames,people,parties,stock,arcs,permitsDormant:account=>dormant.has(account)};
  }

  function report(plan,view,query) {
    const {owner,locate,layout} = plan.geography, {world,simulationChunks,storyLifecycle} = view;
    const residents = new Map(), representations = new Map();
    function placeOf(entity,fallback) {
      let name = entity;
      while (own(world.entities,name)) {
        const row = world.entities[name];
        if (row.place!==undefined) return row.place;
        name = row.anchor?.entity??row.parent;
      }
      return fallback;
    }
    function residency(system) {
      if (representations.has(system)) return representations.get(system);
      const home = owner(system), chunk = simulationChunks?.entries[home];
      const model = query.probe('world/representation',undefined,{system}).value;
      const result = {owner:home,sleeping:chunk?.sleeping??false,representation:model?.representation??'detail',
        ...(chunk&&{level:chunk.level}),...(model?.model&&{model:model.model})};
      representations.set(system,result);
      return result;
    }
    function person(ref) {
      const key = handleKey(ref);
      if (residents.has(key)) return residents.get(key);
      const row = query.probe(ref.system+'/agent',undefined,{agent:ref.agent,generation:ref.generation}).value;
      const home = residency(ref.system);
      let response = {handle:ref,status:'unavailable',...home};
      if (row?.generation===ref.generation&&vector(row.position)) {
        const {entity,position,mode} = row, place = placeOf(entity,layout.get(home.owner).place??world.id);
        const active = row.orders?.active;
        response = {...response,status:'present',entity,position,place,region:locate(place,position),mode,
          ...(active&&{order:{id:active.id,sequence:active.sequence}}),...(row.travelPlan&&{travel:row.travelPlan.phase})};
      }
      residents.set(key,response);
      return response;
    }
    const people = Object.fromEntries(Object.entries(plan.people).map(([name,ref])=>[name,person(ref)]));
    const parties = Object.fromEntries(Object.entries(plan.parties).map(([name,spec])=>{
      let party, handles;
      if (spec.formation) {
        const [system,group] = endpoint(spec.formation);
        party = query.probe(system+'/formations',undefined,{group}).value;
        handles = (party?.members??[]).map(({agent,generation})=>({system,agent,generation}));
      } else handles = spec.members.map(member=>plan.people[member]);
      const members = handles.map(handle=>{
        const current = person(handle), alias = plan.personNames.get(handleKey(handle));
        return {handle,status:current.status,...(alias&&{person:alias}),...(current.region&&{region:current.region})};
      });
      return [name,{status:spec.formation&&!party?'unavailable':'tracked',members,regions:sorted(members.flatMap(row=>row.region??[])),
        ...(spec.formation&&{formation:spec.formation}),...(party&&{phase:party.phase})}];
    }));
    const accounts = Object.fromEntries(Object.entries(plan.stock).map(([name,spec])=>{
      const [system] = endpoint(spec.account), home = residency(system);
      const row = query.probe('world/account',undefined,{account:spec.account}).value;
      const regions = spec.person?(people[spec.person].region?[people[spec.person].region]:[]):
        spec.party?parties[spec.party].regions:[home.owner];
      return [name,{...spec,...home,status:row?'present':'unavailable',regions,
        ...(row&&{resource:row.resource,units:row.units,type:row.type,balance:row.balance})}];
    }));
    const stories = Object.fromEntries(Object.entries(plan.arcs).map(([name,spec])=>{
      const row = storyLifecycle?.[name], end = row?.transitions.at(-1), stage = row?.flow?.current;
      const regions = sorted([...(spec.regions??[]),...(spec.people??[]).flatMap(person=>people[person].region??[]),
        ...(spec.parties??[]).flatMap(party=>parties[party].regions),...(spec.accounts??[]).flatMap(account=>accounts[account].regions)]);
      const {people:cast=[],parties:groups=[],accounts:stock=[]} = spec;
      return [name,{people:cast,parties:groups,accounts:stock,regions,status:end?.to??'pending',
        ...(end&&{since:end.tick,reason:end.reason,...(end.outcome!==undefined&&{outcome:end.outcome})}),
        ...(stage&&{stage:stage.stage,visit:stage.visit,objectives:Object.fromEntries(Object.entries(stage.objectives??{}).map(([id,proof])=>
          [id,{result:proof.result,reason:proof.reason,tick:proof.tick}]))})}];
    }));
    return freeze({version:1,people,parties,accounts,stories});
  }

  function validateReport(value) {
    const message = 'Invalid regional continuity report';
    check(fields(value,['version',...tables])&&value.version===1&&tables.every(key=>record(value[key])&&
      Object.keys(value[key]).length<=128),message);
    const {people,parties,accounts,stories} = value;
    for (const [name,person] of Object.entries(people)) check(id(name)&&record(person)&&handleOK(person.handle)&&regionOK(person.owner)&&
      typeof person.sleeping==='boolean'&&['detail','aggregate'].includes(person.representation)&&
      (person.status==='present'?regionOK(person.region)&&vector(person.position):person.status==='unavailable'&&person.region===undefined),message);
    for (const [name,party] of Object.entries(parties)) {
      check(id(name)&&record(party)&&['tracked','unavailable'].includes(party.status)&&Array.isArray(party.members)&&
        party.members.length<=256&&party.members.every(member=>record(member)&&handleOK(member.handle)&&
          (member.status==='present'?regionOK(member.region):member.status==='unavailable'&&member.region===undefined)),message);
      check(equal(party.regions,sorted(party.members.flatMap(row=>row.region??[])))&&party.members.every(member=>{
        if (member.person===undefined) return true;
        const named = own(people,member.person)?people[member.person]:undefined;
        return named&&equal(named.handle,member.handle)&&named.status===member.status&&named.region===member.region;
      }),message);
    }
    for (const [name,account] of Object.entries(accounts)) check(id(name)&&record(account)&&typeof account.account==='string'&&
      regionOK(account.owner)&&listOK(account.regions,regionOK,512)&&(account.person===undefined||own(people,account.person))&&
      (account.party===undefined||own(parties,account.party))&&
      (account.status==='present'?Number.isFinite(account.balance)||vector(account.balance,2)||vector(account.balance):account.status==='unavailable'),message);
    for (const [name,story] of Object.entries(stories)) check(name.split('/').length===2&&name.split('/').every(id)&&record(story)&&
      ['pending','available','active','suspended','completed','failed','withdrawn','expired'].includes(story.status)&&
      listOK(story.people,key=>id(key)&&own(people,key))&&listOK(story.parties,key=>id(key)&&own(parties,key))&&
      listOK(story.accounts,key=>id(key)&&own(accounts,key))&&listOK(story.regions,regionOK,513),message);
  }

  W.regionContinuity = Object.freeze({compile,report,validateReport});
})(KIT);
