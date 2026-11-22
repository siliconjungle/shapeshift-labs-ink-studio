const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const Fixture = require('../cli/simulation-fixture.js');
const W = load().KIT.world, R = W.runtime;
const clone = value=>JSON.parse(JSON.stringify(value));
const world = {format:W.format,version:1,id:'dispatch-test',dt:0.1,history:{enabled:false},
  eventActions:{reply:{on:{kind:'notice'},actions:[{action:'world/event',args:{kind:'reply'}}]}},
  commands:[{tick:1,id:'reported',action:'world/event',args:{kind:'notice',body:'box',
    subjects:{reporter:{kind:'actor',id:'crew/mira'}},count:3}}]};

test('committed envelopes preserve scope and routed causes across named siblings and exact replay',()=>{
  const root = R.create(world,{recordRun:true});
  root.advance(1);
  const [notice,scheduled] = root.committedEvents();
  assert.deepEqual(notice,{version:1,world:'dispatch-test',branch:'main',story:null,stage:null,visit:null,
    subjects:[{role:'reporter',kind:'actor',id:'crew/mira'},{role:'body',kind:'body',id:'box'}],
    causes:[{type:'command',world:'dispatch-test',branch:'main',tick:1,index:0,action:'world/event',id:'reported'}],
    id:'1.0',tick:1,kind:'notice',system:'world',
    payload:{body:'box',subjects:{reporter:{kind:'actor',id:'crew/mira'}},count:3}});
  const parent = {type:'event',world:'dispatch-test',branch:'main',id:'1.0'};
  assert.deepEqual(scheduled.causes,[parent]);
  const point = root.checkpoint(), left = root.fork({branch:'left'}), right = root.fork({branch:'right'});
  assert.deepEqual(left.checkpoint(),point);
  assert.equal(left.recording().eventBranch,'left');
  for (const run of [left,right]) {
    run.advance(2);
    const [reply] = run.committedEvents();
    assert.equal(reply.id,'2.0');
    assert.equal(reply.branch,run.eventBranch);
    assert.deepEqual(reply.causes,[parent,{type:'command',world:'dispatch-test',branch:run.eventBranch,
      tick:2,index:0,action:'world/event'}]);
    assert.deepEqual(run.query().probe('world/events',undefined,{kind:'reply',branch:run.eventBranch}).value.events,[reply]);
    assert.equal(run.history.length,0);
    assert.deepEqual(R.replay(clone(run.recording())).committedEvents(),[reply]);
    const fixture = clone(Fixture.build(W,{world,checkpoint:run.checkpoint(),log:run.recording()}));
    assert.equal(fixture.eventBranch,run.eventBranch);
    assert.equal(Fixture.replay(W,fixture).report.status,'verified');
  }
  left.schedule([{tick:3,action:'world/event',args:{kind:'uncommitted'}},
    {tick:3,action:'world/patch',args:{edits:[{op:'remove',path:'/metadata/missing'}]}}]);
  assert.throws(()=>left.step(),/missing path/);
  assert.equal(left.view().tick,2);
  assert.equal(left.committedEvents()[0].kind,'reply');
  assert.deepEqual(root.checkpoint(),point);
});

test('story stages, evidence receipts, transfer accounts and solver trace links share a format',()=>{
  const dir=path.resolve(__dirname,'../examples/story-documents'), file=path.join(dir,'quay-candidates.world.json');
  const source=embedStoryDocuments(JSON.parse(fs.readFileSync(file)),file);
  const run=R.create({...source,causality:true});
  run.schedule(JSON.parse(fs.readFileSync(path.join(dir,'quay-candidates.actions.json'))));
  run.advance(6);
  const {events}=run.query().probe('world/events',undefined,{retained:true,story:'quay-opportunities/repair-shift'}).value;
  const entered=events.find(row=>row.kind==='story-stage-entered');
  const started=events.find(row=>row.kind==='story-started');
  assert.deepEqual([entered.story,entered.stage,entered.visit],['quay-opportunities/repair-shift','provision',1]);
  assert(started.causes.some(row=>row.type==='event'&&row.id==='1.0'));
  const transfers=run.query().probe('world/events',undefined,{retained:true,kind:'transfer',subject:'stock/cache'}).value.events;
  assert(transfers[0].subjects.some(row=>row.kind==='account'&&row.id==='stock/cache'));
  assert(transfers[0].causes.some(row=>row.type==='trace'));
});

test('legacy records and fixtures replay with their original event shape',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-events-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const run=R.create(world,{legacyEvents:true,recordRun:true});
  run.advance(2);
  const log=clone(run.recording());
  assert.equal(log.end.eventStream,undefined);
  assert.equal(R.verify(log).status,'verified');
  const fixture=clone(Fixture.build(W,{world,checkpoint:log.end,log}));
  assert.equal(Fixture.replay(W,fixture).report.status,'verified');
  const file=path.join(directory,'legacy.fixture.json');
  fs.writeFileSync(file,JSON.stringify(fixture));
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'story','events',
    file,'--format','envelopes'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const {events}=JSON.parse(result.stdout);
  assert.equal(events[0].branch,'main');
  assert.equal(events[0].payload.count,3);
  const resumed=R.create(log.end.world,{checkpoint:log.end});
  resumed.schedule([{tick:3,action:'world/event',args:{kind:'continued',causes:['2.0']}}]);
  resumed.step();
  assert.equal(resumed.committedEvents()[0].causes[0].id,'2.0');
  assert.equal(resumed.checkpoint().eventStream.version,1);
});
