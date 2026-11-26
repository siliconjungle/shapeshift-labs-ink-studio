'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'nested-prefabs-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const {scene,library,request,view} = fixture(), {KIT:K} = ink.load();
const carrier = {translation:[1.4,0,-.13],rotation:[-.16,0,.08],scale:1.09,pivot:[.18,.1,0]};
json('source.json',{...scene,id:'nested-station-bays',topologyMeshes:{},instances:{
  badge:{prefab:'bay',parent:'sign',transform:{translation:[1.13,.25,.04],scale:.4}},
  sign:{prefab:'bay',parent:'west',transform:{translation:[.51,1.05,.25],rotation:[.1,0,-.075],scale:.65}},
  west:{prefab:'bay',transform:{translation:[-1.35,0,0]}},
  east:{prefab:'bay',transform:carrier}
}});
json('library.json',library);
json('paint.json',{...request,instance:'sign'});
json('reparent.json',{instance:'sign',parent:'east'});
json('raise-parent.json',[{op:'set',path:'/instances/east/transform/translation',value:[1.76,.63,-.13]}]);
json('view.json',{...view,w:220,h:134,camera:{...view.camera,target:[.17,1.24,0],yaw:0,zoom:1.23}});

const commands = [];
function run(args,receipt) {
  const value = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(receipt ? ' > '+receipt : ''));
  if (receipt) write(receipt,value);
  return value;
}

run(['mesh-topology','isolate-prefab','source.json','paint.json','--out','painted.json'],'paint-receipt.json');
const reparent = ['mesh-topology','reparent-prefab'];
const report = JSON.parse(run([...reparent,'painted.json','reparent.json','--preview','reparent-review',
  '--view','view.json','--out','nested.json'],'reparent-receipt.json'));
assert(report.canCommit && report.changed);
assert.deepEqual(report.instances.map(row=>row.instance),['sign','badge']);
assert(report.preview.instances.every(row=>row.changedPixels===0 && row.beforePixels>0));
const read = name => fs.readFileSync(file(name));
assert.deepEqual(read('reparent-review/before.png'),read('reparent-review/after.png'));
run(['scene','apply','nested.json','raise-parent.json','--out','raised.json']);
const moved = JSON.parse(run([...reparent,'raised.json','reparent.json','--preview','raise-review',
  '--view','view.json'],'raise-receipt.json'));
assert(moved.canCommit && !moved.changed);
for (const [i,row] of moved.instances.entries()) {
  const delta = K.V.sub(row.beforeWorld.position,report.instances[i].afterWorld.position);
  assert(K.V.dist(delta,[.36,.63,0])<1e-8);
}
assert.notDeepEqual(read('raise-review/before.png'),read('reparent-review/after.png'));

const width=710,height=228, drawing=K.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [
  ['01  ORIGINAL PARENT','reparent-review/before.png','Sign and badge follow the left bay.'],
  ['02  REPARENT IN PLACE','reparent-review/after.png','Right bay takes over. 0 px changed.'],
  ['03  RAISE THE RIGHT BAY','raise-review/before.png','Sign and badge travel with it.']
];
const board = drawing.render({width,height,edges:'hard',commands:[
  {type:'rect',rect:[0,0,width,height],fill:'#192c34'},
  label('INK STUDIO / LINKED PREFABS',16,13,1,'#abc9b4'),
  label('Reparent without a jump',16,30,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*229;
    return [label(title,x,62,1,'#b6e1cf'),label(note,x,212,1,'#abc9b4')];
  })
]});
for (const [i,[,name]] of panels.entries()) {
  const {w,h,data} = PNG.raster(file(name)), x=16+i*229;
  for (let y=0; y<h; y++) board.data.set(data.subarray(y*w*4,(y+1)*w*4),((74+y)*width+x)*4);
}
write('Nested-prefab-instances.png',PNG.encode(width,height,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Reparent without a jump','',
  'Open Nested-prefab-instances.png for the three native-grid captures.',
  'Run sh COMMANDS.sh in a fresh copy with ink-studio on your PATH.',
  'The sign starts on the left bay and its badge is a separate prefab nested under it.',
  'Reparent the sign to the right bay and compare the before and after PNGs byte for byte.',
  'Then raise the right bay by applying a scene patch. The sign and badge both follow.',
  'The receipts record each world frame and the resulting parent-relative transform.',''
].join('\n'));
