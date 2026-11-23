const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const kit=ink.load(), {KIT:K,makeBuilder}=kit;
const fixture=require('../examples/visibility-bounce.js')(kit);
const up=[0,1,0];

test('mixed mesh and SDF probes bake portable visibility and RGB with independent shadowed and open sites',()=>{
  const world=fixture.build(), open=ink.bakeBounceProbes(world,fixture.transport('open'));
  const masked=world.bounceProbes, cool=ink.bakeBounceProbes(world,fixture.transport('cool'));
  const [covered,exposed]=masked.probes;
  const sample=bounceProbes=>ink.createBounceProbeSampler(world,{bounceProbes});
  const plain=sample(open)(covered.at,up), under=sample(masked)(covered.at,up);
  assert(plain.bounce[0]>.2 && plain.bounce[0]>plain.bounce[2]*10);
  assert(under.bounce[0]<plain.bounce[0]*.03);
  assert.deepEqual(sample(masked)(exposed.at,up),sample(open)(exposed.at,up));
  assert(covered.open.filter(n=>n===0).length>open.probes[0].open.filter(n=>n===0).length+25);
  const teal=sample(cool)(covered.at,up);
  assert(teal.bounce[2]>.15 && teal.bounce[2]>teal.bounce[0]*6);
  assert.equal(sample(cool)([0,3,0],up),null);
  assert.deepEqual(ink.bakeBounceProbes(world,fixture.transport()),masked);
  const saved=JSON.parse(JSON.stringify(masked));
  const viewer=makeBuilder(1,[0]).finish();
  assert.deepEqual(ink.createBounceProbeSampler(viewer,{bounceProbes:saved})(covered.at,up),under);
  assert.throws(()=>ink.bakeBounceProbes(viewer,fixture.transport()),/Unknown bounce mesh proxy/);
});

test('an opaque mesh depth proxy blocks the bake and a cutout passes light to the receiver',()=>{
  const B=makeBuilder(3,[0x102026]);
  function mesh(id,y,size,color,texture){
    return K.sceneMeshes.create({id,positions:[-size,y,-size,size,y,-size,-size,y,size,size,y,size],
      uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3],materials:[{id,color,texture}]});
  }
  const awning=mesh('awning',1.6,2,0xe05022), solid=mesh('shield',.72,1.9,0xffffff);
  const pixels=new Uint8Array(4*4*4).fill(255);
  for(let i=0;i<16;i++) if(i%4===1||i%4===2) pixels[i*4+3]=0;
  const cutout=mesh('shield',.72,1.9,0xffffff,{width:4,height:4,pixels});
  const at=[0,.35,0], settings={samples:256,reach:3,skyStrength:0,probes:[{id:'core',at,radius:1}],
    geometry:{meshes:[{id:'awning'},{id:'shield',mode:'occlude'}]}};
  const world=B.finish({meshes:[awning],splatDepthProxies:{meshes:[solid]}});
  const sample=(scene,bounceProbes= settings)=>ink.createBounceProbeSampler(scene,{bounceProbes})(at,up);
  const through=sample({...world,splatDepthProxies:{meshes:[cutout]}});
  assert(through.bounce[0]>.05);
  assert(sample(world).bounce[0]<.0001);
  const lit={...settings,geometry:{meshes:[{id:'awning'}],light:{direction:[0,-1,0],intensity:2}}};
  assert(sample(world,lit).bounce[0]>.2);
  const away={...lit,geometry:{...lit.geometry,light:{direction:[0,1,0]}}};
  assert.deepEqual(sample(world,away).bounce,[0,0,0]);
});

test('ramp input and shot EV use independent bounced color while the render keeps depth, owners and non-receivers',()=>{
  const world=fixture.build(), def={...world.bounceProbes,skyStrength:.8}, site=def.probes[1].at;
  const sample=shotLighting=>ink.createBounceProbeSampler(world,{bounceProbes:def,shotLighting,
    sun:{sky:[.10,.15,.28],ground:[.05,.06,.08]}})(site,up);
  const base=sample(undefined), boosted=sample({bounceEV:1});
  assert.deepEqual(boosted.sky,base.sky);
  assert(base.sky[2]>base.sky[0] && base.bounceLevel>0);
  assert.deepEqual(boosted.bounce,base.bounce.map(n=>n*2));
  assert.equal(boosted.bounceLevel,base.bounceLevel*2);
  const ramp=K.procedural.materials.ramp(['#102836','#edb580']);
  assert.notDeepEqual(ramp.sample(base.bounceLevel),ramp.sample(boosted.bounceLevel));

  const options={w:224,h:146,px:1,raw:true,passes:['opaque-surface']};
  const off=ink.render(world,{...options,bounceProbes:false});
  const on=ink.render(world,{...options,shotLighting:{bounceEV:1}});
  assert.deepEqual(on.passes.depth,off.passes.depth);
  assert.deepEqual(on.passes.materialId,off.passes.materialId);
  let changedFloor=0;
  for(let p=0;p<on.passes.materialId.length;p++){
    const material=on.passes.materials[on.passes.materialId[p]];
    if(material==='plaster' && on.rgb[p*3]-off.rgb[p*3]>=6)changedFloor++;
    if(material==='copper')assert.deepEqual(on.rgb.subarray(p*3,p*3+3),off.rgb.subarray(p*3,p*3+3));
  }
  assert(changedFloor>100);
});

test('JSON dioramas retain selected static SDF transport without a render override',()=>{
  const geometry={sdfs:[{object:'roof'}]};
  const at=[0,.3,0], world=K.diorama.build({id:'sdf-probe',
    finish:{bounceProbes:{geometry,skyStrength:0,probes:[{id:'roof-fill',at,radius:1.6}]}},
    solids:[{id:'roof',kind:'box',at:[0,1,0],half:[1,.1,1],mat:'stone',res:.09}]});
  assert.equal(world.renderSdfs.length,1);
  const sample=ink.createBounceProbeSampler(world)(at,up);
  assert(sample.bounce[0]>.002);
  assert.throws(()=>ink.bakeBounceProbes(world,{geometry:{sdfs:[{object:'absent'}]},probes:[{id:'a',at}]}),
    /Unknown retained static SDF bounce proxy/);
});
