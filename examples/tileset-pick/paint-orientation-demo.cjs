'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'paint-orientation-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const art = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#efe6ce')=>({type:'text',text,at:[x,y],scale,color});
const sheet = art.render({width:16,height:12,edges:'hard',commands:[
  rect(0,0,16,12,'#172e39'),rect(1,1,14,10,'#315e63'),
  rect(1,1,14,1,'#78a9a0'),rect(1,10,14,1,'#20424c'),
  rect(2,3,2,2,'#dd9a63'),rect(2,8,3,1,'#8db4ae'),
  rect(5,5,7,2,'#efcb8a'),rect(9,4,3,4,'#efcb8a'),
  rect(10,3,1,1,'#efcb8a'),rect(10,8,1,1,'#efcb8a'),
  rect(12,5,1,2,'#efcb8a'),rect(13,5,1,1,'#efcb8a')
]});
const draft = {id:'wayfinding-panel',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  tilesets:{wayfinding:{...ink.readTilesetImage(PNG.encode(16,12,sheet.data,4)),tileSize:{width:4,height:4}}}};
json('draft.json',draft);

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}
const pick = ['tileset','pick','--scene','draft.json','--id','wayfinding','--x','0','--y','0','--width','16','--height','12'];
studio([...pick,'--out','sign.json']);
studio([...pick,'--brush','--paint-rotate','90','--out','turned-brush.json']);
studio(['tileset','brush-preview','turned-brush.json','--scene','draft.json','--out','turned-brush-1x.png']);
json('brush-run.json',{id:'block',object:'wall',at:[0,0]});
studio(['tileset','brush-run','brush-run.json','--scene','draft.json','--brush-file','turned-brush.json',
  '--out','turned-block.json'],'turned-block-receipt.json');

const modes = [
  ['original','SOURCE PAINT','LANDSCAPE FACE',[]],
  ['paint-turn','PAINT TURN','CLOCKWISE / SAME FACE',['--paint-rotate','90']],
  ['paint-reflect','PAINT REFLECT','LEFT TO RIGHT',['--paint-flip-x']],
  ['face-turn','FACE TURN','CLOCKWISE / PORTRAIT FACE',['--origin','0,1,0','--right','0,-1,0','--up','1,0,0']]
];
const previews = [];
for (const [name,,,settings] of modes) {
  const args = ['tileset','stamp','--scene','draft.json','--selection','sign.json','--object','wall','--face','panel',...settings];
  const preview = JSON.parse(studio(args,name+'-preview.json'));
  assert.deepEqual(JSON.parse(studio([...args,'--out',name+'.json'],name+'-receipt.json')),preview);
  previews.push(preview);
  studio(['render',name+'.json','--w','115','--h','91','--px','1','--ortho','--yaw','0','--pitch','0',
    '--target','.48,.49,0','--zoom','8.5','--raw','--out',name+'-1x.png']);
}
for (const preview of previews.slice(1,3)) {
  assert.deepEqual(preview.vertices,previews[0].vertices);
  assert.notDeepEqual(preview.corners,previews[0].corners);
}
assert.notDeepEqual(previews[3].vertices,previews[0].vertices);
assert.deepEqual(previews[3].corners,previews[0].corners);
const editor = ink.createSceneEditor(draft);
const sign = JSON.parse(fs.readFileSync(file('sign.json')));
editor.placeTilesetFace({object:'wall',face:'panel',selection:sign,paint:{rotation:90}});
editor.undo();
assert.deepEqual(editor.snapshot(),draft);

const W = 1028,H = 364,Y = 134, panels = [23,274,525,776];
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#14232d'),text('INK STUDIO / PAINTED MESHES',23,20,2,'#a6debc'),
  text('Turn the paint or turn the face',23,48,3),
  text('MATCHED CAMERA / NATIVE 1X CAPTURES SHOWN AT 2X',23,82,1),
  ...modes.flatMap(([,label,note],i)=>[
    text(label,panels[i],108,2,'#a6debc'),rect(panels[i]-1,Y-1,232,184,'#486a70'),
    text(note,panels[i],334,1)
  ])
]});
for (const [i,[name]] of modes.entries()) {
  const {w,h,data} = PNG.raster(file(name+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at = (Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((Y+y)*W+panels[i]+x)*4);
  }
}
write('Paint-orientation.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n'+
  modes.map(([name])=>'cmp '+name+'-preview.json '+name+'-receipt.json').join('\n')+'\n');
write('README.md',`# Rotate or reflect the paint

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. Every view
uses the same source paint and camera. The middle stamps change
the pigment UVs. The portrait stamp uses turned world axes.
The bundle also includes a compact oriented brush preview and a
placed block with separate source bindings per cell.
`);
