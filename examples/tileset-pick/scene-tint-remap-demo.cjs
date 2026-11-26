'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'), path=require('node:path');
const ink=require('../..'), PNG=require('../../cli/png.js');
const {scene,library,view}=require('./prefab-isolation-fixture.cjs').fixture();
const {KIT:{meshTopology:T,procedural:{drawing2d}}}=ink.load();
delete scene.topologyMeshes.pillar;
const member=library.bay.topologyMeshes.panel;
const from='#dd9e63', to='#37a4f0';
const blended=T.planTint(member.document,{tool:'blend',mode:'alpha-blend'}).document;
member.document=T.planTint(blended,{tool:'paint',face:'sign',color:from,opacity:.62}).document;

const out=path.resolve(process.argv[2] ?? 'scene-tint-remap-demo'), commands=[];
const file=name=>path.join(out,name), write=(name,data)=>fs.writeFileSync(file(name),data);
const json=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(out,{recursive:true});
json('station.json',scene);
json('library.json',library);
json('view.json',{...view,raw:true});
json('find.json',{from});
json('remap.json',{from,to});
json('inspect.json',{});
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
function run(source,request,receipt,...args) {
  const command=['mesh-topology','tint-remap',source,request,...args];
  commands.push('ink-studio '+command.join(' ')+' > '+receipt);
  const stdout=execFileSync(process.execPath,[cli,...command],{cwd:out,encoding:'utf8'});
  write(receipt,stdout);
  return JSON.parse(stdout);
}
const found=run('station.json','find.json','found.json');
assert.deepEqual(found.meshes.map(row=>row.object),['east.panel','west.panel']);
const review=run('station.json','remap.json','review.json','--view','view.json','--preview','review');
assert.equal(review.changedFaces,2);
assert.equal(review.changedCorners,8);
assert(review.native.changedPixels>0);
const commit=run('station.json','remap.json','commit.json','--expect','review.json','--out','station-recolored.json');
assert.deepEqual(commit.meshes,review.meshes);
const inspect=run('station-recolored.json','inspect.json','inspected.json','--view','view.json','--preview','inspected');
assert.deepEqual(inspect.native.files,['texture-only.png','tint-only.png']);
const read=name=>fs.readFileSync(file(name));
assert.deepEqual(read('review/texture-only.png'),read('inspected/texture-only.png'));
assert.deepEqual(read('review/tint-after.png'),read('inspected/tint-only.png'));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\ncmp review/texture-only.png inspected/texture-only.png\ncmp review/tint-after.png inspected/tint-only.png\n');
write('README.md','# Scene tint remap\n\nRun `sh COMMANDS.sh` with Ink Studio on your PATH.\n\n'+
  'Find the warm tint on two prefab signs and preview the replacement.\n'+
  'Commit the reviewed change as scene instance overrides.\n'+
  'Compare the same texture-only image and both tint-only captures.\n');

const W=887,H=530, x=[20,455], y=[109,333];
const label=(text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const board=drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#192d37'),label('INK STUDIO / SCENE COLOR',20,15,2,'#a4d1c0'),
  label('Remap one tint across two signs',20,41,3),
  label('BEFORE',x[0],87,2),label('AFTER',x[1],87,2),
  label('TEXTURE ONLY',x[0],311,2),label('TINT ONLY AFTER REMAP',x[1],311,2),
  ...y.flatMap(row=>x.map(col=>rect(col,row,412,180,'#111a23')))
]});
const frames=['review/before.png','review/after.png','review/texture-only.png','review/tint-after.png'];
for (const [i,name] of frames.entries()) {
  const frame=PNG.raster(file(name));
  const left=x[i%2], top=y[Math.floor(i/2)];
  for (let dy=0;dy<180;dy++) for (let dx=0;dx<412;dx++) {
    const at=((5+Math.floor(dy/2))*frame.w+Math.floor(dx/2))*4;
    if (frame.data[at+3]) board.data.set(frame.data.subarray(at,at+4),((top+dy)*W+left+dx)*4);
  }
}
write('Scene-tint-remap.png',PNG.encode(W,H,board.data,4));
