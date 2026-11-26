'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {drawing2d} = ink.load().KIT.procedural;
const directory = path.resolve(process.argv[2] ?? 'tileset-face-paint-demo');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(directory,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#ece1c7')=>({type:'text',text,at:[x,y],scale,color});
const plate = (x,y,light,dark)=>[
  rect(x,y,15,15,'#172932'),rect(x+1,y+1,13,13,'#536460'),
  rect(x+2,y+2,11,1,'#9ea590'),rect(x+2,y+12,11,1,'#2a3f45'),
  rect(x+3,y+4,9,7,dark),rect(x+4,y+5,7,5,'#233940'),
  rect(x+5,y+6,4,2,light),rect(x+5,y+8,6,1,light),
  rect(x+2,y+2,1,1,'#e0cc97'),rect(x+12,y+12,1,1,'#82908a')
];
const atlas = drawing2d.render({width:38,height:21,edges:'hard',commands:[
  rect(0,0,38,21,'#2b414a'),...plate(3,3,'#8ac3a9','#436766'),...plate(20,3,'#9c889b','#635970')
]});
const image = PNG.encode(atlas.width,atlas.height,atlas.data,4);
write('atlas.png',image);
const scene = {id:'relay-face-paint',style:'slate',solids:[],tilesets:{enamel:ink.readTilesetImage(image)},
  camera:{target:[0,.75,0],dist:8,yaw:0,pitch:0,projection:'orthographic'}};
const editor = ink.createSceneEditor(scene);
const pick = x=>ink.pickTilesetRectangle(scene,'enamel',{x,y:3,width:15,height:15});
editor.placeTilesetFace({object:'relay-west',face:'plate',selection:pick(3),origin:[-2.65,0,0],texelsPerUnit:10});
editor.placeTilesetFace({object:'relay-east',face:'plate',selection:pick(3),origin:[-.75,0,0],texelsPerUnit:10,
  paint:{rotation:90,flipX:true}});
editor.placeTilesetFace({object:'relay-spare',face:'plate',selection:pick(20),origin:[1.15,0,0],texelsPerUnit:10});
json('relay.json',editor.snapshot());
const request = {at:[62,46],object:'relay-west',face:'plate',rgba:[255,166,88,255],view:{w:180,h:96}};
json('stroke.json',request);

const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), commands = [];
function run(args, receipt) {
  commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  const output = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  write(receipt,output);
  return JSON.parse(output);
}
const args = ['tileset','paint','face','stroke.json','--scene','relay.json'];
const preview = run([...args,'--preview','preview'],'review.json');
assert(preview.canCommit,JSON.stringify(preview));
assert.equal(preview.changedTexels,1);
assert.deepEqual(preview.uses.map(row=>row.object).sort(),['relay-east','relay-west']);
assert(preview.uses.every(row=>row.changedPixels>0));
const saved = run([...args,'--expect','review.json','--out','relay-painted.json'],'commit.json');
assert.deepEqual(saved.samples,preview.samples);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Paint a placed relay face

Run \`sh COMMANDS.sh\` with Ink Studio on your PATH.

The stroke starts at art-grid coordinate ${request.at.join(', ')} on the west relay.
It replaces texel ${preview.source.at.join(', ')} in the shared enamel atlas.
The east relay uses the same crop with a different UV orientation.
The spare relay uses a separate portion of the sheet.

The review lists both affected faces, compares the native renders, and pins
the edit to the scene and request that were reviewed.
`);

const W=618,H=317;
const board = drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#1b3039'),text('INK STUDIO / TILESET FACE PAINT',18,16,2,'#9dcebd'),
  text('Paint through a placed face',18,43,3),
  text('BEFORE',18,92,2),text('AFTER',219,92,2),text('CHANGED PIXELS',420,92,2),
  text('ATLAS BEFORE',18,227,2),text('SOURCE TEXEL',185,227,2),
  text('WEST AND EAST SHARE THE EDIT',363,249,1,'#9dcebd'),
  text('SPARE USES A DIFFERENT CROP',363,269,1,'#a8b7b7')
]});
function blit(raster,left,top,scale) {
  for (let y=0;y<raster.h*scale;y++) for (let x=0;x<raster.w*scale;x++) {
    const at=(Math.floor(y/scale)*raster.w+Math.floor(x/scale))*4;
    board.data.set(raster.data.subarray(at,at+4),((y+top)*W+left+x)*4);
  }
}
const viewCrop = {x:41,y:26,w:97,h:44};
for (const [i,name] of ['before','after','diff'].entries()) {
  const original = PNG.raster(file('preview/'+name+'.png'));
  const {x,y,w,h} = viewCrop, data = new Uint8Array(w*h*4);
  for (let j=0;j<h;j++) {
    const start = ((y+j)*original.w+x)*4;
    data.set(original.data.subarray(start,start+w*4),j*w*4);
  }
  blit({w,h,data},18+201*i,117,2);
}
function mark(x,y,color) {
  board.data.set(color,(y*W+x)*4);
}
const mint = [153,237,194,255], amber=request.rgba;
function cursor(x,y,color) {
  for (let d=3;d<=6;d++) {
    mark(x-d,y,color);
    mark(x+d,y,color);
    mark(x,y-d,color);
    mark(x,y+d,color);
  }
}
cursor(18+2*(request.at[0]-viewCrop.x),117+2*(request.at[1]-viewCrop.y),mint);
blit({w:atlas.width,h:atlas.height,data:atlas.data},18,249,3);
const [u,v] = preview.source.at;
const revised = Buffer.from(JSON.parse(fs.readFileSync(file('relay-painted.json'),'utf8')).tilesets.enamel.data,'base64');
blit({w:atlas.width,h:atlas.height,data:revised},185,249,3);
cursor(186+u*3,250+v*3,amber);
write('Paint-through-face.png',PNG.encode(W,H,board.data,4));
