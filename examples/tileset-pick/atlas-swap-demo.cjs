'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {atlas:gatehouseAtlas} = require('../gatehouse-revision/portal.cjs');

const directory = path.resolve(process.argv[2] ?? 'tileset-atlas-swap-demo');
fs.mkdirSync(directory,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

const width=33, height=17;
const a={x:1,y:3,width:12,height:10}, b={x:19,y:4,width:12,height:10};
const raw = new Uint8Array(width*height*4);
const masonry=gatehouseAtlas();
function paint(x,y,rgba) {
  raw.set(rgba,(y*width+x)*4);
}
for (let y=0;y<height;y++) for (let x=0;x<width;x++) paint(x,y,[30+(x+y)%2*5,39,47,255]);
for (let y=0;y<a.height;y++) for (let x=0;x<a.width;x++) {
  const at=((24+y%7)*masonry.width+24+x)*4;
  paint(a.x+x,a.y+y,masonry.pixels.subarray(at,at+4));
  const edge=x === 0 || y === 0 || x === b.width-1 || y === b.height-1;
  const bar=x === 2 || x === 6 || x === 9 || y === 4;
  const highlight=y === 1 || x === 1 || (x === 3 || x === 7 || x === 10) && y%5 !== 0;
  paint(b.x+x,b.y+y,edge ? [27,42,49,255] : bar ? [65,111,111,255] : highlight ? [115,169,147,255] : [40,72,79,255]);
}

const vertices = [], faces = [];
for (const [i,[x,y,region]] of [
  [0,0,a],[2,0,a],[0,1,b],[2,1,b],[0,2,a],[1,2,a],[2,2,a],[1,3,b]
].entries()) {
  const id='wall-'+i, {x:u,y:v,width:w,height:h}=region;
  const coords=[[u,v+h-1],[u+w-1,v+h-1],[u+w-1,v],[u,v]];
  const corners=[[0,0],[1,0],[1,1],[0,1]].map(([dx,dy],j)=>{
    const vertex=id+'-v'+j;
    vertices.push({id:vertex,position:[x+dx,y+dy,0]});
    return {id:id+'-uv'+j,vertex,uv:[coords[j][0]/(width-1),coords[j][1]/(height-1)]};
  });
  faces.push({id,corners,material:'paint'});
}
const document={id:'atlas-swap-gate',style:'slate',solids:[],
  tilesets:{masonry:{...ink.readTilesetImage(PNG.encode(width,height,raw,4)),tileSize:{width:12,height:10}}},
  topologyMeshes:{gate:{document:{id:'gate',vertices,faces},materials:[{id:'paint',texture:{tileset:'masonry'}}]}}};
write('gate-before.json',JSON.stringify(document,null,2)+'\n');
const swap=['tileset','swap','--scene','gate-before.json','--id','masonry',
  '--a',Object.values(a).join(','),'--b',Object.values(b).join(',')];
const plan=JSON.parse(studio(swap,'swap-preview.json'));
assert.equal(plan.canCommit,true);
assert.equal(plan.references.length,8);
assert.equal(plan.texelsExchanged,240);
assert.deepEqual(JSON.parse(studio([...swap,'--out','gate-after.json'],'swap-commit.json')),plan);

const after = JSON.parse(fs.readFileSync(file('gate-after.json'),'utf8'));
for (const [phase,asset] of [['before',document.tilesets.masonry],['after',after.tilesets.masonry]])
  write('atlas-'+phase+'.png',PNG.encode(width,height,Buffer.from(asset.data,'base64'),4));
assert.notEqual(document.tilesets.masonry.data,after.tilesets.masonry.data);
function render(phase,view,yaw,pitch) {
  studio(['render','gate-'+phase+'.json','--w','192','--h','110','--px','1','--target','1.5,1.9,0',
    '--zoom','2.2','--yaw',yaw,'--pitch',pitch,'--ortho','--raw','--out',view+'-'+phase+'-1x.png']);
  const image = fs.readFileSync(file(view+'-'+phase+'-1x.png'));
  const {data} = PNG.raster(image);
  let visible = 0;
  for (let i=0;i<data.length;i+=4) if (data[i] !== data[0] || data[i+1] !== data[1] || data[i+2] !== data[2]) visible++;
  assert(visible>1000);
  return image;
}
assert.deepEqual(render('before','front','0','0'),render('after','front','0','0'));
assert.deepEqual(render('before','angle','.4','.19'),render('after','angle','.4','.19'));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+
  '\ncmp front-before-1x.png front-after-1x.png\ncmp angle-before-1x.png angle-after-1x.png\n');
write('README.md',`# Atlas swap demo

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The script
previews the swap, writes the revised gate scene, and renders both
scenes at 1× from two cameras. It checks the matched PNGs byte for byte.
The atlas PNGs show the exchanged texels. The preview and commit JSON
list all eight faces with their original and translated UVs.
`);

const W=864,H=488, x0=28, x1=452, ay=110, dy=259;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f7e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#121c26'),
  text('INK STUDIO / ATLAS REGION SWAP',28,20,2,'#9be1c4'),
  text('Gatehouse atlas before and after',28,47,3),
  text('BEFORE',x0,85,2),text('AFTER',x1,85,2),
  rect(x0-1,ay-1,width*7+2,height*7+2,'#54707a'),rect(x1-1,ay-1,width*7+2,height*7+2,'#54707a'),
  text('TWO 12 x 10 REGIONS',x0+248,ay+18,1,'#ffc789'),
  text('240 TEXELS',x1+248,ay+18,1,'#ffc789'),
  text('8 FACES REMAPPED',x1+248,ay+36,1,'#9be1c4'),
  rect(x0-1,dy-1,386,222,'#54707a'),rect(x1-1,dy-1,386,222,'#54707a'),
  text('MATCHED 1X RENDERS',x0,240,1,'#9be1c4')
]});
function blit(name,x,y,zoom) {
  const {w,h,data} = PNG.raster(file(name));
  for (let j=0;j<h*zoom;j++) for (let i=0;i<w*zoom;i++) {
    const at = (Math.floor(j/zoom)*w+Math.floor(i/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+j)*W+x+i)*4);
  }
}
blit('atlas-before.png',x0,ay,7);
blit('atlas-after.png',x1,ay,7);
blit('angle-before-1x.png',x0,dy,2);
blit('angle-after-1x.png',x1,dy,2);
write('Atlas-swap.png',PNG.encode(W,H,board.data,4));
