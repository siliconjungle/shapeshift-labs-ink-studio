'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { inflateSync } = require('node:zlib');
const { test } = require('node:test');
const ink=require('..');
const { KIT: K }=ink.load();
const PNG=require('../cli/png.js');
const api=K.procedural.paintEvaporation;
const PaintFinish=require('../src/paint-finish.js');
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const attachment={kind:'surface',slot:'plate',snap:{mode:'surface',direction:[0,0,1],maxDistance:.26}};
const poses=(x,z)=>[-.65,.65].map(y=>({point:[x,y,z]}));
const stroke=(id,x,extra)=>({id,mat:'ember',brush:{kind:'sphere',radius:.083},res:.045,step:.035,
  poses:poses(x,.22),attachment,...extra});
const source={
  id:'paint-release',seed:20,camera:{target:[0,.12,.12],dist:3.8,yaw:0,pitch:0,sway:0,projection:'orthographic'},
  solids:[{id:'plate',kind:'box',at:[0,0,0],half:[.65,.83,.12],res:.052,mat:'stone'}],
  paintings3d:[{id:'ink',bindings:{plate:'plate'},painting:{format:K.authoring.paintings3d.format,version:1,id:'lines',
    marks:[
      stroke('color',-.28,{relief:{mode:'flat'}}),
      stroke('signal',0,{finish:{tint:{color:'#68d1bc'},emission:{color:'#179df8',strength:.72}}}),
      stroke('ridge',.28,{relief:{mode:'volume',height:.13}})
    ]}}]
};
const recipe={format:api.format,version:1,id:'draft',painting:'ink',marks:['color','signal','ridge'],
  region:{points:[[-.42,.27,.18],[.42,.27,.18]],radius:.26,direction:[1,0,0]},
  start:.25,end:.75,life:.7,spacing:.068,size:.033,velocity:[0,.87,.10],spread:.14,seed:10};
const build=(spec,time,options)=>K.diorama.scene(spec).build(undefined,{parameterInputs:{time},...options});
const materialAt=(field,at)=>field.materialAt(field.surfaceAt(...at).material,at,[0,0,1]);
const compactLayer=()=>{
  const capture=api.capture(recipe), world=build(source,0,{paintEvaporationCapture:capture});
  return capture.finish(world,0);
};

test('particles are sampled from settled pigment, finish and raised paint, with independent timing and emission',()=>{
  const layer=compactLayer();
  assert.deepEqual(new Set(layer.particles.map(p=>p.source)),new Set(['paint.ink.color','paint.ink.signal','paint.ink.ridge']));
  const finish=layer.particles.filter(p=>p.source==='paint.ink.signal');
  assert(finish.length && finish.every(p=>p.emission[2]>p.emission[1] && p.emission[2]>.6));
  const pigment=layer.particles.filter(p=>p.source==='paint.ink.color');
  assert(pigment.every(p=>p.emission.every(n=>n===0) && p.color[0]>p.color[2]));
  assert(Math.max(...pigment.map(p=>p.birth))<Math.min(...layer.particles.filter(p=>p.source==='paint.ink.ridge').map(p=>p.birth)));
  assert.deepEqual(compactLayer(),layer);
});

test('the released region removes only selected paint and raised volume, while particle slots seek by age',()=>{
  const layer=compactLayer(), scene={...source,paintEvaporations:[layer]};
  const rest=K.diorama.brushField(scene,{parameterInputs:{time:0}}), after=K.diorama.brushField(scene,{parameterInputs:{time:.8}});
  const mark=[-.28,.27,.12], retained=[-.28,-.37,.12];
  assert.notDeepEqual(materialAt(after,mark).model?.color,materialAt(rest,mark).model?.color);
  assert.deepEqual(materialAt(after,retained).model?.color,materialAt(rest,retained).model?.color);
  assert(materialAt(rest,[0,.27,.12]).paintFinishSample);
  assert.equal(materialAt(after,[0,.27,.12]).paintFinishSample,undefined);
  assert(rest.sdf(.28,.27,.19)<0 && after.sdf(.28,.27,.19)>0);
  assert(after.sdf(.28,.27,0)<0);
  const world=build(scene,.8), first=world.count-layer.particles.length;
  const luminous=layer.particles.findIndex(row=>row.emission.some(Boolean));
  assert.equal(world.splatIds[first+luminous],'paint-particles/draft/'+luminous);
  const glow=PaintFinish.emission(PaintFinish.at(world.renderMetadata.paintFinish,first+luminous));
  assert(glow.every((n,i)=>Math.abs(n-layer.particles[luminous].emission[i])<1e-6));
  world.anim.update(0,.8);
  const match=world.data.slice(first*16);
  assert(match.some((n,i)=>i%16===3 && n>0));
  world.anim.update(0,1.6);
  assert(world.data.slice(first*16).every((n,i)=>i%16!==3 || n===0));
  world.anim.update(0,.8);
  assert.deepEqual(world.data.slice(first*16),match);
});

test('the headless release CLI retains its input and the sought pose matches the exported frame',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-evaporation-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  fs.writeFileSync(file('source.json'),JSON.stringify(source));
  fs.writeFileSync(file('recipe.json'),JSON.stringify(recipe));
  const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,stdio:'pipe',encoding:'utf8'});
  const result=JSON.parse(run('paint-evaporation','apply','source.json','recipe.json','--out','released.json'));
  assert.equal(result.sources.length,3);
  const inspect=JSON.parse(run('paint-evaporation','inspect','released.json','--at','.5','--layer','draft'));
  assert(inspect.layers[0].particles.some(p=>p.status==='airborne'));
  assert(inspect.layers[0].particles.some(p=>p.status==='pending'));
  const w=100,h=87,fps=4,view=['--w',String(w),'--h',String(h),'--px','1','--ortho','--raw'];
  run('render','released.json','--t','.5',...view,'--out','still.png');
  run('clip','released.json','--from','0','--to','1','--fps',String(fps),...view,'--out','film.png');
  const frames=PNG.readFullFrameAnimation(file('film.png'),{w,h,fps,count:4});
  const still=PNG.raster(file('still.png')), rgb=Buffer.alloc(w*h*3);
  for(let i=0;i<w*h;i++) for(let c=0;c<3;c++) rgb[3*i+c]=still.data[4*i+c];
  assert.deepEqual(inflateSync(frames[2].compressed),inflateSync(PNG.packFrame({w,h,rgb}).compressed));
  assert.notDeepEqual(frames[0].compressed,frames[2].compressed);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('source.json'))),source);
  const failed=spawnSync(process.execPath,[cli,'paint-evaporation','apply','source.json','recipe.json','--out','recipe.json'],
    {cwd:dir,encoding:'utf8'});
  assert.notEqual(failed.status,0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('recipe.json'))),recipe);
});
