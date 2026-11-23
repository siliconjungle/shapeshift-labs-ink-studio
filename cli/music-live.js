const fs=require('node:fs'), path=require('node:path'), WAV=require('./wav.js');
const {write,json}=require('./asset-files.js'), {timelineBank,readProductionAssets}=require('./music-production.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

async function withLiveOptions(recipe,file,kit,use,onFile=value=>value) {
  const {check,fields,record,id}=kit.KIT.procedural.musicInstruments;
  const settings=recipe.live ?? {}, opened=new Map(), streams={};
  check(fields(settings,['options','streams','traceOptions']) && record(settings.streams ?? {}) &&
    Object.keys(settings.streams ?? {}).length<=128,'Invalid live score recipe');
  try {
    for (const [name,row] of Object.entries(settings.streams ?? {})) {
      check(id(name) && fields(row,['file','gain','pan','send','priority','foreground']) && typeof row.file==='string',
        'Name each live WAV stream and its file');
      const {file:ref,...mix}=row;
      const page=await WAV.openPages(onFile(path.resolve(path.dirname(file),ref)));
      opened.set(name,page);
      streams[name]={frames:page.frames,sampleRate:page.sampleRate,channels:page.channels,...mix};
    }
    return await use({...settings.options,streams,readPage:(name,first,frames)=>opened.get(name).readPage(first,frames)},
      settings.traceOptions);
  } finally {
    await Promise.all([...opened.values()].map(row=>row.close()));
  }
}

module.exports=async function command([mode,file,routePath],opt,kit) {
  const {check}=kit.KIT.procedural.musicInstruments, live=kit.KIT.music.production.live;
  check(mode==='replay' && file && routePath && typeof opt.out==='string',
    'Use music live replay <timeline.json> <route.json> --out <directory>');
  const recipe=read(file), route=read(routePath), {sources,timeline,paths}=timelineBank(recipe,file);
  const folder=path.resolve(opt.out);
  const result=await withLiveOptions(recipe,file,kit,(options,traceOptions)=>
    live.replay(sources,timeline,route.format ? live.fromTrace(route,traceOptions) : route,{
      ...options,assets:readProductionAssets(paths,kit.KIT.procedural)
    }));
  const audio=path.join(folder,'score.wav'), report=path.join(folder,'listen.json');
  write(audio,WAV.encode(result.value,{encoding:'pcm24'}));
  json(report,result.report);
  const summary={audio,report,section:result.report.section,profile:result.report.profile};
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
  return summary;
};
module.exports.withLiveOptions=withLiveOptions;
