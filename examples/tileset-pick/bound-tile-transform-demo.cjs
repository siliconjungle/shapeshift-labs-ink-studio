'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const {scene,library,view} = fixture(), atlas = scene.tilesets.enamel;
const {drawing2d} = ink.load().KIT.procedural;
delete scene.topologyMeshes.pillar;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const colors = {'.':'#253d47','o':'#152931','l':'#ffca80','s':'#e7a759'};
const arrow = ['....o....','....olo..','ooo.olso.','ollllsso.','ossssso..','oooooso..','....oo...'];
const pigment = drawing2d.render({width:18,height:14,edges:'hard',commands:[
  rect(0,0,18,14,colors['.']),
  ...arrow.flatMap((row,y)=>[...row].map((swatch,x)=>rect(x+1,y+2,1,1,colors[swatch])))
]});
const texels = Buffer.from(atlas.data,'base64');
for (let y=0;y<pigment.height;y++) {
  const at = ((y+5)*atlas.width+3)*4, stride = pigment.width*4;
  texels.set(pigment.data.subarray(y*stride,(y+1)*stride),at);
}
atlas.data = texels.toString('base64');

const directory = path.resolve(process.argv[2] ?? 'bound-tile-transform-demo');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(directory,{recursive:true});
json('station.json',scene);
json('library.json',library);
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
function run(args, receipt) {
  commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  const output = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  write(receipt,output);
  return JSON.parse(output);
}
function edit(name, operation) {
  const request = name+'-request.json', receipt = name+'-review.json';
  json(request,{tool:'transform',at:[125,48],object:'east.panel',face:'sign',view,...operation});
  const args = ['tileset','paint','face',request,'--scene','station.json'];
  const preview = run([...args,'--preview',name],receipt);
  assert(preview.canCommit,JSON.stringify(preview));
  assert(preview.changedTexels>0);
  const commit = run([...args,'--expect',receipt,'--out',name+'-painted.json'],name+'-commit.json');
  assert.deepEqual(commit.transform,preview.transform);
  return preview;
}
const move = edit('move',{selection:{type:'rectangle',rect:[4,7,9,7]},transform:{offset:[3,3]}});
assert.deepEqual(move.transform.bounds,[7,10,9,7]);
assert.deepEqual(move.uses.map(row=>row.object).sort(),['east.panel','west.panel']);
const copy = edit('copy',{selection:{type:'lasso',points:[[4,9],[8,9],[8,7],[12,10],[8,13],[8,12],[4,12]]},
  mode:'copy',transform:{at:[11,9],size:[11,9],flipX:true},sharing:'make-local-variant',variant:'east-two-way'});
assert.deepEqual(copy.transform.bounds,[11,9,11,9]);
assert.deepEqual(copy.uses.map(row=>row.object),['east.panel']);
const edited = JSON.parse(fs.readFileSync(file('copy-painted.json'),'utf8'));
assert.deepEqual(edited.tilesets.enamel,atlas);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md','# Bound atlas transforms\n\nRun `sh COMMANDS.sh` with Ink Studio on your PATH.\n\n'+
  'Move a marquee three texels right and down on the shared sign.\n'+
  'Then start from the original scene and copy a lasso in a local variant,\n'+
  'resizing and flipping it to make a two-way sign. The native views\n'+
  'and atlas edit maps are exported beside the receipts.\n');

const W=690,H=336, starts=[20,244,468], panels=['ORIGINAL','MOVE MARQUEE','RESIZE AND FLIP'];
const text = (text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const board = drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#1a3039'),text('INK STUDIO / BOUND ATLAS',20,17,2,'#a4d1c0'),
  text('Whole-pixel edits on a mesh',20,42,3),
  ...panels.map((label,i)=>text(label,starts[i],80,2)),
  text('1X FACE',20,264,1,'#a4d1c0'),
  text('ATLAS FOOTPRINT',334,257,1,'#a4d1c0'),
  text('ATLAS FOOTPRINT',558,257,1,'#a4d1c0'),
  text('SHARED TILE',334,271,1),
  text('LOCAL VARIANT',558,271,1)
]});
function blit(frame, left, top, [x0,y0,w,h], zoom) {
  for (let y=0;y<h*zoom;y++) for (let x=0;x<w*zoom;x++) {
    const p = ((y0+Math.floor(y/zoom))*frame.w+x0+Math.floor(x/zoom))*4;
    board.data.set(frame.data.subarray(p,p+4),((y+top)*W+x+left)*4);
  }
}
const crop = [121,35,49,34], names = ['move/before.png','move/after.png','copy/after.png'];
for (let i=0;i<names.length;i++) blit(PNG.raster(file(names[i])),starts[i],100,crop,4);
blit(PNG.raster(file(names[0])),20,280,crop,1);
for (const [i,name] of [[1,'move'],[2,'copy']]) {
  const patch = PNG.raster(file(name+'/texels.png'));
  blit(patch,starts[i],248,[0,0,patch.w,patch.h],3);
}
write('Bound-tile-transform.png',PNG.encode(W,H,board.data,4));
