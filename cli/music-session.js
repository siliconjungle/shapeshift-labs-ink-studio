const fs=require('node:fs'), path=require('node:path'), readline=require('node:readline');
const WAV=require('./wav.js'), {write,json}=require('./asset-files.js'), {readAssets}=require('./music-mixer.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

module.exports=function command([mode,file,config],opt,kit) {
  const P=kit.KIT.procedural,{fields,check}=P.musicInstruments;
  if (['record-round','keep-round'].includes(mode)) {
    const result=require('./music-session-listening').vote(mode,file,config,opt.out,P);
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  if (mode==='record-ballot') {
    const result=require('./music-session-ballot.js').archive(file,config,opt.out,P);
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  check(file && ['inspect','trace','edit','render','preview','compare','compose','audition-phrase','arrange-performance','performance-ballot','listening-round','listening-evidence','keep-listening-repair','experiment','keep-experiment','stream','play','handoff'].includes(mode),
    'Choose music session inspect, trace, edit, render, preview, compare, compose, audition-phrase, arrange-performance, performance-ballot, record-ballot, listening-round, listening-evidence, keep-listening-repair, record-round, keep-round, experiment, keep-experiment, stream, play or handoff');
  const recipe=read(file);
  check(fields(recipe,['session','assets']),'Expected a music edit session and WAV asset table');
  const paths=recipe.assets ?? {}, hostFile=opt['clap-host'], host=hostFile===undefined ? undefined : require('./clap-adapter').load(hostFile);
  const assets=readAssets(paths,file,P);
  const editor=P.mediaGraph.musicSession.create(assets,host);
  let session=recipe.session, previous;
  if (mode==='handoff') {
    check(typeof opt.out==='string','Use --out for the DAW package');
    const result=require('./music-handoff.js').publish(editor.handoff(session),file,recipe,opt.out,host);
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  function save(target,value=session,recorded={}) {
    check(typeof target==='string','Use an output path for the session recipe');
    const folder=path.dirname(path.resolve(target)), source=path.dirname(path.resolve(file));
    const assets=Object.fromEntries(Object.entries({...paths,...recorded}).map(([name,ref])=>[name,path.relative(folder,path.resolve(source,ref))]));
    json(target,{session:value,assets});
    return {session:path.resolve(target)};
  }
  function audioWriter(folder) {
    check(typeof folder==='string','Use an output directory for the mix or preview');
    const output=path.resolve(folder);
    return {
      audio(pcm,name) {
        const target=path.join(output,name+'.wav');
        let peak=1;
        for (const sample of pcm.samples) peak=Math.max(peak,Math.abs(sample));
        const file=peak===1 ? pcm : {...pcm,samples:Float64Array.from(pcm.samples,sample=>sample/peak)};
        write(target,WAV.encode(file,{encoding:'pcm24'}));
        return {target,gain:1/peak};
      },
      report(value) {
        const target=path.join(output,'report.json');
        json(target,value);
        return target;
      }
    };
  }
  function render(folder,preview) {
    const writer=audioWriter(folder), result=editor.render(session,preview);
    const {target:mix,gain}=writer.audio(result.value,'mix');
    const taps=Object.fromEntries(Object.entries(result.taps).map(([name,pcm])=>[name,writer.audio(pcm,'taps/'+name).target]));
    const report=writer.report({...result.report,listeningGain:gain});
    return {mix,taps,report,cache:result.report.cache};
  }
  function compare(folder,baseline,preview) {
    const writer=audioWriter(folder);
    check(baseline,'Make an edit in this stream or supply an earlier session recipe');
    const result=editor.compare(baseline,session,preview);
    const names=['before','after','difference'];
    const files=Object.fromEntries(names.map(name=>[name,writer.audio(result[name],name)]));
    const report=writer.report({...result.report,listeningGain:Object.fromEntries(names.map(name=>[name,files[name].gain]))});
    return {...Object.fromEntries(names.map(name=>[name,files[name].target])),report};
  }
  function compose(folder,brief) {
    const writer=audioWriter(folder), directory=path.resolve(folder);
    const {value,sessions,clips}=editor.compose(session,brief);
    const takes=Object.fromEntries(Object.entries(sessions).map(([id,take])=>
      [id,path.relative(directory,save(path.join(directory,'sessions',id+'.json'),take).session)]));
    const audio=Object.fromEntries(Object.entries(clips).map(([id,pcm])=>
      [id,path.relative(directory,writer.audio(pcm,id).target)]));
    return {report:writer.report({...value,files:{sessions:takes,audio}}),sessions:takes,audio};
  }
  function auditionPhrase(folder,settings) {
    const writer=audioWriter(folder), {audio,report}=editor.auditionPhrase(session,settings);
    const clips=Object.fromEntries(Object.entries(audio).map(([name,pcm])=>[name,writer.audio(pcm,name).target]));
    return {clips,report:writer.report({...report,files:clips})};
  }
  function arrangePerformance(folder,brief) {
    const writer=audioWriter(folder), directory=path.resolve(folder);
    const {report,clips,sessions}=editor.arrangePerformance(session,brief);
    const audio=Object.fromEntries(Object.entries(clips).map(([id,pcm])=>[id,writer.audio(pcm,id).target]));
    const takes=Object.fromEntries(Object.entries(sessions).map(([id,take])=>
      [id,save(path.join(directory,'sessions',id+'.json'),take).session]));
    const relative=files=>Object.fromEntries(Object.entries(files).map(([id,file])=>[id,path.relative(directory,file)]));
    return {report:writer.report({...report,files:{audio:relative(audio),sessions:relative(takes)}}),audio,sessions:takes};
  }
  function experiment(folder,brief,emitScouts=false) {
    const writer=audioWriter(folder), directory=path.resolve(folder), scouts={};
    const options=emitScouts ? {onScout(id,pcm) {
      scouts[id]=path.relative(directory,writer.audio(pcm,'scouts/'+id).target);
    }} : {};
    const {value,clips}=editor.experiment(session,brief,options);
    const previews=Object.fromEntries(Object.entries(clips).map(([id,pcm])=>
      [id,path.relative(directory,writer.audio(pcm,'context/'+id).target)]));
    const report=writer.report({...value,files:{scouts,context:previews}});
    return {report,attempted:value.attempted,scoutRenders:value.scoutRenders,contextRenders:value.contextRenders};
  }
  function execute(row) {
    check(fields(row,['op','out','changes','preview','brief','emitScouts','settings']),'Invalid session command');
    switch (row.op) {
      case 'inspect': {
        const report=editor.inspect(session);
        if (typeof row.out==='string') json(row.out,report);
        return report;
      }
      case 'trace': {
        const report=editor.trace(session,row.preview);
        if (typeof row.out==='string') json(row.out,report);
        return report;
      }
      case 'edit': {
        const updated=editor.edit(session,row.changes);
        const result=row.out===undefined ? {edited:true} : save(row.out,updated);
        previous=session;
        session=updated;
        return result;
      }
      case 'save': return save(row.out);
      case 'render': return render(row.out);
      case 'compare': return compare(row.out,previous,row.preview);
      case 'compose': return compose(row.out,row.brief);
      case 'audition-phrase': return auditionPhrase(row.out,row.settings);
      case 'arrange-performance': return arrangePerformance(row.out,row.brief);
      case 'performance-ballot':
        check(typeof row.out==='string','Use an output directory for the listening ballot');
        return require('./music-session-ballot.js').publish(row.out,editor.performanceBallot(session,row.brief),save);
      case 'listening-round':
        check(typeof row.out==='string','Use an output directory for the listening round');
        return require('./music-session-listening').publish(row.out,editor.listeningRound(session,row.brief),save);
      case 'listening-evidence':
        check(typeof row.out==='string','Use an output directory for listening evidence');
        return require('./music-session-listening').evidence(row.out,editor.listeningEvidence(session,row.settings));
      case 'experiment':
        check(typeof (row.emitScouts ?? false)==='boolean','emitScouts must be true or false');
        return experiment(row.out,row.brief,row.emitScouts);
      case 'preview':
        check(row.preview!==undefined,'Provide the preview loop and optional switches');
        return render(row.out,row.preview);
      default: throw new RangeError('Unknown session command');
    }
  }
  if (mode==='play') {
    check(opt.out===undefined || typeof opt.out==='string','Use --out with a session recipe filename');
    const port=Number(opt.port ?? 0);
    check(Number.isInteger(port) && port>=0 && port<=65535,'Choose a session port from 0 to 65535');
    const absolute=Object.fromEntries(Object.entries(paths).map(([name,ref])=>[name,path.resolve(path.dirname(file),ref)]));
    const settings=config && read(config);
    const preparer=require('./music-session-edit-worker.js')(file,paths,hostFile);
    return (async()=>{
      try {
        const prepared=await preparer.prepare(session);
        const transport=editor.openPreparedTransport(prepared,settings);
        await require('./music-session-player.js')(transport,{
          port,prepare:preparer.prepare,discard:preparer.discardAsset,editor,assets,paths:absolute,P,
          recordings:path.resolve(opt.out ?? file).replace(/\.json$/i,'')+'-recordings',
          recipe:(value,recorded)=>({session:value,assets:{...absolute,...recorded}}),
          save:opt.out===undefined ? null : (value,recorded)=>save(opt.out,value,recorded)
        });
      } finally { await preparer.close(); }
    })();
  }
  if (mode==='stream') {
    editor.inspect(session);
    return (async()=>{
      for await (const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})) {
        if (!line.trim()) continue;
        let result;
        try {result={ok:true,result:execute(JSON.parse(line))};}
        catch (error) {result={ok:false,error:error.message};}
        process.stdout.write(JSON.stringify(result)+'\n');
      }
    })();
  }
  check(['inspect','trace'].includes(mode) || typeof opt.out==='string','Use --out for session edits and audio');
  const settings=config && read(config);
  if (mode==='keep-listening-repair') {
    check(fields(settings,['report','take','reason']) && typeof settings.report==='string' &&
      P.musicInstruments.id(settings.take),'Choose a listening evidence report and a repair');
    const reportPath=path.resolve(path.dirname(config),settings.report);
    const {files,...report}=read(reportPath);
    check(files?.[settings.take]===settings.take+'.wav','Choose a WAV from the evidence report');
    const clip=WAV.read(path.join(path.dirname(reportPath),settings.take+'.wav'));
    const kept=editor.keepListeningRepair(session,report,{take:settings.take,reason:settings.reason},clip);
    const decision=path.resolve(opt.out,'decision.json'), excerpt=path.resolve(opt.out,'excerpt.wav');
    const result={...save(path.resolve(opt.out,'session.json'),kept.value),decision,excerpt};
    write(excerpt,WAV.encode(clip,{encoding:'pcm24'}));
    json(decision,{...kept.decision,file:'excerpt.wav'});
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  if (mode==='keep-experiment') {
    check(fields(settings,['report','candidate','reason']) && typeof settings.report==='string','Choose an experiment report and candidate');
    const report=read(path.resolve(path.dirname(config),settings.report));
    const kept=editor.keepExperiment(session,report,{candidate:settings.candidate,reason:settings.reason});
    const decision=path.resolve(opt.out,'decision.json'), result={...save(path.resolve(opt.out,'session.json'),kept.value),decision};
    json(decision,kept.decision);
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  if (mode==='compare') {
    check(fields(settings,['before','preview']) && typeof settings.before==='string','Supply an earlier session and a preview range');
    const baselineFile=path.resolve(path.dirname(config),settings.before), baseline=read(baselineFile);
    const resolved=(table,recipeFile)=>Object.fromEntries(Object.entries(table ?? {}).sort()
      .map(([name,ref])=>[name,path.resolve(path.dirname(recipeFile),ref)]));
    check(fields(baseline,['session','assets']) && JSON.stringify(resolved(baseline.assets,baselineFile))===
      JSON.stringify(resolved(paths,file)),'Compared session recipes must refer to the same audio assets');
    const result=compare(opt.out,baseline.session,settings.preview);
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  const result=execute({op:mode,out:opt.out,...(mode==='edit' && {changes:settings}),...(['preview','trace'].includes(mode) && {preview:settings}),
    ...(['audition-phrase','listening-evidence'].includes(mode) && {settings}),
    ...(['compose','arrange-performance','performance-ballot','listening-round'].includes(mode) && {brief:settings}),
    ...(mode==='experiment' && {brief:settings,emitScouts:opt.scouts===true})});
  process.stdout.write(JSON.stringify(result)+'\n');
  return result;
};
