'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const paddedSign = require('./padded-sign.cjs');

const directory = path.resolve(process.argv[2] ?? 'tile-canvas-demo');
fs.mkdirSync(directory,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const commands = [];
function studio(...args) {
  commands.push('ink-studio '+args.join(' '));
  return execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
}

const {expected} = paddedSign();
write('sign.png',PNG.encode(48,16,expected,4));
const vertices = [[0,0,0],[3,0,0],[3,1,0],[0,1,0]].map((position,i)=>({id:'v'+i,position}));
const corners = [[0,1],[1,1],[1,0],[0,0]].map((uv,i)=>({id:'uv'+i,vertex:'v'+i,uv}));
json('draft.json',{id:'tide-canvas',style:'slate',solids:[],topologyMeshes:{gatehouse:{
  document:{id:'gatehouse',vertices,faces:[{id:'plate',material:'paint',corners}]},
  materials:[{id:'paint',texture:{tileset:'sign'}}]
}}});
studio('tileset','import','sign.png','--scene','draft.json','--id','sign','--tile-width','16','--tile-height','8','--out','original.json');
const settings = ['--scene','original.json','--id','sign','--width','96','--height','32'];
const results = [
  ['resize','resized','--anchor','bottom-right'],
  ['resample','resampled']
];
for (const [type,id,...options] of results) {
  const preview = JSON.parse(studio('tileset',type,...settings,...options));
  const applied = JSON.parse(studio('tileset',type,...settings,...options,'--out',id+'.json'));
  assert.deepEqual(applied,preview);
  json(id+'-receipt.json',preview);
}
const resized = read('resized-receipt.json'), resampled = read('resampled-receipt.json');
assert.equal(resized.references[0].status,'remapped');
assert.deepEqual(resized.sourceOffset,[-48,-16]);
assert.deepEqual(resized.references[0].corners[3].after,[48/95,16/31]);
assert.equal(resampled.references[0].status,'resampled');
assert.deepEqual(resampled.references[0].corners[3].after,[0,0]);
const clipped = JSON.parse(studio('tileset','resize','--scene','original.json','--id','sign','--width','24','--height','16'));
assert.equal(clipped.references[0].status,'blocked');
json('clipped-preview.json',clipped);

const captures = ['original','resized','resampled'].map(id=>{
  const scene = read(id+'.json');
  assert.deepEqual(scene.topologyMeshes.gatehouse.document.vertices,vertices);
  const {width,height,data} = scene.tilesets.sign, rgba=Buffer.from(data,'base64');
  write(id+'-atlas.png',PNG.encode(width,height,rgba,4));
  studio('render',id+'.json','--w','192','--h','104','--px','1','--target','1.5,.5,0','--zoom','3',
    '--yaw','0','--pitch','0','--ortho','--raw','--out',id+'-face.png');
  return {width,height,rgba};
});
for (let y=0;y<32;y++) for (let x=0;x<96;x++) {
  const start = (y*96+x)*4;
  const old = ((y-16)*48+x-48)*4, sample = (Math.floor(y/2)*48+Math.floor(x/2))*4;
  assert.deepEqual([...captures[1].rgba.subarray(start,start+4)],
    x>=48 && y>=16 ? [...expected.subarray(old,old+4)] : [0,0,0,0]);
  assert.deepEqual([...captures[2].rgba.subarray(start,start+4)],[...expected.subarray(sample,sample+4)]);
}
const originalFace = PNG.raster(file('original-face.png'));
assert.deepEqual(PNG.raster(file('resized-face.png')).data,originalFace.data);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');

const W=806,H=336;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f7e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#101b24'),
  text('INK STUDIO / TILESET CANVAS',24,20,2,'#9be1c4'),
  text('Same target size. Two different edits.',24,47,3),
  text('ORIGINAL',24,102,2),
  text('RESIZE CANVAS',218,102,2,'#9be1c4'),
  text('RESAMPLE IMAGE',513,102,2,'#9be1c4'),
  text('48 X 16',24,189,1),
  text('96 X 32 / BOTTOM-RIGHT ANCHOR',218,229,1),
  text('96 X 32 / NEAREST NEIGHBOR',513,229,1),
  text('ORIGINAL CORNER UV',24,261,1,'#adbfc4'),
  text('0, 0',24,279,2),
  text('CORNER UV MOVES WITH THE ART',218,261,1,'#adbfc4'),
  text('0.505, 0.516',218,279,2),
  text('CORNER UV STAYS IN PLACE',513,261,1,'#adbfc4'),
  text('0, 0',513,279,2),
  text('THE SIGN FACE IS 3 X 1 WORLD UNITS IN ALL THREE SCENES',24,314,1,'#9be1c4')
]});
function blit({width,height,rgba}, x, y, zoom) {
  for (let row=0;row<height*zoom;row++) for (let col=0;col<width*zoom;col++) {
    const at = (Math.floor(row/zoom)*width+Math.floor(col/zoom))*4;
    const pixel = rgba[at+3] ? rgba.subarray(at,at+4) :
      Math.floor(row/8)%2 === Math.floor(col/8)%2 ? [37,52,62,255] : [47,63,74,255];
    board.data.set(pixel,((y+row)*W+x+col)*4);
  }
}
blit(captures[0],24,128,3);
blit(captures[1],218,128,3);
blit(captures[2],513,128,3);
write('Tide-sign-resize-and-resample.png',PNG.encode(W,H,board.data,4));
