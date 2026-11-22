const fs=require('node:fs'),path=require('node:path'),WAV=require('./wav.js');
const {write,json,publishJson}=require('./asset-files.js'),{assetPaths}=require('./music-production.js');
const listeningPage=require('./music-critique-listen.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const relative=(file,ref)=>path.resolve(path.dirname(path.resolve(file)),ref);
const audio=(file,value)=>write(file,WAV.encode(value,{encoding:'pcm24'}));

const listeningFile=/^test-[a-z0-9]+-[a-z0-9]+\.json$/;
function readMemory(file,check) {
  if (!fs.statSync(file).isDirectory()) return read(file);
  const names=fs.readdirSync(file).filter(name=>listeningFile.test(name)).sort();
  check(names.length<=256,'Listening preference memory exceeds its test budget');
  const entries=names.map(name=>{
    const entry=read(path.join(file,name));
    check(name===entry?.token+'.json','A preference record must match its test token');
    return entry;
  });
  return {format:'ink-studio/listening-preference-memory',version:1,entries};
}

module.exports=function command([mode,file,config,settingsFile],opt,kit) {
  if (['listener-pack','listener-run','listener-score'].includes(mode))
    return require('./music-critique-calibration.js')(mode,file,config,opt,kit);
  const C=kit.KIT.music.production.critique,{check,fields}=kit.KIT.procedural.musicInstruments;
  check(typeof file==='string' && ['plan','listen','keep','tag','find','inspect','compare','diagnose','apply','foreground','remember','recall'].includes(mode),
    'Use music critique inspect, compare, diagnose, apply, foreground, plan, listen, keep, remember, recall, tag or find');
  const out=typeof opt.out==='string' ? path.resolve(opt.out) : undefined;
  const output=(result,target)=>{
    if (target) json(target,result);
    else process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return result;
  };
  if (mode==='remember') {
    check(config,'Supply a memory directory and a kept blind reference');
    const directory=path.resolve(file), {entries:[entry]}=C.rememberPreference(undefined,read(config));
    const target=path.join(directory,entry.token+'.json');
    check(!fs.existsSync(directory) || fs.existsSync(target) ||
      fs.readdirSync(directory).filter(name=>listeningFile.test(name)).length<256,
      'Listening preference memory exceeds its test budget');
    publishJson(target,entry,'This blind test is already archived with a different decision');
    return output({memory:directory,entry:target});
  }
  if (mode==='recall') {
    check(config,'Supply a listening context query');
    return output(C.recallPreferences(readMemory(file,check),read(config)),out);
  }
  if (mode==='tag') {
    check(out && config,'Tag a source WAV with a settings file and output directory');
    const {reference,value}=C.tagReference(WAV.read(file),read(config));
    const label=path.join(out,'reference.json');
    publishJson(label,{...reference,audio:'clip.wav'},'A different listening reference already uses this directory');
    audio(path.join(out,'clip.wav'),value);
    return output({reference:label});
  }
  if (mode==='find') {
    const index=read(file);
    check(Array.isArray(index) && index.length<=512,'Supply an array of references or reference JSON paths');
    const paths=new Map(), entries=index.map(row=>{
      if (typeof row!=='string') return row;
      const location=relative(file,row), entry=read(location);
      paths.set(entry.id,location);
      return entry;
    });
    return output(C.findReferences(entries,config && read(config))
      .map(hit=>({...hit,...(paths.has(hit.id) && {file:paths.get(hit.id)})})),out);
  }
  const recipe=read(file), source=recipe.session ?? recipe.production ?? recipe, paths=assetPaths(recipe,file);
  const assets=Object.fromEntries(Object.entries(paths).map(([id,at])=>[id,WAV.read(at)]));
  function publishPreview(result,folder) {
    const files=Object.fromEntries(Object.entries(result.audio).map(([id,value])=>{
      const name=id+'.wav';
      audio(path.join(folder,name),value);
      return [id,name];
    }));
    const report=path.join(folder,'report.json');
    json(report,{...result.report,files});
    if (!result.key) return {report,files};
    const key=path.join(folder,'comparison.json');
    json(key,result.key);
    return {report,files,key,token:result.key.token};
  }
  if (mode==='inspect' || mode==='compare' || mode==='diagnose') {
    check(config && out,'Supply a listening request and output directory');
    return output(publishPreview(C.openAudio(source,assets)[mode](read(config)),out));
  }
  if (mode==='foreground') {
    check(config && out,'Supply foreground mix settings and an output directory');
    const result=kit.KIT.music.production.foregroundMix.audition(source,read(config),assets);
    const production=path.join(out,'production.json'), plan=path.join(out,'foreground.json');
    json(production,{production:result.production,assets:Object.fromEntries(Object.entries(paths)
      .map(([name,at])=>[name,path.relative(out,at)])),...(recipe.options && {options:recipe.options})});
    json(plan,{...result.report,request:result.request});
    return output({production,plan,...publishPreview(result.comparison,path.join(out,'comparison'))});
  }
  if (mode==='apply') {
    check(config && settingsFile && out,'Supply a comparison, decision and output directory');
    const result=C.applyEdit(source,read(config),read(settingsFile),assets);
    const reference=path.join(out,'reference.json'), session=Boolean(result.session), name=session ? 'session' : 'production';
    const target=path.join(out,name+'.json');
    publishJson(reference,result.reference,'A different critique decision already uses this directory');
    json(path.join(out,'revision.json'),result.revision);
    json(target,{[name]:result[name],assets:Object.fromEntries(Object.entries(paths)
      .map(([name,at])=>[name,path.relative(out,at)])),...(!session && recipe.options && {options:recipe.options})});
    return output({reference,[name]:target});
  }
  if (mode==='plan') {
    check(config,'Supply a critique brief');
    const brief=read(config);
    if (typeof brief.memory==='string') brief.memory=readMemory(relative(config,brief.memory),check);
    if (typeof brief.references==='string') {
      const indexed=relative(config,brief.references), notes=read(indexed);
      check(Array.isArray(notes) && notes.length<=512,'Reference index needs an array of entries or JSON paths');
      brief.references=notes.map(row=>typeof row==='string' ? read(relative(indexed,row)) : row);
    }
    return output(C.plan(source,brief,assets),out);
  }
  check(config && out,'Use a plan or private key file and an output directory');
  if (mode==='listen') {
    const {test,key,audio:takes,evidence}=C.blind(source,read(config),assets,settingsFile && read(settingsFile));
    const publicDir=path.join(out,'public'), desk=path.join(publicDir,'index.html'), manifest=path.join(publicDir,'test.json');
    const privateKey=path.join(out,'review-key.json');
    publishJson(privateKey,key,'A different blind listening test already uses this directory');
    const files=Object.fromEntries(test.labels.map(label=>[label,label+'.wav']));
    for (const [label,value] of Object.entries(takes)) audio(path.join(publicDir,files[label]),value);
    json(manifest,{...test,files});
    write(desk,listeningPage({...test,files}));
    const evidenceDir=path.join(out,'evidence');
    for (const [name,value] of Object.entries(evidence.audio)) audio(path.join(evidenceDir,name+'.wav'),value);
    const clips=Object.fromEntries(Object.entries(evidence.ranges).map(([name,address])=>[name,{...address,file:name+'.wav'}]));
    json(path.join(evidenceDir,'report.json'),{...evidence.report,previewGain:evidence.gain,clips});
    return output({player:desk,manifest,key:privateKey,evidence:path.join(evidenceDir,'report.json')});
  }
  check(settingsFile,'Supply the listening decision JSON alongside the private key');
  const result=C.keep(source,read(config),read(settingsFile),assets);
  const reference=path.join(out,'reference.json'), production=path.join(out,'production.json');
  publishJson(reference,result.reference,'A different listening decision already uses this directory');
  json(path.join(out,'producer-reference.json'),result.producerReference);
  json(production,{production:result.production,assets:Object.fromEntries(Object.entries(paths)
    .map(([name,at])=>[name,path.relative(out,at)]))});
  return output({reference,production});
};
