const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: { world: W } } = require('..').load();
const json = value => JSON.parse(JSON.stringify(value));
const tuning = { height: 1, radius: .15, maxStep: 1 / 60 };
const controllers = {
  runner: { kind: 'walk', speed: 2.1 }, climber: { kind: 'climb', verticalSpeed: 2, acceleration: 32 },
  diver: { kind: 'swim', speed: 2.8, currentScale: 1.5 }, pilot: { kind: 'fly', speed: 6, verticalSpeed: 4 },
  cart: { kind: 'vehicle', speed: 5, reverseSpeed: 2, braking: 14 }
};
const ground = { y: 0, normal: [0, 1, 0], id: 'terrain' };
const flat = { supports: () => [ground], clearance: p => p[1] };

test('one actor changes between five profiles and retains collision, support and carried data', () => {
  const c = W.characters.create({ tuning, controllers, defaultController: 'runner' });
  const scene = { ...flat,
    clearance: ([x,y]) => Math.min(y, Math.abs(x - 3.7) - .012),
    climbAt: ([x]) => x > .6 && x < 1.35 ? { normal: [1,0,0] } : false,
    mediumAt: ([x,y]) => x>1.4 && x<3 && y<1.5 ?
      { kind:'water',current:[0,0,.3] } : { kind:'air' }
  };
  let actor = c.state({ position:[0,.5,0], inventory:['lamp'] });
  function step(input, seconds) {
    const result=c.step(actor,input,seconds,scene);
    actor=result.actor;
    assert.ok(c.fits(scene,actor.position));
    return result;
  }
  assert.equal(step({move:[1,0]},.49).actor.mode,'ground');
  assert.ok(actor.position[0]>.7 && actor.position[0]<1.15);
  const climb = step({controller:'climber',vertical:1,move:[1,0]},.38);
  assert.equal(climb.actor.mode,'climb');
  assert.ok(climb.actor.position[1]>1.05);
  assert.ok(climb.actor.position[0]<1.13);
  assert.deepEqual(climb.events.find(row=>row.type==='controller').to,'climber');

  const swim=step({controller:'diver',move:[1,0],vertical:-.6,climb:false},.59);
  assert.equal(swim.actor.mode,'swim');
  assert.ok(swim.actor.position[0]>1.65 && swim.actor.position[0]<3);
  assert.ok(swim.actor.position[2]>.06);

  const flight=step({controller:'pilot',move:[1,0],vertical:1},.71);
  assert.equal(flight.actor.mode,'fly');
  assert.ok(flight.blocked && flight.actor.position[0]<3.551);
  assert.ok(flight.actor.position[1]>1.8);
  assert.ok(flight.segments.length>4);
  assert.equal(step({},.05).actor.controller,'pilot');
  const landed=step({controller:'cart',throttle:0},1.15);
  assert.equal(landed.actor.mode,'vehicle');
  assert.equal(landed.support.support,'terrain');
  assert.ok(landed.events.some(row=>row.type==='land'));
  assert.deepEqual(actor.inventory,['lamp']);
  assert.deepEqual(c.state(json(actor)),actor);
});

test('a vehicle turns under throttle, brakes, reverses and stops at thin obstacles', () => {
  const c=W.characters.create({tuning,controllers});
  const start=c.state({position:[0,.5,0],forward:[0,0,-1]});
  const straight=c.step(start,{controller:'cart',throttle:1,steer:0},.38,flat);
  assert.equal(straight.actor.mode,'vehicle');
  assert.ok(straight.actor.position[2]<-.3);
  assert.equal(straight.actor.position[0],0);
  const turned=c.step(straight.actor,{throttle:1,steer:1,jump:true},.41,flat);
  assert.ok(turned.actor.forward[0]>.6 && turned.actor.position[0]>.35);
  assert.equal(turned.actor.position[1],.5);
  assert.ok(!turned.events.some(row=>row.type==='jump'));

  const brake=c.step(turned.actor,{throttle:0},.42,flat);
  assert.ok(Math.hypot(...brake.actor.velocity)<1e-7);
  const reverse=c.step(brake.actor,{throttle:-1},.42,flat);
  assert.ok(reverse.actor.position[0]<brake.actor.position[0]);
  assert.ok(Math.hypot(...reverse.actor.velocity)<=2.001);
  const wall={...flat,clearance:([,y,z])=>Math.min(y,Math.abs(z+.56)-.01)};
  const contact=c.step(start,{controller:'cart',throttle:1},.65,wall);
  assert.ok(contact.blocked);
  assert.ok(contact.actor.position[2]>-.41);
  assert.ok(c.fits(wall,contact.actor.position));
});

test('climbing requires an authored surface and follows gravity-local up', () => {
  const c=W.characters.create({tuning,controllers,defaultController:'climber'});
  const world={gravityAt:()=>({acceleration:[-9,0,0]}),clearance:([x])=>x,
    climbAt:([x])=>x<1.25?{normal:[0,1,0]}:false};
  const start=c.state({position:[.5,0,0],up:[1,0,0]});
  const moved=c.step(start,{vertical:1},.28,world);
  assert.ok(moved.actor.position[0]>.85);
  assert.deepEqual(json(moved.actor.up),[1,0,0]);
  assert.equal(moved.actor.mode,'climb');
  const released=c.step(moved.actor,{climb:false},.15,world);
  assert.equal(released.actor.mode,'air');
  const noSite={...world,climbAt:()=>false};
  assert.notEqual(c.step(start,{vertical:1},.12,noSite).actor.mode,'climb');
  assert.throws(()=>W.characters.create({controllers:{fast:{kind:'fly',acceleration:-1}}}),/movement profile settings/);
  assert.throws(()=>c.step(start,{controller:'missing'},.1,world),/known controller/);
});

test('grounded vehicles keep the usual moving-support attachment and swept handoff', () => {
  let x=0;
  const c=W.characters.create({tuning,controllers,defaultController:'cart'});
  const world={...flat,surfaceMotion:key=>key==='terrain'?{position:[x,0,0]}:null};
  const start=c.state({position:[0,.5,0]});
  const seated=c.step(start,{throttle:0},.05,world).actor;
  assert.equal(seated.surfaceAnchor.id,'terrain');
  x=.23;
  const moved=c.step(c.state(json(seated)),{throttle:0},.05,world);
  assert.equal(moved.actor.mode,'vehicle');
  assert.ok(Math.abs(moved.actor.position[0]-.23)<1e-8);
  assert.equal(moved.segments.length,1);
});

test('declarative controller inputs survive a checkpoint, reproduce events and consume climb fields', () => {
  const source={dt:.05,systems:{
    gravity:{kind:'gravity',config:{frame:{kind:'uniform',acceleration:[0,-10,0]}}},
    rig:{kind:'mechanics',config:{bodies:{floor:{half:[8,.25,8],position:[0,-.25,0],fixed:true}}}},
    zones:{kind:'fields',config:{fields:{climb:{type:'number',default:1,bounds:{min:[-2,0,-2],max:[2,4,2]}}}}},
    movement:{kind:'characters',config:{
      gravity:'gravity/frame',clearance:'rig/clearance',support:'rig/ray',climbField:'zones/climb',controllers,
      characters:{hero:{position:[0,.5,0],tuning,controller:'runner'}}
    }}
  }};
  const R=W.runtime,run=R.create(source,{recordRun:true});
  const input=(tick,port,value)=>({tick,action:'world/input',args:{port:'movement/'+port,value}});
  run.schedule([
    input(2,'controller.hero',{name:'climber'}),input(2,'vertical.hero',1),
    input(10,'controller.hero',{name:'pilot'}),input(14,'controller.hero',{name:'auto'}),input(14,'vertical.hero',0),
    input(34,'controller.hero',{name:'cart',throttle:1,steer:.45})
  ]);
  run.advance(6);
  const read=r=>r.query().probe('movement/actors').value.hero;
  assert.equal(read(run).mode,'climb');
  assert.ok(read(run).position[1]>.8);
  const saved=json(run.checkpoint());
  const reopened=R.create(saved.world,{checkpoint:saved});
  reopened.advance(42);
  run.advance(42);
  assert.deepEqual(json(reopened.checkpoint()),json(run.checkpoint()));
  assert.equal(read(reopened).mode,'vehicle');
  assert.deepEqual(run.history.filter(event=>event.kind==='character-controller').map(event=>event.to),
    ['climber','pilot','auto','cart']);
  assert.equal(R.verify(json(run.recording())).status,'verified');
});

test('an existing custom movement mode name still works under the automatic profile', () => {
  const c=W.characters.create({controllers,selectMode:()=> 'fly',
    modes:{fly:()=>({velocity:[0,.25,0],actor:{legacy:true}})}});
  const result=c.step(c.state({position:[0,.5,0]}),{},.11,flat);
  assert.equal(result.actor.mode,'fly');
  assert.equal(result.actor.legacy,true);
});
