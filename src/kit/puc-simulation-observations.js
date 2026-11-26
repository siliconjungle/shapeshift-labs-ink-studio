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

  function measurements({ticks,observations:definitions}) {
    const defaults=ticks===undefined?null:schedule(ticks);
    check(record(definitions)&&Object.keys(definitions).length>0&&
      Object.keys(definitions).length<=128,'An observation plan needs 1–128 named observations');
    const observations=Object.entries(definitions).map(([name,item])=>{
      check(id(name)&&shape(item,['field','at','args','path','ticks','units'])&&typeof item.field==='string'&&
        item.field.length>0&&(item.args===undefined||record(item.args))&&
        (item.units===undefined||typeof item.units==='string'&&item.units.trim().length>0),'Invalid observation '+name);
      const sampleTicks=item.ticks===undefined?defaults:schedule(item.ticks);
      check(sampleTicks,'No tick schedule for observation '+name);
      const {ticks:ignored,...definition}=item;
      return {id:name,...definition,...(item.path!==undefined&&{path:selector(item.path)}),ticks:sampleTicks};
    });
    const count=observations.reduce((sum,row)=>sum+row.ticks.length,0);
    check(count<=maxSamples,'Observation plan exceeds the sample budget');
    const slots=observations.flatMap(observation=>observation.ticks.map(tick=>({tick,observation}))).sort((a,b)=>a.tick-b.tick);
    function reader(query){
      const units=new Map(observations.map(({id,field,path,units})=>{
        const actual=path===undefined?query.field(field)?.units??null:null;
        check(units===undefined||actual===null||actual===units,'Observation '+id+' units do not match '+field);
        return [id,units??actual];
      }));
      return (query,{tick,observation},dt)=>({...sample(query,observation),
        observation:observation.id,tick,time:tick*dt,units:units.get(observation.id)});
    }
    return {observations,slots,reader};
  }

  function canonical(value) {
    return JSON.stringify(value, (_, item) => record(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
  }

  function sampleId(caseId, seed, parameters) {
    const key = canonical(['ink-sweep-sample-v1',caseId,seed,parameters]);
    let hash = 0xcbf29ce484222325n;
    for (let i = 0; i < key.length; i++)
      hash = BigInt.asUintN(64,(hash ^ BigInt(key.charCodeAt(i))) * 0x100000001b3n);
    return 'sample-' + hash.toString(16).padStart(16,'0');
  }

  const comparison = {
    eq: W.data.equal,
    ne: (a,b) => !W.data.equal(a,b),
    lt: (a,b) => a < b,
    lte: (a,b) => a <= b,
    gt: (a,b) => a > b,
    gte: (a,b) => a >= b
  };

  function constraintsFor(rows, parameters) {
    const names = new Set(parameters.map(row => row.name));
    check(Array.isArray(rows) && rows.length <= 64, 'A sweep accepts up to 64 constraints');
    return rows.map(row => {
      check(shape(row,['left','op','right']) && names.has(row.left) && own(comparison,row.op) &&
        shape(row.right,['parameter','value']) && (own(row.right,'parameter') !== own(row.right,'value')) &&
        (!own(row.right,'parameter') || names.has(row.right.parameter)),
      'Sweep constraints need named parameters, a supported comparison and a parameter or value');
      const { left, op, right } = row;
      return values => {
        const a = values[left], b = own(right,'parameter') ? values[right.parameter] : right.value;
        return (op === 'eq' || op === 'ne' || Number.isFinite(a) && Number.isFinite(b)) && comparison[op](a,b);
      };
    });
  }

  function parameterValues(row, random) {
    if (row.values !== undefined) return row.values;
    const { min, max, steps } = row.range;
    check(shape(row.range,['min','max','steps']) && Number.isFinite(min) && Number.isFinite(max) &&
      Number.isFinite(max - min) && max > min &&
      (steps === undefined ? random : Number.isSafeInteger(steps) && steps >= 2 && steps <= maxRuns),
    'Invalid sweep range for ' + row.name);
    if (steps === undefined) return;
    return Array.from({ length:steps }, (_, i) => i === steps - 1 ? max : min + (max - min) * (i / (steps - 1)));
  }

  function combinationsFor(parameters, constraints, sampling, capacity) {
    const random = sampling !== undefined;
    const accepts = row => {
      if (!constraints.length) return true;
      const values = Object.fromEntries(row.map(({ name,value }) => [name,value]));
      return constraints.every(test => test(values));
    };
    const axes = parameters.map(parameter => ({ ...parameter, values: parameterValues(parameter,random) }));
    if (!random) {
      check(axes.reduce((count,row) => count * row.values.length,1) <= (constraints.length ? maxRuns : capacity),
        'Sweep exceeds the run or constraint search budget');
      const grid = axes.reduce((rows,{ values,...axis }) =>
        rows.flatMap(row => values.map(value => [...row,{ ...axis,value }])),[[]]);
      const result = grid.filter(accepts);
      check(result.length && result.length <= capacity, 'Sweep has no eligible runs or exceeds the run budget');
      return result;
    }
    check(shape(sampling,['count','seed']) && parameters.length && Number.isSafeInteger(sampling.seed) &&
      Number.isSafeInteger(sampling.count) && sampling.count > 0 && sampling.count <= capacity,
    'Random sweep needs a safe seed and a sample count within the run budget');
    const rng = K.random.create(sampling.seed);
    const draw = axes.map(axis => {
      const stream = rng.stream('sweep',axis.name);
      return index => {
        const sample = stream.at(index);
        const values = axis.values;
        const value = values ? values[Math.floor(sample * values.length)] :
          axis.range.min + sample * (axis.range.max - axis.range.min);
        return { ...axis,value };
      };
    });
    const rows = [], seen = new Set();
    const attempts = Math.min(65536,Math.max(256,sampling.count * 96));
    for (let attempt = 0; attempt < attempts && rows.length < sampling.count; attempt++) {
      const row = draw.map(sample => sample(attempt));
      if (!accepts(row)) continue;
      const key = canonical(row.map(entry => entry.value));
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    check(rows.length === sampling.count, 'Random sweep could not fill its distinct sample count inside the search budget');
    return rows;
  }

  function matrix(input,{scene=false,limit=maxRuns}={}) {
    const {seeds,parameters:bindings={},cases=[{id:'base'}],constraints=[],sampling,runBudget=limit}=copy(input);
    check(Number.isSafeInteger(limit)&&limit>0&&limit<=maxRuns&&Number.isSafeInteger(runBudget)&&runBudget>0&&runBudget<=limit,
      'Invalid sweep run budget');
    check(seeds===undefined||Array.isArray(seeds)&&seeds.length>0&&seeds.length<=maxRuns&&
      seeds.every(Number.isSafeInteger)&&new Set(seeds).size===seeds.length,'Sweep seeds need distinct safe integers');

    check(record(bindings)&&Object.keys(bindings).length<=16,'Invalid sweep parameter bindings');
    const parameters=Object.entries(bindings).map(([name,item])=>{
      const binding=scene?shape(item,['path','values','range']):
        shape(item,['path','port','tick','values','range'])&&(item.path===undefined)!==(item.port===undefined)&&
        (item.tick===undefined||item.port!==undefined&&tickOK(item.tick)&&item.tick>0);
      check(id(name)&&binding&&(own(item,'values')!==own(item,'range'))&&
        (own(item,'values') ? Array.isArray(item.values)&&item.values.length>0&&item.values.length<=maxRuns : record(item.range)),
        'Invalid sweep parameter '+name);
      if(item.port!==undefined)endpoint(item.port);
      const path=item.path===undefined&&scene?[name]:item.path;
      return {name,...item,...(path!==undefined&&{path:selector(path).map(String)})};
    });
    check(new Set(parameters.map(item=>item.port??JSON.stringify(item.path))).size===parameters.length,
      'Sweep parameters need distinct paths or ports');
    const caseShape=scene?['id','controls']:['id','edits','actions'];
    check(Array.isArray(cases)&&cases.length>0&&cases.length<=maxRuns&&cases.every(row=>
      shape(row,caseShape)&&id(row.id)&&(scene?record(row.controls??{}):
        Array.isArray(row.edits??[])&&Array.isArray(row.actions??[])))&&
      new Set(cases.map(row=>row.id)).size===cases.length,'Sweep cases need distinct IDs and valid case settings');
    const repeats=cases.length*(seeds?.length??1);
    const combinations=combinationsFor(parameters,constraintsFor(constraints,parameters),sampling,Math.floor(runBudget/repeats));
    const runCount=combinations.length*repeats;
    const groups=cases.flatMap(row=>combinations.map((entries,index)=>({
      id:parameters.length?row.id+':'+(index+1):row.id, case:row.id,
      parameters:Object.fromEntries(entries.map(({name,value})=>[name,value])),
      edits:[...(row.edits??[]),...entries.filter(entry=>entry.path).map(({path,value})=>({op:'set',path,value}))],
      actions:row.actions??[], ports:entries.filter(entry=>entry.port!==undefined),
      ...(scene&&{controls:row.controls??{}})
    })));
    return {seeds,groups,runCount};
  }

  function prepare(input,{visual=false,limit=maxRuns}={}) {
    check(shape(input,['ticks','observations','seeds','parameters','cases','actions','constraints','sampling','runBudget']),'Invalid observation sweep plan');
    const spec=copy(input), {actions=[]}=spec;
    const {observations,slots,reader}=visual&&spec.observations===undefined
      ? {observations:[],slots:[],reader:null}:measurements(spec);
    check(Array.isArray(actions),'Sweep actions need a command list');
    const {seeds,groups,runCount}=matrix(spec,{limit});
    check(runCount*slots.length<=maxSamples,'Observation sweep exceeds the sample budget');
    const definitions=freeze(observations);
    return Object.freeze({observations:definitions,runCount,run(source,options){
      return execute(source,{seeds,actions,slots,groups,observations:definitions,reader},options);
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

  function execute(source,plan,{runtime={},actions=[],capture}={}) {
    check(record(runtime)&&Array.isArray(actions)&&
      (capture===undefined||typeof capture?.frame==='function'),'Invalid observation runtime, actions or frames');
    const captureTicks=new Set(capture===undefined?[]:schedule(capture.ticks));
    const slots=new Map();
    for(const slot of plan.slots){
      if(!slots.has(slot.tick))slots.set(slot.tick,[]);
      slots.get(slot.tick).push(slot);
    }
    const ticks=[...new Set([...slots.keys(),...captureTicks])].sort((a,b)=>a-b);
    check(ticks.length,'A sweep needs observations or captured frames');
    check(plan.groups.length*(plan.seeds?.length??1)*(plan.slots.length+captureTicks.size)<=maxSamples,
      'Sweep exceeds the combined observation and capture budget');
    const checkpoint=source?.format===R.runFormat?source.end:source?.format===R.checkpointFormat?source:undefined;
    check(source?.format!==R.runFormat||source.version===1&&checkpoint?.format===R.checkpointFormat,
      'Invalid recording endpoint for observation sweep');
    const world=checkpoint?.world??W.manifest(source), fromTick=checkpoint?.tick??0;
    check(ticks[0]>=fromTick,'Observation tick precedes the starting checkpoint');
    if(checkpoint)check(plan.groups.every(row=>!row.edits.length)&&
      (plan.seeds===undefined||plan.seeds.length===1&&plan.seeds[0]===world.seed),
    'Checkpoint observations can vary scheduled inputs and actions only');
    const runs=[], groups=[];
    for(const group of plan.groups){
      const authored=group.edits.length?W.manifest(W.apply(world,group.edits).world):world;
      const groupRuns=[];
      for(const seed of plan.seeds??[authored.seed]){
        const id=group.id+'@'+seed, stableId=sampleId(group.case,seed,group.parameters);
        try {
          const run=R.create(seed===authored.seed?authored:{...authored,seed},{...runtime,checkpoint});
          run.schedule([...actions,...plan.actions,...group.actions,...group.ports.map(({port,value,tick})=>
            ({tick:tick??fromTick+1,action:'world/input',args:{port,value}}))]);
          const measurements=[], {dt}=run.view().world;
          let currentTick=fromTick, query=run.query();
          const readObservation=plan.reader?.(query);
          for(const tick of ticks){
            if(currentTick!==tick){
              run.advance(tick);
              query=run.query();
              currentTick=tick;
            }
            for(const slot of slots.get(tick)??[])measurements.push(readObservation(query,slot,dt));
            if(captureTicks.has(tick))capture.frame(run.view(),query,{
              id,sampleId:stableId,case:group.case,parameters:copy(group.parameters),seed,tick,dt
            });
          }
          const result={id,sampleId:stableId,group:group.id,seed,fromTick,toTick:currentTick,dt,samples:measurements};
          runs.push(result);
          groupRuns.push(result);
        }catch(error){throw Error('Sweep run '+id+': '+error.message,{cause:error});}
      }
      groups.push({id:group.id,case:group.case,parameters:group.parameters,runs:groupRuns.map(row=>row.id),
        summary:summarize(plan.slots,groupRuns)});
    }
    return freeze({format,version:1,world:world.id,observations:plan.observations,runs,groups});
  }

  W.observations=Object.freeze({format,prepare,measurements,matrix,schedule,sampleId,run:(source,spec,options)=>prepare(spec).run(source,options)});
})(KIT);
