const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const json=value=>JSON.parse(JSON.stringify(value));
const action=(tick,action,args)=>({tick,action,args});
const input=(tick,port,value)=>action(tick,'world/input',{port,value});
const event=(tick,at,kind='bell')=>action(tick,'world/event',{kind,at});
const who=(faction,entity)=>({faction,entity});
const field=(run,key,args)=>run.query().probe('intel/'+key,undefined,args);
const contacts=(run,faction='west')=>field(run,'faction',{faction}).value;
const contact=(run,faction,entity)=>field(run,'contact',who(faction,entity)).value;
const visible=(run,faction,entity)=>field(run,'visible',who(faction,entity)).value;
const site=(x,y=0,z=0)=>[x,y,z];

function world({sealed=false,memory=20}={}){
  return {dt:.1,history:{enabled:false},entities:{bench:{position:site(-2.9,0,1)},lamp:{position:site(3,.7,0)}},
    systems:{
      air:{kind:'ventilation',config:{rooms:{
        west:{bounds:{min:[-6,-1,-3],max:[0,4,3]}},east:{bounds:{min:[0,-1,-3],max:[6,4,3]}}
      },openings:{hatch:{from:'west',to:'east',at:[0,1,0]}}}},
      ears:{kind:'acoustics',config:{layout:'air/acoustic-layout',openings:{hatch:{
        sealed,openLossDb:[0,0,0],closedLossDb:[4,9,15]}}}},
      rig:{kind:'mechanics',config:{bodies:{
        door:{position:site(0,1,0),half:[.12,1,1.2]},
        lamp:{fixed:true,position:site(3,.7,0),half:[.2,.36,.2]}
      },joints:{slide:{kind:'slider',mode:'position',anchor:site(0,1,0),axis:[0,0,1],range:[0,3],
        speed:100,child:'door',at:3}}}},
      crew:{kind:'agents',config:{bounds:{min:[-5,-1,-2],max:[5,3,2]},
        species:{person:{mode:'walk',speed:2,radius:.14}},
        agents:{scout:{species:'person',position:site(-2.4),metadata:{team:'west'}},
          courier:{species:'person',position:site(2.7),metadata:{team:'east'}}}
      }},
      intel:{kind:'perception',config:{
        profiles:{scout:{eyeHeight:.55,sight:{range:8,fov:100,rays:['rig/ray']},
          hearing:{range:10,field:'ears/audible',thresholdDb:40},proximity:{range:1.5}}},
        factions:{west:{rosters:{posts:{system:'crew',profile:'scout',where:{path:'/metadata/team',value:'west'}}}},
          east:{observers:{lookout:{at:[1.2,.1,1.2],facing:[1,0,-.35],profile:'scout'}}}},
        sounds:{bell:{levelDb:75,duration:1}},rememberTicks:memory
      }}
    }
  };
}
function hatch(tick,open){
  return [input(tick,'rig/drive.slide',open?3:0),input(tick,'air/opening.hatch',open?1:0)];
}

test('final-tick sight remembers the last observed position behind a shutter and factions update independently',()=>{
  const run=W.runtime.create(world());
  assert.equal(visible(run,'west','courier'),true);
  assert.equal(visible(run,'west','lamp'),true);
  const original=contact(run,'west','courier');
  assert.equal(original.lastSeen.tick,0);
  const bench=contact(run,'west','bench');
  assert.equal(bench.currentlyVisible,false);
  assert.equal(bench.currentlyNear,true);
  run.schedule([...hatch(1,false),event(1,site(2.7,1,0)),action(1,'crew/seek',{agent:'courier',to:site(3.6,0,.4)})]);
  run.advance(4);
  assert.equal(run.history.length,0);
  assert.equal(visible(run,'west','courier'),false);
  const remembered=contact(run,'west','courier');
  const across=contact(run,'east','courier');
  assert.deepEqual(remembered.lastSeen.position,original.lastSeen.position);
  assert.equal(remembered.seenAgeTicks,4);
  assert.equal(across.currentlyVisible,true);
  assert.equal(across.seenAgeTicks,0);
  assert.notDeepEqual(across.lastSeen.position,remembered.lastSeen.position);
  const heard=contacts(run).contacts.find(row=>row.kind==='sound');
  assert.equal(heard.currentlyAudible,false);
  assert.equal(heard.lastHeard.tick,1);
  assert(Math.hypot(...heard.lastHeard.apparentSource.map((v,i)=>v-[0,1,0][i]))<.001);
  assert.equal(heard.position,undefined);
  assert.equal(heard.lastSeen,undefined);
  const checkpoint=json(run.checkpoint());
  const restored=W.runtime.create(checkpoint.world,{checkpoint}), fork=restored.fork();
  for(const next of [run,restored,fork]){
    next.schedule(hatch(5,true));
    next.advance(9);
    assert.equal(visible(next,'west','courier'),true);
    assert.equal(contact(next,'west','courier').seenAgeTicks,0);
  }
  for(const next of [restored,fork,W.runtime.replay(json(run.recording()))])
    assert.deepEqual(next.checkpoint(),run.checkpoint());
});

test('the batch exposes field of view, live occlusion, hearing and proximity separately',()=>{
  const run=W.runtime.create(world());
  const from={agent:{system:'crew',id:'scout',generation:2}};
  const probes=[{id:'lamp',profile:'scout',from,to:{entity:'lamp'},sound:{levelDb:75}},
    {id:'bench',profile:'scout',from,to:{entity:'bench'}},
    {id:'stale',profile:'scout',from:{agent:{system:'crew',id:'scout',generation:99}},to:[0,0,0]}];
  const query=()=>field(run,'batch',{queries:probes}).value.results;
  const coverage=()=>run.query().probe('intel/coverage',[2.65,.65,.35],{faction:'west'}).value;
  assert.equal(coverage(),true);
  const [lamp,bench,stale]=query();
  assert.equal(lamp.sight.visible,true);
  assert.equal(lamp.proximity.near,false);
  assert.equal(lamp.hearing.audible,true);
  assert.equal(bench.sight.status,'outside-view');
  assert.equal(bench.proximity.near,true);
  assert.equal(bench.hearing.status,'silent');
  assert.equal(stale.status,'missing');
  run.schedule(hatch(1,false));
  run.step();
  assert.equal(coverage(),false);
  const blocked=query()[0];
  assert.equal(blocked.sight.status,'occluded');
  assert.equal(blocked.sight.blocker.id,'door');
  assert.equal(blocked.hearing.audible,true);
});

test('a sealed hatch blocks sound and previously seen entries expire as configured',()=>{
  const run=W.runtime.create(world({sealed:true,memory:2}));
  run.schedule([...hatch(1,false),event(1,site(3,1,0))]);
  run.advance(1);
  assert.equal(contacts(run).contacts.some(row=>row.kind==='sound'),false);
  assert.equal(contact(run,'west','courier').seenAgeTicks,1);
  run.advance(3);
  assert.equal(field(run,'contact',who('west','courier')).status,'missing');
  assert.equal(visible(run,'west','courier'),false);
  assert.equal(visible(run,'east','courier'),true);
});

test('sounds emitted between scheduled scans survive until their cue deadline',()=>{
  const source=world();
  source.systems.intel.schedule={every:3};
  source.systems.intel.config.sounds.bell.duration=2;
  const run=W.runtime.create(source);
  run.schedule([event(2,site(2.7,1,0))]);
  run.advance(2);
  assert.equal(contacts(run).sampledAt,0);
  assert.equal(contacts(run).sampleAgeTicks,2);
  assert.equal(contacts(run).contacts.some(row=>row.kind==='sound'),false);
  const saved=json(run.checkpoint()), restored=W.runtime.create(saved.world,{checkpoint:saved});
  run.advance(3);
  restored.advance(3);
  assert.equal(contacts(run).contacts.find(row=>row.kind==='sound').currentlyAudible,true);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  run.advance(6);
  assert.equal(contacts(run).contacts.find(row=>row.kind==='sound').currentlyAudible,false);
});

test('recycled agent IDs keep a separate sight record for each lifetime',()=>{
  const run=W.runtime.create(world());
  const first=contact(run,'west','courier');
  run.schedule([action(1,'crew/despawn',{agent:'courier',generation:1}),
    action(1,'crew/spawn',{agent:'courier',species:'person',position:site(3.1,0,.1)})]);
  run.advance(2);
  const rows=contacts(run).contacts.filter(row=>row.id==='courier');
  assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.key===first.key).currentlyVisible,false);
  assert.equal(rows.find(row=>row.generation===3).currentlyVisible,true);
  assert.equal(field(run,'contact',{faction:'west',key:first.key}).value.lastSeen.tick,0);
});

test('an activity chooses a shelter from the faction memory query',()=>{
  const source=world();
  source.entities.shelter={position:site(-1.4,0,-.1),tags:['shelter']};
  source.systems.crew.config.decisions={interval:1,members:{scout:['shelter']},activities:{shelter:{duration:0,
    destinations:{shelter:{at:{entity:'shelter'},when:[
      {field:'intel/contact',args:{faction:'west'},when:{path:'/seenAgeTicks',op:'lte',value:20}}
    ]}}}}};
  const run=W.runtime.create(source);
  assert.equal(visible(run,'west','shelter'),true);
  run.advance(20);
  const result=run.query().trace('crew/why',undefined,{agent:'scout'}).value;
  assert.equal(result.choice.destination,'shelter');
  assert.equal(result.phase,'complete');
});

test('construction rays occlude only published parts and scan budgets report partial observations',()=>{
  const source=world();
  source.systems.intel.config.profiles.scout.sight.rays.push('section/ray');
  source.systems.intel.config.maxTargets=1;
  source.systems.section={kind:'construction',config:{initiallyBuilt:false,
    points:{part:{position:site(1,.8,0)}},blocks:[{id:'wall',at:'part',half:[.15,.8,1.5]}]}};
  const run=W.runtime.create(source);
  assert.equal(contacts(run).stats.limited,true);
  const args={from:site(-2.4),direction:[1,0,0],distance:8};
  assert.equal(run.query().trace('section/ray',args.from,args).status,'empty');
  const saved=json(run.checkpoint());
  saved.states.section.built=true;
  const built=W.runtime.create(saved.world,{checkpoint:saved});
  assert.equal(built.query().trace('section/ray',args.from,args).value.id,'wall');
  const queries=[{profile:'scout',from:[-2.4,0,0],to:[2.7,.3,0]}];
  assert.equal(field(built,'batch',{queries}).value.results[0].sight.blocker.trace,'section/ray');
});

test('invalid sensory field bindings and corrupted observation ticks fail validation',()=>{
  const source=world();
  const run=W.runtime.create(source);
  assert.throws(()=>field(run,'batch',{queries:[{profile:'no-such-profile',from:[0,0,0],to:[0,0,0]}]}),
    /Invalid sensory probe/);
  const checkpoint=json(run.checkpoint());
  Object.values(checkpoint.states.intel.factions.west.contacts).find(row=>row.sight).sight.tick=5;
  assert.throws(()=>W.runtime.create(checkpoint.world,{checkpoint}),/Invalid saved perception observation/);
  source.systems.intel.config.profiles.scout.sight.rays=['rig/support'];
  assert.throws(()=>W.runtime.validate(source),/Unknown occlusion ray/);
});
