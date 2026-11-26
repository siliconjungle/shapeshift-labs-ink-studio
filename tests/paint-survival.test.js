'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const camera = { target:[0,0,.18],dist:3.8,projection:'orthographic' };
const scene = {id:'paint-size',seed:3,camera:{...camera,yaw:0,pitch:0},finish:{detail:14,dither:0,look:{stableDetail:true}},
  style:{palette:[0x142533,0x224553,0x5c8d8a,0xacc5ae,0x9b543a,0xd38d58,0xffdc88],
    roles:{ground:[1,2,3],gold:[4,5,6]},sun:[-.32,.58,.74],amb:.29,sky:.21},
  solids:[{id:'panel',kind:'box',at:[0,0,0],half:[1.12,.7,.2],round:.095,mat:'ground',res:.036}]};
const attachment={kind:'surface',slot:'front',snap:{mode:'surface',direction:[0,0,1],maxDistance:.24}};
const dab=(id,x,y,radius=.029)=>({id,mat:'gold',attachment,brush:{kind:'sphere',radius},poses:[{point:[x,y,.34]}],
  relief:{mode:'flat'},res:.038});
const marks=[dab('dot-a',-.49,.02),dab('dot-b',-.30,.02),dab('scratch',.43,0),dab('edge',.63,.49),dab('untouched',0,-.42)];
const placement={id:'panel-paint',bindings:{front:'panel'},painting:{format:'ink-studio/painting-3d',version:1,id:'panel-ink',marks}};
const size=(mark,x)=>({mark,span:[[x-.027,0,.2],[x+.027,0,.2]]});
const region=(id, marks, measure, priority, fallback)=>({id,placement:placement.id,marks,measure,priority,minPixels:1.6,fallback});
const { id:unused, relief, ...pigment }=dab('unused',-.40,.04,.18);
const plan={format:'ink-studio/paint-survival',version:1,camera,raw:true,fallbackBudget:2,pixelBudget:1,
  resolutions:[{id:'big',w:136,h:96},{id:'small',w:44,h:30}],
  angles:[{id:'front',yaw:0,pitch:0},{id:'side',yaw:.88,pitch:0}],
  regions:[
    region('crest',['dot-a','dot-b'],size('dot-a',-.40),10,{kind:'pigment',mark:pigment}),
    region('line',['scratch'],size('scratch',.43),1,{kind:'line',points:[[.2,-.2,.34],[.73,.19,.34]],
      radius:.05,mat:'gold',attachment,res:.045}),
    region('edge',['edge'],size('edge',.63),50,{kind:'silhouette',at:[.63,.50,.25],color:'#ffdc88'})
  ]};

test('paint survival measures the native camera, budgets fallbacks and accepts only reproducible reviewed results',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-survival-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at=name=>path.join(dir,name);
  const put=(name,value)=>fs.writeFileSync(at(name),JSON.stringify(value));
  const get=name=>JSON.parse(fs.readFileSync(at(name),'utf8'));
  const call=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  const run=(...args)=>{
    const res=call(...args);
    assert.equal(res.status,0,res.stderr);
    return JSON.parse(res.stdout);
  };
  put('base.json',scene);
  put('placement.json',placement);
  put('plan.json',plan);
  run('painting-3d','apply','base.json','placement.json','--out','source.json');
  const review=run('paint-survival','review','source.json','plan.json','--out','review');
  assert.deepEqual(review.cases.map(row=>row.id),['front/big','front/small','side/big','side/small']);
  const [front,small,side]=review.cases;
  assert(front.regions.every(row=>row.choice==='detail'));
  assert(side.regions[0].pixels<front.regions[0].pixels);
  assert.equal(side.regions[0].choice,'pigment');
  assert.deepEqual(small.regions.map(row=>row.choice),['pigment','budget','silhouette']);
  assert.equal(small.regions[2].protected.status,'kept');
  assert.equal(small.regions[2].protected.cost,1);
  const original=PNG.read(at('review/'+small.images.original.file));
  const candidate=PNG.read(at('review/'+small.images.candidate.file));
  assert.deepEqual([candidate.w,candidate.h],[44,30]);
  assert.notDeepEqual(original.rgb,candidate.rgb);
  assert.equal(front.images.original.sha256,front.images.candidate.sha256);
  assert(fs.existsSync(at('review/review.png')));

  const apply=(id,out='accepted.json')=>['paint-survival','apply','source.json','plan.json','review/report.json','--case',id,'--out',out];
  const accepted=run(...apply('front/small'));
  const painted=get('source.json'), revised=get('accepted.json');
  assert.deepEqual(accepted.regions,small.regions);
  assert.deepEqual(revised.solids,painted.solids);
  assert.deepEqual(painted.paintings3d[0].painting.marks,marks);
  assert.deepEqual(revised.paintings3d[0].painting.marks.filter(row=>row.enabled===false).map(row=>row.id),
    ['dot-a','dot-b','scratch','edge']);
  const fallback=revised.paintings3d[0].painting.marks.find(row=>row.id==='lod-crest');
  assert.deepEqual(fallback.relief,{mode:'flat'});
  assert.deepEqual(fallback.poses,pigment.poses);
  assert.deepEqual(revised.finish.look.protectedPixels.marks.map(row=>row.id),['paint-survival-edge']);
  assert.deepEqual(revised.paintings3d[0].painting.marks.find(row=>row.id==='untouched'),marks.at(-1));
  const reopened=call('render','accepted.json','--w','44','--h','30','--px','1','--raw','--ortho','--out','reopened.png');
  assert.equal(reopened.status,0,reopened.stderr);
  assert.deepEqual(PNG.read(at('reopened.png')).rgb,candidate.rgb);
  const sameCase=at('review/'+front.images.original.file), bytes=fs.readFileSync(sameCase);
  fs.appendFileSync(sameCase,'modified');
  assert.match(call(...apply('front/small','tampered.json')).stderr,/image is missing or changed/);
  assert(!fs.existsSync(at('tampered.json')));
  fs.writeFileSync(sameCase,bytes);
  fs.appendFileSync(at('plan.json'),' ');
  assert.match(call(...apply('front/small','stale.json')).stderr,/stale or incomplete/);
  assert(!fs.existsSync(at('stale.json')));
  assert.deepEqual(get('accepted.json'),revised);
});
