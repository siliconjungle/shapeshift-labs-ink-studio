const fs=require('node:fs'), path=require('node:path'), WAV=require('./wav.js');
const {write,json}=require('./asset-files.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const done=result=>{process.stdout.write(JSON.stringify(result)+'\n');return result;};

function parse(text,trial) {
  const raw=String(text ?? '').slice(0,6000);
  const body=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let reply;
  try {reply=JSON.parse(body);} catch {
    const choice=body.match(/^(?:choice:\s*|\{\s*['"]choice['"]\s*:\s*['"])(A|B|tie|abstain)\b/i)?.[1];
    const reason=body.match(/^reason:\s*(.+)$/im)?.[1];
    const evidence=Array.from(body.matchAll(/^evidence:\s*(A|B)\s+([0-9.]+)\s+([0-9.]+)\s*\|\s*(.+)$/gim),row=>
      ({side:row[1].toUpperCase(),from:Number(row[2]),to:Number(row[3]),observation:row[4]}));
    if (choice) reply={choice:choice.length===1 ? choice.toUpperCase() : choice.toLowerCase(),reason,evidence};
  }
  if (['A','B','tie','abstain'].includes(reply?.choice)) {
    const reason=typeof reply.reason==='string' ? reply.reason.trim().slice(0,1000) : '';
    return {trial,choice:reply.choice,...(reason && {reason}),
      ...(Array.isArray(reply.evidence) && {evidence:reply.evidence.slice(0,8)}),raw};
  }
  return {trial,choice:'abstain',reason:'The model did not return a recognizable choice.',raw};
}

async function run(file,out,opt,kit) {
  const {fields,integer,id,check}=kit.KIT.procedural.musicInstruments;
  const manifest=read(file), {trials,token}=manifest, folder=path.dirname(path.resolve(file));
  const endpoint=new URL(opt.endpoint ?? 'http://127.0.0.1:8767');
  check(endpoint.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname) &&
    !endpoint.username && !endpoint.password && endpoint.pathname==='/' && !endpoint.search && !endpoint.hash,
  'Use a loopback audio.cpp server URL');
  const model=opt.model ?? 'music-flamingo', modelLabel=opt.label ?? model;
  check(id(model) && typeof modelLabel==='string' && modelLabel.trim() && modelLabel.length<=160 &&
    fields(manifest,['format','version','id','token','trials','files']) &&
    manifest.format==='ink-studio/listener-pairs' && manifest.version===1 &&
    typeof token==='string' && Array.isArray(trials) && integer(trials.length,3,96) &&
    new Set(trials.map(trial=>trial?.id)).size===trials.length,
  'Open a public listener manifest and name the local model');
  const result=fs.existsSync(out) ? read(out) : {token,model:modelLabel,responses:[]};
  check(fields(result,['token','model','responses']) && result.token===token && result.model===modelLabel &&
    Array.isArray(result.responses) && result.responses.length<=trials.length,'Output contains another listener run');
  const retired=new Set(result.responses.map(row=>row.trial));
  for (const trial of trials) {
    check(id(trial.id) && typeof trial.question==='string' && trial.question.length<=400 &&
      integer(trial.sampleRate,8000,48000) && manifest.files?.[trial.id]===trial.id+'.wav' &&
      ['A','B'].every(side=>integer(trial.halves?.[side]?.firstSample,0,32e6) &&
        integer(trial.halves?.[side]?.endSample,trial.halves[side].firstSample+1,32e6)),
    'Invalid public listener trial or WAV path');
    if (retired.has(trial.id)) continue;
    const audio=fs.realpathSync(path.join(folder,trial.id+'.wav'));
    check(path.dirname(audio)===fs.realpathSync(folder),'Listener WAV must stay in the public pack');
    const at=(side,field)=>(trial.halves[side][field]/trial.sampleRate).toFixed(3);
    const prompt=[
      `Listen to A from ${at('A','firstSample')} to ${at('A','endSample')} seconds, then B from ${at('B','firstSample')} to ${at('B','endSample')} seconds.`,
      trial.question,
      'Compare each excerpt from its own start. Ignore the gap and presentation order. Choose tie for the same sound and abstain if unsure.',
      'Write Choice: followed by exactly A, B, tie, or abstain. Then write Reason: and one sentence.',
      'Optionally add Evidence: SIDE START END | observation on a new line. Use seconds from the start of that side.'
    ].join(' ');
    const response=await fetch(new URL('/v1/audio/transcriptions',endpoint),{
      method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(150000),
      body:JSON.stringify({model,audio,prompt,options:{instruct:prompt,max_tokens:'188',do_sample:'false'}})
    });
    if (!response.ok) {
      const detail=await response.text();
      throw new Error('Local audio listener returned HTTP '+response.status+(detail ? ': '+detail.slice(0,400) : ''));
    }
    const {text}=await response.json(), answer=parse(text,trial.id);
    result.responses.push(answer);
    json(out,result);
    if (opt.progress) process.stderr.write(trial.id+' '+answer.choice+'\n');
  }
  return done({responses:out,count:result.responses.length,model:modelLabel});
}

module.exports=function command(mode,file,config,opt,kit) {
  const K=kit.KIT, {fields,check,record,id}=K.procedural.musicInstruments, L=K.music.production.critique.listener;
  check(file && typeof opt.out==='string','Supply a listener input and --out');
  const out=path.resolve(opt.out);
  if (mode==='listener-run') return run(file,out,opt,kit);
  if (mode==='listener-score') {
    check(config,'Supply the private listener key and responses');
    const grade=L.evaluate(read(file),read(config));
    json(out,grade);
    return done({report:out,criteria:grade.criteria});
  }
  const recipe=read(file), clips={};
  check(fields(recipe,['clips','settings']) && record(recipe.clips) && Object.keys(recipe.clips).length<=128,
    'Choose named WAV clips and listener cases');
  let budget=0;
  for (const [name,row] of Object.entries(recipe.clips)) {
    const spec=typeof row==='string' ? {wav:row} : row;
    check(id(name) && fields(spec,['wav','firstSample']) && typeof spec.wav==='string','Invalid listener clip reference');
    const audio=WAV.read(path.resolve(path.dirname(path.resolve(file)),spec.wav));
    budget+=audio.samples.length;
    check(budget<=32e6,'Listener source WAVs exceed the PCM budget');
    clips[name]={audio,firstSample:spec.firstSample ?? 0};
  }
  const pack=L.pack(clips,recipe.settings);
  const publicDir=path.join(out,'public'), manifest=path.join(publicDir,'manifest.json'), key=path.join(out,'key.json');
  const files=Object.fromEntries(Object.entries(pack.audio).map(([id,value])=>{
    const name=id+'.wav';
    write(path.join(publicDir,name),WAV.encode(value,{encoding:'pcm24'}));
    return [id,name];
  }));
  json(manifest,{...pack.value,files});
  json(key,pack.key);
  return done({manifest,key,trials:pack.value.trials.length});
};
