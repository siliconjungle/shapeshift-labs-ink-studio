'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'brush-run-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const read = name=>JSON.parse(fs.readFileSync(file(name)));
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const art = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#efe6ce')=>({type:'text',text,at:[x,y],scale,color});
const palettes = [['#b17946','#e1af64','#f4d191'],['#386d73','#619a95','#b0d3ae'],['#77506b','#b67b8e','#f1bec2']];
const sheet = art.render({width:38,height:8,edges:'hard',commands:[
  rect(0,0,38,8,'#fb14b6'),
  ...palettes.flatMap(([base,edge,light],i)=>{
    const x = i*13;
    return [rect(x,0,12,8,'#302c38'),rect(x,1,11,5,base),rect(x,1,11,1,edge),
      rect(x+3,3,5,2,edge),rect(x+5,2,1,4,light),rect(x+4,3,3,1,light),
      rect(x+1,6,10,1,base)];
  })
]});
const draft = {id:'signal-trim',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:12},
  constructionPlane:{grid:1},
  tilesets:{trim:{...ink.readTilesetImage(PNG.encode(38,8,sheet.data,4)),tileSize:{width:12,height:8,paddingX:1}}}};
const guide = ink.createSceneEditor(draft);
const mark = [[-.018,-.9,-.04],[.018,-.9,-.04],[.018,.95,-.04],[-.018,.95,-.04]];
guide.placeTilesetFace({object:'datum',face:'line',selection:ink.pickTilesetRectangle(draft,'trim',{x:5,y:3,width:1,height:1})});
guide.editMeshTopology('datum',{vertices:mark.map((position,i)=>({id:'line/v'+i,position}))});
const source = guide.snapshot();
json('draft.json',source);

const commands = [];
function studio(args, report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
}
studio(['tileset','pick','--scene','draft.json','--id','trim','--brush','--x','0','--y','0','--width','38','--height','8','--out','brush.json']);
const brush = read('brush.json');
studio(['tileset','brush-preview','brush.json','--scene','draft.json','--out','brush-1x.png']);
const modes = [
  ['abut-edge',{spacing:'abut',align:'edge'},[3,0],6],
  ['overlap-edge',{spacing:'overlap',overlapTiles:1,align:'edge'},[2,0],5],
  ['overlap-anchor',{spacing:'overlap',overlapTiles:1,align:'anchor',anchor:[18,4]},[2,0],5]
];
for (const [name,settings,pitch,faces] of modes) {
  const request = {id:'trim-course',object:'wall',at:[0,0],count:2,...settings};
  json(name+'-request.json',request);
  const args = ['tileset','brush-run',name+'-request.json','--scene','draft.json','--brush-file','brush.json'];
  studio(args,name+'-preview.json');
  studio([...args,'--out',name+'.json'],name+'-receipt.json');
  const editor = ink.createSceneEditor(source);
  const result = editor.applyTilesetBrushRun({...request,brush});
  assert.deepEqual(read(name+'-preview.json'),result);
  assert.deepEqual(read(name+'-receipt.json'),result);
  assert.deepEqual(read(name+'.json'),editor.snapshot());
  assert.deepEqual(result.pitch,pitch);
  assert.equal(result.faces.length,faces);
  assert.deepEqual(editor.history().undo,['Stamp trim-course']);
  editor.undo();
  assert.deepEqual(editor.snapshot(),source);
  studio(['render',name+'.json','--w','146','--h','86','--px','1','--ortho','--yaw','0','--pitch','0',
    '--target','2.25,.12,0','--zoom','2.15','--raw','--out',name+'-1x.png']);
}

const W = 960, H = 354, panels = [23,334,645], Y = 136;
const labels = ['ABUT / EDGE','OVERLAP / EDGE','OVERLAP / ANCHOR'];
const captions = ['3-TILE STEP / 6 FACES','2-TILE STEP / 5 FACES','CENTER REGISTERED TO THE DATUM'];
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#15222c'),text('INK STUDIO / PAINTED MESHES',23,20,2,'#a5dcbe'),
  text('Repeat a multi-tile brush',23,50,3),
  text('SAME PICK AND START POINT IN ALL THREE VIEWS',23,83,1),
  ...panels.flatMap((x,i)=>[
    text(labels[i],x,109,2,'#a5dcbe'),rect(x-1,Y-1,294,174,'#486a70'),
    text(captions[i],x,324,1)
  ])
]});
for (const [i,[name]] of modes.entries()) {
  const {w,h,data} = PNG.raster(file(name+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at = (Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((Y+y)*W+panels[i]+x)*4);
  }
}
write('Brush-run.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n'+
  modes.map(([name])=>'cmp '+name+'-preview.json '+name+'-receipt.json').join('\n')+'\n');
write('README.md',`# Repeat a multi-tile brush

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. Each example uses the
same three-tile pick and starts at the gold datum. Abut advances three
tiles. Overlap advances two and uses the later stamp in the shared
cell. Anchor alignment puts the compact artwork center on the datum.
The native captures and JSON receipts come from the CLI.

Re-run the repository example to check one-step undo for each run.
`);
