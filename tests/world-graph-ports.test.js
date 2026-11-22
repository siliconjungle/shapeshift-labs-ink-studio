const assert=require('node:assert/strict');
const {test}=require('node:test');
const {KIT:K}=require('..').load(), W=K.world, G=K.procedural.graph;
const link=(node,port='value')=>({node,port});
const patch=(tick,op,path,value)=>({tick,action:'world/patch',args:{edits:[{op,path,...(op==='set'&&{value})}]}});
const story={format:'ink-studio/story',version:1,id:'dock',stories:{delivery:{
  kind:'questlet',title:'Dock delivery',triggers:{notice:{event:{kind:'arrival'}}},lifecycle:{progression:true},
  entry:'unload',stages:{unload:{title:'Unload supplies',objectives:{moor:{title:'Secure the boat'}},
    next:{done:{outcome:'delivered'}}}},outcomes:{delivered:{title:'Delivered'}}
}}};
const stage={document:'dock',story:'delivery',stage:'unload',visit:1,reason:'dock-work'};
const world={format:W.format,version:1,id:'test-dock',dt:.1,history:{enabled:false},
  entities:{pier:{position:[0,0,0]},boat:{position:[4,0,0]}},storyDocuments:[story],
  systems:{line:{kind:'routed-links',config:{links:{mooring:{from:{entity:'pier'},to:{entity:'boat'},length:2,stiffness:40}}}}},
  commands:[{tick:1,action:'world/event',args:{kind:'arrival',entity:'boat'}},
    patch(2,'set','/entities/boat/position',[6,0,0]),
    {tick:2,action:'world/story-objective',args:{...stage,objective:'moor',result:'completed'}},
    patch(3,'remove','/entities/boat'),{tick:3,action:'world/story-choose',args:{...stage,branch:'done'}}]
};
const queries={
  tension:{field:'line/links',args:{link:'mooring'},select:'/tension',when:{path:'/active',value:true}},
  objective:{field:'world/story-objective',args:{story:'dock/delivery',objective:'moor'}}
};

function graph(source,options={}) {
  return G.create({
    nodes:{
      state:{op:'sim.world',inputs:{source,options:{...options,queries}}},
      arrival:{op:'sim.worldPulse',inputs:{source:link('state'),options:{kind:'arrival'}}},
      tension:{op:'sim.worldScalar',inputs:{source:link('state'),options:{query:'tension',range:[0,100],missing:'hold',fallback:.1}}},
      objective:{op:'sim.worldRecord',inputs:{source:link('state'),options:{query:'objective',fallback:{status:'unavailable'}}}}
    },
    outputs:{arrival:link('arrival'),pulse:link('arrival','report'),tension:link('tension'),scalar:link('tension','report'),
      objective:link('objective'),record:link('objective','report')}
  });
}
const tape=()=>{
  const run=W.runtime.create(world,{recordRun:true});
  run.advance(4);
  return JSON.parse(JSON.stringify(run.recording()));
};

test('publishes committed pulses, clamps real tension and clears an objective when its stage closes',()=>{
  const graphRun=graph(tape());
  const at=(time,sequence='take')=>graphRun.evaluate({}, {time,sequence}).outputs;
  const before=at(0);
  assert.equal(before.pulse.status,'empty');
  assert.equal(before.objective.status,'unavailable');
  const arrived=at(.1);
  assert.equal(arrived.tension,.8);
  assert.equal(arrived.arrival.entries[0].event.id,'1.0');
  assert.equal(arrived.arrival.entries[0].event.kind,'arrival');
  assert.deepEqual([arrived.objective.story,arrived.objective.stage,arrived.objective.objective,arrived.objective.status],
    ['dock/delivery','unload','moor','pending']);
  const stretched=at(.2);
  assert.equal(stretched.tension,1);
  assert.equal(stretched.scalar.raw,160);
  assert.equal(stretched.scalar.clamped,true);
  assert.equal(stretched.objective.status,'completed');
  assert.equal(stretched.arrival.entries.length,0);
  const lost=at(.3);
  assert.equal(lost.tension,1);
  assert.deepEqual([lost.scalar.status,lost.scalar.fromTick],['held',2]);
  assert.deepEqual(lost.objective,{status:'unavailable'});
  assert.equal(at(.3,'new-cut').tension,.1);
  const afterSource=at(.6);
  assert.equal(afterSource.pulse.status,'missing');
  assert.equal(afterSource.arrival.entries.length,0);
  assert.equal(afterSource.record.status,'fallback');
  graphRun.clear();
  assert.equal(at(.3).tension,.1);
});

test('take intervals retain arrivals between committed samples even when history is disabled',()=>{
  const slow=K.timeDomains.take({fps:5,simulationRate:10});
  const runner=graph(tape());
  const sampled=runner.evaluate({}, {take:slow.at(1)}).outputs;
  assert.equal(sampled.pulse.eventFrom,1);
  assert.deepEqual(sampled.arrival.entries.map(row=>row.event.tick),[1]);
  assert.equal(runner.evaluate({}, {take:slow.at(2)}).outputs.pulse.count,0);
  const fast=K.timeDomains.take({fps:20,simulationRate:10});
  assert.equal(runner.evaluate({}, {take:fast.at(2)}).outputs.pulse.count,1);
  assert.equal(runner.evaluate({}, {take:fast.at(3)}).outputs.pulse.count,0);
  const explicit=graph(tape(),{tick:4,eventFrom:1}).evaluate().outputs;
  assert.deepEqual(explicit.arrival.entries.map(row=>row.event.id),['1.0']);
});

test('graph typing and missing policies reject bad links and offer explicit errors',()=>{
  const incompatible={nodes:{pulse:{op:'sim.worldPulse'},scalar:{op:'sim.worldScalar',
    inputs:{source:link('pulse'),options:{query:'tension'}}}},outputs:{value:link('scalar')}};
  assert.throws(()=>G.create(incompatible),/worldFrame|graph socket/);
  for(const [op,options] of [['sim.worldPulse',{missing:'error'}],['sim.worldScalar',{query:'tension',missing:'error'}],
    ['sim.worldRecord',{query:'objective',missing:'error'}]]) {
    const node=G.create({nodes:{port:{op,inputs:{options}}},outputs:{value:link('port')}});
    assert.throws(()=>node.evaluate(),/unavailable|no world frame/);
  }
  const empty=graph({}).evaluate().outputs;
  assert.equal(empty.arrival.entries.length,0);
  assert.equal(empty.tension,.1);
  assert.deepEqual(empty.objective,{status:'unavailable'});
});
