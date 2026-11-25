'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { render, cameraCapture } = require('../../cli/render.js');

const dir=path.resolve(process.argv[2] ?? 'quad-diagonal-review');
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const file=name=>path.join(dir,name);
const write=(name,value)=>fs.writeFileSync(file(name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const kit=ink.load(), { KIT: K }=kit, T=K.meshTopology, art=K.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f5ebd8')=>({type:'text',text,at:[x,y],scale,color});
const line=(points,color,width)=>({type:'path',points,color,width});
const slate='#192830', muted='#afc5c6', oldColor='#b8e5bb', newColor='#f2c57f', changeColor='#e79181';
const paint=art.render({width:40,height:28,edges:'hard',commands:[
  rect(0,0,40,28,'#424551'),rect(1,1,38,26,'#466d72'),rect(2,2,36,24,'#6b8c86'),
  ...[4,9,14,19,24].flatMap((y,i)=>[rect(2,y,36,1,'#365560'),
    ...[6,17,28].map(x=>rect(x+(i%2)*3,y,1,5,'#476b6d'))]),
  rect(1,3,38,2,'#c1c5a2'),rect(1,23,38,2,'#c1c5a2'),
  rect(5,7,30,14,'#314e57'),rect(7,9,26,10,'#527a76'),
  ...[12,19,26].map(x=>rect(x,11,3,5,'#c3d3a7')),
  ...[[4,5],[34,5],[4,21],[34,21]].map(([x,y])=>rect(x,y,2,2,'#d4c59a'))
]});
const atlas=PNG.encode(40,28,paint.data,4);
write('paint.png',atlas);
const positions=[[-1.10,.06,0],[1.10,.06,0],[1.10,1.52,.88],[-1.10,1.52,0]];
const document=T.create({id:'bent-cover',vertices:positions.map((position,i)=>({id:'v'+i,position})),
  faces:[{id:'cover',material:'tileset/paint',corners:[[0,1],[1,1],[1,0],[0,0]].map((uv,i)=>({id:'c'+i,vertex:'v'+i,uv}))}]});
const scene={id:'cover-bench',style:'slate',solids:[],
  camera:{target:[0,.79,.22],dist:3.05,yaw:.43,pitch:.20,projection:'orthographic',sway:0},
  tilesets:{paint:ink.readTilesetImage(atlas)},topologyMeshes:{cover:{document,
    materials:[{id:'tileset/paint',texture:{tileset:'paint'}}]}}};
json('original.json',scene);
json('flip-request.json',{revision:T.revision(document),operations:[{kind:'flip-diagonal',
  selection:T.select(document,{domain:'faces',ids:['cover']})}]});

const view={w:156,h:109,px:1,raw:true,ortho:true}, commands=[];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output=execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const action=['mesh-topology','repair','original.json','flip-request.json','--object','cover'];
run(action,'flip-preview.json');
run([...action,'--out','flipped.json','--report','flip-receipt.json']);
const receipt=read('flip-receipt.json').repair, comparison=receipt.steps[0].faces[0];
assert.deepEqual(read('flip-preview.json').report,receipt);
const changed=read('flipped.json').topologyMeshes.cover.document;
assert.deepEqual(changed.faces[0].corners,document.faces[0].corners);
assert.deepEqual(changed.edges,document.edges);
assert.deepEqual(changed.vertices,document.vertices);
for (const id of ['original','flipped']) run(['render',id+'.json','--w',view.w,'--h',view.h,
  '--px','1','--ortho','--raw','--out',id+'-1x.png']);

const raster=['original','flipped'].map(id=>PNG.raster(file(id+'-1x.png')));
const diff=new Uint8Array(raster[0].data.length);
let pixels=0;
for (let i=0;i<diff.length;i+=4) {
  const touched=raster[0].data.subarray(i,i+4).some((n,j)=>n!==raster[1].data[i+j]);
  if (touched) pixels++;
  diff.set(touched ? [231,145,129,255] : [12,16,20,255],i);
}
assert(pixels>0);
write('changed-pixels-1x.png',PNG.encode(view.w,view.h,diff,4));
const sample=doc=>K.sceneMeshes.rayQuery(T.toSceneMesh(doc),K)({
  origin:[0,.79,2],direction:[0,0,-1],maxDistance:4
}).point[2];
assert(Math.abs(sample(document))<1e-7);
assert(Math.abs(sample(changed)-.44)<1e-7);

let camera,focal;
render(ink.createSceneEditor(scene).build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width===view.w && raster.height===view.h) { camera=raster; focal=sample.focal; }
})});
assert(camera?.ortho);
const pose=kit.CameraLens.fromView(camera.view), zoom=2,W=1008,H=427;
const slots=[[20,112],[348,112],[676,112]];
const panels=[
  ['Original diagonal','C1 to C3',comparison.before,oldColor,sample(document)],
  ['Flipped diagonal','C0 to C2',comparison.after,newColor,sample(changed)],
  ['Native pixels changed',String(pixels)+' pixels',null,changeColor]
];
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,slate),label('INK STUDIO / MESH TOPOLOGY',20,16,2,muted),
  label('Flip the crease on a bent tile',20,45,3),
  ...panels.flatMap(([title,caption,data,color,z],i)=>{
    const [x,y]=slots[i], bottom=y+zoom*view.h;
    return [label(title,x,y-22,2),rect(x-1,y-1,view.w*zoom+2,view.h*zoom+2,'#516970'),
      label(caption,x,bottom+10,2,color),...(data ? [
        label('CENTER Z  '+z.toFixed(2)+'    BEND  '+data.bendDegrees.toFixed(1)+' DEG',x,bottom+35,1,muted)
      ] : [label('Exact RGBA difference at 1x.',x,bottom+35,1,muted)])];
  }),
  label('ONE QUAD / FOUR AUTHORED CORNERS',20,409,1,muted),
  label('COLORED LINE / DERIVED RENDER DIAGONAL',348,409,1,muted)
]});
const marks=[];
for (const [i,[x,y]] of slots.entries()) {
  const data=i===2 ? diff : raster[i].data;
  for (let row=0;row<view.h*zoom;row++) for (let col=0;col<view.w*zoom;col++) {
    const at=(Math.floor(row/zoom)*view.w+Math.floor(col/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+x+col)*4);
  }
  if (i===2) continue;
  const [,,evidence,color]=panels[i];
  const project = point => {
    const at=K.V.sub(point,pose.eye);
    return [Math.round(x+view.w+zoom*focal*K.V.dot(at,pose.right)),Math.round(y+view.h-zoom*focal*K.V.dot(at,pose.up))];
  };
  const endpoints=evidence.vertices.map(id=>project(document.vertices.find(row=>row.id===id).position));
  marks.push(line(endpoints,'#1e3036',3),line(endpoints,color,1));
  for (const [u,v] of endpoints) marks.push(rect(u-2,v-2,5,5,color));
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('Quad-diagonal.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Flip the crease on a bent tile

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to replay the edit
and regenerate the two native renders and the receipts.

The same four authored corners support both triangulations. Flipping
the diagonal changes the crease and the mesh-local Z hit of a ray
through the tile center from 0.00 to 0.44. The review board marks the
diagonals and highlights changed native pixels.
`);
