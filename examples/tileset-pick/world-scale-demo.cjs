'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const directory = path.resolve(process.argv[2] ?? 'tileset-world-scale-demo');
fs.mkdirSync(directory,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(directory,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
const commands = [];
function studio(...args) {
  commands.push('ink-studio '+args.join(' '));
  return execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
}

const emblem = [
  'ssssssssssssssss','shhhhhhhhhhhhhbs','shaaddddddddahbs','shadeddddddddhbs',
  'shaddddttddddhbs','shadddtcctdddhbs','shaddtcccctddhbs','shadtcccccctdhbs',
  'shadtcccccctdhbs','shaddtcccctddhbs','shadddtcctdddhbs','shaddddttddddhbs',
  'shaddddddddedhbs','shaabbbbbbbbahbs','sbbbbbbbbbbbbbbs','ssssssssssssssss'
];
const palette = {
  s:[64,40,38,255],h:[237,184,116,255],a:[183,122,75,255],d:[46,55,63,255],
  e:[237,207,163,255],t:[68,130,135,255],c:[151,220,190,255],b:[112,72,55,255]
};
const atlas = new Uint8Array(32*16*4);
for (const [y,row] of emblem.entries()) {
  assert.equal(row.length,16);
  for (const [x,swatch] of Array.from(row).entries()) {
    atlas.set(palette[x % 4 === 0 ? 'a' : 's'],(y*32+x)*4);
    atlas.set(palette[swatch],(y*32+16+x)*4);
  }
}
write('relay-tiles.png',PNG.encode(32,16,atlas,4));
write('ink-studio.config.js','module.exports = {texelsPerUnit: 16};\n');
json('draft.json',{id:'relay-scale',style:'slate',solids:[],tilesetDefaults:{tileSize:{width:16,height:16}}});
studio('tileset','import','relay-tiles.png','--scene','draft.json','--id','relay','--out','relay-scene.json');
studio('tileset','world-scale','--scene','relay-scene.json');
studio('tileset','pick','--scene','relay-scene.json','--id','relay','--brush','--x','16','--y','0',
  '--width','16','--height','16','--brush-scale','0.5','--out','inset-brush.json');
const inset = JSON.parse(studio('tileset','brush-size','inset-brush.json','--scene','relay-scene.json'));
const panel = JSON.parse(studio('tileset','brush-size','inset-brush.json','--scene','relay-scene.json',
  '--brush-scale','2','--out','panel-brush.json'));
assert.deepEqual(inset.worldSize,{width:.5,height:.5});
assert.deepEqual(panel.worldSize,{width:2,height:2});
for (const id of ['inset','panel'])
  studio('tileset','brush-preview',id+'-brush.json','--scene','relay-scene.json','--out',id+'-1x.png');
assert.deepEqual(fs.readFileSync(file('inset-1x.png')),fs.readFileSync(file('panel-1x.png')));

const scene = read('relay-scene.json');
function face(id, x, {brush,worldSize:{width,height}}) {
  const source = scene.tilesets[brush.tileset];
  const u0 = brush.x/source.width, u1 = (brush.x+brush.width)/source.width;
  const v0 = brush.y/source.height, v1 = (brush.y+brush.height)/source.height;
  const uvs = [[u0,v1],[u1,v1],[u1,v0],[u0,v0]];
  const positions = [[x,0,0],[x+width,0,0],[x+width,height,0],[x,height,0]];
  const vertices = positions.map((position,i)=>({id:'v'+i,position}));
  const corners = vertices.map(({id:vertex},i)=>({id:'uv'+i,vertex,uv:uvs[i]}));
  return {document:{id,vertices,faces:[{id:'front',material:'paint',corners}]},
    materials:[{id:'paint',texture:{tileset:brush.tileset}}]};
}
scene.topologyMeshes = {inset:face('inset',-.9,inset),panel:face('panel',.12,panel)};
const K = ink.load().KIT;
const world = ink.createSceneEditor(scene).build();
for (const [index,{worldSize:{width,height}}] of [inset,panel].entries()) {
  const ray = K.sceneMeshes.rayQuery(world.meshes[index],K), x0 = index === 0 ? -.9 : .12;
  const hit = (u,v)=>ray({origin:[x0+u*width,v*height,1],direction:[0,0,-1],maxDistance:2});
  for (const [y,row] of emblem.entries()) for (const [x,swatch] of Array.from(row).entries()) {
    const [r,g,b] = palette[swatch];
    assert.equal(hit((x+.5)/16,1-(y+.5)/16).pigment,r*65536+g*256+b);
  }
  assert.equal(hit(1.01,.5),null);
}
json('mounted-faces.json',scene);
json('world-size-report.json',{inset,panel});
studio('render','mounted-faces.json','--w','192','--h','120','--px','1','--target','0.68,1,0',
  '--zoom','3','--yaw','0','--pitch','0','--ortho','--raw','--out','mounted-faces-1x.png');
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');

const drawing = ink.load().KIT.procedural.drawing2d;
const W=676,H=390,picture=PNG.raster(file('mounted-faces-1x.png')), crop=PNG.raster(file('inset-1x.png'));
const text = (text,x,y,scale,color='#f7e8d1')=>({type:'text',text,at:[x,y],scale,color});
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const board = drawing.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#101b24'),
  text('INK STUDIO / TILE BRUSH SCALE',24,20,2,'#9be1c4'),
  text('One crop. Two world sizes.',24,45,4),
  text('SOURCE CROP',24,96,2,'#9be1c4'),
  text('16 X 16 TEXELS',24,218,2),
  text('16 TEXELS PER UNIT',24,244,1,'#aebdc2'),
  text('0.5X BRUSH',24,286,2,'#9be1c4'),
  text('0.5 X 0.5 WORLD UNITS',24,307,1),
  text('2X BRUSH',24,333,2,'#9be1c4'),
  text('2 X 2 WORLD UNITS',24,354,1),
  text('MATCHED HEADLESS MESH RENDER',264,96,2,'#9be1c4'),
  rect(263,121,386,242,'#58737d'),
  text('BOTH MESHES SAMPLE THE SAME ATLAS COORDINATES',264,372,1,'#aebdc2')
]});
function blit({w,h,data}, x, y, zoom) {
  for (let j=0;j<h*zoom;j++) for (let i=0;i<w*zoom;i++) {
    const at=(Math.floor(j/zoom)*w+Math.floor(i/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+j)*W+x+i)*4);
  }
}
blit(crop,24,122,5);
blit(picture,264,122,2);
write('Relay-brush-world-scale.png',PNG.encode(W,H,board.data,4));
