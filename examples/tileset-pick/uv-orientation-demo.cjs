'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-orientation-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f4e2c6')=>({type:'text',text,at:[x,y],scale,color});
const width=45,height=35;
function plaque(x,y,base,bevel,mark) {
  return [
    rect(x-1,y-1,11,11,base),rect(x,y,9,1,bevel),rect(x,y+8,9,1,'#192830'),
    rect(x+1,y+1,1,1,bevel),rect(x+7,y+7,1,1,bevel),
    rect(x+2,y+4,5,1,mark),rect(x+5,y+3,1,3,mark),rect(x+4,y+2,1,1,mark),rect(x+4,y+6,1,1,mark),
    rect(x+2,y+2,1,1,bevel)
  ];
}
const painted = art.render({width,height,edges:'hard',commands:[
  rect(0,0,width,height,'#233842'),
  ...plaque(7,13,'#326d70','#84b3a0','#f5d486'),...plaque(29,13,'#94565b','#d79579','#f3d4af'),
  ...plaque(18,2,'#595879','#a294ae','#edd5a1'),...plaque(18,24,'#7d693e','#c0ab76','#f9e2ad')
]});
const source = PNG.encode(width,height,painted.data,4);
write('sign-atlas.png',source);
const scene = {id:'switchyard-sign-uvs',style:'slate',solids:[],
  camera:{target:[0,.5,0],dist:3.4,yaw:-.13,pitch:.10,projection:'orthographic',sway:0},
  tilesets:{plates:ink.readTilesetImage(source)}};
const editor = ink.createSceneEditor(scene);
for (const [face,x,origin] of [['left',7,-1.09],['right',29,.09]]) {
  const selection = ink.pickTilesetRectangle(scene,'plates',{x,y:13,width:9,height:9});
  editor.placeTilesetFace({object:'signs',face,selection,origin:[origin,0,0],worldSize:[1,1]});
}
const before = editor.snapshot(), doc = before.topologyMeshes.signs.document;
json('signs.json',before);
json('query.json',{domain:'faces',ids:['left','right']});
const w=184,h=112,reviewH=166;
json('view.json',{w,h:reviewH,raw:true});
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const target = ['--object','signs','--channel','pigment'];
run(['mesh-uv','select','signs.json','query.json',...target,'--out','selection.json']);
const selection = read('selection.json');
const cases = [
  {id:'original',title:'Original',note:'Two painted signs',pivots:0},
  {id:'group',title:'Group turn',note:'87 to 90 DEG / 15 DEG STEP',options:{degrees:87,increment:15},pivots:1,angle:90},
  {id:'faces',title:'Per-face turn',note:'90 DEG / 2 FACE PIVOTS',options:{mode:'per-face',degrees:90},pivots:2,angle:90},
  {id:'mirror',title:'Per-face mirror',note:'FLIP U COORDINATES',options:{mode:'per-face',flipX:true},pivots:2,angle:0},
  {id:'angle',title:'Stepped turn',note:'34 to 30 DEG / 15 DEG STEP',options:{mode:'per-face',degrees:34,increment:15},pivots:2,angle:30}
];
function capture(id,scene) {
  run(['render',scene,'--w',w,'--h',h,'--px',1,'--ortho','--raw','--out',id+'-1x.png']);
}
capture('original','signs.json');
for (const {id,options,pivots,angle} of cases.slice(1)) {
  json(id+'-request.json',{revision:T.revision(doc),operations:[{op:'orient',selection,space:'texel',...options}]});
  const edit = ['mesh-uv','edit','signs.json',id+'-request.json',...target];
  run(edit.concat('--view','view.json','--preview',id+'-preview'),id+'-preview.json');
  run(edit.concat('--out',id+'.json','--report',id+'-receipt.json'));
  const preview = read(id+'-preview.json'), receipt = read(id+'-receipt.json');
  assert(preview.canCommit);
  assert.deepEqual(preview.operations,receipt.operations);
  const evidence = receipt.operations[0].evidence;
  assert.equal(evidence.angle.applied,angle);
  assert.equal(evidence.angle.exact,angle%90===0);
  assert.equal(evidence.pivots.length,pivots);
  assert.deepEqual(preview.preview.orientation.pivots,evidence.pivots);
  assert.deepEqual(read(id+'.json').topologyMeshes.signs.document.vertices,doc.vertices);
  capture(id,id+'.json');
}
for (const [id,x,y,rotation,flipX] of [
  ['group',18,2,270,false],['faces',7,13,270,false],['mirror',7,13,0,true]
]) {
  run(['tileset','eyedrop','--scene',id+'.json','--object','signs','--face','left'],id+'-eyedrop.json');
  const picked = read(id+'-eyedrop.json');
  assert(picked.canStamp);
  assert.deepEqual([picked.selection.x,picked.selection.y,picked.selection.width,picked.selection.height],[x,y,9,9]);
  assert.deepEqual(picked.paint,{rotation,flipX,flipY:false});
}

const W=1038,H=471, x=i=>18+i*204, modelY=126, layoutY=271;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182932'),text('INK STUDIO / UV EDITING',18,16,2,'#a4c5c1'),
  text('Turn and mirror a painted layout',18,42,3),
  ...cases.flatMap(({title,note},i)=>[text(title,x(i),82,2),text(note,x(i),102,1,'#e5c289')]),
  text('NATIVE RENDER / 1X',18,113,1,'#a4c5c1'),
  text('SOURCE ATLAS',18,257,1,'#a4c5c1'),
  rect(18,447,7,7,'#f0b8ff'),text('APPLIED UV PIVOT',31,447,1),
  text('THE MESH STAYS IN PLACE',179,447,1,'#a4c5c1')
]});
function blit(raster,left,top,scale=1) {
  for (let row=0;row<raster.h*scale;row++) for (let col=0;col<raster.w*scale;col++) {
    const src=(Math.floor(row/scale)*raster.w+Math.floor(col/scale))*4, dst=((top+row)*W+left+col)*4;
    board.data.set(raster.data.subarray(src,src+4),dst);
  }
}
blit(PNG.raster(file('sign-atlas.png')),x(0)+3,layoutY+13,4);
for (const [i,{id}] of cases.entries()) {
  blit(PNG.raster(file(id+'-1x.png')),x(i),modelY);
  if (i) blit(PNG.raster(file(id+'-preview/atlas-after.png')),x(i)+Math.floor((w-reviewH)/2),layoutY);
}
write('UV-orientation.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# UV orientation

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate the
captures, previews, receipts, and eyedrop reports. The generator assembles
the contact sheet.

All edits use the same saved face selection on a rectangular source
atlas. The group uses one pivot and turns into two different painted
cells. Per-face turns and mirrors use each face's own center. The final
preview shows a non-right-angle turn quantized to a 15 degree increment.
`);
