const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const example = name=>path.resolve(__dirname,'../examples/story-documents/'+name+'.json');
const sim = (...args)=>spawnSync(process.execPath,[cli,'sim',...args],{encoding:'utf8'});
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-story-matrix-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return name=>path.join(dir,name);
}
function matrix(world,plan,...args) {
  const result = sim('seed-matrix',world,plan,...args);
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}

test('seeded scheduler routes report completion, censored waits, branch frequency, and repeated pilot assignments', () => {
  const source = example('lantern-ferry.world'), plan = example('lantern-ferry.seed-matrix');
  const report = matrix(source,plan);
  assert.deepEqual(matrix(source,plan),report);
  assert.equal(report.format,'ink-studio/story-seed-matrix');
  const relay = report.stories['lantern-ferry/relay'];
  assert.deepEqual(relay.statuses,{active:8,completed:4});
  assert.equal(relay.completionRate,4/12);
  assert.equal(relay.completionRateAfterStart,4/12);
  assert.equal(relay.censored,8);
  assert.deepEqual(relay.branches.map(row=>[row.branch,row.visits,row.runs]),[['west',8,8],['east',4,4]]);
  assert.equal(relay.waiting.totalTicks,104);
  assert.deepEqual(relay.waiting.byReason,{unoffered:12,stage:92});
  const landing = relay.blockers.find(row=>row.stage==='await-landing'&&row.check==='landing');
  assert.deepEqual([landing.reason,landing.ticks,landing.runs],['objectives-pending',80,8]);
  const west = report.stories['lantern-ferry/west-window'];
  const configured = west.castRepetition.find(row=>row.kind==='role'), assigned = west.castRepetition.find(row=>row.kind==='assignment');
  assert.equal(configured.values[0].runs,12);
  assert.equal(configured.values[0].usedRuns,8);
  assert.equal(assigned.values[0].value.agent,'bryn');
  assert.equal(assigned.repeatedAppearances,7);
  assert.equal(west.blockers.find(row=>row.reason==='cadence').ticks,36);
  const expired = report.runs.find(row=>row.stories['lantern-ferry/west-window'].status==='candidate-expired');
  assert.equal(expired.stories['lantern-ferry/west-window'].endedAt,10);
  assert.equal(expired.stories['lantern-ferry/west-window'].waiting.ticks,10);
});

test('relative action files contribute real blockers and explicit offer waiting', t => {
  const out = temp(t)('report.json');
  const result = sim('seed-matrix',example('sluice-relief.world'),example('sluice-relief.seed-matrix'),'--out',out);
  assert.equal(result.status,0,result.stderr);
  const report = read(out), story = report.stories['sluice-relief/relief'];
  assert.deepEqual(report.seeds,[2,5,13]);
  assert.equal(story.completed,3);
  assert.deepEqual(story.waiting.byReason,{unoffered:3,admission:15,offer:3,stage:39,player:3});
  assert.equal(story.waiting.meanSeconds,2.1);
  assert(story.blockers.some(row=>row.check==='build-platform'&&row.reason==='missing-stock'&&row.runs===3));
  assert(story.blockers.some(row=>row.check==='build-platform'&&row.reason==='output-full'&&row.ticks===3));
  assert.equal(story.castRepetition[0].repeatedAppearances,2);
});

test('branch visits on the final tick survive the route cap and history filters', t => {
  const file = temp(t), world = file('world.json'), plan = file('plan.json');
  const story = 'looped/visit', visit = {
    kind:'questlet',title:'Log visits',entry:'circle',lifecycle:{progression:true},
    stages:{circle:{title:'Circle',next:{again:{stage:'circle'},leave:{outcome:'done'}}}},
    outcomes:{done:{title:'Finished'}}
  };
  fs.writeFileSync(world,JSON.stringify({format:'ink-studio/world',version:1,id:'looped',dt:0.1,history:{enabled:false},
    storyDocuments:[{format:'ink-studio/story',version:1,id:'looped',stories:{visit}}]}));
  const actions = Array.from({length:71},(_,index)=>({tick:1,action:'world/story-choose',args:{
    document:'looped',story:'visit',stage:'circle',visit:index+1,branch:index===70?'leave':'again',reason:'test-visits'
  }}));
  fs.writeFileSync(plan,JSON.stringify({seeds:[1,2],ticks:1,actions}));
  const report = matrix(world,plan), rows = report.stories[story];
  assert.equal(rows.completed,2);
  assert.deepEqual(rows.branches.map(row=>[row.branch,row.visits,row.runs]),[['again',140,2],['leave',2,2]]);
  assert.equal(rows.waiting.totalTicks,2);
  assert.equal(report.runs[0].stories[story].endedAt,1);
});

test('seed matrix rejects duplicate seeds and overwriting a dependency', t => {
  const file = temp(t), source = file('world.json'), plan = file('matrix.json'), doc = file('lantern-ferry.json');
  fs.copyFileSync(example('lantern-ferry.world'),source);
  fs.copyFileSync(example('lantern-ferry'),doc);
  fs.writeFileSync(plan,JSON.stringify({seeds:[1,1],ticks:2}));
  const invalid = sim('seed-matrix',source,plan);
  assert.equal(invalid.status,1);
  assert.match(invalid.stderr,/distinct safe integers/);
  fs.writeFileSync(plan,JSON.stringify({seeds:[1],ticks:2}));
  const alias = file('alias.json');
  fs.symlinkSync(doc,alias);
  assert.match(sim('seed-matrix',source,plan,'--out',alias).stderr,/separate from the story sources/);
  assert.deepEqual(read(doc),read(example('lantern-ferry')));
});
