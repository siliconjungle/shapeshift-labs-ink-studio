'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KIT:K } = require('..').load();
const { prepare } = require('../cli/paint-flow-solver.js');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const constant=(u,v,bounds=[0,0,1,1])=>({
  ...K.flowMap.create({width:10,height:10,bounds}).asset(),vectors:Array.from({length:100},()=>[u,v]).flat()
});
const stroke=(id,points,extra)=>({id,mat:'stone',brush:{kind:'sphere',radius:.04},poses:points.map((point,i)=>({
  point,pressure:i?1.2:.8,rotation:[0,0,0,1]
})),...extra});
const place=marks=>({id:'ink',painting:{id:'lines',format:K.authoring.paintings3d.format,version:1,marks}});
const split=stroke('stroke',[[.7,.4,.15],[.9,.4,.15]]);
const near=(a,b,tolerance=1e-7)=>assert(Math.abs(a-b)<tolerance,`${a} expected near ${b}`);

test('wrapped flow interpolates across the chart and cuts a stroke with no cross-seam connector',()=>{
  const asset={...K.flowMap.create({width:2,height:1,bounds:[0,0,2,1]}).asset(),vectors:[1,0,3,0]};
  const map=K.flowMap.open(asset);
  assert.deepEqual(map.sample(0,.5),[1,0]);
  assert.deepEqual(map.sample(0,.5,[0,0],[true,false]),[2,0]);
  assert.deepEqual(map.sample(2,.5,[0,0],[true,false]),[2,0]);
  assert.deepEqual(map.sample(-.5,.5,[0,0],[true,false]),[3,0]);
  assert.equal(map.sample(.1,1.1,[0,0],[true,false]),null);
  const options={marks:['stroke'],wrap:[true,false],seam:'split',edge:'lose',spacing:.05};
  const flow=prepare(options,constant(1,0),place([split]),K);
  assert.deepEqual(flow.sample(0).marks,[split]);
  const crossing=flow.sample(.2);
  assert.equal(crossing.marks.length,2);
  assert.equal(crossing.marks[0].id,'stroke');
  assert(crossing.report[0].wraps>0);
  const [right,left]=crossing.marks.map(mark=>mark.poses);
  near(right[0].point[0],.9); near(right.at(-1).point[0],1); near(left[0].point[0],0); near(left.at(-1).point[0],.1);
  near(right[0].pressure,.8); near(right.at(-1).pressure,1); near(left[0].pressure,1); near(left.at(-1).pressure,1.2);
  assert.deepEqual(right[0].rotation,[0,0,0,1]);
  near(left[0].point[2],.15);
  flow.sample(.73);
  assert.deepEqual(flow.sample(.2),crossing);
  const stopped=prepare({...options,seam:'stop'},constant(1,0),place([split]),K).sample(.6);
  assert.equal(stopped.marks.length,1);
  assert.equal(stopped.report[0].seams,stopped.report[0].stations);
  assert(stopped.marks[0].poses.every(row=>Math.abs(row.point[0]-1)<1e-7));
  const lost=prepare({...options,wrap:[false,false]},constant(1,0),place([split]),K).sample(.6);
  assert.equal(lost.marks.length,0);
  assert.equal(lost.report[0].lost,lost.report[0].stations);
});

test('swept obstruction policies stop, slide, and lose poses without tunneling',()=>{
  const dab=stroke('dab',[[.2,.4,.3]]), placement=place([dab]);
  const asset=constant(1,.5,[0,0,2,2]), rect=[.7,.2,.9,1.3];
  const result=mode=>prepare({marks:['dab'],obstructions:[{id:'wall',rect,mode}]},asset,placement,K).sample(.8);
  const stopped=result('stop'), slid=result('slide'), lost=result('lose');
  const a=stopped.marks[0].poses[0].point,b=slid.marks[0].poses[0].point;
  near(a[0],.7); near(a[1],.65); near(b[0],.7); near(b[1],.8); near(b[2],.3);
  assert.equal(stopped.report[0].collisions,1);
  assert.deepEqual(slid.report[0].obstructions,['wall']);
  assert.deepEqual(lost.marks,[]);
  assert.equal(lost.report[0].lost,1);
  const thin=prepare({marks:['dab'],obstructions:[{id:'thin',rect:[.704,.2,.706,1.3],mode:'stop'}]},
    constant(1,0,[0,0,2,2]),placement,K).sample(.8);
  near(thin.marks[0].poses[0].point[0],.704);
  const bar=stroke('bar',[[.1,.6,0],[.95,.6,0]]);
  const clipped=prepare({marks:['bar'],spacing:1,obstructions:[
    {id:'one',rect:[.3,.4,.4,.8],mode:'stop'},{id:'two',rect:[.6,.4,.7,.8],mode:'stop'}
  ]},constant(0,0),place([bar]),K).sample(0);
  assert.equal(clipped.marks.length,3);
  assert.equal(new Set(clipped.marks.map(row=>row.id)).size,3);
  near(clipped.marks[0].poses.at(-1).point[0],.3);
  near(clipped.marks[1].poses[0].point[0],.4);
  near(clipped.marks[1].poses.at(-1).point[0],.6);
  near(clipped.marks[2].poses[0].point[0],.7);
});

test('the CLI bakes the same editable poses as a direct seek and reopens them through painting cels',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-flow-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at=file=>path.join(dir,file);
  const put=(file,value)=>fs.writeFileSync(at(file),JSON.stringify(value));
  const get=file=>JSON.parse(fs.readFileSync(at(file),'utf8'));
  const call=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  function run(...args){
    const result=call(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  }
  const base={id:'paint-flow-test',camera:{target:[.5,.5,.2],dist:2.7,yaw:0,pitch:0,projection:'orthographic'},
    solids:[{id:'bed',kind:'box',at:[.5,.5,0],half:[.59,.59,.10],round:.04,mat:'stone',res:.06}]};
  const field=constant(1,0), {painting,...placement}=place([split,stroke('static',[[.5,.66,.2]])]);
  const plan={format:'ink-studio/painting-flow',version:1,painting:'ink',field:'tide',marks:['stroke'],
    wrap:[true,false],seam:'split',edge:'lose',spacing:.08};
  put('base.json',base);
  put('placement.json',{...placement,painting:{...painting,flowMaps:{tide:field}}});
  put('plan.json',plan);
  put('field.json',field);
  put('file-plan.json',{...plan,field:{file:'field.json'}});
  put('view.json',{w:94,h:76,raw:true,camera:base.camera});
  run('painting-3d','apply','base.json','placement.json','--out','scene.json');
  const before=get('scene.json');
  const sampled=run('painting-flow','sample','scene.json','plan.json','--at','.2','--out','sampled.json');
  const baked=run('painting-flow','bake','scene.json','file-plan.json','--fps','10','--frames','4','--out','clip.json');
  const final=get('sampled.json').paintings3d[0].painting.marks, clip=get('clip.json');
  assert.deepEqual(baked.frames[2].marks,sampled.marks);
  assert.deepEqual(clip.cels[2].marks,final);
  assert.deepEqual(final.at(-1),painting.marks.at(-1));
  assert.deepEqual(clip.cels[0].marks,painting.marks);
  assert.equal(get('scene.json').id,before.id);
  assert.deepEqual(get('scene.json'),before);
  run('painting-cels','sample','scene.json','clip.json','--frame','flow-003','--out','reopened.json');
  assert.deepEqual(get('reopened.json'),get('sampled.json'));
  const preview=run('painting-cels','preview','scene.json','clip.json','--frame','flow-003','--view','view.json','--out','review');
  assert(fs.existsSync(at('review/'+preview.image)));
  assert.equal(preview.active.id,'flow-003');
  assert.notEqual(call('painting-flow','sample','scene.json','file-plan.json','--out','field.json').status,0);
  assert.deepEqual(get('field.json'),field);
});
