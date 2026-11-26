const fs=require('node:fs'),path=require('node:path');
const files=require('./asset-files.js'), cache=require('./atmosphere-cache.js');
const {graphOutputs}=require('./graph-outputs.js'), {claim}=require('./graph-batch.js');
const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const fields=(row,keys)=>row!==null&&typeof row==='object'&&!Array.isArray(row)&&
  Object.keys(row).every(key=>keys.includes(key));

function open(kit,source){
  const W=kit.KIT.world;
  if(!fields(source,['format','version','id','seed','config','run'])||source.format!=='ink-studio/atmosphere-3d-plan'||
    source.version!==1||!W.data.id(source.id)||!Number.isSafeInteger(source.seed??1)||!W.data.record(source.config)||
    !fields(source.run??{},['dt','ticks','every','frames','commands','maxWork','upRes']))
    throw new TypeError('Expected a version 1 sparse atmosphere plan');
  const {dt=1/36,ticks=60,every=4,commands=[],frames=[],maxWork=880000000,upRes}=source.run??{};
  if(!Number.isFinite(dt)||dt<.00025||dt>.2||!integer(ticks,0,360)||!integer(every,1,360)||!integer(maxWork,1,3900000000)||
    !Array.isArray(frames)||frames.length>119||!frames.every(t=>integer(t,0,ticks))||new Set(frames).size!==frames.length||
    !Array.isArray(commands)||commands.length>512||commands.some(row=>!fields(row,['tick','action','args'])||
      !integer(row.tick,1,ticks)||row.action!=='gain'||!W.data.record(row.args)))
    throw new RangeError('Atmosphere plan needs bounded clocks, commands and frame requests');
  const schedule=new Set([0,ticks,...frames]);
  for(let tick=0;tick<ticks;tick+=every)schedule.add(tick);
  if(schedule.size>121)throw new RangeError('Atmosphere cache has too many requested frames');
  const world={format:W.format,version:1,id:source.id,seed:source.seed??1,dt,
    systems:{atmosphere:{kind:'sparse-atmosphere',config:source.config}},
    commands:commands.map(row=>({...row,action:'atmosphere/gain'}))};
  const detail=upRes===undefined?null:W.atmosphere.options(upRes);
  const run=W.runtime.create(world);
  return {run,world,ticks,schedule,maxWork,upRes:detail,preparation:run.query().probe('atmosphere/preparation').value};
}

function bake(kit,input,directory){
  const {run,world,ticks,schedule,maxWork,upRes,preparation}=input, V=kit.KIT.procedural.sparseVolume;
  const save=cache.writer(directory), frames=[], summary={logicalCells:preparation.grid.size.reduce((a,b)=>a*b,1),
    peakActive:0,peakBricks:0,peakTemperature:preparation.settings.ambient,peakDensity:0,before:0,after:0,work:0,maxWork,
    retainedComponents:0,reaction:{fuelBurned:0,smokeMade:0,condensed:0,evaporated:0},
    maxBalanceError:{density:0,fuel:0,vapor:0},peakChildCells:0,peakDetailRms:0,peakRefinementDrift:0};
  function budget(count){
    summary.retainedComponents+=count;
    if(summary.retainedComponents>27500000)throw new RangeError('Atmosphere cache exceeds its stored-component budget');
  }
  for(let tick=0;tick<=ticks;tick++){
    if(tick)run.step();
    const query=run.query(), quality=query.probe('atmosphere/report').value, {pressure,reaction,balance}=quality;
    summary.work+=quality.work.used;
    if(summary.work>maxWork)throw new RangeError('Atmosphere run exceeded its total work budget at tick '+tick);
    summary.peakActive=Math.max(summary.peakActive,quality.activeCells);
    summary.peakBricks=Math.max(summary.peakBricks,quality.activeBricks);
    summary.peakTemperature=Math.max(summary.peakTemperature,quality.temperaturePeak);
    summary.peakDensity=Math.max(summary.peakDensity,quality.densityPeak);
    summary.before+=pressure.before;summary.after+=pressure.after;
    for(const key of Object.keys(summary.reaction))summary.reaction[key]+=reaction[key];
    for(const key of Object.keys(summary.maxBalanceError))
      summary.maxBalanceError[key]=Math.max(summary.maxBalanceError[key],Math.abs(balance[key].error));
    if(!schedule.has(tick))continue;
    const time=tick*world.dt, volume=query.probe('atmosphere/volume').value;
    budget(V.inspect(volume).storedComponents);
    const row={tick,time,checkpoint:save.remember(run.checkpoint(),'checkpoints/'+tick+'.json'),base:cache.hash(cache.serial(volume)),quality};
    if(upRes){
      const {document,report}=kit.KIT.world.atmosphere.upRes(volume,upRes,{seed:world.seed,time});
      budget(V.inspect(document).storedComponents);
      row.detail=save.detail(document);row.upRes=report;
      summary.peakChildCells=Math.max(summary.peakChildCells,report.childCells);
      summary.peakDetailRms=Math.max(summary.peakDetailRms,report.densityDetailRms);
      summary.peakRefinementDrift=Math.max(summary.peakRefinementDrift,...Object.values(report.mass).map(row=>Math.abs(row.relativeError)));
    }
    frames.push(row);
  }
  const recording=save.remember(run.recording(),'run.json');
  summary.before/=Math.max(1,ticks);summary.after/=Math.max(1,ticks);
  const index={format:cache.format,version:1,id:world.id,mode:preparation.mode,seed:world.seed,dt:world.dt,ticks,store:'blocks',recording,
    ...(upRes&&{upRes}),settings:preparation,frames,summary};
  save.publish();
  files.json(path.join(directory,'atmosphere.world.json'),world);
  files.json(path.join(directory,'cache.json'),index);
  return index;
}

function command([action,...args],opt,kit){
  const modes={compile:1,bake:1,playback:1,verify:1,refine:2}, allowed=['out'];
  if(action==='playback')allowed.push('tick','time','level','blend','report');
  if(action==='refine')allowed.push('report');
  if(!Object.hasOwn(modes,action)||args.length!==modes[action]||Object.entries(opt).some(([key,value])=>
    !allowed.includes(key)||typeof value!=='string'||!value.trim())||action==='bake'&&!opt.out)
    throw new TypeError('Use atmosphere3d compile|bake <plan.json>, playback|verify <cache.json>, or refine <volume.json> <settings.json>');
  const inputs=args.map(file=>path.resolve(file)), [source,settings]=inputs, dependencies=new Set(inputs);
  function publish(out,document,compact=false){
    if(!out){process.stdout.write(compact?cache.serial(document):JSON.stringify(document,null,2)+'\n');return;}
    const destination=path.resolve(out);
    graphOutputs([...dependencies]).protect(fs.statSync(destination,{throwIfNoEntry:false}));
    if(compact)files.write(destination,cache.serial(document));
    else files.json(destination,document);
    dependencies.add(destination);
  }
  if(action==='compile'||action==='bake'){
    const plan=open(kit,cache.read(source,24*1024**2));
    if(action==='compile')publish(opt.out,plan.world);
    else{
      const dest=path.resolve(opt.out), release=claim(dest,'atmosphere cache');
      try{
        for(const file of ['cache.json','atmosphere.world.json','run.json',...[...plan.schedule].map(tick=>'checkpoints/'+tick+'.json')])
          graphOutputs(inputs).protect(fs.statSync(path.join(dest,file),{throwIfNoEntry:false}));
        bake(kit,plan,dest);
      }finally{release();}
    }
    return;
  }
  if(action==='refine'){
    const request=cache.read(settings,1024**2), {seed,time,...options}=request??{};
    const {document,report}=kit.KIT.world.atmosphere.upRes(cache.read(source,128*1024**2),options,{seed,time});
    publish(opt.out,document,true);
    if(opt.report)publish(opt.report,report);
    return;
  }
  const take=cache.open(kit,source,file=>dependencies.add(file));
  if(action==='verify'){publish(opt.out,take.verify());return;}
  const {volume,report}=take.playback({tick:opt.tick===undefined?undefined:Number(opt.tick),
    time:opt.time===undefined?undefined:Number(opt.time),level:opt.level,blend:opt.blend});
  publish(opt.out,volume,true);
  if(opt.report)publish(opt.report,report);
}

module.exports={open,bake,command};
