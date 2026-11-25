'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { render, cameraCapture } = require('../../cli/render.js');
const { fixture } = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'coordinate-review');
const cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,value) => fs.writeFileSync(file(name),value);
const json = (name,value) => write(name,JSON.stringify(value,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const kit = ink.load(), { KIT: K } = kit;
const { scene, library, request, shared } = fixture();
const west = scene.instances.west;
west.transform = { ...west.transform, rotation:[.32,0,.65], scale:1.12 };
library.bay.solids.body.at[2] = -.52;
scene.constructionPlane = {origin:[0,0,0],right:[0,1,0],up:[0,0,-1],grid:.1};
const view = {w:154,h:110,camera:{yaw:.74,pitch:.42,dist:3.9,target:[-1.48,.35,0],ortho:true}};
json('scene.json',scene);
json('library.json',library);
json('view.json',view);

const modes = [
  ['world','WORLD','Scene X','#edb87c'],['local','OBJECT LOCAL','Placed mesh X','#a9cfeb'],
  ['plane','CONSTRUCTION PLANE','Plane right','#ccabec'],['camera','CAMERA','Image right','#80dfc1']
];
const commands = [], receipts = new Map(), operation = {kind:'move',offset:[.32,0,0]};
for (const [space] of modes) {
  json(space+'.json',{...request,edits:[{member:'panel',transform:{space,operation,pins:{vertices:shared}}}]});
  const args = ['mesh-topology','isolate-prefab','scene.json',space+'.json','--view','view.json','--preview',space+'-1x.png'];
  commands.push('ink-studio '+args.join(' ')+' > '+space+'-report.json');
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  write(space+'-report.json',output);
  const report = JSON.parse(output);
  assert(report.canCommit);
  assert.deepEqual(report.edits[0].changedFaces,['sign']);
  assert.deepEqual(report.edits[0].evidence.pinned,[...shared].sort());
  receipts.set(space,report.edits[0].evidence);
}
assert.deepEqual(receipts.get('world').worldAxes[0],[1,0,0]);
assert.deepEqual(receipts.get('plane').worldAxes[0],[0,1,0]);
assert.notDeepEqual(receipts.get('local').worldAxes[0],[1,0,0]);

const editor = ink.createSceneEditor(scene,{env:{prefabs:library}});
let camera,focal;
render(editor.build(),{...view,px:1,raw:true,renderGrid:false,...cameraCapture(null,(raster,sample)=>{
  if (raster.width===view.w && raster.height===view.h) { camera=raster; focal=sample.focal; }
})});
assert(camera?.ortho);
const pose = kit.CameraLens.fromView(camera.view);
assert(K.V.dist(receipts.get('camera').worldAxes[0],pose.right)<1e-8);

const W=1320,H=427,top=139, panels=[22,344,666,988], art=K.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f0e9d3')=>({type:'text',text,at:[x,y],scale,color});
const line=(points,color,width=2)=>({type:'path',points,color,width});
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182a34'),label('INK STUDIO / COMPONENT TRANSFORMS',22,18,2,'#a7c5b4'),
  label('One X move in four spaces',22,49,3),
  ...modes.flatMap(([,title,axis,color],i)=>{
    const x=panels[i];
    return [label(title,x,109,2,color),rect(x-1,top-1,2*view.w+2,2*view.h+2,'#4c6a70'),label(axis,x,375,1,color)];
  }),
  label('Hollow dot marks the original vertex. The shared grille edge stays pinned.',22,400,1,'#aec1bd')
]});
const marks=[];
for (const [i,[space,,,color]] of modes.entries()) {
  const image=PNG.raster(file(space+'-1x.png')), x=panels[i];
  for (let y=0;y<image.h*2;y++) for (let col=0;col<image.w*2;col++) {
    const at=(Math.floor(y/2)*image.w+Math.floor(col/2))*4;
    board.data.set(image.data.subarray(at,at+4),((top+y)*W+x+col)*4);
  }
  const {frame,vertices}=receipts.get(space);
  const vertex=vertices.reduce((lowest,next)=>next.before[1]<lowest.before[1]?next:lowest);
  const project=value=>{
    const point=K.V.sub(K.sceneGraph.point(frame,value),pose.eye);
    return [x+view.w+2*focal*K.V.dot(point,pose.right),top+view.h-2*focal*K.V.dot(point,pose.up)];
  };
  const from=project(vertex.before), to=project(vertex.after);
  const dx=to[0]-from[0], dy=to[1]-from[1], mag=Math.hypot(dx,dy);
  assert(mag>2);
  const ux=dx/mag, uy=dy/mag;
  marks.push(line([from,to],'#15232d',5),line([from,to],color),
    line([[to[0]-ux*7-uy*3,to[1]-uy*7+ux*3],to,[to[0]-ux*7+uy*3,to[1]-uy*7-ux*3]],color),
    rect(Math.round(from[0])-2,Math.round(from[1])-2,5,5,color),
    rect(Math.round(from[0])-1,Math.round(from[1])-1,3,3,'#15232d'));
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('Transform-coordinates.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# One X move in four spaces

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH.

Each command applies the same X offset to the sign on an isolated,
rotated prefab instance. The original vertex and resulting movement
are marked on the review board. The shared grille edge remains pinned.
Reports record the world-space axis vectors. The camera report also
records the sampled basis so the camera-relative move can be repeated
from another view.
`);
