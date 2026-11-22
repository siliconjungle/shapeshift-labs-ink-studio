const fs=require('node:fs'), path=require('node:path'), readline=require('node:readline');
const WAV=require('./wav.js'), {write,json}=require('./asset-files.js'), {readAssets}=require('./music-mixer.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

module.exports=function command([mode,file,config],opt,kit) {
  const P=kit.KIT.procedural,{fields,check}=P.musicInstruments;
  check(file && ['inspect','edit','render','preview','compare','stream','play','handoff'].includes(mode),
    'Use music session inspect, edit, render, preview, compare, stream, play or handoff');
  const recipe=read(file);
  check(fields(recipe,['session','assets']),'Expected a music edit session and WAV asset table');
  const paths=recipe.assets ?? {}, hostFile=opt['clap-host'], host=hostFile===undefined ? undefined : require('./clap-adapter').load(hostFile);
  const editor=P.mediaGraph.musicSession.create(readAssets(paths,file,P),host);
  let session=recipe.session, previous;
  if (mode==='handoff') {
    check(typeof opt.out==='string','Use --out for the DAW package');
    const result=require('./music-handoff.js').publish(editor.handoff(session),file,recipe,opt.out,host);
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  function save(target,value=session) {
    check(typeof target==='string','Use an output path for the session recipe');
    const folder=path.dirname(path.resolve(target)), source=path.dirname(path.resolve(file));
    const assets=Object.fromEntries(Object.entries(paths).map(([name,ref])=>[name,path.relative(folder,path.resolve(source,ref))]));
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
  function execute(row) {
    check(fields(row,['op','out','changes','preview']),'Invalid session command');
    switch (row.op) {
      case 'inspect': {
        const report=editor.inspect(session);
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
      case 'preview':
        check(row.preview!==undefined,'Provide the preview loop and optional switches');
        return render(row.out,row.preview);
      default: throw new RangeError('Unknown session command');
    }
  }
  if (mode==='play') {
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
          port,prepare:preparer.prepare,recipe:value=>({session:value,assets:absolute}),
          save:opt.out===undefined ? null : value=>save(opt.out,value)
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
  check(mode==='inspect' || typeof opt.out==='string','Use --out for session edits and audio');
  const settings=config && read(config);
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
  const result=execute({op:mode,out:opt.out,...(mode==='edit' && {changes:settings}),...(mode==='preview' && {preview:settings})});
  process.stdout.write(JSON.stringify(result)+'\n');
  return result;
};
