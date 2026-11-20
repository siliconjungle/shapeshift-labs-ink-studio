const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const studio = require('..');
const { KIT: { world: W } } = studio.load();
const R = W.runtime;
const json = value => JSON.parse(JSON.stringify(value));
const clock = { id:'reproducible', format:W.format, dt:.25, seed:41,
  systems:{
    meter:{kind:'control',config:{op:'scale',scale:2}},
    basin:{kind:'water',schedule:{substeps:2},config:{width:1,height:1,rain:.06}}
  },
  commands:[{tick:1,action:'world/event',args:{kind:'prime'}}],
  eventActions:{ prime:{on:{kind:'prime',system:'world'},actions:[
    {action:'world/input',args:{port:'meter/value',value:1}}
  ]}}
};
const observations = {ticks:[0,1,2,3,5],observations:{
  gauge:{field:'world/signal',args:{port:'meter/value'}},
  total:{field:'basin/mass',path:'/volume',units:'world^3'},
  missing:{field:'basin/mass',path:'/unknown',ticks:[2]}
}};
const command = (tick, port, value) => ({tick,action:'world/input',args:{port,value}});
const revised = {tick:3,action:'world/patch',args:{edits:[{op:'set',path:'/metadata/revision',value:'reviewed'}]}};

test('records committed scene revisions, the actual action order, sample values and solver cadence', async t => {
  const run = R.create(clock,{recordRun:observations});
  run.step();
  run.schedule([command(2,'meter/value',2)]);
  const early = run.recording();
  run.schedule([revised]);
  run.advance(5);
  run.schedule([command(6,'meter/value',7)]);
  const log = json(run.recording());
  const {scene,submissions,actions,timing,observations:readings} = log.evidence;
  assert.equal(scene.seed,41);
  assert.equal(scene.id,'reproducible');
  assert.deepEqual(scene.revisions.map(row=>[row.tick,row.time]),[[0,0],[3,.75]]);
  assert.notEqual(scene.revisions[0].revision,scene.revisions[1].revision);
  assert.deepEqual(submissions,[{tick:1,count:2},{tick:5,count:1}]);
  assert.deepEqual(early.evidence.submissions,[{tick:1,count:1}]);
  assert.deepEqual(actions.map(row=>row.tick),[1,2,3]);
  assert.deepEqual(actions.find(row=>row.tick===2).commands.map(row=>row.args.value),[1,2]);
  assert.equal(log.end.pending[0].tick,6);
  assert.deepEqual([timing.dt,timing.fromTime,timing.toTime,timing.subdivision],[.25,0,1.25,2]);
  assert.deepEqual(timing.steps,{basin:{calls:10,seconds:1.25},meter:{calls:5,seconds:1.25}});
  assert.deepEqual(readings.filter(row=>row.observation==='gauge').map(row=>row.value),[0,0,4,4,4]);
  assert.equal(readings.find(row=>row.observation==='missing').status,'missing');
  assert.ok(readings.find(row=>row.observation==='total'&&row.tick===5).value>0);
  assert.deepEqual(json(R.replay(log).recording()),log);
  assert.equal(R.verify(log).status,'verified');

  const workerPool=studio.createSimulationWorkers(2);
  t.after(()=>workerPool.close());
  const reconstructed=await R.replayAsync(log,{workerPool});
  assert.deepEqual(json(reconstructed.recording()),log);
  assert.equal((await R.verifyAsync(log,{workerPool})).status,'verified');
  assert.equal(reconstructed.partitions().systems.basin,10);

  const scrub=W.scrub.create(log,{checkpointEvery:1,checkpointCache:3});
  assert.equal(scrub.seek(2).signals['meter/value'],4);
  scrub.seek(0);
  scrub.seek(1);
  assert.deepEqual(json(scrub.seek(5).world),log.end.world);
  assert.deepEqual(json(scrub.checkpoint()),log.end);
  assert.equal(R.firstDivergence(log).status,'equal');
});

test('verification identifies observation, timing, scene, action and endpoint discrepancies independently', () => {
  const run=R.create(clock,{recordRun:observations});
  run.schedule([revised]);
  run.advance(5);
  const original=run.recording();
  const checks=[
    ['observation',2,log=>{log.evidence.observations.find(row=>row.observation==='gauge'&&row.tick===2).value=42;}],
    ['timing',5,log=>{log.evidence.timing.steps.basin.seconds=2;}],
    ['scene-revision',3,log=>{log.evidence.scene.revisions[1].revision='stale';}],
    ['actions',2,log=>{log.evidence.actions[1].commands[0].args.value=3;}],
    ['checkpoint',5,log=>{log.end.states.meter.value=1234;}]
  ];
  for(const [kind,tick,change] of checks){
    const log=json(original);
    change(log);
    const report=R.verify(log);
    assert.equal(report.status,'diverged',kind);
    assert.equal(report.mismatch.kind,kind);
    assert.equal(report.mismatch.tick,tick);
    assert.throws(()=>R.replay(log),/Replay diverged at tick/);
  }
  const broken=json(original);
  broken.evidence.submissions[0].tick=3;
  assert.throws(()=>R.verify(broken),/after its submission/);
});

test('zero-length, resumed and legacy recordings remain portable', () => {
  const run=R.create(clock,{recordRun:observations});
  assert.equal(R.verify(json(run.recording())).observations,2);
  run.advance(3);
  const resumed=run.fork();
  resumed.advance(5);
  const log=json(resumed.recording());
  assert.deepEqual(log.evidence.observations.map(row=>row.tick),[3,3,5,5]);
  assert.equal(log.evidence.scene.revisions[0].time,.75);
  assert.equal(R.verify(log).status,'verified');
  const legacy=R.create(clock);
  legacy.advance(2);
  const old=json(legacy.recording());
  assert.equal(old.evidence,undefined);
  assert.deepEqual(json(R.replay(old).checkpoint()),old.end);
  assert.equal(R.verify(old).status,'verified');
});

test('a failed observation leaves the committed tick and its evidence intact', () => {
  let unavailable=true;
  const gauge=()=>({initial:()=>0,step:value=>value+1,fields:{reading:{type:'number',read({tick,state}){
    if(unavailable&&tick===2)throw Error('gauge disconnected');
    return W.query.ok(state);
  }}}});
  const recordRun={ticks:[1,2],observations:{meter:{field:'gauge/reading'}}};
  const run=R.create({systems:{gauge:{kind:'gauge'}}},{implementations:{gauge},recordRun});
  run.step();
  const committed=run.recording();
  assert.throws(()=>run.step(),/gauge disconnected/);
  assert.deepEqual(run.recording(),committed);
  unavailable=false;
  run.step();
  assert.deepEqual(run.recording().evidence.observations.map(row=>row.value),[1,2]);
});

test('the CLI saves evidence in standalone and block-backed recordings and reports a mismatch as exit 2', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-run-evidence-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  const write=(name,value)=>{fs.writeFileSync(file(name),JSON.stringify(value));return file(name);};
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  function invoke(...args){
    const child=spawnSync(process.execPath,[cli,'sim',...args],{encoding:'utf8'});
    return {...child,report:child.stdout?JSON.parse(child.stdout):null};
  }
  const scene=write('world.json',clock), plan=write('measure.json',observations);
  const saved=file('plain.json');
  const created=invoke('run',scene,'--ticks','5','--record',saved,'--observations',plan,'--actions',write('edits.json',[revised]));
  assert.equal(created.status,0,created.stderr);
  const verified=invoke('verify',saved,'--workers','2');
  assert.equal(verified.status,0,verified.stderr);
  assert.equal(verified.report.observations,11);
  assert.equal(verified.report.revisions,2);
  const log=JSON.parse(fs.readFileSync(saved,'utf8'));
  const packed=studio.openCheckpointStore(file('blocks')).save(log).reference;
  const reference=write('packed.json',{...packed,store:'blocks'});
  assert.equal(invoke('verify',reference).report.status,'verified');
  log.evidence.observations[0].value=100;
  const mismatch=invoke('verify',write('mismatch.json',log));
  assert.equal(mismatch.status,2,mismatch.stderr);
  assert.equal(mismatch.report.mismatch.kind,'observation');
  assert.equal(mismatch.report.mismatch.tick,0);
});
