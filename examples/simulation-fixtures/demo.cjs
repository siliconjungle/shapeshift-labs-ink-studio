const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const studio = require('../..');

const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const output = path.resolve(process.argv[2]??'studio/out/simulation-fixtures');
const file = name=>path.join(output,name);
const save = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
const run = (...args)=>{
  const result = spawnSync(process.execPath,[cli,...args],{cwd:output,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return result.stdout;
};

for (const folder of ['inputs','fixtures','reports']) fs.mkdirSync(file(folder),{recursive:true});
for (const name of ['quay-candidates.world','quay-candidates.actions','quay-opportunities','quay-followups']) {
  fs.copyFileSync(path.join(__dirname,'../story-documents',name+'.json'),file('inputs/'+name+'.json'));
}
const quay = ['sim','fixture','inputs/quay-candidates.world.json','--from','1','--ticks','6',
  '--actions','inputs/quay-candidates.actions.json','--event','story-candidate-rejected',
  '--event-where','{"path":"/reason","value":"candidate-blocked"}'];
run(...quay,'--out','inputs/quay.unreduced.fixture.json');
const reduced = JSON.parse(run(...quay,'--minimize','--out','fixtures/quay.fixture.json'));
assert.equal(reduced.reduction.removed,6);
assert.equal(reduced.commands,3);
run('story','events','fixtures/quay.fixture.json','--format','markdown','--out','reports/quay.events.md');

const world = {format:'ink-studio/world',version:1,id:'notice-board',seed:12,dt:.1,history:{enabled:false}};
const event = (tick,kind)=>({tick,action:'world/event',args:{kind}});
const engine = studio.load().KIT.world.runtime.create({...world,eventActions:{
  reply:{on:{kind:'notice'},actions:[{action:'world/event',args:{kind:'routed-reply'}}]}
}},{recordRun:true});
engine.schedule([event(1,'warmup')]);
engine.advance(2);
engine.schedule([event(4,'queued-at-capture'),event(3,'notice')]);
engine.advance(3);
engine.schedule([event(4,'submitted-after-route')]);
engine.advance(8);
const store = studio.openCheckpointStore(file('inputs/blocks'));
const {reference} = store.save(engine.recording());
save('inputs/notice-board.run.json',{...reference,store:'blocks'});
const order = JSON.parse(run('sim','fixture','inputs/notice-board.run.json','--from','2','--ticks','4',
  '--out','fixtures/command-order.fixture.json'));
assert.equal(order.events,5);

const patch = {tick:3,action:'world/patch',args:{edits:[{op:'remove',path:'/metadata/absent'}]}};
save('inputs/fault.world.json',{...world,id:'missing-metadata',commands:[event(1,'warmup'),patch,event(5,'unused')]});
const fault = JSON.parse(run('sim','fixture','inputs/fault.world.json','--ticks','6','--fault',
  '--minimize','--out','fixtures/missing-metadata.fixture.json'));
assert.equal(fault.fault.tick,3);
assert.equal(fault.completedTick,2);

for (const name of ['quay','command-order','missing-metadata']) {
  const file = 'fixtures/'+name+'.fixture.json', report = 'reports/'+name+'.verify.json';
  run('sim','verify',file,'--out',report);
}
console.log('Quay: captured ticks 1–3, removed '+reduced.reduction.removed+' scene entries and commands');
console.log('Command order: captured ticks 2–4 with event routing and late submissions');
console.log('Missing metadata: reproduced the fault at tick 3 and verified the tick 2 checkpoint');
