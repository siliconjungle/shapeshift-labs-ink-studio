const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load,validateStoryDocument} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const {runtime:R,storyEvents} = load().KIT.world;

const file = '../examples/story-documents/low-bank-sluice.world.json';
const hint = require('../examples/story-documents/low-bank-sluice.hint.actions.json');
const commitment = require('../examples/story-documents/low-bank-sluice.commitment.actions.json');
const document = 'low-bank-sluice', story = 'rising-water', key = document+'/'+story;
const copy = value=>JSON.parse(JSON.stringify(value));
const source = ()=>embedStoryDocuments(copy(require(file)),path.resolve(__dirname,file));
const probe = (run,field,args)=>run.query().probe('world/'+field,undefined,args).value;
const beats = run=>probe(run,'story-beats',{story:key});
const lifecycle = run=>probe(run,'story-lifecycle')[key];
const balance = (run,name)=>probe(run,'account',{account:'stock/'+name}).balance;
const visits = run=>lifecycle(run).flow.route.map(row=>[row.beat.kind,row.leftAt,row.beat.elapsedTicks,row.beat.by]);
const restore = saved=>R.create(saved.world,{checkpoint:copy(saved)});
const transition = (tick,to)=>({tick,action:'world/story-transition',args:{document,story,to,reason:'rehearsal'}});
const choose = (tick,branch)=>({tick,action:'world/story-choose',args:{document,story,stage:'seepage',visit:1,branch,reason:'dispatch'}});

test('the incident escalates through three beats and changes world state through its events',()=>{
  const world = source(), run = R.create(world);
  const {beats:configured,diagnostics} = R.storyPreflight(world);
  assert.deepEqual(diagnostics,[]);
  assert.equal(configured[key]['repair-shift'].windowTicks,4);
  run.advance(1);
  assert.equal(beats(run).current.kind,'hint');
  assert.deepEqual(beats(run).current.resolve,[{branch:'early-bracing',ready:false,pending:['bank-braced']}]);
  assert.equal(probe(run,'incident-pressure').commitments.used,1);
  run.advance(4);
  assert.equal(beats(run).current.kind,'commitment');
  assert.equal(beats(run).current.elapsedTicks,0);
  run.advance(5);
  assert.equal(balance(run,'working-crews'),1);
  run.advance(8);
  assert.equal(beats(run).current.kind,'consequence');
  assert.equal(balance(run,'powered'),1);
  run.advance(9);
  assert.equal(balance(run,'offline'),1);
  assert.equal(balance(run,'powered'),0);
  run.advance(10);
  assert.deepEqual(visits(run),[['hint',4,3,'timeout'],['commitment',8,4,'timeout'],['consequence',10,2,'timeout']]);
  assert.equal(lifecycle(run).status,'failed');
  assert.equal(balance(run,'working-crews'),0);
  assert.equal(probe(run,'incident-pressure').commitments.used,0);
  assert.equal(probe(run,'incident-cooldowns').scheduled[0].from,11);
  assert.deepEqual(storyEvents.analyze(run.recording(),{story:key}).timeline.filter(({event})=>event.kind==='story-beat-entered')
    .map(({event})=>[event.tick,event.beat.kind]),[[1,'hint'],[4,'commitment'],[8,'consequence']]);
  assert.deepEqual(R.replay(copy(run.recording())).checkpoint(),run.checkpoint());
});

test('world evidence at either cutoff wins before that beat escalates',()=>{
  for (const [actions,kind,at,proof,outcome] of [
    [hint,'hint',4,'state','secured'],
    [commitment,'commitment',8,'event','repaired']
  ]) {
    const run = R.create(source());
    run.schedule(copy(actions));
    run.advance(12);
    const row = lifecycle(run);
    assert.equal(row.status,'completed');
    assert.equal(row.outcome,outcome);
    assert.equal(beats(run).last.by,'resolution');
    assert.equal(beats(run).last.kind,kind);
    assert.equal(beats(run).last.tick,at);
    const [evidence] = Object.values(row.flow.route.at(-1).objectives);
    assert.equal(evidence.receipt.kind,proof);
    assert.equal(evidence.tick,at);
    assert.equal(balance(run,'offline'),0);
    assert.equal(balance(run,'available-crews'),1);
    assert.deepEqual(probe(run,'incident-cooldowns').active,[]);
    assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
  }
});

test('suspension pauses the beat and checkpoint restore preserves its remaining time',()=>{
  const run = R.create(source());
  run.schedule([transition(3,'suspended'),transition(6,'active'),choose(2,'call-crew')]);
  run.advance(5);
  assert.equal(beats(run).lifecycle,'suspended');
  assert.equal(beats(run).current.elapsedTicks,1);
  assert.equal(beats(run).current.remainingTicks,2);
  assert.equal(run.history.find(row=>row.kind==='story-progress-rejected').reason,'story-beat-controlled');
  const resumed = restore(run.checkpoint());
  run.advance(6);
  assert.equal(beats(run).current.elapsedTicks,1);
  run.advance(14);
  resumed.advance(14);
  assert.deepEqual(visits(run),[['hint',8,3,'timeout'],['commitment',12,4,'timeout'],['consequence',14,2,'timeout']]);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(copy(run.recording())).checkpoint(),run.checkpoint());
  const corrupt = copy(run.checkpoint());
  corrupt.storyLifecycleState[key].flow.route[0].beat.elapsedTicks--;
  assert.throws(()=>restore(corrupt),/Invalid saved story lifecycle/);
});

test('an evidenced resolution can retry a blocked settlement while keeping the receipt',()=>{
  const world = source(), {stories} = world.storyDocuments[0], {accounts} = world.systems.stock.config;
  accounts['bonus-pot'] = {...accounts.depot,initial:0};
  accounts['bonus-paid'] = {...accounts.depot,initial:0};
  stories[story].lifecycle.settlement.outcomes.repaired.bonus = {transfer:{from:'stock/bonus-pot',to:'stock/bonus-paid',amount:1}};
  const run = R.create(world);
  run.schedule([...copy(commitment),{tick:11,action:'world/transfer',
    args:{from:'stock/depot',to:'stock/bonus-pot',amount:1,mode:'exact'}}]);
  run.advance(10);
  assert.equal(beats(run).current.kind,'commitment');
  assert.equal(beats(run).current.remainingTicks,0);
  assert.equal(beats(run).current.resolve[0].ready,true);
  assert.equal(lifecycle(run).settlements.blocked.outcome,'repaired');
  assert.equal(balance(run,'working-crews'),1);
  assert.equal(balance(run,'offline'),0);
  const resumed = restore(run.checkpoint());
  resumed.advance(11);
  assert.equal(lifecycle(resumed).status,'completed');
  assert.equal(beats(resumed).last.by,'resolution');
  assert.equal(lifecycle(resumed).flow.route.at(-1).objectives['braces-delivered'].receipt.event.tick,8);
  assert.equal(balance(resumed,'bonus-paid'),1);
  assert.equal(balance(resumed,'working-crews'),0);
});

test('a beat validates its fallback, evidence branches, and duration',()=>{
  const world = source(), doc = world.storyDocuments[0], {seepage} = doc.stories[story].stages;
  seepage.beat.otherwise = 'missing';
  assert.throws(()=>validateStoryDocument(doc),/beat.otherwise.*unknown branch/);
  seepage.beat.otherwise = 'call-crew';
  delete seepage.next['early-bracing'].requires;
  assert.throws(()=>validateStoryDocument(doc),/world resolution branch needs evidence/);
  seepage.next['early-bracing'].requires = ['bank-braced'];
  seepage.next['call-crew'].requires = ['bank-braced'];
  assert.throws(()=>validateStoryDocument(doc),/timeout branch must be unconditional/);
  delete seepage.next['call-crew'].requires;
  seepage.beat.for = 1e50;
  assert.throws(()=>R.storyPreflight(world),/Story beat duration exceeds the world tick budget/);
});
