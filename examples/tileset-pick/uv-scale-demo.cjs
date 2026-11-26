'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-scale-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f4e2c6')=>({type:'text',text,at:[x,y],scale,color});
const width=41,height=31, pivot=[20/40,14/30], beforeBounds=[14,10,26,18];
const painted = art.render({width,height,edges:'hard',commands:[
  rect(0,0,width,height,'#233842'),
  rect(6,4,29,21,'#344955'),rect(7,5,27,19,'#4a5964'),
  rect(10,7,21,15,'#543e43'),rect(10,7,21,1,'#d7a27a'),
  rect(11,8,19,13,'#82544c'),rect(13,9,15,11,'#426a6c'),rect(14,10,13,9,'#31575d'),
  rect(14,10,13,1,'#7bb2a0'),rect(14,18,13,1,'#162d34'),rect(14,11,1,7,'#54847d'),
  rect(18,14,5,1,'#f4d389'),rect(22,12,1,1,'#f4d389'),rect(23,13,1,1,'#f4d389'),
  rect(24,14,1,1,'#f4d389'),rect(23,15,1,1,'#f4d389'),rect(22,16,1,1,'#f4d389'),
  rect(16,12,1,1,'#e6a06d'),rect(16,16,1,1,'#e6a06d'),
  ...[11,29].flatMap(x=>[8,20].map(y=>rect(x,y,1,1,'#e9b87e')))
]});
const source = PNG.encode(width,height,painted.data,4);
write('source-atlas.png',source);
const scene = {id:'switchyard-scale-uvs',style:'slate',solids:[],
  camera:{target:[0,.5,0],dist:3.25,yaw:-.12,pitch:.12,projection:'orthographic',sway:0},
  tilesets:{enamel:ink.readTilesetImage(source)}};
const editor = ink.createSceneEditor(scene);
const crop = ink.pickTilesetRectangle(scene,'enamel',{x:14,y:10,width:13,height:9});
editor.placeTilesetFace({object:'panel',face:'plate',selection:crop,origin:[-.82,0,0],worldSize:[1.64,1]});
const before = editor.snapshot(), doc = before.topologyMeshes.panel.document;
json('sign.json',before);
json('pivot-request.json',{operations:[{op:'set-pivot',target:{kind:'point',uv:pivot}}]});
json('query.json',{domain:'faces',ids:['plate']});

const w=182,h=118,reviewH=168;
json('view.json',{w,h:reviewH,raw:true});
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const target = ['--object','panel','--channel','pigment'];
run(['mesh-uv','edit','sign.json','pivot-request.json',...target,'--out','ready.json','--report','pivot-receipt.json']);
assert.deepEqual(read('pivot-receipt.json').pivot.after,pivot);
run(['mesh-uv','select','ready.json','query.json',...target,'--out','selection.json']);
const selection = read('selection.json');
const cases = [
  {id:'original',title:'Original',note:'12 x 8 texel span'},
  {id:'axes',title:'Independent axes',note:'U 1.42 / V 0.62',
    operation:{factor:[1.42,.62]},factors:[1.42,.62]},
  {id:'snapped',title:'Snapped bounds',note:'U 1.50 / V 0.50',
    operation:{factor:[1.42,.62],snapBounds:true},factors:[1.5,.5],bounds:[11,12,29,16]},
  {id:'locked',title:'Locked + snapped',note:'U 1.50 / V 1.50',
    operation:{factor:1.42,aspectLock:true,snapBounds:true},factors:[1.5,1.5],bounds:[11,8,29,20]}
];
function capture(id,scene) {
  run(['render',scene,'--w',w,'--h',h,'--px',1,'--ortho','--raw','--out',id+'-1x.png']);
}
capture('original','ready.json');
for (const {id,operation,factors,bounds} of cases.slice(1)) {
  json(id+'-request.json',{revision:T.revision(doc),operations:[{op:'scale',selection,...operation}]});
  const edit = ['mesh-uv','edit','ready.json',id+'-request.json',...target];
  run(edit.concat('--view','view.json','--preview',id+'-preview'),id+'-preview.json');
  run(edit.concat('--out',id+'.json','--report',id+'-receipt.json'));
  const preview = read(id+'-preview.json'), receipt = read(id+'-receipt.json');
  assert(preview.canCommit);
  assert.deepEqual(receipt.operations,preview.operations);
  const evidence = receipt.operations[0].evidence;
  assert.deepEqual(evidence.pivots[0].uv,pivot);
  assert.deepEqual(evidence.bounds[0].factors,factors);
  assert.deepEqual(preview.preview.scaling.bounds,evidence.bounds);
  if (bounds) {
    assert.deepEqual(evidence.bounds[0].before,beforeBounds);
    assert.deepEqual(evidence.bounds[0].applied,bounds);
    run(['mesh-uv','layout',id+'.json',...target],id+'-layout.json');
    const corners = read(id+'-layout.json').corners.map(row=>row.texel);
    const axis = i=>corners.map(p=>p[i]);
    const actual = [Math.min(...axis(0)),Math.min(...axis(1)),Math.max(...axis(0)),Math.max(...axis(1))];
    assert(actual.every((n,i)=>Math.abs(n-bounds[i])<1e-12));
  }
  assert.deepEqual(read(id+'.json').topologyMeshes.panel.document.vertices,doc.vertices);
  capture(id,id+'.json');
}

const W=856,H=451,x=i=>18+i*209,modelY=122,atlasY=260;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182932'),text('INK STUDIO / UV EDITING',18,16,2,'#a4c5c1'),
  text('Scale UVs around a fixed pivot',18,41,3),
  ...cases.flatMap(({title,note},i)=>[text(title,x(i),80,2),text(note,x(i),100,1,'#e5c289')]),
  text('NATIVE RENDER / 1X',18,111,1,'#a4c5c1'),
  text('SOURCE ATLAS',18,248,1,'#a4c5c1'),
  rect(18,437,7,7,'#f0b8ff'),text('UV PIVOT',31,437,1),
  rect(100,437,7,7,'#ffe181'),text('INTEGER BOUNDS',113,437,1)
]});
function blit(name,left,top,zoom=1) {
  const image=PNG.raster(file(name));
  for (let row=0;row<image.h*zoom;row++) for (let col=0;col<image.w*zoom;col++) {
    const src=(Math.floor(row/zoom)*image.w+Math.floor(col/zoom))*4, dst=((top+row)*W+left+col)*4;
    board.data.set(image.data.subarray(src,src+4),dst);
  }
}
blit('source-atlas.png',x(0)+9,atlasY+19,4);
for (const [i,{id}] of cases.entries()) {
  blit(id+'-1x.png',x(i),modelY);
  if (i) blit(id+'-preview/atlas-after.png',x(i)+Math.floor((w-reviewH)/2),atlasY);
}
write('UV-scale.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# UV scaling around a pivot

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate the
preview images, native renders, applied bounds, and edit receipts.
The demo generator assembles the contact sheet.

All edits use the same saved face selection and the same retained pivot.
The last two cases snap all four bounds to source texel centers.
The final case locks the aspect ratio to use the same factor on both axes.
`);
