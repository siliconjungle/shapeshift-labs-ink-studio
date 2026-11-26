const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const Plan=require('./bake-job-plan.js');
const Grid=require('./uv-bake-grid.js');
const {tileLabel}=require('./material-preview-geometry.js');
const {names:ao}=require('./bake-job-occlusion.js');
const {names:curvature}=require('./bake-job-curvature.js');
const {runBakeJob,reviewData}=require('./bake-jobs.js');
const {refreshGraph}=require('./bake-job-worker.js');
const {claim}=require('./graph-batch.js');
const {engineFingerprint,fingerprint}=require('./graph-artifact-cache.js');
const Assets=require('./asset-files.js');
const Cache=require('./bake-batch-cache.js');

const batchFormat='ink-studio/bake-batch', snapshotFormat='ink-studio/bake-batch-latest';
const mb=1024**2, snapshotName=/^batch-[0-9a-f-]{36}$/;
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const record=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
const bounded=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const filename=value=>typeof value==='string'&&value.trim()&&value.length<=4096&&!value.includes('\0');

function tiles(rows) {
  if(!Array.isArray(rows)||!bounded(rows.length,1,32))throw new RangeError('Use 1–32 tiles in a batch tile set');
  const coords=rows.map(Plan.coord);
  if(new Set(coords.map(row=>row.join(','))).size!==coords.length)throw new RangeError('Duplicate tile in a batch tile set');
  return coords;
}

function reservations(plan,targets,heapMb) {
  const active=plan.preset.maps.filter(row=>row.enabled);
  const samples=active.reduce((count,row)=>{
    const settings=Plan.effective(plan.preset,row), {delivery}=settings;
    return count+(delivery?delivery.width*delivery.height*delivery.antialiasing**2:Grid.count(settings.size));
  },0)*targets.reduce((n,row)=>n+row.tiles.length,0);
  if(samples>12e6)throw new RangeError('A bake work unit exceeds the twelve million raster sample limit');
  if(active.length*targets.reduce((n,row)=>n+row.tiles.length,0)>192)
    throw new RangeError('A bake work unit exceeds 192 map and tile combinations');
  // Reserve the V8 heap and additional working space for geometry, codecs and sample buffers.
  return heapMb+128+Math.ceil((samples*96+fs.statSync(plan.source).size*2)/mb);
}

function planBatch(file,onInput) {
  const location=path.resolve(file), base=path.dirname(location);
  onInput(location);
  const document=json(location);
  if(!record(document))throw new TypeError('Expected a bake batch plan');
  const {format,version,label,jobs,tileSets={},workers=2,memoryMb=1536,cache={}}=document;
  if(!fields(document,['format','version','label','jobs','tileSets','workers','memoryMb','cache'])||format!==batchFormat||
    version!==1||typeof label!=='string'||!label.trim()||label.length>140||!Array.isArray(jobs)||!bounded(jobs.length,1,48)||
    !record(tileSets)||Object.keys(tileSets).length>64||!bounded(workers,1,12)||!bounded(memoryMb,256,32768)||
    !fields(cache,['policy','maxMb','maxEntries']))throw new TypeError('Invalid bake batch plan or scheduling limits');
  const {policy='reuse',maxMb=512,maxEntries=192}=cache;
  if(!['reuse','refresh','off'].includes(policy)||!bounded(maxMb,1,8192)||!bounded(maxEntries,1,1024))
    throw new RangeError('Bake cache needs a valid policy and byte and entry budgets');
  const sets=new Map(Object.entries(tileSets).map(([id,value])=>{
    if(!Plan.id(id))throw new TypeError('Invalid batch tile set ID');
    return [id,tiles(value)];
  }));
  const jobIds=new Set(), aliases=new Set();
  const planned=jobs.map(row=>{
    if(!fields(row,['id','job','preset','tiles','aliases','heapMb'])||!Plan.id(row.id)||jobIds.has(row.id.toLowerCase())||
      !filename(row.job)||row.preset!==undefined&&!filename(row.preset)||
      row.tiles!==undefined&&!record(row.tiles)||row.aliases!==undefined&&!Array.isArray(row.aliases))
      throw new TypeError('Batch jobs need unique IDs, job files and optional presets, tiles and aliases');
    jobIds.add(row.id.toLowerCase());
    const heapMb=row.heapMb??384;
    if(!bounded(heapMb,128,4096))throw new RangeError('Batch job heap must be 128–4096 MiB');
    const jobFile=path.resolve(base,row.job), presetFile=row.preset&&path.resolve(base,row.preset);
    const plan=Plan.readPlan(jobFile,{presetFile,onInput});
    const active=plan.preset.maps.filter(row=>row.enabled).map(row=>row.id);
    for(const key of Object.keys(row.tiles??{}))if(!plan.targets.some(target=>target.id===key))
      throw new RangeError('Unknown target '+key+' in batch job '+row.id);
    plan.targets=plan.targets.map(target=>{
      const choice=row.tiles?.[target.id];
      const chosen=typeof choice==='string'?sets.get(choice):choice===undefined?target.tiles:tiles(choice);
      if(!chosen)throw new RangeError('Unknown batch tile set '+choice);
      return {...target,tiles:chosen};
    });
    const outputs=(row.aliases??[]).map(alias=>{
      if(!fields(alias,['name','target','map'])||!Plan.id(alias.name)||aliases.has(alias.name.toLowerCase())||
        !active.includes(alias.map)||!plan.targets.some(target=>target.id===alias.target))
        throw new RangeError('Output aliases need unique names, active maps and existing targets');
      aliases.add(alias.name.toLowerCase());
      return alias;
    });
    if(aliases.size>256)throw new RangeError('Use up to 256 output aliases per batch');
    // Visibility can depend on unplaced receivers in the same job. Shared
    // normalization can depend on the other tiles of a target.
    const sceneWide=active.some(id=>ao.includes(id));
    const together=active.some(id=>id==='height'||curvature.includes(id));
    const groups=sceneWide?[plan.targets]:plan.targets.flatMap(target=>together?[[target]]:
      target.tiles.map(tile=>[{...target,tiles:[tile]}]));
    return {id:row.id,jobFile,presetFile,heapMb,plan,outputs,groups};
  });
  return {location,label,sets:Object.fromEntries(sets),workers,memoryMb,cache:{policy,maxMb,maxEntries},jobs:planned};
}

function recipe(job,targets,engine) {
  const {plan}=job;
  return fingerprint([engine,job.jobFile,job.heapMb,plan.label,plan.source,plan.preset,targets,plan.sources,
    plan.skewMaps,plan.normalInputs,plan.textureInputs]);
}

function tasks(plan,engine) {
  const units=new Map();
  for(const job of plan.jobs) {
    job.keys=job.groups.map(targets=>{
      const key=recipe(job,targets,engine);
      const reserved=reservations(job.plan,targets,job.heapMb);
      if(!units.has(key))units.set(key,{key,targets,reserved,job});
      return key;
    });
  }
  if(!bounded(units.size,1,384))throw new RangeError('Use up to 384 independent work units per batch');
  return [...units.values()];
}

async function schedule(units,plan,controller,execute,notify) {
  const active=new Map(), results=new Map();
  let next=0, reserved=0, peakMiB=0, peakWorkers=0;
  const space=()=>({workers:active.size,reservedMiB:reserved,memoryBudgetMiB:plan.memoryMb});
  try {
    while(next<units.length||active.size) {
      while(!controller.signal.aborted&&next<units.length&&active.size<plan.workers&&
        reserved+units[next].reserved<=plan.memoryMb) {
        const unit=units[next++];
        reserved+=unit.reserved;
        const work=Promise.resolve().then(()=>execute(unit)).then(result=>({unit,result}),error=>({unit,error}));
        active.set(unit.key,work);
        peakWorkers=Math.max(peakWorkers,active.size);
        peakMiB=Math.max(peakMiB,reserved);
        notify({event:'unit-started',job:unit.job.id,completed:results.size,total:units.length,...space()});
      }
      if(!active.size)controller.signal.throwIfAborted();
      const {unit,result,error}=await Promise.race(active.values());
      active.delete(unit.key);
      reserved-=unit.reserved;
      if(error||controller.signal.aborted) {
        throw error??controller.signal.reason;
      }
      results.set(unit.key,result);
      notify({event:'unit-finished',job:unit.job.id,status:result.status,completed:results.size,total:units.length,...space()});
    }
  } catch(error) {
    if(!controller.signal.aborted)controller.abort(error);
    await Promise.all(active.values());
    throw error;
  }
  return {results,peakMiB,peakWorkers};
}

function combine(job,results,destination,dependencies,K) {
  const units=job.keys.map(key=>results.get(key)), first=units[0].report, maps=[], debug=[], inputs=new Map();
  const sort=new Map();
  let index=0;
  for(const row of job.plan.preset.maps.filter(row=>row.enabled))
    for(const target of job.plan.targets)
      for(const tile of target.tiles)sort.set(JSON.stringify([row.id,target.id,tile]),index++);
  const slot=row=>JSON.stringify([row.map,row.target,row.tile]);
  const seen=new Set();
  for(const unit of units) {
    const offset=debug.length;
    debug.push(...(unit.report.uvDebug??[]));
    for(const row of unit.report.maps) {
      if(!sort.has(slot(row))||seen.has(slot(row)))throw new Error('Batch unit returned an unexpected map or tile');
      seen.add(slot(row));
      maps.push({...row,...(row.uvDebug!==undefined&&{uvDebug:row.uvDebug+offset})});
    }
    for(const row of unit.report.inputs)inputs.set(row.file,row);
    for(const row of unit.files)if(row.name!=='report.json')Cache.copy(unit.directory,row.name,destination);
  }
  if(maps.length!==sort.size)throw new Error('Batch output is missing a selected map or tile');
  maps.sort((a,b)=>sort.get(slot(a))-sort.get(slot(b)));
  const base=path.dirname(job.jobFile);
  for(const source of [job.jobFile,job.plan.presetPath,job.plan.refresh?.material])if(source) {
    const file=path.relative(base,source);
    inputs.set(file,{file,sha256:dependencies.get(source)});
  }
  const report={...first,targets:job.plan.targets,maps,inputs:[...inputs.values()].sort((a,b)=>a.file.localeCompare(b.file)),
    ...(debug.length&&{uvDebug:debug})};
  refreshGraph(report,job.plan.refresh,destination,K);
  Assets.json(path.join(destination,'report.json'),report);
  Assets.json(path.join(destination,'preset.json'),report.preset);
  reviewData({label:report.label,preset:report.preset,targets:report.targets,catalog:report.catalog,
    projectionCatalog:report.projectionCatalog,normalInputs:report.normalInputs,textureInputs:report.textureInputs,report},destination);
  return report;
}

function aliases(job,report,source,folder) {
  return job.outputs.map(({name,target,map})=>{
    const rows=report.maps.filter(row=>row.map===map&&row.target===target);
    return {name,target,map,tiles:rows.map(row=>{
      const label=/^\d+$/.test(row.tileLabel)?row.tileLabel:'u'+row.tile[0]+'_v'+row.tile[1];
      const stem=name+'.'+label;
      function output(level) {
        const suffix=level.level?'.mip-'+level.level:'', file='aliases/'+stem+suffix+path.extname(level.file);
        Cache.copy(source,level.file,folder,file);
        const validityFile=level.validityFile&&'aliases/'+stem+suffix+'.valid.png';
        if(validityFile)Cache.copy(source,level.validityFile,folder,validityFile);
        return {file,sha256:level.sha256,...(validityFile&&{validityFile,validitySha256:level.validitySha256})};
      }
      return {tile:row.tile,tileLabel:row.tileLabel,...output(row),
        ...(row.mips?.length&&{mips:row.mips.map(level=>({level:level.level,...output(level)}))})};
    })};
  });
}

function latestBakeBatch(directory) {
  const root=path.resolve(directory), file=path.join(root,'latest.json');
  if(!fs.existsSync(file))return null;
  const latest=json(file);
  if(latest.format!==snapshotFormat||latest.version!==1||!snapshotName.test(latest.revision))
    throw new TypeError('Expected a batch output directory with a valid latest batch revision');
  const folder=path.join(root,'revisions',latest.revision);
  return {...latest,data:json(path.join(folder,'report.json'))};
}

async function runBakeBatch(file,{directory,signal=new AbortController().signal,onProgress=()=>{}}={}) {
  if(!filename(directory))throw new TypeError('Bake batch needs an output directory');
  const root=path.resolve(directory), controller=new AbortController(), dependencies=new Map();
  const snapshot=(name,sha)=>{
    const location=path.resolve(name), hash=sha??Cache.hashFile(location);
    if(dependencies.has(location)&&dependencies.get(location)!==hash)throw new Error('Bake batch input changed during evaluation');
    dependencies.set(location,hash);
  };
  const plan=planBatch(file,snapshot), kit=require('../index.js').load(), {KIT:K}=kit;
  const engine=engineFingerprint(kit), units=tasks(plan,engine), cache=Cache.open(root,engine?plan.cache:{...plan.cache,policy:'off'});
  const release=claim(root,'bake batch');
  const abort=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
  let stage;
  try {
    const previous=latestBakeBatch(root), marker=path.join(root,'latest.json');
    if(dependencies.has(marker))throw new RangeError('Batch output would overwrite an input');
    const revisions=path.join(root,'revisions'), revision='batch-'+randomUUID();
    fs.mkdirSync(revisions,{recursive:true});
    stage=fs.mkdtempSync(path.join(revisions,'.batch-'));
    const work=path.join(stage,'.work');
    onProgress({event:'planned',total:units.length,memoryBudgetMiB:plan.memoryMb});
    async function execute(unit) {
      controller.signal.throwIfAborted();
      const {job,key,targets}=unit, base=path.dirname(job.jobFile);
      const baked=await runBakeJob(job.jobFile,{directory:path.join(work,key),signal:controller.signal,heapMb:job.heapMb,
        targetValues:targets,presetValue:job.plan.preset,deferRefresh:true});
      controller.signal.throwIfAborted();
      const inputs=baked.report.inputs.map(({file,sha256})=>({file:path.resolve(base,file),sha256}));
      for(const input of inputs)snapshot(input.file,input.sha256);
      const config=new Set([job.jobFile,job.plan.presetPath,job.plan.refresh?.material]);
      const captured=Cache.readUnit(path.dirname(baked.file),baked.report,inputs.filter(row=>!config.has(row.file)));
      return {...captured,status:'baked',stored:cache.write(key,captured)};
    }
    let ran;
    const cached=new Map(), pending=[];
    try {
      for(const unit of units) {
        controller.signal.throwIfAborted();
        const hit=cache.read(unit.key);
        if(hit) {
          for(const row of hit.inputs)snapshot(row.file,row.sha256);
          cached.set(unit.key,{...hit,status:'cached'});
          onProgress({event:'unit-finished',job:unit.job.id,status:'cached',completed:cached.size,total:units.length,
            workers:0,reservedMiB:0,memoryBudgetMiB:plan.memoryMb});
        } else {
          if(unit.reserved>plan.memoryMb)throw new RangeError('Work unit '+unit.job.id+' reserves '+unit.reserved+
            ' MiB and exceeds the '+plan.memoryMb+' MiB batch memory budget');
          pending.push(unit);
        }
      }
      ran=await schedule(pending,plan,controller,execute,row=>onProgress({...row,completed:row.completed+cached.size,total:units.length}));
    } catch(error) {
      if(signal.aborted)return {status:'cancelled',latest:previous?.revision??null};
      throw error;
    }
    const {results,peakMiB,peakWorkers}=ran, byKey=new Map(units.map(unit=>[unit.key,unit]));
    for(const [key,row] of cached)results.set(key,row);
    const data={format:'ink-studio/bake-batch-report',version:1,label:plan.label,tileSets:plan.sets,
      limits:{workers:plan.workers,memoryMb:plan.memoryMb,peakReservedMiB:peakMiB,peakWorkers},
      totals:{units:units.length,baked:[...results.values()].filter(row=>row.status==='baked').length,
        cached:[...results.values()].filter(row=>row.status==='cached').length},jobs:[]};
    for(const job of plan.jobs) {
      const relative='jobs/'+job.id, folder=path.join(stage,relative), report=combine(job,results,folder,dependencies,K);
      const sheets=job.keys.map((key,i)=>{
        const unit=byKey.get(key), result=results.get(key);
        return {status:result.status,reservedMiB:unit.reserved,targets:job.groups[i].map(target=>({
          id:target.id,tiles:target.tiles.map(tile=>{
            const matches=report.maps.filter(row=>row.target===target.id&&row.tile[0]===tile[0]&&row.tile[1]===tile[1]);
            const sample=matches.find(row=>row.map==='pigment')??matches[0];
            const thumbnail=sample.previewFile??(sample.file.endsWith('.png')&&sample.file);
            return {tile,label:tileLabel(tile),...(thumbnail&&{preview:relative+'/'+thumbnail})};
          })
        }))};
      });
      data.jobs.push({id:job.id,label:job.plan.label,review:relative+'/index.html',report:relative+'/report.json',
        aliases:aliases(job,report,folder,stage),units:sheets});
    }
    for(const [name,sha] of dependencies) {
      if(name===marker||Cache.hashFile(name)!==sha)throw new Error('Bake batch input changed before publication');
    }
    if(signal.aborted)return {status:'cancelled',latest:previous?.revision??null};
    fs.rmSync(work,{recursive:true,force:true});
    Assets.json(path.join(stage,'report.json'),data);
    Assets.write(path.join(stage,'index.html'),fs.readFileSync(path.join(__dirname,'bake-batch.html')));
    Assets.write(path.join(stage,'data.js'),'const batch = '+JSON.stringify(data).replaceAll('<','\\u003c')+';\n');
    fs.renameSync(stage,path.join(revisions,revision));
    const pointer={format:snapshotFormat,version:1,revision,file:'revisions/'+revision+'/index.html',
      report:'revisions/'+revision+'/report.json'};
    Assets.json(marker,pointer);
    onProgress({event:'completed',total:units.length,completed:units.length,...data.totals});
    return {status:'completed',...pointer,file:path.join(root,pointer.file),data};
  } finally {
    if(stage)fs.rmSync(stage,{recursive:true,force:true});
    try {cache.prune();} catch { /* A cache storage failure leaves the bake revision usable. */ }
    signal.removeEventListener('abort',abort);
    release();
  }
}

module.exports={runBakeBatch,latestBakeBatch};
