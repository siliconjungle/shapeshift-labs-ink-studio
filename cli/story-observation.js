function stageValue(definition,row,current,trigger,children) {
  const status = row?.transitions.at(-1).to??(definition.lifecycle?'waiting':trigger?'triggered':'authored');
  const active = ['active','suspended','triggered'].includes(status), change = row?.transitions.at(-1);
  return {status,stage:active?current?.stage??(!row?.flow?definition.entry:null):null,
    ...(active&&current&&{visit:current.visit,enteredAt:current.enteredAt}),...(active&&children&&{children}),
    ...(change&&{since:change.tick,reason:change.reason}),
    ...(change?.outcome!==undefined&&{outcome:change.outcome})};
}

function evidenceValue(source,trigger,current,last) {
  function visit(entry) {
    return entry?{stage:entry.stage,visit:entry.visit,objectives:entry.objectives,
      ...(entry.progress&&{progress:entry.progress}),...(entry.leftAt!==undefined&&{leftAt:entry.leftAt})}:null;
  }
  return {source:source??null,trigger:trigger??null,current:visit(current),previous:visit(last)};
}

function choiceValue(W,frame,query,id,document,definition,row,current) {
  if (!current) return null;
  const stage = definition.stages[current.stage], lifecycle = row.transitions.at(-1).to, active = lifecycle==='active';
  if (stage.decision) return query.probe('world/story-decisions',undefined,{story:id}).value.current;
  const beat = stage.beat&&query.probe('world/story-beats',undefined,{story:id}).value.current;
  const controlled = beat&&new Set([beat.otherwise,...beat.resolve.map(rule=>rule.branch)]);
  const choices = {};
  const branches = Object.keys(stage.next).sort().map(branch=>{
    const rule = stage.next[branch], automatic = Boolean(rule.auto||controlled?.has(branch));
    const {children,...gate} = W.storyStages.eligibility(stage,rule,current.objectives,
      child=>frame.storyLifecycle[document+'/'+child]);
    return {id:branch,target:W.storyStages.targetOf(rule),automatic,eligible:!gate.rejected,
      selectable:active&&!controlled?.has(branch)&&!gate.rejected,...gate};
  });
  for (const [name,objective] of Object.entries(stage.objectives??{}))
    if (objective.type==='choose'&&!Object.hasOwn(current.objectives,name))
      choices[name] = {title:objective.title,options:objective.params.options,selectable:active};
  return {stage:current.stage,visit:current.visit,mode:beat?'beat':'manual',
    status:active?'open':lifecycle==='suspended'?'suspended':'closed',branches,choices,...(beat&&{beat})};
}

function blockersValue(W,frame,query,id,row,decision) {
  const result = [];
  const checks = frame.storyFeasibility?.[id]?.report.checks??{};
  for (const [check,report] of Object.entries(checks))
    if (report.status!=='ready') result.push({kind:'feasibility',check,...report});
  for (const branch of decision?.branches??[]) if (branch.rejected) {
    const {id:branchId,rejected:reason,pending,pendingChildren,mismatchedChildren} = branch;
    result.push({kind:'branch',branch:branchId,reason,pending,pendingChildren,mismatchedChildren});
  }
  for (const kind of ['commitment','handoff']) {
    const report = kind==='commitment'?row?.commitment:row?.handoffs?.last;
    if (report&&['deferred','refused'].includes(report.decision))
      result.push({kind,actor:report.actor,decision:report.decision,checks:report.checks.filter(check=>check.status!=='pass')});
  }
  const settlement = row?.settlements?.blocked;
  if (settlement) result.push({kind:'settlement',phase:settlement.phase,outcome:settlement.outcome,...settlement.blocker});
  const reference = W.storyReferences.decision(frame.storyReferences?.[id]);
  if (reference) result.push({kind:'reference',...reference});
  const candidate = frame.incidentCandidates?.[id];
  if (candidate?.status==='blocked') {
    const {report,pressure,cooldown,anchor} = candidate;
    result.push({kind:'candidate',checks:report?.checks,pressure:pressure?.blocks,cooldown:cooldown?.blocks,anchor:anchor?.reason});
  }
  const assignment = W.storyHandoffs.assignment(row);
  if (assignment) {
    const {system,agent,generation,sequence} = assignment;
    const orders = query.probe(system+'/orders',undefined,{agent,generation}).value;
    const matches = order=>order?.sequence===sequence;
    const paused = orders?.paused.find(matches);
    const work = paused??[orders?.active,...(orders?.outcomes??[])].find(matches);
    const blocked = paused||['blocked','failed'].includes(work?.phase)||
      ['working','waiting'].includes(work?.phase)&&work.reason&&work.reason!=='duration';
    if (blocked) result.push({kind:'work',assignment,task:work.task,step:work.step,
      status:paused?'paused':work.phase,reason:paused?'order-paused':work.reason,
      ...(work.phase==='failed'&&work.results.at(-1)?.receipt&&{receipt:work.results.at(-1).receipt})});
  }
  return result;
}

module.exports = {stageValue,evidenceValue,choiceValue,blockersValue};
