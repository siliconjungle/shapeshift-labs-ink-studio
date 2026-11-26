const fs=require('node:fs'),path=require('node:path');
const files=require('./asset-files.js');
const {graphOutputs}=require('./graph-outputs.js');
const {claim}=require('./graph-batch.js');
const {resolveCheckpoint}=require('./checkpoint-file.js');
const planFormat='ink-studio/liquid-3d-plan', outputs=['surface','ocean','density','particles','secondary'];
const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const fields=(row,keys)=>row!==null&&typeof row==='object'&&!Array.isArray(row)&&
  Object.keys(row).every(key=>keys.includes(key));

function read(file,max){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size>max)throw new RangeError('Liquid input needs a regular JSON file within its byte budget');
    const bytes=fs.readFileSync(fd);
    if(bytes.length>max)throw new RangeError('Liquid input exceeds its byte budget');
    return JSON.parse(bytes);
  }finally{fs.closeSync(fd);}
}

function open(kit,source){
  const W=kit.KIT.world;
  if(!fields(source,['format','version','id','seed','config','run'])||source.format!==planFormat||source.version!==1||!W.data.id(source.id)||
      !Number.isSafeInteger(source.seed??1)||!W.data.record(source.config)||
      !fields(source.run??{},['dt','ticks','every','commands','checkpoints','captures','maxWork']))
    throw new TypeError('Expected a version 1 liquid volume plan');
  const {dt=1/48,ticks=60,every=3,commands=[],checkpoints=[],captures=[],maxWork=420000000}=source.run??{};
  if(!Number.isFinite(dt)||dt<1/4000||dt>.125||!integer(ticks,0,400)||!integer(every,1,400)||
      !integer(maxWork,1,2200000000)||!Array.isArray(checkpoints)||checkpoints.length>24||
      checkpoints.some(n=>!integer(n,0,ticks))||new Set(checkpoints).size!==checkpoints.length||
      !Array.isArray(commands)||commands.length>1024||commands.some(row=>
        !fields(row,['tick','action','args'])||!integer(row.tick,1,ticks)||!['move','focus'].includes(row.action)||!W.data.record(row.args))||
      !Array.isArray(captures)||captures.length>81||captures.some(row=>
        !fields(row,['tick','outputs'])||!integer(row.tick,0,ticks)||!Array.isArray(row.outputs)||!row.outputs.length||
        new Set(row.outputs).size!==row.outputs.length||row.outputs.some(name=>!outputs.includes(name)||name==='ocean'&&!source.config.ocean))||
      new Set(captures.map(row=>row.tick)).size!==captures.length)
    throw new RangeError('Liquid plan needs bounded clocks, commands, checkpoints and requested outputs');
  const world={format:W.format,version:1,id:source.id,seed:source.seed??1,dt,systems:{liquid:{kind:'liquid-3d',config:source.config}},
    commands:commands.map(({tick,action,args})=>({tick,action:'liquid/'+action,args}))};
  const run=W.runtime.create(world), preparation=run.query().probe('liquid/preparation').value, estimated=run.query().probe('liquid/report').value.work.estimated;
  if(ticks*estimated>maxWork)throw new RangeError('Liquid run exceeds its total work estimate');
  return {run,world,preparation,ticks,every,checkpoints,captures,maxWork};
}

function summarize(name,raw){
  if(name==='surface'||name==='ocean')return {vertices:raw.positions.length/3,triangles:raw.triangles.length/3,
    ...(raw.work&&{work:raw.work}),...(raw.report&&{blend:raw.report})};
  if(name==='density')return {shape:raw.shape,samples:raw.data.length};
  return {points:raw.length};
}

function execute(input,{artifacts=false}={}){
  const {run,world,preparation,ticks,every,checkpoints,captures,maxWork}=input,
    frames=[], output=[], schedule=new Map(captures.map(row=>[row.tick,row.outputs])), marks=new Set(checkpoints), captured=[];
  let before=0,after=0,cleared=Infinity,peakSpray=0,peakFoam=0,emitted=0,speedLimited=0,work=0,captureValues=0;
  const contacts={};
  for(let tick=0;tick<=ticks;tick++){
    if(tick)run.step();
    const query=run.query(), get=key=>query.probe('liquid/'+key).value, report=get('report');
    if(tick){
      before+=report.pressure.before;after+=report.pressure.after;work+=report.work.estimated;
      if(report.clearance!==null)cleared=Math.min(cleared,report.clearance);
      peakSpray=Math.max(peakSpray,report.spray);peakFoam=Math.max(peakFoam,report.foam);emitted+=report.emitted;
      speedLimited+=report.speedLimited;
      for(const [key,row] of Object.entries(report.contacts)){
        if(!Object.hasOwn(contacts,key))Object.defineProperty(contacts,key,{value:{count:0,peakImpact:0},enumerable:true});
        contacts[key].count+=row.count;
        contacts[key].peakImpact=Math.max(contacts[key].peakImpact,row.impact);
      }
    }
    if(marks.has(tick)&&artifacts)output.push({file:'checkpoints/'+tick+'.json',document:run.checkpoint()});
    if(tick%every===0||marks.has(tick)||schedule.has(tick)||tick===ticks)frames.push({tick,time:tick*world.dt,...report,colliders:get('colliders')});
    for(const name of schedule.get(tick)??[]){
      const data=get(name), file='frames/'+tick+'/'+name+'.json', detail=summarize(name,data);
      captureValues+=name==='surface'?detail.vertices*6+detail.triangles*3:name==='ocean'?
        detail.vertices*6+detail.triangles*3:detail.samples??detail.points*10;
      if(captureValues>6000000)throw new RangeError('Liquid run exceeded its aggregate capture budget');
      captured.push({tick,kind:name,file,...detail});
      if(artifacts)output.push({file,document:data});
    }
  }
  const report={format:'ink-studio/liquid-3d-report',version:1,id:world.id,dt:world.dt,ticks,
    checkpoints:checkpoints.slice().sort((a,b)=>a-b),captures:captured,frames,
    summary:{markers:frames[0].markers,volume:frames[0].volume,depthGrid:preparation.grid.shape,
      pressure:{before:before/Math.max(1,ticks),after:after/Math.max(1,ticks)},
      clearance:Number.isFinite(cleared)?cleared:null,contacts,peakSpray,peakFoam,emitted,speedLimited,work:{estimated:work,budget:maxWork}}};
  if(artifacts)output.push({file:'preparation.json',document:preparation},{file:'liquid.world.json',document:world},
    {file:'liquid.run.json',document:run.recording()},{file:'report.json',document:report});
  return {report,output};
}

function extract(kit,file,mode,stage,dependencies){
  const R=kit.KIT.world.runtime;
  const source=resolveCheckpoint(file,read(file,48*1024**2),{onBlock:block=>dependencies.push(block)});
  let run;
  if(source.format===R.runFormat)run=R.create(source.end.world,{checkpoint:source.end});
  else if(source.format===R.checkpointFormat)run=R.create(source.world,{checkpoint:source});
  else run=R.create(source);
  const field=run.query().probe(stage+'/'+mode);
  if(field.status!=='ok')throw new RangeError(field.reason??('Liquid output '+mode+' is unavailable'));
  return field.value;
}

function command([mode,source,...extra],opt,kit){
  const capture=outputs.includes(mode);
  if((!capture&&!['compile','run'].includes(mode))||typeof source!=='string'||extra.length||
      Object.entries(opt).some(([key,value])=>(key!=='out'&&!(capture&&key==='stage'))||typeof value!=='string'||!value.trim()))
    throw new TypeError('Use liquid3d compile|run <plan.json> or liquid3d surface|ocean|density|particles|secondary <native source> [--out path]');
  const file=path.resolve(source), out=opt.out&&path.resolve(opt.out), dependencies=[file],
    print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
  function publish(value){
    if(!out){print(value);return;}
    graphOutputs(dependencies).protect(fs.statSync(out,{throwIfNoEntry:false}));
    if((mode==='surface'||mode==='ocean')&&path.extname(out).toLowerCase()==='.obj'){
      const {positions:pos,triangles:tri}=value, mats=[{name:'water'}], tmat=new Uint8Array(tri.length/3);
      files.write(out,kit.KIT.mesh.toObj({pos,tri,tmat,mats}));
    }else files.json(out,value);
  }
  if(capture){publish(extract(kit,file,mode,opt.stage??'liquid',dependencies));return;}
  const opened=open(kit,read(file,1024**2));
  if(mode==='compile'){publish(opened.world);return;}
  const {report,output}=execute(opened,{artifacts:!!out});
  if(!out)print(report);
  else{
    const release=claim(out,'liquid volume run');
    try{graphOutputs(dependencies).write(out,output);}
    finally{release();}
  }
}

module.exports={open,execute,command};
