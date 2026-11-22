const {createHash} = require('node:crypto');

const format = 'ink-studio/simulation-fixture';
const maxTicks = 100000, maxEvents = 100000, maxTrials = 128, reductionTicks = 250000;
const usage = 'Use sim fixture <world|checkpoint|run> --out fixture.json [--from N --ticks N --actions file.json --event KIND --event-where JSON | --fault] [--minimize]';
const sha256 = value => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item==='object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item)).digest('hex');

function scan(run,until,visit) {
  for (let tick=run.view().tick+1; tick<=until; tick++) {
    try { run.step(); }
    catch (error) {
      return {tick,fault:{tick,name:error?.name??'Error',message:String(error?.message??error)}};
    }
    if (visit(run.events,tick)) return {tick};
  }
  return {tick:until};
}

function addEvents(trace,rows,check) {
  check(trace.length+rows.length<=maxEvents,'Fixture trace exceeds '+maxEvents+' events. Capture a shorter range.');
  for (const row of rows) trace.push(row);
}

function capture(W,subject,settings,workerPool) {
  const {check} = W.data, {from,until,focus} = settings, R = W.runtime;
  const run = subject.log ? R.openRecording(subject.log,{workerPool}) :
    R.create(subject.checkpoint?.world??subject.world,{checkpoint:subject.checkpoint,workerPool,
      playback:subject.submissions&&new Map(subject.submissions.map(row=>[row.tick,row.commands]))});
  if (subject.actions?.length) run.schedule(subject.actions);
  const prefix = scan(run,from,()=>false);
  check(!prefix.fault,'Cannot reach the fixture start: '+prefix.fault?.message);
  const checkpoint = run.checkpoint(), trace = [];
  let event;
  const result = scan(run,until,(rows)=>{
    addEvents(trace,rows,check);
    if (focus?.kind==='event')
      event = rows.find(row=>row.kind===focus.event&&W.query.condition(focus.where,row));
    return Boolean(event);
  });
  check(!result.fault||focus?.kind==='fault','Fixture run failed at tick '+result.tick+': '+result.fault?.message);
  check(focus?.kind!=='fault'||result.fault,'No simulation fault in the requested range');
  check(focus?.kind!=='event'||event,'No matching '+focus?.event+' event in the requested range');
  const batches = subject.log
    ? [...W.runRecords.playback(subject.log)].map(([tick,commands])=>({tick,commands}))
    : subject.submissions??[];
  const submissions = batches.filter(row=>row.tick>from&&row.tick<=result.tick);
  return {checkpoint,submissions,until:result.tick,trace,end:run.checkpoint(),event,fault:result.fault};
}

function deletions(subject) {
  const groups = [];
  const group = (rows,replace) => {
    if (rows?.length) groups.push({rows,replace});
  };
  group(subject.actions,(value,actions)=>({...value,actions}));
  if (subject.world) {
    for (const key of ['commands','connections','storyDocuments','storyTemplates'])
      group(subject.world[key],(value,rows)=>({...value,world:{...value.world,[key]:rows}}));
    for (const key of ['systems','entities','prefabs'])
      group(Object.entries(subject.world[key]??{}),(value,rows)=>({...value,world:{
        ...value.world,[key]:Object.fromEntries(rows)
      }}));
  } else {
    group(subject.checkpoint.pending,(value,pending)=>({...value,checkpoint:{...value.checkpoint,pending}}));
    group(subject.submissions.flatMap(({tick,commands})=>commands.map(command=>({tick,command}))),(value,rows)=>{
      const batches = new Map();
      for (const {tick,command} of rows) {
        if (!batches.has(tick)) batches.set(tick,[]);
        batches.get(tick).push(command);
      }
      return {...value,submissions:[...batches].map(([tick,commands])=>({tick,commands}))};
    });
  }
  return {
    size:groups.reduce((count,{rows})=>count+rows.length,0),
    without(start,count) {
      let offset=0, value=subject;
      for (const {rows,replace} of groups) {
        const left=Math.max(0,start-offset), right=Math.min(rows.length,start+count-offset);
        if (left<right) value=replace(value,rows.slice(0,left).concat(rows.slice(right)));
        offset+=rows.length;
      }
      return value;
    }
  };
}

function minimize(W,subject,settings,reference,workerPool) {
  // Stop each trial at the observed witness and preserve the original tick clock.
  const rootTick = subject.checkpoint?.tick??0;
  const until = reference.until, cost = Math.max(1,until-rootTick);
  const budget = Math.min(maxTrials,Math.floor(reductionTicks/cost));
  const witness = reference.event??reference.fault;
  const original = deletions(subject).size;
  let trial=0, current=deletions(subject), best=reference;
  for (let width=current.size; width>0&&trial<budget;) {
    let changed=false;
    for (let offset=0; offset<current.size&&trial<budget;) {
      const candidate = current.without(offset,width);
      trial++;
      let captured;
      try { captured=capture(W,candidate,{...settings,until},workerPool); }
      catch { /* Invalid dependencies and missing witnesses keep these inputs in the fixture. */ }
      if (captured&&W.data.equal(witness,captured.event??captured.fault)) {
        current=deletions(candidate);
        best=captured;
        changed=true;
      } else offset+=width;
    }
    if (width===1&&!changed) break;
    width=Math.ceil(width/2);
  }
  return {best,reduction:{trials:trial,budget,removed:original-current.size,remaining:current.size,
    exhausted:trial===budget&&current.size>0}};
}

function build(W,input,{from,until,actions,focus,reduce,workerPool}={}) {
  const {check} = W.data, R = W.runtime, log = input.log;
  check(input.world,'Fixture source must be a native world, checkpoint, or recording');
  check(!log||actions===undefined,'A recording already defines its command submissions');
  check(!reduce||focus,'Fixture minimization needs --event or --fault');
  const root = log?.origin.tick??input.checkpoint?.tick??0;
  from??=root;
  until??=log?.end.tick;
  check(Number.isSafeInteger(from)&&Number.isSafeInteger(until)&&root<=from&&from<=until&&until<=R.maxTick&&
    until-root<=maxTicks&&(!log||until<=log.end.tick),
  'Fixture range must be within the source and '+maxTicks+' ticks of its start');
  if (log) {
    check(log.end.tick-root<=maxTicks,'Use a source checkpoint or a recording of at most '+maxTicks+' ticks');
    const verification = R.verify(log,{workerPool});
    check(verification.status==='verified','Fixture source recording diverged at tick '+verification.mismatch?.tick);
  }
  const settings={from,until,focus};
  const subject = log?{log}:input.checkpoint?{checkpoint:input.checkpoint,actions}:{world:input.world,actions};
  const reference = capture(W,subject,settings,workerPool);
  const reduced = reduce?minimize(W,input.checkpoint?{
    checkpoint:reference.checkpoint,submissions:reference.submissions
  }:subject,settings,reference,workerPool):null;
  const {checkpoint,submissions,trace,end,event,fault} = reduced?.best??reference;
  return {format,version:1,checkpoint,submissions,until:event?.tick??fault?.tick??reference.until,
    expect:{events:trace,endSha256:sha256(end),...(fault&&{fault})},
    ...(focus&&{focus:{...focus,tick:event?.tick??fault.tick}}),...(reduced&&{reduction:reduced.reduction})};
}

function validate(W,fixture) {
  const {check,record} = W.data, R = W.runtime, {checkpoint,until,submissions,expect} = fixture;
  const from = checkpoint?.tick;
  check(fixture.format===format&&fixture.version===1&&checkpoint?.format===R.checkpointFormat&&
    Number.isSafeInteger(from)&&from>=0&&Number.isSafeInteger(until)&&until>=from&&until<=R.maxTick&&until-from<=maxTicks&&
    Array.isArray(submissions)&&submissions.length<=maxTicks&&record(expect)&&
    typeof expect.endSha256==='string'&&/^[0-9a-f]{64}$/.test(expect.endSha256)&&
    Array.isArray(expect.events)&&expect.events.length<=maxEvents,'Invalid version 1 simulation fixture');
  let last=from;
  for (const row of submissions) {
    check(record(row)&&Number.isSafeInteger(row.tick)&&row.tick>last&&row.tick<=until&&
      Array.isArray(row.commands)&&row.commands.length>0&&row.commands.length<=100000&&
      row.commands.every(command=>record(command)&&Number.isSafeInteger(command.tick)&&command.tick>row.tick&&command.tick<=R.maxTick),
    'Invalid fixture command submission');
    last=row.tick;
  }
  const fault = expect.fault;
  check(fault===undefined||record(fault)&&until>from&&fault.tick===until&&typeof fault.name==='string'&&typeof fault.message==='string',
    'Invalid fixture fault');
  last=from;
  for (const event of expect.events) {
    check(record(event)&&Number.isSafeInteger(event.tick)&&event.tick>from&&event.tick>=last&&
      event.tick<=(fault?until-1:until)&&typeof event.kind==='string','Invalid fixture event trace');
    last=event.tick;
  }
}

function replay(W,fixture,options={}) {
  validate(W,fixture);
  const {checkpoint,submissions,until,expect} = fixture, {equal} = W.data;
  const run = W.runtime.create(checkpoint.world,{...options,checkpoint,
    playback:new Map(submissions.map(row=>[row.tick,row.commands]))});
  let cursor=0, mismatch;
  const result = scan(run,until,(rows,tick)=>{
    for (const row of rows) {
      const expected = expect.events[cursor];
      if (!equal(expected,row)) {
        mismatch={kind:'event',index:cursor,tick,expected:expected?.tick===tick?expected:null,actual:row};
        return true;
      }
      cursor++;
    }
    if (expect.events[cursor]?.tick===tick) {
      mismatch={kind:'event',index:cursor,tick,expected:expect.events[cursor],actual:null};
      return true;
    }
    return false;
  });
  if (!mismatch&&!equal(expect.fault,result.fault))
    mismatch={kind:'fault',tick:result.tick,expected:expect.fault??null,actual:result.fault??null};
  if (!mismatch) {
    const actual = sha256(run.checkpoint());
    if (expect.endSha256!==actual) mismatch={kind:'checkpoint',tick:run.view().tick,expected:expect.endSha256,actual};
  }
  return {run,report:{format:'ink-studio/simulation-fixture-verification',version:1,status:mismatch?'diverged':'verified',
    scene:checkpoint.world.id,seed:checkpoint.world.seed,fromTick:checkpoint.tick,toTick:until,
    completedTick:run.view().tick,events:cursor,commands:checkpoint.pending.length+
      submissions.reduce((sum,{commands})=>sum+commands.length,0),
    ...(result.fault&&{fault:result.fault}),...(mismatch&&{mismatch})}};
}

function eventRecording(W,fixture) {
  validate(W,fixture);
  const {checkpoint,expect,until} = fixture;
  const to = expect.fault?until-1:until;
  return {format:W.storyEvents.format,version:1,id:checkpoint.world.id,dt:checkpoint.world.dt,
    from:Math.min(checkpoint.tick+1,to),to,coverage:'complete',dropped:0,events:expect.events};
}

module.exports = {format,usage,build,replay,eventRecording};
