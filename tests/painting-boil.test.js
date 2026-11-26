'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const { KIT:K } = ink.load();
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const api = K.procedural.paintBoil;
const camera = { target:[0,0,.15],dist:3.45,yaw:0,pitch:0,sway:0,projection:'orthographic' };
const base = {id:'paint-boil-test',seed:51,camera,finish:{detail:15,dither:0},
  style:{sun:[-.45,.6,.75],amb:.27,sky:.21,palette:[0x142335,0x284655,0x709993,0xafc2a9,0x995939,0xe59b60,0xffd492],
    roles:{stone:[1,2,3],ink:[4,5,6]}},
  solids:[{id:'plate',kind:'box',at:[0,0,0],half:[1.16,.8,.2],round:.08,mat:'stone',res:.036}]};
const cadence={fps:12,holds:[2,3]};
const boil = {seed:19,amplitude:.135,scale:.43,cadence,protect:[{points:[[-.65,.07,.2],[-.41,.07,.2]],radius:.21}]};
const attachment={kind:'surface',slot:'face',snap:{mode:'surface',direction:[0,0,1],maxDistance:.30}};
const brush = {kind:'sphere',radius:.064};
const mark = {id:'main',mat:'ink',brush,poses:[[-.63,.07,.34],[-.13,.07,.34],[.52,.24,.34]].map(point=>({point,pressure:1})),
  attachment,relief:{mode:'flat'},res:.038};
const anchor = {...mark,id:'detail',preset:'held',poses:[{point:[.34,-.32,.34]}]};
const placement={id:'ink',bindings:{face:'plate'},painting:{format:K.authoring.paintings3d.format,version:1,id:'salt',
  presets:{held:{boil:{...boil,protect:[],cadence:{...cadence,clock:'cel'}}}},marks:[{...mark,boil},anchor]}};

test('boil has bounded local noise, exact protected field values and seeded exposure clocks', ()=>{
  const plan=api.prepare(boil), {drawing,next}=api.state(plan,0);
  assert.equal(drawing,0);
  assert.equal(next,2/12);
  assert.equal(api.state(plan,.16).drawing,0);
  assert.equal(api.state(plan,2/12).drawing,1);
  assert.equal(api.state(plan,5/12).drawing,2);
  assert.equal(api.state(api.prepare({...boil,cadence:{...cadence,loop:true}}),5/12).drawing,0);
  assert.equal(api.state(api.prepare({...boil,drawing:7}),92).drawing,7);
  assert.throws(()=>api.prepare({...boil,cadence:{holds:[0]}}),/cadence/);
  const shape = K.procedural.shapeSweeps.prepare({ brush, poses: mark.poses.map(row=>({...row,point:[...row.point.slice(0,2),.2]})) });
  const first=api.apply(shape,plan,'main',0), second=api.apply(shape,plan,'main',1);
  for (const point of [[-.55,.12,.2],[-.51,.08,.2],[-.5,.06,.25]]) {
    assert.equal(first.sd(...point),shape.sd(...point));
    assert.equal(second.sd(...point),shape.sd(...point));
  }
  const point=[.19,.13,.2];
  assert.notEqual(first.sd(...point),second.sd(...point));
  assert.equal(first.sd(...point),api.apply(shape,plan,'main',0).sd(...point));
  assert.notEqual(first.sd(...point),api.apply(shape,api.prepare({...boil,seed:20}),'main',0).sd(...point));
  assert.deepEqual(first.bounds.min,shape.bounds.min.map((n,i)=>n-plan.axes[i]*plan.amplitude));
  assert.deepEqual(second.bounds,first.bounds);
});

test('cached builds of a free retained mark sample the requested drawing', ()=>{
  const {relief, ...stroke}=mark;
  const free={...stroke,attachment:{kind:'free'},boil};
  const editor=ink.createSceneEditor(base);
  editor.applyPainting3d({id:'free',painting:{format:K.authoring.paintings3d.format,version:1,id:'stroke',marks:[free]}});
  const first=editor.build({time:0}), second=editor.build({time:2/12});
  assert.notDeepEqual(first.data,second.data);
  assert.deepEqual(editor.build({time:.14}).data,first.data);
});

function delays(file) {
  const bytes=fs.readFileSync(file), rows=[];
  for (let i=8; i<bytes.length;) {
    const size=bytes.readUInt32BE(i), chunk=bytes.toString('ascii',i+4,i+8);
    if (chunk==='fcTL') rows.push([bytes.readUInt16BE(i+28),bytes.readUInt16BE(i+30)]);
    i+=12+size;
  }
  return rows;
}

test('CLI stills, seeks, held cels and split APNG exposures use the same retained boil', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-boil-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at=file=>path.join(dir,file), read=file=>JSON.parse(fs.readFileSync(at(file),'utf8'));
  const put=(file,value)=>fs.writeFileSync(at(file),JSON.stringify(value));
  const run=(...args)=>{
    const result=spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    return ['render','clip'].includes(args[0]) ? result.stdout : JSON.parse(result.stdout);
  };
  const cels=(...args)=>run('painting-cels',...args);
  const render=(input,t,out)=>run('render',input,'--t',t,'--w','116','--h','84','--px','1','--raw','--ortho','--out',out);
  const rgb=file=>PNG.read(at(file)).rgb;
  put('base.json',base);
  put('placement.json',placement);
  put('view.json',{w:116,h:84,raw:true,camera});
  run('painting-3d','apply','base.json','placement.json','--out','scene.json');
  render('scene.json','0','time0.png');
  render('scene.json','.14','hold.png');
  render('scene.json','.25','time1.png');
  assert.deepEqual(rgb('time0.png'),rgb('hold.png'));
  assert.notDeepEqual(rgb('time0.png'),rgb('time1.png'));
  run('clip','scene.json','--from','0','--to','.33333333333333333','--fps','12','--w','116','--h','84','--px','1',
    '--raw','--ortho','--out','ordinary.png');
  const ordinary=PNG.readFullFrameAnimation(at('ordinary.png'),{w:116,h:84,count:4,fps:12});
  assert.deepEqual(ordinary[0].compressed,ordinary[1].compressed);
  assert.notDeepEqual(ordinary[1].compressed,ordinary[2].compressed);
  fs.writeFileSync(at('ordinary-3.png'),PNG.encodeFrame(ordinary[3]));
  assert.deepEqual(rgb('ordinary-3.png'),rgb('time1.png'));
  cels('init','scene.json','--id','ink','--fps','12','--out','seed.json');
  put('edit.json',{format:'ink-studio/painting-cel-edit',version:1,operations:[
    {op:'set-hold',id:'cel-1',hold:6},{op:'insert',id:'next',from:'cel-1',hold:4}
  ]});
  cels('edit','scene.json','seed.json','edit.json','--out','clip.json');
  const exportClip=cels('export','scene.json','clip.json','--view','view.json','--out','export');
  assert.deepEqual(exportClip.frames.map(({cel,hold,boil})=>[cel,hold,...boil.map(row=>row.drawing)]),[
    ['cel-1',2,0,0],['cel-1',3,1,0],['cel-1',1,2,0],['next',1,2,2],['next',3,3,2]
  ]);
  assert.deepEqual(delays(at('export/painting.png')),[[2,12],[3,12],[1,12],[1,12],[3,12]]);
  const preview=(time,out)=>cels('preview','scene.json','clip.json','--at',time,'--view','view.json','--out',out);
  const preview1=preview('.39','middle');
  assert.equal(preview1.time,2/12);
  assert.deepEqual(preview1.active.boil,[{id:'main',drawing:1},{id:'detail',drawing:0}]);
  preview('.71','later');
  preview('.18','earlier');
  assert.deepEqual(rgb('middle/active.png'),rgb('earlier/active.png'));
  assert.deepEqual(rgb('middle/active.png'),rgb('export/'+exportClip.frames[1].image));
  preview('1.2233333333','loop-review');
  assert.deepEqual(rgb('middle/active.png'),rgb('loop-review/active.png'));
  const sample=cels('sample','scene.json','clip.json','--at','.39','--out','sample.json');
  const original=read('clip.json').cels[0].marks[0], baked=read('sample.json').paintings3d[0].painting.marks[0];
  assert.equal(sample.time,2/12);
  assert.deepEqual(baked,{...original,boil:{...original.boil,drawing:1}});
  render('sample.json',String(sample.time),'sample.png');
  assert.deepEqual(rgb('sample.png'),rgb('middle/active.png'));
});
