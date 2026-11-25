'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const paddedSign = require('./padded-sign.cjs');

const directory = path.resolve(process.argv[2] ?? 'tile-repack-demo');
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

const {width,height,atlas,expected} = paddedSign();
write('painted-sheet.png',PNG.encode(width,height,atlas,4));
json('draft.json',{id:'compact-tide-sign',style:'slate',solids:[]});
const tile = ['--tile-width','16','--tile-height','8'];
const report = JSON.parse(studio('tileset','repack','painted-sheet.png',...tile,
  '--margin-left','2','--margin-top','3','--margin-right','2','--margin-bottom','2',
  '--gutter-x','3','--gutter-y','2','--out','compact.png','--report','rectangles.json'));
assert.deepEqual(read('rectangles.json'),report);
assert.deepEqual([report.columns,report.rows],[3,2]);
assert.deepEqual(report.rectangleMap,{x:[{source:2,destination:0},{source:21,destination:16},{source:40,destination:32}],
  y:[{source:3,destination:0},{source:13,destination:8}]});
studio('tileset','import','compact.png',...tile,'--scene','draft.json','--id','sign','--out','compact-scene.json');
studio('tileset','pick','--scene','compact-scene.json','--id','sign','--brush',
  '--x','0','--y','0','--width','48','--height','16','--out','sign-brush.json');
studio('tileset','brush-preview','sign-brush.json','--scene','compact-scene.json','--out','sign-1x.png');
const compact = PNG.raster(file('compact.png'));
assert.deepEqual(new Uint8Array(compact.data),expected);
assert.deepEqual(PNG.raster(file('sign-1x.png')).data,compact.data);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');

const W=716,H=336,top=128,zoom=5;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f7e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#101b24'),
  text('INK STUDIO / TILESET REPACK',24,20,2,'#9be1c4'),
  text('A compact atlas with a rectangle map.',24,48,3),
  text('ORIGINAL  58 X 23',24,104,2),
  text('COMPACT  48 X 16',416,104,2,'#9be1c4'),
  text('SOURCE ORIGIN  40, 13',24,275,2,'#e8c07f'),
  text('NEW ORIGIN  32, 8',416,248,2,'#e8c07f'),
  text('6 CELLS / 768 ORIGINAL TEXELS VERIFIED',416,275,1,'#9be1c4'),
  text('MAP RECORDS EVERY CELL IN ROW AND COLUMN ORDER',24,314,1,'#b3c3c8')
]});
function blit(pixels,w,h,x,y) {
  for (let j=0;j<h*zoom;j++) for (let i=0;i<w*zoom;i++) {
    const at = (Math.floor(j/zoom)*w+Math.floor(i/zoom))*4;
    board.data.set(pixels.subarray(at,at+4),((y+j)*W+x+i)*4);
  }
}
function outline(x,y,width,height) {
  const color = [232,192,127,255];
  for (let i=0;i<width;i++) for (const edge of [y,y+height-1])
    board.data.set(color,(edge*W+x+i)*4);
  for (let j=0;j<height;j++) for (const edge of [x,x+width-1])
    board.data.set(color,((y+j)*W+edge)*4);
}
blit(atlas,width,height,24,top);
blit(compact.data,compact.w,compact.h,416,top);
const lastX = report.rectangleMap.x.at(-1), lastY = report.rectangleMap.y.at(-1);
outline(24+lastX.source*zoom-1,top+lastY.source*zoom-1,16*zoom+2,8*zoom+2);
outline(416+lastX.destination*zoom-1,top+lastY.destination*zoom-1,16*zoom+2,8*zoom+2);
write('Tide-sign-atlas-repack.png',PNG.encode(W,H,board.data,4));
