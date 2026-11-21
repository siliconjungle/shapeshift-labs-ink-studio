const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const PNG = require('../cli/png.js');
const ink = require('..');
const kit = ink.load();
const { surfaceMarks } = kit.KIT;
const { PaintCorrections } = kit;

function fixture({makeBuilder,makeSculpt}, {lip=-.96,cover=true,paint}={}) {
  const B=makeBuilder(13,[0x3c5960,0x9c8b76,0x765344,0x49593d,0xf5d291]);
  const S=makeSculpt(B), stone={r:[1],materialId:'stone'};
  S.pixel=true;
  S.keepRenderSdf=true;
  S.box([0,1,-.22],[2,1,.24],stone,{objectId:'wall',res:.095});
  S.box([0,-.12,1.0],[2,.12,1.11],stone,{objectId:'floor',res:.095});
  if (lip!==false) S.box([lip,2.0,0],[.48,.12,.39],stone,{objectId:'lip',res:.09});
  if (cover) S.box([1.15,2.09,.28],[.71,.12,.62],stone,{objectId:'roof',res:.09});
  S.bake();
  return B.finish({cam:{target:[0,.90,.3],dist:6.9,yaw:.17,pitch:.28,sway:0},paint,
    detail:18,look:{pixel:true},radius:5,dither:0});
}
const layers=[
  {id:'sill',kind:'drips',bounds:{min:[-1.62,1.81,.03],max:[.56,2.26,.52]},
    edge:{object:'lip'},select:{object:'wall'},interval:.23,density:1,width:.10,length:1.25,color:2},
  {id:'traffic',kind:'scuffs',select:{object:'floor'},spacing:.033,length:.37,width:.18,color:4,
    contacts:[{id:'touch',point:[-.13,0,1],heading:[0,0,-1],normal:[0,1,0],load:.65,material:'stone'}]},
  {id:'under-roof',kind:'lichen',bounds:{min:[-1.9,.33,-.04],max:[1.9,1.65,.14]},
    select:{object:'wall'},interval:.26,radius:.13,shelterReach:2.2,density:1,color:3}
];
const bake=(world,rows=layers)=>surfaceMarks.bake(world,{version:1,seed:17,layers:rows});

test('surface mark bakes follow moved lips, measured contact and real cover',()=>{
  const world=fixture(kit), result=bake(world);
  assert.deepEqual(bake(world),result);
  const [water,scuff,lichen]=result.layers.map(layer=>layer.decals);
  assert(water.length>20 && scuff.length>8 && lichen.length>20);
  assert(water.every(row=>row[0]>-1.58 && row[0]<-.34 && row[1]<2 && Math.abs(row[2]-.02)<.012));
  assert(scuff.every(row=>Math.abs(row[1])<.012 && Math.abs(row[0]+.13)<.12 && Math.abs(row[2]-1)<.20));
  assert(lichen.some(row=>row[0]>.33) && lichen.every(row=>Math.abs(row[2]-.02)<.012));
  const noRoof=bake(fixture(kit,{cover:false}),[layers[2]]).layers[0].decals;
  assert(noRoof.every(row=>row[0]<.33));
  assert.equal(bake(fixture(kit,{lip:false,cover:false}),[layers[0],layers[2]]).layers.every(l=>!l.decals.length),true);
  const moved=bake(fixture(kit,{lip:-.09}),[layers[0]]).layers[0].decals;
  assert(moved.length>20 && moved.every(row=>row[0]>-.69));
  const start=layers[1], contact=start.contacts[0];
  assert.deepEqual(bake(world,[{...start,contacts:[contact,contact]}]).layers[0].decals,scuff);
  const missed=bake(world,[{...start,contacts:[
    {...contact,point:[-.13,.5,1]}, {...contact,id:'other',material:'brick'}
  ]}]).layers[0];
  assert.equal(missed.decals.length,0);
  assert.throws(()=>surfaceMarks.bake(world,{layers,maxSamples:1}),/paint sample budget/);
  assert.throws(()=>surfaceMarks.bake(world,{layers,maxWork:1}),/probe budget/);
});

test('generated paint keeps its visible-face color across views and is independently editable',()=>{
  const document=bake(fixture(kit)), world=fixture(kit,{paint:document});
  const options={w:160,h:96,px:1,raw:true};
  for (const yaw of [-.48,.53]) {
    const on=ink.render(world,{...options,yaw}).rgb;
    assert.notDeepEqual(on,ink.render(world,{...options,yaw,paintCorrections:false}).rgb);
  }
  const surface=PaintCorrections.layer(document.layers[0]);
  assert.equal(surface.type,'surface');
  assert.equal(surface.view,undefined);
  assert.throws(()=>PaintCorrections.layer({...surface,angle:20}),/camera capture/);
  const data=world.data.slice(), plan=world.paintCorrections, index=plan.rows[0].index*16;
  for (const direction of [[0,0,1],[.86,0,.51]]) {
    plan.paint(data,world.pal,{direction});
    assert(data[index+3]>0);
  }
  plan.paint(data,world.pal,{direction:[0,0,-1]});
  assert.equal(data[index+3],0);
});

test('paint cause saves editable layers beside existing paint and requires explicit replacement', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-caused-marks-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'scene.js'), recipe=path.join(dir,'recipe.json'), saved=path.join(dir,'paint','decals.json');
  fs.writeFileSync(file,`const make=${fixture.toString()}; module.exports=kit=>({id:'test-marks',seed:13,build:()=>make(kit)});`);
  fs.writeFileSync(recipe,JSON.stringify({version:1,layers}));
  fs.mkdirSync(path.dirname(saved));
  const permanent=[[0,1,.021,0,0,1,1]];
  fs.writeFileSync(saved,JSON.stringify({decals:permanent}));
  const args=(sub,...opts)=>[path.resolve(__dirname,'../cli/ink-studio.js'),'paint',sub,file,...opts,'--dir',path.dirname(saved)];
  const run=(sub,...opts)=>execFileSync(process.execPath,args(sub,...opts),{encoding:'utf8'});
  run('cause',recipe);
  const before=fs.readFileSync(saved,'utf8');
  assert.deepEqual(JSON.parse(before).decals,permanent);
  assert.notEqual(spawnSync(process.execPath,args('cause',recipe)).status,0);
  assert.equal(fs.readFileSync(saved,'utf8'),before);
  run('tune','--layer','traffic','--opacity','.30');
  const inspection=JSON.parse(run('layers'));
  assert.equal(inspection.layers[1].opacity,.3);
  assert.equal(inspection.layers[1].type,'surface');
  run('export','--layer','traffic','--w','96','--h','64','--px','1','--yaw','-.31');
  const image=path.join(dir,'paint','layers','traffic','paint.png');
  const {w,h,rgb}=PNG.read(image);
  for (let y=24;y<30;y++) for (let x=40;x<46;x++) rgb.set([245,210,145],3*(y*w+x));
  PNG.write(image,w,h,rgb);
  run('absorb','--layer','traffic');
  const edited=JSON.parse(fs.readFileSync(saved,'utf8')).layers[1];
  assert.equal(edited.type,'surface');
  assert.equal(edited.view,undefined);
  assert(edited.decals.length>JSON.parse(before).layers[1].decals.length);
  run('cause',recipe,'--replace');
  assert.equal(fs.readFileSync(saved,'utf8'),before);
});
