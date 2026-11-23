const fs=require('node:fs'), path=require('node:path');
const {createHash}=require('node:crypto'), {isDeepStrictEqual}=require('node:util');
const WAV=require('./wav.js'), {write,json}=require('./asset-files.js'), {readAssets}=require('./music-mixer.js');

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const label=x=>typeof x==='string' && x.trim().length>0 && x.length<=100;
function run(file,opt,kit) {
  if (!file || typeof opt.out!=='string' || typeof opt['clap-host']!=='string') throw new TypeError(
    'Use music production instrument-benchmark suite.json --clap-host host.json --out directory');
  const P=kit.KIT.procedural, {check,fields,id,record,integer,finite}=P.musicInstruments;
  const {mixer,mixerMonitor,musicSession}=P.mediaGraph, production=P.musicProduction;
  const source=read(file), folder=path.resolve(opt.out);
  check(opt['preset-root']===undefined || typeof opt['preset-root']==='string','Expected a directory after --preset-root');
  const base=path.resolve(opt['preset-root'] ?? path.dirname(path.resolve(file)));
  check(fields(source,['format','version','reference','cases']) && source.format==='ink-studio/instrument-benchmark' &&
    source.version===1 && label(source.reference) && Array.isArray(source.cases) && integer(source.cases.length,1,12),
    'Expected an instrument benchmark with one to twelve cases and a reference label');
  const known=new Set();
  for (const row of source.cases) {
    check(fields(row,['id','title','production','reference','preset','snapshotParameters','mixer','assets','options']) &&
      id(row.id) && !known.has(row.id) && label(row.title) && record(row.production?.tracks) &&
      Object.keys(row.production.tracks).length===1 && fields(row.reference,['type','plugin','identity','state','parameters']) &&
      row.reference.type==='clap' && label(row.reference.plugin) && record(row.mixer) && record(row.assets) &&
      !Object.hasOwn(row.assets,'instrument') && (row.preset===undefined ?
        row.snapshotParameters===undefined : typeof row.preset==='string' && row.preset.trim().length>0) &&
      (row.preset===undefined || row.reference.state===undefined && row.reference.identity===undefined) &&
      fields(row.options ?? {},['tail','soloLufs','mixLufs','ceilingDbTP']),
      'Invalid or duplicate instrument benchmark case');
    known.add(row.id);
  }
  check(opt.case===undefined || known.has(opt.case),'Unknown instrument benchmark case');
  const host=require('./clap-adapter.js').load(opt['clap-host']);
  const select=source.cases.filter(row=>opt.case===undefined || row.id===opt.case);
  function compare(first,second,targetLufs,ceilingDbTP) {
    const {bypass:native,value:reference,report}=mixerMonitor.compare(first,second,{targetLufs,ceilingDbTP});
    const a=mixerMonitor.meter(native), b=mixerMonitor.meter(reference);
    check(a.integratedLufs!==null && b.integratedLufs!==null &&
      Math.abs(a.integratedLufs-b.integratedLufs)<=.1,'Incomplete loudness match in instrument benchmark');
    return {native,reference,report:{native:{...a,appliedGainDb:report.takes.bypass.gainDb},
      reference:{...b,appliedGainDb:report.takes.rack.gainDb},matchingLufs:report.matchingLufs}};
  }
  const results=select.map(row=>{
    const {id:caseId,title,production:nativeSpec,mixer:route}=row;
    const sampleRate=route.sampleRate, {tail=.65,soloLufs=-23,mixLufs=-18,ceilingDbTP=-1.3}=row.options ?? {};
    check(integer(sampleRate,8000,96000) && finite(tail,0,4) &&
      Object.values(route.strips ?? {}).some(strip=>strip?.clips?.some?.(clip=>clip.source==='instrument')),
      'Benchmark mixer needs a sample rate and a clip using the instrument asset');
    const [track]=Object.keys(nativeSpec.tracks), patch=nativeSpec.tracks[track].patch ?? track;
    check(record(nativeSpec.patches?.[patch]) && nativeSpec.patches[patch].type!=='clap',
      'Benchmark baseline needs a native instrument');
    const assets=readAssets(row.assets,file,P);
    check(Object.keys(assets).length>0,'Benchmark needs at least one shared backing asset');
    const preset=row.preset && path.resolve(base,row.preset), reference=row.reference;
    const presetSha256=preset && digest(fs.readFileSync(preset));
    const capture=preset && host.snapshot(reference.plugin,
      {kind:'instrument',sampleRate,preset,parameters:row.snapshotParameters});
    check(!preset || presetSha256===digest(fs.readFileSync(preset)),'CLAP preset changed during capture');
    const refSpec={...nativeSpec,patches:{...nativeSpec.patches,[patch]:{...reference,...capture}}};
    const {events:common,duration}=production.inspect(nativeSpec,assets);
    check(duration>0 && duration<=20 && isDeepStrictEqual(common,production.inspect(refSpec,assets).events),
      'Instrument benchmark must use the same performed events (up to 20 seconds)');
    const render=(spec,adapter)=>production.render(spec,assets,{sampleRate,stems:true,tail},adapter);
    const native=render(nativeSpec), external=render(refSpec,host);
    const solo=compare({value:native.stems[track]},{value:external.stems[track]},soloLufs,ceilingDbTP);
    const bed=Object.fromEntries(Object.entries(assets).map(([name,pcm])=>
      [name,digest(WAV.encode(pcm,{encoding:'pcm24'}))]));
    const a=mixer.render(route,{...assets,instrument:solo.native}), b=mixer.render(route,{...assets,instrument:solo.reference});
    const context=compare(a,b,mixLufs,ceilingDbTP);
    const directory=path.join(folder,caseId), audio={};
    for (const [stage,take] of Object.entries({solo,context})) {
      audio[stage]=Object.fromEntries(['native','reference'].map(side=>{
        const output=path.join(directory,stage+'-'+side+'.wav');
        write(output,WAV.encode(take[side],{encoding:'pcm24'}));
        return [side,path.relative(folder,output)];
      }));
    }
    const report={id:caseId,title,reference:source.reference,sampleRate,track,duration,
      notes:common[track].length,performanceSha256:digest(JSON.stringify(common[track])),backingSha256:bed,
      referenceInstrument:{...external.report.instruments[track],...(preset && {
        preset:path.basename(preset),presetSha256,snapshotParameters:row.snapshotParameters ?? {}
      })},solo:solo.report,context:context.report,audio};
    json(path.join(directory,'performance.json'),common[track]);
    const Midi=require('./handoff-midi.js');
    const session={format:'ink-studio/music-edit-session',version:1,id:caseId,sampleRate,production:nativeSpec};
    const {plan}=musicSession.create(assets).handoff(session);
    write(path.join(directory,'performance.mid'),Midi.encode(plan,Midi.compile(plan)));
    json(path.join(directory,'report.json'),report);
    return report;
  });
  const report=path.join(folder,'report.json');
  json(report,{format:'ink-studio/instrument-benchmark-report',version:1,reference:source.reference,cases:results});
  const response={report,cases:results.map(row=>row.id)};
  process.stdout.write(JSON.stringify(response)+'\n');
  return response;
}
module.exports=run;
