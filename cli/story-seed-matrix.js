const path = require('node:path');
const Story = require('../src/story-document.js');
const {choiceValue,blockersValue} = require('./story-observation.js');

const usage = 'sim seed-matrix <world> <plan.json> [--out report.json]';
const terminal = new Set(['completed','failed','withdrawn','expired','candidate-expired']);
const compare = (a,b)=>a<b?-1:a>b?1:0;
const own = (value,key)=>value!=null&&Object.hasOwn(value,key);
const sorted = value=>Object.keys(value??{}).sort();

function prepare(W,raw,file,read,sources) {
  const {check,record} = W.data;
  check(record(raw)&&Object.keys(raw).every(key=>['seeds','ticks','stories','actions'].includes(key))&&
    Array.isArray(raw.seeds)&&Number.isSafeInteger(raw.ticks)&&raw.ticks>=0&&raw.ticks<=W.runtime.maxTick,
  'Seed matrix needs seeds and an absolute ending tick');
  const {seeds} = W.observations.matrix({seeds:raw.seeds});
  const {stories} = raw;
  check(stories===undefined||Array.isArray(stories)&&stories.length>0&&new Set(stories).size===stories.length&&
    stories.every(story=>typeof story==='string'&&story.split('/').length===2&&story.split('/').every(Story.isStoryId)),
  'Seed matrix stories need distinct document/story IDs');
  let actions = raw.actions===undefined?[]:raw.actions;
  if (typeof actions==='string') {
    check(actions.trim()&&!path.isAbsolute(actions)&&!path.win32.isAbsolute(actions),'Use a relative actions file in the seed matrix plan');
    const filename = path.resolve(path.dirname(file),actions);
    sources.add(filename);
    actions = read(filename);
  }
  check(Array.isArray(actions),'Seed matrix actions need a scheduled command list');
  return {seeds,ticks:raw.ticks,stories,actions};
}

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (value===null||typeof value!=='object') return value;
  return Object.fromEntries(sorted(value).map(id=>[id,sortedObject(value[id])]));
}
const identity = value=>JSON.stringify(sortedObject(value));

function add(table,detail,amount=1) {
  const key = identity(detail), known = table.get(key);
  if (known) known.count+=amount;
  else table.set(key,{detail,count:amount});
}
const entries = table=>[...table.values()].sort((a,b)=>b.count-a.count||compare(identity(a.detail),identity(b.detail)));
const rows = (table,measure)=>entries(table).map(({detail,count})=>({...detail,[measure]:count}));
const increment = (table,key)=>{ table[key]=(table[key]??0)+1; };

function schedulerBlockers(frame,key,candidate,nextAutomaticAt) {
  if (!candidate||!['blocked','ready'].includes(candidate.status)) return [];
  const policy = frame.incidentCandidatePolicies[key], result = [];
  if (candidate.pressure?.ready===false) for (const item of candidate.pressure.blockers)
    result.push({kind:'candidate',reason:item.kind==='commitments'?'commitment-capacity':'pressure-capacity',
      ...(item.id!==undefined&&{check:item.id})});
  if (candidate.cooldown?.ready===false) result.push({kind:'candidate',reason:'recovery-cooldown'});
  if (candidate.anchor?.ready===false) result.push({kind:'candidate',reason:candidate.anchor.reason});
  if (policy.anchor) return result;
  if (policy.release==='manual') result.push({kind:'candidate',reason:'manual-release'});
  else {
    const spec = frame.storytellerCandidates?.[key];
    if (spec?.withinChallenge===false) result.push({kind:'candidate',reason:'challenge'});
    if ((spec?.selection??policy.selection)?.weight===0) result.push({kind:'candidate',reason:'zero-weight'});
    if (nextAutomaticAt!==null&&frame.tick<nextAutomaticAt&&candidate.status==='ready')
      result.push({kind:'candidate',reason:'cadence'});
  }
  return result;
}

function blockerRows(blockers,candidate,stage) {
  const result = [];
  function feasibility(kind,check,report) {
    if (report.status==='ready') return;
    result.push({kind,check,reason:report.reason});
    for (const item of report.actual?.blockers??[]) {
      const reason = typeof item==='string'?item:item.reason;
      if (reason&&reason!==report.reason) result.push({kind,check,reason});
    }
  }
  for (const blocker of blockers) {
    const {kind,check,reason,branch,reference,cause,task,id,phase} = blocker;
    if (kind==='feasibility') feasibility(kind,check,blocker);
    else if (kind==='commitment'||kind==='handoff') for (const item of blocker.checks)
      result.push({kind,check:item.name,reason:item.reason});
    else if (kind==='branch') {
      const pending = blocker.pending??blocker.pendingChildren??blocker.mismatchedChildren??[];
      for (const requirement of pending.length?pending:[undefined])
        result.push({kind,reason,stage,branch,...(requirement&&{check:requirement})});
    }
    else if (kind!=='candidate') result.push({kind,reason:reason??cause??'unavailable',
      ...(reference&&{check:reference}),...(task&&{check:task}),...(id&&{check:id}),...(phase&&{phase})});
  }
  if (candidate?.status==='blocked') for (const [check,value] of Object.entries(candidate.report?.checks??{}))
    feasibility('candidate',check,value);
  return result;
}

function waiting(status,candidate,blockers,choice) {
  if (status==='waiting') {
    if (candidate&&['blocked','ready'].includes(candidate.status)) return 'queued';
    return blockers.some(item=>item.kind==='feasibility')?'admission':'unoffered';
  }
  if (status==='suspended') return 'suspended';
  if (status==='available') {
    if (blockers.some(item=>item.kind==='settlement'&&item.phase==='costs')) return 'settlement';
    return blockers.some(item=>item.kind==='commitment')?'commitment':'offer';
  }
  if (status!=='active') return;
  if (blockers.some(item=>item.kind==='work')) return 'work';
  if (blockers.some(item=>item.kind==='settlement'&&item.phase==='outcome'&&
    (!choice||choice.branches.some(branch=>branch.target.outcome===item.outcome)))) return 'settlement';
  if (!choice) return;
  if (choice.branches.every(branch=>!branch.eligible)) return 'stage';
  if (choice.mode==='beat') return 'beat';
  if (choice.mode==='intervene'&&['waiting','open'].includes(choice.status)) return 'intervention';
  if (choice.branches.some(branch=>branch.eligible&&branch.selectable)&&
    !choice.branches.some(branch=>branch.automatic&&branch.eligible)) return 'player';
}

function definitions(frame,requested,check) {
  const map = new Map();
  for (const document of frame.storyDocuments??frame.world.storyDocuments??[]) {
    for (const id of sorted(document.stories)) {
      const definition = document.stories[id];
      if (definition.lifecycle) map.set(document.id+'/'+id,{document:document.id,definition});
    }
  }
  const stories = requested??[...map.keys()].sort();
  check(stories.length>0&&stories.every(story=>map.has(story)),'Seed matrix needs existing story lifecycles');
  return stories.map(id=>({id,...map.get(id)}));
}

function trial(W,run,plan) {
  const initial = run.view(), {seed,dt} = initial.world;
  const states = new Map(definitions(initial,plan.stories,W.data.check).map(item=>[item.id,{
    ...item,offeredAt:null,startedAt:null,closedVisits:0,waits:{},branches:new Map(),blockers:new Map(),rejections:new Map()
  }]));
  function events(batch) {
    for (const event of batch) {
      if (event.system!=='world') continue;
      const key = event.document+'/'+event.story, state = states.get(key);
      if (!state) continue;
      if (/^story-.*-rejected$/.test(event.kind)&&typeof event.reason==='string')
        add(state.rejections,{kind:event.kind,reason:event.reason});
    }
  }
  function closedVisits(id,state,row,batch) {
    const {route,dropped} = row.flow;
    const chosen = ({stage,branch,target})=>add(state.branches,{stage,branch,target});
    for (let i=route.length-1;i>=0&&route[i].visit>state.closedVisits;i--) chosen(route[i]);
    // A single tick can close more visits than the runtime retains in its route.
    if (dropped>state.closedVisits) {
      const seen = new Set();
      for (const event of batch) if (event.system==='world'&&event.kind==='story-branch-chosen'&&
        event.document+'/'+event.story===id&&event.visit>state.closedVisits&&event.visit<=dropped&&
        !seen.has(event.visit)&&own(state.definition.stages[event.stage]?.next,event.branch)) {
        chosen(event);
        seen.add(event.visit);
      }
    }
    state.closedVisits = dropped+route.length;
  }
  function observe(frame,query) {
    const batch = frame.tick>0?run.events:[];
    events(batch);
    const nextAutomaticAt = frame.storyteller
      ? W.storyteller.nextAt(frame.storyteller,W.storyteller.lastAutomatic(frame.incidentCandidates)) : null;
    for (const [id,state] of states) {
      const {document,definition} = state, row = frame.storyLifecycle?.[id], current = row?.flow?.current;
      const change = row?.transitions.at(-1), candidate = frame.incidentCandidates?.[id];
      const status = change?.to??(candidate?.status==='expired'?'candidate-expired':'waiting');
      state.offeredAt ??= row?.transitions.find(item=>item.to==='available')?.tick??null;
      state.startedAt ??= row?.transitions.find(item=>item.from==='available'&&item.to==='active')?.tick??null;
      if (row?.dropped&&(state.offeredAt===null||state.startedAt===null)) {
        for (const event of batch) if (event.system==='world'&&event.kind==='story-transition'&&event.document+'/'+event.story===id) {
          if (event.from===null&&event.to==='available') state.offeredAt ??= frame.tick;
          if (event.from==='available'&&event.to==='active') state.startedAt ??= frame.tick;
        }
      }
      if (row?.flow) closedVisits(id,state,row,batch);
      if (frame.tick>=plan.ticks||terminal.has(status)) continue;
      const choice = status==='active'?choiceValue(W,frame,query,id,document,definition,row,current):null;
      const observed = blockersValue(W,frame,query,id,row,choice);
      if (status==='waiting'&&!candidate&&definition.triggers&&!frame.storyTriggers?.[id]?.start&&!frame.storyFeasibility?.[id])
        observed.push({kind:'trigger',reason:'awaiting-trigger'});
      if (status==='available'&&definition.lifecycle.activation==='manual'&&!row.commitment)
        observed.push({kind:'lifecycle',reason:'manual-activation'});
      const blockers = [...blockerRows(observed,candidate,current?.stage),
        ...schedulerBlockers(frame,id,candidate,nextAutomaticAt)];
      for (const item of new Map(blockers.map(item=>[identity(item),item])).values()) add(state.blockers,item);
      const reason = waiting(status,candidate,observed,choice);
      if (reason) increment(state.waits,reason);
    }
  }
  if (plan.actions.length) run.schedule(plan.actions);
  observe(initial,run.query());
  const final = run.advance(plan.ticks,{onTick:observe});
  const stories = Object.fromEntries([...states].map(([id,state])=>{
    const row = final.storyLifecycle?.[id], end = row?.transitions.at(-1), candidate = final.incidentCandidates?.[id];
    const status = end?.to??(candidate?.status==='expired'?'candidate-expired':'waiting');
    const roleBindings = final.storyRoles?.[id]??{};
    const cast = sorted(roleBindings).map(slot=>{
      const {kind:bindingKind,source,value} = roleBindings[slot];
      return {kind:'role',slot,bindingKind,source,value,appearances:1,used:state.startedAt!==null};
    });
    const assignments = new Map();
    for (const order of [row?.commitment?.order,...(row?.handoffs?.transfers.map(handoff=>handoff.order)??[])]) if (order) {
      const {system,agent,generation} = order;
      add(assignments,{kind:'assignment',slot:'assignment',value:{system,agent,generation}});
    }
    cast.push(...rows(assignments,'appearances').map(item=>({...item,used:true})));
    return [id,{status,outcome:end?.outcome??null,offeredAt:state.offeredAt,startedAt:state.startedAt,
      endedAt:terminal.has(status)?end?.tick??candidate.terminal.tick:null,
      ...(candidate&&{candidate:{status:candidate.status,queuedAt:candidate.queuedAt,terminal:candidate.terminal,
        ...(candidate.selection&&{selection:candidate.selection.reason})}}),
      waiting:{ticks:Object.values(state.waits).reduce((a,b)=>a+b,0),byReason:state.waits},
      branches:rows(state.branches,'visits'),blockers:rows(state.blockers,'ticks'),cast,rejections:rows(state.rejections,'events')}];
  }));
  return {seed,dt,tick:final.tick,stories};
}

function combine(trials,field,measure) {
  const groups = new Map();
  for (const row of trials) for (const sample of row[field]) {
    const {[measure]:count,...detail} = sample;
    const key = identity(detail), group = groups.get(key)??{detail,count:0,runs:0};
    group.count+=count;
    group.runs++;
    groups.set(key,group);
  }
  return entries(groups).map(({detail,count,runs})=>({...detail,[measure]:count,runs}));
}

function castRepetition(trials) {
  const slots = new Map();
  for (const row of trials) for (const sample of row.cast) {
    const {kind,slot,value,appearances,used,...schema} = sample, key = identity({kind,slot,...schema});
    const group = slots.get(key)??{kind,slot,...schema,values:new Map()};
    const id = identity(value), choice = group.values.get(id)??{detail:{value},count:0,runs:0,usedRuns:0};
    choice.count+=appearances;
    choice.runs++;
    if (used) choice.usedRuns++;
    group.values.set(id,choice);
    slots.set(key,group);
  }
  return [...slots.values()].map(({values,...slot})=>{
    const samples = entries(values), appearances = samples.reduce((sum,row)=>sum+row.count,0);
    return {...slot,appearances,distinct:values.size,repeatedAppearances:appearances-values.size,
      values:samples.map(({detail:{value},count,runs,usedRuns})=>({value,appearances:count,runs,usedRuns}))};
  });
}

function waitingSummary(trials,dt) {
  const counts = trials.map(row=>row.waiting.ticks).sort((a,b)=>a-b), byReason = {};
  for (const {waiting:{byReason:reasons}} of trials) for (const [reason,ticks] of Object.entries(reasons))
    byReason[reason]=(byReason[reason]??0)+ticks;
  const totalTicks = counts.reduce((a,b)=>a+b,0), meanTicks = totalTicks/counts.length;
  return {totalTicks,meanTicks,meanSeconds:meanTicks*dt,minTicks:counts[0],
    medianTicks:(counts[Math.floor((counts.length-1)/2)]+counts[Math.floor(counts.length/2)])/2,
    p90Ticks:counts[Math.ceil(counts.length*0.9)-1],maxTicks:counts.at(-1),byReason};
}

function summarize(trials,dt) {
  const runs = trials.length, statuses = {}, outcomes = {}, candidates = {};
  for (const {status,outcome,candidate} of trials) {
    increment(statuses,status);
    if (outcome!==null) increment(outcomes,outcome);
    if (candidate) increment(candidates,candidate.status);
  }
  const offered = trials.filter(row=>row.offeredAt!==null).length, started = trials.filter(row=>row.startedAt!==null).length;
  const completed = statuses.completed??0, terminalRuns = Object.entries(statuses)
    .reduce((sum,[status,count])=>sum+(terminal.has(status)?count:0),0);
  const branches = combine(trials,'branches','visits'), exits = new Map();
  for (const {stage,visits} of branches) exits.set(stage,(exits.get(stage)??0)+visits);
  return {runs,offered,started,completed,terminal:terminalRuns,censored:runs-terminalRuns,
    completionRate:completed/runs,completionRateAfterStart:started?completed/started:null,statuses,outcomes,
    ...(Object.keys(candidates).length&&{candidates}),waiting:waitingSummary(trials,dt),
    branches:branches.map(row=>({...row,rate:row.runs/runs,shareOfStageExits:row.visits/exits.get(row.stage)})),
    blockers:combine(trials,'blockers','ticks'),castRepetition:castRepetition(trials),rejections:combine(trials,'rejections','events')};
}

function run(W,source,plan,{workerPool}={}) {
  const {check,equal} = W.data;
  check(!source.simulationModel||plan.seeds.every(seed=>seed===source.seed),'A simulation model pins its seed');
  const runs = plan.seeds.map(seed=>{
    try { return trial(W,W.runtime.create({...source,seed},{workerPool}),plan); }
    catch (error) { throw Error('Story seed '+seed+': '+error.message,{cause:error}); }
  });
  const dt = runs[0].dt, ids = sorted(runs[0].stories);
  check(runs.every(row=>equal(sorted(row.stories),ids)),'Story definitions changed across matrix seeds');
  const stories = Object.fromEntries(ids.map(id=>[id,summarize(runs.map(row=>row.stories[id]),dt)]));
  const trials = Object.values(stories), completed = trials.reduce((sum,row)=>sum+row.completed,0);
  return {format:'ink-studio/story-seed-matrix',version:1,world:source.id??'world',ticks:plan.ticks,dt,seeds:plan.seeds,
    summary:{runs:runs.length,storyTrials:runs.length*ids.length,completed,completionRate:completed/(runs.length*ids.length)},
    stories,runs};
}

module.exports = {usage,prepare,run};
