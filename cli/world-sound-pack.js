/* Build and mount self-contained sound packs with the ordinary soundtrack tools. */
const fs=require('node:fs'), path=require('node:path');
const {write}=require('./asset-files.js');
const {graphOutputs}=require('./graph-outputs.js');
const {stageAt}=require('./recorded-presentation.js');
const {decodeSoundRecipe,isSoundRecipe}=require('./sound-source.js');
const Assets=require('./asset-references.js'), WAV=require('./wav.js');

const format='ink-studio/world-sound-pack';
const usage='music sound pack build|inspect|unpack <file.json> [--out path]';
const auditionUsage='music sound pack audition <pack.json> <example> --out directory';
const json=bytes=>JSON.parse(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('utf8'));
const jsonBytes=document=>Buffer.from(JSON.stringify(document,null,2)+'\n');
const relative=(owner,file)=>path.resolve(path.dirname(owner),file);

function readBytes(file,limit) {
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size<1||stat.size>limit)throw new RangeError('Invalid or oversized world-sound file: '+file);
  const bytes=fs.readFileSync(file);
  if(bytes.length>limit)throw new RangeError('World-sound file exceeds its byte budget: '+file);
  return bytes;
}

function recording(bytes,K) {
  const run=json(bytes), W=K.world, R=W.runtime;
  if(run?.format!==R.runFormat||run.version!==1||
    ![run.origin,run.end].every(row=>row?.format===R.checkpointFormat&&row.version===1&&
      Number.isSafeInteger(row.tick)&&row.tick>=0&&W.data.record(row.world))||
    run.origin.tick>=run.end.tick||run.end.tick-run.origin.tick>24000||!Array.isArray(run.commands))
    throw new TypeError('An audition example needs a bounded inline native run recording');
  return run;
}

function open(bytes,K,pin,document) {
  const api=K.world.soundPacks;
  if(bytes.length>api.maxDocumentBytes)throw new RangeError('World-sound pack exceeds its JSON budget');
  const sha256=Assets.hash(bytes);
  if(pin?.sha256!==undefined&&pin.sha256!==sha256)
    throw new Error('World-sound pack SHA-256 mismatch for '+pin.id);
  const data=api.open(document??json(bytes),{decode:value=>Buffer.from(value,'base64'),digest:Assets.hash});
  checkIdentity(data.manifest,pin);
  const audio=name=>{
    const slot=Object.hasOwn(data.manifest.assets,name)?data.manifest.assets[name]:undefined;
    if(!slot)return;
    const bytes=data.read(slot[slot.playback]);
    return slot.playback==='recipe'?decodeSoundRecipe(Buffer.from(bytes),K.procedural).value:decodeRecording(bytes);
  };
  const {id,revision}=data.manifest;
  return {...data,sha256,audio,identity:Object.freeze({id,revision,sha256})};
}

function checkIdentity(manifest,pin) {
  if(pin&&(manifest.id!==pin.id||manifest.revision!==pin.revision))
    throw new Error('Expected world-sound pack '+pin.id+' at revision '+pin.revision);
}

function checkPin(pack,pin) {
  if(pin.sha256!==undefined&&pin.sha256!==pack.sha256)
    throw new Error('World-sound pack SHA-256 mismatch for '+pin.id);
  checkIdentity(pack.manifest,pin);
}

function load(file,K,pin) {
  return open(readBytes(file,K.world.soundPacks.maxDocumentBytes),K,pin);
}

function mount(owner,refs,K,{onFile=()=>{}}={}) {
  let bytes=0;
  return K.world.soundPacks.references(refs).map(ref=>{
    const file=relative(owner,ref.file);
    bytes+=fs.statSync(file).size;
    if(bytes>K.world.soundPacks.maxDocumentBytes*2)throw new RangeError('Soundtrack exceeds its world-sound pack byte budget');
    onFile(file);
    return load(file,K,ref);
  });
}

function validatePayload(kind,bytes,K) {
  if(kind==='run')return recording(bytes,K);
  if(kind==='recipe'){
    K.procedural.mediaGraph.soundRecipe.normalize(json(bytes));
    return;
  }
  decodeRecording(bytes);
}

function decodeRecording(bytes) {
  const audio=WAV.decode(bytes);
  if(!audio.samples.length||audio.channels>2)throw new TypeError('World-sound recordings need nonempty mono or stereo WAVs');
  return audio;
}

function validateExamples(pack,K) {
  const {recordingWindow}=require('./story-audio.js'), W=K.world, runs=new Map();
  for(const [name,example] of Object.entries(pack.manifest.examples??{})){
    if(!runs.has(example.run))runs.set(example.run,recording(pack.read(example.run),K));
    const run=runs.get(example.run);
    recordingWindow(K.procedural.takeTime,run,example);
    if(!example.beat)continue;
    const beat=W.inspectionLinks.parse(example.beat), tick=beat&&!beat.projected&&W.committedEvents.tickOf(beat.id);
    if(beat?.world!==run.origin.world.id||!Number.isSafeInteger(tick)||tick<run.origin.tick||tick>run.end.tick)
      throw new RangeError('Audition example '+name+' needs a beat inside its recorded world');
  }
}

function build(source,destination,K) {
  const api=K.world.soundPacks, draft=json(readBytes(source,2*1024*1024));
  const metadata=api.describe(draft,{source:true});
  const inputs=new Set([source]), library=K.authoring.assetReferences;
  const readInput=(file,limit)=>{
    inputs.add(file);
    return readBytes(file,limit);
  };
  const resolve=Assets.scope(library,source,draft.assetRegistry,{onFile:file=>inputs.add(file)});
  const payloads=new Map();
  let total=0;
  function keep(kind,spec) {
    const limit=kind==='recipe'?api.recipeBytes:kind==='run'?api.runBytes:api.maxBytes;
    const entry=library.isRef(spec)?resolve(spec,kind==='recipe'?'sound':Assets.waveKinds):null;
    const file=entry?.filename??relative(source,spec);
    const bytes=entry?.bytes??readInput(file,limit);
    if(bytes.length>limit)throw new RangeError('Oversized world-sound '+kind);
    if(kind==='recipe'&&!isSoundRecipe(file))
      throw new TypeError('World-sound recipes need a .sound.json source');
    const address=Assets.hash(bytes), prior=payloads.get(address);
    if(!prior){
      total+=bytes.length;
      if(total>api.maxBytes)throw new RangeError('World-sound pack exceeds its byte budget');
      validatePayload(kind,bytes,K);
      payloads.set(address,{kind,size:bytes.length,data:bytes.toString('base64')});
    }else if(prior.kind!==kind)throw new TypeError('World-sound payload is referenced as two media types');
    return {address,...(entry&&{pin:{asset:entry.entry.asset,revision:entry.entry.revision,sha256:address}})};
  }
  const assets=Object.fromEntries(metadata.assets.sort().map(([name,row])=>{
    const result={playback:row.playback??(row.recording===undefined?'recipe':'recording'),
      ...(row.credit!==undefined&&{credit:row.credit})}, refs={};
    for(const kind of ['recipe','recording']) if(row[kind]!==undefined){
      const {address,pin}=keep(kind,row[kind]);
      result[kind]=address;
      if(pin)refs[kind]=pin;
    }
    if(Object.keys(refs).length)result.refs=refs;
    return [name,result];
  }));
  const examples=Object.fromEntries(metadata.examples.sort().map(([name,{run,preview,...settings}])=>
    [name,{...settings,run:keep('run',run).address,...(preview!==undefined&&{preview:keep('recording',preview).address})}]));
  const document={format,version:1,id:draft.id,revision:draft.revision,...(draft.label&&{label:draft.label}),
    spatial:draft.spatial,assets,examples,files:Object.fromEntries([...payloads].sort(([a],[b])=>a.localeCompare(b)))};
  const bytes=jsonBytes(document), result=open(bytes,K);
  validateExamples(result,K);
  graphOutputs([...inputs]).protect(fs.statSync(destination,{throwIfNoEntry:false}));
  write(destination,bytes);
  return {...describe(result),file:destination};
}

function describe({manifest,files,sha256,size}) {
  return {...manifest,sha256,embeddedBytes:size,files};
}

function unpack(pack,source,out,K) {
  if(fs.lstatSync(out,{throwIfNoEntry:false}))throw new RangeError('Unpack to a new world-sound directory');
  const stage=stageAt(out);
  try {
    const suffix={recipe:'.sound.json',recording:'.wav',run:'.run.json'};
    const files=new Map(pack.files.map(({sha256,kind})=>{
      const file='media/'+sha256+suffix[kind];
      stage.save(file,pack.read(sha256));
      return [sha256,file];
    }));
    const {assets,examples,...metadata}=pack.manifest;
    const registry=new Map(), api=K.authoring.assetReferences;
    const media=Object.fromEntries(Object.entries(assets).map(([name,{playback,credit,refs,...slots}])=>{
      const row={playback,...(credit!==undefined&&{credit})};
      for(const [kind,address] of Object.entries(slots)){
        const file=files.get(address), ref=refs?.[kind];
        if(ref)registry.set(api.key(ref),{...ref,kind:'sound',file});
        row[kind]=ref??file;
      }
      return [name,row];
    }));
    const auditions=Object.fromEntries(Object.entries(examples??{}).map(([name,{run,preview,...settings}])=>
      [name,{...settings,run:files.get(run),...(preview&&{preview:files.get(preview)})}]));
    if(registry.size)stage.json('assets.registry.json',{format:api.format,version:1,entries:[...registry.values()]});
    stage.json('sound-pack.source.json',{...metadata,format:K.world.soundPacks.sourceFormat,assets:media,examples:auditions,
      ...(registry.size&&{assetRegistry:'assets.registry.json'})});
    stage.json('pack-inventory.json',describe(pack));
    stage.publish(new Set([source]));
    return {directory:out,source:path.join(out,'sound-pack.source.json'),files:files.size};
  } finally {stage.close();}
}

function createSoundtrack(pack,kit,{listener,sampleRate,soundSeed}={}) {
  const {createSceneAudio}=require('./scene-audio.js'), cache=new Map();
  let totalSamples=0;
  function resolveAsset(name) {
    if(cache.has(name))return cache.get(name);
    const audio=pack.audio(name);
    if(!audio)return;
    totalSamples+=audio.samples.length;
    if(totalSamples>WAV.maxSamples)throw new RangeError('Soundtrack assets exceed the audio sample budget');
    cache.set(name,audio);
    return audio;
  }
  return createSceneAudio({format:'ink-studio/scene-audio',version:1,spatial:{
    ...pack.manifest.spatial,...(soundSeed!==undefined&&{soundSeed})
  },...(listener!==undefined&&{listener}),...(sampleRate!==undefined&&{sampleRate})},{kit,resolveAsset,worldSoundPacks:[pack.identity]});
}

async function audition(pack,source,name,out,kit) {
  const data=pack.manifest.examples;
  if(!data||!Object.hasOwn(data,name))throw new RangeError('Unknown world-sound audition example '+name);
  const example=data[name], run=recording(pack.read(example.run),kit.KIT), soundtrack=createSoundtrack(pack,kit,example);
  const {renderRecording}=require('./story-audio.js');
  const {outputs,report}=await renderRecording(run,soundtrack,example,kit);
  if(example.beat&&!report.cues.some(row=>row.source.beatId===example.beat))
    throw new RangeError('Audition beat has no rendered cue inside its window');
  if(example.preview)outputs.push({file:'reference.wav',bytes:pack.read(example.preview)});
  outputs.push({file:'audition.json',document:{format:'ink-studio/world-sound-pack-audition',version:1,
    pack:pack.identity,name,...example,
    audio:'mix.wav',report:'report.json',...(example.preview&&{reference:'reference.wav'})}});
  graphOutputs([source]).write(out,outputs);
  return {example:name,audio:path.join(out,'mix.wav'),report:path.join(out,'report.json')};
}

async function command([mode,file,example,...rest],opt,kit) {
  const {out}=opt;
  if(!file||rest.length||!['build','inspect','unpack','audition'].includes(mode)||
    (mode==='audition'?!example:example!==undefined)||Object.keys(opt).some(key=>key!=='out')||
    (mode==='inspect'?out!==undefined:typeof out!=='string'||!out.trim()))
    throw new TypeError('Use '+usage+' or '+auditionUsage);
  const K=kit.KIT, source=path.resolve(file), destination=out&&path.resolve(out);
  let result;
  if(mode==='build')result=build(source,destination,K);
  else {
    const pack=load(source,K);
    if(mode==='inspect'){
      for(const {kind,sha256} of pack.files) if(kind!=='run')validatePayload(kind,pack.read(sha256),K);
      validateExamples(pack,K);
      result=describe(pack);
    }else if(mode==='unpack')result=unpack(pack,source,destination,K);
    else result=await audition(pack,source,example,destination,kit);
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result;
}

module.exports={format,usage,auditionUsage,open,load,mount,checkPin,createSoundtrack,command};
