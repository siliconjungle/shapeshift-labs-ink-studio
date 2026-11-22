const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const out = path.resolve(process.argv[2]??'studio/out/committed-events');
fs.mkdirSync(out,{recursive:true});
const save = (file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
const read = file=>JSON.parse(fs.readFileSync(path.join(out,file),'utf8'));
function run(...args) {
  const result = spawnSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
function envelopes(source,file,...args) {
  run('story','events',source,'--format','envelopes','--out',file,...args);
  return read(file).events;
}

save('notices.world.json',{format:'ink-studio/world',version:1,id:'notice-board',dt:.1,history:{enabled:false},
  commands:[{tick:1,id:'call',action:'world/event',args:{kind:'crates-arrived',count:3,
    subjects:{carrier:{kind:'agent',id:'dock/mira'}}}}],
  eventActions:{receipt:{on:{kind:'crates-arrived'},actions:[{action:'world/event',args:{kind:'receipt-posted'}}]}}});
run('sim','run','notices.world.json','--ticks','1','--checkpoint','notices.checkpoint.json');
const [arrived]=envelopes('notices.checkpoint.json','main.events.json');
assert.equal(arrived.id,'1.0');
for (const branch of ['east','west']) {
  const record=branch+'.run.json', fixture=branch+'.fixture.json';
  run('sim','fork','notices.checkpoint.json','--branch',branch,'--ticks','2','--record',record);
  run('sim','fixture',record,'--out',fixture);
  run('sim','verify',fixture,'--out',branch+'.verify.json');
  const [receipt]=envelopes(fixture,branch+'.events.json');
  assert.deepEqual([receipt.id,receipt.branch,receipt.causes[0]],
    ['2.0',branch,{type:'event',id:'1.0',world:'notice-board',branch:'main'}]);
}

const stories=path.resolve(__dirname,'../story-documents');
run('sim','run',path.join(stories,'quay-candidates.world.json'),'--actions',
  path.join(stories,'quay-candidates.actions.json'),'--ticks','6','--record','quay.run.json');
run('sim','fixture','quay.run.json','--from','2','--ticks','6','--out','quay.fixture.json');
run('sim','verify','quay.fixture.json','--out','quay.verify.json');
const rows=envelopes('quay.fixture.json','quay.events.json','--story','quay-opportunities/repair-shift');
const stage=rows.find(row=>row.kind==='story-stage-entered'), started=rows.find(row=>row.kind==='story-started');
assert.equal(stage.stage,'provision');
assert.equal(stage.visit,1);
assert(started.causes.some(row=>row.type==='event'&&row.id==='1.0'));
console.log('East and west each commit event 2.0 and link it to main/1.0.');
console.log('The quay trace identifies the provision stage and links the story start to its original trigger.');
