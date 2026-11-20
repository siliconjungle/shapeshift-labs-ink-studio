const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const copy=value=>JSON.parse(JSON.stringify(value));
const box=(min,max)=>({min,max});
const door={origin:[3,1.1,3]}, aperture={halfWidth:1,halfHeight:1.15};
const solid=[2.24,.65,2.1], cut={kind:'box',at:solid,half:[.38,.53,.51]};
const mark={kind:'rect',min:[.12,.12],max:[.88,.88]};
const site={regions:['quarry']}, far={regions:['lookout']};
const actions=[
  {tick:1,action:'terrain/cut',args:{shape:cut}},
  {tick:1,action:'rig/surface-stamp',args:{body:'crate',face:'+z',stamp:{channel:'paint',value:'#db7052',brush:mark}}},
  {tick:1,action:'rig/surface-stamp',args:{body:'crate',face:'+z',stamp:{channel:'wetness',value:.7,brush:mark}}},
  {tick:1,action:'rig/impulse',args:{body:'crate',linear:[.8,0,0]}},
  {tick:2,action:'world/chunk-focus',args:{id:'visitor',at:[18,0,2]}},
  {tick:3,action:'world/chunk-focus',args:{id:'visitor',at:[2,0,2]}},
  {tick:3,action:'world/patch',args:{edits:[{op:'set',path:'/metadata/returned',value:true}]}}
];

function quarry(){
  return {id:'worksite',dt:.125,entities:{crate:{}},systems:{
    terrain:{kind:'volume',config:{bounds:box([0,-.5,0],[6,2,4]),cell:.25,materials:{
      ground:[2632499,4276543,6512731],stone:[6111277,10180674,12862617]
    },initial:[
      {op:'fill',material:'ground',shape:{kind:'box',at:[3,-.18,2],half:[2.95,.23,1.94]}},
      {op:'fill',material:'stone',shape:{kind:'box',at:[2.24,.66,2.1],half:[.32,.64,1.1]}}
    ]}},
    rig:{kind:'mechanics',config:{gravity:[0,0,0],drag:0,bodies:{
      crate:{position:[3.5,.52,1.35],half:[.27,.25,.22],mass:1}
    }}},
    watch:{kind:'control',config:{op:'pass'}}
  },simulationChunks:{grid:{size:8},levels:[{id:'near',within:2,every:1},{id:'sleep',sleep:true}],
    chunks:{quarry:{index:[0,0],systems:['terrain','rig']},lookout:{index:[2,0],systems:['watch']}},
    focus:{visitor:{at:[2,0,2]}}},
  visual:{volume:'terrain',fields:{bodies:'rig/bodies'},camera:{target:[3,.35,2],dist:8,yaw:.34,pitch:.64}}};
}
const gate=(from,to)=>({id:from+'-to-'+to,from:{place:from,anchor:'door'},to:{place:to,anchor:'door'},aperture});
const cross=(session,link)=>session.cross(link,{previous:[3,1.1,3.5],actor:{position:[3,1.1,2.75]}});
const clear=(asset)=>asset.query().probe('terrain/clearance',solid).value;
const surface=asset=>asset.query().probe('rig/surface-state',{}, {body:'crate',face:'+z',uv:[.5,.5]}).value.values;
const position=asset=>asset.query().target({entity:'crate'}).point;

test('native world edits and region cursors survive eviction, paused travel and JSON restoration',async()=>{
  let fresh=0;
  const create=()=>W.portals.create({places:[
    W.simulationPlace({id:'quarry',source:()=>{fresh++;return quarry();},anchors:{door},regionRevisions:{retain:3},
      canArrive:(_actor,_link,query)=>query.probe('terrain/clearance',solid).value>0}),
    W.simulationPlace({id:'camp',source:{id:'camp',dt:.125},anchors:{door},visual:false})
  ],links:[gate('quarry','camp'),gate('camp','quarry')]});
  const session=create(), active=(await session.enter('quarry')).asset;
  assert(clear(active)<0);
  const first=active.regions.pull(site), mirror=W.regionRevisions.receiver({snapshot:copy(first)});
  active.schedule(actions);
  session.step(.3125);
  assert.equal(active.view().tick,2);
  assert(clear(active)>0);
  assert.equal(surface(active).wetness,.7);
  assert.equal(surface(active).paint.coverage,1);
  assert(position(active)[0]>3.5);
  const edited=active.regions.pull(site,{since:mirror.snapshot().cursor});
  assert.equal(mirror.apply(copy(edited)).status,'applied');
  assert.equal(mirror.snapshot().state.regions.quarry.sleeping,true);
  const page=mirror.snapshot().state.regions.quarry;
  assert.equal(page.systems.terrain.state.edits.length,1);
  assert.equal(Object.keys(page.systems.rig.state.surfaceCharts).length,6);
  assert.deepEqual(page.entities.crate.position,position(active));
  assert.equal(mirror.apply(active.regions.pull(far,{since:mirror.snapshot().cursor})).status,'applied');
  assert.equal(mirror.snapshot().state.regions.quarry,undefined);
  const savedMirror=copy(mirror.snapshot()), before=copy(active.checkpoint()), packed=active.world.data.slice();

  assert.equal((await cross(session,'quarry-to-camp')).place.id,'camp');
  session.step(.625);
  const saved=copy(session.checkpoint());
  assert.deepEqual(saved.saved.quarry,before);
  session.dispose();

  const restored=create();
  await restored.restore(saved);
  assert.equal(restored.current().asset.view().tick,5);
  const result=await cross(restored,'camp-to-quarry'), again=result.place.asset;
  assert.equal(fresh,1);
  assert.deepEqual(copy(again.checkpoint()),before);
  assert.deepEqual(again.world.data,packed);
  assert.equal(again.world,again.world);
  const resumedMirror=W.regionRevisions.receiver({snapshot:savedMirror});
  const refill=again.regions.pull(site,{since:resumedMirror.snapshot().cursor});
  assert.equal(refill.type,'delta');
  assert.equal(resumedMirror.apply(copy(refill)).status,'applied');
  assert.deepEqual(copy(resumedMirror.snapshot().state.regions.quarry),copy(page));
  restored.step(.0625);
  assert.equal(again.view().tick,3);
  assert(again.view().world.metadata.returned);
  assert.equal(again.regions.pull(site).state.regions.quarry.sleeping,false);
  assert(clear(again)>0);
  assert.equal(surface(again).wetness,.7);
  restored.dispose();
});

test('same-place travel keeps edits made after a doorway preview',async()=>{
  const next={origin:[5,1.1,3]};
  const source={id:'yard',dt:.125,systems:{signal:{kind:'control',config:{op:'pass'}}}};
  const place=W.simulationPlace({id:'yard',source,anchors:{door,next},visual:false});
  const session=W.portals.create({places:[place],links:[{id:'other-door',
    from:{place:'yard',anchor:'door'},to:{place:'yard',anchor:'next'},aperture}]});
  const started=(await session.enter('yard')).asset;
  assert.equal(await session.prepare('other-door'),started);
  started.schedule([{tick:1,action:'world/input',args:{port:'signal/value',value:7}}]);
  session.step(.125);
  const moved=await cross(session,'other-door');
  assert.equal(moved.place.asset,started);
  assert.equal(moved.place.asset.query().probe('world/signal',{}, {port:'signal/value'}).value,7);
  session.dispose();
});

test('a custom paused place receives its current checkpoint when preparing a local link',async()=>{
  const layouts=[];
  const session=W.portals.create({places:[{id:'yard',anchors:{door,next:{origin:[5,1.1,3]}},prepare({previous,state}){
    layouts.push(state);
    if(previous)return previous;
    let moved=false;
    return {step(){moved=true;},checkpoint:()=>({moved})};
  }}],links:[{id:'other-door',from:{place:'yard',anchor:'door'},to:{place:'yard',anchor:'next'},aperture}]});
  await session.enter('yard');
  session.step(.125);
  await session.prepare('other-door');
  assert.deepEqual(layouts,[undefined,{moved:true}]);
  session.dispose();
});

test('a retained runtime resumes its own checkpoint clock while away and after saving',async()=>{
  const starting=W.runtime.create({id:'yard-source',dt:.125});
  starting.advance(7);
  const yard=W.simulationPlace({id:'yard',source:starting.checkpoint(),tickPolicy:'continue',visual:false});
  const office=W.simulationPlace({id:'office',source:{id:'office',dt:.25},visual:false});
  const create=()=>W.portals.create({places:[yard,office]});
  const session=create(), start=(await session.enter('yard')).asset;
  session.step(.1875);
  assert.equal(start.view().tick,8);
  await session.enter('office');
  session.step(.125);
  assert.equal(start.view().tick,9);
  const saved=copy(session.checkpoint());
  const next=create();
  await next.restore(saved);
  next.step(.0625);
  assert.equal((await next.enter('yard')).asset.view().tick,10);
  assert.throws(()=>W.regionRevisions.receiver({snapshot:{type:'delta'}}),/saved snapshot/);
  const oldSave=create();
  await oldSave.restore({place:'yard',saved:{yard:copy(starting.checkpoint())},clocks:{yard:2}});
  oldSave.step(.125);
  assert.equal(oldSave.current().asset.view().tick,8);
  session.dispose();
  next.dispose();
  oldSave.dispose();
});
