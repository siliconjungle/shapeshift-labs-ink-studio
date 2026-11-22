/* Portable static analysis of story stages, guards, and sample routes. */
const StoryAnalysis = (() => {
  const own = (object, key) => object != null && Object.hasOwn(object, key);
  const known = (object, id) => typeof id === 'string' && own(object, id);
  const keys = object => Object.keys(object ?? {}).sort();
  const routeLimit = 16, stepLimit = 64;
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function childStatus(stories, id, outcome) {
    const child = stories[id];
    if (child?.lifecycle?.progression === true && own(child.outcomes, outcome))
      return child.outcomes[outcome].status ?? 'completed';
  }

  function guard(stories, stage, branch) {
    const facts = new Map(), failed = new Set(branch.requiresFailed ?? []);
    const completed = new Set([...keys(stage.objectives).filter(id => !stage.objectives[id].optional), ...(branch.requires ?? [])]);
    for (const id of completed) if (!failed.has(id)) facts.set('objective/' + id, 'completed');
    for (const id of failed) facts.set('objective/' + id, 'failed');
    for (const [id, option] of Object.entries(branch.requiresChoice ?? {})) {
      facts.set('objective/' + id, 'completed');
      facts.set('choice/' + id, option);
    }
    for (const [id, {status, outcome}] of Object.entries(branch.requiresChildren ?? {})) {
      const statusMatch = status ?? childStatus(stories, id, outcome);
      if (statusMatch !== undefined) facts.set('child-status/' + id, statusMatch);
      if (outcome !== undefined) facts.set('child-outcome/' + id, outcome);
    }
    return facts;
  }

  function compatible(a, b) {
    for (const [key, value] of a) if (b.has(key) && b.get(key) !== value) return false;
    return true;
  }

  function scan(entry, graph) {
    const before = new Map(), endings = new Map(), distance = new Map();
    if (!graph.has(entry)) return {before, endings, distance};
    const queue = [entry];
    distance.set(entry, 0);
    for (let i = 0; i < queue.length; i++) {
      const from = queue[i], steps = distance.get(from) + 1;
      for (const edge of graph.get(from)) {
        if (edge.outcome !== undefined) {
          if (!endings.has(edge.outcome)) endings.set(edge.outcome, {edge, from, steps});
        } else if (!distance.has(edge.stage)) {
          distance.set(edge.stage, steps);
          before.set(edge.stage, {edge, from});
          queue.push(edge.stage);
        }
      }
    }
    return {before, endings, distance};
  }

  function possibleChildren(stories, definition, graph) {
    const result = new Map([...graph.keys()].map(id => [id, []])), waiting = new Map(), blocked = new Map();
    if (!graph.has(definition.entry)) return {graph:result, waiting, blocked};
    const queue = new Set([definition.entry]), known = new Map([[definition.entry, new Set()]]);
    const canExpire = id => stories[id]?.lifecycle?.deadlines?.world !== undefined;
    let cost = 0;
    while (queue.size) {
      const id = queue.values().next().value;
      queue.delete(id);
      const stage = definition.stages[id], opened = known.get(id), wait = stage.children?.wait;
      for (const child of stage.children?.open ?? []) opened.add(child);
      const children = wait?.all ?? wait?.any ?? [];
      const missing = children.filter(child => !opened.has(child) && !canExpire(child));
      if (missing.length && (!wait.any || missing.length === children.length)) {
        waiting.set(id, missing);
        continue;
      }
      waiting.delete(id);
      const enabled = [];
      for (const branch of graph.get(id)) {
        cost += 1 + opened.size;
        if (cost > 250000) return {graph, waiting:new Map(), blocked:new Map(), limited:true};
        const unresolved = keys(branch.requiresChildren).filter(child => {
          const {status, outcome} = branch.requiresChildren[child];
          return !opened.has(child) && !(canExpire(child) && outcome === undefined && status === 'expired');
        });
        if (unresolved.length) {
          let byBranch = blocked.get(id);
          if (!byBranch) blocked.set(id, byBranch = new Map());
          byBranch.set(branch.id, unresolved);
          continue;
        }
        blocked.get(id)?.delete(branch.id);
        enabled.push(branch);
        if (branch.stage === undefined) continue;
        const previous = known.get(branch.stage);
        if (!previous) {
          known.set(branch.stage, new Set(opened));
          queue.add(branch.stage);
        } else {
          const size = previous.size;
          for (const child of opened) previous.add(child);
          if (previous.size !== size) queue.add(branch.stage);
        }
      }
      result.set(id, enabled);
    }
    return {graph:result, waiting, blocked};
  }

  function graphGroups(graph) {
    const incoming = new Map([...graph.keys()].map(id => [id, []]));
    const stageEdges = new Map([...graph].map(([id, branches]) => [id, branches.flatMap(edge =>
      edge.stage === undefined ? [] : [edge.stage])]));
    const reachesEnding = new Set();
    for (const [from, branches] of graph) {
      if (branches.some(edge => edge.outcome !== undefined)) reachesEnding.add(from);
      for (const to of stageEdges.get(from)) incoming.get(to).push(from);
    }
    for (const id of reachesEnding) for (const from of incoming.get(id)) reachesEnding.add(from);

    // Use iterative passes so long authored chains do not consume the JS call stack.
    const visited = new Set(), finished = [];
    for (const root of graph.keys()) {
      if (visited.has(root)) continue;
      const stack = [{id:root, edge:0}];
      visited.add(root);
      while (stack.length) {
        const top = stack.at(-1), targets = stageEdges.get(top.id);
        if (top.edge === targets.length) {
          finished.push(stack.pop().id);
          continue;
        }
        const target = targets[top.edge++];
        if (visited.has(target)) continue;
        visited.add(target);
        stack.push({id:target, edge:0});
      }
    }
    const assigned = new Set(), loops = [];
    for (const root of finished.reverse()) {
      if (assigned.has(root)) continue;
      const group = [root];
      assigned.add(root);
      for (let i = 0; i < group.length; i++) for (const from of incoming.get(group[i])) {
        if (assigned.has(from)) continue;
        assigned.add(from);
        group.push(from);
      }
      if (group.length > 1 || stageEdges.get(root).includes(root)) loops.push(group.sort());
    }
    return {reachesEnding, loops:loops.sort((a,b) => compare(a[0],b[0]))};
  }

  function sampleRoutes(scanResult) {
    const {before, endings} = scanResult;
    const routes = [...endings].sort(([a,left],[b,right]) => left.steps - right.steps || compare(a,b))
      .slice(0, routeLimit).map(([outcome, ending]) => {
        const path = [];
        for (let row = ending; row; row = before.get(row.from)) path.push({stage:row.from, branch:row.edge.id});
        return {outcome, steps:ending.steps, path:path.reverse().slice(0, stepLimit),
          ...(path.length > stepLimit && {stepsOmitted:path.length - stepLimit})};
      });
    return {routes, routesOmitted:endings.size - routes.length};
  }

  function summarize(stories, id, issues, preview) {
    const story = stories[id], base = 'story.stories.' + id;
    const warn = (code, path, message, detail) => issues.push({code, path, message, severity:'warning', story:id, ...detail});
    let intact = known(story.stages, story.entry);
    const graph = new Map(), authored = new Map();
    for (const stage of keys(story.stages)) {
      const spec = story.stages[stage], branches = keys(spec.next).map(id => ({id, ...spec.next[id]}));
      authored.set(stage, branches);
      const valid = [];
      for (const edge of branches) {
        const path = base + '.stages.' + stage + '.next.' + edge.id;
        const stageTarget = own(edge, 'stage'), outcomeTarget = own(edge, 'outcome');
        if (stageTarget === outcomeTarget || !(stageTarget ? known(story.stages, edge.stage) : known(story.outcomes, edge.outcome))) {
          intact = false;
          continue;
        }
        const contradiction = Object.entries(edge.requiresChildren ?? {}).find(([child, {status, outcome}]) => {
          const expected = childStatus(stories, child, outcome);
          return status !== undefined && expected !== undefined && status !== expected;
        });
        if (contradiction) {
          warn('impossible-child-result', path, 'The child outcome records a different terminal status.', {child:contradiction[0]});
          continue;
        }
        valid.push(edge);
      }
      graph.set(stage, valid);
    }
    const nested = [...graph].some(([id, edges]) => story.stages[id].children || edges.some(edge => edge.requiresChildren));
    const possible = nested ? possibleChildren(stories, story, graph) : {graph, waiting:new Map(), blocked:new Map()};
    const reachable = scan(story.entry, possible.graph);
    const {reachesEnding, loops} = graphGroups(possible.graph);
    if (possible.limited) warn('analysis-limit', base, 'Child reachability analysis reached its budget. The preview uses structural routes.');
    for (const [stage, branches] of possible.graph) {
      const path = base + '.stages.' + stage;
      if (!reachable.distance.has(stage)) {
        if (intact) warn('unreachable-stage', path, 'No possible route from the entry reaches this stage.', {stage});
        continue;
      }
      if (intact && possible.waiting.has(stage))
        warn('unopened-child-wait', path + '.children.wait', 'The wait depends on children that cannot open before this stage leaves.',
          {children:possible.waiting.get(stage)});
      for (const [branch, children] of possible.blocked.get(stage) ?? [])
        if (intact) warn('unopened-child-branch', path + '.next.' + branch, 'This branch needs children that cannot open on the way to this stage.', {children});
      const automatic = branches.filter(edge => edge.auto).map(edge => ({id:edge.id, facts:guard(stories, story.stages[stage], edge)}));
      let comparisons = 0;
      checkPairs: for (let i = 0; i < automatic.length; i++) for (let j = i + 1; j < automatic.length; j++) {
        if (++comparisons > 8192) {
          warn('analysis-limit', path + '.next', 'Automatic branch overlap analysis reached its pair budget.');
          break checkPairs;
        }
        if (compatible(automatic[i].facts, automatic[j].facts)) {
          warn('ambiguous-auto-transition', path + '.next', 'Automatic branches can qualify together. The first eligible ID takes precedence.',
            {branches:[automatic[i].id,automatic[j].id]});
          break checkPairs;
        }
      }
    }
    if (intact) for (const group of loops) {
      if (!group.some(id => reachable.distance.has(id))) continue;
      const path = base + '.stages.' + group[0];
      if (!reachesEnding.has(group[0])) warn('loop-without-exit', path, 'This loop has no path to an authored outcome.', {stages:group});
      else if (!story.lifecycle?.deadlines?.world && !story.lifecycle?.deadlines?.work)
        warn('unbounded-chain', path, 'This loop can revisit stages indefinitely without a world or work cutoff.', {stages:group});
    }
    if (!preview) return;
    return {id, kind:story.kind, title:story.title, entry:story.entry, completeTopology:intact,
      ...(story.roles && {roles:story.roles}),
      ...(story.lifecycle?.feasibility && {feasibility:story.lifecycle.feasibility}),
      ...(story.lifecycle?.liveReferences && {liveReferences:story.lifecycle.liveReferences}),
      ...(story.lifecycle?.commitment && {commitment:story.lifecycle.commitment}),
      ...(story.lifecycle?.handoffs && {handoffs:story.lifecycle.handoffs}),
      stages:keys(story.stages).map(id => {
        const stage = story.stages[id], available = new Set(possible.graph.get(id).map(edge => edge.id));
        return {id, title:stage.title, reachable:reachable.distance.has(id), canReachOutcome:reachesEnding.has(id),
          ...(stage.children && {children:stage.children}),
          ...(stage.roles && {roles:stage.roles}),
          ...(stage.objectives && {objectives:keys(stage.objectives).map(id => {
            const {title, type, optional = false} = stage.objectives[id];
            return {id,title,optional,...(type !== undefined && {type})};
          })}),
          branches:authored.get(id).map(edge => ({...edge, possible:reachable.distance.has(id) && available.has(edge.id)}))};
      }),
      outcomes:keys(story.outcomes).map(id => ({id, title:story.outcomes[id].title, status:story.outcomes[id].status ?? 'completed',
        reachable:reachable.endings.has(id)})),
      ...sampleRoutes(reachable)};
  }

  function analyze(document, {story, preview = false} = {}) {
    const diagnostics = [], stories = [];
    for (const id of keys(document.stories)) {
      if (story !== undefined && story !== id) continue;
      const summary = summarize(document.stories, id, diagnostics, preview);
      if (summary) stories.push(summary);
    }
    return {diagnostics, stories};
  }

  return Object.freeze({analyze});
})();
if (typeof module !== 'undefined') module.exports = StoryAnalysis;
