const path=require('node:path');
const {resolveCheckpoint}=require('./checkpoint-file.js');
const Fixture=require('./simulation-fixture.js');

function readRecording(project) {
  const file=project.storyRecordingPath?.();
  if(file===undefined)return;
  const virtualRoot=path.resolve(path.sep,'ink-story');
  const document=JSON.parse(Buffer.from(project.readFile(file)).toString('utf8'));
  return resolveCheckpoint(path.join(virtualRoot,file),document,{readBlock:block=>
    Buffer.from(project.readFile(path.relative(virtualRoot,block).split(path.sep).join('/')))});
}

function verifyEvents(W,expected) {
  const {from,to,coverage,events}=expected, {equal}=W.data, complete=coverage==='complete';
  const key=row=>row.branch+'/'+row.id;
  const retained=new Map(complete?[]:events.map(row=>[key(row),row]));
  let compared=0,mismatch;
  function event(row){
    if(mismatch||row.tick<from||row.tick>to)return;
    const prior=complete?events[compared]:retained.get(key(row));
    if(!complete&&!prior)return;
    if(!equal(prior,row)){
      mismatch={kind:'events',tick:row.tick,expected:prior??null,actual:row};
      return;
    }
    compared++;
    if(!complete)retained.delete(key(row));
  }
  return {event,result(){
    if(!mismatch&&compared<events.length){
      const row=complete?events[compared]:retained.values().next().value;
      mismatch={kind:'events',tick:row.tick,expected:row,actual:null};
    }
    return {compared,...(mismatch&&{mismatch})};
  }};
}

async function replay(project,K,options={}) {
  const source=readRecording(project), W=K.world, R=W.runtime;
  if(!source)throw new TypeError('Story run contains only events. Use story events or story cues.');
  if(source.format===Fixture.format)return Fixture.replay(W,source,options);
  if(source.format!==R.runFormat)throw new TypeError('Story bundle recording needs a native run or fixture');
  return {run:await R.replayAsync(source,options)};
}

async function verify(project,K,options={}) {
  const W=K.world,R=W.runtime,E=W.storyEvents;
  const {id,revision,kind}=project.metadata;
  if(!['story-pack','story-run'].includes(kind))throw new TypeError('Expected a portable story pack or run bundle');
  const source=readRecording(project), expected=project.storyEvents?.();
  const summary={format:'ink-studio/story-bundle-verification',version:1,id,revision,kind,
    files:project.files().length,documents:project.storyDocuments().length,
    ...(expected&&{events:expected.events.length,coverage:expected.coverage})};
  if(!source)return {...summary,passed:true,status:'verified',replay:'none'};
  if(![Fixture.format,R.runFormat].includes(source.format))
    throw new TypeError('Story bundle recording needs a native run or fixture');
  const origin=source.origin??source.checkpoint, end=source.end?.tick??(source.expect?.fault?source.until-1:source.until);
  const T=K.procedural.takeTime, rate=origin.world?.takeClock?.simulationRate;
  if(origin.world?.id!==expected.world||origin.world.dt!==expected.dt||expected.to>end||
    expected.simulationRate!==undefined&&T.compare(T.period(expected.dt,expected.simulationRate),T.period(expected.dt,rate))!==0)
    return {...summary,passed:false,status:'diverged',replay:'native',mismatch:{kind:'clock'}};
  if(expected.coverage==='complete'&&expected.from<origin.tick)
    return {...summary,passed:false,status:'diverged',replay:'native',mismatch:{kind:'coverage',from:origin.tick}};
  const definitions=new Map((origin.world.storyDocuments??[]).map(row=>[row.id,row]));
  const changed=project.storyDocuments().find(row=>definitions.has(row.id)&&!W.data.equal(row,definitions.get(row.id)));
  if(changed)return {...summary,passed:false,status:'diverged',replay:'native',mismatch:{kind:'definition',id:changed.id}};
  const compare=verifyEvents(W,expected);
  let mismatch;
  if(source.format===Fixture.format){
    const result=Fixture.replay(W,source,options);
    mismatch=result.report.mismatch;
    if(!mismatch){
      const log=E.envelopes(Fixture.eventRecording(W,source),{stream:result.run.view().eventStream,simulationRate:rate});
      for(const row of log.events)compare.event(row);
    }
  }else{
    try {
      const committed=row=>W.committedEvents.read(row,expected.world,source.end.eventStream);
      if(expected.from<=origin.tick){
        const retained=E.read(origin);
        for(const row of retained.events)compare.event(committed(row));
      }
      await R.replayAsync(source,{...options,onTick(frame){
        if(frame.tick>=expected.from&&frame.tick<=expected.to)
          for(const row of frame.events)compare.event(committed(row));
      }});
    } catch(error){
      if(!error.runMismatch)throw error;
      mismatch=error.runMismatch;
    }
  }
  const compared=compare.result();
  mismatch??=compared.mismatch;
  return {...summary,passed:!mismatch,status:mismatch?'diverged':'verified',replay:'native',compared:compared.compared,
    ...(mismatch&&{mismatch})};
}

module.exports={readRecording,replay,verify};
