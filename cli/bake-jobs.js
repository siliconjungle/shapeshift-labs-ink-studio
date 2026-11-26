const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const Process=require('./task-process.js');
const Assets=require('./asset-files.js');
const {claim}=require('./graph-batch.js');
const Plan=require('./bake-job-plan.js');

const snapshot='ink-studio/bake-job-latest';
const digest=data=>createHash('sha256').update(data).digest('hex');
const revisionPattern=/^bake-[A-Za-z0-9]{6}$/;
const worker=path.join(__dirname,'bake-job-worker.js');
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const lease=(dir,prefix)=>fs.mkdtempSync(path.join(dir,prefix));
const launchSettings=()=>Process.budget({taskMs:300000,heapMb:768,outputBytes:196*1024*1024});

function reviewData(data,directory) {
  Assets.write(path.join(directory,'index.html'),fs.readFileSync(path.join(__dirname,'bake-job.html')));
  Assets.write(path.join(directory,'live.js'),fs.readFileSync(path.join(__dirname,'bake-job.browser.js')));
  Assets.write(path.join(directory,'data.js'),'const bakeJob = '+JSON.stringify(data).replaceAll('<','\\u003c')+';\n');
}

async function start(file,settings,stage,mode,signal,progress,artifacts=stage) {
  const request=path.join(stage,'request.json');
  Assets.json(request,{file:path.resolve(file),settings,mode});
  let buffer='', last='';
  const child=await Process.launch(worker,'work',[request,stage],{
    cwd:process.cwd(),env:process.env,artifacts,signal,limits:launchSettings(),
    onOutput(chunk) {
      buffer+=chunk.toString('utf8');
      let at;
      while((at=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
        let row;
        try {row=JSON.parse(line);}
        catch {last=line.trim()||last;}
        if(row?.event)progress?.(row);
      }
    }
  });
  if(child.error)throw child.error;
  if(child.status!==0)throw new Error(last||buffer.trim()||'Bake worker exited without a report');
  signal.throwIfAborted();
}

function saveBakePreset(out,source) {
  const file=path.resolve(out), value=Plan.preset(source);
  Assets.json(file,value);
  return {file,preset:value};
}
async function inspectBakeJob(file,{signal=new AbortController().signal,...settings}={}) {
  const stage=lease(os.tmpdir(),'ink-bake-inspect-');
  try {
    await start(file,settings,stage,'inspect',signal);
    return json(path.join(stage,'inspection.json'));
  } finally { fs.rmSync(stage,{recursive:true,force:true}); }
}

function latestBakeJob(directory) {
  const root=path.resolve(directory), file=path.join(root,'latest.json');
  if(!fs.existsSync(file))return null;
  const latest=json(file), {revision}=latest;
  if(latest.format!==snapshot||latest.version!==1||!revisionPattern.test(revision))
    throw new TypeError('Invalid bake job latest revision');
  const report=json(path.join(root,'revisions',revision,'report.json'));
  return { ...latest,report };
}

async function runBakeJob(file,{directory,signal=new AbortController().signal,onProgress,...settings}={}) {
  if(typeof directory!=='string'||!directory.trim())throw new TypeError('Bake job needs an output directory');
  const root=path.resolve(directory), revisions=path.join(root,'revisions'), marker=path.join(root,'latest.json');
  if(path.resolve(file)===marker)throw new RangeError('Bake output would overwrite its plan');
  const release=claim(root,'bake job');
  let stage;
  try {
    if(fs.existsSync(marker))latestBakeJob(root);
    fs.mkdirSync(revisions,{recursive:true});
    stage=lease(revisions,'.attempt-');
    const revision='bake-'+path.basename(stage).slice(-6), destination=path.join(revisions,revision), work=path.join(stage,'.work');
    fs.mkdirSync(work);
    try {
      await start(file,settings,work,'run',signal,onProgress,stage);
    } catch(error) {
      if(!signal.aborted)throw error;
      return {status:'cancelled',latest:latestBakeJob(root)?.revision??null};
    }
    const inputs=json(path.join(work,'inputs.json')), pointer=fs.statSync(marker,{throwIfNoEntry:false});
    for(const [input,sha256] of inputs) {
      const stat=fs.statSync(input);
      if(input===marker||pointer&&pointer.ino===stat.ino&&pointer.dev===stat.dev)
        throw new RangeError('Bake output would overwrite an input dependency');
      if(digest(fs.readFileSync(input))!==sha256)throw new Error('Bake input changed before publication');
    }
    const report=json(path.join(stage,'report.json'));
    reviewData({label:report.label,preset:report.preset,targets:report.targets,catalog:report.catalog,report},stage);
    if(signal.aborted)return {status:'cancelled',latest:latestBakeJob(root)?.revision??null};
    fs.rmSync(work,{recursive:true,force:true});
    fs.renameSync(stage,destination);
    const latest={format:snapshot,version:1,revision,file:'revisions/'+revision+'/index.html',
      report:'revisions/'+revision+'/report.json',...(report.material&&{material:'revisions/'+revision+'/'+report.material})};
    Assets.json(marker,latest);
    return {status:'completed',...latest,file:path.join(destination,'index.html'),report};
  } finally {
    if(stage)fs.rmSync(stage,{recursive:true,force:true});
    release();
  }
}
module.exports={saveBakePreset,inspectBakeJob,runBakeJob,latestBakeJob,revisionPattern};
