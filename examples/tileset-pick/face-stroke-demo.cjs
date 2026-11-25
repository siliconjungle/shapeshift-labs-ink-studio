'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'face-stroke-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const drawing = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#efe7d0')=>({type:'text',text,at:[x,y],scale,color});
const art = drawing.render({width:32,height:16,edges:'hard',commands:[
  rect(0,0,16,16,'#163940'),rect(0,2,16,11,'#28636a'),
  rect(0,3,16,1,'#73b4a2'),rect(0,12,16,1,'#1d4e59'),
  rect(0,0,16,2,'#b88d56'),rect(0,1,16,1,'#89623e'),
  rect(0,14,16,2,'#b88d56'),rect(0,15,16,1,'#684d40'),
  rect(4,7,8,3,'#346c71'),rect(6,5,4,7,'#24515d'),
  rect(7,6,2,5,'#d3cf9b'),rect(5,8,6,1,'#d3cf9b'),
  rect(7,8,2,1,'#f7e7a1'),
  rect(16,0,16,16,'#57413d'),rect(16,1,16,2,'#b88d56'),
  rect(17,3,14,10,'#a16945'),rect(19,3,10,1,'#e3b474'),
  rect(19,11,10,1,'#815038'),rect(20,6,8,4,'#5c453c'),
  rect(22,5,4,6,'#5c453c'),rect(23,6,2,4,'#e9c88a'),
  rect(22,8,4,1,'#e9c88a'),rect(16,13,16,2,'#c1915c')
]});
const draft = {id:'floodgate-course',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  constructionPlane:{grid:[1,1],rounding:'nearest'},
  tilesets:{masonry:ink.readTilesetImage(PNG.encode(32,16,art.data,4))}};
const trim = ink.pickTilesetRectangle(draft,'masonry',{x:16,y:0,width:16,height:16});
const surface = ink.pickTilesetRectangle(draft,'masonry',{x:0,y:0,width:16,height:16});
const editor = ink.createSceneEditor(draft);
for (const [face,u] of [['west-cap',-1],['east-cap',6]])
  editor.placeTilesetFace({object:'floodgate',face,selection:trim,planeAt:[u,0]});
const before = editor.snapshot();
json('draft.json',before);

const draw = {mode:'draw',id:'course',object:'floodgate',interval:1,path:[[0,0],[5,0]],selection:surface};
const erase = {mode:'erase',id:'slipway',object:'floodgate',interval:1,path:[[2,0],[3,0]]};
json('draw.json',draw);
json('erase.json',erase);
const historyLabelsBefore = editor.history().undo.length;
const drawReceipt = editor.applyTilesetStroke(draw), drawn = editor.snapshot();
const eraseReceipt = editor.applyTilesetStroke(erase), erased = editor.snapshot();
assert.deepEqual(editor.history().undo.slice(historyLabelsBefore),['Draw course','Erase slipway']);
editor.undo();
assert.deepEqual(editor.snapshot(),drawn);
editor.undo();
assert.deepEqual(editor.snapshot(),before);
editor.redo();
editor.redo();
assert.deepEqual(editor.snapshot(),erased);
json('undo-check.json',{drawSteps:1,eraseSteps:1,
  drawRevision:drawReceipt.afterRevision,eraseRevision:eraseReceipt.afterRevision,preservedCaps:2});

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}
for (const [name,source,destination,receipt] of [['draw','draft','drawn',drawReceipt],['erase','drawn','erased',eraseReceipt]]) {
  const args = ['tileset','stroke',name+'.json','--scene',source+'.json'];
  assert.deepEqual(JSON.parse(studio(args,name+'-preview.json')),receipt);
  assert.deepEqual(JSON.parse(studio([...args,'--out',destination+'.json'],name+'-receipt.json')),receipt);
}
assert.deepEqual(JSON.parse(fs.readFileSync(file('drawn.json'))),drawn);
assert.deepEqual(JSON.parse(fs.readFileSync(file('erased.json'))),erased);

const stages = [['draft','STARTING SCENE','TWO PAINTED CAPS'],
  ['drawn','DRAW STROKE','6 FACES / 1 SCENE UNIT APART'],
  ['erased','ERASE STROKE','2 FACES REMOVED / 1 UNDO STEP']];
for (const [stage] of stages)
  studio(['render',stage+'.json','--w','264','--h','62','--px','1','--ortho','--yaw','0','--pitch','0',
    '--target','3,.5,0','--zoom','5','--raw','--out',stage+'-1x.png']);

const W = 820, H = 552;
const board = drawing.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#14232e'),text('INK STUDIO / PAINTED MESHES',28,20,2,'#9cd6bc'),
  text('Draw and erase a face run',28,51,3),
  ...stages.flatMap(([,label,note],i)=>{
    const y = 102+i*144;
    return [rect(27,y,766,127,'#38555c'),rect(28,y+1,764,125,'#192e3a'),
      text(label,44,y+36,2,'#9cd6bc'),text(note,44,y+64,1),
      rect(263,y+1,528,125,'#4e6a70')];
  })
]});
for (const [i,[stage]] of stages.entries()) {
  const {w,h,data} = PNG.raster(file(stage+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at = (Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((104+i*144+y)*W+263+x)*4);
  }
}
write('Face-stroke.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+
  '\ncmp draw-preview.json draw-receipt.json\ncmp erase-preview.json erase-receipt.json\n');
write('README.md',`# Draw and erase a run of painted faces

Run \`sh COMMANDS.sh\` with \`ink-studio\` on PATH. The draw stroke places
one editable mesh polygon per scene unit between two existing caps.
The erase stroke opens a two-face gap. Both operations keep their
full preview and commit receipts. The \`*-1x.png\` files are the native
render captures, and the review board shows those captures at 2×.

Re-run the repository example to check undo and redo through the
scene editor. Each stroke contributes one journal entry.
`);
