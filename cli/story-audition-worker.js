/* Prepare loop revisions off the player server's event loop. */
const {parentPort,workerData}=require('node:worker_threads');
const {readNativeRun,readSoundReceipts,point}=require('./story-audio.js');
const {readSceneAudio}=require('./scene-audio.js');
const WAV=require('./wav.js');

async function prepare({file,plan,beatId,from,to,receipts}){
  const kit=require('..').load(), {world:W,procedural:P}=kit.KIT, R=W.runtime, T=P.takeTime;
  const recording=readNativeRun(file,kit,()=>{}), {world}=recording.origin;
  const beat=W.inspectionLinks.parse(beatId);
  if(!beat||beat.projected||beat.world!==world.id||!W.committedEvents.eventId(beat.id))
    throw new RangeError('Choose a native beat ID from this recording');
  const tick=W.committedEvents.tickOf(beat.id);
  if(tick<recording.origin.tick||tick>recording.end.tick)throw new RangeError('The beat is outside the recording');
  const period=T.period(world.dt,world.takeClock?.simulationRate), boundary=tick=>T.mul(T.read(tick),period);
  let source;
  function find(view,events){
    if(view.tick!==tick)return;
    source=events.find(row=>row.id===beat.id&&
      W.inspectionLinks.identify(W.committedEvents.read(row,world.id,view.eventStream))===beatId);
  }
  await R.replayAsync(recording,{onStart:run=>find(run.view(),run.events),onTick:view=>find(view,view.events)});
  if(!source)throw new RangeError('The beat was not found in the committed recording');
  const eventTime=W.timedEvents.timeOf(source), at=eventTime===undefined?boundary(tick):T.read(eventTime);
  const origin=boundary(recording.origin.tick), end=boundary(recording.end.tick);
  const pre=T.sub(at,T.read(.25)), post=T.add(at,T.read(1.5));
  const startPoint=point(T,from,T.compare(pre,origin)<0?origin:pre);
  const endPoint=point(T,to,T.compare(post,end)>0?end:post);
  if(T.compare(startPoint,origin)<0||T.compare(endPoint,end)>0||T.compare(startPoint,at)>0||
    T.compare(endPoint,at)<=0||T.seconds(T.sub(endPoint,startPoint))>12)
    throw new RangeError('Choose a loop of at most 12 seconds inside the recording that includes the cue onset');
  const soundtrack=readSceneAudio(plan,{kit,recordedOnly:true}), families=soundtrack.soundFamilies;
  const options={source:{kind:'stem',name:'mix'},runtime:()=>R.openRecording(recording),recordedThrough:recording.end.tick,
    trace:true,soundReceipts:receipts&&readSoundReceipts(receipts,world.id,W)};
  const bindings=[];
  function render(edit={}){
    const {binding,family,gainDb=0,highpass,lowpass}=edit??{};
    const range=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
    if(!W.data.record(edit)||!Object.keys(edit).every(key=>['binding','family','gainDb','highpass','lowpass'].includes(key))||
      (binding!==undefined&&!bindings.includes(binding))||(family!==undefined&&!families.includes(family))||
      !range(gainDb,-36,12)||(highpass!==undefined&&!range(highpass,0,4000))||
      (lowpass!==undefined&&!range(lowpass,40,22000)))
      throw new TypeError('Invalid world cue audition controls');
    const {value,report}=soundtrack.capture({startPoint,endPoint},{...options,
      audition:{beatId,event:beat.id,binding,family,gainDb,highpass,lowpass}});
    const voices=report.storyAudio.cues.filter(row=>row.source.beatId===beatId&&row.audition)
      .map(({cue,asset,bus,onsetSample,arrivalSample,gain,processing,selection,audition,voiceBudget})=>({
        cue,asset,bus,onsetSample,arrivalSample,gain,binding:audition.binding,
        ...(processing&&{processing}),...(selection&&{selection}),...(voiceBudget&&{voiceBudget})
      }));
    if(!voices.length)throw new RangeError('No spatial cue from this beat arrives inside the loop');
    return {waves:WAV.encode(value,{encoding:'pcm24'}).toString('base64'),voices,
      firstSample:report.firstSample,endSample:report.endSample};
  }
  const original=render();
  bindings.push(...new Set(original.voices.map(row=>row.binding)));
  if(original.endSample-original.firstSample<Math.ceil(soundtrack.sampleRate*.1))
    throw new RangeError('The audition loop must be at least 100 ms long');
  const session={beatId,kind:source.kind,bindings,families,sampleRate:soundtrack.sampleRate,original};
  return {session,render};
}

prepare(workerData).then(({session,render})=>{
  parentPort.postMessage({session});
  parentPort.on('message',edit=>{
    try{parentPort.postMessage({result:render(edit)});}
    catch(error){parentPort.postMessage({error:error.message});}
  });
}).catch(error=>parentPort.postMessage({error:error.message}));
