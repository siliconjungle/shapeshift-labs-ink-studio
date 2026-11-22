const fs=require('node:fs'), path=require('node:path'), WAV=require('./wav.js');
const {write,json,publishJson}=require('./asset-files.js');
const {readAssets}=require('./music-mixer.js'), page=require('./music-session-ballot-page.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const questions=['identity','groove','replay'], labels=['a','b','c','d'];
const sound=(file,pcm)=>write(file,WAV.encode(pcm,{encoding:'pcm24'}));

function publish(folder,result,save) {
  const root=path.resolve(folder), {value,sessions,clips,ballot}=result;
  const files={sessions:{},context:{}};
  if (ballot) publishJson(path.join(root,'review-key.json'),ballot.key,
    'A different listening round already uses this directory');
  for (const [id,session] of Object.entries(sessions)) {
    const file=path.join('sessions',id+'.json');
    save(path.join(root,file),session);
    files.sessions[id]=file;
  }
  for (const [id,pcm] of Object.entries(clips)) {
    const file=path.join('context',id+'.wav');
    sound(path.join(root,file),pcm);
    files.context[id]=file;
  }
  const report=path.join(root,'report.json');
  json(report,{...value,files});
  if (!ballot) return {report,ballot:null};
  const publicDir=path.join(root,'public');
  const declared={...ballot.test,questions:ballot.test.questions.map(question=>({...question,
    files:Object.fromEntries(ballot.test.labels.map(label=>[label,question.id+'/'+label+'.wav']))}))};
  for (const {id,files} of declared.questions) for (const [label,file] of Object.entries(files))
    sound(path.join(publicDir,file),ballot.audio[id][label]);
  json(path.join(publicDir,'test.json'),declared);
  const player=path.join(publicDir,'index.html');
  write(player,page(declared,'Blind listening ballot'));
  const clipsForModel={}, cases=[];
  for (const row of declared.questions) {
    if (row.frames/declared.sampleRate>15 || declared.sampleRate>48000) continue;
    const takes=Object.entries(ballot.key.ballot.map[row.id]);
    const first=takes.find(([,take])=>take.stage==='reference');
    const second=takes.find(([,take])=>take.stage!=='reference' && take.audioHash!==first[1].audioHash);
    if (!second) continue;
    const left=row.id+'-reference', right=row.id+'-candidate';
    clipsForModel[left]='public/'+row.files[first[0]];
    clipsForModel[right]='public/'+row.files[second[0]];
    cases.push({id:row.id,criterion:row.id,kind:'preference',question:row.prompt,left,right});
  }
  const preferences=cases.length ? path.join(root,'listener-preferences.json') : null;
  if (preferences) json(preferences,{clips:clipsForModel,settings:{id:value.id,cases}});
  return {report,player,key:path.join(root,'review-key.json'),preferences};
}

function evidence(folder,{value,clips}) {
  const root=path.resolve(folder), files={};
  for (const [id,pcm] of Object.entries(clips)) {
    files[id]=id+'.wav';
    sound(path.join(root,files[id]),pcm);
  }
  const report=path.join(root,'report.json');
  json(report,{...value,files});
  return {report,files};
}

function vote(mode,keyFile,request,folder,P) {
  const {check,fields,id}=P.musicInstruments,L=P.mediaGraph.listeningRound;
  check(keyFile && request && typeof folder==='string','Supply a private round key, ballot or pick, and --out');
  const key=read(keyFile), root=path.dirname(path.resolve(keyFile)), target=path.resolve(folder), input=read(request);
  const names=key?.ballot?.test?.labels;
  check(Array.isArray(names) && names.length>=2 && names.length<=4 && names.every((name,i)=>name===labels[i]),
    'Choose a valid blind ballot key');
  const audio=Object.fromEntries(questions.map(question=>[question,Object.fromEntries(names.map(label=>[label,
    WAV.read(path.join(root,'public',question,label+'.wav'))]))]));
  if (mode==='record-round') {
    const entry=L.archive(key,input,audio);
    const file=path.join(target,entry.series,entry.test.token,entry.listener+'.json');
    publishJson(file,entry,'This listener already submitted a different ballot for this round');
    return {ballot:file};
  }
  check(fields(input,['ballot','candidate','question']) && typeof input.ballot==='string' &&
    id(input.candidate) && questions.includes(input.question),'Supply a ballot file and a favored candidate');
  const recorded=read(path.resolve(path.dirname(request),input.ballot)), submission=recorded.submission ?? recorded;
  const file=path.join(root,'sessions',input.candidate+'.json'), recipe=read(file);
  const assets=readAssets(recipe.assets ?? {},file,P);
  const {session,decision,next}=L.keep(key,submission,audio,recipe.session,{question:input.question,candidate:input.candidate},assets);
  const paths=Object.fromEntries(Object.entries(recipe.assets ?? {}).map(([id,source])=>
    [id,path.relative(target,path.resolve(path.dirname(file),source))]));
  const sessionFile=path.join(target,'session.json'), reference=path.join(target,'decision.json');
  json(sessionFile,{session,assets:paths});
  const excerpt=path.join(target,'excerpt.wav');
  sound(excerpt,audio[decision.question][decision.label]);
  json(reference,{...decision,file:'excerpt.wav'});
  json(path.join(target,'next-round.json'),next);
  return {session:sessionFile,decision:reference,excerpt};
}

module.exports={publish,evidence,vote};
