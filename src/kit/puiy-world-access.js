/* Project one committed world through an authored audience and command policy. */
(function(K) {
  const W=K.world, {check,id,copy,own,read,selector}=W.data, {freeze}=K.procedural.data;
  const {fields}=W.boundarySignals, format='ink-studio/world-access';
  const qualified=value=>typeof value==='string'&&value.length<=256&&value.split('/').length===2&&value.split('/').every(id);
  const unavailable=freeze({status:'missing'});

  function named(value,max,message) {
    check(W.data.record(value)&&Object.keys(value).length<=max&&Object.keys(value).every(id),message);
    return Object.entries(value);
  }
  function valueOnly(result,project) {
    return result.status==='ok'?{status:'ok',value:project(result.value)}:unavailable;
  }
  function observation(row) {
    const {key,kind,id,entity,generation,lastObservedTick,ageTicks,currentlyVisible,currentlyNear,currentlyAudible,
      lastSeen,lastNearby,lastHeard,seenAgeTicks}=row;
    return {key,kind,id,...(entity!==undefined&&{entity}),...(generation!==undefined&&{generation}),
      lastObservedTick,ageTicks,currentlyVisible,currentlyNear,currentlyAudible,
      ...(lastSeen&&{lastSeen:{tick:lastSeen.tick,position:lastSeen.position},seenAgeTicks}),
      ...(lastNearby&&{lastNearby:{tick:lastNearby.tick,position:lastNearby.position}}),
      ...(lastHeard&&{lastHeard:{tick:lastHeard.tick,direction:lastHeard.direction,levelDb:lastHeard.levelDb,
        ...(lastHeard.apparentSource&&{apparentSource:lastHeard.apparentSource})}})};
  }

  function compile(policy,world,{queries={}}={}) {
    check(fields(policy,['format','version','views','public','interventions','principals'])&&policy.format===format&&
      policy.version===1,'Expected a version 1 world access policy');
    policy=freeze(copy(policy));
    const visible=policy.public??{};
    check(fields(visible,['queries','events']),'Invalid public world projection');
    const publicSpecs=visible.queries??{};
    const publicProbes=W.graphPorts.queries(publicSpecs);
    check(publicProbes.every(([name])=>!['perception','knowledge'].includes(name)&&publicSpecs[name].select!==undefined),
      'Public probes need explicit selectors and cannot use reserved faction sample names');
    const worldProbes=W.graphPorts.queries(queries);
    const eventRules=new Map(named(visible.events??{},128,'Invalid public events').map(([kind,rule])=>{
      check(fields(rule,['as','system','where','fields'])&&(rule.as===undefined||id(rule.as))&&(rule.system===undefined||id(rule.system)),
        'Invalid public event rule '+kind);
      W.query.condition(rule.where,undefined);
      const keys=named(rule.fields??{},32,'Invalid public event fields on '+kind)
        .map(([name,path])=>[name,selector(path)]);
      return [kind,{kind:rule.as??kind,system:rule.system,where:rule.where,keys}];
    }));
    const views=new Map(named(policy.views,16,'Invalid audience views').map(([name,view])=>{
      check(fields(view,['kind','faction','perception','knowledge'])&&['world','faction','spectator'].includes(view.kind),
        'Invalid audience view '+name);
      if(view.kind==='faction'){
        check(W.worldFacts.qualified(view.faction)&&(view.knowledge===undefined||typeof view.knowledge==='boolean'),
          'Faction view needs a faction ID and optional knowledge flag');
        if(view.perception!==undefined){
          const system=id(view.perception)&&own(world.systems,view.perception)&&world.systems[view.perception];
          check(system?.kind==='perception'&&own(system.config?.factions,view.faction),
            'Unknown faction '+view.faction+' in the perception provider for '+name);
        }
      } else check(Object.keys(view).length===1,'Faction settings are specific to faction views');
      return [name,freeze({id:name,...copy(view)})];
    }));
    check(views.size>0,'World access needs at least one audience view');
    const commands=new Map(named(policy.interventions??{},64,'Invalid interventions').map(([name,command])=>{
      check(fields(command,['action','args','maxLag'])&&qualified(command.action)&&W.data.record(command.args??{}),
        'Intervention '+name+' needs a fixed native action and arguments');
      const maxLag=command.maxLag??0;
      check(Number.isSafeInteger(maxLag)&&maxLag>=0&&maxLag<=120,'Intervention maxLag must be between 0 and 120 ticks');
      return [name,freeze({action:command.action,args:command.args??{},maxLag})];
    }));
    const principals=named(policy.principals??{},64,'Invalid access principals').map(([name,spec])=>{
      check(fields(spec,['view','interventions'])&&views.has(spec.view),'Unknown audience view for '+name);
      const grants=spec.interventions??[];
      check(Array.isArray(grants)&&grants.length<=64&&grants.every(name=>commands.has(name))&&new Set(grants).size===grants.length,
        'Invalid intervention grants for '+name);
      return freeze({id:name,view:spec.view,interventions:grants.slice()});
    });

    function audience(name) {
      check(views.has(name),'Unknown audience view '+name);
      const {kind,faction}=views.get(name);
      return freeze({id:name,kind,...(faction!==undefined&&{faction})});
    }
    function publicEffects(events,frame) {
      const rows=[];
      for(const event of events){
        const rule=eventRules.get(event.kind);
        if(!rule||event.tick!==frame.tick||rule.system!==undefined&&rule.system!==event.system||
          !W.query.condition(rule.where,event))continue;
        const payload=Object.fromEntries(rule.keys.flatMap(([name,path])=>{
          const value=read(event,path);
          return value===undefined?[]:[[name,value]];
        }));
        rows.push({version:1,id:frame.tick+'.'+rows.length,tick:frame.tick,world:frame.world,branch:frame.branch,
          system:'presentation',kind:rule.kind,story:null,stage:null,visit:null,subjects:[],causes:[],payload});
      }
      return rows;
    }
    function project(name,view,query,events=[]) {
      const visibility=audience(name), spec=views.get(name);
      if(spec.kind==='world')return freeze({
        ...W.graphPorts.frameOf(view,query,worldProbes,{events,...(events.length&&{eventFrom:view.tick})}),visibility
      });
      const base=W.graphPorts.frameOf(view,query,publicProbes);
      const samples=Object.fromEntries(Object.entries(base.samples).map(([name,row])=>[name,valueOnly(row,value=>value)]));
      if(spec.kind==='faction'){
        const {faction,perception}=spec;
        if(perception!==undefined)samples.perception=valueOnly(query.probe(perception+'/faction',undefined,{faction}),
          ({sampledAt,sampleAgeTicks,contacts})=>({faction,sampledAt,sampleAgeTicks,contacts:contacts.map(observation)}));
        if(spec.knowledge!==false&&view.knowledge)samples.knowledge=valueOnly(
          query.probe('world/knowledge',undefined,{holder:{kind:'faction',id:faction},limit:4096}),({records})=>({
            faction,records:records.map(({fact,type,status,origin,at,subjects,data})=>
              ({fact,type,status,origin,...(at!==undefined&&{at}),subjects,data}))
          }));
      }
      const frame={...base,branch:'public',seed:0,samples,visibility};
      const effects=publicEffects(events,frame);
      return freeze({...frame,events:effects,...(effects.length&&{eventFrom:view.tick})});
    }
    return Object.freeze({views:freeze([...views.keys()]),principals:freeze(principals),audience,project,
      intervention:name=>commands.get(name)});
  }
  W.worldAccess=Object.freeze({format,compile});
})(KIT);
