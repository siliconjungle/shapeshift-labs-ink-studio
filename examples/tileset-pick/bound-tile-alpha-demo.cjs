'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');
const {scene,library,view} = fixture();
delete scene.topologyMeshes.pillar;
const atlas = scene.tilesets.enamel, rgba = Buffer.from(atlas.data,'base64');
for (let y=8;y<15;y++) for (let x=3;x<21;x++) {
  const p = (y*atlas.width+x)*4;
  if (rgba.readUInt32BE(p)===0xbde2b4ff) rgba[p+3] = 160;
}
atlas.data = rgba.toString('base64');

const {drawing2d} = ink.load().KIT.procedural;
const directory = path.resolve(process.argv[2] ?? 'bound-tile-alpha-demo');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(directory,{recursive:true});
json('station.json',scene);
json('library.json',library);

const target = {at:[125,48],object:'east.panel',face:'sign',view};
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
function run(args, receipt) {
  commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  const output = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  write(receipt,output);
  return JSON.parse(output);
}
function edit(name, operation) {
  json(name+'-request.json',{...target,...operation});
  const args = ['tileset','paint','face',name+'-request.json','--scene','station.json'];
  const receipt = name+'-review.json';
  const preview = run([...args,'--preview',name],receipt);
  assert(preview.canCommit,JSON.stringify(preview));
  assert(preview.coverage.changedTexels>0);
  const commit = run([...args,'--expect',receipt,'--out',name+'-painted.json'],name+'-commit.json');
  assert.deepEqual(commit.coverage,preview.coverage);
  return preview;
}
const paint = {tool:'fill',fill:{area:'matching-color',colors:[{alpha:120}]}};
const replaced = edit('replace',{...paint,alphaMode:'replace'});
const accumulated = edit('accumulate',{...paint,alphaMode:'accumulate'});
const erased = edit('erase',{tool:'eraser',strength:.25,drawing:{mirrorY:11.5},
  sharing:'make-local-variant',variant:'east-soft-erase'});
assert.equal(replaced.coverage.samples[0].after,120);
assert.equal(accumulated.coverage.samples[0].after,205);
assert(replaced.coverage.native.lostPixels>0);
assert.equal(accumulated.coverage.native.lostPixels,0);
assert.deepEqual(erased.coverage.samples.map(row=>row.after),[120,120]);
assert.deepEqual(read('erase-painted.json').tilesets.enamel,scene.tilesets.enamel);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Bound tile coverage

Run \`sh COMMANDS.sh\` with Ink Studio on your PATH.

Replacement and accumulation use the same alpha input of 120 on the
same source selection at alpha 160. Replacement stores 120 and the
letters drop below the native cutout. Accumulation stores 205 and the
letters keep their silhouette. A local eraser uses strength 0.25 on
two texels. The PNGs and receipts show the source and native coverage.
`);

const W=790,H=334, starts=[18,213,408,603], top=100, crop={left:121,top:35,w:42,h:32}, zoom=4;
const text = (text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const board = drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#1a3039'),text('INK STUDIO / BOUND TILE COVERAGE',18,16,2,'#a4d1c0'),
  text('Replace, build up, or erase alpha',18,42,3),
  ...['ORIGINAL','REPLACE','ACCUMULATE','ERASE 25%'].map((label,i)=>text(label,starts[i],80,2)),
  ...['ALPHA 160','ALPHA 120','ALPHA 205','160 TO 120'].map((label,i)=>text(label,starts[i]+80,256,1,'#a4d1c0'))
]});
function blit(frame, left, upper, region, scale) {
  for (let y=0;y<region.h*scale;y++) for (let x=0;x<region.w*scale;x++) {
    const ix = region.left+Math.floor(x/scale), iy = region.top+Math.floor(y/scale);
    const offset = (iy*frame.w+ix)*4;
    board.data.set(frame.data.subarray(offset,offset+4),((y+upper)*W+x+left)*4);
  }
}
const names = ['replace/before.png','replace/after.png','accumulate/after.png','erase/after.png'];
const masks = ['replace/coverage-before.png','replace/coverage-after.png','accumulate/coverage-after.png','erase/coverage-after.png'];
for (let i=0;i<names.length;i++) {
  blit(PNG.raster(file(names[i])),starts[i],top,crop,zoom);
  const mask = PNG.raster(file(masks[i]));
  blit(mask,starts[i],248,{left:0,top:0,w:mask.w,h:mask.h},3);
}
write('Bound-tile-alpha.png',PNG.encode(W,H,board.data,4));
