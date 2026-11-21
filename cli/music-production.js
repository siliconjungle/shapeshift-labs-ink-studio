const fs=require('node:fs');
const path=require('node:path');
const WAV=require('./wav.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const nameValid=name=>/^[a-z][a-z0-9_-]{0,47}$/i.test(name) && !['__proto__','constructor','prototype'].includes(name);

function assetPaths(recipe,file) {
  const folder=path.dirname(path.resolve(file));
  return Object.fromEntries(Object.entries(recipe.assets ?? {}).map(([name,spec])=>{
    if (!nameValid(name) || typeof spec!=='string') throw new TypeError('Name each production asset and its WAV path');
    return [name,path.resolve(folder,spec)];
  }));
}
function timelineBank(recipe,file) {
  const paths=assetPaths(recipe,file);
  const maps={};
  const sources=Object.fromEntries(Object.entries(recipe.sources ?? {}).map(([name,spec])=>{
    if (!nameValid(name)) throw new TypeError('Use a named production source');
    const at=typeof spec==='string' ? path.resolve(path.dirname(file),spec) : file;
    const source=typeof spec==='string' ? read(at) : spec;
    for (const [key,value] of Object.entries(assetPaths(source,at))) {
      if (Object.hasOwn(paths,key) && paths[key]!==value)
        throw new RangeError('Production sources disagree on asset '+key);
      paths[key]=value;
    }
    if (source.themeMap!==undefined) maps[name]=source.themeMap;
    return [name,source.production ?? source];
  }));
  const thematic=recipe.timeline?.thematic;
  const timeline=thematic!==undefined || Object.keys(maps).length ? {...recipe.timeline,
    thematic:{...thematic,maps:{...maps,...thematic?.maps}}} : recipe.timeline;
  return {sources,paths,timeline};
}
function adaptiveIntents(K,recipe) {
  if (recipe.adaptive===undefined) return recipe.intents;
  const {score,updates=[]}=recipe.adaptive;
  if (recipe.intents!==undefined || !Array.isArray(updates) || updates.length>2048)
    throw new TypeError('Use either recorded intents or a bounded set of adaptive score updates');
  const clock=K.music.create(score), events=[];
  let state=clock.initial();
  for (const update of [...updates,{time:recipe.timeline.end}]) {
    const result=clock.advance(state,update);
    events.push(...result.intents);
    state=result.state;
  }
  return events;
}
function writeTake(folder,value,stems,report,production,paths) {
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'mix.wav'),WAV.encode(value,{encoding:'pcm24'}));
  const solos=path.join(folder,'stems');
  if (Object.keys(stems ?? {}).length) fs.mkdirSync(solos,{recursive:true});
  for (const [name,stem] of Object.entries(stems ?? {})) {
    if (!nameValid(name)) throw new TypeError('Unsafe stem name');
    fs.writeFileSync(path.join(solos,name+'.wav'),WAV.encode(stem,{encoding:'pcm24'}));
  }
  write(path.join(folder,'report.json'),report);
  if (production) writeRecipe(folder,production,paths);
}
function writeRecipe(folder,production,paths) {
  write(path.join(folder,'production.json'),{production,
    assets:Object.fromEntries(Object.entries(paths).map(([name,at])=>[name,path.relative(folder,at)]))});
}
function sessionConfig(file) {
  const data=read(file);
  if (data?.format==='ink-studio/producer-session') return {session:data};
  const {session,...settings}=data;
  return {...settings,session:typeof session==='string' ? read(path.resolve(path.dirname(file),session)) : session};
}
function writeReview(folder,result,paths) {
  fs.mkdirSync(folder,{recursive:true});
  const takes=result.takes.map((take,index)=>{
    const at=path.join(folder,take.id), summary=result.report.takes[index];
    writeTake(at,take.value,{},summary,take.production,paths);
    const focusFiles={};
    for (const [id,audio] of Object.entries(take.focus)) {
      const file='focus-'+id+'.wav';
      fs.writeFileSync(path.join(at,file),WAV.encode(audio,{encoding:'pcm24'}));
      focusFiles[id]=take.id+'/'+file;
    }
    return {...summary,mix:take.id+'/mix.wav',production:take.id+'/production.json',focusFiles};
  });
  const manifest=path.join(folder,'manifest.json');
  write(manifest,{...result.report,takes});
  return {manifest,takes:takes.map(take=>take.id)};
}

module.exports=function command([mode,file,config],opt,kit) {
  if (!file) throw new TypeError('Use music production with a mode and a recipe. Producer modes are plan-audition, review-audition and keep-audition');
  const recipe=read(file);
  const {sources,paths,timeline}=mode==='timeline' ? timelineBank(recipe,file) : {paths:assetPaths(recipe,file)};
  const assets=Object.fromEntries(Object.entries(paths).map(([name,file])=>[name,WAV.read(file)]));
  const production=recipe.production ?? recipe;
  const P=kit.KIT.music.production;
  let value;
  if (mode==='inspect') value=P.inspect(production,assets);
  else if (mode==='performances') value=P.planPerformances(production,config ? read(config) : recipe.performances,assets);
  else if (mode==='themes' && config)
    value={...P.developThemes(production,read(config),assets),...(recipe.assets && {assets:paths})};
  else if (mode==='analyze') value=P.analyze(production,assets,config ? read(config) : recipe.options);
  else if (mode==='suggest') value=P.suggest(production,config ? read(config) : recipe.options,assets);
  else if (mode==='plan-audition') value=P.planProducer(production,config ? read(config) : recipe.brief,assets);
  else if (mode==='revise' && config) {
    const document=read(config);
    const revision=document?.format==='ink-studio/producer-reference' && document.version===1 ? document.revision : document;
    value={production:P.revise(production,revision,assets),...(recipe.assets && {
      assets:paths
    })};
  } else if (['render','audition','timeline','review-audition','keep-audition'].includes(mode)) {
    if (typeof opt.out!=='string') throw new TypeError('Use --out with a production output directory');
    const folder=path.resolve(opt.out);
    if (mode==='review-audition' || mode==='keep-audition') {
      if (!config) throw new TypeError('Use a producer session or selection file');
      const {session,...settings}=sessionConfig(config);
      if (mode==='review-audition') {
        const result=P.reviewProducer(production,session,assets,settings.options ?? recipe.review);
        value=writeReview(folder,result,paths);
      } else {
        const kept=P.keepProducer(production,session,settings,assets);
        fs.mkdirSync(folder,{recursive:true});
        const reference=path.join(folder,'reference.json');
        write(reference,kept.reference);
        writeRecipe(folder,kept.production,paths);
        value={reference,production:path.join(folder,'production.json')};
      }
    } else if (mode==='audition') {
      const variants=config ? read(config) : recipe.variants;
      const rows=Array.isArray(variants) ? variants : variants?.variants;
      const suggested=!Array.isArray(variants) && Array.isArray(rows) && (!rows.length || rows.some(row=>row?.revision));
      const normalized=suggested ?
        [{id:'reference'},...rows.map(row=>row.revision)] : rows;
      const result=P.audition(production,normalized,assets,recipe.options);
      const entries=result.takes.map(take=>{
        writeTake(path.join(folder,take.id),take.value,take.stems,take.report,take.production,paths);
        return {...take.report,id:take.id,mix:take.id+'/mix.wav',production:take.id+'/production.json',
          stemFiles:Object.fromEntries(Object.keys(take.stems).map(name=>[name,take.id+'/stems/'+name+'.wav']))};
      });
      write(path.join(folder,'manifest.json'),{...result.report,takes:entries});
      value={manifest:path.join(folder,'manifest.json'),takes:result.takes.map(take=>take.id)};
    } else {
      const result=mode==='timeline' ?
        P.renderTimeline(sources,timeline,adaptiveIntents(kit.KIT,recipe),assets,{...recipe.options,stems:true}) :
        P.render(production,assets,{...recipe.options,stems:true});
      writeTake(folder,result.value,result.stems,result.report,mode==='render'?production:undefined,paths);
      value={mix:path.join(folder,'mix.wav'),report:path.join(folder,'report.json')};
    }
    process.stdout.write(JSON.stringify(value)+'\n');
    return value;
  } else throw new TypeError('Unknown music production command');
  if (typeof opt.out==='string') write(opt.out,value);
  else process.stdout.write(JSON.stringify(value,null,2)+'\n');
  return value;
};
