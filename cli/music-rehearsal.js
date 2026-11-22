const fs=require('node:fs'),path=require('node:path'),WAV=require('./wav.js');
const {write,json}=require('./asset-files.js'),{timelineBank}=require('./music-production.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const relative=(file,ref)=>path.resolve(path.dirname(path.resolve(file)),ref);

module.exports=function command([mode,file,config,traceFile],opt,kit) {
  const {check,fields}=kit.KIT.procedural.musicInstruments, R=kit.KIT.music.production.rehearsal;
  check(typeof file==='string' && ['capture','capture-score','run','regression','keep'].includes(mode),
    'Use music rehearsal capture, capture-score, run, regression or keep');
  const out=typeof opt.out==='string' ? path.resolve(opt.out) : undefined;
  const output=value=>{
    if (out) json(out,value);
    else process.stdout.write(JSON.stringify(value,null,2)+'\n');
    return value;
  };
  if (mode==='capture') {
    check(config,'Use a world recording and capture settings with an ID');
    return output(R.capture(read(file),read(config)));
  }
  const recipe=read(file);
  if (mode==='capture-score') {
    check(config && recipe.adaptive,'Use an adaptive timeline recipe and capture settings with an ID and end');
    return output(R.captureScore(recipe.adaptive.score,recipe.adaptive.updates ?? [],read(config)));
  }
  check(config && out,'Use a rehearsal settings file and --out');
  const {sources,timeline,paths}=timelineBank(recipe,file);
  const assets=Object.fromEntries(Object.entries(paths).map(([name,at])=>[name,WAV.read(at)]));
  const settings=read(config);
  if (mode==='keep') {
    const selected=R.revise(sources,timeline,settings,assets);
    const kept={...recipe,...selected,assets:Object.fromEntries(Object.entries(paths)
      .map(([name,at])=>[name,path.relative(path.dirname(out),at)]))};
    if (traceFile) {
      const trace=R.validateTrace(read(traceFile));
      check(trace.entry===kept.timeline.entry,'The kept trace needs the same entry section');
      kept.timeline={...kept.timeline,end:trace.end};
      kept.intents=trace.intents;
      if (kept.options?.world)
        kept.options={...kept.options,world:{...kept.options.world,events:trace.worldEvents}};
      delete kept.adaptive;
    }
    return output(kept);
  }
  const host=opt['clap-host']===undefined ? undefined : require('./clap-adapter').load(opt['clap-host']);
  if (mode==='regression') {
    check(fields(settings,['score','seed','scenarios','traces','variants','options']) &&
      (settings.traces===undefined || Array.isArray(settings.traces) && settings.traces.length<=512),
    'Supply route scenarios or a bank of recorded traces');
    const traces=(settings.traces ?? []).map(row=>typeof row==='string' ? read(relative(config,row)) : row);
    const result=R.regression(sources,timeline,{...settings,score:settings.score ?? recipe.adaptive?.score,traces},assets,host);
    const {report,audio}=result;
    const listening=report.listening.map(join=>{
      const traceFile=join.id+'/trace.json';
      const repair=report.groups.find(group=>group.key===join.key).representative.repair;
      const repairFile=repair ? join.id+'/repair.json' : null;
      json(path.join(out,traceFile),result.traces.find(trace=>trace.id===join.trace));
      if (repairFile) json(path.join(out,repairFile),repair);
      const takes=join.takes.map(take=>{
        const file=join.id+'/'+take.id+'.wav';
        write(path.join(out,file),WAV.encode(audio[join.id][take.id],{encoding:'pcm24'}));
        return {...take,file};
      });
      return {...join,traceFile,repairFile,takes};
    });
    const tracePath=path.join(out,'traces.json'), manifest=path.join(out,'manifest.json');
    json(tracePath,result.traces);
    json(manifest,{...report,listening,traceFile:'traces.json'});
    const selected=typeof opt.assert==='string' ? opt.assert : 'reference';
    if (opt.assert!==undefined) {
      const gate=report.gates.find(row=>row.id===selected);
      check(gate && gate.limits.length,'Regression assertion needs a version and at least one failure limit');
      if (!gate.pass) process.exitCode=1;
    }
    const summary={manifest,traces:tracePath,routes:report.count,groups:report.groups.length,gates:report.gates};
    process.stdout.write(JSON.stringify(summary,null,2)+'\n');
    return summary;
  }
  check(fields(settings,['traces','variants','options']) && Array.isArray(settings.traces) &&
    settings.traces.length<=12,'Use a rehearsal request with up to twelve traces');
  const traces=settings.traces.map(row=>typeof row==='string' ? read(relative(config,row)) : row);
  const variants=settings.variants ?? [];
  const {audio,report}=R.run(sources,timeline,traces,variants,assets,settings.options,host);
  const listing=report.listening.map(take=>{
    const key=take.trace+':'+take.id;
    const takes=take.takes.map(change=>{
      const wav=take.trace+'/'+take.id+'/'+change.id+'.wav';
      write(path.join(out,wav),WAV.encode(audio[key][change.id],{encoding:'pcm24'}));
      return {...change,file:wav};
    });
    return {...take,takes};
  });
  const manifest=path.join(out,'manifest.json');
  json(manifest,{...report,listening:listing});
  const result={manifest,clips:report.listening.length,variants:report.variants.map(row=>row.id)};
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result;
};
