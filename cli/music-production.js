const fs=require('node:fs');
const path=require('node:path');
const WAV=require('./wav.js');
const { readAudioSource } = require('./sound-source.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const nameValid=name=>/^[a-z][a-z0-9_-]{0,47}$/i.test(name) && !['__proto__','constructor','prototype'].includes(name);

function assetPaths(recipe,file) {
  const folder=path.dirname(path.resolve(file));
  return Object.fromEntries(Object.entries(recipe.assets ?? {}).map(([name,spec])=>{
    if (!nameValid(name) || typeof spec!=='string') throw new TypeError('Name each production asset and its audio source path');
    return [name,path.resolve(folder,spec)];
  }));
}
function readProductionAssets(paths,P) {
  return Object.fromEntries(Object.entries(paths).map(([name,file])=>[name,readAudioSource(file,P)]));
}
function writeAssetBank(folder,assets) {
  fs.mkdirSync(path.join(folder,'assets'),{recursive:true});
  return Object.fromEntries(Object.entries(assets).map(([name,audio])=>{
    const relative='assets/'+name+'.wav';
    fs.writeFileSync(path.join(folder,relative),WAV.encode(audio,{encoding:'pcm24'}));
    return [name,relative];
  }));
}
function writeWholePiece(folder,{value,assets},engine,{render,sampleRate}) {
  const bank=writeAssetBank(folder,assets);
  const pcm=render ? Object.fromEntries(Object.entries(bank).map(([name,file])=>[name,WAV.read(path.join(folder,file))])) : null;
  const candidates=value.candidates.map(({id,label,production,themeMap,report})=>{
    const at=path.join(folder,id);
    fs.mkdirSync(at,{recursive:true});
    const options={sampleRate,stems:false};
    const recipe={production,themeMap,options,assets:Object.fromEntries(Object.entries(bank)
      .map(([name,file])=>[name,path.relative(at,path.join(folder,file))]))};
    write(path.join(at,'production.json'),recipe);
    write(path.join(at,'form.json'),report);
    if (pcm) {
      const result=engine.render(production,pcm,options);
      writeTake(at,result.value,{},result.report);
    }
    return {id,label,production:id+'/production.json',form:id+'/form.json',...(pcm && {mix:id+'/mix.wav'})};
  });
  const manifest=path.join(folder,'manifest.json');
  write(manifest,{format:value.format,version:value.version,report:value.report,candidates});
  return {manifest,candidates};
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
  if (data?.format==='ink-studio/composition-search') return {session:data.session};
  const {session,...settings}=data;
  const source=typeof session==='string' ? read(path.resolve(path.dirname(file),session)) : session;
  return {...settings,session:source?.format==='ink-studio/composition-search' ? source.session : source};
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

function relativeAssets(folder,paths) {
  return Object.fromEntries(Object.entries(paths).map(([name,file])=>[name,path.relative(folder,file)]));
}
function writeLockedSearch(folder,engine,source,brief,assets,paths,options) {
  const plan=engine.searchLockedArrangement(source,brief,assets);
  const bank=Object.fromEntries(Object.entries(paths).map(([name,file])=>{
    const at=path.join(folder,'assets',name+'.wav');
    fs.mkdirSync(path.dirname(at),{recursive:true});
    if (at!==file) fs.copyFileSync(file,at);
    return [name,at];
  }));
  fs.mkdirSync(folder,{recursive:true});
  const search=path.join(folder,'search.json'), manifest=path.join(folder,'manifest.json');
  write(search,{plan,options:{sampleRate:options.sampleRate,stems:false},assets:relativeAssets(folder,bank)});
  const takes=plan.candidates.map(({id,label,evidence})=>{
    const at=path.join(folder,id), lockedArrangement=engine.keepLockedArrangement(plan,id);
    const settings={sampleRate:options.sampleRate,stems:false};
    fs.mkdirSync(at,{recursive:true});
    write(path.join(at,'production.json'),{lockedArrangement,options:settings,assets:relativeAssets(at,bank)});
    if (options.render) {
      const result=engine.renderLockedArrangement(lockedArrangement,assets,{...settings,...plan.report.preview});
      const preview=path.join(at,'preview.wav');
      fs.writeFileSync(preview,WAV.encode(result.value,{encoding:'pcm24'}));
      write(path.join(at,'preview.json'),result.report);
    }
    return {id,label,evidence,production:id+'/production.json',...(options.render && {preview:id+'/preview.wav'})};
  });
  write(manifest,{format:plan.format,version:plan.version,report:plan.report,takes});
  return {search,manifest,takes};
}

module.exports=function command([mode,file,config],opt,kit) {
  const P=kit.KIT.music.production;
  if (mode==='sound-library' || mode==='sound-pack') {
    const library=require('./music-sound-library.js');
    if (mode==='sound-library') {
      if (typeof opt.out==='string') write(opt.out,library.catalog);
      else process.stdout.write(JSON.stringify(library.catalog,null,2)+'\n');
      return library.catalog;
    }
    if (typeof opt.out!=='string') throw new TypeError('Use --out with a sound pack directory');
    const manifest=library.exportSoundPack(file,opt.out);
    process.stdout.write(manifest+'\n');
    return {manifest};
  }
  if (mode==='instrument-presets') {
    if (typeof opt.out==='string') write(opt.out,P.instrumentPresets);
    else process.stdout.write(JSON.stringify(P.instrumentPresets,null,2)+'\n');
    return P.instrumentPresets;
  }
  if (mode==='instrument-library') {
    if (typeof opt.out==='string') write(opt.out,P.instrumentLibrary);
    else process.stdout.write(JSON.stringify(P.instrumentLibrary,null,2)+'\n');
    return P.instrumentLibrary;
  }
  if (mode==='instrument-pack') {
    if (typeof opt.out!=='string') throw new TypeError('Use --out with an instrument pack directory');
    const {id,guide,patches,kit:sampleKit,assets}=P.loadInstrumentPack(file,config ? read(config) : undefined);
    const folder=path.resolve(opt.out), bank=writeAssetBank(folder,assets);
    const patch=patches[id], manifest=path.join(folder,'instrument.json');
    write(manifest,{format:'ink-studio/instrument-pack',version:1,id,guide,
      ...(patch ? {patch} : {kit:sampleKit}),assets:bank});
    const result={manifest,assets:Object.keys(bank).length};
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  if (mode==='compose-piece') {
    if (typeof opt.out!=='string') throw new TypeError('Use --out with a whole-piece draft directory');
    const sampleRate=Number(opt['sample-rate'] ?? 48000);
    if (!Number.isInteger(sampleRate) || sampleRate<8000 || sampleRate>48000)
      throw new RangeError('Whole-piece prints need a sample rate from 8000 to 48000 Hz');
    const pack=P.composeWholePiece(file ? read(file) : undefined);
    const result=writeWholePiece(path.resolve(opt.out),pack,P,{render:opt.render===true,sampleRate});
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  if (!file) throw new TypeError('Use music production with a mode and a recipe. Producer modes are plan-audition, review-audition and keep-audition');
  const recipe=read(file);
  const {sources,paths,timeline}=mode==='timeline' ? timelineBank(recipe,file) : {paths:assetPaths(recipe,file)};
  const assets=readProductionAssets(paths,kit.KIT.procedural);
  const production=recipe.lockedArrangement?.production ?? recipe.production ?? recipe;
  if (mode==='search-locked') {
    if (!config || typeof opt.out!=='string') throw new TypeError('Use a production, a locked brief, and --out directory');
    const sampleRate=Number(opt['sample-rate'] ?? 48000);
    if (!Number.isInteger(sampleRate) || sampleRate<8000 || sampleRate>48000)
      throw new RangeError('Locked arrangement renders need a sample rate from 8000 to 48000 Hz');
    const result=writeLockedSearch(path.resolve(opt.out),P,production,read(config),assets,paths,
      {render:opt.render===true,sampleRate});
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  if (mode==='keep-locked') {
    if (!config || typeof opt.out!=='string') throw new TypeError('Use a locked search, a take selection and --out file');
    const lockedArrangement=P.keepLockedArrangement(recipe.plan,read(config).take);
    const folder=path.dirname(path.resolve(opt.out));
    fs.mkdirSync(folder,{recursive:true});
    write(opt.out,{lockedArrangement,options:{stems:false,...recipe.options},assets:relativeAssets(folder,paths)});
    const result={production:path.resolve(opt.out),take:lockedArrangement.id};
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  let value;
  if (mode==='play-kit') {
    if (!config || typeof opt.out!=='string') throw new TypeError('Use a kit recipe, performance JSON and --out directory');
    const {events,options}=read(config), folder=path.resolve(opt.out);
    const result=kit.KIT.procedural.mediaGraph.sampleKit.render(recipe.kit,assets,events,{...options,stems:true});
    writeTake(folder,result.value,result.stems,result.report);
    value={mix:path.join(folder,'mix.wav'),report:path.join(folder,'report.json')};
    process.stdout.write(JSON.stringify(value)+'\n');
    return value;
  }
  if (mode==='inspect-instrument') value=P.inspectInstrumentGraph(recipe.patch ?? recipe,assets);
  else if (mode==='inspect') value=P.inspect(production,assets);
  else if (mode==='performances') value=P.planPerformances(production,config ? read(config) : recipe.performances,assets);
  else if (mode==='themes' && config)
    value={...P.developThemes(production,read(config),assets),...(recipe.assets && {assets:paths})};
  else if (mode==='cue-map')
    value={...P.mapCue(production,config ? read(config) : production.cueMap,assets),...(recipe.assets && {assets:paths})};
  else if (mode==='voice-lead' && config) value=P.voiceLead(production,read(config),assets);
  else if (mode==='groove') {
    const map=config ? read(config) : production.grooveMap;
    if (!map) throw new TypeError('Provide a groove transfer settings file');
    let template=map.template;
    if (config && typeof template==='string') template=read(path.resolve(path.dirname(config),template));
    let ensemble=map.ensemble;
    if (config && kit.KIT.procedural.musicInstruments.record(ensemble?.takes)) {
      const takes=Object.fromEntries(Object.entries(ensemble.takes).map(([name,entry])=>{
        const model=typeof entry==='string' ? read(path.resolve(path.dirname(config),entry)) : entry;
        return [name,model?.take ?? model];
      }));
      ensemble={...ensemble,takes};
    }
    value={...P.mapGroove(production,{...map,...(template!==undefined && {template:template?.template ?? template}),
      ...(ensemble!==undefined && {ensemble})},assets),
      ...(recipe.assets && {assets:paths}),...(recipe.options && {options:recipe.options})};
  }
  else if (mode==='analyze') value=P.analyze(production,assets,config ? read(config) : recipe.options);
  else if (mode==='suggest') value=P.suggest(production,config ? read(config) : recipe.options,assets);
  else if (mode==='search') value=P.searchComposition(production,config ? read(config) : recipe.brief,assets);
  else if (mode==='pocket') value=P.planPocket(production,config ? read(config) : recipe.pocket,assets);
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
      const host=opt['clap-host']===undefined ? undefined : require('./clap-adapter').load(opt['clap-host']);
      const result=mode==='timeline' ?
        P.renderTimeline(sources,timeline,adaptiveIntents(kit.KIT,recipe),assets,{...recipe.options,stems:true},host) :
        recipe.lockedArrangement ? P.renderLockedArrangement(recipe.lockedArrangement,assets,recipe.options) :
          P.render(production,assets,{stems:true,...recipe.options},host);
      writeTake(folder,result.value,result.stems,result.report,mode==='render' && !recipe.lockedArrangement ? production : undefined,paths);
      if (mode==='render' && recipe.lockedArrangement)
        write(path.join(folder,'production.json'),{...recipe,assets:relativeAssets(folder,paths)});
      value={mix:path.join(folder,'mix.wav'),report:path.join(folder,'report.json')};
    }
    process.stdout.write(JSON.stringify(value)+'\n');
    return value;
  } else throw new TypeError('Unknown music production command');
  if (typeof opt.out==='string') write(opt.out,value);
  else process.stdout.write(JSON.stringify(value,null,2)+'\n');
  return value;
};
module.exports.assetPaths = assetPaths;
module.exports.timelineBank = timelineBank;
module.exports.readProductionAssets = readProductionAssets;
