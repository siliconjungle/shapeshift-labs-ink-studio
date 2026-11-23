const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink=require('..');
const kit=ink.load(), fixture=require('../examples/lighting-channels.js')(kit);
const {prepare,bind}=require('../src/lighting-channels.js');
const runWebGL=require('../cli/look-webgl.js');

test('a shot grades all five channels on the existing render path without moving surfaces',()=>{
  const world=fixture.build(), view={w:192,h:128,px:1,raw:true,passes:['opaque-surface','emission']};
  const render=shotLighting=>ink.render(world,{...view,shotLighting});
  const base=render(false), rig=fixture.shot, snapshots={};
  for(const [name,curve] of Object.entries(rig.channels)){
    const frame=snapshots[name]=render({channels:{[name]:curve}});
    assert.notDeepEqual(frame.rgb,base.rgb,name);
    assert.deepEqual(frame.passes.depth,base.passes.depth,name);
    assert.deepEqual(frame.passes.objectId,base.passes.objectId,name);
  }
  const muted=render({channels:{emission:false}});
  const pixels=(object,frame=base)=>Array.from(frame.passes.objectId.keys()).filter(i=>
    frame.passes.objects[frame.passes.objectId[i]]===object && frame.passes.surfaceCoverage[i]>.99);
  const lamp=pixels('work-lamp');
  assert(lamp.length>30);
  assert(lamp.some(i=>base.rgb[i*3]>180&&muted.rgb[i*3]<10));
  assert(pixels('east-insulator').some(i=>snapshots.sky.rgb[i*3+2]!==base.rgb[i*3+2]));
  const sample=ink.createBounceProbeSampler(world,{shotLighting:{channels:{bounce:false}},
    sun:{sky:[.2,.25,.4],ground:[.1,.1,.1]}});
  const incoming=sample(world.bounceProbes.probes[0].at,[0,1,0]);
  assert.deepEqual(incoming.bounce,[0,0,0]);
  assert(incoming.sky.some(n=>n>0));
  const ground=ink.createBounceProbeSampler(world,{shotLighting:{channels:{sky:false}},
    sun:{sky:[.2,.25,.4],ground:[.1,.1,.1]}})(world.bounceProbes.probes[0].at,[0,-1,0]);
  assert.deepEqual(ground.sky,[0,0,0]);
  assert(ground.bounce.every(n=>n>.04));
});

test('normal and band rules select receivers and spill respects named lights, mask and feather',()=>{
  const art=bind(prepare({
    shadeNormals:[{select:{material:'ceramic'},normal:[1,0,0],strength:.5}],
    shadowBands:[{select:{object:'receiver'},bias:.2,steps:3}],
    spill:[{id:'lamp',receive:{include:[{object:'receiver'}]},bounds:{min:[0,0,0],max:[1,1,1],feather:.25},gain:2}]
  }),{});
  const receiver={object:'receiver',material:'ceramic'}, other={object:'other'};
  const n=art.normal(receiver,[0,1,0]);
  assert(Math.abs(n[0]-Math.SQRT1_2)<1e-12&&Math.abs(n[1]-Math.SQRT1_2)<1e-12);
  assert.deepEqual(art.normal(other,[0,1,0]),[0,1,0]);
  assert.equal(art.band(receiver,.52),.5);
  assert.equal(art.band(other,.52),.52);
  assert.equal(art.spill({id:'lamp'},other,[.5,.5,.5]),0);
  assert.equal(art.spill({id:'lamp'},receiver,[1.5,.5,.5]),0);
  assert.equal(art.spill({id:'lamp'},receiver,[.125,.5,.5]),1);
  assert.equal(art.spill({id:'lamp'},receiver,[.5,.5,.5]),2);
  assert.equal(art.spill({id:'other-lamp'},other,[1.5,.5,.5]),1);

  const world=fixture.build(), view={w:192,h:128,px:1,raw:true,passes:['opaque-surface']};
  const open=ink.render(world,view), restricted=ink.render(world,{...view,shotLighting:{spill:fixture.shot.spill}});
  const floor='east-floor', id=open.passes.objects.indexOf(floor);
  assert(id>0);
  assert(open.passes.objectId.some((owner,i)=>owner===id&&open.rgb[3*i]>restricted.rgb[3*i]+8));
  assert.deepEqual(restricted.passes.depth,open.passes.depth);
  const normal=ink.render(world,{...view,shotLighting:{shadeNormals:fixture.shot.shadeNormals}});
  const changed=new Set();
  for(let i=0;i<normal.w*normal.h;i++){
    if(open.passes.surfaceCoverage[i]<.98||open.passes.surfaceKinds[open.passes.surfaceKind[i]]!=='splat')continue;
    if(open.rgb.slice(i*3,i*3+3).some((value,c)=>value!==normal.rgb[i*3+c]))
      changed.add(open.passes.objects[open.passes.objectId[i]]);
  }
  assert.deepEqual([...changed],['east-insulator']);
  assert.deepEqual(normal.passes.depth,open.passes.depth);
  assert.deepEqual(normal.passes.shadingNormal,open.passes.shadingNormal);
});

test('channel validation and shaped keys preserve independent fills in the shot rig',()=>{
  const Shot=kit.KIT.shotLighting;
  assert.throws(()=>Shot.prepare({channels:{key:{stops:[[0,.5],[1,1]]}}}),/ramp stops/);
  assert.throws(()=>Shot.prepare({channels:{shadow:{stops:[[0,0],[.5,1]]}}}),/ramp stops/);
  assert.throws(()=>Shot.prepare({shadeNormals:[{select:{object:'x'},normal:[0,0,0]}]}),/nonzero/);
  assert.throws(()=>Shot.prepare({spill:[{id:'a'},{id:'a'}]}),/unique/);
  const shaped={at:[0,0,1],normal:[0,0,-1],size:[.1,.1],intensity:3,radius:3,
    sampleGrid:1,shadows:false,color:'#ffffff'};
  const world=kit.makeBuilder(1,[0x888888]).finish();
  const read=definition=>{
    const output=[0,0,0];
    Shot.bind(Shot.prepare(definition),world).sample(-1,[0,0,0],[0,0,1],output);
    return output;
  };
  assert.deepEqual(read({key:shaped,fill:shaped,channels:{key:false}}),read({fill:shaped}));
  assert(read({key:shaped,fill:shaped})[0]>read({fill:shaped})[0]);
  assert(read({key:shaped,channels:{shadow:{stops:[[0,0],[1,.25]]}}})[0]<read({key:shaped})[0]);
});

test('Chrome shaped key applies the channel ramp through the shot relight table',
  {skip:!process.env.INK_TEST_CHROME},()=>{
  const data=runWebGL({},function build({makeBuilder}){
    const B=makeBuilder(1,[0x394657,0x73777c]);
    B.disc(0,0,0,[0,0,1],.48,.012,B.P[1],2.2);
    return B.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true}});
  },(kit,build,backend)=>{
    const w=build(kit), v=backend(64,64,{raw:true,dither:0});
    const key={at:[0,0,1],normal:[0,0,-1],size:[.1,.1],intensity:3,radius:4,sampleGrid:1,shadows:false};
    try{
      const read=shotLighting=>{v.draw(w,{shotLighting});return v.sample({p:[32,32]}).p;};
      return {base:read(false),key:read({key}),muted:read({key,channels:{key:false}})};
    }finally{v.close();}
  });
  assert(data.key[0]>data.base[0]+14);
  assert.deepEqual(data.muted,data.base);
});
