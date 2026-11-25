'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'tiled-block-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name)));
fs.mkdirSync(dir,{recursive:true});

const drawing = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#efe3c9')=>({type:'text',text,at:[x,y],scale,color});
function sheet(width,height,commands) {
  const {data} = drawing.render({width,height,edges:'hard',commands});
  return ink.readTilesetImage(PNG.encode(width,height,data,4));
}
const wall = sheet(32,20,[
  rect(0,0,32,20,'#6d514b'),rect(0,1,32,18,'#a56a51'),
  ...[1,6,11,16].flatMap((y,i)=>[
    rect(0,y,32,1,'#d49162'),
    rect(0,y+4,32,1,'#7a574c'),
    ...[4,12,20,28].map(x=>rect((x+i%2*4)%32,y+1,1,3,'#7a574c'))
  ])
]);
const trim = sheet(16,8,[
  rect(0,0,16,8,'#254c56'),rect(0,1,16,6,'#467782'),rect(0,1,16,1,'#90b6a7'),
  rect(0,6,16,1,'#315964'),rect(3,3,10,1,'#77a5a2'),
  rect(7,2,2,3,'#e2bb79'),rect(5,3,6,1,'#e2bb79')
]);
const draft = {id:'tiled-watch-wall',style:'slate',solids:[],tilesets:{wall,trim}};
json('draft.json',draft);

const wallEdit = {id:'base',object:'gate',mode:'add',at:[0,0,0],size:[3.2,1.75,.5]};
const capEdit = {id:'crown',object:'gate',mode:'add',fromFace:'block/base/far',depth:.42,orientation:'edge-relative',
  edge:'edge/'+JSON.stringify(['block/base/v2','block/base/v3'])};
const openingEdit = {id:'opening',object:'gate',mode:'subtract',at:[1.04,.42,-.1],size:[1.12,1.04,.75]};
const stages = [
  ['wall',wallEdit,'draft','wall-pick','GRID BLOCK','FIXED CONSTRUCTION AXES'],
  ['crown',capEdit,'wall','trim-pick','ADD FROM FACE','EDGE-RELATIVE CROWN'],
  ['opening',openingEdit,'crown','trim-pick','SUBTRACT','TILED THROUGH OPENING']
];
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}
for (const [id,w,h] of [['wall',32,20],['trim',16,8]])
  studio(['tileset','pick','--scene','draft.json','--id',id,'--x','0','--y','0','--width',String(w),
    '--height',String(h),'--out',id+'-pick.json']);
for (const [stage,edit,source,pick] of stages) {
  json(stage+'-request.json',edit);
  const args = ['tileset','block',stage+'-request.json','--scene',source+'.json','--selection',pick+'.json'];
  studio(args,stage+'-preview.json');
  studio([...args,'--out',stage+'.json'],stage+'-receipt.json');
  const report = read(stage+'-receipt.json');
  assert.deepEqual(report,read(stage+'-preview.json'));
  assert(report.painted.length>=4);
  studio(['render',stage+'.json','--w','146','--h','105','--px','1','--ortho','--yaw','.26','--pitch','.27',
    '--target','1.6,1.06,.25','--zoom','3.1','--raw','--out',stage+'-1x.png']);
}
assert.equal(read('crown-receipt.json').solver,'face-region');
assert.equal(read('opening-receipt.json').boolean.operation,'difference');
const before = read('crown.json'), editor = ink.createSceneEditor(before);
editor.applyTilesetBlock({...openingEdit,selection:read('trim-pick.json')});
assert.equal(editor.history().undo.at(-1),'Subtract opening');
editor.undo();
assert.deepEqual(editor.snapshot(),before);

const W=960,H=392,Y=133,panels=[23,334,645];
const board = drawing.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#14242d'),text('INK STUDIO / PAINTED MESHES',23,19,2,'#a7dcbb'),
  text('Add and subtract tiled blocks',23,48,3),
  text('MATCHED CAMERA / NATIVE 1X CAPTURES SHOWN AT 2X',23,82,1),
  ...stages.flatMap(([,,,,label,note],i)=>[
    text(label,panels[i],108,2,'#a7dcbb'),rect(panels[i]-1,Y-1,294,212,'#4f6c74'),
    text(note,panels[i],357,1)
  ])
]});
for (const [i,[stage]] of stages.entries()) {
  const {w,h,data} = PNG.raster(file(stage+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at = (Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((Y+y)*W+panels[i]+x)*4);
  }
}
write('Tiled-blocks.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n'+
  stages.map(([stage])=>'cmp '+stage+'-preview.json '+stage+'-receipt.json').join('\n')+'\n');
write('README.md',`# Add and subtract tiled blocks

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The first
block follows the construction grid. The crown grows outward from
the wall's top face and aligns to its named edge. The last block cuts
a through opening and binds the selected paint to its inner walls.
The receipts show the frame, solver, and faces at each step.
`);
