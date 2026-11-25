'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const directory = path.resolve(process.argv[2] ?? 'tileset-uv-inset-demo');
fs.mkdirSync(directory,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const commands = [];
function studio(...args) {
  commands.push('ink-studio '+args.join(' '));
  return execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
}

const drawing = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f7e8d1')=>({type:'text',text,at:[x,y],scale,color});
const atlas = drawing.render({width:32,height:16,edges:'hard',commands:[
  rect(0,0,32,16,'#101b24'),
  rect(16,0,16,16,'#cf77c5'),
  rect(16,2,16,10,'#e5ae66'),
  rect(31,2,1,10,'#73cadd'),
  rect(16,12,16,4,'#9c9af6'),
  rect(19,2,12,10,'#254753'),
  rect(20,3,10,8,'#558388'),
  rect(21,4,8,6,'#1b3039'),
  rect(24,5,2,4,'#a1f0bc'),
  rect(23,6,4,2,'#a1f0bc')
]});
write('relay-sheet.png',PNG.encode(32,16,atlas.data,4));

const vertices = [[0,0,0],[2,0,0],[2,2,0],[0,2,0]].map((position,i)=>({id:'v'+i,position}));
const uvs = [[.5,1],[1,1],[1,0],[.5,0]];
const corners = vertices.map(({id:vertex},i)=>({id:'uv'+i,vertex,uv:uvs[i]}));
json('draft.json',{id:'relay-uv-inset',style:'slate',solids:[],
  tilesetDefaults:{texelsPerUnit:8,tileSize:{width:16,height:16}},
  topologyMeshes:{relay:{document:{id:'relay',vertices,faces:[{id:'plate',material:'paint',corners}]},
    materials:[{id:'paint',texture:{tileset:'sheet'}}]}}});
studio('tileset','import','relay-sheet.png','--scene','draft.json','--id','sheet','--out','original.json');
studio('tileset','pick','--scene','original.json','--id','sheet','--brush',
  '--x','16','--y','0','--width','16','--height','16','--out','original-brush.json');
studio('tileset','brush-uv','original-brush.json','--scene','original.json',
  '--inset-top','2.5','--inset-bottom','4.5','--inset-left','3.5','--inset-right','1.5','--out','inset-brush.json');
const receipt = JSON.parse(studio('tileset','brush-uv','inset-brush.json','--scene','original.json',
  '--object','relay','--face','plate','--out','inset.json'));
json('uv-receipt.json',receipt);
const before = read('original.json'), after = read('inset.json');
const mapping = ink.tilesetBrushUV(before,read('inset-brush.json'));
assert.deepEqual(mapping.texelBounds,[19.5,2.5,30.5,11.5]);
assert.deepEqual(after.topologyMeshes.relay.document.vertices,vertices);
assert.deepEqual(ink.sizeTilesetBrush(after,mapping.brush).worldSize,{width:2,height:2});

for (const id of ['original','inset']) {
  studio('tileset','brush-preview',id+'-brush.json','--scene',id+'.json','--out',id+'-source.png');
  studio('render',id+'.json','--w','112','--h','104','--px','1','--target','1,1,0','--zoom','3.4',
    '--yaw','0','--pitch','0','--ortho','--raw','--out',id+'-face.png');
}
assert.deepEqual(fs.readFileSync(file('original-source.png')),fs.readFileSync(file('inset-source.png')));
const faces = ['original-face.png','inset-face.png'].map(name=>PNG.raster(file(name)));
const coverage = ({w,h,data}) => Array.from({length:w*h},(_,i)=>
  data.subarray(i*4,i*4+4).some((value,channel)=>value !== data[channel]));
assert(coverage(faces[0]).some(Boolean));
assert.deepEqual(coverage(faces[0]),coverage(faces[1]));
assert.notDeepEqual(faces[0].data,faces[1].data);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');

const W=732,H=370;
const board = drawing.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#101b24'),
  text('INK STUDIO / TILE BRUSH UV',24,20,2,'#9be1c4'),
  text('Four insets. Same face.',24,45,4),
  text('16 X 16 SOURCE',24,104,2,'#9be1c4'),
  text('ORIGINAL UVS',220,104,2),
  text('INSET UVS',480,104,2,'#9be1c4'),
  text('TOP     2.5 TEXELS',24,260,1,'#cf77c5'),
  text('BOTTOM  4.5 TEXELS',24,279,1,'#aaa8fc'),
  text('LEFT    3.5 TEXELS',24,298,1,'#e5ae66'),
  text('RIGHT   1.5 TEXELS',24,317,1,'#73cadd'),
  rect(219,127,226,210,'#516d77'),rect(479,127,226,210,'#516d77'),
  text('2 X 2 WORLD UNITS',220,346,1),text('2 X 2 WORLD UNITS',480,346,1)
]});
function blit(name,x,y,zoom) {
  const {w,h,data} = PNG.raster(file(name));
  for (let j=0;j<h*zoom;j++) for (let i=0;i<w*zoom;i++) {
    const source = (Math.floor(j/zoom)*w+Math.floor(i/zoom))*4;
    board.data.set(data.subarray(source,source+4),((y+j)*W+x+i)*4);
  }
}
blit('original-source.png',24,128,7);
blit('original-face.png',220,128,2);
blit('inset-face.png',480,128,2);
write('Relay-UV-insets.png',PNG.encode(W,H,board.data,4));
