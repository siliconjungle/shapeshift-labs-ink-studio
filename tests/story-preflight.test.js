const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { load, preflightStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const examples = path.resolve(__dirname, '../examples/story-documents');
const draftFile = path.join(examples, 'breakwater-draft.json');
const fixedFile = path.join(examples, 'breakwater-survey.json');
const worldFile = path.join(examples, 'breakwater-survey.world.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const call = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding:'utf8' });
const R = load().KIT.world.runtime;

test('preview gathers missing links and target ambiguity and still analyzes the other authored routes', () => {
  const draft = read(draftFile), unchanged = JSON.stringify(draft), report = preflightStoryDocument(draft);
  assert.equal(JSON.stringify(draft), unchanged);
  assert.equal(report.valid, false);
  assert.equal(report.diagnostics.filter(issue => issue.code === 'missing-reference').length, 3);
  for (const code of ['ambiguous-transition-target','ambiguous-auto-transition','unreachable-stage','loop-without-exit','unbounded-chain',
    'unopened-child-wait']) assert(report.diagnostics.some(issue => issue.code === code), code);
  const broken = report.stories.find(story => story.id === 'broken-links');
  assert.equal(broken.completeTopology, false);
  assert.deepEqual(broken.routes, []);
  const loops = report.stories.find(story => story.id === 'route-loops');
  assert.deepEqual(loops.routes[0].path, [{ stage:'approach',branch:'circle' },{ stage:'turning-basin',branch:'send-report' }]);
  assert(loops.stages.some(stage => stage.id === 'shoal' && stage.reachable && !stage.canReachOutcome));
  assert(report.diagnostics.some(issue => issue.code === 'unbounded-chain' && issue.stages[0] === 'turning-basin'));
  assert(report.diagnostics.some(issue => issue.code === 'loop-without-exit' && issue.stages.join(',') === 'eddies,shoal'));
  assert(report.diagnostics.some(issue => issue.code === 'unopened-child-wait' && issue.children[0] === 'stores'));
  const result = call('story','preview',draftFile);
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), report);
});

test('mutually exclusive child outcomes and authored choices leave automatic branches unambiguous', () => {
  const doc = read(fixedFile), stages = doc.stories['pick-channel'].stages;
  const reviewed = preflightStoryDocument(doc,{story:'pick-channel'});
  assert.deepEqual(reviewed.diagnostics, []);
  assert.deepEqual(reviewed.stories[0].routes.map(route => [route.outcome,route.steps]), [['hold',1],['dispatched',2]]);
  assert.deepEqual(call('story','preview',fixedFile,'pick-channel','--strict').status, 0);

  const branches = stages.listen.next;
  branches['shallow-channel'].requiresChildren.soundings = {status:'failed',outcome:'clear'};
  const contradictions = preflightStoryDocument(doc).diagnostics;
  assert(contradictions.some(issue => issue.code === 'impossible-child-result'));
  assert(!contradictions.some(issue => issue.code === 'ambiguous-auto-transition'));
  branches['shallow-channel'].requiresChildren.soundings = {status:'completed'};
  assert(preflightStoryDocument(doc).diagnostics.some(issue => issue.code === 'ambiguous-auto-transition'));

  stages.listen.objectives = {route:{title:'Route decision',type:'choose',params:{options:{ship:'Ship',hold:'Hold'}}}};
  branches['clear-channel'].requiresChoice = {route:'ship'};
  branches['shallow-channel'].requiresChoice = {route:'hold'};
  assert.deepEqual(preflightStoryDocument(doc).diagnostics, []);
});

test('offer clocks leave an active chain unbounded and work clocks bound it without adding a missing ending', () => {
  const doc = read(draftFile), loop = doc.stories['route-loops'];
  loop.lifecycle.activation = 'manual';
  loop.lifecycle.offerFor = 0.5;
  assert(preflightStoryDocument(doc).diagnostics.some(issue => issue.code === 'unbounded-chain'));
  loop.lifecycle.deadlines = {work:{for:5}};
  const bounded = preflightStoryDocument(doc).diagnostics;
  assert(!bounded.some(issue => issue.code === 'unbounded-chain'));
  assert(bounded.some(issue => issue.code === 'loop-without-exit'));
});

test('preview keeps deterministic short witnesses and bounds their number and length', () => {
  const length = 92, totalOutcomes = 20;
  const outcomes = Object.fromEntries(Array.from({length:totalOutcomes}, (_, i) => ['end-' + i, {title:'End '+i}]));
  const stages = Object.fromEntries(Array.from({length}, (_, i) => ['stage-' + i, {title:'Stage '+i,
    next:i + 1 < length ? {onward:{stage:'stage-' + (i+1)}} :
      Object.fromEntries(Object.keys(outcomes).map(outcome => [outcome,{outcome}]))}]));
  const source = {format:'ink-studio/story',version:1,id:'long',stories:{
    chain:{kind:'questlet',entry:'stage-0',title:'Long chain',stages,outcomes}
  }};
  const first = preflightStoryDocument(source).stories[0];
  source.stories.chain.stages = Object.fromEntries(Object.entries(stages).reverse());
  assert.deepEqual(preflightStoryDocument(source).stories[0], first);
  assert.equal(first.routes.length, 16);
  assert.equal(first.routesOmitted, 4);
  assert.equal(first.routes[0].steps, length);
  assert.equal(first.routes[0].path.length, 64);
  assert.equal(first.routes[0].stepsOmitted, 28);
  assert.deepEqual(first.routes[0].path.at(-1), {stage:'stage-63',branch:'onward'});
});

test('world preflight checks registrations without initializing solvers, and CLI strict checks run before stepping', t => {
  const source = embedStoryDocuments(read(worldFile),worldFile);
  let initialized = 0;
  source.systems.untouched = {kind:'preflight-fixture'};
  const implementations = {'preflight-fixture':() => ({initial(){ initialized++; return {}; },step:state=>state})};
  assert.deepEqual(R.storyPreflight(source,{implementations}).diagnostics, []);
  assert.equal(initialized, 0);
  const clean = call('sim','preflight',worldFile,'--strict');
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(JSON.parse(clean.stdout).valid, true);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'ink-preflight-'));
  t.after(() => fs.rmSync(tmp,{recursive:true,force:true}));
  delete source.systems.untouched;
  const document = source.storyDocuments[0], worldPath = path.join(tmp,'warn.world.json'), storyPath = path.join(tmp,'warn.story.json');
  document.stories.soundings.stages.unvisited = {title:'Unused',next:{finish:{outcome:'clear'}}};
  fs.writeFileSync(worldPath,JSON.stringify(source));
  fs.writeFileSync(storyPath,JSON.stringify(document));
  const strictStory = call('story','validate',storyPath,'--strict');
  assert.equal(strictStory.status, 1);
  assert.equal(JSON.parse(strictStory.stdout).diagnostics[0].code, 'unreachable-stage');
  const strictWorld = call('sim','preflight',worldPath,'--strict');
  assert.equal(strictWorld.status, 1);
  assert.equal(JSON.parse(strictWorld.stdout).diagnostics[0].document, 'breakwater-survey');
  const simulated = call('sim','run',worldPath,'--ticks','0');
  assert.equal(simulated.status, 0, simulated.stderr);
  assert.match(simulated.stderr, /Story warning \[unreachable-stage\]/);
  assert.equal(JSON.parse(simulated.stdout).tick, 0);

  document.stories['pick-channel'].stages.dispatch.objectives.signal.params.state.field = 'dock/missing';
  fs.writeFileSync(worldPath,JSON.stringify(source));
  const invalid = call('sim','preflight',worldPath);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown objective evidence query field dock\/missing/);
});
