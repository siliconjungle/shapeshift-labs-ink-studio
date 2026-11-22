const fs=require('node:fs'), path=require('node:path');
const WAV=require('./wav.js'), {write,json}=require('./asset-files.js');
const {readAudioSource}=require('./sound-source.js');

function number(opt,name) {
  if (opt[name]===undefined) return undefined;
  if (typeof opt[name]!=='string' || !opt[name].trim()) throw new TypeError('Expected a number for --'+name);
  return Number(opt[name]);
}

function measure(mode,file,opt,P) {
  const monitor=P.mediaGraph.mixerMonitor, input=readAudioSource(file,P);
  if (mode==='meter') {
    const result=monitor.meter(input,{firstSample:number(opt,'from-sample'),endSample:number(opt,'to-sample')});
    if (typeof opt.out==='string') json(opt.out,result);
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  if (typeof opt.out!=='string' || opt.focus!==undefined && typeof opt.focus!=='string')
    throw new TypeError('Use music mix monitor input.wav [--mode mono|small-speaker|stereo] [--focus stem.wav] --out directory');
  const {value,report}=monitor.preview(input,{mode:opt.mode,lowHz:number(opt,'low-hz'),highHz:number(opt,'high-hz')},
    opt.focus && readAudioSource(opt.focus,P));
  const directory=path.resolve(opt.out), preview=path.join(directory,'preview.wav'), fileReport=path.join(directory,'report.json');
  write(preview,WAV.encode(value,{encoding:'pcm24'}));
  json(fileReport,report);
  const result={preview,report:fileReport};
  process.stdout.write(JSON.stringify(result)+'\n');
  return result;
}

function readAssets(entries,file,P) {
  const {record,id,check}=P.musicInstruments;
  check(record(entries) && Object.keys(entries).length<=128,'Expected a table of WAV or sound recipe assets');
  const folder=path.dirname(path.resolve(file)), cache=new Map();
  let samples=0;
  return Object.fromEntries(Object.entries(entries).map(([name,relative])=>{
    check(id(name) && typeof relative==='string' && relative.trim(),'Invalid mixer audio asset');
    const file=path.resolve(folder,relative);
    if (!cache.has(file)) {
      const pcm=readAudioSource(file,P);
      samples+=pcm.samples.length;
      check(samples<=32e6,'Mixer WAV assets exceed their PCM budget');
      cache.set(file,pcm);
    }
    return [name,cache.get(file)];
  }));
}

function audition({mixer},assets,host,opt,P) {
  const {id,check}=P.musicInstruments, {mixer:engine,mixerMonitor}=P.mediaGraph;
  check(id(opt.strip) && id(opt.insert),'Choose --strip and --insert by ID');
  const strip=Object.hasOwn(mixer?.strips ?? {},opt.strip) && mixer.strips[opt.strip];
  const inserts=strip?.inserts;
  check(Array.isArray(inserts),'Audition needs a mixer strip with inserts');
  const chain=inserts.filter(entry=>(typeof entry==='string' ? entry : entry?.processor)!==opt.insert);
  check(chain.length===inserts.length-1,'Choose an insert ID that appears exactly once on the strip');
  const wet=engine.render(mixer,assets,host);
  const dry=engine.render({...mixer,strips:{...mixer.strips,[opt.strip]:{...strip,inserts:chain}}},assets,host);
  const result=mixerMonitor.compare(dry,wet,{targetLufs:number(opt,'target-lufs'),ceilingDbTP:number(opt,'ceiling-db-tp')});
  const folder=path.resolve(opt.out), manifest={report:path.join(folder,'report.json')};
  for (const [name,value] of Object.entries({processed:result.value,bypass:result.bypass,
    difference:result.difference,effect:result.effect})) {
    manifest[name]=path.join(folder,name+'.wav');
    write(manifest[name],WAV.encode(value,{encoding:'pcm24'}));
  }
  const {rack,...takes}=result.report.takes;
  json(manifest.report,{...result.report,takes:{...takes,processed:rack},strip:opt.strip,insert:opt.insert,
    mixers:{bypass:dry.report,processed:wet.report}});
  process.stdout.write(JSON.stringify(manifest)+'\n');
  return manifest;
}

module.exports=function mixCommand([mode,file],opt,kit) {
  const P=kit.KIT.procedural;
  if (file && (mode==='meter' || mode==='monitor')) return measure(mode,file,opt,P);
  if (!['render','audition'].includes(mode) || !file || typeof opt.out!=='string')
    throw new TypeError('Use music mix render, audition, meter or monitor with a recipe or WAV');
  const {fields,check}=P.musicInstruments;
  const recipe=JSON.parse(fs.readFileSync(file,'utf8'));
  check(fields(recipe,['mixer','assets']),'Expected a mixer and a table of WAV or sound recipe assets');
  const assets=readAssets(recipe.assets,file,P);
  const host=opt['clap-host']===undefined ? undefined : require('./clap-adapter').load(opt['clap-host']);
  if (mode==='audition') return audition(recipe,assets,host,opt,P);
  const result=P.mediaGraph.mixer.render(recipe.mixer,assets,host), target=path.resolve(opt.out);
  const mix=path.join(target,'mix.wav'), report=path.join(target,'report.json');
  const taps=Object.fromEntries(Object.entries(result.taps).map(([name,pcm])=>{
    const file=path.join(target,'taps',name+'.wav');
    write(file,WAV.encode(pcm,{encoding:'pcm24'}));
    return [name,file];
  }));
  write(mix,WAV.encode(result.value,{encoding:'pcm24'}));
  json(report,result.report);
  const manifest={mix,report,taps};
  process.stdout.write(JSON.stringify(manifest)+'\n');
  return manifest;
};
module.exports.readAssets=readAssets;
