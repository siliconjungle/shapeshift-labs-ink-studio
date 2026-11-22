/* Publish picture and sample-addressed WAV from one set of run outputs. */
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {createTake}=require('./take.js');
const {validateTake,readTakeWorld,resolveTakeFile}=require('./take-document.js');
const {readGraphProject}=require('./graph-project.js');
const {readCheckpoint}=require('./checkpoint-file.js');
const {write,json}=require('./asset-files.js');
const WAV=require('./wav.js');

const format='ink-studio/audiovisual-take', reportFormat='ink-studio/audiovisual-export';
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');

function render(settings,{kit=require('../index.js').load(),graph,world,simulation,checkpoint,audio,signals}={}){
  const K=kit.KIT,W=K.world,{id,check,own,record}=W.data,{fields}=W.boundarySignals;
  check(fields(settings,['id','clock','from','to','warmup','picture','audioBus','bindings','controlsInput'])&&
    typeof graph?.clip==='function'&&typeof graph?.plan==='function'&&record(audio),
  'Audiovisual rendering needs a recipe, picture graph and named audio buses');
  const {id:name='take',clock={},from=0,to,warmup=0,picture,audioBus='mix',bindings={},controlsInput='controls'}=settings;
  check(id(name)&&id(audioBus)&&own(audio,audioBus)&&id(controlsInput)&&integer(from,0,1000000000)&&
    integer(to,from+1,1000000000)&&integer(warmup,0,3600)&&to-Math.max(0,from-warmup)<=3600&&
    record(bindings)&&Object.keys(bindings).length*(to-Math.max(0,from-warmup))<=200000,
  'Audiovisual take needs a bounded frame interval and an existing audio bus');
  check(fields(picture,['output','format','renderOptions','inputs','seed'])&&id(picture.output)&&
    ['frames','apng','both'].includes(picture.format??'both')&&(picture.inputs===undefined||record(picture.inputs)),
  'Audiovisual picture needs a named graph output and PNG format');
  const plan=graph.plan();
  const controlCount=Object.keys(bindings).length;
  check(!controlCount||plan.inputs[controlsInput]?.type==='record'&&!own(picture.inputs,controlsInput),
    'Declare an exclusive record-type picture graph input named '+controlsInput);
  const playback=createTake({clock,world,graph,simulation},{kit,checkpoint,evaluateGraph:false});
  const first=playback.clock.at(from), last=playback.clock.at(to-1), {sampleRate,firstSample}=first;
  const endSample=last.endSample, selected=W.pictureSignals.pcm(audio[audioBus]);
  const {audio:pcm,startSample}=selected, {channels}=pcm;
  check(sampleRate===pcm.sampleRate&&endSample>firstSample&&channels*(endSample-firstSample)<=16000000,
    'WAV bus must match the take sample rate and fit its audio export budget');
  // Use the same validated source object for the WAV and picture windows.
  const controls=W.pictureSignals.prepare(bindings,{audio,signals});
  const pictureRows=new Map();
  const clip=graph.clip({...picture,from,to,warmup,clock},{frameInputs(frame){
    const sample=world===undefined?undefined:playback.seek(frame.frame);
    const {values,report}=controls.sample(frame,sample);
    if(frame.frame>=from)pictureRows.set(frame.frame,{endSample:frame.endSample,controls:values,measurements:report,
      ...(sample&&{worldTick:sample.world.tick})});
    return controlCount?{[controlsInput]:values}:{};
  }});
  const samples=new Float64Array((endSample-firstSample)*channels);
  const begin=Math.max(firstSample,startSample), end=Math.min(endSample,startSample+pcm.samples.length/channels);
  if(end>begin){
    const lo=(begin-startSample)*channels, hi=(end-startSample)*channels;
    samples.set(pcm.samples.slice(lo,hi),(begin-firstSample)*channels);
  }
  const file='sound.wav', bytes=WAV.encode({sampleRate,channels,samples},{encoding:'pcm24',bwf:{
    description:name+' / '+audioBus,timeReference:firstSample
  }});
  const {frames,...rest}=clip.report;
  const report={format:reportFormat,version:1,id:name,picture:{...rest,
    frames:frames.map(row=>({...row,...pictureRows.get(row.frame)}))},
    audio:{file,bus:audioBus,startSample:firstSample,endSample,rate:sampleRate,channels,frames:endSample-firstSample,
      sourceStartSample:startSample,sourceEndSample:startSample+pcm.samples.length/channels,
      presentSamples:Math.max(0,end-begin),sha256:hash(bytes),bytes:bytes.length}};
  return {report,artifacts:[...clip.artifacts,{file,bytes}]};
}

function open(file,{kit=require('../index.js').load(),...options}={}){
  const W=kit.KIT.world,{check,id,record}=W.data,{fields}=W.boundarySignals;
  const owner=path.resolve(file), request=read(owner), paths=new Set([owner]), dependency=file=>paths.add(file);
  check(fields(request,['format','version','id','take','from','to','warmup','picture','audio','bindings','controlsInput'])&&
    request.format===format&&request.version===1,'Expected a version 1 audiovisual take');
  function resolve(reference,from=owner){
    check(typeof reference==='string'&&reference.trim()&&!path.isAbsolute(reference)&&!path.win32.isAbsolute(reference),
      'Audiovisual take references must be relative to their document');
    const filename=path.resolve(path.dirname(from),reference);
    dependency(filename);
    return filename;
  }
  const takeFile=resolve(request.take), take=validateTake(read(takeFile));
  const world=readTakeWorld(takeFile,take,kit,dependency);
  const checkpoint=take.checkpoint===undefined?undefined:readCheckpoint(resolve(take.checkpoint,takeFile),{
    onBlock:dependency
  });
  function readGraph(filename){
    const project=readGraphProject(filename,{kit,...options});
    for(const asset of project.sourceFiles())dependency(asset);
    return project;
  }
  check(take.graph!==undefined,'Audiovisual take needs a picture graph');
  const graph=readGraph(resolveTakeFile(takeFile,take,'graph',kit,dependency));
  const raw=request.audio;
  check(record(raw)&&(raw.physical!==undefined)!==(raw.graph!==undefined),'Choose a physical audio run or an audio-producing graph');
  let audio, signals, audioBus;
  if(raw.physical!==undefined){
    check(fields(raw,['physical','bus'])&&(raw.bus===undefined||id(raw.bus)),'Invalid audiovisual physical audio source');
    const filename=resolve(raw.physical);
    const {result,signals:tracks}=require('./physical-audio.js').prepare(kit,read(filename),filename,dependency);
    const wrap=audio=>({audio,startSample:result.report.startSample});
    audio=Object.fromEntries([
      ...['mix','source','propagation'].map(name=>[name,wrap(result[name])]),
      ...Object.entries(result.sources).map(([key,buffer])=>['source.'+key,wrap(buffer)]),
      ...Object.entries(result.paths).map(([key,buffer])=>['path.'+key,wrap(buffer)])
    ]);
    signals=tracks;
    audioBus=raw.bus??'mix';
  }else{
    const exported=raw.signals??{};
    check(fields(raw,['graph','output','signals','startSample','time','seed','inputs'])&&id(raw.output)&&
      record(exported)&&Object.keys(exported).length<=32&&Object.entries(exported).every(([name,output])=>id(name)&&id(output)),
      'Audiovisual audio graph needs a named PCM output and may expose named physical signal outputs');
    const project=readGraph(resolve(raw.graph));
    let result;
    try {
      result=project.run({time:raw.time,seed:raw.seed,inputs:raw.inputs});
      check(result.report.passed&&Object.hasOwn(result.outputs,raw.output),'Audio graph assertions failed or its selected output is missing');
      audio={mix:{audio:result.outputs[raw.output],startSample:raw.startSample}};
      signals=Object.fromEntries(Object.entries(exported).map(([name,output])=>{
        check(Object.hasOwn(result.outputs,output),'Unknown audio graph physical output '+output);
        return [name,result.outputs[output]];
      }));
    }finally{project.clear();}
    audioBus='mix';
  }
  const settings={id:request.id??take.id,clock:take.clock,from:request.from,to:request.to,warmup:request.warmup,
    picture:request.picture,bindings:request.bindings,controlsInput:request.controlsInput,audioBus};
  try {
    const result=render(settings,{kit,graph,world,simulation:take.simulation,checkpoint,audio,signals});
    return {...result,paths:[...paths]};
  }finally{graph.clear();}
}

function command(file,opt,options){
  if(typeof opt.out!=='string'||!opt.out.trim()||Object.keys(opt).some(key=>key!=='out'))
    throw new TypeError('Use take render-av <recipe.json> --out directory');
  const {artifacts,report,paths}=open(file,options), directory=path.resolve(opt.out);
  const actual=filename=>{
    if(fs.existsSync(filename))return fs.realpathSync(filename);
    const parent=path.dirname(filename);
    return parent===filename?filename:path.join(actual(parent),path.basename(filename));
  };
  const dependencies=new Set(paths.map(actual)), manifest=path.join(directory,'export.json');
  const targets=[manifest,...artifacts.map(item=>path.join(directory,item.file))].map(actual);
  if(new Set(targets).size!==targets.length||targets.some(name=>dependencies.has(name)))
    throw new RangeError('Audiovisual export files must be separate from their source assets');
  for(const item of artifacts)write(path.join(directory,item.file),item.bytes);
  json(manifest,report);
  if(!report.picture.passed)process.exitCode=2;
}
module.exports={format,reportFormat,render,open,command};
