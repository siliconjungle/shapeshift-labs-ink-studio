'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const paddedSign = require('./padded-sign.cjs');

const directory = path.resolve(process.argv[2] ?? 'tile-padding-demo');
fs.mkdirSync(directory,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const commands = [];
function studio(...args) {
  commands.push('ink-studio '+args.join(' '));
  return execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
}

const {width,height,atlas,expected} = paddedSign();
write('painted-sheet.png',PNG.encode(width,height,atlas,4));
json('draft.json',{id:'padded-tide-sign',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16}});
studio('tileset','import','painted-sheet.png','--scene','draft.json','--id','masonry','--out','painted.json');
studio('tileset','grid','--scene','painted.json','--id','masonry','--tile-width','16','--tile-height','8',
  '--padding-x','3','--padding-y','2','--offset-x','2','--offset-y','3','--out','padded.json');
const pick = (name,x,y,w,h)=>studio('tileset','pick','--scene','padded.json','--id','masonry','--brush',
  '--x',x,'--y',y,'--width',w,'--height',h,'--out',name+'-brush.json');
pick('sign','2','3','54','18');
pick('corner','40','13','16','8');
for (const id of ['sign','corner'])
  studio('tileset','brush-preview',id+'-brush.json','--scene','padded.json','--out',id+'-1x.png');
const sign = PNG.raster(file('sign-1x.png')), corner = PNG.raster(file('corner-1x.png'));
assert.deepEqual([sign.w,sign.h,corner.w,corner.h],[48,16,16,8]);
assert.deepEqual(new Uint8Array(sign.data),expected);
for (let row=0;row<8;row++) {
  const start = ((row+8)*48+32)*4;
  assert.deepEqual(corner.data.subarray(row*64,(row+1)*64),sign.data.subarray(start,start+64));
}
const uv = JSON.parse(studio('tileset','brush-uv','sign-brush.json','--scene','padded.json','--column','2','--row','1'));
const singleUV = JSON.parse(studio('tileset','brush-uv','corner-brush.json','--scene','padded.json'));
assert.deepEqual(uv.uvBounds,singleUV.uvBounds);
assert.deepEqual(uv.cell.offset,[32,8]);
const size = JSON.parse(studio('tileset','brush-size','sign-brush.json','--scene','padded.json'));
assert.deepEqual(size.worldSize,{width:3,height:1});
json('cell-uv.json',uv);
json('brush-size.json',size);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');

const W=743,H=348,top=123;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f7e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#101b24'),
  text('INK STUDIO / TILESETS',24,20,2,'#9be1c4'),
  text('The padding stays on the sheet.',24,45,3),
  text('PADDED ATLAS',24,101,2),
  text('3 X 2 BRUSH',430,101,2,'#9be1c4'),
  text('GAPS  3 X 2 TEXELS',24,279,2,'#e4a4d1'),
  text('ORIGIN  2, 3',24,306,1),
  text('54 X 18 TEXEL SOURCE SPAN',24,325,1),
  text('48 X 16 TEXELS  /  3 X 1 WORLD UNITS',430,229,1),
  text('ONE CELL PICKED ON ITS OWN',430,259,1,'#9be1c4'),
  text('16 X 8 TEXELS',548,288,1)
]});
function blit(pixels,w,h,x,y,zoom) {
  for (let j=0;j<h*zoom;j++) for (let i=0;i<w*zoom;i++) {
    const at = (Math.floor(j/zoom)*w+Math.floor(i/zoom))*4;
    board.data.set(pixels.subarray(at,at+4),((y+j)*W+x+i)*4);
  }
}
blit(atlas,width,height,24,top,6);
blit(sign.data,sign.w,sign.h,430,top,6);
blit(corner.data,corner.w,corner.h,430,279,6);
write('Tide-sign-padded-atlas.png',PNG.encode(W,H,board.data,4));
