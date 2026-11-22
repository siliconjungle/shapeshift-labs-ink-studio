const Story = require('../src/story-document.js');
const {stageValue,evidenceValue,choiceValue,blockersValue} = require('./story-observation.js');

const usage = 'sim why|why-not <world|checkpoint|recording> document/story [--offer | --role ID [--actor system/agent] [--spec casting.json] | --stage [ID] | --outcome ID] [--ticks N] [--trace]';
const closed = new Set(['completed','failed','withdrawn','expired']);
const sorted = object=>Object.keys(object??{}).sort();
const verdict = (status,reason,message)=>({status,reason,message});

function request(W,mode,story,opt,read) {
  const enabled = key=>opt[key]!==undefined;
  const actor = ['role','actor','spec'].some(enabled);
  const topics = [enabled('offer')&&'offer',actor&&'actor',enabled('stage')&&'stage',enabled('outcome')&&'outcome'].filter(Boolean);
  const [document,id,...extra] = typeof story==='string'?story.split('/'):[];
  W.data.check(!extra.length&&Story.isStoryId(document)&&Story.isStoryId(id)&&topics.length<=1&&
    [opt.role,opt.outcome].every(value=>value===undefined||Story.isStoryId(value))&&
    (opt.stage===undefined||opt.stage===true||Story.isStoryId(opt.stage))&&
    [opt.offer,opt.trace].every(value=>value===undefined||value===true)&&
    (opt.spec===undefined||typeof opt.spec==='string'&&opt.spec.trim()),usage);
  const handle = opt.actor===undefined?undefined:W.data.endpoint(opt.actor);
  const topic = topics[0]??'offer';
  return {mode,topic,story,document,id,role:opt.role,actor:handle&&{system:handle[0],agent:handle[1]},
    stage:opt.stage===true?undefined:opt.stage,outcome:opt.outcome,trace:opt.trace===true,
    spec:opt.spec===undefined?undefined:read(opt.spec)};
}

function offer(ctx) {
  const {frame,query,key,definition,row,trigger,source} = ctx;
  const transition = row?.transitions.find(change=>change.to==='available');
  const feasibility = frame.storyFeasibility?.[key], candidate = frame.incidentCandidates?.[key];
  const policy = frame.incidentCandidatePolicies?.[key];
  const authoredRules = definition.lifecycle?.feasibility;
  const parent = row?.parent??feasibility?.request.parent;
  const owner = Object.entries(ctx.storyDocument.stories).find(([,story])=>
    Object.values(story.stages).some(stage=>stage.children?.open?.includes(ctx.id)));
  let forecast, previousDraw;
  if (!row&&policy) {
    const snapshot = query.probe('world/scheduler',undefined,{incident:key}).value;
    forecast = snapshot&&{tick:snapshot.forecast.tick,basis:snapshot.forecast.basis,candidate:snapshot.candidates[0]};
    previousDraw = Object.values(frame.incidentCandidates??{}).map(row=>row.selection).filter(selection=>
      selection?.candidates.some(row=>row.candidate===key)).sort((a,b)=>a.tick-b.tick).at(-1);
  }
  const evidence = {transition:transition??null,source:source??null,trigger:trigger??null,
    ...(parent&&{parent}),...(owner&&{owningArc:ctx.document+'/'+owner[0]}),
    ...(authoredRules&&{requires:authoredRules}),...(feasibility&&{feasibility}),
    ...(candidate&&{candidate}),...(previousDraw&&{previousDraw}),...(forecast&&{forecast})};
  if (transition) return {...verdict('offered',transition.reason,'The lifecycle recorded an offer at tick '+transition.tick+'.'),offer:evidence};
  if (row?.dropped) return {...verdict('offered','offer-transition-evicted','The lifecycle advanced past its retained offer transition.'),offer:evidence};
  if (row) return {...verdict('absent',row.transitions.at(-1).reason,'The story closed before an offer was recorded.'),offer:evidence};
  if (!definition.lifecycle) return {...verdict('absent','no-lifecycle','This definition publishes trigger events without an offer lifecycle.'),offer:evidence};
  if (candidate?.status==='expired') return {...verdict('absent',candidate.terminal.reason,'The queued opportunity expired.'),offer:evidence};
  if (feasibility?.report.ready===false||candidate?.report.ready===false)
    return {...verdict('waiting','feasibility-blocked','The offer is waiting on its feasibility checks.'),offer:evidence};
  if (policy) return {...verdict('waiting','scheduler-admission','The opportunity is subject to scheduler admission.'),offer:evidence};
  if (owner) return {...verdict('waiting','awaiting-parent-stage','The owning arc must open this questlet.'),offer:evidence};
  if (definition.triggers&&!trigger?.start)
    return {...verdict('waiting','awaiting-trigger','The offer is waiting for an authored trigger.'),offer:{...evidence,triggers:definition.triggers}};
  return {...verdict('waiting','awaiting-offer','The lifecycle is waiting for its first offer.'),offer:evidence};
}

function actorHandle(W,value) {
  if (W.data.record(value)&&W.data.id(value.system)&&W.data.id(value.agent))
    return {system:value.system,agent:value.agent,...(value.generation!==undefined&&{generation:value.generation})};
}
const sameActor = (a,b)=>Boolean(a&&b&&a.system===b.system&&a.agent===b.agent&&
  (a.generation===undefined||b.generation===undefined||a.generation===b.generation));

function actor(ctx,question) {
  const {W,frame,query,key,row,definition} = ctx, {role,actor:expected,spec} = question;
  const authoredRole = role&&definition.roles?.[role];
  W.data.check(!role||W.data.own(definition.roles,role),'Unknown story role '+role);
  const binding = role&&frame.storyRoles?.[key]?.[role], assignment = W.storyHandoffs.assignment(row);
  const selected = actorHandle(W,role?binding?.value:assignment);
  const focus = expected??selected;
  const casting = spec===undefined?undefined:W.storyCasting.cast(spec,query,frame,focus);
  const commitment = row?.commitment;
  const handoff = row?.handoffs?.last, acceptedHandoff = row?.handoffs?.transfers.at(-1);
  const matches = expected===undefined?Boolean(binding||assignment):sameActor(expected,selected);
  let result;
  if (matches) {
    const provenance = role?binding.source==='reference'?'reference-binding':'world-binding':
      acceptedHandoff?'accepted-handoff':'accepted-commitment';
    result = verdict('selected',provenance,role?'The role uses the resolved binding.':'The actor has the recorded story assignment.');
  } else if (selected) result = verdict('different-actor','other-actor-assigned','The recorded assignment identifies another actor.');
  else if (role&&binding) result = verdict('unknown','binding-handle-unavailable','The role is bound to a value without a roster handle.');
  else if (commitment&&!role) {
    result = verdict(commitment.decision==='refused'?'refused':'waiting','commitment-'+commitment.decision,
      'The commitment report explains the current response.');
  }
  else result = verdict('unassigned',role?'unbound-role':'no-recorded-assignment','This snapshot has no selected actor for the requested scope.');
  const assessment = casting&&{basis:'current-snapshot',...casting,...(focus&&{status:casting.focused?
    casting.focused.qualifies?'qualified':'rejected':'outside-rosters-or-unavailable'})};
  const proposed = frame.storyCommitmentDefinitions?.[key];
  return {...result,actor:{...(role&&{role,schema:authoredRole,binding:binding??null}),selected:selected??null,
    ...(expected&&{requested:expected}),assignment:assignment??null,
    ...(proposed&&{proposal:proposed}),...(commitment&&{commitment}),...(handoff&&{handoff}),
    ...(acceptedHandoff&&{acceptedHandoff}),...(assessment&&{casting:assessment})}};
}

function pendingEvidence(ctx,visit,objectives) {
  const {W,query,storyDocument} = ctx, pending = {};
  for (const id of sorted(objectives)) {
    if (W.data.own(visit.objectives,id)) continue;
    const rule = Story.objectiveRule(objectives[id],storyDocument.objectiveTypes??{});
    if (rule?.event) pending[id] = {event:rule.event};
    if (!rule?.state) continue;
    const {field,at,args,select,when} = rule.state, sample = query.probe(field,at,args);
    const value = sample.status==='ok'&&select!==undefined?W.data.read(sample.value,W.data.selector(select)):sample.value;
    if (sample.status==='ok'&&value===undefined) {
      pending[id] = {field,basis:'published-state',status:'unavailable',reason:'selected-value-missing'};
      continue;
    }
    const projected = value===undefined?undefined:JSON.stringify(value);
    pending[id] = {field,basis:'published-state',status:sample.status,
      ...(sample.reason&&{reason:sample.reason}),...(sample.status==='ok'&&{matches:W.query.condition(when,value)}),
      ...(projected!==undefined&&(projected.length<=16384?{value}:{valueOmitted:true}))};
  }
  return pending;
}

function stage(ctx,requested) {
  const {W,frame,query,key,document,definition,row,trigger,source} = ctx;
  const current = row?.flow?.current, latest = row?.flow?.route.at(-1);
  const focus = requested??current?.stage??latest?.stage??definition.entry;
  W.data.check(W.data.own(definition.stages,focus),'Unknown story stage '+focus);
  const lastVisit = row?.flow?.route.findLast(visit=>visit.stage===focus);
  const visit = current?.stage===focus?current:undefined;
  const choices = choiceValue(W,frame,query,key,document,definition,row,visit);
  const children = visit&&W.storyChildren.inspect(definition.stages[focus],child=>frame.storyLifecycle[document+'/'+child]);
  const lifecycle = stageValue(definition,row,current,trigger?.start,children);
  const blockers = blockersValue(W,frame,query,key,row,choices);
  const objectiveRules = definition.stages[focus].objectives;
  const evidence = evidenceValue(source,trigger?.start,visit,lastVisit??(visit?latest:undefined));
  const awaitingEntry = !row||row.transitions.at(-1).to==='available';
  const entryGate = awaitingEntry&&focus===definition.entry?offer(ctx):undefined;
  let result;
  if (closed.has(lifecycle.status)&&visit)
    result = verdict('closed',lifecycle.reason,'The lifecycle closed while this visit was current.');
  else if (!visit&&lastVisit) result = verdict('advanced',lastVisit.reason,'The retained visit left through '+lastVisit.branch+'.');
  else if (lifecycle.status==='suspended'&&visit) result = verdict('blocked',lifecycle.reason,'The current stage is suspended.');
  else if (visit) {
    if (choices.branches.every(branch=>!branch.eligible))
      result = verdict('blocked','branch-requirements-pending','Every outgoing branch has a pending requirement.');
    else if (blockers.some(item=>item.kind==='settlement'&&item.phase==='outcome'&&
      choices.branches.some(branch=>branch.target.outcome===item.outcome)))
      result = verdict('blocked','settlement-blocked','Ending settlement reported a blocker.');
    else if (choices.mode==='intervene'&&['waiting','open'].includes(choices.status))
      result = verdict('waiting','intervention-window-'+choices.status,'The stage is governed by its intervention window.');
    else if (choices.mode==='beat')
      result = verdict('waiting','escalation-beat','The stage is waiting on its timed beat or an eligible player branch.');
    else if (choices.branches.some(branch=>branch.automatic&&branch.eligible))
      result = verdict('waiting','automatic-branch-pending','An eligible automatic branch awaits runtime progression.');
    else result = verdict('waiting','awaiting-player-choice','An eligible branch is waiting for a choice command.');
  } else if (lifecycle.stage===focus&&!definition.lifecycle?.progression)
    result = verdict('entered','lifecycle-entry','This story exposes its entry through the lifecycle.');
  else if (row?.flow?.dropped)
    result = verdict('unknown','stage-visit-not-retained','Some earlier stage visits have been evicted.');
  else result = verdict('absent','stage-not-reached','The recorded route has yet to reach this stage.');
  return {...result,stage:{id:focus,title:definition.stages[focus].title,lifecycle,visit:visit?.visit??lastVisit?.visit??null,
    ...(lastVisit&&{lastVisit}),evidence,blockers,choices,...(objectiveRules&&{objectives:objectiveRules}),
    ...(visit&&lifecycle.status==='active'&&{pendingEvidence:pendingEvidence(ctx,visit,objectiveRules)}),
    ...(entryGate&&{entryGate})}};
}

function routesTo(definition,outcome) {
  const reachable = new Set(), predecessors = new Map(sorted(definition.stages).map(id=>[id,[]]));
  for (const [id,stage] of Object.entries(definition.stages)) for (const branch of Object.values(stage.next)) {
    if (branch.outcome===outcome) reachable.add(id);
    if (branch.stage!==undefined) predecessors.get(branch.stage).push(id);
  }
  for (const id of reachable) for (const before of predecessors.get(id)) reachable.add(before);
  return {reachable,leads:branch=>branch.outcome===outcome||reachable.has(branch.stage)};
}

function outcome(ctx,expected) {
  const {W,definition,row} = ctx;
  W.data.check(W.data.own(definition.outcomes,expected),'Unknown story outcome '+expected);
  const terminal = row?.transitions.at(-1), history = row?.flow?.route??[];
  const {reachable,leads} = routesTo(definition,expected);
  const alternate = id=>sorted(definition.stages[id].next).flatMap(branch=>{
    const rule = definition.stages[id].next[branch];
    return leads(rule)?[{branch,...rule}]:[];
  });
  const divergence = history.find(visit=>reachable.has(visit.stage)&&!leads(visit.target));
  const current = row?.flow?.current;
  const currentReport = current&&stage(ctx,current.stage);
  const currentPaths = current?alternate(current.stage).map(path=>({...path,
    gate:currentReport.stage.choices?.branches.find(branch=>branch.id===path.branch)})):[];
  const status = terminal?.to;
  let result;
  if (terminal?.outcome===expected) result = verdict('reached',terminal.reason,'The lifecycle recorded the requested ending.');
  else if (terminal?.outcome!==undefined)
    result = verdict('different-ending','alternate-outcome','The story resolved as '+terminal.outcome+'.');
  else if (closed.has(status)) result = verdict('closed',terminal.reason,'The story closed as '+status+'.');
  else if (current&&!reachable.has(current.stage))
    result = verdict('unreachable','outcome-unreachable-from-current-stage','The current stage has no authored route to this ending.');
  else if (definition.lifecycle?.progression&&!reachable.has(definition.entry))
    result = verdict('unreachable','outcome-unreachable-from-entry','The entry stage has no authored route to this ending.');
  else if (row?.settlements?.blocked?.outcome===expected)
    result = verdict('blocked','settlement-blocked','The ending is waiting on settlement.');
  else if (currentPaths.length&&currentPaths.every(path=>path.gate?.eligible===false))
    result = verdict('blocked','ending-branch-requirements-pending','Every current branch toward the ending has a pending requirement.');
  else if (currentReport?.stage.lifecycle.status==='suspended')
    result = verdict('blocked',currentReport.reason,currentReport.message);
  else result = verdict('pending','outcome-pending','The ending is still pending at this tick.');
  const closingVisit = history.at(-1);
  return {...result,outcome:{requested:expected,actual:terminal?.outcome??null,lifecycle:status??'waiting',
    ...(closed.has(status)&&{terminal}),...(closingVisit?.target.outcome!==undefined&&{closingVisit}),
    ...(divergence&&{divergence:{visit:divergence,alternatives:alternate(divergence.stage)}}),
    ...(currentReport&&{current:currentReport.stage,possibleBranches:currentPaths}),
    ...(row?.settlements&&{settlements:row.settlements}),...(row?.consequences&&{consequences:row.consequences}),
    ...(row?.flow?.dropped&&{earlierVisitsEvicted:row.flow.dropped})}};
}

const topicKinds = {
  offer:/^story-(transition|started|start-rejected|candidate-.+)$/,
  actor:/^story-(commitment-decision|handoff-.+)$/,
  stage:/^story-(stage-entered|objective-resolved|progress-rejected|branch-chosen|decision-.+|beat-.+)$/,
  outcome:/^story-(transition|branch-chosen|settlement.*|consequences)$/
};
function eventEvidence(ctx,question,result) {
  const {frame,query,document,id,recent,source} = ctx;
  const byId = new Map([...frame.history,...recent].map(event=>[event.id,event]));
  const direct = new Set(source?.evidence?.events??[]);
  const visits = [result.stage?.lastVisit,result.stage?.evidence.current,result.outcome?.closingVisit,
    result.outcome?.divergence?.visit,result.outcome?.current?.evidence.current];
  for (const visit of visits) for (const objective of Object.values(visit?.objectives??{}))
    if (objective.receipt?.event?.id) direct.add(objective.receipt.event.id);
  const related = [...byId.values()].filter(event=>direct.has(event.id)||
    event.document===document&&event.story===id&&topicKinds[question.topic].test(event.kind)&&
    (question.topic!=='stage'||event.stage===result.stage.id));
  const limit = 24, events = related.slice(-limit);
  const missing = [...direct].filter(event=>!byId.has(event)), omitted = Math.max(0,related.length-limit);
  const causes = question.trace?[...new Set([...direct,...events.slice(-4).map(event=>event.id)])].slice(0,8)
    .map(event=>({event,...query.trace('world/cause',undefined,{event,maxDepth:8,limit:48})})) : undefined;
  return {history:frame.world.history?.enabled===false?'disabled':'retained',dropped:frame.dropped,
    events,missing,omitted,...(causes&&{causes})};
}

function explain(W,run,question) {
  const frame = run.view(), query = run.query(), {story:key,document,id,topic} = question;
  const storyDocument = (frame.storyDocuments??frame.world.storyDocuments??[]).find(row=>row.id===document);
  W.data.check(W.data.own(storyDocument?.stories,id),'Unknown story '+key);
  const definition = storyDocument.stories[id], row = frame.storyLifecycle?.[key], trigger = frame.storyTriggers?.[key];
  const source = row?.source??frame.storyFeasibility?.[key]?.request.source??frame.incidentCandidates?.[key]?.source;
  const ctx = {W,frame,query,key,document,id,storyDocument,definition,row,trigger,source,recent:run.events};
  const result = topic==='offer'?offer(ctx):topic==='actor'?actor(ctx,question):
    topic==='stage'?stage(ctx,question.stage):outcome(ctx,question.outcome);
  const {mode,role,actor:target,stage:stageId,outcome:outcomeId} = question;
  return {format:'ink-studio/story-explanation',version:1,world:frame.world.id,seed:frame.world.seed,tick:frame.tick,
    story:key,title:definition.title,question:{mode,topic,role,actor:target,stage:stageId,outcome:outcomeId},
    ...result,evidence:eventEvidence(ctx,question,result)};
}

module.exports = {usage,request,explain};
