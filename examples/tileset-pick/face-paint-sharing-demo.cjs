'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');
const {scene,library,view,image} = fixture();
const {drawing2d} = ink.load().KIT.procedural;
const directory = path.resolve(process.argv[2] ?? 'face-paint-sharing-demo');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(directory,{recursive:true});
json('station.json',scene);
json('library.json',library);
write('enamel.png',image);

const stroke = {at:[149,52],object:'east.panel',face:'sign',rgba:[255,166,88,255],view};
json('shared-stroke.json',{...stroke,sharing:'edit-every-instance'});
json('local-stroke.json',{...stroke,sharing:'make-local-variant',variant:'east-enamel'});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
function run(args, receipt) {
  commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  const output = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  write(receipt,output);
  return JSON.parse(output);
}
const [shared,local] = ['shared','local'].map(mode=>{
  const args = ['tileset','paint','face',mode+'-stroke.json','--scene','station.json'];
  const receipt = mode+'-review.json';
  const preview = run([...args,'--preview',mode],receipt);
  assert(preview.canCommit,JSON.stringify(preview));
  assert.equal(preview.changedTexels,1);
  const commit = run([...args,'--expect',receipt,'--out',mode+'-painted.json'],mode+'-commit.json');
  assert.deepEqual(commit.samples,preview.samples);
  return preview;
});
assert.deepEqual(shared.uses.map(row=>row.object).sort(),['east.panel','west.panel']);
assert(shared.uses.every(row=>row.changedPixels>0));
assert.deepEqual(local.uses.map(row=>row.object),['east.panel']);
assert.deepEqual(local.sharedPaintUses.map(row=>[row.object,row.changedPixels]),[['west.panel',0]]);
assert.equal(local.variantEdit.prefab.instance,'east');
assert.deepEqual(read('local-painted.json').tilesets.enamel,scene.tilesets.enamel);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Shared or local paint on a prefab face

Run \`sh COMMANDS.sh\` with Ink Studio on your PATH. Both branches start
from the same station scene and library.

The stroke selects art pixel ${stroke.at.join(', ')} on the east sign.
Shared paint updates source texel ${shared.source.at.join(', ')} on both
signs. Local paint stores the same edit in the east enamel copy and
binds the east instance to that copy. Both previews include before,
after, and diff PNGs alongside the JSON receipts.
`);

const W=924,H=308, x=[16,318,620], top=108;
const crop = {left:32,top:28,w:144,h:49,zoom:2};
const text = (text,x,y,scale,color='#eee3cb')=>({type:'text',text,at:[x,y],scale,color});
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const board = drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#1a3039'),text('INK STUDIO / FACE PAINT SHARING',16,16,2,'#a4d1c0'),
  text('One stroke, two scopes',16,42,4),
  text('ORIGINAL',x[0],86,2),text('SHARED PAINT',x[1],86,2),text('LOCAL VARIANT',x[2],86,2),
  text('PICK THE EAST SIGN',x[0],219,1),text('BOTH SIGNS SAMPLE THE EDIT',x[1],219,1),
  text('EAST INSTANCE USES A COPY',x[2],219,1),
  text('SOURCE ENAMEL',x[0],244,1,'#a4d1c0'),text('SHARED ENAMEL',x[1],244,1,'#a4d1c0'),
  text('EAST ENAMEL',x[2],244,1,'#a4d1c0')
]});
function blit({w,h,data},left,upper,scale) {
  for (let y=0;y<h*scale;y++) for (let x=0;x<w*scale;x++) {
    const at=(Math.floor(y/scale)*w+Math.floor(x/scale))*4;
    board.data.set(data.subarray(at,at+4),((y+upper)*W+left+x)*4);
  }
}
for (const [i,name] of ['shared/before.png','shared/after.png','local/after.png'].entries()) {
  const raster = PNG.raster(file(name)), {left,top:upper,w,h,zoom} = crop;
  const data = new Uint8Array(w*h*4);
  for (let y=0;y<h;y++) {
    const at = ((y+upper)*raster.w+left)*4;
    data.set(raster.data.subarray(at,at+w*4),y*w*4);
  }
  blit({w,h,data},x[i],top,zoom);
}
function mark(x,y,color) {
  board.data.set(color,(y*W+x)*4);
}
function cursor(x,y,color) {
  for (let d=3;d<=6;d++) {
    mark(x-d,y,color);
    mark(x+d,y,color);
    mark(x,y-d,color);
    mark(x,y+d,color);
  }
}
cursor(x[0]+(stroke.at[0]-crop.left)*crop.zoom,top+(stroke.at[1]-crop.top)*crop.zoom,[164,209,192,255]);
blit(PNG.raster(file('enamel.png')),x[0],257,2);
for (const [i,mode,id] of [[1,'shared','enamel'],[2,'local','east-enamel']]) {
  const asset = read(mode+'-painted.json').tilesets[id];
  blit({w:asset.width,h:asset.height,data:Buffer.from(asset.data,'base64')},x[i],257,2);
  const [u,v] = shared.source.at;
  cursor(x[i]+u*2,257+v*2,stroke.rgba);
  const diff = PNG.raster(file(mode+'/diff.png'));
  for (let col=0;col<crop.w;col++) {
    if (Array.from({length:crop.h},(_,r)=>diff.data[((r+crop.top)*view.w+col+crop.left)*4]).some(Boolean))
      for (let dy=210;dy<215;dy++) for (let dx=0;dx<crop.zoom;dx++)
        mark(x[i]+col*crop.zoom+dx,dy,stroke.rgba);
  }
}
write('Shared-or-local.png',PNG.encode(W,H,board.data,4));
