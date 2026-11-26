'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const mark = (id, mat, x, y, z, radius=.19) => ({id,mat,res:.05,brush:{kind:'sphere',radius},
  poses:[{point:[x,y,z],pressure:.9}]});
const stage = { id:'cel-review', seed:42, camera:{target:[0,0,.12],dist:3.6,yaw:0,pitch:0,sway:0,projection:'orthographic'},
  style:{sun:[-.3,.5,.8],amb:.3,sky:.21,palette:[0x182736,0x21374a,0x4c6879,0x71918f,0xaa5163,0xf69a98,0x5dc1aa,0xa0e6d2],
    roles:{plate:[1,2,3],rose:[4,5],mint:[6,7]}},
  finish:{detail:14,dither:0},
  solids:[{id:'slate',kind:'box',at:[0,0,-.1],half:[1.15,.8,.1],mat:'plate',res:.07}] };
const green = mark('sprout','mint',-.63,.29,.18), pin=mark('pin','rose',0,-.4,.18,.10);
const attachment = {kind:'surface',slot:'panel',snap:{mode:'surface',direction:[0,0,1],maxDistance:.25}};
const paint = {...mark('line','rose',0,-.17,.2,.13),attachment,relief:{mode:'flat'}};
const placement = {id:'scrawl',bindings:{panel:'slate'},
  painting:{format:'ink-studio/painting-3d',version:1,id:'sprout',marks:[green,pin,paint]}};
const edit = operations => ({format:'ink-studio/painting-cel-edit',version:1,operations});

function animation(path) {
  const bytes=fs.readFileSync(path), delays=[];
  let loops;
  for(let offset=8;offset<bytes.length;) {
    const size=bytes.readUInt32BE(offset), code=bytes.toString('ascii',offset+4,offset+8), data=offset+8;
    if(code==='acTL') loops=bytes.readUInt32BE(data+4);
    if(code==='fcTL') delays.push([bytes.readUInt16BE(data+20),bytes.readUInt16BE(data+22)]);
    offset+=size+12;
  }
  return {loops,delays};
}

test('headless 3D cels retain stable stroke IDs, exact holds and registered onion previews', t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-cels-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const at=file=>path.join(root,file);
  const read=file=>JSON.parse(fs.readFileSync(at(file),'utf8'));
  const save=(file,document)=>fs.writeFileSync(at(file),JSON.stringify(document));
  const call=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});
  const run=(...args)=>{
    const result=call(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const cels=(...args)=>run('painting-cels',...args);
  save('base.json',stage);
  save('placement.json',placement);
  save('view.json',{w:112,h:96,raw:true,opacity:.72,camera:stage.camera});
  run('painting-3d','apply','base.json','placement.json','--out','painted.json');
  cels('init','painted.json','--id','scrawl','--fps','8','--out','seed.json');
  assert.deepEqual(read('seed.json').cels[0].marks,placement.painting.marks);
  save('edit.json',edit([
    {op:'set-hold',id:'cel-1',hold:2},
    {op:'insert',id:'center',after:'cel-1',from:'cel-1'},
    {op:'edit-marks',id:'center',edits:[{op:'set',id:'sprout',patch:{poses:[{point:[-.02,.29,.18],pressure:.9}]}}]},
    {op:'insert',id:'empty',after:'center',hold:4},
    {op:'insert',id:'right',from:'center',hold:1},
    {op:'edit-marks',id:'right',edits:[{op:'set',id:'sprout',patch:{poses:[{point:[.65,.29,.18],pressure:.9}]}}]},
    {op:'move',id:'right',before:'empty'}
  ]));
  cels('edit','painted.json','seed.json','edit.json','--out','clip.json');
  const index=cels('inspect','clip.json');
  assert.deepEqual(index.cels.map(({id,time,hold})=>[id,time,hold]),
    [['cel-1',0,2],['center',.25,2],['right',.5,1],['empty',.625,4]]);
  assert.equal(index.duration,1.125);
  assert.deepEqual(read('clip.json').cels[0].marks,placement.painting.marks);
  const sample=(value,file)=>cels('sample','painted.json','clip.json','--at',value,'--out',file);
  assert.equal(sample('.24999','previous.json').cel.id,'cel-1');
  assert.equal(sample('.25','middle.json').cel.id,'center');
  assert.equal(sample('.625','empty.json').cel.id,'empty');
  assert.equal(sample('1.125','loopback.json').cel.id,'cel-1');
  const [center]=read('middle.json').paintings3d;
  assert.equal(index.cels[1].marks[0].solid,'paint.scrawl.sprout');
  assert.deepEqual(center.painting.marks[0].poses[0].point,[-.02,.29,.18]);
  assert.deepEqual(center.bindings,placement.bindings);
  assert.deepEqual(read('empty.json').paintings3d[0].bindings,{});
  assert.deepEqual(read('painted.json').paintings3d,[placement]);

  const preview=cels('preview','painted.json','clip.json','--frame','center','--view','view.json','--out','preview');
  assert.deepEqual(preview.neighbors.map(({id,side,shared,changed})=>[id,side,shared,changed]),[
    ['cel-1','previous',['sprout','pin','line'],['sprout']],['right','next',['sprout','pin','line'],['sprout']]
  ]);
  assert(preview.neighbors.every(row=>row.pixels>8));
  assert(preview.camera.ortho);
  const raster=name=>PNG.read(at('preview/'+name+'.png')).rgb;
  const active=raster('active'), combined=raster('onion'), before=raster('previous'), after=raster('next');
  let pink=0, mint=0;
  for(let i=0;i<active.length;i+=3){
    if(active[i]===combined[i] && active[i+1]===combined[i+1] && active[i+2]===combined[i+2]) continue;
    if(combined[i]>combined[i+1]+18) pink++;
    if(combined[i+1]>combined[i]+18) mint++;
  }
  assert(pink>8 && mint>8, JSON.stringify({pink,mint}));
  assert.notDeepEqual(before,after);

  const exported=cels('export','painted.json','clip.json','--view','view.json','--out','strip');
  assert.deepEqual(animation(at('strip/'+exported.animation)),{loops:0,delays:[[2,8],[2,8],[1,8],[4,8]]});
  assert.deepEqual(PNG.read(at('strip/'+exported.cels[1].image)).rgb,active);
  assert(exported.cels.every(row=>fs.existsSync(at('strip/'+row.image))));

  save('once-edit.json',{...edit([{op:'remove',id:'empty'}]),playback:'once'});
  cels('edit','painted.json','clip.json','once-edit.json','--out','once.json');
  assert.equal(cels('sample','painted.json','once.json','--at','4','--out','last.json').cel.id,'right');
  const end=cels('preview','painted.json','once.json','--frame','right','--view','view.json','--out','end');
  assert.deepEqual(end.neighbors.map(({side,id})=>[side,id]),[['previous','center']]);
  cels('export','painted.json','once.json','--view','view.json','--out','once-strip');
  assert.equal(animation(at('once-strip/painting.png')).loops,1);

  save('bad.json',edit([{op:'edit-marks',id:'right',edits:[{op:'set',id:'sprout',patch:{poses:[]}}]}]));
  assert.notEqual(call('painting-cels','edit','painted.json','clip.json','bad.json','--out','invalid.json').status,0);
  assert(!fs.existsSync(at('invalid.json')));
  assert.notEqual(call('painting-cels','sample','painted.json','clip.json','--out','painted.json').status,0);
  assert.deepEqual(read('painted.json').paintings3d,[placement]);
});
