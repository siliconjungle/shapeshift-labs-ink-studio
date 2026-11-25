'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const portal = require('../gatehouse-revision/portal.cjs');

const directory = path.resolve(process.argv[2] ?? 'tileset-grid-demo');
fs.mkdirSync(directory,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(directory,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const commands = [];
function studio(...args) {
  commands.push('ink-studio tileset '+args.join(' '));
  return execFileSync(process.execPath,[cli,'tileset',...args],{cwd:directory,encoding:'utf8'});
}

const {width,height,pixels} = portal.atlas();
write('masonry.png',PNG.encode(width,height,pixels,4));
const sign = new Uint8Array(48*16*4);
for (let row=0;row<16;row++) {
  const start = (row*width+48)*4;
  sign.set(pixels.subarray(start,start+48*4),row*48*4);
}
write('sign-trim.png',PNG.encode(48,16,sign,4));
write('draft.json',JSON.stringify({id:'tide-gatehouse-grids',style:'slate',solids:[]},null,2)+'\n');

studio('grid','--scene','draft.json','--tile-width','16','--tile-height','8','--out','defaults.json');
studio('import','masonry.png','--scene','defaults.json','--id','masonry','--out','painted.json');
studio('import','sign-trim.png','--scene','painted.json','--id','sign-trim','--out','trim.json');
studio('grid','--scene','trim.json','--id','sign-trim','--tile-width','12','--tile-height','8','--out','gatehouse-grids.json');

const scene = 'gatehouse-grids.json';
const results = [['masonry','48',3,16,'SHARED DEFAULT'],['sign-trim','0',4,12,'SHEET OVERRIDE']].map(
  ([id,x,columns,tileWidth,caption],index) => {
    const settings = JSON.parse(studio('grid','--scene',scene,'--id',id));
    assert.equal(settings.source,index === 0 ? 'default' : 'override');
    assert.deepEqual(settings.tileSize,{width:tileWidth,height:8});
    studio('pick','--scene',scene,'--id',id,'--brush','--x',x,'--y','0','--width','48','--height','16','--out',id+'-brush.json');
    studio('brush-preview',id+'-brush.json','--scene',scene,'--out',id+'-1x.png');
    const brush = JSON.parse(fs.readFileSync(file(id+'-brush.json'),'utf8'));
    assert.deepEqual([brush.columns,brush.rows],[columns,2]);
    const image = PNG.raster(file(id+'-1x.png'));
    assert.deepEqual([image.w,image.h],[48,16]);
    assert.deepEqual(new Uint8Array(image.data),sign);
    return {x:26+index*354,caption,brush,image};
  }
);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');

const W=716,H=270,zoom=6,top=126,draw=[];
const rect = (x,y,w,h,fill) => draw.push({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color) => draw.push({type:'text',text,at:[x,y],scale,color});
rect(0,0,W,H,'#101b24');
text('INK STUDIO / TILESETS',26,22,2,'#9be1c4');
text('One scene. Two tile sizes.',26,47,4,'#f7e8d1');
for (const {x,caption,brush} of results) {
  text(caption,x,90,2,'#9be1c4');
  text('TILE '+brush.tileWidth+' X '+brush.tileHeight+' TEXELS',x,108,1,'#b3c3c8');
  rect(x-1,top-1,48*zoom+2,16*zoom+2,'#56747c');
  text(brush.columns+' COLUMNS X '+brush.rows+' ROWS',x,235,2,'#f7e8d1');
}
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,commands:draw,edges:'hard'});
for (const {x,brush,image} of results) {
  for (let row=0;row<image.h*zoom;row++) for (let col=0;col<image.w*zoom;col++) {
    const at = (Math.floor(row/zoom)*image.w+Math.floor(col/zoom))*4;
    const boundary = col > 0 && col % (brush.tileWidth*zoom) === 0 && row % 4 < 2 ||
      row > 0 && row % (brush.tileHeight*zoom) === 0 && col % 4 < 2;
    board.data.set(boundary ? [210,227,215,255] : image.data.subarray(at,at+4),((top+row)*W+x+col)*4);
  }
}
write('Tide-sign-grid-dimensions.png',PNG.encode(W,H,board.data,4));
