'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'weighted-collection-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const art = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#efe4ce')=>({type:'text',text,at:[x,y],scale,color});
const variants = [
  {id:'common',weight:6,label:'Common brick',colors:['#422b30','#aa6553','#d48763','#82483e']},
  {id:'worn',weight:3,label:'Worn brick',colors:['#422b30','#ae795d','#e2ac7e','#7e4e42']},
  {id:'moss',weight:1,label:'Mossy brick',colors:['#422b30','#99644d','#c08c61','#53694b']},
  {id:'spare',weight:0,label:'Spare brick',colors:['#422b30','#80677c','#bc97a7','#64526c']}
];
const sheet = art.render({width:64,height:8,edges:'hard',commands:variants.flatMap(({id,colors},i)=>{
  const x = i*16, [mortar,base,light,detail] = colors;
  const pattern = {
    common:[rect(x+3,5,3,1,detail),rect(x+9,3,3,1,detail)],
    worn:[rect(x+12,2,3,2,detail),rect(x+11,3,2,1,detail),rect(x+2,4,4,1,light),rect(x+7,5,2,1,light)],
    moss:[rect(x+5,6,10,1,detail),rect(x+8,5,6,1,detail),rect(x+12,4,3,1,'#718556'),rect(x+9,5,3,1,'#84935a')],
    spare:[rect(x+4,3,7,1,light),rect(x+2,5,4,1,detail)]
  };
  return [rect(x,0,16,8,mortar),rect(x+1,1,15,6,base),rect(x+1,1,13,1,light),...pattern[id]];
})});
const atlas = PNG.encode(64,8,sheet.data,4);
write('Masonry.png',atlas);
const scene = {id:'weighted-brickwork',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  tilesets:{masonry:ink.readTilesetImage(atlas)}};
json('wall-draft.json',scene);
json('bricks-draft.json',{id:'brickwork',entries:variants.map(({id,weight},i)=>({id,weight,
  selection:ink.pickTilesetRectangle(scene,'masonry',{x:i*16,y:0,width:16,height:8})}))});

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+' > '+(report ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

studio(['tileset','collection','create','bricks-draft.json','--scene','wall-draft.json','--out','bricks.json']);
const report = JSON.parse(studio(['tileset','collection','inspect','bricks.json','--scene','wall-draft.json'],'weights.json'));
const counts = Object.fromEntries(variants.map(({id})=>[id,0]));
const seed = 42;
let before = 'wall-draft.json';
for (let y=0;y<4;y++) for (let x=0;x<6;x++) {
  const key = `course-${y}-brick-${x}`;
  const pick = key+'-pick.json';
  const receipt = JSON.parse(studio(['tileset','collection','sample','bricks.json','--scene','wall-draft.json',
    '--seed',String(seed),'--key',key,'--out',pick],key+'-choice.json'));
  assert.deepEqual(receipt,ink.sampleTilesetCollection(scene,report.collection,{seed,key}));
  counts[receipt.id]++;
  const after = x===5 && y===3 ? 'painted-wall.json' : key+'-scene.json';
  studio(['tileset','stamp','--scene',before,'--selection',pick,'--object','masonry','--face',key,
    '--origin',`${x+(y%2)*.5},${y/2},0`,'--out',after]);
  before = after;
}
assert(counts.common > 0 && counts.worn > 0 && counts.moss > 0);
assert.equal(counts.spare,0);
studio(['render','painted-wall.json','--w','192','--h','100','--px','1','--ortho','--yaw','0','--pitch','0',
  '--target','3.25,1,0','--zoom','2.66','--raw','--out','Wall-1x.png']);

const W = 912,H = 456, vx = 632;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#18272d'),text('INK STUDIO / TILE MESHES',24,20,2,'#a8cfb4'),
  text('Weighted brick collection',24,51,3),text('24 MESH FACES / SEED 42',24,90,2),
  rect(23,123,578,302,'#55746d'),
  text('AUTHORED TILE VARIANTS',vx,111,2,'#a8cfb4'),
  ...variants.flatMap(({label,id,weight},i)=>{
    const y = 147+i*68;
    const {probability} = report.entries.find(entry=>entry.id===id);
    return [text(label,vx+62,y+4,2),text(`WEIGHT ${weight} / ${Math.round(probability*100)}% / ${counts[id]} PICKED`,vx+62,y+27,1,'#a8cfb4')];
  })
]});
function blit(data,width,crop,at,scale) {
  const [sx,sy,w,h] = crop, [dx,dy] = at;
  for (let y=0;y<h*scale;y++) for (let x=0;x<w*scale;x++) {
    const start = ((sy+Math.floor(y/scale))*width+sx+Math.floor(x/scale))*4;
    board.data.set(data.subarray(start,start+4),((dy+y)*W+dx+x)*4);
  }
}
const wall = PNG.raster(file('Wall-1x.png'));
blit(wall.data,wall.w,[0,0,wall.w,wall.h],[24,124],3);
variants.forEach((_,i)=>blit(sheet.data,64,[16*i,0,16,8],[vx,147+i*68],3));
write('Tile-collections.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Weighted brick collections

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The 24 mesh faces
use ordinary tile picks. Each pick is sampled from one collection with
seed 42 and a stable brick address. Inspect \`weights.json\` for authored
weights and probabilities and the individual choice files for receipts.
\`Wall-1x.png\` is the native camera capture of the finished mesh.
`);
