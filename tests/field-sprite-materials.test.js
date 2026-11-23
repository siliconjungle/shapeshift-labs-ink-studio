const assert=require('node:assert/strict');
const {test}=require('node:test');
const {KIT}=require('..').load();
const {generator:G,sceneGraph:S,graph}=KIT.procedural;
const options={width:11,height:11,scale:5,orbit:[0,0],ambient:1,ink:'#000000'};
const at=(plane,x,y)=>{
  const start=(y*plane.width+x)*plane.channels;
  return Array.from(plane.data.slice(start,start+plane.channels));
};
const center=plane=>at(plane,5,5);
const image=(width,height,channels,data)=>({width,height,channels,data});
const sphere=S.shape('sphere',{radius:.8});

test('Field sprite exposes aligned hit position, lighting and coverage while retaining callback shading',()=>{
  const traced=G.fieldSprite(sphere,{...options,paint:(_point,_normal,light)=>[50,100,200*light]});
  assert(Math.abs(center(traced.position)[2]-.8)<.008);
  assert.deepEqual(center(traced.position).slice(0,2),[0,0]);
  assert.deepEqual(center(traced.normal),[0,0,1]);
  assert.deepEqual(center(traced.illumination),[1]);
  assert.deepEqual(center(traced.coverage),[1]);
  assert.deepEqual(center(traced.materialId),[0]);
  assert.deepEqual(center(traced.value),[50,100,200,255]);
  for (const pass of ['position','normal','illumination','coverage','depth'])
    assert(at(traced[pass],0,0).every(value=>value===0));
  assert.deepEqual(at(traced.materialId,0,0),[-1]);
});

test('Repainting a shared trace only changes the masked slots and never evaluates the signed field',()=>{
  let evaluations=0;
  const measured=Object.assign((x,y,z)=>{evaluations++;return Math.hypot(x,y,z)-.8;},{bounds:sphere.bounds});
  const trace=G.fieldSprite(measured,options);
  const original=evaluations, base=G.fieldMaterial({ramp:['#a06c50']});
  const iron=G.fieldMaterial({mask:x=>-x-.1,ramp:['#5e7290']});
  const copper=G.fieldMaterial({mask:x=>-x-.1,ramp:['#dc9351']});
  const a=G.shadeFieldSprite(trace.surface,[base,iron]), b=G.shadeFieldSprite(trace.surface,[base,copper]);
  assert.equal(evaluations,original);
  assert.deepEqual(a.materialId,b.materialId);
  assert.deepEqual(at(a.value,3,5),[160,108,80,255]);
  assert.deepEqual(at(b.value,3,5),at(a.value,3,5));
  assert.deepEqual(at(a.value,7,5),[94,114,144,255]);
  assert.deepEqual(at(b.value,7,5),[220,147,81,255]);
  assert.deepEqual(center(trace.value),[0,0,0,255]);
  const direct=G.fieldSprite(measured,{...options,materials:[base,iron]});
  assert.deepEqual(direct.value,a.value);
  assert.deepEqual(direct.position,trace.position);
  assert.deepEqual(direct.depth,trace.depth);
});

test('Cylindrical paint stays anchored when the camera turns and linearly filters across the seam',()=>{
  const texture=image(2,1,3,[255,0,0,0,0,255]);
  const wrap=G.fieldMaterial({texture,projection:'cylinder-y'});
  const smooth=G.fieldMaterial({texture,projection:'cylinder-y',filter:'linear'});
  const front=G.fieldSprite(sphere,{...options,materials:[wrap]});
  const back=G.fieldSprite(sphere,{...options,orbit:[Math.PI,0],materials:[wrap]});
  const seam=G.fieldSprite(sphere,{...options,orbit:[Math.PI,0],materials:[smooth]});
  assert.deepEqual(center(front.value),[0,0,255,255]);
  assert.deepEqual(center(back.value),[255,0,0,255]);
  assert.deepEqual(center(seam.value),[128,0,128,255]);
  assert(center(front.position)[2]>.79 && center(back.position)[2]<-.79);
});

test('A field feather and texture matte multiply coverage without cutting the sprite silhouette',()=>{
  const red=image(1,1,4,[255,0,0,128]), coverage=image(1,1,1,[128]);
  const material=G.fieldMaterial({texture:red,mask:()=>0,maskTexture:coverage,maskFeather:1});
  const rendered=G.fieldSprite(sphere,{...options,materials:[material]});
  assert.deepEqual(center(rendered.value),[32,0,0,255]);
  assert.deepEqual(center(rendered.materialId),[1]);
  assert.deepEqual(center(rendered.coverage),[1]);
  const stops={stops:[[0,'#2a345c'],[1,'#eab07e']],interpolation:'linear'};
  const shaded=G.fieldSprite(sphere,{...options,materials:[G.fieldMaterial({ramp:stops,lightGain:0,lightBias:.5})]});
  assert.deepEqual(center(shaded.value),[138,114,109,255]);
  assert.throws(()=>G.fieldMaterial({mask:3}),/mask controls/);
  assert.throws(()=>G.fieldMaterial({texture:image(2,2,1,[12])}),/texture needs/);
  assert.throws(()=>G.shadeFieldSprite(rendered.surface,[{}]),/materials/);
});

test('Stock graph links textures and field masks through typed materials to a shared trace',()=>{
  const project=graph.create({nodes:{
    shape:{op:'sdf.shape',inputs:{kind:'sphere',options:{radius:.8}}},
    trace:{op:'proc.fieldSprite',inputs:{source:{node:'shape'},options}},
    mask:{op:'sdf.shape',inputs:{kind:'box',options:{half:[.4,.9,.9],center:[.4,0,0]}}},
    texture:{op:'raster.canvas',inputs:{width:2,height:1,color:[0,255,0,255]}},
    material:{op:'proc.fieldMaterial',inputs:{texture:{node:'texture'},mask:{node:'mask'}}},
    names:{op:'data.record',inputs:{green:{node:'material'}}},
    slots:{op:'data.collect',inputs:{source:{node:'names'},keys:['green']}},
    fill:{op:'proc.fieldSpriteShade',inputs:{surface:{node:'trace',port:'surface'},materials:{node:'slots'}}},
    inline:{op:'proc.fieldSprite',inputs:{source:{node:'shape'},materials:{node:'slots'},options}}
  },outputs:{fill:{node:'fill'},inline:{node:'inline'},position:{node:'trace',port:'position'},id:{node:'fill',port:'materialId'}}});
  const evaluated=project.evaluate().outputs;
  assert.deepEqual(at(evaluated.fill,7,5),[0,255,0,255]);
  assert.deepEqual(at(evaluated.fill,3,5),[0,0,0,255]);
  assert.deepEqual(evaluated.inline,evaluated.fill);
  assert.deepEqual(at(evaluated.id,7,5),[1]);
  assert(center(evaluated.position)[2]>.79);
  project.clear();
});
