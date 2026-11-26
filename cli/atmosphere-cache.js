/* Native checkpoints index a portable sparse atmosphere take. */
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const files=require('./asset-files.js');
const {openCheckpointStore,format:referenceFormat}=require('../src/simulation-checkpoint-store.js');
const format='ink-studio/atmosphere-cache';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const serial=document=>Buffer.from(JSON.stringify(document)+'\n');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fields=(row,keys)=>row!==null&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).every(key=>keys.includes(key));
const fail=message=>{throw new RangeError('Atmosphere cache: '+message);};

function bytes(file,max){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size>max)fail('invalid or oversized input');
    const data=fs.readFileSync(fd);
    if(data.length>max)fail('input exceeds its byte limit');
    return data;
  }finally{fs.closeSync(fd);}
}
const read=(file,max)=>JSON.parse(bytes(file,max));

function writer(directory){
  const store=openCheckpointStore(path.join(directory,'blocks')), aliases=[];
  function remember(document,file){
    const {reference}=store.save(document), relative=path.relative(path.dirname(path.join(directory,file)),path.join(directory,'blocks'));
    aliases.push([path.join(directory,file),{...reference,store:relative.split(path.sep).join('/')}]);
    return reference.root;
  }
  function detail(document){
    const data=serial(document), id=hash(data), destination=path.join(directory,'detail',id+'.json');
    const prior=fs.statSync(destination,{throwIfNoEntry:false});
    if(!prior?.isFile()||prior.size!==data.length||!bytes(destination,data.length).equals(data))files.write(destination,data);
    return id;
  }
  return {remember,detail,publish(){for(const [file,ref] of aliases)files.json(file,ref);}};
}

function open(kit,file,dependency=()=>{}){
  const {KIT:{world:W,procedural:{sparseVolume:V}}}=kit, R=W.runtime, root=path.dirname(file);
  const index=read(file,16*1024**2);
  if(!fields(index,['format','version','id','mode','seed','dt','ticks','store','frames','recording','upRes','summary','settings'])||
    index.format!==format||index.version!==1||!W.data.id(index.id)||!['combustion','cloud'].includes(index.mode)||
    !Number.isSafeInteger(index.seed)||!Number.isFinite(index.dt)||index.dt<=0||index.dt>.2||
    !Number.isSafeInteger(index.ticks)||index.ticks<0||index.ticks>360||index.store!=='blocks'||!validHash(index.recording)||
    !Array.isArray(index.frames)||!index.frames.length||index.frames.length>121||
    index.frames[0]?.tick!==0||index.frames.at(-1)?.tick!==index.ticks||
    index.frames.some((row,i)=>!fields(row,['tick','time','checkpoint','base','detail','quality','upRes'])||
      !Number.isSafeInteger(row.tick)||row.tick<0||row.tick>index.ticks||row.tick<=(index.frames[i-1]?.tick??-1)||
      row.time!==row.tick*index.dt||!validHash(row.checkpoint)||!validHash(row.base)||
      (index.upRes?!validHash(row.detail)||!W.data.record(row.upRes):row.detail!==undefined||row.upRes!==undefined)||
      !W.data.record(row.quality)))fail('expected a version 1 index with ordered frames and checksums');
  if(index.upRes)W.atmosphere.options(index.upRes);
  dependency(file);
  const store=openCheckpointStore(path.join(root,index.store),{readBlock(file){
    dependency(file);
    return bytes(file,128*1024**2);
  }});
  const load=(root,kind)=>store.load({format:referenceFormat,version:1,kind,root});
  function checkpoint(row){
    const saved=load(row.checkpoint,R.checkpointFormat), state=saved.states?.atmosphere, volume=V.create(state?.volume);
    if(saved.tick!==row.tick||saved.world?.id!==index.id||saved.world?.dt!==index.dt||saved.world?.seed!==index.seed||
      saved.world?.systems?.atmosphere?.config?.mode!==index.mode||state?.time!==row.time||hash(serial(volume))!==row.base||!W.data.equal(row.quality,state.report))fail('frame receipt disagrees at tick '+row.tick);
    return {saved,volume};
  }
  function detail(row){
    if(!row.detail)fail('the requested frame has no up-resolution');
    const file=path.join(root,'detail',row.detail+'.json');
    dependency(file);
    const raw=bytes(file,128*1024**2);
    if(hash(raw)!==row.detail)fail('corrupt detail at tick '+row.tick);
    return V.create(JSON.parse(raw));
  }
  function playback({time,tick,level='base',blend='hold'}){
    if(!['base','detail'].includes(level)||!['hold','linear'].includes(blend)||
      (time!==undefined&&tick!==undefined)||(tick!==undefined&&!Number.isSafeInteger(tick)))
      fail('invalid playback tick, time, level or blend');
    let sample=tick??(time===undefined?index.ticks:time/index.dt);
    if(!Number.isFinite(sample)||sample<0||sample>index.ticks+1e-9)fail('requested time is outside the cache');
    sample=Math.min(index.ticks,sample);
    const rounded=Math.round(sample);
    if(Math.abs(sample-rounded)<1e-10)sample=rounded;
    const at=index.frames.findIndex(row=>row.tick>=sample), last=index.frames.at(-1), right=index.frames[at]??last,
      left=right.tick===sample?right:index.frames[Math.max(0,at-1)], a=checkpoint(left);
    let volume=level==='detail'?detail(left):a.volume, mix=0;
    if(blend==='linear'&&left.tick!==right.tick){
      const b=checkpoint(right), other=level==='detail'?detail(right):b.volume;
      mix=(sample-left.tick)/(right.tick-left.tick);
      const operations=Object.fromEntries(Object.keys(volume.fields).map(key=>[key,'lerp']));
      ({document:volume}=V.combine(volume,other,{operations,mix,maxSamples:4000000}));
    }
    return {volume,report:{format:'ink-studio/atmosphere-playback',version:1,id:index.id,level,blend,tick:sample,time:sample*index.dt,
      frames:mix?[left.tick,right.tick]:[left.tick],mix,storage:V.inspect(volume)}};
  }
  function verify(){
    const recording=load(index.recording,R.runFormat), run=R.openRecording(recording);
    if(recording.origin.tick!==0||recording.end.tick!==index.ticks)fail('recording interval disagrees with the frame index');
    let checked=0;
    for(const row of index.frames){
      run.advance(row.tick);
      const {saved,volume}=checkpoint(row);
      if(!R.checkpointsEqual(run.checkpoint(),saved))fail('native replay diverged at tick '+row.tick);
      if(index.upRes){
        const computed=W.atmosphere.upRes(volume,index.upRes,{seed:index.seed,time:row.time});
        if(hash(serial(detail(row)))!==row.detail||hash(serial(computed.document))!==row.detail||
          !W.data.equal(computed.report,row.upRes))fail('up-resolution replay diverged at tick '+row.tick);
        checked++;
      }
    }
    if(!R.checkpointsEqual(run.checkpoint(),recording.end))fail('recording endpoint diverged');
    return {format:'ink-studio/atmosphere-verification',version:1,id:index.id,verified:true,frames:index.frames.length,
      detailFrames:checked,from:0,to:index.ticks};
  }
  return {index,playback,verify};
}

module.exports={format,hash,serial,read,writer,open};
