'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const portal = require('../gatehouse-revision/portal.cjs');

const directory = path.resolve(process.argv[2] ?? 'tile-extract-demo');
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

const {width,height,pixels} = portal.atlas();
const crop = {x:24,y:24,width:16,height:8};
write('masonry.png',PNG.encode(width,height,pixels,4));

const vertices = [], faces = [], placements = [];
const uv = [[0,1],[1,1],[1,0],[0,0]];
for (let row=0;row<3;row++) for (let column=0;column<4;column++) {
  const x = column+(row%2)*.5, y = row*.5, id = 'brick-'+row+'-'+column;
  placements.push([x,y]);
  const positions = [[x,y,0],[x+1,y,0],[x+1,y+.5,0],[x,y+.5,0]];
  const corners = positions.map((position,i)=>{
    const vertex = id+'-v'+i;
    vertices.push({id:vertex,position});
    return {id:id+'-uv'+i,vertex,uv:uv[i]};
  });
  faces.push({id,material:'brick',corners});
}
json('draft.json',{id:'extracted-brick-wall',style:'slate',solids:[],topologyMeshes:{wall:{
  document:{id:'wall',vertices,faces},materials:[{id:'brick',texture:{tileset:'brick'}}]
}}});
studio('tileset','import','masonry.png','--scene','draft.json','--id','masonry','--out','atlas-scene.json');
studio('tileset','pick','--scene','atlas-scene.json','--id','masonry','--x','24','--y','24',
  '--width','16','--height','8','--out','brick-selection.json');
const receipt = JSON.parse(studio('tileset','extract','--scene','atlas-scene.json','--selection','brick-selection.json',
  '--new-id','brick','--out','brick-wall.json'));
assert.deepEqual(receipt.source,{tileset:'masonry',...crop});
const {scene:output,...record} = receipt;
json('extraction-receipt.json',{...record,scene:path.basename(output)});
studio('tileset','pick','--scene','brick-wall.json','--id','brick','--brush','--x','0','--y','0',
  '--width','16','--height','8','--out','brick-brush.json');
studio('tileset','brush-preview','brick-brush.json','--scene','brick-wall.json','--out','brick-1x.png');
const brick = PNG.raster(file('brick-1x.png'));
for (let y=0;y<crop.height;y++) {
  const at = ((crop.y+y)*width+crop.x)*4;
  assert.deepEqual(brick.data.subarray(y*64,(y+1)*64),pixels.subarray(at,at+64));
}
const scene = read('brick-wall.json'), K = ink.load().KIT;
assert.deepEqual(scene.tilesets.masonry,read('atlas-scene.json').tilesets.masonry);
const [mesh] = ink.createSceneEditor(scene).build().meshes;
const ray = K.sceneMeshes.rayQuery(mesh,K);
for (const [x,y] of placements) for (let row=0;row<8;row++) for (let col=0;col<16;col++) {
  const at = (row*16+col)*4, rgb = brick.data[at]*65536+brick.data[at+1]*256+brick.data[at+2];
  assert.equal(ray({origin:[x+(col+.5)/16,y+.5-(row+.5)/16,1],direction:[0,0,-1],maxDistance:2}).pigment,rgb);
}
studio('render','brick-wall.json','--w','208','--h','116','--px','1','--target','2.25,.75,0',
  '--zoom','3.5','--yaw','0','--pitch','0','--ortho','--raw','--out','brick-wall-1x.png');
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');

const W=826,H=404;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f7e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = K.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#101b24'),
  text('INK STUDIO / TILESET EXTRACTION',24,20,2,'#9be1c4'),
  text('One brick. Twelve faces.',24,47,4),
  text('ORIGINAL ATLAS',24,103,2),
  text('EXTRACTED TILE',234,103,2,'#9be1c4'),
  text('HEADLESS MESH RENDER',398,103,2),
  rect(397,127,418,234,'#58737d'),
  text('CROP AT 24, 24',24,278,1),
  text('16 X 8 TEXELS',234,200,1),
  text('128 SOURCE TEXELS RETAINED',24,382,1,'#9be1c4')
]});
function blit(bytes,w,h,x,y,zoom) {
  for (let j=0;j<h*zoom;j++) for (let i=0;i<w*zoom;i++) {
    const at = (Math.floor(j/zoom)*w+Math.floor(i/zoom))*4;
    board.data.set(bytes.subarray(at,at+4),((y+j)*W+x+i)*4);
  }
}
blit(pixels,width,height,24,128,2);
blit(brick.data,brick.w,brick.h,234,128,7);
const highlight = [155,225,196,255], left = 24+crop.x*2, top = 128+crop.y*2;
for (let i=0;i<crop.width*2;i++) for (const row of [top-1,top+crop.height*2])
  board.data.set(highlight,(row*W+left+i)*4);
for (let i=0;i<crop.height*2;i++) for (const col of [left-1,left+crop.width*2])
  board.data.set(highlight,((top+i)*W+col)*4);
const wall = PNG.raster(file('brick-wall-1x.png'));
blit(wall.data,wall.w,wall.h,398,128,2);
write('One-brick-twelve-faces.png',PNG.encode(W,H,board.data,4));
