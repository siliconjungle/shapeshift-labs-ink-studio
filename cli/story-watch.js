const fs = require('node:fs');
const path = require('node:path');
const Story = require('../src/story-document.js');

const values = ['stage','evidence','roles','blockers','choices','changes'];
const enabled = opt=>['watch-story','watch-values','watch-out'].some(key=>opt[key]!==undefined);
const usage = '--watch-story document/story[,document/story...]|all [--watch-values '+values.join(',')+'] [--watch-out file.ndjson]';

function check(condition,message) {
  if (!condition) throw new TypeError(message);
}

function settings(frame,opt,sources) {
  const {world} = frame, documents = frame.storyDocuments??world.storyDocuments??[];
  const authored = new Map(documents.flatMap(document=>Object.entries(document.stories).map(([id,definition])=>
    [document.id+'/'+id,{document:document.id,definition}])));
  const select = opt['watch-story'], channels = opt['watch-values'], out = opt['watch-out'];
  check(typeof select==='string'&&(channels===undefined||typeof channels==='string')&&
    (out===undefined||typeof out==='string'&&out.trim()),'Use '+usage);
  const stories = select==='all'?[...authored.keys()].sort():select.split(',').map(id=>id.trim());
  const watched = channels===undefined?values:channels.split(',').map(channel=>channel.trim());
  check(stories.length>0&&new Set(stories).size===stories.length&&stories.every(id=>{
    const parts = id.split('/');
    return parts.length===2&&parts.every(Story.isStoryId)&&authored.has(id);
  }),'Story watch needs distinct authored document/story IDs');
  check(new Set(watched).size===watched.length&&watched.every(channel=>values.includes(channel)),
    'Story watch values must be distinct names from '+values.join(', '));
  if (out!==undefined) {
    const destination = path.resolve(out), existing = fs.existsSync(destination)?fs.statSync(destination):null;
    for (const source of sources.filter(file=>typeof file==='string')) {
      const input = path.resolve(source), stat = existing&&fs.existsSync(input)?fs.statSync(input):null;
      check(destination!==input&&(!stat||existing.dev!==stat.dev||existing.ino!==stat.ino),
        'Use a separate path for the story watch stream');
    }
  }
  return {stories,watched,authored,out};
}

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

async function open(W,frame,opt,mode,sources) {
  const {stories,watched,authored,out} = settings(frame,opt,sources);
  const previous = new Map(), wants = new Set(watched), {world} = frame;
  const writeReportsError = ()=>{};
  let file;
  if (out!==undefined) {
    const destination = path.resolve(out);
    await fs.promises.mkdir(path.dirname(destination),{recursive:true});
    file = await fs.promises.open(destination,'w');
  } else process.stdout.on('error',writeReportsError);
  async function write(record) {
    const line = JSON.stringify(record)+'\n';
    if (file) await file.writeFile(line);
    else await new Promise((resolve,reject)=>process.stdout.write(line,error=>error?reject(error):resolve()));
  }
  async function sample(frame,query,events=[]) {
    const byStory = new Map();
    if (wants.has('changes')||wants.has('evidence')) for (const event of events) {
      const id = event.document+'/'+event.story;
      if (!authored.has(id)||!event.kind.startsWith('story-')) continue;
      if (!byStory.has(id)) byStory.set(id,[]);
      byStory.get(id).push(event);
    }
    for (const id of stories) {
      const {document,definition} = authored.get(id), row = frame.storyLifecycle?.[id], current = row?.flow?.current;
      const trigger = frame.storyTriggers?.[id]?.start, last = row?.flow?.route.at(-1);
      const source = row?.source??frame.storyFeasibility?.[id]?.request.source??frame.incidentCandidates?.[id]?.source;
      const decision = wants.has('choices')||wants.has('blockers')
        ? choiceValue(W,frame,query,id,document,definition,row,current) : undefined;
      const children = wants.has('stage')&&current&&W.storyChildren.inspect(definition.stages[current.stage],
        child=>frame.storyLifecycle[document+'/'+child]);
      const readers = {
        stage:()=>stageValue(definition,row,current,trigger,children),
        evidence:()=>evidenceValue(source,trigger,current,last),
        roles:()=>frame.storyRoles?.[id]??{},
        blockers:()=>blockersValue(W,frame,query,id,row,decision),
        choices:()=>decision
      };
      const before = previous.get(id), next = {}, delta = {};
      const changes = byStory.get(id)??[];
      for (const channel of watched) {
        if (channel==='changes') {
          if (!before||changes.length) delta.changes = changes;
          continue;
        }
        const value = next[channel] = readers[channel]();
        if (!before||!W.data.equal(before[channel],value)) delta[channel] = value;
      }
      if (wants.has('evidence')) {
        const receipts = changes.filter(event=>event.kind==='story-objective-resolved'||
          event.kind==='story-started'&&event.evidence!==undefined);
        if (receipts.length) delta.evidence = {...next.evidence,receipts};
      }
      previous.set(id,next);
      if (Object.keys(delta).length) await write({type:'story-watch',tick:frame.tick,time:frame.time,story:id,values:delta});
    }
  }
  return {sample,begin:()=>write({type:'story-watch-start',format:'ink-studio/story-watch',version:1,mode,
    world:world.id,seed:world.seed,tick:frame.tick,stories,values:watched}),
  end:summary=>write({type:'story-watch-end',tick:summary.tick,summary}),
  close:()=>file?file.close():process.stdout.off('error',writeReportsError)};
}

module.exports = {enabled,open,usage};
