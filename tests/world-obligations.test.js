const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;
const file = '../examples/story-documents/bridge-credit.world.json';
const payment = require('../examples/story-documents/bridge-credit.payment.actions.json');
const world = ()=>embedStoryDocuments(structuredClone(require(file)),path.resolve(__dirname,file));
const clone = value=>JSON.parse(JSON.stringify(value));
const restore = saved=>R.create(saved.world,{checkpoint:clone(saved)});
const probe = (run,field,args)=>run.query().probe(field,undefined,args).value;
const obligation = (run,name='bridge-advance')=>probe(run,'standing/obligations',{obligation:name});
const command = (tick,action,args)=>({tick,action,args});
const event = (tick,kind,detail)=>command(tick,'world/event',{kind,...detail});
const open = (tick,obligation,args)=>command(tick,'standing/open-obligation',{obligation,...args});
const clear = 'bridge-credit/clear-account', porter = 'funds/porter', guild = 'funds/guild', wardens = 'funds/wardens';

test('a story issues a real debt, native departures move or release duties, and payment starts a later questlet',()=>{
  const run = R.create(world()), unpaid = R.create(world());
  run.schedule(payment);
  run.advance(1);
  assert.equal(obligation(run).debtor,porter);
  assert.equal(obligation(run).terms.amount,4);
  assert.equal(probe(run,'world/account',{account:porter}).balance,4);
  const settlement = probe(run,'world/story-settlements',{story:'bridge-credit/advance'}).costs;
  assert.equal(settlement.effects.find(row=>row.id==='debt').detail.fulfillment.debtorPath,'/from');
  run.advance(2);
  assert.equal(run.events.find(row=>row.kind==='social-action-rejected').reason,'obligation-needs-evidence');
  run.advance(3);
  const departure = probe(run,'standing/departures',{party:porter});
  assert.equal(departure.kind,'agent-despawned');
  assert.equal(obligation(run).debtor,guild);
  assert.deepEqual(obligation(run).handoffs,[{role:'debtor',from:porter,to:guild,event:departure}]);
  assert.deepEqual(Object.keys(probe(run,'standing/obligations',{debtor:guild,status:'open',category:'debt'})),['bridge-advance']);
  assert.equal(obligation(run,'inspection').status,'released');
  assert.equal(obligation(run,'inspection').resolution.party,'clerk');
  assert.equal(obligation(run,'return-tools').status,'open');
  assert.equal(obligation(run,'return-tools').debtor,porter);
  const resumed = restore(run.checkpoint());
  run.advance(5);
  const resolved = obligation(run).resolution;
  assert.equal(obligation(run).status,'fulfilled');
  assert.deepEqual(resolved.payment,{from:guild,to:wardens,amount:4});
  assert.equal(probe(run,'world/account',{account:wardens}).balance,10);
  assert.equal(probe(run,'world/story-lifecycle')[clear].since,5);
  const closed = run.events.find(row=>row.kind==='obligation-resolved');
  const trace = run.query().trace('world/cause',undefined,{event:closed.id}).value;
  assert(trace.nodes.some(row=>row.kind==='transfer'&&row.event===resolved.event.id));
  run.advance(7);
  resumed.advance(7);
  unpaid.advance(7);
  assert.equal(probe(run,'world/story-lifecycle')[clear].outcome,'cleared');
  assert.equal(probe(unpaid,'world/story-lifecycle')[clear],null);
  assert.equal(obligation(unpaid).status,'open');
  assert.deepEqual(run.history,[]);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(clone(run.recording())).checkpoint(),run.checkpoint());
});

test('a fabricated transfer, the former debtor, and partial or blocked transfers cannot clear the assigned debt',()=>{
  const run = R.create(world());
  run.schedule([
    event(4,'transfer',{from:guild,to:wardens,applied:4,status:'full'}),
    command(4,'world/transfer',{from:porter,to:wardens,amount:4,mode:'exact'}),
    command(5,'world/transfer',{from:guild,to:wardens,amount:5,mode:'partial'}),
    command(6,'world/transfer',{from:guild,to:wardens,amount:4,mode:'exact'})
  ]);
  run.advance(4);
  assert.equal(obligation(run).status,'open');
  run.advance(5);
  assert.equal(run.events.find(row=>row.kind==='transfer').status,'partial');
  assert.equal(run.events.find(row=>row.kind==='transfer').applied,4);
  assert.equal(obligation(run).status,'open');
  run.advance(6);
  assert.equal(run.events.find(row=>row.kind==='transfer').status,'blocked');
  assert.equal(obligation(run).status,'open');
});

test('a receipt can settle one matching promise, and native story outcomes can settle obligations too',()=>{
  const authored = world(), promise = {
    debtor:'ferryman',creditor:'harbor',terms:{},category:'promise',
    fulfillment:{event:{kind:'boat-repaired',system:'world'},debtorPath:'/worker'}
  };
  const run = R.create(authored);
  run.schedule([
    open(1,'b-repair',promise),open(1,'a-repair',promise),
    event(1,'boat-repaired',{worker:'ferryman'}),
    open(1,'advance-witnessed',{debtor:'crew',creditor:'harbor',terms:{},fulfillment:{event:{
      kind:'story-transition',system:'world',where:{path:'/outcome',value:'issued'}
    }}}),
    event(2,'boat-repaired',{worker:'apprentice'}),event(3,'boat-repaired',{worker:'ferryman'}),
    event(4,'boat-repaired',{worker:'ferryman'})
  ]);
  run.advance(2);
  assert.equal(obligation(run,'a-repair').status,'open');
  assert.equal(obligation(run,'advance-witnessed').resolution.event.kind,'story-transition');
  run.advance(3);
  assert.equal(obligation(run,'a-repair').closed,3);
  assert.equal(obligation(run,'b-repair').status,'open');
  run.advance(4);
  assert.equal(obligation(run,'b-repair').closed,4);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('a creditor can transfer through several successors and unavailable succession keeps the obligation open',()=>{
  const party = (id,successor)=>({departure:{kind:'left',where:{path:'/party',value:id}},successor});
  const run = R.create({systems:{standing:{kind:'social-ledger',config:{parties:{
    old:party('old','deputy'),deputy:party('deputy','harbor'),elsewhere:party('elsewhere','deputy')
  }}}}});
  const terms = {debtor:'ferryman',creditor:'old',terms:{},onDeparture:{creditor:'transfer'},
    fulfillment:{event:{kind:'receipt'},creditorPath:'/recipient'}};
  run.schedule([
    open(1,'loan',terms),
    open(1,'self', {...terms,debtor:'harbor',creditor:'deputy'}),
    open(1,'unavailable', {...terms,creditor:'elsewhere'}),
    event(2,'left',{party:'old'}),event(3,'left',{party:'deputy'}),event(4,'left',{party:'elsewhere'}),
    open(5,'too-late',terms),
    event(5,'receipt',{recipient:'harbor'})
  ]);
  run.advance(3);
  assert.equal(obligation(run,'loan').creditor,'harbor');
  assert.deepEqual(obligation(run,'loan').handoffs.map(row=>[row.from,row.to]),[['old','deputy'],['deputy','harbor']]);
  assert.equal(run.events.find(row=>row.kind==='obligation-departure-blocked').obligation,'self');
  run.advance(4);
  assert.equal(run.events.find(row=>row.kind==='obligation-departure-blocked').obligation,'unavailable');
  assert.equal(obligation(run,'unavailable').creditor,'elsewhere');
  run.advance(5);
  assert.equal(run.events.find(row=>row.kind==='social-action-rejected').reason,'obligation-party-departed');
  assert.equal(obligation(run,'loan').status,'fulfilled');
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('invalid policies and tampered transfer or resolution receipts are rejected',()=>{
  const run = R.create(world());
  assert.throws(()=>run.schedule([open(1,'invalid',{
    debtor:wardens,creditor:'clerk',terms:{},onDeparture:{creditor:'transfer'}
  })]),/Invalid obligation departure policy/);
  run.schedule(payment);
  run.advance(7);
  let saved = clone(run.checkpoint());
  saved.states.standing.obligations['bridge-advance'].handoffs[0].to = 'someone-else';
  assert.throws(()=>restore(saved),/Invalid saved social ledger/);
  saved = clone(run.checkpoint());
  delete saved.states.standing.obligations['bridge-advance'].resolution;
  assert.throws(()=>restore(saved),/Invalid saved social ledger/);
  saved = clone(run.checkpoint());
  saved.states.standing.obligations['bridge-advance'].resolution.payment.amount = 'four';
  assert.throws(()=>restore(saved),/Invalid saved social ledger/);
});
