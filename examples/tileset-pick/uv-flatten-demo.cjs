'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-flatten-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f4e2c6')=>({type:'text',text,at:[x,y],scale,color});
const width=65,height=41,density=12;
function panel(x,dark,base,light) {
  return [rect(x,3,26,20,dark),rect(x+1,4,24,18,base),
    ...Array.from({length:6},(_,i)=>rect(x+3+3*i,5,1,15,i%2 ? dark : light)),
    rect(x+1,5,24,1,light),rect(x+1,17,24,1,dark),rect(x+2,19,19,1,light)];
}
const painted = art.render({width,height,edges:'hard',commands:[
  rect(0,0,width,height,'#253d48'),
  ...panel(3,'#385960','#507b7d','#b4c29e'),
  ...panel(30,'#60494b','#956c57','#e2ae79'),
  rect(5,28,52,6,'#364f59'),rect(6,30,34,1,'#5d777b'),rect(6,32,44,1,'#476468')
]});
const source = PNG.encode(width,height,painted.data,4);
write('ruler-atlas.png',source);
const vertices = [], faces = [];
for (const [id,x,texel] of [['follow',-1.75,5],['static',.25,32]]) {
  const corners = [[0,0],[1,0],[1,1],[0,1]].map(([u,v],i)=>{
    const vertex = id+'/v'+i;
    vertices.push({id:vertex,position:[x+u,v,0]});
    return {id:id+'/c'+i,vertex,uv:[(texel+18*u)/64,(5+8*(1-v))/40]};
  });
  faces.push({id,material:'ruler',corners});
}
const doc = T.create({id:'ruler-boards',vertices,faces});
const scene = {id:'flatten-ruler',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:density},
  camera:{target:[0,.49,0],dist:4.4,yaw:-.08,pitch:.08,projection:'orthographic',sway:0},
  tilesets:{ruler:ink.readTilesetImage(source)},
  topologyMeshes:{panels:{document:doc,materials:[{id:'ruler',texture:{tileset:'ruler'}}]}}};
json('panels.json',scene);
const w=214,h=115;
json('view.json',{w,h:164,raw:true});
json('flatten.json',{revision:T.revision(doc),operations:[
  {op:'flatten',ids:['follow'],refit:true},{op:'flatten',ids:['static']}
]});
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const edit = ['mesh-uv','edit','panels.json','flatten.json','--object','panels','--channel','pigment'];
run(edit.concat('--view','view.json','--preview','flatten-preview'),'flatten-preview.json');
run(edit.concat('--out','flat.json','--report','flatten-receipt.json'));
const flat = read('flat.json').topologyMeshes.panels, receipt = read('flatten-receipt.json'), preview = read('flatten-preview.json');
assert(preview.canCommit);
assert.deepEqual(preview.operations,receipt.operations);
assert.deepEqual(flat.bindings.map(row=>row.element),['follow']);
assert.deepEqual(flat.document.vertices,doc.vertices);
for (const row of receipt.operations) assert.equal(row.evidence.texelsPerUnit,density);
const ids = ['follow/v1','follow/v2','static/v1','static/v2'];
json('move.json',{selection:T.select(flat.document,{domain:'vertices',ids}),operation:{kind:'move',offset:[.5,0,0]}});
const move = ['mesh-topology','transform','flat.json','move.json','--object','panels'];
run(move,'move-preview.json');
run(move.concat('--out','moved.json','--report','move-receipt.json'));
const moved = read('moved.json').topologyMeshes.panels;
const refits = read('move-receipt.json').transform.uvRefits;
assert.deepEqual(refits,read('move-preview.json').report.uvRefits);
assert.deepEqual(refits.map(row=>[row.face,row.status,row.texelBounds]),[['follow','refit',[5,5,23,17]]]);
assert.deepEqual(moved.document.faces.find(row=>row.id==='static'),flat.document.faces.find(row=>row.id==='static'));

const cases = [
  {id:'original',scene:'panels.json',title:'Authored UVs',note:'18 x 8 TEXELS PER PANEL'},
  {id:'flat',scene:'flat.json',title:'After flattening',note:'12 x 12 TEXELS PER PANEL'},
  {id:'moved',scene:'moved.json',title:'After widening',note:'REFIT 18 x 12 / STATIC 12 x 12'}
];
for (const {id,scene} of cases) {
  run(['render',scene,'--w',w,'--h',h,'--px',1,'--ortho','--raw','--out',id+'-1x.png']);
  run(['mesh-uv','layout',scene,'--object','panels','--channel','pigment'],id+'-layout.json');
}
const W=716,H=428, x=i=>18+i*232, modelY=127, atlasY=275, zoom=3;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182932'),text('INK STUDIO / UV EDITING',18,16,2,'#a4c5c1'),
  text('Flatten and refit at 12 texels/unit',18,42,3),
  ...cases.flatMap(({title,note},i)=>[text(title,x(i),80,2),text(note,x(i),101,1,'#e5c289')]),
  text('NATIVE RENDER / 1X',18,114,1,'#a4c5c1'),text('SOURCE ATLAS',18,262,1,'#a4c5c1'),
  rect(18,411,7,7,'#ffc882'),text('REFIT ENABLED',31,411,1),
  rect(124,411,7,7,'#8bd3cf'),text('STATIC UVS',137,411,1)
]});
function blit(raster,left,top,scale=1) {
  for (let row=0;row<raster.h*scale;row++) for (let col=0;col<raster.w*scale;col++) {
    const src=(Math.floor(row/scale)*raster.w+Math.floor(col/scale))*4, dst=((top+row)*W+left+col)*4;
    board.data.set(raster.data.subarray(src,src+4),dst);
  }
}
const guides = [];
for (const [i,{id}] of cases.entries()) {
  blit(PNG.raster(file(id+'-1x.png')),x(i),modelY);
  const left=x(i)+8;
  blit({w:width,h:height,data:painted.data},left,atlasY,zoom);
  const layout = read(id+'-layout.json');
  for (const [face,color] of [['follow','#ffc882'],['static','#8bd3cf']]) {
    const points=layout.corners.filter(row=>row.face===face).map(({texel:[u,v]})=>[
      Math.round(left+(u+.5)*zoom),Math.round(atlasY+(v+.5)*zoom)
    ]);
    guides.push({type:'path',points:[...points,points[0]],color,width:1});
  }
}
const overlay = art.render({width:W,height:H,edges:'hard',commands:guides}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('UV-flatten.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Flatten and refit UVs

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate the
native captures, layout reports, and edit receipts.

Both panels first flatten at 12 texels per mesh unit. After widening
both by half a unit, the left panel refits to an 18-texel span. The right
panel keeps its original 12-texel span. The same edit receipt reports
the geometry move and the UV refit.
`);
