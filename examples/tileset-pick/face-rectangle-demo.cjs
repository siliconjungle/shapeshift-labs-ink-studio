'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'face-rectangle-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const draw = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#efe6ce')=>({type:'text',text,at:[x,y],scale,color});
const art = draw.render({width:32,height:8,edges:'hard',commands:[
  rect(0,0,16,8,'#244954'),rect(1,0,15,6,'#41747c'),
  rect(1,0,15,1,'#84afa6'),rect(2,2,5,1,'#649497'),
  rect(9,4,6,1,'#36616b'),rect(1,6,15,1,'#346570'),
  rect(8,3,4,1,'#bbd2ac'),rect(9,2,2,3,'#bbd2ac'),
  rect(16,0,16,8,'#443f40'),rect(17,0,15,6,'#9d6e43'),
  rect(17,0,15,1,'#e2ae67'),rect(18,5,13,1,'#c18553'),
  rect(21,2,8,3,'#6c513f'),rect(22,2,6,1,'#e8c379'),
  rect(24,1,2,4,'#e8c379')
]});
const draft = {id:'painted-cistern-wall',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  constructionPlane:{grid:[1,.5],rounding:'nearest'},
  tilesets:{masonry:ink.readTilesetImage(PNG.encode(32,8,art.data,4))}};
const accent = ink.pickTilesetRectangle(draft,'masonry',{x:16,y:0,width:16,height:8});
const tile = ink.pickTilesetRectangle(draft,'masonry',{x:0,y:0,width:16,height:8});
const editor = ink.createSceneEditor(draft);
for (const [index,at] of [[0,[-1,1]],[1,[5,1]],[2,[2,3]]])
  editor.placeTilesetFace({object:'wall',face:'crest-'+index,selection:accent,planeAt:at});
const before = editor.snapshot();
json('draft.json',before);
const fill = {mode:'fill',id:'masonry',object:'wall',from:[5,3],to:[-1,0],selection:tile};
const erase = {mode:'erase',id:'window',object:'wall',from:[1,1],to:[2,2]};
json('fill.json',fill);
json('erase.json',erase);
const history = editor.history().undo.length;
const fillReceipt = editor.applyTilesetRectangle(fill), filled = editor.snapshot();
const eraseReceipt = editor.applyTilesetRectangle(erase), erased = editor.snapshot();
assert.deepEqual(editor.history().undo.slice(history),['Fill masonry','Erase window']);
assert.equal(fillReceipt.cells.filter(cell=>cell.status === 'fill').length,25);
assert.equal(fillReceipt.affected.length,3);
assert.equal(eraseReceipt.affected.length,4);
editor.undo();
assert.deepEqual(editor.snapshot(),filled);
editor.undo();
assert.deepEqual(editor.snapshot(),before);
editor.redo();
editor.redo();
assert.deepEqual(editor.snapshot(),erased);
json('undo-check.json',{fillSteps:1,eraseSteps:1,filledRevision:fillReceipt.afterRevision,erasedRevision:eraseReceipt.afterRevision});

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
}
for (const [name,from,to,expected] of [['fill','draft','filled',fillReceipt],['erase','filled','erased',eraseReceipt]]) {
  const args = ['tileset','rectangle',name+'.json','--scene',from+'.json'];
  studio(args,name+'-preview.json');
  studio([...args,'--out',to+'.json'],name+'-receipt.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file(name+'-preview.json'))),expected);
  assert.deepEqual(JSON.parse(fs.readFileSync(file(name+'-receipt.json'))),expected);
}
for (const stage of ['draft','filled','erased'])
  studio(['render',stage+'.json','--w','146','--h','98','--px','1','--ortho','--yaw','0','--pitch','0',
    '--target','2.5,1,0','--zoom','2.2','--raw','--out',stage+'-1x.png']);

const W = 960, H = 385, panels = [23,334,645], Y = 136;
const labels = ['FILL PREVIEW','FILLED WALL','ERASED WINDOW'];
const board = draw.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#12212a'),
  text('INK STUDIO / PAINTED MESHES',23,19,2,'#a5dcbe'),
  text('Fill and erase a face rectangle',23,48,3),
  text('CONSTRUCTION GRID 1 x 0.5 SCENE UNITS',23,81,1),
  ...panels.flatMap((x,i)=>[text(labels[i],x,109,2,'#a5dcbe'),
    rect(x-1,Y-1,294,198,'#496872'),rect(x,Y,292,196,'#0b1017')]),
  ...fillReceipt.cells.map(cell=>rect(
    24+24+(cell.at[0]+1)*35,Y+36+(3-cell.at[1])*31,33,29,
    cell.status === 'occupied' ? '#bc8b55' : '#4e8490')),
  rect(49,346,10,10,'#4e8490'),text('25 EMPTY CELLS',65,347,1),
  rect(162,346,10,10,'#bc8b55'),text('3 EXISTING TILES',178,347,1),
  text('25 FACES ADDED IN ONE EDIT',334,347,1),
  text('4 FACES REMOVED IN ONE EDIT',645,347,1)
]});
for (const [i,stage] of ['filled','erased'].entries()) {
  const {w,h,data} = PNG.raster(file(stage+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at = (Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((Y+y)*W+panels[i+1]+x)*4);
  }
}
write('Face-rectangle.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+
  '\ncmp fill-preview.json fill-receipt.json\ncmp erase-preview.json erase-receipt.json\n');
write('README.md',`# Fill and erase a face rectangle

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The first rectangle
covers 28 cells. It places masonry in the 25 empty cells and retains the
three painted crests. The second rectangle removes four faces for a window.
The JSON receipts include the footprint and the effect on each cell.
The review board shows the fill preview and the two renders at 2×.

Run the repository example to verify undo and redo through the scene editor.
`);
