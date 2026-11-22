const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const example = name=>path.resolve(__dirname,'../examples/story-documents/'+name+'.json');
const world = example('dispatch-rehearsal.world'), story = 'dispatch-rehearsal/relay';
const stocked = example('dispatch-rehearsal.stocked.condition');
const R = load().KIT.world.runtime;
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-story-run-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  return name=>path.join(dir,name+'.json');
}
function sim(status,...args) {
  const result = spawnSync(process.execPath,[cli,'sim',...args],{encoding:'utf8'});
  assert.equal(result.status,status,result.stderr||result.stdout);
  return status===1?result.stderr:JSON.parse(result.stdout);
}

test('a seeded launch waits for feasibility, resumes to two simultaneous breakpoints, and replays a named ending', t => {
  const file = temp(t), request = file('request'), stage = file('stage'), recording = file('resumed');
  const launch = sim(0,'run',world,'--seed','71','--start-story',story,'--ticks','1','--checkpoint',request);
  assert.equal(launch.tick,1);
  assert.deepEqual(launch.launch,{story,requestedAt:1,status:'waiting'});
  const saved = read(request);
  assert.deepEqual(saved.storyFeasibilityState[story].request.source,{launch:{tick:1,reason:'cli-story-start'}});
  assert.equal(saved.storyFeasibilityState[story].report.ready,false);
  const atStage = sim(0,'resume',request,'--until-stage',story+'/handover','--until-condition',stocked,
    '--ticks','20','--checkpoint',stage);
  assert.equal(atStage.tick,4);
  assert.equal(atStage.seed,71);
  assert.deepEqual(atStage.stop.matches[0],{kind:'stage',story,stage:'handover',visit:2,enteredAt:4});
  assert.equal(atStage.stop.matches[1].value.balance,2);
  const initialMatch = sim(0,'resume',stage,'--until-stage',story+'/handover','--ticks','20');
  assert.equal(initialMatch.stop.from,initialMatch.stop.tick);

  const ending = sim(0,'resume',stage,'--until-outcome',story+'/delivered','--steps','10','--record',recording);
  assert.equal(ending.tick,8);
  assert.deepEqual(ending.stop.matches,[{kind:'outcome',story,outcome:'delivered',status:'completed',resolvedAt:8}]);
  assert.equal(sim(0,'verify',recording).status,'verified');
  const uninterrupted = file('uninterrupted');
  sim(0,'run',world,'--seed','71','--start-story',story,'--ticks','8','--checkpoint',uninterrupted);
  assert.deepEqual(read(recording).end,read(uninterrupted));
  assert.match(sim(1,'resume',stage,'--seed','92','--until-outcome',story+'/delivered'),/checkpoint seed/);
  const rejected = sim(2,'resume',recording,'--start-story',story,'--steps','1');
  assert.equal(rejected.launch.status,'rejected');
});

test('a committed tick retains stages that an authored command entered and left within that tick', t => {
  const file = temp(t), source = read(world), document = read(example('dispatch-rehearsal'));
  const relay = document.stories.relay;
  delete relay.lifecycle.feasibility;
  delete relay.stages.load.objectives;
  delete relay.stages.load.decision;
  delete relay.stages.load.next.packed.auto;
  source.storyDocuments = [document];
  source.commands = [{tick:1,action:'world/story-choose',args:{
    document:'dispatch-rehearsal',story:'relay',stage:'load',visit:1,branch:'packed',reason:'same-tick-choice'
  }}];
  const input = file('world'), checkpoint = file('stage');
  fs.writeFileSync(input,JSON.stringify(source));
  const report = sim(0,'run',input,'--start-story',story,'--until-stage',story+'/load','--checkpoint',checkpoint);
  assert.equal(report.tick,1);
  assert.equal(report.stop.matches[0].enteredAt,1);
  assert.equal(read(checkpoint).storyLifecycleState[story].flow.current.stage,'handover');
});

test('the seeded scheduler runs to a query condition and a missed stop saves the bounded tick', t => {
  const file = temp(t), condition = file('condition'), selected = file('selected'), stopped = file('stopped');
  const source = example('glass-coast.world');
  fs.writeFileSync(condition,JSON.stringify({field:'world/account',args:{account:'stock/harbor'},
    when:{path:'/balance',op:'gte',value:2}}));
  const args = ['run',source,'--seed','29','--storyteller','generous','--until-condition',condition];
  const result = sim(0,...args,'--ticks','25','--checkpoint',selected);
  assert.equal(result.stop.matches[0].value.balance,2);
  assert.equal(read(selected).storyLifecycleState['glass-coast/mutual-aid'].transitions.at(-1).outcome,'supplied');
  const miss = sim(2,...args,'--ticks','0','--checkpoint',stopped);
  assert.equal(miss.stop.reason,'tick-limit');
  assert.equal(read(stopped).tick,0);
  const resumed = sim(0,'resume',stopped,'--until-condition',condition,'--ticks','25');
  assert.deepEqual(resumed.stop,result.stop);
});

test('runtime stop predicates check the initial state and each completed tick in sync and async advances', async () => {
  const source = {id:'stop-callback',dt:0.1};
  const sync = R.create(source), asyncRun = R.create(source), seen = [];
  const until = ({tick},query) => {
    assert.equal(typeof query.probe,'function');
    seen.push(tick);
    return tick===2;
  };
  const advanced = sync.advance(6,{until});
  assert.equal(advanced.tick,2);
  assert.deepEqual(seen,[0,1,2]);
  seen.length = 0;
  assert.equal((await asyncRun.advanceAsync(6,{until:async (...args)=>until(...args)})).tick,2);
  assert.deepEqual(seen,[0,1,2]);
  assert.deepEqual(asyncRun.checkpoint(),sync.checkpoint());
  assert.equal(sync.advance(8,{until}).tick,2);
});
