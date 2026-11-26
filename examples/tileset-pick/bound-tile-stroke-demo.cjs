'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');
const {scene,library,view} = fixture();
delete scene.topologyMeshes.pillar;
const {drawing2d} = ink.load().KIT.procedural;
const directory = path.resolve(process.argv[2] ?? 'bound-tile-stroke-demo');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(directory,{recursive:true});
json('station.json',scene);
json('library.json',library);
json('stencil.json',{type:'intersect',base:{type:'rectangle',rect:[4,7,16,11]},
  with:{type:'wand',at:[4,9],connected:false}});
json('mirror-mask.json',{grid:[24,24],origin:[0,0],pixels:[[5,10],[18,10],[5,13]]});

const target = {at:[128,49],object:'east.panel',face:'sign',view};
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
function run(args, receipt) {
  commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  const output = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  write(receipt,output);
  return JSON.parse(output);
}
function edit(name, operation, selection) {
  json(name+'-request.json',{...target,...operation});
  const args = ['tileset','paint','face',name+'-request.json','--scene','station.json','--selection',selection];
  const receipt = name+'-review.json';
  const preview = run([...args,'--preview',name],receipt);
  assert(preview.canCommit && preview.changedTexels>0,JSON.stringify(preview));
  const commit = run([...args,'--expect',receipt,'--out',name+'-painted.json'],name+'-commit.json');
  assert.deepEqual(commit.samples,preview.samples);
  return preview;
}
const amber = '#f2bd7c';
const spray = edit('spray',{tool:'spray',color:amber,spray:{radius:8,density:.9,seed:71}},'stencil.json');
const dither = edit('dither',{tool:'dither',sharing:'make-local-variant',variant:'east-dither',
  dither:{pattern:'blue-noise',mix:.5,seed:71,
    colors:[{color:'#263b47'},{color:'#507f78'}]}},'stencil.json');
const mirror = edit('mirror',{tool:'pencil',color:amber,drawing:{mirrorX:11.5,mirrorY:11.5}},'mirror-mask.json');
assert(spray.changedTexels<spray.stroke.selectedTexels);
assert.deepEqual(mirror.samples.map(row=>row.at),[[5,10],[18,10],[5,13]]);
assert.deepEqual(read('dither-painted.json').tilesets.enamel,scene.tilesets.enamel);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Bound tile stroke patterns

Run \`sh COMMANDS.sh\` with Ink Studio on your PATH.

The spray and dither use seed 71 with the same saved lettering stencil.
The blue-noise dither lives on the east sign's local variant. The mirror
uses two half-pixel axes and a three-cell crop selection, which clips out
the fourth reflection. The atlas masks show the selection and changes.
`);

const W=743,H=378, starts=[18,266,514], top=104, crop={left:121,top:34,w:42,h:34}, zoom=5;
const text = (text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const board = drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#1a3039'),text('INK STUDIO / BOUND TILE STROKES',18,16,2,'#a4d1c0'),
  text('Paint inside the selection',18,42,3),
  text('SEEDED SPRAY',starts[0],82,2),text('BLUE-NOISE DITHER',starts[1],82,2),text('MIRRORED PENCIL',starts[2],82,2),
  text('SEED '+spray.stroke.spray.seed,starts[0]+84,298,1,'#a4d1c0'),
  text('SEED '+dither.stroke.dither.seed,starts[1]+84,298,1,'#a4d1c0'),
  text('TWO MIRROR AXES',starts[2]+84,298,1,'#a4d1c0'),
  ...[spray,dither,mirror].map((row,i)=>text(row.changedTexels+' TEXELS CHANGED',starts[i]+84,319,1))
]});
function blit(frame, left, upper, region, scale) {
  for (let y=0;y<region.h*scale;y++) for (let x=0;x<region.w*scale;x++) {
    const ix = region.left+Math.floor(x/scale), iy = region.top+Math.floor(y/scale);
    const offset = (iy*frame.w+ix)*4;
    board.data.set(frame.data.subarray(offset,offset+4),((y+upper)*W+x+left)*4);
  }
}
for (const [i,name] of ['spray','dither','mirror'].entries()) {
  blit(PNG.raster(file(name+'/after.png')),starts[i],top,crop,zoom);
  const mask = PNG.raster(file(name+'/texels.png'));
  blit(mask,starts[i],292,{left:0,top:0,w:mask.w,h:mask.h},3);
}
write('Bound-tile-strokes.png',PNG.encode(W,H,board.data,4));
