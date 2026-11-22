const fs=require('node:fs');
const path=require('node:path');
const {json}=require('./asset-files.js');
const {graphOutputs}=require('./graph-outputs.js');

const maxBytes=128*1024*1024, maxMatches=50000;
const escape=key=>String(key).replace(/~/g,'~0').replace(/\//g,'~1');
const relative=(base,file)=>path.relative(base,file).split(path.sep).join('/');
const local=file=>typeof file==='string'&&file.length>0&&!path.isAbsolute(file)&&!path.win32.isAbsolute(file)&&
  !file.includes('\\')&&!file.split('/').some(part=>!part||part==='..'||part==='.');

function records(file) {
  if(fs.statSync(file).size>maxBytes)throw new RangeError('Beat report exceeds the 128 MiB input budget: '+file);
  const raw=fs.readFileSync(file,'utf8');
  if(path.extname(file).toLowerCase()!=='.ndjson'){
    try { return [{document:JSON.parse(raw)}]; }
    catch { /* Also accept newline-delimited streams with other extensions. */ }
  }
  return raw.split(/\r?\n/).flatMap((line,i)=>{
    if(!line.trim())return [];
    try { return [{document:JSON.parse(line),line:i+1}]; }
    catch { throw new TypeError('Invalid JSON or NDJSON in '+file+' at line '+(i+1)); }
  });
}

function locate(api,beatId,files,base) {
  const matches=[],unmatched=[];
  for(const file of files){
    const report=relative(base,file), start=matches.length, folder=path.dirname(file);
    for(const {document,line} of records(file)){
      const format=document?.format, stack=[{row:document,pointer:'',context:{}}];
      const publicView=api.isPublic(document);
      const committed=format==='ink-studio/committed-events'||format==='ink-studio/event-log'||format==='ink-studio/world-graph-frame';
      const mapped=format==='ink-studio/clock-map-report';
      const presentation=format==='ink-studio/presentation-cues'||document?.presentationCues?.format==='ink-studio/presentation-cues';
      while(stack.length){
        const {row,pointer,context:inherited}=stack.pop();
        if(!row||typeof row!=='object')continue;
        const context={...inherited};
        if(!Array.isArray(row)){
          const frame=row.frame??row.edited?.frame??row.at?.showFrame??row.detail?.showFrame;
          const time=row.time??row.edited?.seconds??row.at?.seconds;
          const tick=row.tick??row.event?.tick??row.anchor?.event?.tick??row.source?.tick??
            row.clockCue?.anchor?.event?.tick??row.sourceTick;
          for(const [key,value] of Object.entries({frame,time,tick,scheduledFrame:row.scheduledFrame}))
            if(Number.isFinite(value))context[key]=value;
          if(typeof row.status==='string')context.status=row.status;
          if(typeof row.output==='string')context.output=row.output;
          if(local(row.file))context.file=row.file;
          if(local(row.frameFolder))context.frameFolder=row.frameFolder;
          if(pointer===''&&local(row.animation?.file))context.file=row.animation.file;
        }
        const envelope=committed&&row.version===1&&row.payload&&api.identify(row,publicView);
        const source=mapped?(row.event??row.anchor?.event):presentation?row.source:undefined;
        const tagged=(envelope||row.beatId||api.identify(source))===beatId;
        if(tagged){
          if(matches.length>=maxMatches)throw new RangeError('Beat inspection exceeds the match budget');
          const {file:artifact,frameFolder,...details}=context;
          const framePath=frameFolder&&path.join(folder,frameFolder);
          const at=frameFolder&&!folder.endsWith(path.sep+frameFolder.split('/').join(path.sep))?framePath:folder;
          matches.push({report,pointer,...(line!==undefined&&{line}),...(format&&{format}),...details,
            ...(artifact&&{artifact:relative(base,path.join(at,artifact))})});
          continue;
        }
        if(envelope)continue;
        const children=Object.entries(row);
        for(let i=children.length-1;i>=0;i--){
          const [key,value]=children[i];
          if(value&&typeof value==='object')stack.push({row:value,pointer:pointer+'/'+escape(key),context});
        }
      }
    }
    if(matches.length===start)unmatched.push(report);
  }
  return {format:'ink-studio/beat-inspection',version:1,beatId,matches,unmatched};
}

function command([beatId,...inputs],options,kit) {
  const api=kit.KIT.world.inspectionLinks, {out}=options;
  if(!api.parse(beatId)||!inputs.length||inputs.length>64||Object.keys(options).some(key=>key!=='out')||
    out!==undefined&&(typeof out!=='string'||!out.trim()))
    throw new TypeError('Use beat <beat-id> <report.json|watch.ndjson> [...] [--out inspection.json]');
  const files=[...new Set(inputs.map(file=>path.resolve(file)))], destination=out&&path.resolve(out);
  if(destination)graphOutputs(files).protect(fs.statSync(destination,{throwIfNoEntry:false}));
  const result=locate(api,beatId,files,destination?path.dirname(destination):process.cwd());
  if(destination)json(destination,result);
  else process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.matches.length)process.exitCode=2;
}

module.exports={command,locate};
