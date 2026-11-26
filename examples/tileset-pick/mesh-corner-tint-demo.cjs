'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');
const {scene, panel, shared} = fixture();
delete scene.prefabLibrary;
delete scene.instances;
scene.topologyMeshes = {panel};
const sign = panel.document.faces.find(row=>row.id==='sign');
const isolated = sign.corners[0].id, seam = shared[0];
const view = {w:114,h:90,raw:true,camera:{yaw:0,pitch:0,dist:3.6,target:[0,.45,0],ortho:true,zoom:1.6}};

const out = path.resolve(process.argv[2] ?? 'mesh-tint-demo');
const file = name=>path.join(out,name), commands = [];
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(out,{recursive:true});
json('station.json',scene);
json('view.json',view);
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
function run(args,receipt) {
  commands.push('ink-studio '+args.join(' ')+' > '+(receipt ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
  if (!receipt) return;
  write(receipt,output);
  return JSON.parse(output);
}
function edit(name,source,request,selection) {
  const receipt = name+'-review.json', result = name+'-station.json', input = name+'-request.json';
  json(input,request);
  const args = ['mesh-topology','tint',source,input,'--object','panel',
    ...(selection ? ['--selection',selection] : [])];
  const review = run([...args,'--view','view.json','--preview',name],receipt);
  assert(review.canCommit && review.native.changedPixels>0,JSON.stringify(review));
  const commit = run([...args,'--expect',receipt,'--out',result],name+'-commit.json');
  assert.deepEqual(commit.changes,review.changes);
  return {result,review};
}
const corner = edit('corner','station.json',{tool:'paint',corner:isolated,color:'#fe8354'});
assert.equal(corner.review.changedCorners,1);
json('faces-query.json',{domain:'faces',ids:['sign']});
run(['mesh-topology','select','station.json','faces-query.json','--object','panel','--out','faces.json']);
const face = edit('face','station.json',{tool:'paint',color:'#ddae87'},'faces.json');
assert.equal(face.review.changedCorners,4);
const vertex = edit('vertex',face.result,{tool:'paint',vertex:seam,color:'#6fa5ff'});
assert.deepEqual(vertex.review.changes.map(row=>row.face).sort(),['grille','sign']);
const erased = edit('erase',vertex.result,{tool:'erase',corner:isolated});
json('sample-request.json',{tool:'eyedropper',corner:isolated});
const sample = run(['mesh-topology','tint',erased.result,'sample-request.json','--object','panel'],'sample.json');
assert.equal(sample.samples[0].tint,null);
const final = JSON.parse(fs.readFileSync(file(erased.result),'utf8'));
assert.deepEqual(final.tilesets,scene.tilesets);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md','# Mesh corner tint\n\nRun `sh COMMANDS.sh` with Ink Studio on your PATH.\n\n'+
  'Paint one corner, then tint a face from a saved selection. Apply a blue tint\n'+
  'to a vertex shared by the sign and grille. Clear the first corner and sample it\n'+
  'to confirm the erase. Each edit ships with matched native captures and a receipt.\n');

const {drawing2d} = ink.load().KIT.procedural;
const W=865,H=323, starts=[18,229,440,651];
const label = (text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const board = drawing2d.render({width:W,height:H,edges:'hard',commands:[
  {type:'rect',rect:[0,0,W,H],fill:'#192d37'},
  label('INK STUDIO / MESH TINT',18,17,2,'#a4d1c0'),label('Paint mesh tint at corners',18,42,3),
  ...['ORIGINAL','ONE CORNER','FACE + VERTEX','ERASE CORNER'].map((text,i)=>label(text,starts[i],83,2)),
  ...['SOURCE PIGMENT','GRADIENT ON ONE FACE','BLUE AT A SHARED VERTEX','NEUTRAL AT ONE CORNER']
    .map((text,i)=>label(text,starts[i],294,1,'#a4d1c0'))
]});
for (const [i,name] of ['corner/before.png','corner/after.png','vertex/after.png','erase/after.png'].entries()) {
  const image = PNG.raster(file(name));
  for (let y=0;y<168;y++) for (let x=0;x<198;x++) {
    const at = ((16+Math.floor(y/3))*image.w+24+Math.floor(x/3))*4;
    board.data.set(image.data.subarray(at,at+4),((110+y)*W+starts[i]+x)*4);
  }
}
write('Mesh-corner-tint.png',PNG.encode(W,H,board.data,4));
