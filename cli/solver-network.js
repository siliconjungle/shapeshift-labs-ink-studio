const fs=require('node:fs'),path=require('node:path');
const {fields,record,range,sha}=require('./character-rig-assembly.js');
const {read}=require('./character-rig-bind.js');
const {embedModels}=require('./simulation-model-files.js');
const {resolveCheckpoint}=require('./checkpoint-file.js');
const {graphOutputs}=require('./graph-outputs.js');
const {claim}=require('./graph-batch.js');
const files=require('./asset-files.js');

const networkFormat='ink-studio/solver-network',stageFormat='ink-studio/solver-stage';
const runFormat='ink-studio/solver-network-run', reportFormat='ink-studio/solver-network-report';
const integer=(n,a,b)=>Number.isSafeInteger(n)&&range(n,a,b);
const operatorKeys=['kind','revision','config','schedule','contract','portQuantities'];
const serial=value=>Buffer.from(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v)+'\n');

function resolver(owner,dependency) {
  const seen=new Map();
  function load(reference,file=owner) {
    if(typeof reference!=='string'||!reference.trim()||path.isAbsolute(reference)||path.win32.isAbsolute(reference)||
        !/\.json$/i.test(reference))throw new TypeError('Solver network assets need relative JSON paths');
    const resolved=path.resolve(path.dirname(file),reference);
    if(!seen.has(resolved)){
      dependency(resolved);
      seen.set(resolved,read(resolved));
    }
    return {...seen.get(resolved),file:resolved};
  }
  return load;
}

function declarations(K,name,table,min=0,max=64){
  if(!record(table)||!integer(Object.keys(table).length,min,max)||!Object.keys(table).every(K.world.data.id))
    throw new TypeError('Invalid solver network '+name+' table');
  return Object.entries(table);
}

function lower(kit,input,owner,track=()=>{},load=resolver(owner,track)){
  const K=kit.KIT,W=K.world,{id}=W.data;
  if(!fields(input,['format','version','id','revision','seed','numerics','domain','parameters','initial','boundaries',
    'library','stages','connections','inputs','outputs','probes','commands','world'])||
      input.format!==networkFormat||input.version!==1||!id(input.id)||!integer(input.revision??1,1,999999)||
      !Number.isSafeInteger(input.seed??1)) throw new TypeError('Expected a version 1 solver network');
  function embed(operator,file){
    return embedModels({systems:{stage:operator}},file,track).systems.stage;
  }
  const definitions=new Map(declarations(K,'library',input.library,1).map(([name,ref])=>{
    let row=ref,file=owner,asset;
    if(Object.hasOwn(ref??{},'file')){
      if(!fields(ref,['file','revision'])||!integer(ref.revision,1,999999))
        throw new TypeError('Pin a versioned solver stage file and revision');
      const loaded=load(ref.file,owner);
      ({document:row,file}=loaded);
      if(row?.format!==stageFormat||row.version!==1||row.revision!==ref.revision||!id(row.id))
        throw new TypeError('Solver stage revision mismatch for '+name);
      asset={file:ref.file,sha256:loaded.sha256};
    }
    if(!fields(row,asset?[...operatorKeys,'format','version','id','ports']:[...operatorKeys,'ports'])||
        !id(row.kind)||!integer(row.revision,1,999999)||!record(row.config??{})||
        !fields(row.ports??{},['inputs','outputs']))throw new TypeError('Invalid solver stage definition '+name);
    for(const [direction,ports] of Object.entries(row.ports??{}))
      for(const [,type] of declarations(K,direction,ports))if(typeof type!=='string'||!type.trim()||type.length>96)
        throw new TypeError('Expected a native solver port type');
    const operator=Object.fromEntries(operatorKeys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
    return [name,{operator:embed(operator,file),ports:row.ports??{},asset}];
  }));
  const instances=declarations(K,'stages',input.stages,1);
  const ops=instances.map(([name,stage])=>{
    if(!fields(stage,['use','config','schedule','contract','portQuantities'])||!definitions.has(stage.use)||
        !record(stage.config??{}))throw new TypeError('Solver stage '+name+' needs a library definition and settings');
    const {operator}=definitions.get(stage.use), {use,...overrides}=stage;
    // An override is a complete value for each provided configuration key.
    const config={...operator.config,...overrides.config};
    return [name,{...operator,...overrides,config}];
  });
  const model={format:W.models.format,version:1,id:input.id,revision:input.revision??1,seed:input.seed??1,
    numerics:input.numerics,domain:input.domain??{},parameters:input.parameters??{},initial:input.initial??{},
    boundaries:input.boundaries??{},operators:Object.fromEntries(ops),inputs:input.inputs??{},outputs:input.outputs??{},
    probes:input.probes??{},connections:input.connections??[],commands:input.commands??[],
    ...(input.world!==undefined&&{world:input.world})};
  // Resolve model-valued overrides relative to the network after merging the native kind.
  const embedded=embedModels(model,owner,track);
  const run=W.runtime.create(embedded), composition=run.composition();
  const resolved=instances.map(([name,{use}])=>{
    const definition=definitions.get(use), entry=composition.systems[name];
    const ports={inputs:entry.reads.inputs,outputs:entry.writes.outputs};
    for(const [direction,expected] of Object.entries(definition.ports))
      for(const [port,type] of Object.entries(expected))if(ports[direction][port]?.type!==type)
        throw new RangeError('Solver stage '+name+' '+direction+'/'+port+' expected '+type+
          ' but resolved '+(ports[direction][port]?.type??'no port'));
    return [name,{use,kind:definition.operator.kind,revision:definition.operator.revision,ports,
      ...(definition.asset&&{definition:definition.asset})}];
  });
  return {model:embedded,initial:run,report:{format:'ink-studio/solver-network-index',version:1,id:input.id,
    revision:model.revision,stages:Object.fromEntries(resolved),inputs:model.inputs,outputs:model.outputs,composition}};
}

function buildCaptures(kit,table) {
  const K=kit.KIT,W=K.world;
  const captures=declarations(K,'inspect',table??{},0,32);
  let cost=0;
  function consume(n) {
    cost+=n;
    if(cost>180000)throw new RangeError('Solver network exceeds its shared inspection sample budget');
  }
  return captures.map(([name,spec])=>{
    if(!fields(spec,['kind','field','at','args','path','samples','where','unit','frame'])||
        !['field','particles','contacts','probe'].includes(spec.kind)||typeof spec.field!=='string'||!spec.field.trim()||
        spec.args!==undefined&&!record(spec.args))throw new TypeError('Invalid solver inspection '+name);
    const {kind,field,at,args,samples,where,unit,frame}=spec;
    if((samples!==undefined)!==(kind==='field')||kind==='field'&&(at!==undefined||spec.path!==undefined)||
        where!==undefined&&kind!=='contacts'||(unit!==undefined||frame!==undefined)&&kind!=='particles')
      throw new TypeError('Inspection options do not match '+kind+' on '+name);
    const pick=spec.path===undefined?null:W.data.selector(spec.path);
    if(kind==='field'&&(!fields(samples,['grid','line','points'])||Object.keys(samples).length!==1))
      throw new TypeError('Choose a field grid, line or list of points');
    function capture(query){
      const descriptor=query.field(field);
      if(!descriptor)throw new RangeError('Unknown solver field '+field);
      if(kind==='field'){
        const result=query.export(field,samples,args);
        consume(result.samples.length);
        return {kind,field,status:'ok',value:result};
      }
      const source=query.probe(field,at,args);
      if(source.status!=='ok')return {kind,field,status:source.status,...(source.reason&&{reason:source.reason})};
      const value=pick?W.data.read(source.value,pick):source.value;
      if(value===undefined)return {kind,field,status:'missing',reason:'inspection path has no value'};
      if(kind==='particles'){
        const points=W.outputAdapters.points(value,{...(unit!==undefined&&{unit}),...(frame!==undefined&&{frame})});
        consume(points.count);
        return {kind,field,status:'ok',count:points.count,value:points};
      }
      if(kind==='contacts'){
        if(!Array.isArray(value)||value.some(row=>!record(row)))throw new TypeError('Contact inspection needs a record array');
        const rows=where===undefined?value:value.filter(row=>W.query.condition(where,row));
        consume(value.length);
        return {kind,field,status:'ok',count:rows.length,value:rows};
      }
      consume(1);
      return {kind,field,status:'ok',value};
    }
    return [name,capture];
  });
}

function execute(kit,source,owner,dependency=()=>{},options={}){
  const K=kit.KIT,W=K.world,T=K.procedural.takeTime;
  if(!fields(source,['format','version','id','network','fps','simulationRate','branches','inspect'])||
      source.format!==runFormat||source.version!==1||!W.data.id(source.id))
    throw new TypeError('Expected a version 1 solver network run');
  const load=resolver(owner,dependency), loaded=typeof source.network==='string'?load(source.network):{document:source.network,file:owner};
  const {model,initial,report:index}=lower(kit,loaded.document,loaded.file,dependency,load);
  const fps=T.read(source.fps??24);
  const simulationRate=T.div([1n,1n],T.period(model.numerics.dt,source.simulationRate));
  const clock=K.timeDomains.take({fps:T.pack(fps),simulationRate:T.pack(simulationRate)});
  const capture=buildCaptures(kit,source.inspect);
  const specs=new Map(declarations(K,'branches',source.branches,1,16));
  const prepared=new Map(), needed=new Map(), sorted=[], active=new Set(), visited=new Set();
  let work=0, framesCount=0;
  const address=frame=>clock.address({frame});
  function frameList(value,min,max){
    if(!Array.isArray(value)||value.length>128||new Set(value).size!==value.length||!value.every(v=>integer(v,min,max)))
      throw new RangeError('Solver branch needs distinct bounded frame addresses');
    return value.slice().sort((a,b)=>a-b);
  }

  for(const [name,spec] of specs){
    if(!fields(spec,['from','to','frames','checkpoints','commands'])||!integer(spec.to,0,1000000))
      throw new TypeError('Invalid solver branch '+name);
    const from=spec.from?.frame??0;
    if(!integer(from,0,spec.to)||spec.from!==undefined&&
        (!fields(spec.from,['branch','checkpoint','frame'])||!integer(spec.from.frame,0,spec.to)||
         (spec.from.branch===undefined)===(spec.from.checkpoint===undefined)||
         spec.from.branch!==undefined&&(!specs.has(spec.from.branch)||spec.from.branch===name)))
      throw new RangeError('Invalid source frame on solver branch '+name);
    const frames=frameList(spec.frames??[spec.to],from,spec.to), saves=frameList(spec.checkpoints??[],from,spec.to);
    prepared.set(name,{...spec,frames,saves,start:from});
    if(!needed.has(name))needed.set(name,new Set());
    for(const f of saves)needed.get(name).add(f);
    const parent=spec.from?.branch;
    if(parent!==undefined){
      if(!needed.has(parent))needed.set(parent,new Set());
      needed.get(parent).add(from);
    }
    work+=address(spec.to).tick-address(from).tick;
    framesCount+=frames.length;
    if(work>180000||framesCount>512||address(spec.to).tick>W.runtime.maxTick)
      throw new RangeError('Solver run exceeds its tick or capture budget');
  }
  function order(name){
    if(active.has(name))throw new RangeError('Cyclic solver branch at '+name);
    if(visited.has(name))return;
    active.add(name);
    const row=prepared.get(name), parent=row.from?.branch;
    if(parent!==undefined){
      const parentSpec=prepared.get(parent);
      if(row.start<parentSpec.start||row.start>parentSpec.to)throw new RangeError('Branch frame lies outside parent '+parent);
      order(parent);
    }
    active.delete(name);
    visited.add(name);
    sorted.push(name);
  }
  for(const name of prepared.keys())order(name);
  if([...needed.values()].reduce((n,row)=>n+row.size,0)>128)
    throw new RangeError('Solver run exceeds its checkpoint budget');

  const snapshots=new Map(), artifacts=[], branches={};
  let checkpointBytes=0;
  for(const name of sorted){
    const spec=prepared.get(name), start=address(spec.start), parent=spec.from?.branch;
    let checkpoint;
    if(parent!==undefined)checkpoint=snapshots.get(parent).get(spec.start);
    else if(spec.from?.checkpoint!==undefined){
      const file=load(spec.from.checkpoint);
      checkpoint=resolveCheckpoint(file.file,file.document,{onBlock:dependency});
    }
    if(checkpoint&&(checkpoint.tick!==start.tick||!W.data.equal(checkpoint.world,initial.view().world)))
      throw new RangeError('Checkpoint does not match the solver network and committed source tick on '+name);
    const run=W.runtime.create(model,{checkpoint,branch:name});
    const authored=typeof spec.commands==='string'?load(spec.commands).document:spec.commands??[];
    if(!Array.isArray(authored)||authored.length>512)throw new TypeError('Invalid command list for solver branch '+name);
    const commandPrefix=sha(serial([source.id,name,spec.start])).slice(0,16);
    const commands=authored.map((row,i)=>{
      if(!fields(row,['frame','input','value','action','args','id'])||!integer(row.frame,spec.start,spec.to)||
          (row.input!==undefined)===(row.action!==undefined)||row.input!==undefined&&!Object.hasOwn(row,'value')||
          row.input!==undefined&&row.args!==undefined||row.action!==undefined&&row.value!==undefined||
          row.action!==undefined&&typeof row.action!=='string'||row.id!==undefined&&!W.data.id(row.id))
        throw new TypeError('Invalid authored command '+i+' on '+name);
      const tick=address(row.frame).cueTick;
      if(tick<=start.tick||tick>address(spec.to).tick)
        throw new RangeError('The command on '+name+' maps outside its editable committed tick range');
      const command=row.input!==undefined?W.models.command(run.view().world,row.input,row.value,tick):
        {tick,action:row.action,args:row.args??{}};
      return {...command,id:row.id??'network-'+commandPrefix+'.'+i};
    });
    run.schedule(commands);
    const saves=needed.get(name), selected=new Set(spec.frames), emitted=[], keys={};
    snapshots.set(name,new Map());
    for(const frame of [...new Set([...selected,...saves,spec.to])].sort((a,b)=>a-b)){
      const stamp=address(frame);
      run.advance(stamp.tick);
      if(saves.has(frame)){
        const saved=run.checkpoint(), bytes=serial(saved);
        checkpointBytes+=bytes.length;
        if(checkpointBytes>32*1024**2)throw new RangeError('Solver checkpoints exceed their artifact byte budget');
        const file='checkpoints/'+name+'/'+frame+'.json';
        snapshots.get(name).set(frame,saved);
        keys[frame]={file,tick:stamp.tick,sha256:sha(bytes)};
        if(options.artifacts)artifacts.push({file,bytes});
      }
      if(selected.has(frame)){
        const query=run.query(), sample=W.models.sample(run);
        emitted.push({frame,tick:stamp.tick,timecode:stamp.timecode,committedSeconds:sample.time,
          outputs:sample.outputs,probes:sample.probes,
          inspect:Object.fromEntries(capture.map(([id,read])=>[id,read(query)]))});
      }
    }
    branches[name]={from:spec.from??null,startTick:start.tick,endFrame:spec.to,endTick:address(spec.to).tick,
      commands,checkpoints:keys,frames:emitted};
  }
  const bytes=serial({format:reportFormat,version:1,id:source.id,network:{id:index.id,revision:index.revision,stages:index.stages},
    clock:{fps:T.pack(fps),simulationRate:T.pack(simulationRate),dt:model.numerics.dt},order:sorted,branches});
  if(bytes.length>24*1024**2)throw new RangeError('Solver inspection report exceeds its artifact byte budget');
  return {report:JSON.parse(bytes.toString('utf8')),bytes,artifacts};
}

function command([mode,file,...extra],options,kit){
  if(!['inspect','compile','run'].includes(mode)||typeof file!=='string'||extra.length||
      Object.entries(options).some(([key,value])=>key!=='out'||typeof value!=='string'||!value.trim()))
    throw new TypeError('Use solver-network inspect|compile|run <plan.json> [--out path]');
  const owner=path.resolve(file), {document}=read(owner), paths=new Set([owner]), dependency=file=>paths.add(file);
  if(mode==='run'){
    const {report,bytes,artifacts}=execute(kit,document,owner,dependency,{artifacts:options.out!==undefined});
    if(options.out){
      const dest=path.resolve(options.out), release=claim(dest,'solver network');
      try{graphOutputs([...paths]).write(dest,[...artifacts,{file:'report.json',bytes}]);}
      finally{release();}
    }else process.stdout.write(JSON.stringify(report,null,2)+'\n');
    return;
  }
  const {model,report}=lower(kit,document,owner,dependency);
  const result=mode==='compile'?model:report;
  if(options.out){
    const dest=path.resolve(options.out);
    graphOutputs([...paths]).protect(fs.statSync(dest,{throwIfNoEntry:false}));
    files.json(dest,result);
  }else process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

module.exports={command,execute,lower};
