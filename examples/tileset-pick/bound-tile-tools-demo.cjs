'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');
const {scene,library,view,image} = fixture();
delete scene.topologyMeshes.pillar;
const row = library.bay.topologyMeshes.panel;
row.bakes = [{id:'enamel-finish',material:row.document.faces.find(face=>face.id==='sign').material,
  maps:{roughness:.37,texture:{tileset:'enamel'}}}];
const {drawing2d} = ink.load().KIT.procedural;
const directory = path.resolve(process.argv[2] ?? 'bound-tile-tools-demo');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(directory,{recursive:true});
json('station.json',scene);
json('library.json',library);
write('enamel.png',image);

const target = {at:[149,52],object:'east.panel',face:'sign',view};
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
function run(input, scene, options, receipt) {
  const args = ['tileset','paint','face',input+'.json','--scene',scene+'.json',...options];
  commands.push('ink-studio '+args.join(' ')+' > '+receipt+'.json');
  const output = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  write(receipt+'.json',output);
  return JSON.parse(output);
}
function eyedrop(id, scene, sample, channel) {
  const input = id+'-request';
  json(input+'.json',{...target,tool:'eyedropper',sample,...(channel && {channel})});
  const receipt = run(input,scene,[],id);
  assert(receipt.sampled,JSON.stringify(receipt));
  return receipt.sample;
}
function edit(name, scene, operation) {
  const input = name+'-request', receipt = name+'-review';
  json(input+'.json',{...target,...operation});
  const preview = run(input,scene,['--preview',name],receipt);
  assert(preview.canCommit,JSON.stringify(preview));
  assert.equal(preview.changedTexels,1);
  const commit = run(input,scene,['--expect',receipt+'.json','--out',name+'-painted.json'],name+'-commit');
  assert.deepEqual(commit.samples,preview.samples);
  return preview;
}
const original = eyedrop('color','station','color');
const finish = eyedrop('roughness','station','source','roughness');
const pencil = edit('pencil','station',{tool:'pencil',color:'#ffa658',alpha:176});
const opacity = eyedrop('alpha','pencil-painted','alpha');
const erase = edit('eraser','pencil-painted',{tool:'eraser',sharing:'make-local-variant',variant:'east-cutout'});
assert.deepEqual(pencil.source.at,original.at);
assert.equal(finish.value,.37);
assert.equal(opacity.value,176);
assert(erase.uses.every(row=>row.object==='east.panel' && row.changedPixels>0));
assert.deepEqual(read('eraser-painted.json').tilesets.enamel,read('pencil-painted.json').tilesets.enamel);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Bound tile tools

Run \`sh COMMANDS.sh\` with Ink Studio on your PATH. The sample receipts
show stored color, opacity, and the enamel finish roughness. The pencil
writes color and alpha to the placed sign texel. The eraser clears
coverage on the east sign through an instance-local tileset.
`);

const W=720,H=322, starts=[18,252,486], top=108, crop={left:123,top:34,w:42,h:34}, zoom=5;
const text = (text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const board = drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#1a3039'),text('INK STUDIO / BOUND TILE TOOLS',18,16,2,'#a4d1c0'),
  text('Paint and sample a placed tile',18,42,3),
  text('EYEDROPPER',starts[0],86,2),text('PENCIL',starts[1],86,2),text('ERASER',starts[2],86,2),
  rect(starts[0],294,14,13,original.value),text(original.value,starts[0]+20,297,1),
  text('SOURCE ROUGHNESS '+finish.value,starts[0]+80,297,1,'#a4d1c0'),
  rect(starts[1],294,14,13,'#ffa658'),text('#FFA658  ALPHA '+opacity.value,starts[1]+20,297,1),
  text('ALPHA 0  EAST INSTANCE',starts[2],297,1,'#a4d1c0')
]});
for (const [i,name] of ['pencil/before.png','pencil/after.png','eraser/after.png'].entries()) {
  const frame = PNG.raster(file(name));
  for (let y=0;y<crop.h*zoom;y++) for (let x=0;x<crop.w*zoom;x++) {
    const ix = crop.left+Math.floor(x/zoom), iy = crop.top+Math.floor(y/zoom);
    const offset = (iy*frame.w+ix)*4;
    board.data.set(frame.data.subarray(offset,offset+4),((y+top)*W+x+starts[i])*4);
  }
}
const x = starts[0]+(target.at[0]-crop.left)*zoom+2, y = top+(target.at[1]-crop.top)*zoom+2;
for (let d=4;d<=8;d++) for (const [px,py] of [[x-d,y],[x+d,y],[x,y-d],[x,y+d]])
  board.data.set([164,209,192,255],(py*W+px)*4);
write('Bound-tile-tools.png',PNG.encode(W,H,board.data,4));
