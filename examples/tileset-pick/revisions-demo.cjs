'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const portal = require('../gatehouse-revision/portal.cjs');

const directory = path.resolve(process.argv[2] ?? 'tileset-revisions-demo');
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

const {width,pixels} = portal.atlas();
const brickWidth=16, brickHeight=8, brick = new Uint8Array(brickWidth*brickHeight*4);
for (let y=0;y<brickHeight;y++) {
  const at = ((24+y)*width+24)*4;
  brick.set(pixels.subarray(at,at+brickWidth*4),y*brickWidth*4);
}
const paler = new Uint8Array(brick.length), trim = new Uint8Array(brick.length);
for (let i=0;i<brick.length;i+=4) {
  paler.set([brick[i]+16,brick[i+1]+31,brick[i+2]+30,255],i);
  trim.set([Math.round(brick[i]*.39),Math.round(brick[i+1]*.6),Math.round(brick[i+2]*.78),255],i);
}
const encode = data=>PNG.encode(brickWidth,brickHeight,data,4);
const asset = data=>({...ink.readTilesetImage(encode(data)),tileSize:{width:16,height:8}});
write('lime-brick.png',encode(paler));

const vertices = [], faces = [];
for (let row=0;row<3;row++) for (let column=0;column<4;column++) {
  const x = column+(row%2)*.5, y = row*.5, id = 'brick-'+row+'-'+column;
  const positions = [[x,y,0],[x+1,y,0],[x+1,y+.5,0],[x,y+.5,0]];
  const uvs = [[0,1],[1,1],[1,0],[0,0]];
  const corners = positions.map((position,i)=>{
    const vertex = id+'-v'+i;
    vertices.push({id:vertex,position});
    return {id:id+'-uv'+i,vertex,uv:uvs[i]};
  });
  faces.push({id,material:row === 0 ? 'trim-paint' : 'brick-paint',corners});
}
json('original.json',{id:'revision-wall',style:'slate',solids:[],
  tilesets:{brick:asset(brick),'brick-copy':asset(brick),trim:asset(trim)},
  timeline:{sequences:{reveal:{duration:.5}},clips:[{id:'wall-reveal',sequence:'reveal',time:0}]},
  prefabs:{'arch-kit':{revision:1,solids:{},usesTilesets:['brick-copy']}},
  topologyMeshes:{wall:{document:{id:'wall',vertices,faces},
    materials:[{id:'brick-paint',texture:{tileset:'brick-copy'}},{id:'trim-paint',texture:{tileset:'trim'}}]}}});

const inventory = JSON.parse(studio('tileset','dependencies','--scene','original.json','--id','brick-copy'));
const [dependencies] = inventory.sheets;
assert.equal(dependencies.faces.length,8);
assert.equal(dependencies.clips[0].id,'wall-reveal');
assert.equal(dependencies.prefabs[0].id,'arch-kit');
assert.equal(dependencies.prefabs[0].used,false);
json('dependencies.json',inventory);
function revise(type,scene,args,out) {
  const request = ['tileset',type,'--scene',scene+'.json',...args];
  const result = JSON.parse(studio(...request,...(out ? ['--out',out+'.json'] : [])));
  json(type+'-review.json',result);
  return result;
}
const blocked = revise('remove','original',['--id','brick-copy']);
assert.equal(blocked.canCommit,false);
json('blocked-removal.json',blocked);
assert.equal(revise('clone','original',['--id','brick-copy','--new-id','archive-brick'],'cloned').canCommit,true);
const dedup = revise('deduplicate','cloned',['--id','brick-copy','--keep-id','brick'],'deduplicated');
assert.deepEqual(dedup.redirect,{from:'brick-copy',to:'brick'});
assert.deepEqual(read('deduplicated.json').prefabs['arch-kit'].usesTilesets,['brick']);
revise('replace','deduplicated',['lime-brick.png','--id','brick'],'replaced');
const combined = revise('combine','replaced',['--ids','brick,trim','--new-id','masonry'],'combined');
assert.equal(combined.placements[1].x,brickWidth);
revise('remove','combined',['--id','archive-brick'],'cleaned');
assert.equal(read('cleaned.json').tilesets['archive-brick'],undefined);
studio('tileset','pick','--scene','cleaned.json','--id','masonry','--brush','--x','0','--y','0','--width','32','--height','8','--out','masonry-brush.json');
studio('tileset','brush-preview','masonry-brush.json','--scene','cleaned.json','--out','masonry-1x.png');

const pictures = ['original','deduplicated','cleaned'];
for (const id of pictures)
  studio('render',id+'.json','--w','192','--h','110','--px','1','--target','2.25,.75,0',
    '--zoom','3.5','--yaw','0','--pitch','0','--ortho','--raw','--out',id+'-1x.png');
assert.deepEqual(fs.readFileSync(file('original-1x.png')),fs.readFileSync(file('deduplicated-1x.png')));
assert.notDeepEqual(fs.readFileSync(file('original-1x.png')),fs.readFileSync(file('cleaned-1x.png')));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');

const W=836,H=482;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f7e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#101b24'),
  text('INK STUDIO / TILESET REVISIONS',24,20,2,'#9be1c4'),
  text('Revise the sheet. Keep the wall.',24,46,3),
  text('ORIGINAL BRICK',24,101,2),
  text('REPLACEMENT BRICK',426,101,2,'#9be1c4'),
  rect(23,126,386,222,'#54707a'),rect(425,126,386,222,'#54707a'),
  text('DEPENDENCY PREVIEW',24,370,2,'#9be1c4'),
  text('8 FACES / WALL-REVEAL CLIP',24,395,1),
  text('ARCH-KIT PREFAB / ZERO PLACEMENTS',24,413,1),
  text('DEDUPLICATED RENDER MATCHED BYTE FOR BYTE',24,452,1,'#b3c4c8'),
  text('COMBINED ATLAS',426,370,2,'#9be1c4'),
  text('BRICK',426,451,1),text('TRIM',506,451,1)
]});
function blit(name,x,y,zoom) {
  const {w,h,data} = PNG.raster(file(name));
  for (let j=0;j<h*zoom;j++) for (let i=0;i<w*zoom;i++) {
    const at = (Math.floor(j/zoom)*w+Math.floor(i/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+j)*W+x+i)*4);
  }
}
blit('original-1x.png',24,127,2);
blit('cleaned-1x.png',426,127,2);
blit('masonry-1x.png',426,404,5);
write('Masonry-tileset-revisions.png',PNG.encode(W,H,board.data,4));
