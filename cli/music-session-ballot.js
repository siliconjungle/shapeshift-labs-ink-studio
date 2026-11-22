const fs=require('node:fs'), path=require('node:path'), WAV=require('./wav.js');
const {write,json,publishJson}=require('./asset-files.js');
const page=require('./music-session-ballot-page.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const stages=['current','source','performance','arrangement'];
const labels=['a','b','c','d'], questions=['identity','replay'];

function publish(folder,{report,test,key,audio,sessions},save) {
  const root=path.resolve(folder), publicDir=path.join(root,'public');
  const declared={...test,questions:test.questions.map(question=>({...question,
    files:Object.fromEntries(labels.map(label=>[label,question.id+'/'+label+'.wav']))}))};
  const result={player:path.join(publicDir,'index.html'),manifest:path.join(publicDir,'test.json'),
    key:path.join(root,'review-key.json'),report:path.join(root,'report.json')};
  publishJson(result.key,key,'A different ballot already uses this output directory');
  for (const {id,files} of declared.questions) for (const label of labels) {
    write(path.join(publicDir,files[label]),WAV.encode(audio[id][label],{encoding:'pcm24'}));
  }
  json(result.manifest,declared);
  write(result.player,page(declared));
  const recipes=Object.fromEntries(stages.map(stage=>[stage,save(path.join(root,'sessions',stage+'.json'),sessions[stage]).session]));
  json(result.report,{...report,sessions:Object.fromEntries(Object.entries(recipes)
    .map(([stage,file])=>[stage,path.relative(root,file)]))});
  return result;
}

function archive(keyFile,voteFile,folder,P) {
  P.musicInstruments.check(keyFile && voteFile && typeof folder==='string','Supply a private key, ballot JSON and archive directory');
  const key=read(keyFile), vote=read(voteFile), root=path.join(path.dirname(path.resolve(keyFile)),'public');
  const audio=Object.fromEntries(questions.map(id=>[id,Object.fromEntries(labels.map(label=>
    [label,WAV.read(path.join(root,id,label+'.wav'))]))]));
  const entry=P.mediaGraph.performanceBallot.archive(key,vote,audio);
  const file=path.resolve(folder,entry.test.token,entry.listener+'.json');
  publishJson(file,entry,'This listener already submitted a different ballot for this test');
  return {ballot:file};
}

module.exports={publish,archive};
