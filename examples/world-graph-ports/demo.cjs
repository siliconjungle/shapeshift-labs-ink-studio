const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(process.argv[3]??path.join(__dirname,'../..'));
const ink=require(root);

const cli=path.join(root,'cli/ink-studio.js');
const out=path.resolve(process.argv[2]??'studio/out/world-graph-ports');
fs.mkdirSync(out,{recursive:true});
for(const file of ['dock.world.json','dock.graph.json']) {
  if (out!==__dirname) fs.copyFileSync(path.join(__dirname,file),path.join(out,file));
}
const save=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
function command(...args) {
  const result=spawnSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return result.stdout;
}
command('sim','run','dock.world.json','--ticks','4','--record','dock.run.json');
save('dock.verify.json',JSON.parse(command('sim','verify','dock.run.json')));
command('graph','run','dock.graph.json','--at','0.1','--out','arrival');
const specification=require('./dock.graph.json');
const host=ink.createGraphProject(specification,{baseDir:out});
const frames=[.1,.2,.3,0].map(time=>({time,...host.run({time}).outputs}));
host.clear();
frames.push({time:.5,reset:true,...host.run({time:.5}).outputs});
assert.deepEqual(frames.map(row=>row.gaugePercent),[80,100,100,80,10]);
assert.deepEqual(frames.map(row=>row.tensionStatus.status),['live','live','held','live','fallback']);
assert.deepEqual(frames.map(row=>row.objective.status),['pending','completed','unavailable','unavailable','unavailable']);
save('dock.sequence.json',frames);
host.clear();

const take=ink.load().KIT.timeDomains.take({fps:5,simulationRate:10});
const slow=ink.createGraphProject(specification,{baseDir:out});
const sampled=[0,1,2].map(frame=>({frame,...slow.run({take:take.at(frame)}).outputs}));
assert.deepEqual(sampled.map(row=>row.arrivalStatus.count),[0,1,0]);
assert.equal(sampled[1].arrival.entries[0].event.tick,1);
assert.equal(sampled[1].arrivalStatus.tick,2);
save('dock.slow-take.json',sampled);
slow.clear();
console.log('Dock: 80%, 100%, then held at 100% when the anchor disappears. The objective clears when the story closes.');
console.log('Slow take: the 5 fps graph delivers the tick-1 arrival on picture frame 1 at world tick 2.');
