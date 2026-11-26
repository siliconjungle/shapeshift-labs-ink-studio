'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'prefab-source-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const {scene,library} = fixture();
const {prefabLibrary,instances,...base} = scene;
json('source.json',{...base,id:'prefab-bay-row',prefabs:library,instances:{},topologyMeshes:{},
  constructionPlane:{origin:[-2.03,0,0],grid:[.5,.5]},
  camera:{target:[0,.49,0],yaw:-.06,pitch:.08,dist:5,projection:'orthographic',sway:0}});
json('stamp.json',{prefab:'bay',id:'bay',at:[0,0],count:3,step:[4.06,0],snapGrid:false});
const paint = (face,x) => ({member:'panel',reskin:{face,selection:
  ink.pickTilesetRectangle(scene,'enamel',{x,y:0,width:24,height:24})}});
const edit = (op,value) => ({op,path:'/solids/body/mat',value});
json('local-sign.json',{instance:'bay.1',faces:{panel:['sign']},edits:[paint('sign',48)]});
json('local-body.json',[{op:'set',path:'/instances/bay.2/overrides',value:[edit('set','dark')]}]);
json('source-edit.json',{instance:'bay.1',revision:3,edits:[paint('grille',48)],sourceEdits:[edit('set','stone')]});
json('overlap.json',{instance:'bay.0',revision:3,edits:[paint('sign',24)]});
json('view.json',{w:226,h:112,raw:true,camera:{yaw:-.06,pitch:.08,dist:5,target:[0,.49,0],ortho:true,zoom:1.45}});

const commands = [];
function run(args, report) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  if (report) write(report,result);
  return result;
}
run(['tileset','stamp-prefab','stamp.json','--scene','source.json','--out','row.json'],'stamp-receipt.json');
run(['mesh-topology','isolate-prefab','row.json','local-sign.json','--out','local.json'],'local-receipt.json');
run(['scene','apply','local.json','local-body.json','--out','context.json']);
const command = ['mesh-topology','edit-prefab','context.json','source-edit.json','--view','view.json'];
const receipt = JSON.parse(run([...command,'--preview','review','--out','updated.json'],'source-receipt.json'));
assert(receipt.canCommit);
assert.deepEqual(receipt.instances.map(row=>row.instance),['bay.0','bay.1','bay.2']);
assert.equal(receipt.instances[1].meshOverrides[0].status,'rebased');
assert.equal(receipt.instances[2].overrides[0].status,'touched');
assert(receipt.preview.instances.every(row=>row.changedPixels>0));

const blocked = ['mesh-topology','edit-prefab','context.json','overlap.json','--view','view.json','--preview','blocked','--out','rejected.json'];
const failed = spawnSync(process.execPath,[cli,...blocked],{cwd:dir,encoding:'utf8'});
assert.equal(failed.status,1,failed.stderr);
assert(JSON.parse(failed.stdout).conflicts.some(row=>row.instance==='bay.1'));
assert(!fs.existsSync(file('rejected.json')));
write('conflict-receipt.json',failed.stdout);
commands.push('status=0','ink-studio '+blocked.join(' ')+' > conflict-receipt.json || status=$?',
  'test "$status" -eq 1','test ! -e rejected.json');

const w=730,h=249, drawing = ink.load().KIT.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [['BEFORE','before.png','Center sign has a local edit.'],
  ['SHARED SOURCE EDIT','after.png','Trim changes on all three bays.'],
  ['CHANGED PIXELS','changes.png','Right bay keeps its body material.']];
const board = drawing.render({width:w,height:h,edges:'hard',commands:[
  {type:'rect',rect:[0,0,w,h],fill:'#192c34'},
  label('INK STUDIO / LINKED PREFABS',16,15,1,'#abc9b4'),
  label('Edit three bays from one source',16,34,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*236;
    return [label(title,x,89,1,'#b6e1cf'),label(note,x,224,1,'#abc9b4')];
  })
]});
for (const [i,[,png]] of panels.entries()) {
  const {w:width,h:height,data} = PNG.raster(file('review/'+png));
  const x=16+i*236;
  for (let y=0;y<height;y++) board.data.set(data.subarray(y*width*4,(y+1)*width*4),((101+y)*w+x)*4);
}
write('Prefab-source-review.png',PNG.encode(w,h,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Edit three bays from one source','',
  'Run `sh COMMANDS.sh` with `ink-studio` on your PATH.',
  'The same prefab is stamped three times. The middle bay has a local sign.',
  'The right bay has an explicit body material override.',
  'The source edit repaints the narrow trim and changes the body material.',
  'The trim reaches every bay. The local sign and body override stay in place.',
  'A separate edit to the sign conflicts with the middle bay and blocks saving.',
  'See the review and blocked folders for the native captures.', ''
].join('\n'));
