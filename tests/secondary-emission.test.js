'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const example = require('../examples/secondary-emission/scene.cjs');
const { KIT:K, makeBuilder } = Ink.load();

const water = { id:'basin',material:'water',y:0,bounds:[-2,-1,0,1] };
const stone = { id:'paving',material:'stone',y:0,bounds:[0,-1,2,1] };
const ledge = { id:'ledge',material:'stone',y:1,bounds:[-.5,-.5,.5,.5] };
const shot = (id,x,extra={}) =>
  ({ id,time:0,point:[x,2,0],velocity:[0,-2,0],radius:.1,gravity:0,life:2,...extra });
const close = (actual,expected) => assert(Math.abs(actual-expected)<1e-9, actual+' versus '+expected);
const recipe = { format:'ink-studio/material-response',version:1,materials:{
  water:{ chart:{bounds:[-2,-1,0,1]},ripple:{color:'#7afec8'} },
  stone:{ particles:{count:12,color:'#ffcf9f'} }
} };

test('sweep finds the earliest receiving surface and authored flights stop at their computed hits', () => {
  const sweep = K.particleImpacts.sweep([water,stone,ledge]);
  const hit = sweep([-.25,3,0],[-.25,-1,0],.1);
  assert.equal(hit.receiver,'ledge');
  assert.deepEqual(hit.point,[-.25,1,0]);
  close(hit.fraction,.475);
  assert.equal(sweep([3,3,0],[3,-2,0],.1),null);
  assert.equal(sweep([1,-.5,0],[1,3,0],.1),null);
  assert.equal(sweep([1,1,0],[1,.1,0],.1).fraction,1);
  const spec = { receivers:[water,stone,ledge], particles:[
    shot('fall-water',-1),shot('under-ledge',.25),shot('outside',3),
    shot('rises',1,{point:[1,-.4,0],velocity:[0,4,0],gravity:8}),
    shot('expires',-1,{life:.5})
  ]};
  const flights=K.particleImpacts.compile(spec);
  const contacts=flights.contacts();
  assert.deepEqual(contacts.map(({particle,receiver})=>[particle,receiver]),[
    ['under-ledge','ledge'],['rises','paving'],['fall-water','basin']
  ]);
  close(contacts[0].time,.45);
  close(contacts[1].time,.5+Math.sqrt(0.5)/2);
  close(contacts[2].time,.95);
  assert.equal(flights.frame(.2).length,5);
  assert.equal(flights.frame(.96).length,1);
  assert.equal(flights.frame(2).length,0);
  assert.deepEqual(flights.frame(.2),K.particleImpacts.compile(flights.snapshot()).frame(.2));
  assert.throws(()=>K.particleImpacts.compile({...spec,receivers:[water,water]}),/unique ID/);
  const touching = K.particleImpacts.compile({receivers:[ledge],particles:[
    shot('touching',0,{point:[0,1+.13,0],radius:.13})
  ]});
  assert.equal(touching.contacts()[0].time,0);
  assert.equal(touching.frame(0).length,0);
});

test('portable tracks regenerate collisions when edited and retain external particle receipts', () => {
  const particleImpacts={receivers:[water,stone],particles:[shot('drop',-1)]};
  const live=K.particleImpacts.contact({receiver:'paving',material:'stone',point:[1,0,0]},
    {particle:'live-1',time:1.2,velocity:[1,-2,0],source:'host'});
  const track=K.materialResponse.create(recipe,{particleImpacts,contacts:[live]});
  assert.deepEqual(track.impacts(.95).map(row=>row.particle),['drop']);
  assert.equal(track.add([live]),0);
  const snapshot=JSON.parse(JSON.stringify(track.snapshot()));
  assert.deepEqual(snapshot.contacts.map(row=>row.particle),['live-1']);
  assert.deepEqual(K.materialResponse.create(snapshot.recipe,snapshot).impacts(),track.impacts());
  snapshot.particleImpacts.particles[0].point[0]=1;
  const reopened=K.materialResponse.create(snapshot.recipe,snapshot);
  assert.deepEqual(reopened.impacts().map(row=>row.material),['stone','stone']);
  assert.equal(track.impacts()[0].material,'water');
  assert.throws(()=>K.materialResponse.create(recipe,{particleImpacts,contacts:[track.impacts()[0]]}),/distinct/);
});

test('live splat particles consume a primary at contact, including a hit in its last update', () => {
  const B=makeBuilder(11,[0x222d35,0xffdb73]),pool=K.pool(B,5),world=B.finish({}),stage=K.stage(world);
  const track=K.materialResponse.create(recipe);
  const particles=stage.add(K.particles(stage,pool,{impacts:{track,receivers:[water,stone],source:'live'}}));
  for (const x of [-1,1]) particles.emit({p:[x,.36,0],v:[0,-3,0],size:.06,life:.15});
  particles.emit({p:[-1,.36,0],v:[0,-3,0],size:.06,life:.15,materialImpact:false});
  particles.emit({p:[-1,.36,0],v:[0,0,0],size:.06,life:1,fixed:true});
  particles.update(.2,.2);
  assert.deepEqual(track.impacts().map(hit=>hit.material),['water','stone']);
  assert(track.impacts().every(hit=>hit.particle.startsWith('live/particle-') && hit.point[1]===0));
  close(track.impacts()[0].time,.1);
  particles.update(.2,.4);
  assert.equal(track.impacts().length,2);
  assert.equal(particles.live,1);
});

function fixture({KIT}, spec) { return KIT.diorama.build(spec); }
const dim = { w:180,h:104 }, flightTime=.54, hitTime=.99;
function counts(rgb) {
  let primary=0,ripple=0;
  for(let i=0;i<rgb.length;i+=3) {
    const c=rgb[i]*65536+rgb[i+1]*256+rgb[i+2];
    if(c===0xfff1d2)primary++;
    if(c===0xa9e5d6)ripple++;
  }
  return {primary,ripple};
}

test('headless renders the same launches before impact, a ring in water and a separate stone burst', () => {
  const spec=example(),world=fixture(Ink.load(),spec);
  const draw=(t,renderGraph)=>Ink.render(world,{...dim,t,px:1,raw:true,renderGraph}).rgb;
  const flight=draw(flightTime),impact=draw(hitTime);
  assert(counts(flight).primary>=2);
  assert.equal(counts(flight).ripple,0);
  assert.equal(counts(impact).primary,0);
  assert(counts(impact).ripple>8);
  const ordinary=world.look.renderGraph;
  const noSparks={...ordinary,passes:ordinary.passes.map(pass=>
    pass.id==='material-response-particles'?{...pass,enabled:false}:pass)};
  const baseline=draw(hitTime,noSparks);
  let spark;
  for(let p=0;p<impact.length;p+=3) if(impact[p]>baseline[p]+25 && p/3%dim.w>dim.w/2) {
    spark=[p/3%dim.w,Math.floor(p/3/dim.w)];
    break;
  }
  assert(spark);
  const report=Ink.inspectEffectPixel(world,{...dim,t:hitTime,px:1,raw:true,at:spark});
  assert.equal(report.winner?.kind,'particle');
  assert.equal(report.winner.event.particle,'right-1');
  assert.equal(report.winner.event.receiver,'paving');
  draw(0);
  assert.deepEqual(draw(hitTime),impact);
});

test('WebGL plays and rewinds the portable launch and material collision passes',
  {skip:!process.env.INK_TEST_CHROME},() => {
    const data=runWebGL({},fixture,(kit,build,backend,{spec,dim,flightTime,hitTime})=>{
      const world=build(kit,spec),draw=backend(dim.w,dim.h,{raw:true,offscreen:true});
      const graph=world.look.renderGraph;
      const without={...graph,passes:graph.passes.map(pass=>pass.id==='material-response-particles'?{...pass,enabled:false}:pass)};
      const image=(time,renderGraph)=>{draw.draw(world,{time,renderGraph});return draw.image();};
      try {
        return { flight:image(flightTime),hit:image(hitTime),without:image(hitTime,without),
          rewind:image(flightTime),again:image(hitTime),materials:world.materialResponse.impacts(hitTime).map(row=>row.material) };
      } finally {draw.close();}
    },{spec:example(),dim,flightTime,hitTime});
    const rgb=name=>Buffer.from(data[name],'base64');
    assert.equal(data.flight,data.rewind);
    assert.equal(data.hit,data.again);
    assert(counts(rgb('flight')).primary>=2);
    assert.equal(counts(rgb('flight')).ripple,0);
    assert(counts(rgb('hit')).ripple>8);
    assert.deepEqual(data.materials,['water','stone']);
    const hit=rgb('hit'),bare=rgb('without');
    assert(hit.some((value,i)=>i%3===0 && value>bare[i]+25 && i/3%dim.w>dim.w/2));
  });

test('CLI opens the authored scene and reports receiver materials from collisions at the requested time', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-secondary-emission-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const scene=path.join(dir,'kiln.json'),out=path.join(dir,'impacts.json');
  fs.writeFileSync(scene,JSON.stringify(example()));
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'effect','impacts',scene,'--t','1','--out',out],
    {stdio:['ignore','pipe','pipe']});
  const report=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.equal(report.format,'ink-studio/particle-impacts');
  assert.deepEqual(report.events.map(row=>[row.particle,row.receiver,row.material]),[
    ['left-1','basin','water'],['right-1','paving','stone']
  ]);
});
