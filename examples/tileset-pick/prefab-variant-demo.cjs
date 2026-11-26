'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'prefab-variants-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name)));
fs.mkdirSync(dir,{recursive:true});

const {scene,library} = fixture();
const {prefabLibrary,instances,...base} = scene;
json('source.json',{...base,id:'prefab-local-bays',prefabs:library,instances:{},topologyMeshes:{},
  constructionPlane:{origin:[-2.03,0,0],grid:[.5,.5]},
  camera:{target:[0,.49,0],yaw:-.06,pitch:.08,dist:5,projection:'orthographic',sway:0}});
json('stamp.json',{prefab:'bay',id:'bay',at:[0,0],count:3,step:[4.06,0],snapGrid:false});
const paint = (face,x) => ({member:'panel',reskin:{face,selection:
  ink.pickTilesetRectangle(scene,'enamel',{x,y:0,width:24,height:24})}});
const material = value => ({op:'set',path:'/solids/body/mat',value});
json('local.json',{instance:'bay.1',faces:{panel:['sign']},edits:[paint('sign',48)]});
json('fork.json',{instance:'bay.0',mode:'fork',revision:3,prefab:'west-enamel'});
json('detach.json',{instance:'bay.1',mode:'detach',revision:3});
json('edit-fork.json',{instance:'bay.0',revision:1,edits:[paint('sign',48)],sourceEdits:[material('stone')]});
json('edit-original.json',{instance:'bay.2',revision:3,edits:[paint('grille',48)]});
json('view.json',{w:226,h:110,raw:true,camera:{yaw:-.06,pitch:.08,dist:5,target:[0,.49,0],ortho:true,zoom:1.45}});

const commands = [];
function run(args, report) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  if (report) write(report,result);
  return result;
}
run(['tileset','stamp-prefab','stamp.json','--scene','source.json','--out','row.json'],'stamp-receipt.json');
run(['mesh-topology','isolate-prefab','row.json','local.json','--out','context.json'],'local-receipt.json');
const forked = JSON.parse(run(['mesh-topology','variant-prefab','context.json','fork.json',
  '--view','view.json','--preview','fork-review','--out','forked.json'],'fork-receipt.json'));
const detached = JSON.parse(run(['mesh-topology','variant-prefab','forked.json','detach.json',
  '--view','view.json','--preview','detach-review','--out','detached.json'],'detach-receipt.json'));
for (const [folder,report] of [['fork-review',forked],['detach-review',detached]]) {
  assert(report.canCommit);
  assert.equal(report.preview.instances[0].changedPixels,0);
  assert(fs.readFileSync(file(folder+'/before.png')).equals(fs.readFileSync(file(folder+'/after.png'))));
}

run(['mesh-topology','edit-prefab','detached.json','edit-fork.json','--out','edited-fork.json'],'edit-fork-receipt.json');
run(['tileset','pick','--scene','edited-fork.json','--id','enamel','--x','0','--y','0',
  '--width','24','--height','24','--out','grille-pick.json']);
run(['tileset','reskin','--scene','edited-fork.json','--object','bay.1.panel','--face','grille','--mode','crop',
  '--selection','grille-pick.json','--out','edited-tiles.json'],'edit-tiles-receipt.json');
run(['mesh-topology','edit-prefab','edited-tiles.json','edit-original.json',
  '--view','view.json','--preview','source-review','--out','finished.json'],'edit-original-receipt.json');
const result = read('finished.json');
assert.deepEqual(Object.keys(result.instances),['bay.0','bay.2']);
assert.equal(result.instances['bay.0'].prefab,'west-enamel');
assert.equal(result.instances['bay.2'].prefab,'bay');
assert.equal(result.topologyMeshes['bay.1.panel'].provenance.prefab,'bay');

const w=730,h=253, drawing = ink.load().KIT.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [
  ['LINKED SOURCE','fork-review/before.png','Three bays share one definition.'],
  ['FORK AND DETACH','detach-review/after.png','Both conversions preserve the picture.'],
  ['EDIT EACH BAY','source-review/after.png','Fork, loose tiles, and original.']
];
const board = drawing.render({width:w,height:h,edges:'hard',commands:[
  {type:'rect',rect:[0,0,w,h],fill:'#192c34'},
  label('INK STUDIO / LINKED PREFABS',16,15,1,'#abc9b4'),
  label('Make a local variant',16,34,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*236;
    return [label(title,x,89,1,'#b6e1cf'),label(note,x,229,1,'#abc9b4')];
  })
]});
for (const [i,[,png]] of panels.entries()) {
  const {w:width,h:height,data} = PNG.raster(file(png));
  const x=16+i*236;
  for (let y=0;y<height;y++) board.data.set(data.subarray(y*width*4,(y+1)*width*4),((101+y)*w+x)*4);
}
write('Prefab-local-variants.png',PNG.encode(w,h,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Make a local variant','',
  'Run `sh COMMANDS.sh` with `ink-studio` on your PATH.',
  'Stamp three linked bays and place a local sign on the middle bay.',
  'Fork the western bay and detach the middle bay as ordinary editable tiles.',
  'Both conversions preserve their matching before and after pictures.',
  'Then edit the fork, loose tiles and original prefab independently.',
  'The variant receipts identify the original revisions and stable members.', ''
].join('\n'));
