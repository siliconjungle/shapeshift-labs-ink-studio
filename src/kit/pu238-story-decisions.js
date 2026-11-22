/* Stage-local player decisions and timed chances to replace an automatic branch. */
(function(K) {
  const W = K.world, {equal,own,record} = W.data, Q = W.query;

  function compile(stages,dt) {
    return Object.fromEntries(Object.entries(stages??{}).flatMap(([stage,{decision}])=>{
      if (!decision) return [];
      const {mode,for:seconds} = decision;
      return [[stage,mode==='intervene'?{mode,seconds,windowTicks:Math.max(1,
        W.storyTriggers.ticks(seconds,dt,Math.ceil,'Story intervention duration exceeds the world tick budget'))}:{mode}]];
    }));
  }

  function advance(policy,current,tick,ready) {
    const window = current.intervention;
    if (!window) return ready()?{window:{openedAt:tick,elapsedTicks:0},event:'story-decision-opened'}:null;
    if (window.closedAt!==undefined) return null;
    const elapsedTicks = window.elapsedTicks+1, closed = elapsedTicks===policy.windowTicks;
    return {window:{...window,elapsedTicks,...(closed&&{closedAt:tick})},
      ...(closed&&{event:'story-decision-elapsed'})};
  }

  function playerBlocker(policy,window) {
    if (policy?.mode==='autonomous') return 'autonomous-stage';
    if (policy?.mode!=='intervene') return undefined;
    if (!window) return 'intervention-window-pending';
    return window.closedAt===undefined?undefined:'intervention-window-closed';
  }

  function proof(policy,by) {
    return policy?{mode:policy.mode,by}:undefined;
  }

  function valid(policy,row,tick,closedVisit) {
    const {intervention:window,decision} = row;
    if (!policy) return !own(row,'intervention')&&!own(row,'decision');
    const {mode,windowTicks} = policy;
    if (own(row,'intervention')) {
      if (mode!=='intervene'||!record(window)) return false;
      const {openedAt,elapsedTicks,closedAt} = window;
      if (!Number.isSafeInteger(openedAt)||openedAt<=row.enteredAt||openedAt>tick||
          !Number.isSafeInteger(elapsedTicks)||elapsedTicks<0||elapsedTicks>windowTicks||elapsedTicks>tick-openedAt) return false;
      if (elapsedTicks===windowTicks) {
        if (!Number.isSafeInteger(closedAt)||closedAt<openedAt+elapsedTicks||closedAt>tick) return false;
      } else if (closedAt!==undefined) return false;
      if (!equal(window,{openedAt,elapsedTicks,...(closedAt!==undefined&&{closedAt})})) return false;
    }
    if (!closedVisit) return !own(row,'decision');
    const by = mode==='autonomous'?'autonomous':mode==='intervene'&&window?.closedAt!==undefined?'fallback':'player';
    return (mode!=='intervene'||Boolean(window))&&equal(decision,{mode,by})&&
      (by==='player'||(by==='fallback'?row.reason==='intervention-window-elapsed':row.reason==='automatic-branch-ready'));
  }

  function describeWindow(policy,window) {
    return {...window,windowTicks:policy.windowTicks,remainingTicks:policy.windowTicks-window.elapsedTicks};
  }

  function inspect(definitions,state,documents,{story}) {
    const docs = new Map(documents?.map(document=>[document.id,document.stories]));
    function inspectStory(key,policies) {
      const row = state?.[key], [document,id] = key.split('/');
      const lifecycle = row?.transitions.at(-1).to??null, current = row?.flow?.current;
      const last = row?.flow?.route.findLast(visit=>visit.decision);
      const report = {lifecycle,stages:policies,...(last&&{last:{stage:last.stage,visit:last.visit,tick:last.leftAt,
        branch:last.branch,decision:last.decision,...(last.intervention&&{intervention:last.intervention})}})};
      if (!own(policies,current?.stage)) return report;
      const policy = policies[current.stage], stage = docs.get(document)[id].stages[current.stage];
      const {intervention:window} = current, active = lifecycle==='active';
      const blocker = playerBlocker(policy,window);
      const readChild = id=>state[document+'/'+id];
      const branches = Object.keys(stage.next).sort().map(id=>{
        const branch = stage.next[id];
        const {children,...gate} = W.storyStages.eligibility(stage,branch,current.objectives,readChild);
        return {id,target:W.storyStages.targetOf(branch),automatic:branch.auto===true,
          eligible:!gate.rejected,selectable:active&&!blocker&&!gate.rejected,...gate};
      });
      const choices = Object.fromEntries(Object.keys(stage.objectives??{}).sort().flatMap(id=>{
        const objective = stage.objectives[id];
        if (objective.type!=='choose'||own(current.objectives,id)) return [];
        return [[id,{title:objective.title,options:objective.params.options,selectable:active&&!blocker}]];
      }));
      const status = lifecycle==='suspended'?'suspended':!active?'closed':policy.mode!=='intervene'?policy.mode:
        !window?'waiting':window.closedAt===undefined?'open':'elapsed';
      return {...report,current:{stage:current.stage,visit:current.visit,mode:policy.mode,status,branches,choices,
        ...(window&&{window:describeWindow(policy,window)})}};
    }
    if (story!==undefined) return own(definitions,story)?Q.ok(inspectStory(story,definitions[story])):
      Q.missing('Unknown story decision '+story,'missing');
    return Q.ok(Object.fromEntries(Object.entries(definitions??{}).map(([key,policies])=>[key,inspectStory(key,policies)])));
  }

  W.storyDecisions = Object.freeze({compile,advance,playerBlocker,proof,valid,describeWindow,inspect});
})(KIT);
