const assert=require('node:assert/strict');
const {test}=require('node:test');
const {KIT:K}=require('..').load();
const {openProjector}=require('../cli/patch-projector.js');
const W=K.world, G=K.procedural.graph, snapshots=W.liveSnapshots;
const link=(node,port='value')=>({node,port});

function source(stream) {
  const world={format:W.format,version:1,id:'dock',dt:.1,history:{enabled:false},
    commands:Array.from({length:8},(_,i)=>({tick:i+1,action:'world/event',args:{kind:'arrival'}})),
    systems:{stock:{kind:'store',config:{accounts:{dock:{resource:'cargo',units:'crate',type:'integer',initial:3}}}}}};
  const run=W.runtime.create(world), publisher=snapshots.create({stream});
  const queries=W.graphPorts.queries({stock:{field:'world/account',args:{account:'stock/dock'}}});
  const frame=()=>W.graphPorts.frameOf(run.view(),run.query(),queries,{events:run.committedEvents()});
  function step() { run.step(); publisher.publish(frame()); }
  return {publisher,frame,step};
}

test('join, gap and restart atomically replace state without backfilling effects',()=>{
  const {publisher,step,frame}=source('dock-a'), mirror=snapshots.receiver();
  step();
  const joined=publisher.pull();
  const first=mirror.apply(joined);
  assert.deepEqual([first.report.status,first.report.reason,first.value.tick,first.value.samples.stock.value.balance],
    ['snapshot','join',1,3]);
  assert.deepEqual(first.value.events,[]);
  assert.equal(first.value.eventFrom,2);
  assert.equal(mirror.apply(publisher.pull(first.report.cursor)).report.status,'idle');
  step();
  const live=publisher.pull(mirror.cursor());
  assert.equal(live.effects[0].id,'2.0');
  assert.equal(live.state.events.length,0);
  assert.throws(()=>mirror.apply({...live,effects:[live.effects[0],live.effects[0]]}),/Invalid live snapshot/);
  assert.throws(()=>mirror.apply({...live,effects:[{...live.effects[0],branch:'other'}]}),/Invalid live snapshot/);
  assert.equal(mirror.cursor().tick,1);
  assert.deepEqual(mirror.apply(live).value.events.map(event=>event.id),['2.0']);
  for(const repeat of [live,null,publisher.pull(mirror.cursor())]) assert.deepEqual(mirror.apply(repeat).value.events,[]);
  step();
  step();
  const gap=publisher.pull(mirror.cursor()), repaired=mirror.apply(gap);
  assert.deepEqual([repaired.report.reason,repaired.value.tick,repaired.report.effects],['gap',4,0]);
  assert.equal(mirror.apply(live).report.status,'stale');
  assert.throws(()=>publisher.publish(frame()),/increasing committed ticks/);
  step();
  assert.deepEqual(mirror.apply(publisher.pull(mirror.cursor())).value.events.map(row=>row.id),['5.0']);
  const replacement=source('dock-b');
  replacement.step();
  assert.equal(mirror.apply(replacement.publisher.pull()).report.status,'resync');
  const reset=mirror.apply(replacement.publisher.pull(mirror.cursor()));
  assert.deepEqual([reset.report.reason,reset.value.tick,reset.report.effects],['stream-changed',1,0]);
  assert.equal(mirror.apply(gap).report.status,'resync');
});

test('live graph reads query state continuously and pulses only on new edges',()=>{
  const graph=G.create({inputs:{packet:{type:'liveSnapshot',default:null}},nodes:{
    live:{op:'sim.liveWorld',inputs:{packet:{input:'packet'}}},
    cargo:{op:'sim.worldRecord',inputs:{source:link('live'),options:{query:'stock',missing:'hold',fallback:{balance:0}}}},
    arrival:{op:'sim.worldPulse',inputs:{source:link('live'),options:{kind:'arrival'}}}
  },outputs:{cargo:link('cargo'),arrival:link('arrival'),live:link('live','report')}});
  let time=0;
  const at=(packet)=>graph.evaluate({packet},{time:time++}).outputs;
  const {publisher,step}=source('dock');
  assert.equal(at(null).cargo.balance,0);
  step();
  const joined=at(publisher.pull());
  assert.equal(joined.cargo.balance,3);
  assert.equal(joined.arrival.entries.length,0);
  step();
  const update=publisher.pull(joined.live.cursor), arrived=at(update);
  assert.equal(arrived.arrival.entries[0].event.id,'2.0');
  assert.equal(at(update).arrival.entries.length,0);
  const held=at(null);
  assert.equal(held.cargo.balance,3);
  assert.equal(held.arrival.entries.length,0);
  const newSource=snapshots.create({stream:'replacement'});
  newSource.publish({...update.state,tick:3,eventFrom:4,samples:{}});
  assert.equal(at(newSource.pull(held.live.cursor)).cargo.balance,0);
  graph.clear();
  assert.equal(at(null).live.status,'missing');
});

test('a late projector receives the current raster and only counts skips after its baseline',async t=>{
  const displayed=[];
  const projector=await openProjector({port:0,wait:false,surfaces:[]},null,
    {afterFrame:skipped=>displayed.push(skipped),afterAttach(){}});
  t.after(()=>projector.close());
  const session=await fetch(projector.url+'session').then(response=>response.json());
  const headers={'x-ink-client':'late-viewer','x-ink-session':session.key};
  const publish=index=>projector.publish(index,{width:1,height:1,data:Uint8Array.of(index,0,0,255)});
  const read=route=>fetch(projector.url+route,{headers});
  assert.equal((await read('snapshot')).status,204);
  for(const frame of [1,2,3]) publish(frame);
  const first=await read('snapshot');
  assert.equal(first.headers.get('x-ink-state'),'snapshot');
  assert.equal(first.headers.get('x-ink-stream'),session.stream);
  assert.equal(first.headers.get('x-ink-serial'),'3');
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())],[3,0,0,255]);
  assert.equal((await read('frame?after=3')).status,204);
  for(const frame of [4,5]) publish(frame);
  const next=await read('frame?after=3');
  assert.equal(next.headers.get('x-ink-state'),'live');
  assert.equal(next.headers.get('x-ink-serial'),'5');
  assert.deepEqual([...new Uint8Array(await next.arrayBuffer())],[5,0,0,255]);
  assert.equal((await read('frame?after=5')).status,204);
  assert.deepEqual(displayed,[0,1]);
  for(const frame of [6,7,8]) publish(frame);
  const rejoined=await read('snapshot');
  assert.equal(rejoined.headers.get('x-ink-serial'),'8');
  await rejoined.arrayBuffer();
  assert.equal((await read('frame?after=8')).status,204);
  assert.deepEqual(displayed,[0,1,0]);
});
