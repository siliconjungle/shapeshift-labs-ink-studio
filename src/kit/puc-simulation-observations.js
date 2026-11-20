/* Shared measurement schedules and deterministic simulation case matrices. */
(function (K) {
  const W=K.world, R=W.runtime, {check,record,id,copy,own,selector,read,endpoint}=W.data;
  const {freeze}=K.procedural.data;
  const format='ink-studio/observation-sweep', maxRuns=2000, maxSamples=100000;
  const tickOK=tick=>Number.isSafeInteger(tick)&&tick>=0&&tick<=R.maxTick;
  const shape=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));

  function schedule(raw) {
    if(Array.isArray(raw)){
      check(raw.length>0&&raw.length<=maxSamples&&Array.from(raw).every(tickOK),'Invalid observation ticks');
      return [...new Set(raw)].sort((a,b)=>a-b);
    }
    check(shape(raw,['from','to','every']),'Observations need tick lists or a from/to/every schedule');
    const {from,to,every=1}=raw;
    check(tickOK(from)&&tickOK(to)&&from<=to&&Number.isSafeInteger(every)&&every>=1&&
      Math.ceil((to-from)/every)+1<=maxSamples,'Invalid observation tick range or sample budget');
    const ticks=[];
    for(let tick=from;tick<to;tick+=every)ticks.push(tick);
    ticks.push(to);
    return ticks;
  }

  function prepare(input) {
    check(shape(input,['ticks','observations','seeds','parameters','cases','actions']),'Invalid observation sweep plan');
    const spec=copy(input), defaults=spec.ticks===undefined?null:schedule(spec.ticks);
    const {seeds,parameters:bindings={},cases=[{id:'base'}],actions=[]}=spec;
    check(seeds===undefined||Array.isArray(seeds)&&seeds.length>0&&seeds.length<=maxRuns&&
      seeds.every(Number.isSafeInteger)&&new Set(seeds).size===seeds.length,'Sweep seeds need distinct safe integers');
    check(Array.isArray(actions),'Sweep actions need a command list');
    check(record(spec.observations)&&Object.keys(spec.observations).length>0&&
      Object.keys(spec.observations).length<=128,'A sweep needs 1–128 named observations');
    const observations=Object.entries(spec.observations).map(([name,item])=>{
      check(id(name)&&shape(item,['field','at','args','path','ticks','units'])&&typeof item.field==='string'&&
        item.field.length>0&&(item.args===undefined||record(item.args))&&
        (item.units===undefined||typeof item.units==='string'&&item.units.trim().length>0),'Invalid observation '+name);
      const ticks=item.ticks===undefined?defaults:schedule(item.ticks);
      check(ticks,'No tick schedule for observation '+name);
      const {ticks:ignored,...definition}=item;
      return {id:name,...definition,...(item.path!==undefined&&{path:selector(item.path)}),ticks};
    });

    check(record(bindings)&&Object.keys(bindings).length<=16,'Invalid sweep parameter bindings');
    const parameters=Object.entries(bindings).map(([name,item])=>{
      check(id(name)&&shape(item,['path','port','tick','values'])&&
        (item.path===undefined)!==(item.port===undefined)&&
        Array.isArray(item.values)&&item.values.length>0&&item.values.length<=maxRuns&&
        (item.tick===undefined||item.port!==undefined&&tickOK(item.tick)&&item.tick>0),'Invalid sweep parameter '+name);
      if(item.port!==undefined)endpoint(item.port);
      return {name,...item,...(item.path!==undefined&&{path:selector(item.path).map(String)})};
    });
    check(new Set(parameters.map(item=>item.port??JSON.stringify(item.path))).size===parameters.length,
      'Sweep parameters need distinct paths or ports');
    check(Array.isArray(cases)&&cases.length>0&&cases.length<=maxRuns&&cases.every(row=>
      shape(row,['id','edits','actions'])&&id(row.id)&&Array.isArray(row.edits??[])&&Array.isArray(row.actions??[]))&&
      new Set(cases.map(row=>row.id)).size===cases.length,'Sweep cases need distinct IDs and optional edits and actions');
    const runCount=parameters.reduce((n,item)=>n*item.values.length,cases.length*(seeds?.length??1));
    const samples=observations.reduce((sum,row)=>sum+row.ticks.length,0);
    check(runCount<=maxRuns&&runCount*samples<=maxSamples,'Observation sweep exceeds the run or sample budget');

    let combinations=[[]];
    for(const parameter of parameters)combinations=combinations.flatMap(items=>parameter.values.map(value=>
      [...items,{name:parameter.name,path:parameter.path,port:parameter.port,tick:parameter.tick,value}]));
    const slots=observations.flatMap(observation=>observation.ticks.map(tick=>({tick,observation}))).sort((a,b)=>a.tick-b.tick);
    const groups=cases.flatMap(row=>combinations.map((entries,index)=>({
      id:parameters.length?row.id+':'+(index+1):row.id, case:row.id,
      parameters:Object.fromEntries(entries.map(({name,value})=>[name,value])),
      edits:[...(row.edits??[]),...entries.filter(entry=>entry.path).map(({path,value})=>({op:'set',path,value}))],
      actions:row.actions??[], ports:entries.filter(entry=>entry.port!==undefined)
    })));
    const definitions=freeze(observations);
    return Object.freeze({observations:definitions,run(source,options){
      return execute(source,{seeds,actions,slots,groups,observations:definitions},options);
    }});
  }

  function sample(query,observation) {
    const {field,at,args,path}=observation, result=query.probe(field,at,args);
    if(result.status!=='ok')return result;
    const value=path===undefined?result.value:read(result.value,path);
    return value===undefined?W.query.missing('Observation value is unavailable','missing'):{...result,value};
  }

  function summarize(slots,runs) {
    return slots.map(({tick,observation},index)=>{
      const readings=runs.map(run=>run.samples[index]), available=readings.filter(row=>row.status==='ok');
      const units=new Set(available.map(row=>row.units));
      const numbers=available.filter(row=>Number.isFinite(row.value)).map(row=>row.value);
      let numeric=null;
      if(units.size<=1&&numbers.length){
        const min=Math.min(...numbers), max=Math.max(...numbers);
        const total=numbers.reduce((sum,value)=>sum+value,0), magnitude=Math.max(Math.abs(min),Math.abs(max));
        const mean=Number.isFinite(total)?total/numbers.length:Math.max(min,Math.min(max,magnitude*
          (numbers.reduce((sum,value)=>sum+value/magnitude,0)/numbers.length)));
        numeric={count:numbers.length,min,max,mean};
      }
      return {observation:observation.id,tick,time:readings[0].time,count:readings.length,available:available.length,
        units:units.size===1?[...units][0]:null,...(units.size>1&&{mixedUnits:true}),numeric};
    });
  }

  function execute(source,plan,{runtime={},actions=[]}={}) {
    check(record(runtime)&&Array.isArray(actions),'Invalid observation runtime or actions');
    const checkpoint=source?.format===R.runFormat?source.end:source?.format===R.checkpointFormat?source:undefined;
    check(source?.format!==R.runFormat||source.version===1&&checkpoint?.format===R.checkpointFormat,
      'Invalid recording endpoint for observation sweep');
    const world=checkpoint?.world??W.manifest(source), fromTick=checkpoint?.tick??0;
    check(plan.slots[0].tick>=fromTick,'Observation tick precedes the starting checkpoint');
    if(checkpoint)check(plan.groups.every(row=>!row.edits.length)&&
      (plan.seeds===undefined||plan.seeds.length===1&&plan.seeds[0]===world.seed),
    'Checkpoint observations can vary scheduled inputs and actions only');
    const runs=[], groups=[];
    for(const group of plan.groups){
      const authored=group.edits.length?W.manifest(W.apply(world,group.edits).world):world;
      const groupRuns=[];
      for(const seed of plan.seeds??[authored.seed]){
        const id=group.id+'@'+seed;
        try {
          const run=R.create(seed===authored.seed?authored:{...authored,seed},{...runtime,checkpoint});
          run.schedule([...actions,...plan.actions,...group.actions,...group.ports.map(({port,value,tick})=>
            ({tick:tick??fromTick+1,action:'world/input',args:{port,value}}))]);
          const measurements=[], {dt}=run.view().world;
          let currentTick=fromTick, query=run.query();
          const units=new Map(plan.observations.map(({id,field,path,units})=>{
            const actual=path===undefined?query.field(field)?.units??null:null;
            check(units===undefined||actual===null||actual===units,'Observation '+id+' units do not match '+field);
            return [id,units??actual];
          }));
          for(const {tick,observation} of plan.slots){
            if(currentTick!==tick){
              run.advance(tick);
              query=run.query();
              currentTick=tick;
            }
            const reading=sample(query,observation);
            measurements.push({...reading,observation:observation.id,tick,time:tick*dt,units:units.get(observation.id)});
          }
          const result={id,group:group.id,seed,fromTick,toTick:currentTick,dt,samples:measurements};
          runs.push(result);
          groupRuns.push(result);
        }catch(error){throw Error('Sweep run '+id+': '+error.message,{cause:error});}
      }
      groups.push({id:group.id,case:group.case,parameters:group.parameters,runs:groupRuns.map(row=>row.id),
        summary:summarize(plan.slots,groupRuns)});
    }
    return freeze({format,version:1,world:world.id,observations:plan.observations,runs,groups});
  }

  W.observations=Object.freeze({format,prepare,run:(source,spec,options)=>prepare(spec).run(source,options)});
})(KIT);
