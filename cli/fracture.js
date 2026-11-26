const fs=require('node:fs'),path=require('node:path');
const {graphOutputs}=require('./graph-outputs.js');
const {claim}=require('./graph-batch.js');
const files=require('./asset-files.js');

const reportFormat='ink-studio/fracture-report';
const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const allowed=(row,keys)=>row!==null&&typeof row==='object'&&!Array.isArray(row)&&
  Object.keys(row).every(key=>keys.includes(key));

function read(file) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);
  try {
    const stat=fs.fstatSync(fd), budget=512*1024;
    if(!stat.isFile()||stat.size>budget)throw new RangeError('Fracture plans need a regular JSON file within 512 KiB');
    const bytes=fs.readFileSync(fd);
    if(bytes.length>budget)throw new RangeError('Fracture plan exceeds 512 KiB');
    return JSON.parse(bytes);
  }finally{fs.closeSync(fd);}
}

function open(kit,source){
  if(!source||typeof source!=='object'||Array.isArray(source))
    throw new TypeError('Expected a fracture plan object');
  const {simulation={},...plan}=source, W=kit.KIT.world;
  if(!allowed(simulation,['dt','ticks','sampleEvery','checkpoints','settings','loads','visual']))
    throw new TypeError('Invalid fracture simulation settings');
  const {dt=1/60,ticks=120,sampleEvery=4,checkpoints=[],settings={},loads=[],visual}=simulation;
  if(!Number.isFinite(dt)||dt<1/480||dt>.25||!integer(ticks,0,720)||!integer(sampleEvery,1,720)||
      !Array.isArray(checkpoints)||checkpoints.length>32||!checkpoints.every(tick=>integer(tick,0,ticks))||
      new Set(checkpoints).size!==checkpoints.length||!Array.isArray(loads)||loads.length>256||
      !allowed(settings,['ground','gravity','drag','contactIterations','motionRate','skin']))
    throw new RangeError('Fracture simulation needs bounded clocks, load changes and checkpoints');
  const commands=loads.map(row=>{
    if(!allowed(row,['tick','bond','tension','shear','bend'])||!integer(row.tick,1,ticks))
      throw new RangeError('Each fracture load needs a tick inside the run');
    const {tick,...args}=row;
    return {tick,action:'failure/load',args};
  });
  const world={format:W.format,version:1,id:plan.id,dt,
    systems:{failure:{kind:'material-failure',config:{...settings,plan}}},commands,
    ...(visual!==undefined&&{visual})};
  const run=W.runtime.create(world);
  const prepared=run.query().probe('failure/preparation').value;
  return {run,world,prepared,ticks,sampleEvery,checkpoints:new Set(checkpoints)};
}

function execute(input,{artifacts=false}={}){
  const {run,world,prepared,ticks,sampleEvery,checkpoints}=input, captures=[], events=[], output=[];
  for(let tick=0;tick<=ticks;tick++){
    if(tick)run.step();
    const changes=run.events.filter(row=>row.kind.startsWith('fracture-'));
    events.push(...changes);
    if(checkpoints.has(tick)&&artifacts)output.push({file:'checkpoints/'+tick+'.json',document:run.checkpoint()});
    const query=run.query(), inspect=field=>query.probe('failure/'+field).value;
    const contacts=inspect('contacts'), limited=inspect('contact-limited');
    if(tick%sampleEvery!==0&&tick!==ticks&&!checkpoints.has(tick)&&!changes.length&&!contacts.length&&!limited)continue;
    const islands=inspect('islands');
    const groups=Object.values(islands).map(({id,parent,members,body})=>({
      id,parent,members,mass:body.mass,center:body.position,velocity:body.velocity,angular:body.angular
    }));
    captures.push({tick,time:tick*world.dt,groups,pieces:inspect('pieces'),constraints:inspect('constraints'),
      contacts,'contact-limited':limited});
  }
  const last=captures.at(-1), mass=Object.values(last.pieces).reduce((total,row)=>total+row.mass,0);
  const report={format:reportFormat,version:1,id:prepared.id,dt:world.dt,ticks,
    prepared:{cells:Object.keys(prepared.cells).length,bonds:prepared.bonds.length,mass:prepared.mass,volume:prepared.volume},
    checkpoints:[...checkpoints].sort((a,b)=>a-b),captures,events,
    end:{mass,massError:mass-prepared.mass,broken:last.constraints.filter(row=>row.broken).map(row=>row.id)}};
  if(artifacts)output.push({file:'preparation.json',document:prepared},{file:'fracture.world.json',document:world},
    {file:'fracture.run.json',document:run.recording()},{file:'report.json',document:report});
  return {report,output};
}

function command([mode,source,...extra],opt,kit){
  if(!['prepare','compile','run'].includes(mode)||typeof source!=='string'||extra.length||
      Object.entries(opt).some(([key,value])=>key!=='out'||typeof value!=='string'||!value.trim()))
    throw new TypeError('Use fracture prepare|compile|run <plan.json> [--out path]');
  const file=path.resolve(source), opened=open(kit,read(file)), out=opt.out&&path.resolve(opt.out);
  if(mode==='run'){
    const {report,output}=execute(opened,{artifacts:!!out});
    if(!out)process.stdout.write(JSON.stringify(report,null,2)+'\n');
    else{
      const release=claim(out,'fracture run');
      try{graphOutputs([file]).write(out,output);}
      finally{release();}
    }
    return;
  }
  const answer=mode==='prepare'?opened.prepared:opened.world;
  if(!out)process.stdout.write(JSON.stringify(answer,null,2)+'\n');
  else{
    graphOutputs([file]).protect(fs.statSync(out,{throwIfNoEntry:false}));
    files.json(out,answer);
  }
}

module.exports={open,execute,command};
