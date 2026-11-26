'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, UV = T.uv, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-connected-unwrap-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f4e2c6')=>({type:'text',text,at:[x,y],scale,color});
const width=100,height=64;
const painted = art.render({width,height,edges:'hard',commands:[
  rect(0,0,width,height,'#273d48'),
  rect(8,14,65,23,'#40636a'),rect(8,16,65,2,'#9db99a'),rect(9,22,64,1,'#628d88'),
  rect(9,30,63,2,'#c89f6d'),rect(9,32,63,3,'#334f56'),
  rect(11,19,16,11,'#273f47'),rect(12,20,14,1,'#547c7e'),text('N4',13,22,1,'#f7d391'),
  rect(29,22,1,8,'#6f8776'),rect(36,23,14,1,'#899e83'),rect(36,26,14,1,'#899e83'),
  rect(54,20,16,10,'#49636d'),rect(56,22,11,1,'#74858b'),rect(56,25,8,1,'#74858b'),
  rect(67,10,25,16,'#6b4e49'),rect(69,11,22,14,'#a56c4f'),rect(69,11,22,1,'#e7b785'),
  rect(70,23,20,1,'#e7b785'),rect(72,14,4,7,'#503f43'),
  rect(79,14,3,7,'#d8a76f'),rect(85,14,3,7,'#503f43'),
  rect(11,44,71,3,'#36535c'),rect(11,49,62,2,'#4b6973')
]});
const texture = PNG.encode(width,height,painted.data,4);
write('enamel.png',texture);
const vertices = Array.from({length:4},(_,x)=>[
  {id:'b'+x,position:[x-1.5,0,0]},{id:'t'+x,position:[x-1.5,1,0]}
]).flat();
const names = ['label','web','wing'];
const faces = names.map((id,i)=>{
  const [l,r] = [[.10,.28],[.32,.53],[.53,.73]][i];
  const uvs = [[l,.50],[r,.50],[r,.25],[l,.25]];
  return {id,material:'enamel',corners:['b'+i,'b'+(i+1),'t'+(i+1),'t'+i].map((vertex,j)=>({
    id:id+'/'+j,vertex,uv:uvs[j]
  }))};
});
const doc = T.create({id:'station-facade',vertices,faces});
const edges = UV.inspect(doc).edges;
const seam = (a,b)=>edges.find(row=>row.sides.some(side=>side.face===a) && row.sides.some(side=>side.face===b)).id;
const join = seam('label','web'), cut = seam('web','wing');
const scene = {id:'connected-unwrap-facade',style:'slate',solids:[],
  camera:{target:[0,.5,0],dist:3.4,yaw:-.19,pitch:.12,projection:'orthographic',sway:0},
  tilesets:{enamel:ink.readTilesetImage(texture)},
  topologyMeshes:{facade:{document:doc,materials:[{id:'enamel',texture:{tileset:'enamel'}}]}}};
json('facade.json',scene);
json('faces-query.json',{domain:'faces',ids:names});
json('cuts-query.json',{domain:'edges',ids:[cut]});
const w=248,h=128,atlasSize=254;
json('view.json',{w,h:atlasSize,raw:true});

const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const id of ['faces','cuts']) run(['mesh-uv','select','facade.json',id+'-query.json',
  '--object','facade','--out',id+'-selection.json']);
const request = {revision:T.revision(doc),protect:{painted:[{id:'N4 enamel',faces:['label']}]},operations:[
  {op:'unwrap',across:'geometry',selection:read('faces-selection.json'),cuts:read('cuts-selection.json'),
    atlas:[width,height],rects:{wing:[.70,.18,.20,.20]}}
]};
json('unwrap.json',request);
const edit = ['mesh-uv','edit','facade.json','unwrap.json','--object','facade'];
run(edit.concat('--view','view.json','--preview','unwrap-preview'),'unwrap-preview.json');
run(edit.concat('--out','unwrapped.json','--report','unwrap-receipt.json'));
const preview = read('unwrap-preview.json'), receipt = read('unwrap-receipt.json');
assert(preview.canCommit);
assert.deepEqual(preview.operations,receipt.operations);
const evidence = receipt.operations[0].evidence;
assert.deepEqual(evidence.joinedEdges,[join]);
assert.deepEqual(evidence.cuts,[cut]);
assert.deepEqual(evidence.components.map(row=>row.faces),[['label','web'],['wing']]);
assert.deepEqual(evidence.protectedCorners,doc.faces[0].corners.map(row=>row.id));
const after = read('unwrapped.json').topologyMeshes.facade.document;
assert.deepEqual(after.vertices,doc.vertices);
assert.deepEqual(after.faces[0],doc.faces[0]);
assert.deepEqual(receipt.seams,[{id:cut,uvSeam:true}]);

json('blocked.json',{...request,protect:{painted:[{id:'N4 and web retained',faces:['label','web']}]}});
run(['mesh-uv','edit','facade.json','blocked.json','--object','facade'],'blocked-receipt.json');
assert.equal(read('blocked-receipt.json').canCommit,false);
assert(read('blocked-receipt.json').operations[0].conflicts.some(row=>row.code==='conflicting-unwrap-anchors'));
for (const [id,name] of [['before','facade.json'],['after','unwrapped.json']])
  run(['render',name,'--w',w,'--h',h,'--px',1,'--ortho','--raw','--out',id+'-1x.png']);

const W=580,H=453,x=i=>18+i*280,modelY=122,atlasY=271;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182932'),text('INK STUDIO / UV EDITING',18,16,2,'#a4c5c1'),
  text('Unwrap a painted facade',18,41,3),
  text('Before',x(0),79,2),text('UV GAP BESIDE THE LABEL',x(0),101,1,'#e5c289'),
  text('After',x(1),79,2),text('WEB JOINED / WING CUT',x(1),101,1,'#e5c289'),
  text('NATIVE RENDER / 1X',18,111,1,'#a4c5c1'),text('SOURCE ATLAS',18,259,1,'#a4c5c1'),
  rect(18,430,7,7,'#ffcb78'),text('HELD PAINT',31,430,1),
  rect(110,430,7,7,'#f391a6'),text('CUT EDGE',123,430,1)
]});
function blit(name,left,top,cropY=0) {
  const image=PNG.raster(file(name));
  for (let row=0;row<image.h-2*cropY;row++) {
    const start=(row+cropY)*image.w*4, output=((top+row)*W+left)*4;
    board.data.set(image.data.subarray(start,start+image.w*4),output);
  }
}
for (const [i,id] of ['before','after'].entries()) {
  blit(id+'-1x.png',x(i),modelY);
  blit('unwrap-preview/atlas-'+id+'.png',x(i),atlasY,56);
}
write('UV-connected-unwrap.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Unwrap a painted facade

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the captures, previews, and both edit receipts.

The unwrap joins the web to the signed N4 panel, holds that panel's
UV coordinates exactly, and authors a cut between the web and the
wing. An alternate request tries to hold both mismatched sides of
the inferred seam and reports the anchor conflict.
`);
