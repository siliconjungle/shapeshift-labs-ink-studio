const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {json} = require('./asset-files.js');
const Story = require('../src/story-document.js');
const {stageValue,choiceValue} = require('./story-observation.js');

const usage = 'sim fork-compare <world|checkpoint|recording> <plan.json> --out directory';
const names = {checkpoint:'decision.checkpoint.json',report:'comparison.json'};
const sorted = object=>Object.keys(object??{}).sort();

function prepare(W,raw,file,read,sources) {
  const {check,record,selector} = W.data;
  const fields = (value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const tick = value=>Number.isSafeInteger(value)&&value>=0&&value<=W.runtime.maxTick;
  check(fields(raw,['story','capture','until','actions','branches','probes'])&&typeof raw.story==='string'&&
    raw.story.split('/').length===2&&raw.story.split('/').every(Story.isStoryId)&&tick(raw.until),
  'Fork comparison needs a document/story and an absolute ending tick');
  const capture = raw.capture??{};
  if (raw.capture!==undefined) check(fields(capture,['tick','stage','byTick'])&&
    (tick(capture.tick)&&capture.stage===undefined&&capture.byTick===undefined||
      capture.tick===undefined&&Story.isStoryId(capture.stage)&&(capture.byTick===undefined||tick(capture.byTick))),
  'Capture needs a tick or a stage with an optional byTick bound');
  check((capture.tick??capture.byTick??0)<=raw.until,'Capture must be within the comparison time range');

  function actions(value) {
    if (value===undefined) return [];
    if (typeof value==='string') {
      check(value.trim()&&!path.isAbsolute(value)&&!path.win32.isAbsolute(value),'Use a relative actions file in the plan');
      const source = path.resolve(path.dirname(file),value);
      sources.add(source);
      value = read(source);
    }
    check(Array.isArray(value)&&value.every(item=>record(item)&&tick(item.tick)),'Fork actions need scheduled commands');
    return value;
  }
  check(Array.isArray(raw.branches)&&raw.branches.length===2,'Fork comparison needs two named branches');
  const ids = new Set();
  const branches = raw.branches.map(row=>{
    check(fields(row,['id','actions','choice'])&&typeof row.id==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(row.id)&&
      !ids.has(row.id),'Fork branch IDs must be distinct lower-case names');
    ids.add(row.id);
    if (row.choice!==undefined) {
      const {choice} = row;
      check(fields(choice,['branch','select','tick'])&&Story.isStoryId(choice.branch)&&
        (choice.tick===undefined||tick(choice.tick))&&(choice.select===undefined||record(choice.select)&&
          Object.entries(choice.select).every(([id,option])=>Story.isStoryId(id)&&Story.isStoryId(option))),
      'Fork choice needs a branch, optional choice selections, and an optional tick');
    }
    return {id:row.id,actions:actions(row.actions),choice:row.choice};
  });
  const probes = raw.probes===undefined?{}:raw.probes;
  check(record(probes)&&Object.keys(probes).length<=64,'Fork comparison accepts up to 64 named probes');
  const measurements = sorted(probes).map(id=>{
    const spec = probes[id];
    check(Story.isStoryId(id)&&fields(spec,['field','at','args','select'])&&typeof spec.field==='string'&&
      (spec.args===undefined||record(spec.args)),'Invalid fork comparison probe '+id);
    return [id,{...spec,path:spec.select===undefined?undefined:selector(spec.select)}];
  });
  return {story:raw.story,capture,until:raw.until,actions:actions(raw.actions),branches,measurements};
}

function validateOutputs(destination,files,sources,check) {
  for (const name of files) {
    const target = path.resolve(destination,name), existing = fs.existsSync(target)?fs.statSync(target):null;
    check(!existing||existing.isFile(),'Expected a file output for '+name);
    for (const input of sources) {
      const stat = existing&&fs.existsSync(input)?fs.statSync(input):null;
      check(path.resolve(input)!==target&&(!stat||existing.dev!==stat.dev||existing.ino!==stat.ino),
        'Use a separate directory for fork comparison outputs');
    }
  }
}

function definitionOf(frame,story) {
  const [document,id] = story.split('/');
  const table = (frame.storyDocuments??frame.world.storyDocuments??[]).find(row=>row.id===document)?.stories;
  return {document,id,definition:table&&Object.hasOwn(table,id)?table[id]:undefined};
}

function capturePoint(W,engine,plan,recordedEnd) {
  const {check} = W.data, start = engine.view(), {story,capture,until} = plan;
  const {definition} = definitionOf(start,story);
  check(definition?.lifecycle,'Unknown story with lifecycle '+story);
  if (plan.actions.length) engine.schedule(plan.actions);
  if (capture.stage!==undefined) {
    check(definition.lifecycle.progression&&Object.hasOwn(definition.stages,capture.stage),'Unknown runnable stage '+capture.stage);
    const bound = Math.min(capture.byTick??until,recordedEnd??until);
    const matches = frame=>{
      const row = frame.storyLifecycle?.[story];
      return row?.flow?.current?.stage===capture.stage&&['active','suspended'].includes(row.transitions.at(-1).to);
    };
    engine.advance(bound,{until:matches});
    check(matches(engine.view()),'Capture stage '+capture.stage+' was not current by tick '+bound);
  } else if (capture.tick!==undefined) {
    check(recordedEnd===undefined||capture.tick<=recordedEnd,'Capture tick lies outside the recording');
    engine.advance(capture.tick);
  }
  const checkpoint = engine.checkpoint();
  check(checkpoint.tick<until,'Ending tick must follow the captured decision point');
  return checkpoint;
}

function commands(W,plan,branch,frame) {
  const {check} = W.data, {choice} = branch;
  const list = [];
  if (choice) {
    const {document,id:story} = definitionOf(frame,plan.story);
    const row = frame.storyLifecycle?.[plan.story], visit = row?.flow?.current;
    const tick = choice.tick??frame.tick+1;
    check(visit&&row.transitions.at(-1).to==='active','A shorthand choice needs an active stage at capture');
    const base = {document,story,stage:visit.stage,visit:visit.visit,reason:'fork-compare-choice'};
    for (const objective of sorted(choice.select))
      list.push({tick,action:'world/story-select',args:{...base,objective,option:choice.select[objective]}});
    list.push({tick,action:'world/story-choose',args:{...base,branch:choice.branch}});
  }
  const all = [...list,...branch.actions];
  check(all.every(row=>row.tick>frame.tick&&row.tick<=plan.until),
    'Branch '+branch.id+' actions must follow capture and occur within the comparison interval');
  return all;
}

function snapshot(W,run,plan,from) {
  const frame = run.view(), query = run.query(), {read,check} = W.data;
  const accounts = Object.fromEntries((query.inspect().accounts??[]).map(({name})=>{
    const sample = query.probe('world/account',undefined,{account:name}), {type,resource,units,balance} = sample.value??{};
    return [name,sample.status==='ok'?{type,resource,units,balance}:sample];
  }));
  const probes = Object.fromEntries(plan.measurements.map(([id,{field,at,args,path}])=>{
    check(query.field(field),'Unknown fork comparison field '+field);
    const sample = query.probe(field,at,args);
    if (sample.status!=='ok'||path===undefined) return [id,sample];
    const value = read(sample.value,path);
    return [id,value===undefined?{status:'missing',reason:'Selected probe value is unavailable'}:{status:'ok',value}];
  }));
  const commitments = {}, settlements = {}, stories = {};
  for (const [id,row] of Object.entries(frame.storyLifecycle??{})) {
    if (!row) continue;
    const {definition} = definitionOf(frame,id), current = row.flow?.current, last = row.transitions.at(-1);
    const stage = stageValue(definition,row,current,frame.storyTriggers?.[id]?.start);
    const route = row.flow?.route.filter(visit=>visit.leftAt>from);
    stories[id] = {...stage,...(last.deadline&&{deadline:last.deadline}),...(current&&{objectives:current.objectives}),
      ...(route?.length&&{route}),...(row.flow?.dropped&&{droppedVisits:row.flow.dropped}),
      ...(row.cleanup&&{cleanup:row.cleanup}),...(row.consequences&&{consequences:row.consequences})};
    const assignment = W.storyHandoffs.assignment(row);
    if (row.commitment||row.handoffs||assignment) commitments[id] = {commitment:row.commitment,
      handoffs:row.handoffs,assignment,
      ...(assignment&&{order:W.schedulerInspector.orderStatus(query,assignment)})};
    if (row.settlements) settlements[id] = row.settlements;
  }
  return {accounts,commitments,settlements,stories,probes};
}

function changes(equal,before,after,detail) {
  return [...new Set([...sorted(before),...sorted(after)])].sort().flatMap(id=>{
    const left = before[id]??null, right = after[id]??null;
    return equal(left,right)?[]:[{id,before:left,after:right,...detail?.(left,right)}];
  });
}

function balanceDelta(before,after) {
  if (!before||!after||before.balance===undefined||after.balance===undefined) return {};
  const delta = Array.isArray(before.balance)?after.balance.map((value,i)=>value-before.balance[i]):after.balance-before.balance;
  return {delta:[delta].flat().every(Number.isFinite)?delta:null};
}

function journal() {
  const limit = 256, rows = [], counts = Object.create(null);
  let total = 0;
  return {add(batch,key) {
    total += batch.length;
    for (const row of batch) counts[row[key]] = (counts[row[key]]??0)+1;
    rows.push(...batch.slice(-limit));
    if (rows.length>limit) rows.splice(0,rows.length-limit);
  },report:()=>({total,omitted:total-rows.length,counts,rows})};
}

function run(W,plan,{engine,recordedEnd,workerPool,destination,sources}) {
  const R = W.runtime, {check,equal} = W.data;
  const filenames = plan.branches.map(({id})=>id+'.run.json');
  validateOutputs(destination,[names.checkpoint,names.report,...filenames],sources,check);
  const checkpoint = capturePoint(W,engine,plan,recordedEnd);
  // Restore the captured state so later submissions in a source recording stay outside the trial.
  const root = R.create(checkpoint.world,{checkpoint,workerPool,recordRun:true});
  const frame = root.view(), {document,definition} = definitionOf(frame,plan.story);
  const story = frame.storyLifecycle?.[plan.story];
  const baseline = snapshot(W,root,plan,checkpoint.tick);
  const before = {world:frame.world.id,seed:frame.world.seed,tick:frame.tick,time:frame.time,
    checkpoint:names.checkpoint,sha256:createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex'),
    story:baseline.stories[plan.story]??null,
    commitment:baseline.commitments[plan.story]??null,
    choices:choiceValue(W,frame,root.query(),plan.story,document,definition,story,story?.flow?.current),
    pendingCommands:checkpoint.pending.length,
    ...(plan.measurements.length&&{probes:baseline.probes})};
  const prepared = plan.branches.map(branch=>commands(W,plan,branch,frame));
  const results = plan.branches.map((branch,index)=>{
    const fork = root.fork(), transfers = journal(), events = journal();
    fork.schedule(prepared[index]);
    fork.advance(plan.until,{onTick(view) {
      transfers.add(view.transfers??[],'status');
      events.add(fork.events,'kind');
    }});
    const recording = fork.recording(), verification = R.verify(recording,{workerPool});
    check(equal(recording.origin,checkpoint),'Fork '+branch.id+' has a different decision point');
    check(verification.status==='verified','Fork '+branch.id+' failed replay verification');
    const final = snapshot(W,fork,plan,checkpoint.tick);
    const report = {id:branch.id,recording:filenames[index],verification,commands:prepared[index],
      story:final.stories[plan.story]??null,
      commitment:final.commitments[plan.story]??null,
      costs:{accounts:changes(equal,baseline.accounts,final.accounts,balanceDelta),
        settlements:changes(equal,baseline.settlements,final.settlements),transfers:transfers.report()},
      commitments:changes(equal,baseline.commitments,final.commitments),
      fallout:{stories:changes(equal,baseline.stories,final.stories),probes:changes(equal,baseline.probes,final.probes),
        events:events.report()}};
    return {recording,final,report};
  });
  const [left,right] = results, a = left.final, b = right.final;
  const report = {format:'ink-studio/story-fork-comparison',version:1,story:plan.story,decision:before,
    until:plan.until,branches:results.map(row=>row.report),
    difference:{from:left.report.id,to:right.report.id,
      costs:{accounts:changes(equal,a.accounts,b.accounts,balanceDelta),settlements:changes(equal,a.settlements,b.settlements),
        transferCounts:changes(equal,left.report.costs.transfers.counts,right.report.costs.transfers.counts)},
      commitments:changes(equal,a.commitments,b.commitments),
      fallout:{stories:changes(equal,a.stories,b.stories),probes:changes(equal,a.probes,b.probes),
        eventCounts:changes(equal,left.report.fallout.events.counts,right.report.fallout.events.counts)}}};
  json(path.join(destination,names.checkpoint),checkpoint);
  for (const {recording,report:{recording:file}} of results) json(path.join(destination,file),recording);
  json(path.join(destination,names.report),report);
  return report;
}

module.exports = {usage,prepare,run};
