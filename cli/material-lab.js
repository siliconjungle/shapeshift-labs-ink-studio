const fs=require('node:fs'),path=require('node:path');
const files=require('./asset-files.js');
const {graphOutputs}=require('./graph-outputs.js');
const {claim}=require('./graph-batch.js');
const format='ink-studio/material-lab-plan';
const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;

function read(file){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);
  try{
    const stat=fs.fstatSync(fd), max=2*1024*1024;
    if(!stat.isFile()||stat.size>max)throw new RangeError('Need a material lab plan within 2 MiB');
    const bytes=fs.readFileSync(fd);
    if(bytes.length>max)throw new RangeError('Material lab plan exceeds 2 MiB');
    return JSON.parse(bytes);
  }finally{fs.closeSync(fd);}
}

function open(kit,source){
  const {KIT:{world:W}}=kit, {record,id}=W.data;
  if(!record(source)||source.format!==format||source.version!==1||!id(source.id)||
      Object.keys(source).some(key=>!['format','version','id','config','run'].includes(key))||
      !record(source.config)||!record(source.run??{}))
    throw new TypeError('Expected a version 1 material lab plan');
  const {dt=1/60,ticks=120,every=4,commands=[],checkpoints=[],maxTotalWork=36000000}=source.run??{};
  if(Object.keys(source.run??{}).some(key=>!['dt','ticks','every','commands','checkpoints','maxTotalWork'].includes(key))||
      !Number.isFinite(dt)||dt<1/2000||dt>.125||!integer(ticks,0,600)||!integer(every,1,600)||
      !integer(maxTotalWork,1,90000000)||!Array.isArray(checkpoints)||checkpoints.length>24||
      new Set(checkpoints).size!==checkpoints.length||!checkpoints.every(n=>integer(n,0,ticks))||
      !Array.isArray(commands)||commands.length>1024||commands.some(row=>!record(row)||!integer(row.tick,1,ticks)||
        !['anchor','move-surface','impulse','drive'].includes(row.action)||!record(row.args)||
        Object.keys(row).some(k=>!['tick','action','args'].includes(k))))
    throw new RangeError('Material lab run needs bounded clocks, commands, checkpoints and work');
  const world={format:W.format,version:1,id:source.id,dt,systems:{lab:{kind:'material-lab',config:source.config}},
    commands:commands.map(row=>({...row,action:'lab/'+row.action}))};
  const run=W.runtime.create(world), preparation=run.query().probe('lab/preparation').value;
  return {run,world,preparation,ticks,every,checkpoints,maxTotalWork};
}

function execute(input,{artifacts=false}={}){
  const {run,world,preparation,ticks,every,checkpoints,maxTotalWork}=input,
    frames=[], output=[], totals=new Map(), inspection=new Set(checkpoints);
  let used=0,maxTick=0,recorded=0,omitted=0,speedLimited=0,maxPenetration=0;
  for(let tick=0;tick<=ticks;tick++){
    if(tick)run.step();
    const query=run.query(), get=field=>query.probe('lab/'+field).value, work=get('work'), report=get('contact-report');
    used+=work.used;
    if(used>maxTotalWork)throw new RangeError('Material lab run exceeded its total work budget at tick '+tick);
    maxTick=Math.max(maxTick,work.used);
    recorded+=report.recorded;omitted+=report.omitted;speedLimited+=report.speedLimited;
    maxPenetration=Math.max(maxPenetration,report.maxPenetration);
    for(const [pair,row] of Object.entries(report.pairs)){
      const prior=totals.get(pair)??{pair,coefficients:row.coefficients,count:0,normalImpulse:0,tangentImpulse:0,
        slipBefore:0,slipAfter:0,peakPenetration:0,sliding:0,stuck:0};
      for(const key of ['count','normalImpulse','tangentImpulse','slipBefore','slipAfter','sliding','stuck'])
        prior[key]+=row[key];
      prior.peakPenetration=Math.max(prior.peakPenetration,row.peakPenetration);
      totals.set(pair,prior);
    }
    if(inspection.has(tick)&&artifacts)output.push({file:'checkpoints/'+tick+'.json',document:run.checkpoint()});
    const sampled=tick%every===0||inspection.has(tick)||tick===ticks;
    if(!sampled)continue;
    frames.push({tick,time:tick*world.dt,work,contact:report,points:get('points'),strain:get('strain'),
      surfaces:get('surfaces'),constraints:get('constraints'),samples:get('contacts')});
  }
  const summary={work:{used,maxTick,perTickBudget:preparation.settings.maxWork,totalBudget:maxTotalWork},
    contact:{pairs:Object.fromEntries([...totals].sort(([a],[b])=>a<b?-1:a>b?1:0)),recorded,omitted,maxPenetration},
    speedLimited};
  const report={format:'ink-studio/material-lab-report',version:1,id:world.id,dt:world.dt,ticks,every,
    checkpoints:checkpoints.slice().sort((a,b)=>a-b),summary,frames};
  if(artifacts)output.push({file:'preparation.json',document:preparation},{file:'materials.world.json',document:world},
    {file:'materials.run.json',document:run.recording()},{file:'report.json',document:report});
  return {report,output};
}

function command([mode,input,...extra],opt,kit){
  if(!['presets','compile','run'].includes(mode)||(mode==='presets'?input!==undefined:typeof input!=='string')||extra.length||
      Object.entries(opt).some(([key,value])=>key!=='out'||typeof value!=='string'||!value.trim()))
    throw new TypeError('Use material-lab presets [--out file] or material-lab compile|run <plan.json> [--out path]');
  const out=opt.out&&path.resolve(opt.out), print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
  if(mode==='presets'){
    const presets=kit.KIT.world.materialConstraints.presets;
    if(out)files.json(out,presets);
    else print(presets);
    return;
  }
  const file=path.resolve(input), opened=open(kit,read(file)), destinations=graphOutputs([file]);
  if(mode==='compile'){
    if(out){
      destinations.protect(fs.statSync(out,{throwIfNoEntry:false}));
      files.json(out,opened.world);
    }else print(opened.world);
    return;
  }
  const {report,output}=execute(opened,{artifacts:!!out});
  if(out){
    const release=claim(out,'material lab run');
    try{destinations.write(out,output);}
    finally{release();}
  }else print(report);
}

module.exports={open,execute,command};
