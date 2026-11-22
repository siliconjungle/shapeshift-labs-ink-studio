/* Format the static preview without evaluating any world condition. */
const oneLine = value=>String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,' ');
const textLines = lines=>lines.map(oneLine);
const escapeDot = value=>oneLine(value).replace(/[\\"]/g,char=>'\\'+char);
const quote = value=>'"'+escapeDot(value)+'"';
const dotLabel = lines=>'label="'+lines.map(escapeDot).join('\\n')+'"';
const nodeId = (story,kind,id)=>quote(story+'/'+kind+'/'+id);
const ordered = table=>Object.keys(table??{}).sort();

function stageDetails(stage) {
  const details = [];
  if (stage.children?.open) details.push('Opens '+stage.children.open.join(', '));
  const wait = stage.children?.wait;
  if (wait) {
    const mode = wait.all?'all':'any';
    details.push('Wait for '+mode+' to finish ('+wait[mode].join(', ')+')');
  }
  const {decision,beat} = stage;
  if (decision) details.push('Decision mode '+decision.mode+(decision.mode==='intervene'?' for '+decision.for+' s':''));
  if (beat) details.push('Beat '+beat.kind+' runs for '+beat.for+' s');
  return details;
}

function branchDetails(stage, branch) {
  const details = [], beat = stage.beat;
  if (beat?.otherwise===branch.id) details.push('Timeout after '+beat.for+' s');
  else if (beat?.resolve?.includes(branch.id)) details.push('Resolve before '+beat.for+' s');
  else if (branch.auto) details.push(stage.decision?.mode==='intervene'?'Automatic fallback':'Automatic');
  const failed = new Set(branch.requiresFailed), choices = branch.requiresChoice??{};
  const complete = new Set([...(stage.objectives??[]).filter(row=>!row.optional).map(row=>row.id),...(branch.requires??[])]);
  for (const id of [...complete].sort()) if (!failed.has(id)&&!Object.hasOwn(choices,id)) details.push('Complete '+id);
  for (const id of [...failed].sort()) details.push('Fail '+id);
  for (const id of ordered(choices)) details.push('Choose '+id+' = '+choices[id]);
  for (const id of ordered(branch.requiresChildren)) {
    const {status,outcome} = branch.requiresChildren[id];
    const condition = [status,outcome!==undefined?'ending '+outcome:undefined].filter(value=>value!==undefined);
    details.push('Child '+id+' → '+condition.join(', '));
  }
  return details;
}

function transition(story, stage, branch, stageIds, endingIds, progression) {
  const targets = [Object.hasOwn(branch,'stage')&&{kind:'stage',id:branch.stage,known:stageIds.has(branch.stage)},
    Object.hasOwn(branch,'outcome')&&{kind:'ending',id:branch.outcome,known:endingIds.has(branch.outcome)}].filter(Boolean);
  const target = targets.length===1&&targets[0].known?targets[0]:null;
  const destination = targets.map(row=>row.kind+' '+row.id).join(' / ');
  const invalid = targets.length===0?'Missing target':targets.length===2?'Ambiguous targets ('+destination+')':
    !target?'Unknown '+destination:null;
  const state = invalid?'invalid target':branch.possible?'possible':stage.reachable?'blocked':'unreachable source';
  return {node:target?nodeId(story.id,target.kind,target.id):nodeId(story.id,'invalid',stage.id+'/'+branch.id),
    destination,invalid,state,details:progression?branchDetails(stage,branch):[]};
}

function describe(report, document) {
  const stories = report.stories.map(story=>{
    const stageIds = new Set(story.stages.map(row=>row.id)), endingIds = new Set(story.outcomes.map(row=>row.id));
    const lifecycle = document.stories[story.id].lifecycle;
    const deadlines = lifecycle?.deadlines;
    const limits = [];
    if (deadlines?.world) limits.push('World deadline '+deadlines.world.at+' s');
    if (deadlines?.work) limits.push('Active work limit '+deadlines.work.for+' s');
    const offer = deadlines?.offer?.for??lifecycle?.offerFor;
    if (offer!==undefined) limits.push('Offer window '+offer+' s');
    const stages = story.stages.map(stage=>({...stage,details:stageDetails(stage),
      branches:stage.branches.map(branch=>({...branch,...transition(story,stage,branch,stageIds,endingIds,lifecycle?.progression)}))}));
    const hasEntry = stageIds.has(story.entry);
    if (hasEntry) stages.unshift(...stages.splice(stages.findIndex(stage=>stage.id===story.entry),1));
    return {...story,stages,limits,hasEntry};
  });
  return {title:'Story routes for '+(report.documentId??'invalid document'),
    note:'Static preview. World conditions and decisions are evaluated at runtime.',stories,diagnostics:report.diagnostics,
    valid:report.valid};
}

function diagnostic({severity,code,path,message}) {
  return severity.toUpperCase()+' ['+code+'] '+path+' — '+message;
}

function text(view) {
  const lines = [view.title,view.note,...(!view.valid?['Document has validation errors.']:[])];
  for (const story of view.stories) {
    lines.push('',story.id+' ['+story.kind+'] — '+story.title,
      '  Entry '+story.entry+(story.hasEntry?'':' [missing stage]'),...story.limits.map(row=>'  '+row),'  Stages');
    for (const stage of story.stages) {
      const state = !stage.reachable?'unreachable':stage.canReachOutcome?'reachable':'no path to an ending';
      lines.push('    '+stage.id+' ['+state+'] — '+stage.title);
      lines.push(...stage.details.map(row=>'      '+row));
      for (const objective of stage.objectives??[]) lines.push('      Objective '+objective.id+' ['+
        (objective.optional?'optional':'required')+(objective.type?', '+objective.type:'')+'] — '+objective.title);
      for (const branch of stage.branches) {
        lines.push('      '+branch.id+' → '+(branch.destination||'(missing target)')+' ['+branch.state+']');
        lines.push(...branch.details.map(row=>'        '+row));
      }
    }
    lines.push('  Endings');
    for (const ending of story.outcomes)
      lines.push('    '+ending.id+' ['+ending.status+', '+(ending.reachable?'reachable':'unreachable')+'] — '+ending.title);
    lines.push('  Shortest sample routes');
    if (!story.routes.length) lines.push('    No ending reachable from the entry.');
    for (const route of story.routes) {
      const steps = route.path.map(({stage,branch})=>stage+'/'+branch);
      if (route.stepsOmitted) steps.push('… '+route.stepsOmitted+' steps omitted');
      lines.push('    '+steps.join(' → ')+' → '+route.outcome+' ('+route.steps+(route.steps===1?' step)':' steps)'));
    }
    if (story.routesOmitted) lines.push('    '+story.routesOmitted+' ending routes omitted.');
  }
  if (view.diagnostics.length) lines.push('','Diagnostics',...view.diagnostics.map(row=>'  '+diagnostic(row)));
  return textLines([...lines,'']).join('\n');
}

function dot(view) {
  const lines = ['digraph story_routes {',
    '  graph [rankdir=LR, labelloc=t, '+dotLabel([view.title,view.note,...(!view.valid?['Document has validation errors.']:[])])+'];',
    '  node [shape=box];'];
  for (const story of view.stories) {
    lines.push('  subgraph '+quote('cluster/'+story.id)+' {',
      '    '+dotLabel([story.id+' ['+story.kind+'] — '+story.title,...story.limits])+';');
    const entry = nodeId(story.id,'entry','start'), start = nodeId(story.id,'stage',story.entry);
    lines.push('    '+entry+' [shape=plaintext, '+dotLabel(['Entry'])+'];');
    if (!story.hasEntry) lines.push('    '+start+' [shape=octagon, color=firebrick, '+dotLabel(['Missing stage '+story.entry])+'];');
    lines.push('    '+entry+' -> '+start+';');
    for (const stage of story.stages) {
      const from = nodeId(story.id,'stage',stage.id);
      const state = !stage.reachable?'Unreachable':stage.canReachOutcome?null:'No path to an ending';
      lines.push('    '+from+' ['+dotLabel([stage.id+' — '+stage.title,...(state?[state]:[]),...stage.details])+
        (stage.reachable?'':', style=dashed')+'];');
      for (const branch of stage.branches) {
        if (branch.invalid)
          lines.push('    '+branch.node+' [shape=octagon, color=firebrick, '+dotLabel([branch.invalid])+'];');
        const details = [branch.id,...branch.details,...(branch.state==='possible'?[]:[branch.state])];
        lines.push('    '+from+' -> '+branch.node+' ['+dotLabel(details)+
          (branch.state==='possible'?'':', style=dashed, color='+(branch.invalid?'firebrick':'gray50'))+'];');
      }
    }
    for (const ending of story.outcomes)
      lines.push('    '+nodeId(story.id,'ending',ending.id)+' [shape=doubleoctagon, '+dotLabel([
        ending.id+' — '+ending.title,ending.status+(ending.reachable?'':' · unreachable')])+
        (ending.reachable?'':', style=dashed')+'];');
    lines.push('  }');
  }
  if (view.diagnostics.length) lines.push('  diagnostics [shape=note, '+
    dotLabel(['Diagnostics',...view.diagnostics.map(diagnostic)])+'];');
  return [...lines,'}',''].join('\n');
}

function formatStoryRoutes(report, document, format) {
  const view = describe(report,document);
  return format==='dot'?dot(view):text(view);
}

module.exports = {formatStoryRoutes};
