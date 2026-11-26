'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');
const {scene,library,view} = fixture();
delete scene.topologyMeshes.pillar;
const {drawing2d} = ink.load().KIT.procedural;
const directory = path.resolve(process.argv[2] ?? 'bound-tile-fill-demo');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(directory,{recursive:true});
json('station.json',scene);
json('library.json',library);

const target = {at:[130,49],object:'east.panel',face:'sign',view,tool:'fill'};
const amber = {color:'#f2bd7c'}, coral = {color:'#ef785f'};
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
function run(args, receipt) {
  commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  const output = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  write(receipt,output);
  return JSON.parse(output);
}
function fill(name, request) {
  json(name+'-request.json',{...target,...request});
  const args = ['tileset','paint','face',name+'-request.json','--scene','station.json'];
  const receipt = name+'-review.json';
  const preview = run([...args,'--preview',name],receipt);
  assert(preview.canCommit,JSON.stringify(preview));
  const commit = run([...args,'--expect',receipt,'--out',name+'-painted.json'],name+'-commit.json');
  assert.deepEqual(commit.samples,preview.samples);
  return preview;
}
const connected = fill('connected',{fill:{area:'connected',colors:[amber]}});
const matched = fill('matching',{sharing:'make-local-variant',variant:'east-sign-checker',
  fill:{area:'matching-color',pattern:'checker',size:1,colors:[amber,coral]}});
assert(connected.fill.selectedTexels>1 && matched.fill.selectedTexels>connected.fill.selectedTexels);
assert.deepEqual(connected.source.at,matched.source.at);
assert.deepEqual(connected.uses.map(row=>row.object).sort(),['east.panel','west.panel']);
assert.deepEqual(matched.uses.map(row=>row.object),['east.panel']);
assert.deepEqual(read('matching-painted.json').tilesets.enamel,scene.tilesets.enamel);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Bound tile fills

Run \`sh COMMANDS.sh\` with Ink Studio on your PATH.

Both edits start at atlas texel ${connected.source.at.join(', ')} on the
east sign. The connected solid fill recolors ${connected.changedTexels}
texels. Its shared paint appears on both signs. The matching-color
checker recolors ${matched.changedTexels} texels across the disconnected
letter shapes on the east instance. The source masks and JSON receipts
show what each operation selected and changed.
`);

const W=743,H=378, starts=[18,266,514], top=104, crop={left:121,top:34,w:42,h:34}, zoom=5;
const text = (text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const board = drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#1a3039'),text('INK STUDIO / BOUND TILE FILL',18,16,2,'#a4d1c0'),
  text('Fill a tile through its placed face',18,42,3),
  text('ORIGINAL',starts[0],82,2),text('CONNECTED SOLID',starts[1],82,2),text('MATCHING CHECKER',starts[2],82,2),
  text('ATLAS MASK',starts[1]+84,296,1,'#a4d1c0'),text(connected.changedTexels+' TEXELS',starts[1]+84,317,1),
  text('ATLAS MASK',starts[2]+84,296,1,'#a4d1c0'),text(matched.changedTexels+' TEXELS',starts[2]+84,317,1)
]});
function blit(frame, left, upper, region, scale) {
  for (let y=0;y<region.h*scale;y++) for (let x=0;x<region.w*scale;x++) {
    const ix = region.left+Math.floor(x/scale), iy = region.top+Math.floor(y/scale);
    const offset = (iy*frame.w+ix)*4;
    board.data.set(frame.data.subarray(offset,offset+4),((y+upper)*W+x+left)*4);
  }
}
for (const [i,name] of ['connected/before.png','connected/after.png','matching/after.png'].entries())
  blit(PNG.raster(file(name)),starts[i],top,crop,zoom);
for (const [i,name] of ['connected','matching'].entries()) {
  const mask = PNG.raster(file(name+'/texels.png'));
  blit(mask,starts[i+1],292,{left:0,top:0,w:mask.w,h:mask.h},3);
}
const x = starts[0]+(target.at[0]-crop.left)*zoom+2, y = top+(target.at[1]-crop.top)*zoom+2;
for (let d=4;d<=8;d++) for (const [px,py] of [[x-d,y],[x+d,y],[x,y-d],[x,y+d]])
  board.data.set([164,209,192,255],(py*W+px)*4);
write('Bound-tile-fill.png',PNG.encode(W,H,board.data,4));
