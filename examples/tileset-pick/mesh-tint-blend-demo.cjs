'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {scene,panel} = require('./prefab-isolation-fixture.cjs').fixture();
delete scene.prefabLibrary;
delete scene.instances;
scene.topologyMeshes = {panel};
const face = panel.document.faces.find(row=>row.id==='sign');
const view = {w:114,h:90,raw:true,camera:{yaw:0,pitch:0,dist:3.6,target:[0,.45,0],ortho:true,zoom:1.6}};

const out = path.resolve(process.argv[2] ?? 'mesh-tint-blend-demo');
const file = name=>path.join(out,name), commands = [];
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(out,{recursive:true});
json('station.json',scene);
json('view.json',view);
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
function run(args,receipt) {
  commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  const stdout=execFileSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
  write(receipt,stdout);
  return JSON.parse(stdout);
}
function edit(name,source,operation,preview=false) {
  const request=name+'-request.json', result=name+'-station.json', receipt=name+'-review.json';
  json(request,operation);
  const args=['mesh-topology','tint',source,request,'--object','panel'];
  const review=run(preview ? [...args,'--view','view.json','--preview',name] : args,receipt);
  assert(review.canCommit);
  if (preview) assert(review.native.changedPixels>0);
  const commit=run([...args,'--expect',receipt,'--out',result],name+'-commit.json');
  assert.equal(commit.afterRevision,review.afterRevision);
  return result;
}
const warm={tool:'paint',face:'sign',color:'#dfa66d',opacity:.5};
const replace=edit('replace-mode','station.json',{tool:'blend',mode:'replace'});
edit('replace',replace,warm,true);
const alpha=edit('alpha-mode','station.json',{tool:'blend',mode:'alpha-blend'});
edit('alpha',alpha,warm,true);
const positions=new Map(panel.document.vertices.map(({id,position})=>[id,position]));
const dark=face.corners.filter(row=>positions.get(row.vertex)[0]<0).map(row=>row.id);
const light=face.corners.filter(row=>positions.get(row.vertex)[0]>=0).map(row=>row.id);
assert.equal(dark.length,2);
assert.equal(light.length,2);
const midpoint=edit('midpoint-mode','station.json',{tool:'blend',mode:'midpoint'});
const shaded=edit('dark',midpoint,{tool:'paint',selection:{domain:'corners',ids:dark},color:[.19,.19,.19]});
const final=edit('light',shaded,{tool:'paint',selection:{domain:'corners',ids:light},color:[.82,.82,.82]},true);
assert.deepEqual(JSON.parse(fs.readFileSync(file(final),'utf8')).tilesets,scene.tilesets);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md','# Mesh tint blend behavior\n\nRun `sh COMMANDS.sh` with Ink Studio on your PATH.\n\n'+
  'Apply the same warm color to a face with replace and alpha blend.\n'+
  'Run a midpoint tint across the sign from dark to light.\n'+
  'The native previews and receipts use the existing tile paint.\n');

const {drawing2d}=ink.load().KIT.procedural, W=865,H=323, starts=[18,229,440,651];
const label=(text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const board=drawing2d.render({width:W,height:H,edges:'hard',commands:[
  {type:'rect',rect:[0,0,W,H],fill:'#192d37'},
  label('INK STUDIO / MESH TINT',18,17,2,'#a4d1c0'),label('Blend vertex color with paint',18,42,3),
  ...['ORIGINAL','REPLACE','ALPHA BLEND','MIDPOINT'].map((text,i)=>label(text,starts[i],83,2)),
  ...['SOURCE PIGMENT','FULL COLOR','50% COLOR MIX','DARK / NEUTRAL / LIGHT']
    .map((text,i)=>label(text,starts[i],294,1,'#a4d1c0'))
]});
for (const [i,name] of ['replace/before.png','replace/after.png','alpha/after.png','light/after.png'].entries()) {
  const frame=PNG.raster(file(name));
  for (let y=0;y<168;y++) for (let x=0;x<198;x++) {
    const at=((16+Math.floor(y/3))*frame.w+24+Math.floor(x/3))*4;
    board.data.set(frame.data.subarray(at,at+4),((110+y)*W+starts[i]+x)*4);
  }
}
write('Mesh-tint-blend.png',PNG.encode(W,H,board.data,4));
