/* Timed incident stages that can resolve through native objective evidence. */
(function(K) {
  const W = K.world, Q = W.query, {check,equal,own,record} = W.data, {freeze} = K.procedural.data;
  const reasons = {resolution:'beat-resolved-by-world',timeout:'beat-window-elapsed'};

  function compile(stages,dt) {
    return Object.fromEntries(Object.entries(stages??{}).flatMap(([stage,{beat}])=>{
      if (!beat) return [];
      const {kind,for:seconds,otherwise,resolve=[]} = beat;
      const windowTicks = Math.max(1,W.storyTriggers.ticks(seconds,dt,Math.ceil,'Story beat duration exceeds the world tick budget'));
      return [[stage,{kind,seconds,windowTicks,otherwise,resolve}]];
    }));
  }

  function initial(policy) {
    return {kind:policy.kind,elapsedTicks:0};
  }

  function controlled(policy,branch) {
    return policy&&(policy.otherwise===branch||policy.resolve.includes(branch));
  }

  function step(policy,current,eligible) {
    const elapsedTicks = Math.min(policy.windowTicks,current.beat.elapsedTicks+1);
    const beat = elapsedTicks===current.beat.elapsedTicks?current.beat:{kind:policy.kind,elapsedTicks};
    const resolution = policy.resolve.find(eligible);
    if (resolution!==undefined) return {beat,branch:resolution,by:'resolution',reason:reasons.resolution};
    if (elapsedTicks===policy.windowTicks) return {beat,branch:policy.otherwise,by:'timeout',reason:reasons.timeout};
    return {beat};
  }

  function valid(policy,row,tick,eligible) {
    if (!policy) return !own(row,'beat');
    const {beat} = row;
    if (!record(beat)) return false;
    const {elapsedTicks,by} = beat;
    if (!Number.isSafeInteger(elapsedTicks)||elapsedTicks<0||elapsedTicks>policy.windowTicks||
        elapsedTicks>tick-row.enteredAt) return false;
    const state = {kind:policy.kind,elapsedTicks};
    if (!own(row,'branch')) return equal(beat,state);
    if (!equal(beat,{...state,by})) return false;
    if (by==='player') return !controlled(policy,row.branch);
    if (elapsedTicks===0||!own(reasons,by)||reasons[by]!==row.reason) return false;
    const resolution = policy.resolve.find(eligible);
    if (by==='resolution') return row.branch===resolution;
    return resolution===undefined&&row.branch===policy.otherwise&&elapsedTicks===policy.windowTicks;
  }

  function inspect(definitions,state,docs,args) {
    check(record(args)&&Object.keys(args).every(key=>key==='story'),'Invalid story beat filters');
    const {story} = args;
    const documents = new Map(docs?.map(document=>[document.id,document.stories]));
    function report(key,stages) {
      const row = state[key], current = row?.flow?.current, lifecycle = row?.transitions.at(-1).to??null;
      const last = row?.flow?.route.findLast(visit=>visit.beat);
      const value = {lifecycle,stages,...(last&&{last:{stage:last.stage,visit:last.visit,tick:last.leftAt,branch:last.branch,...last.beat}})};
      if (!current?.beat) return value;
      const policy = stages[current.stage], [document,id] = key.split('/');
      const stage = documents.get(document)[id].stages[current.stage];
      const resolve = policy.resolve.map(branch=>{
        const gate = W.storyStages.eligibility(stage,stage.next[branch],current.objectives);
        return {branch,ready:!gate.rejected,...(gate.pending&&{pending:gate.pending})};
      });
      return {...value,current:{stage:current.stage,visit:current.visit,enteredAt:current.enteredAt,
        ...current.beat,remainingTicks:policy.windowTicks-current.beat.elapsedTicks,otherwise:policy.otherwise,resolve}};
    }
    if (story!==undefined) return own(definitions,story)?Q.ok(freeze(report(story,definitions[story]))):
      Q.missing('Unknown story with escalation beats '+story,'missing');
    return Q.ok(freeze(Object.fromEntries(Object.entries(definitions??{}).map(([key,stages])=>[key,report(key,stages)]))));
  }

  W.storyBeats = Object.freeze({compile,initial,controlled,step,valid,inspect});
})(KIT);
