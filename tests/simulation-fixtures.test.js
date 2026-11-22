const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const studio = require('..');

const W = studio.load().KIT.world;
const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const stories = path.resolve(__dirname,'../examples/story-documents');
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const write = (file,value) => fs.writeFileSync(file,JSON.stringify(value));
const sim = (cwd,...args) => spawnSync(process.execPath,[cli,'sim',...args],{cwd,encoding:'utf8'});
const event = (tick,kind) => ({tick,action:'world/event',args:{kind}});
const world = {format:W.format,version:1,id:'fixture-test',seed:124,dt:.1,history:{enabled:false}};

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-fixture-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for (const name of ['author','review']) fs.mkdirSync(path.join(root,name));
  return [path.join(root,'author'),path.join(root,'review')];
}

test('reduces the scene and commands while keeping the exact story event and portable linked definitions', t=>{
  const [source,review] = workspace(t);
  for (const file of ['quay-candidates.world','quay-opportunities','quay-followups','quay-candidates.actions'])
    fs.copyFileSync(path.join(stories,file+'.json'),path.join(source,file+'.json'));
  const focus = ['--from','1','--ticks','6','--actions','quay-candidates.actions.json','--event','story-candidate-rejected',
    '--event-where','{"path":"/reason","value":"candidate-blocked"}'];
  const pack = (...args)=>sim(source,'fixture','quay-candidates.world.json',...focus,...args);
  const full = pack('--out','original.fixture.json'), reduced = pack('--minimize','--out','reduced.fixture.json');
  assert.equal(full.status,0,full.stderr);
  assert.equal(reduced.status,0,reduced.stderr);
  const original = read(path.join(source,'original.fixture.json'));
  const fixturePath = path.join(source,'reduced.fixture.json'), fixture = read(fixturePath);
  assert.equal(fixture.checkpoint.tick,1);
  assert.equal(fixture.until,3);
  assert.deepEqual(Object.keys(fixture.checkpoint.world.systems),['stock']);
  assert.equal(fixture.checkpoint.pending.length,3);
  assert.equal(fixture.reduction.removed,6);
  const witness = item=>item.expect.events.find(row=>row.kind==='story-candidate-rejected');
  assert.deepEqual(witness(original),witness(fixture));
  assert(fixture.checkpoint.world.storyDocuments.every(doc=>doc.stories));
  assert(fs.statSync(fixturePath).size<fs.statSync(path.join(source,'original.fixture.json')).size);
  const alias = path.join(source,'linked-story.fixture.json');
  fs.linkSync(path.join(source,'quay-opportunities.json'),alias);
  const denied = pack('--out',alias);
  assert.equal(denied.status,1,denied.stderr);
  assert.match(denied.stderr,/separate from the source files/);
  fs.copyFileSync(fixturePath,path.join(review,'case.fixture.json'));
  fs.rmSync(source,{recursive:true});
  const verify = sim(review,'verify','case.fixture.json');
  assert.equal(verify.status,0,verify.stderr);
  assert.equal(JSON.parse(verify.stdout).status,'verified');
  const events = spawnSync(process.execPath,[cli,'story','events','case.fixture.json','--format','events'],{cwd:review,encoding:'utf8'});
  assert.equal(events.status,0,events.stderr);
  assert.deepEqual(JSON.parse(events.stdout).events,fixture.expect.events);
  const replay = sim(review,'replay','case.fixture.json','--checkpoint','end.json','--record','review.run.json');
  assert.equal(replay.status,0,replay.stderr);
  assert.equal(read(path.join(review,'end.json')).tick,3);
  assert.equal(sim(review,'verify','review.run.json').status,0);
});

test('slices a block-backed run and preserves commands on either side of the checkpoint boundary', t=>{
  const [source,review] = workspace(t);
  const run = W.runtime.create({...world,eventActions:{reply:{on:{kind:'notice'},actions:[{
    action:'world/event',args:{kind:'routed'}
  }]}}},{recordRun:true});
  run.schedule([event(2,'prefix')]);
  run.advance(2);
  run.schedule([event(4,'capture-boundary')]);
  run.schedule([event(3,'notice')]);
  run.advance(3);
  run.schedule([event(4,'submitted-after-route')]);
  run.advance(5);
  const store = studio.openCheckpointStore(path.join(source,'blocks'));
  const {reference} = store.save(run.recording());
  write(path.join(source,'source.run.json'),{...reference,store:'blocks'});
  const result = sim(source,'fixture','source.run.json','--from','2','--ticks','4','--out','case.fixture.json');
  assert.equal(result.status,0,result.stderr);
  const data = read(path.join(source,'case.fixture.json'));
  assert.deepEqual(data.checkpoint.pending.map(row=>row.args.kind),['notice','capture-boundary']);
  assert.deepEqual(data.submissions,[{tick:3,commands:[event(4,'submitted-after-route')]}]);
  assert.deepEqual(data.expect.events.map(row=>row.kind),['notice','event-action-scheduled','capture-boundary','routed','submitted-after-route']);
  assert.equal(data.checkpoint.history.length,0);
  write(path.join(review,'case.fixture.json'),data);
  fs.rmSync(source,{recursive:true});
  assert.equal(sim(review,'verify','case.fixture.json').status,0);
  data.expect.events[3].kind='corrupt';
  write(path.join(review,'bad.fixture.json'),data);
  const failed = sim(review,'verify','bad.fixture.json','--out','failure.json');
  assert.equal(failed.status,2,failed.stderr);
  const {mismatch} = read(path.join(review,'failure.json'));
  assert.deepEqual([mismatch.kind,mismatch.tick,mismatch.expected.kind,mismatch.actual.kind],['event',4,'corrupt','routed']);
  assert.equal(sim(review,'replay','bad.fixture.json','--checkpoint','blocked.json').status,2);
  assert.equal(fs.existsSync(path.join(review,'blocked.json')),false);
  data.expect.events[3].kind='routed';
  data.expect.endSha256='0'.repeat(64);
  write(path.join(review,'bad.fixture.json'),data);
  const stateFailure = sim(review,'verify','bad.fixture.json');
  assert.equal(stateFailure.status,2,stateFailure.stderr);
  assert.equal(JSON.parse(stateFailure.stdout).mismatch.kind,'checkpoint');
});

test('captures the attempted fault and verifies the last successful checkpoint', t=>{
  const [source] = workspace(t);
  const patch = {tick:3,action:'world/patch',args:{edits:[{op:'remove',path:'/metadata/absent'}]}};
  write(path.join(source,'world.json'),{...world,commands:[event(1,'unrelated'),patch,event(5,'unused')]});
  const args = ['fixture','world.json','--ticks','6','--out','fault.fixture.json'];
  const withoutFault = sim(source,...args);
  assert.equal(withoutFault.status,1,withoutFault.stderr);
  assert.equal(fs.existsSync(path.join(source,'fault.fixture.json')),false);
  const fault = sim(source,...args,'--fault','--minimize');
  assert.equal(fault.status,0,fault.stderr);
  const report = JSON.parse(fault.stdout);
  assert.equal(report.completedTick,2);
  assert.equal(report.fault.tick,3);
  assert.match(report.fault.message,/missing path/);
  assert.equal(report.reduction.removed,2);
  assert.equal(sim(source,'verify','fault.fixture.json').status,0);
});
