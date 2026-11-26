'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inflateSync } = require('node:zlib');
const { test } = require('node:test');
const { KIT: K } = require('..').load();
const PNG = require('../cli/png.js');
const W = K.procedural.paintWave;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const root = {at:[0,0,0],axis:[0,1,0],length:2,lock:.2};
const geometry = {format:W.format,version:1,id:'sway',target:{mode:'geometry',solid:'reed'},
  root,amplitude:.4,base:{direction:[1,0,0]}};
const board = id=>({id,kind:'box',at:[0,1,0],half:[.54,1,.14],mat:'stone',res:.065});
const camera = {target:[0,1,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'};
const stroke = (id, relief, x=0, z=.24) => ({
  id,mat:'ember',brush:{kind:'sphere',radius:.07},res:.045,step:.04,relief,
  poses:[{point:[x,.1,z],pressure:.8},{point:[x,1.8,z],pressure:1.15}],
  attachment:{kind:'surface',slot:'body',snap:{mode:'surface',direction:[0,0,1],maxDistance:.2}}
});
const paint = (host, ...marks) => [{id:'detail',bindings:{body:host},painting:{
  id:'chart',format:K.authoring.paintings3d.format,version:1,marks}}];
const close = (a,b) => assert(K.V.dist(a,b)<1e-8,JSON.stringify({a,b}));

test('painted wave controls stay local, lock the roots and form an exact inverse', () => {
  const plan = W.prepare({...geometry,root:{...root,axis:[0,4,0]},strokes:[
    {points:[1],radius:.2,direction:[0,1,1],phase:90},
    {points:[1.7],radius:.15,stiffness:1}
  ]});
  const pose = plan.frame(0);
  assert.deepEqual(pose.fwd([.1,.2,.3]),[.1,.2,.3]);
  assert.deepEqual(pose.offset(1.7),[0,0,0]);
  const at = pose.fwd([0,1,0]);
  assert(at[2]>.12);
  close(pose.inv(at),[0,1,0]);
  close(pose.inv(pose.fwd([.23,1.92,-.1])),[.23,1.92,-.1]);
  close(pose.fwd([0,1,0]),plan.frame(4).fwd([0,1,0]));
  assert.throws(()=>W.prepare({...geometry,base:{direction:[0,4,0]}}),/across the root axis/);
});

test('geometry sweeps the native field and carries attached paint off the rest silhouette', () => {
  const slim = {...board('reed'),half:[.135,1,.14]};
  const source = {id:'test',camera,solids:[slim],paintings3d:paint('reed',stroke('ink',{mode:'flat'}))};
  const opts={parameterInputs:{time:.25}};
  const rest=K.diorama.brushField(source,opts);
  const swing=K.diorama.brushField({...source,paintingWaves:[geometry]},opts);
  const tip = W.prepare(geometry).frame(.25).fwd([0,1.75,.14]);
  assert(rest.sdf(0,1.75,0)<0 && swing.sdf(0,1.75,0)>0);
  assert(swing.sdf(tip[0],1.75,0)<0);
  assert(swing.sdf(0,.12,0)<0 && swing.sdf(.2,.12,0)>0);
  const colorAt = (field, at) => field.materialAt(field.surfaceAt(...at).material,at,[0,0,1]).model?.color;
  const painted = colorAt(rest,[0,1.75,.14]);
  assert(painted);
  assert.deepEqual(colorAt(swing,tip),painted);
  assert.notDeepEqual(colorAt(swing,K.V.add(tip,[.115,0,0])),painted);
});

test('flat pigment and positive relief travel independently over a fixed receiver', () => {
  const marks=[stroke('ink',{mode:'flat'},-.18),stroke('ridge',{mode:'volume',height:.15},.18)];
  const pigment={...geometry,id:'ink-sway',amplitude:.18,target:{mode:'pigment',painting:'detail',marks:['ink']}};
  const raised={...geometry,id:'ridge-sway',amplitude:.18,base:{direction:[-1,0,0]},
    target:{mode:'raised',painting:'detail',marks:['ridge']}};
  const source={id:'test',camera,solids:[board('plate')],paintings3d:paint('plate',...marks)};
  const opts={parameterInputs:{time:.25}};
  const rest=K.diorama.brushField(source,opts);
  const waved={...source,paintingWaves:[pigment,raised]};
  const swing=K.diorama.brushField(waved,opts);
  const height=1.75, pivot=W.prepare(pigment).frame(.25).offset(height)[0];
  const tint=[-.18+pivot,height,.14];
  assert.equal(swing.materialAt(swing.surfaceAt(...tint).material,tint,[0,0,1]).materialId,'ember');
  assert(swing.sdf(.18-pivot,height,.24)<0 && rest.sdf(.18-pivot,height,.24)>0);
  assert(swing.sdf(.18,height,.24)>0 && rest.sdf(.18,height,.24)<0);
  assert.equal(swing.sdf(.42,1,0),rest.sdf(.42,1,0));
  assert.throws(()=>K.diorama.brushField({...source,paintingWaves:[
    {...pigment,target:{...pigment.target,mode:'raised'}}
  ]},opts),/positive volume relief/);
});

test('CLI retains inputs and matches a held still to a sought still and the same exported frame', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-wave-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  const put=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8',stdio:'pipe'});
  const base={id:'test',camera,solids:[{...board('reed'),half:[.135,1,.14]}]};
  put('base.json',base);
  put('wave.json',geometry);
  run('painting-wave','apply','base.json','wave.json','--out','scene.json');
  const report=JSON.parse(run('painting-wave','inspect','scene.json','--at','.25'));
  assert.deepEqual(report.waves[0].samples[1].offset,[0,0,0]);
  assert(report.waves[0].samples.at(-1).offset[0]>.39);
  run('painting-wave','sample','scene.json','--at','.25','--out','held.json');
  const held=JSON.parse(fs.readFileSync(file('held.json')));
  assert.equal(held.paintingWaves[0].time,.25);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('base.json'))),base);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('scene.json'))).paintingWaves,[geometry]);

  const w=92,h=76,fps=4,view=['--w',String(w),'--h',String(h),'--px','1','--ortho','--raw'];
  run('render','held.json',...view,'--out','held.png');
  run('render','scene.json','--t','.25',...view,'--out','seek.png');
  run('clip','scene.json','--from','0','--to','1','--fps',String(fps),...view,'--out','loop.png');
  assert.deepEqual(PNG.raster(file('held.png')).data,PNG.raster(file('seek.png')).data);
  const frames=PNG.readFullFrameAnimation(file('loop.png'),{w,h,count:4,fps});
  const still=PNG.raster(file('seek.png')), rgb=Buffer.alloc(w*h*3);
  for(let i=0;i<w*h;i++) for(let c=0;c<3;c++) rgb[3*i+c]=still.data[4*i+c];
  const expected=PNG.packFrame({w,h,rgb});
  assert.deepEqual(inflateSync(frames[1].compressed),inflateSync(expected.compressed));
  assert.notDeepEqual(frames[0].compressed,frames[1].compressed);
});
