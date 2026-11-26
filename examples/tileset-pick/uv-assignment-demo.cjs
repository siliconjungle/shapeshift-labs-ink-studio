'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-assignment-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f4e2c6')=>({type:'text',text,at:[x,y],scale,color});
function image(name,width,height,commands,erase=[]) {
  const {data} = art.render({width,height,edges:'hard',commands});
  for (const [x,y] of erase) data.fill(0,(y*width+x)*4,(y*width+x)*4+4);
  const png = PNG.encode(width,height,data,4);
  write(name+'.png',png);
  return ink.readTilesetImage(png);
}
const old = image('original-atlas',17,13,[
  rect(0,0,17,13,'#28404e'),rect(1,2,15,9,'#42636e'),rect(2,3,13,1,'#658d92'),
  rect(2,8,13,1,'#35515d'),rect(4,5,10,1,'#739597')
]);
const finish = image('finish-atlas',37,21,[
  rect(0,0,37,21,'#203640'),rect(1,1,35,19,'#294957'),
  rect(3,3,17,13,'#855445'),rect(4,4,15,11,'#a1754d'),
  rect(5,5,13,9,'#46696a'),rect(5,5,13,1,'#8aaf91'),rect(5,13,13,1,'#34505b'),
  rect(6,7,10,1,'#b5c18e'),rect(6,10,9,1,'#d4bd83'),rect(9,8,3,1,'#669196'),
  rect(21,3,12,6,'#8e565b'),rect(24,4,1,3,'#e6a281'),rect(26,4,4,1,'#e6a281'),
  rect(19,10,15,7,'#576181'),rect(20,11,12,1,'#a097ad'),rect(20,14,9,1,'#d0b5bf'),
  rect(3,17,14,2,'#8f7049'),rect(4,17,10,1,'#c49d6e')
],[[7,8],[8,8],[7,9]]);
const vertices = [
  ['a',-1.35,0],['b',0,0],['c',0,1.05],['d',-1.35,1.05],['e',1.35,0]
].map(([id,x,y])=>({id,position:[x,y,0]}));
const face = (id,verts,uv)=>({id,material:'enamel',corners:verts.map((vertex,i)=>({id:id+'/'+vertex,vertex,uv:uv[i]}))});
const doc = T.create({id:'station-sign',vertices,faces:[
  face('panel',['a','b','c','d'],[[.125,.75],[.5,.75],[.5,.25],[.125,.25]]),
  face('point',['b','e','c'],[[.5,.75],[.875,.75],[.5,.25]])
]});
const scene = {id:'station-uv-assignment',style:'slate',solids:[],
  camera:{target:[0,.53,0],dist:3.6,yaw:-.14,pitch:.13,projection:'orthographic',sway:0},
  tilesets:{old,finish},topologyMeshes:{siding:{document:doc,materials:[{id:'enamel',texture:{tileset:'old'}}]}}};
json('siding.json',scene);
json('query.json',{domain:'faces',ids:['panel','point']});
const tile = ink.pickTilesetRectangle(scene,'finish',{x:5,y:5,width:13,height:9});
json('tile-pick.json',tile);
const w=214,h=128,atlasSize=182;
json('view.json',{w,h:atlasSize,raw:true});

const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
run(['mesh-uv','select','siding.json','query.json','--object','siding','--out','selection.json']);
const selection = read('selection.json');
const cases = [
  {id:'original',title:'Original',note:'Existing enamel sheet'},
  {id:'tile',title:'Tile for the group',request:{mode:'tile',tile}},
  {id:'sheet',title:'Sheet per face',request:{mode:'sheet',mapping:'per-face',tileset:'finish'}}
];
function capture(id,scene) {
  run(['render',scene,'--w',w,'--h',h,'--px',1,'--ortho','--raw','--out',id+'-1x.png']);
}
capture('original','siding.json');
for (const row of cases.slice(1)) {
  const {id,request} = row;
  json(id+'-request.json',{object:'siding',revision:T.revision(doc),selection,...request});
  const edit = ['tileset','assign',id+'-request.json','--scene','siding.json'];
  run(edit.concat('--view','view.json','--preview',id+'-preview'),id+'-preview.json');
  assert.deepEqual(read('siding.json'),scene);
  run(edit.concat('--out',id+'.json'),id+'-receipt.json');
  const {preview,...planned} = read(id+'-preview.json'), receipt = read(id+'-receipt.json');
  assert(planned.canCommit);
  assert.deepEqual(planned,receipt);
  assert.equal(preview.materialAfter,'enamel/tileset/finish');
  assert.deepEqual(read(id+'.json').topologyMeshes.siding.document.vertices,doc.vertices);
  const {covered,texels,complete} = receipt.coverage;
  assert(complete && receipt.faces.length===2);
  if (id==='tile') assert(covered<texels && receipt.coverage.transparent===3);
  else assert(covered===texels && receipt.coverage.shared>0);
  const peak = Math.max(...receipt.faces.map(face=>face.after.metrics.maxStretch));
  row.note = covered+'/'+texels+' TEXELS / '+peak.toFixed(2)+'X STRETCH';
  capture(id,id+'.json');
}

const W=716,H=457,x=i=>18+i*232,top=125,atlasY=278;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182932'),text('INK STUDIO / UV EDITING',18,16,2,'#a4c5c1'),
  text('Fit faces to a tile or sheet',18,42,3),
  ...cases.flatMap(({title,note},i)=>[text(title,x(i),80,2),text(note,x(i),101,1,'#e5c289')]),
  text('NATIVE RENDER / 1X',18,113,1,'#a4c5c1'),text('SOURCE ATLAS',18,264,1,'#a4c5c1'),
  rect(18,438,7,7,'#ffe181'),text('ASSIGNED REGION',31,438,1),
  rect(151,438,7,7,'#75e2c8'),text('UV FOOTPRINT',164,438,1)
]});
function blit(name,left,top,cropY=0,zoom=1) {
  const image=PNG.raster(file(name));
  for (let row=0;row<(image.h-2*cropY)*zoom;row++) for (let col=0;col<image.w*zoom;col++) {
    const src=((Math.floor(row/zoom)+cropY)*image.w+Math.floor(col/zoom))*4, dst=((top+row)*W+left+col)*4;
    board.data.set(image.data.subarray(src,src+4),dst);
  }
}
blit('original-atlas.png',x(0)+39,atlasY+19,0,8);
for (const [i,{id}] of cases.entries()) {
  blit(id+'-1x.png',x(i),top);
  if (i) blit(id+'-preview/atlas-after.png',x(i)+Math.floor((w-atlasSize)/2),atlasY,17);
}
write('UV-assignment.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Assign a tile or full sheet

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate the
native renders, atlas previews, and assignment receipts.

The same rectangular panel and triangle are fit as a group into a tile,
then fit individually to an entire sheet. The atlas overlays show the
destination and the actual UV footprint. Each receipt reports texel
coverage, source alpha, and stretch for every selected face.
`);
