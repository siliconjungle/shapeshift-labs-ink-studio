const Story = require('../src/story-document.js');

const enabled = options=>['start-story','until-stage','until-outcome','until-condition'].some(key=>options[key]!==undefined);

function create(W,run,options,read) {
  const {own,record,vector} = W.data;
  const initial = run.view(), documents = initial.storyDocuments??initial.world.storyDocuments??[];
  function check(ok,message) {
    if (!ok) throw new TypeError(message);
  }
  function storyTarget(option,part) {
    const input = options[option];
    if (input===undefined) return;
    const ids = typeof input==='string'?input.split('/'):[];
    check(ids.length===(part?3:2)&&ids.every(Story.isStoryId),
      '--'+option+' needs document/story'+(part?'/'+part:''));
    const [document,story,id] = ids, key = document+'/'+story;
    const table = documents.find(row=>row.id===document)?.stories;
    const definition = own(table,story)?table[story]:undefined;
    check(definition?.lifecycle,'Unknown story with lifecycle '+key);
    if (part==='stage') check(own(definition.stages,id)&&(definition.lifecycle.progression||id===definition.entry),
      'Unknown runnable stage '+input);
    if (part==='outcome') check(own(definition.outcomes,id),'Unknown story outcome '+input);
    return {document,story,key,id};
  }
  const launch = storyTarget('start-story'), stage = storyTarget('until-stage','stage'), outcome = storyTarget('until-outcome','outcome');
  const condition = options['until-condition']===undefined?undefined:readCondition(options['until-condition']);
  function readCondition(file) {
    check(typeof file==='string'&&file.trim(),'--until-condition needs a JSON condition file');
    const rule = read(file);
    check(record(rule)&&Object.keys(rule).every(key=>['field','at','args','when'].includes(key))&&
      typeof rule.field==='string'&&record(rule.when)&&(rule.args===undefined||record(rule.args)),
    'Stop condition needs field, when, and optional at and args');
    if (rule.at!==undefined) {
      const at = rule.at, keys = record(at)?Object.keys(at):[];
      check(keys.length===1&&vector(at.point)||keys.length>0&&keys.every(key=>key==='entity'||key==='socket')&&
        typeof at.entity==='string'&&(at.socket===undefined||typeof at.socket==='string'),'Invalid stop condition target');
    }
    check(run.query().field(rule.field),'Unknown stop condition field '+rule.field);
    W.query.condition(rule.when,undefined);
    return rule;
  }
  const hasStops = Boolean(stage||outcome||condition), requestTick = initial.tick+1;
  function schedule() {
    if (!launch) return;
    const {document,story} = launch;
    run.schedule([{tick:requestTick,action:'world/story-start',args:{document,story,reason:'cli-story-start'}}]);
  }
  function matchStage(frame,{key,id}) {
    const row = frame.storyLifecycle?.[key], now = frame.tick;
    if (!row) return;
    const {flow,transitions} = row, last = transitions.at(-1);
    const visit = flow?.current?.stage===id?flow.current:
      flow?.route.findLast(item=>item.stage===id&&item.enteredAt===now);
    if (visit) return {kind:'stage',story:key,stage:id,visit:visit.visit,enteredAt:visit.enteredAt};
    if (flow) return;
    const activation = transitions.find(change=>change.from==='available'&&change.to==='active');
    if (activation&&(last.to==='active'||last.to==='suspended'||activation.tick===now))
      return {kind:'stage',story:key,stage:id,enteredAt:activation.tick};
  }
  function preparedAdvance(limit,stopOnOutcome) {
    let matches = [], observed, rejected;
    function until(frame,query) {
      if (launch&&frame.tick===requestTick) rejected = run.events.find(event=>
        event.kind==='story-start-rejected'&&event.system==='world'&&event.document===launch.document&&event.story===launch.story);
      const foundStage = stage&&matchStage(frame,stage);
      const ending = outcome&&frame.storyLifecycle?.[outcome.key]?.transitions.at(-1);
      const foundOutcome = ending&&ending.outcome===outcome.id
        ? {kind:'outcome',story:outcome.key,outcome:ending.outcome,status:ending.to,resolvedAt:ending.tick} : undefined;
      observed = condition&&query.probe(condition.field,condition.at,condition.args);
      const foundCondition = observed?.status==='ok'&&W.query.condition(condition.when,observed.value)
        ? {kind:'condition',field:condition.field,value:observed.value} : undefined;
      matches = [foundStage,foundOutcome,foundCondition].filter(Boolean);
      return matches.length>0;
    }
    function report(frame) {
      const {tick} = frame, lifecycle = launch&&frame.storyLifecycle?.[launch.key]?.transitions.at(-1);
      return {stop:{reason:matches.length?'matched':stopOnOutcome&&run.scenario.status!=='running'?'scenario-outcome':'tick-limit',
        from:initial.tick,limit,tick,matches,...(observed&&{lastCondition:observed.status})},
      ...(launch&&{launch:{story:launch.key,requestedAt:requestTick,
        status:tick<requestTick?'scheduled':rejected?'rejected':lifecycle?.to??'waiting',
        ...(rejected&&{reason:rejected.reason})}}),
      unmet:hasStops&&!matches.length||Boolean(rejected)};
    }
    return {until,report};
  }
  function advance(limit,stopOnOutcome) {
    const {until,report} = preparedAdvance(limit,stopOnOutcome);
    return report(run.advance(limit,{until,stopOnOutcome}));
  }
  async function advanceAsync(limit,stopOnOutcome,onTick) {
    const {until,report} = preparedAdvance(limit,stopOnOutcome);
    return report(await run.advanceAsync(limit,{until,stopOnOutcome,onTick}));
  }
  return {hasStops,schedule,advance,advanceAsync};
}

module.exports = {enabled,create};
