const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js'),{write,json}=require('./asset-files.js');
const {openSampleLibrary}=require('./sample-library.js');
const {resolveSampleAssets}=require('./music-sample-assets.js');
const {assetPaths,readProductionAssets}=require('./music-production.js');
const {readAudioSource}=require('./sound-source.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const pathText=n=>typeof n==='string' && n.trim().length>0;

module.exports=function command([mode,file,settingsFile],opt,kit) {
  const P=kit.KIT.procedural,A=P.mediaGraph.atmosphere,{fields,record,check}=P.musicInstruments;
  check(['plan','render','audition'].includes(mode) && file && (mode==='plan' || typeof opt.out==='string') &&
    (mode!=='audition' || settingsFile) && (mode!=='plan' || !settingsFile),
  'Use music atmosphere plan, render or audition with a recipe and the applicable plan or comparison');
  const at=relative=>path.resolve(path.dirname(path.resolve(file)),relative);
  const recipe=read(file);
  check(fields(recipe,['score','performance','production','productionOptions','assets','library','atmosphere','map']) &&
    [recipe.score,recipe.performance,recipe.production,recipe.library].every(n=>n===undefined || pathText(n)) &&
    (recipe.production!==undefined ? recipe.performance===undefined : recipe.score!==undefined && recipe.performance!==undefined) &&
    record(recipe.assets) && Object.keys(recipe.assets).length<=128,'Atmosphere needs a production or a score WAV with performed events');
  let score=recipe.score && readAudioSource(at(recipe.score),P), performance;
  if (recipe.production!==undefined) {
    const name=at(recipe.production), document=read(name), source=document.production ?? document;
    const assets=readProductionAssets(assetPaths(document,name),P);
    performance=kit.KIT.music.production.inspect(source,assets);
    if (!score) {
      const options={...document.options,...recipe.productionOptions,stems:false};
      check(options.start===undefined || options.start===0,'Atmosphere needs a production render starting at score zero');
      score=kit.KIT.music.production.render(source,assets,options).value;
    }
  } else performance=read(at(recipe.performance));
  const reference=A.reference(score,performance);
  if (recipe.map!==undefined) reference.map=recipe.map;
  const library=recipe.library && openSampleLibrary(at(recipe.library),{kit});
  const {assets}=resolveSampleAssets(recipe.assets,file,library,kit,{allowWav:true});
  const settings=settingsFile && read(settingsFile);
  let result;
  if (mode==='plan') {
    result=A.plan(reference,assets,recipe.atmosphere);
    if (typeof opt.out==='string') json(opt.out,result);
  } else {
    const folder=path.resolve(opt.out), save=(name,value)=>{
      const target=path.join(folder,name);
      write(target,WAV.encode(value,{encoding:'pcm24'}));
      return target;
    };
    const planFile=path.join(folder,'plan.json'), reportFile=path.join(folder,'report.json');
    if (mode==='render') {
      const plan=settings ?? A.plan(reference,assets,recipe.atmosphere);
      const {value,atmosphere,stems,report}=A.render(plan,score,assets,{stems:true});
      result={mix:save('mix.wav',value),atmosphere:save('atmosphere.wav',atmosphere),
        stems:Object.fromEntries(Object.entries(stems).map(([id,pcm])=>[id,save('stems/'+id+'.wav',pcm)])),
        plan:planFile,report:reportFile};
      json(planFile,plan);
      json(reportFile,report);
    } else {
      const {value,report}=A.audition(reference,score,assets,recipe.atmosphere,settings);
      result={audio:save('audition.wav',value),report:reportFile};
      json(reportFile,report);
    }
  }
  if (mode!=='plan' || typeof opt.out!=='string') process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result;
};
