'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-nudge-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f4e2c6')=>({type:'text',text,at:[x,y],scale,color});
const width = 23, height = 11;
const painted = art.render({width,height,edges:'hard',commands:[
  rect(0,0,width,height,'#273941'),
  rect(2,2,8,8,'#29565b'),rect(3,3,6,6,'#407076'),
  rect(2,2,8,1,'#82a98a'),rect(2,9,8,1,'#193e47'),text('A',4,3,1,'#ecce8d'),
  rect(12,2,8,8,'#704758'),rect(13,3,6,6,'#ad6959'),
  rect(12,2,8,1,'#de9e74'),rect(12,9,8,1,'#523448'),text('B',14,3,1,'#f9d6a8'),
  rect(10,2,1,8,'#354b53'),rect(20,2,1,8,'#354b53')
]});
const source = PNG.encode(width,height,painted.data,4);
write('sign-atlas.png',source);
const scene = {id:'sign-atlas-nudge',style:'slate',solids:[],
  camera:{target:[0,.7,0],dist:3.8,yaw:-.12,pitch:.10,projection:'orthographic',sway:0},
  tilesetDefaults:{tileSize:{width:8,height:8,paddingX:2,offsetX:2,offsetY:2}},
  tilesets:{signs:ink.readTilesetImage(source)}};
const editor = ink.createSceneEditor(scene);
const selection = ink.pickTilesetRectangle(scene,'signs',{x:2,y:2,width:8,height:8});
editor.placeTilesetFace({object:'sign',face:'panel',selection,origin:[-.7,0,0],worldSize:[1.4,1.4]});
const before = editor.snapshot(), doc = before.topologyMeshes.sign.document;
json('panel.json',before);
json('pick.json',{domain:'islands',ids:['panel']});
const w=176,h=124;
json('view.json',{w,h,raw:true});
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const target = ['--object','sign','--channel','pigment'];
run(['mesh-uv','select','panel.json','pick.json',...target,'--out','selection.json']);
function capture(scene,id) {
  run(['mesh-uv','layout',scene,...target],id+'-layout.json');
  run(['render',scene,'--w',w,'--h',h,'--px',1,'--ortho','--raw','--out',id+'-1x.png']);
  return read(id+'-layout.json').corners;
}
const original = capture('panel.json','before');
const cases = [
  {id:'before',title:'Original',note:'Source tile A',corners:original},
  {id:'quarter',title:'Quarter pixel',note:'+0.25 source texels',increment:.25,shift:.25},
  {id:'pixel',title:'Whole pixel',note:'+1 source texel',shift:1},
  {id:'tile',title:'Tile grid',note:'+10 texels / 8 + 2 gutter',increment:'tile',shift:10}
];
for (const row of cases.slice(1)) {
  const {id,increment,shift} = row;
  json(id+'-request.json',{revision:K.meshTopology.revision(doc),operations:[
    {op:'nudge',selection:read('selection.json'),steps:[1,0],...(increment!==undefined && {increment})}
  ]});
  const edit = ['mesh-uv','edit','panel.json',id+'-request.json',...target];
  run(edit.concat('--view','view.json','--preview',id+'-preview'),id+'-preview.json');
  run(edit.concat('--out',id+'.json','--report',id+'-receipt.json'));
  const receipt = read(id+'-receipt.json'), preview = read(id+'-preview.json');
  assert(preview.canCommit);
  assert.deepEqual(receipt.operations,preview.operations);
  assert.deepEqual(receipt.operations[0].evidence.materials[0].texels,[shift,0]);
  assert.deepEqual(read(id+'.json').topologyMeshes.sign.document.vertices,doc.vertices);
  row.corners = capture(id+'.json',id);
  for (const [i,corner] of row.corners.entries()) {
    assert.equal(corner.id,original[i].id);
    assert(Math.abs(corner.texel[0]-original[i].texel[0]-shift)<1e-10);
    assert.equal(corner.texel[1],original[i].texel[1]);
  }
}

const zoom=8, W=848, H=382, top=137, atlasY=284;
const at = i=>20+i*208;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182932'),
  text('INK STUDIO / UV EDITING',20,18,2,'#a4c5c1'),
  text('Nudge by source texels',20,44,3),
  text('Matched native-grid renders with source UV bounds below',20,77,1,'#a4c5c1'),
  ...cases.flatMap(({title,note},i)=>[text(title,at(i),102,2),text(note,at(i),122,1,'#e4c18c'),
    rect(at(i)-1,top-1,w+2,h+2,'#52686c')]),
  text('SOURCE ATLAS / 8X',20,269,1,'#a4c5c1')
]});
function blit(raster,left,y,scale=1) {
  for (let row=0;row<raster.h*scale;row++) for (let col=0;col<raster.w*scale;col++) {
    const input=(Math.floor(row/scale)*raster.w+Math.floor(col/scale))*4, output=((y+row)*W+left+col)*4;
    board.data.set(raster.data.subarray(input,input+4),output);
  }
}
const guides = [];
for (const [i,{id,corners}] of cases.entries()) {
  const x = at(i);
  blit(PNG.raster(file(id+'-1x.png')),x,top);
  blit({w:width,h:height,data:painted.data},x,atlasY,zoom);
  const points = corners.map(({texel:[u,v]})=>[Math.round(x+(u+.5)*zoom),Math.round(atlasY+(v+.5)*zoom)]);
  guides.push({type:'path',points:[...points,points[0]],color:'#f4e2c6',width:1});
  for (const [px,py] of points) guides.push(rect(px-1,py-1,3,3,'#fac67d'));
}
const overlay = art.render({width:W,height:H,edges:'hard',commands:guides}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('UV-nudge.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Nudge UVs in source texels

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate the
receipts, previews, scenes, and native renders. The contact sheet is
produced by the demo generator.

The three independent previews start with the same quad and saved UV
island selection. They move its paint by 0.25 texels, 1 texel, or one
10-texel grid step. The last move skips the two-texel gutter and lands
on the second painted tile. The geometry stays fixed in every capture.
`);
